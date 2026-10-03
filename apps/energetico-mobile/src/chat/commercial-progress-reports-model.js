const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR");
const same = (left, right) => key(left) === key(right);
const selected = (value, filter) => !text(filter) || same(value, filter);
const propertyKey = row => `${key(row.branch)}\u0000${key(row.property)}`;
const validProperty = row => text(row.branch) && text(row.property) && key(row.property) !== "TODOS" && !key(row.property).startsWith("ESCRITORIO");
const rescinded = value => key(value) === "RESCISAO";
const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");
const sum = (rows, name) => rows.reduce((total, row) => total + row[name], 0);
const daysBetween = (from, to) => from && to ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) : null;

function groupBranches(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = text(row.branch);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups].map(([name, properties]) => ({ name, properties: properties.sort((a, b) => a.property.localeCompare(b.property, "pt-BR")) })).sort(byName);
}

export function buildCommercialReport14(snapshot, filters = {}) {
  const propertiesByKey = new Map();
  for (const property of snapshot?.properties || []) {
    if (!validProperty(property)) continue;
    const identity = propertyKey(property);
    if (propertiesByKey.has(identity)) throw new Error(`O imóvel ${property.property} aparece mais de uma vez na filial ${property.branch}.`);
    propertiesByKey.set(identity, property);
  }
  const contracts = [];
  const contractsById = new Map();
  for (const contract of snapshot?.contracts || []) {
    if (key(contract.property) === "TODOS" || key(contract.property).startsWith("ESCRITORIO")) continue;
    if (!validProperty(contract) || !propertiesByKey.has(propertyKey(contract))) {
      throw new Error(`Contrato ${text(contract.id) || "sem ID"} sem imóvel cadastrado correspondente.`);
    }
    const id = text(contract.id);
    if (!id || contractsById.has(id)) throw new Error("Há contrato com ID vazio ou duplicado; o total não pode ser reconciliado.");
    if (!Number.isFinite(contract.total)) throw new Error(`Total do contrato ${id} incompleto ou ilegível.`);
    contracts.push(contract); contractsById.set(id, contract);
  }
  const clients = snapshot?.clients || [];
  const allReceipts = [];
  for (const receipt of snapshot?.receipts || []) {
    const contract = contractsById.get(text(receipt.contractId));
    if (!contract && (key(receipt.property) === "TODOS" || key(receipt.property).startsWith("ESCRITORIO"))) continue;
    if (!contract) throw new Error(`Pagamento ${text(receipt.id) || "sem ID"} sem contrato correspondente.`);
    if ((text(receipt.branch) && !same(receipt.branch, contract.branch))
      || (text(receipt.property) && !same(receipt.property, contract.property))) {
      throw new Error(`Pagamento ${text(receipt.id) || "sem ID"} diverge do imóvel do contrato ${contract.id}.`);
    }
    if (!Number.isFinite(receipt.amount)) throw new Error("Há valor de receita incompleto ou ilegível; os totais não foram exibidos.");
    allReceipts.push(Object.freeze({ ...receipt, branch: contract.branch, property: contract.property }));
  }
  const contractFor = row => contractsById.get(text(row.contractId));
  const clientFor = (row, buyer) => clients.find(client => propertyKey(client) === propertyKey(row) && same(client.name, buyer));
  const isFormer = row => rescinded(clientFor(row, contractFor(row)?.buyer || row.buyer)?.definitive);
  const selectedContracts = contracts.filter(row => selected(row.branch, filters.branch)
    && selected(row.property, filters.property) && selected(row.id, filters.contractId)
    && selected(row.buyer, filters.buyer) && selected(row.status, filters.contractStatus));
  const selectedIds = new Set(selectedContracts.map(row => text(row.id)));
  const receipts = allReceipts.filter(row => selectedIds.has(text(row.contractId)));
  const properties = [...propertiesByKey.values()].filter(row => selected(row.branch, filters.branch)
    && selected(row.property, filters.property)
    && (!filters.contractId && !filters.buyer && !filters.contractStatus
      || selectedContracts.some(contract => propertyKey(contract) === propertyKey(row))));
  const pendingPayments = allReceipts.filter(row => !text(row.paidDate) && selected(row.branch, filters.branch)
    && selected(row.property, filters.property) && selected(row.contractId, filters.contractId)
    && selected(row.buyer, filters.buyer)).sort((a, b) =>
    (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || Number(a.id) - Number(b.id));
  const summary = properties.map(property => {
    const propertyContracts = selectedContracts.filter(row => propertyKey(row) === propertyKey(property));
    const group = receipts.filter(row => propertyKey(row) === propertyKey(property) && text(row.paidDate));
    const paid = sum(group.filter(row => !same(row.directBroker, "SIM")), "amount");
    const formerContracts = sum(group.filter(row => !same(row.directBroker, "SIM") && isFormer(row)), "amount");
    const currentPaid = paid - formerContracts;
    const brokerPaid = sum(group.filter(row => same(row.directBroker, "SIM")), "amount");
    const total = sum(propertyContracts, "total");
    const paidTotal = currentPaid + formerContracts + brokerPaid;
    const pending = Math.max(0, total - paidTotal);
    const buyer = filters.buyer || clients.find(client => propertyKey(client) === propertyKey(property) && !rescinded(client.definitive))?.name
      || contracts.find(contract => propertyKey(contract) === propertyKey(property) && !rescinded(clientFor(property, contract.buyer)?.definitive))?.buyer || "";
    return Object.freeze({ ...property, buyer, paid: currentPaid, formerContracts, brokerPaid, pending, total,
      paidPercentage: total ? paidTotal / total * 100 : 0 });
  });
  const indicators = { total: sum(summary, "total"),
    paid: sum(receipts.filter(row => text(row.paidDate)), "amount"), pending: sum(summary, "pending"),
    active: properties.filter(row => same(row.visualStatus, "ATIVO")).length,
    inactive: properties.filter(row => same(row.visualStatus, "INATIVO")).length };
  const branches = groupBranches(summary).map(branch => {
    const paid = sum(branch.properties, "paid"); const formerContracts = sum(branch.properties, "formerContracts");
    const brokerPaid = sum(branch.properties, "brokerPaid"); const pending = sum(branch.properties, "pending");
    const total = sum(branch.properties, "total");
    return Object.freeze({ ...branch, paid, formerContracts, brokerPaid, pending, total,
      paidPercentage: total ? (paid + formerContracts + brokerPaid) / total * 100 : 0 });
  });
  return Object.freeze({ indicators: Object.freeze(indicators), branches: Object.freeze(branches),
    pendingPayments: Object.freeze(pendingPayments), contracts: Object.freeze(selectedContracts) });
}

export function buildCommercialReport15(snapshot, filters = {}, today = new Date().toISOString().slice(0, 10)) {
  const properties = snapshot?.properties || [];
  const rows = (snapshot?.milestones || []).filter(row => selected(row.branch, filters.branch)
    && selected(row.property, filters.property) && selected(row.contractId, filters.contractId)
    && selected(row.buyer, filters.buyer) && selected(row.status, filters.milestoneStatus)).map(row => {
    const property = properties.find(item => propertyKey(item) === propertyKey(row));
    return { ...row, visualStatus: text(property?.visualStatus) || "SEM STATUS",
      daysInProgress: daysBetween(row.startDate, today), daysToDue: daysBetween(today, row.dueDate) };
  }).filter(row => selected(row.visualStatus, filters.visualStatus));
  if (rows.some(row => !/^[1-9]\d*$/.test(text(row.id)))) throw new Error("Apontamento comercial sem ID numérico válido.");
  const ordered = rows.sort((a, b) => Number(b.id) - Number(a.id));
  const latest = new Map();
  for (const row of ordered) if (!latest.has(propertyKey(row))) latest.set(propertyKey(row), Object.freeze(row));
  const branches = groupBranches([...latest.values()]).map(branch => Object.freeze({ ...branch, count: branch.properties.length }));
  const detail = Boolean(filters.contractId || filters.buyer || filters.property);
  return Object.freeze({ branches: Object.freeze(branches), history: Object.freeze(detail ? ordered : []), detail });
}
