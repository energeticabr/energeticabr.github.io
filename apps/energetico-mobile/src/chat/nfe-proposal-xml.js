import Decimal from 'decimal.js';

const FiscalDecimal = Decimal.clone({ precision:48, rounding:Decimal.ROUND_HALF_UP });
const zero = new FiscalDecimal(0);
const nfeNamespace = 'http://www.portalfiscal.inf.br/nfe';
const nfseNamespace = 'http://www.sped.fazenda.gov.br/nfse';

function children(node, name) {
  return [...(node?.children || [])].filter(child => child.localName === name && child.namespaceURI === node.namespaceURI);
}

function child(node, name) {
  const matches = children(node, name);
  if (matches.length > 1) throw new Error(`Campo ${name} ambíguo no XML fiscal.`);
  return matches[0];
}

function value(node, name, context = '', required = false) {
  const field = child(node, name);
  if (!field && !required) return '';
  const text = field?.textContent.trim();
  if (!text || field.children.length) throw new Error(`Campo ${name} ausente ou inválido ${context || 'no XML fiscal'}.`);
  return text;
}

function decimal(node, name, { context, required, scale = 2, digits = 13 } = {}) {
  const raw = value(node, name, context, required);
  if (!raw) return null;
  const parts = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!parts || parts[1].length > digits || (parts[2]?.length || 0) > scale) {
    throw new Error(`Valor ${name} inválido ${context || 'no XML fiscal'}.`);
  }
  return new FiscalDecimal(raw);
}

const amount = (node, name) => decimal(node, name) ?? zero;
const sum = amounts => amounts.reduce((total, number) => total.plus(number), zero);

function calendarDay(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw ? '' : raw;
}

function invoiceIssueDate(raw, rowDate) {
  const date = calendarDay(raw.slice(0, 10));
  const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!date || (raw !== date && (!timestamp.test(raw) || !Number.isFinite(Date.parse(raw)))) || (rowDate && rowDate !== date)) {
    throw new Error('A data de emissão do XML fiscal é inválida ou diverge do relatório.');
  }
  return date;
}

function nfeItem(det, number) {
  const product = child(det, 'prod');
  const context = `no item ${number}`;
  const description = value(product, 'xProd', context, true);
  const code = value(product, 'cProd', context, true);
  const unit = value(product, 'uCom', context, true);
  const quantity = decimal(product, 'qCom', { context, required:true, scale:4, digits:11 });
  const unitPrice = decimal(product, 'vUnCom', { context, required:true, scale:10, digits:11 });
  if (quantity.isZero()) throw new Error(`Quantidade comercial inválida ${context}.`);
  const gross = decimal(product, 'vProd', { context, required:true });
  const rounded = quantity.times(unitPrice).toDecimalPlaces(2);
  if (gross.minus(rounded).abs().gt('0.01')) {
    throw new Error(`A quantidade e o valor unitário não conferem com o valor bruto do item ${number}.`);
  }
  const discount = amount(product, 'vDesc');
  if (discount.gt(gross)) throw new Error(`Desconto superior ao valor bruto do item ${number}.`);
  const totalIndicator = value(product, 'indTot');
  if (totalIndicator && !/^[01]$/.test(totalIndicator)) throw new Error(`Campo indTot inválido ${context}.`);
  const included = totalIndicator !== '0';
  const tax = child(det, 'imposto');
  const icms = child(tax, 'ICMS');
  const regimes = [...(icms?.children || [])].filter(node => node.namespaceURI === icms.namespaceURI);
  if (regimes.length > 1) throw new Error(`Grupo ICMS ambíguo no item ${number}.`);
  return {
    number, description, code, unit, quantity, unitPrice, gross, included, discount, product, tax, det, icms:regimes[0],
    service:!!child(tax, 'ISSQN'), adjustment:(included ? gross : zero).minus(rounded),
  };
}

// Distribute explicitly declared amounts in cents. Largest remainders win, with XML order as the tie breaker.
function allocate(lines, amount, weight, apply, label, limitToWeight = false) {
  if (amount.isZero()) return;
  const shares = lines.map(line => ({ line, weight:weight(line).times(100) }));
  const weightTotal = sum(shares.map(share => share.weight));
  const cents = amount.times(100);
  if (weightTotal.isZero() || (limitToWeight && cents.gt(weightTotal))) {
    throw new Error(`Não foi possível distribuir ${label} entre os itens da NF-e.`);
  }
  for (const share of shares) {
    const numerator = cents.times(share.weight);
    share.cents = numerator.divToInt(weightTotal);
    share.remainder = numerator.mod(weightTotal);
  }
  const unassigned = cents.minus(sum(shares.map(share => share.cents))).toNumber();
  shares.sort((a, b) => b.remainder.cmp(a.remainder));
  shares.forEach((share, index) => apply(share.line, share.cents.plus(index < unassigned ? 1 : 0).div(100)));
}

const eligibleGross = line => line.included ? line.gross : zero;
const netGoods = line => FiscalDecimal.max(0, eligibleGross(line).minus(line.discount));
const addDiscount = (line, amount) => { line.discount = line.discount.plus(amount); };
const addAdjustment = (line, amount) => { line.adjustment = line.adjustment.plus(amount); };

function addCharge(lines, totals, name, perItem) {
  const charges = lines.map(perItem);
  const listed = sum(charges);
  const total = decimal(totals, name) ?? listed;
  if (total.lt(listed)) throw new Error(`O total ${name} é menor que o declarado nos itens da NF-e.`);
  lines.forEach((line, index) => addAdjustment(line, charges[index]));
  allocate(lines, total.minus(listed), eligibleGross, addAdjustment, name);
}

function applyNfeCharges(lines, totals) {
  for (const name of ['vFrete', 'vSeg', 'vOutro']) addCharge(lines, totals, name, line => amount(line.product, name));
  addCharge(lines, totals, 'vIPI', line => amount(child(child(line.tax, 'IPI'), 'IPITrib'), 'vIPI'));
  addCharge(lines, totals, 'vII', line => amount(child(line.tax, 'II'), 'vII'));
  addCharge(lines, totals, 'vIPIDevol', line => amount(child(child(line.det, 'impostoDevol'), 'IPI'), 'vIPIDevol'));
  for (const [totalName, itemName] of [['vST', 'vICMSST'], ['vFCPST', 'vFCPST'], ['vICMSMonoReten', 'vICMSMonoReten']]) {
    addCharge(lines, totals, totalName, line => amount(line.icms, itemName));
  }
  for (const [tax, field, indicator] of [['PISST','vPIS','indSomaPISST'], ['COFINSST','vCOFINS','indSomaCOFINSST']]) {
    for (const line of lines) {
      const group = child(line.tax, tax);
      if (value(group, indicator) === '1') addAdjustment(line, amount(group, field));
    }
  }
}

const lineTotal = line => line.quantity.times(line.unitPrice).toDecimalPlaces(2).plus(line.adjustment).minus(line.discount);
const sumLines = lines => sum(lines.map(lineTotal));

function reconcileIcmsRelief(lines, totals, target) {
  const reliefs = lines.map(line => {
    const declared = decimal(line.icms, 'vICMSDeson', { context:`no item ${line.number}` }) ?? zero;
    const indicator = value(line.icms, 'indDeduzDeson');
    if (indicator && !/^[01]$/.test(indicator)) throw new Error(`Desoneração de ICMS inválida no item ${line.number}.`);
    if (indicator === '1') addAdjustment(line, declared.neg());
    return { declared, optional:indicator ? zero : declared };
  });
  const listed = sum(reliefs.map(relief => relief.declared));
  const total = decimal(totals, 'vICMSDeson') ?? listed;
  if (total.lt(listed)) throw new Error('O total vICMSDeson é menor que o declarado nos itens da NF-e.');
  const difference = sumLines(lines).minus(target);
  if (difference.isZero()) return;
  const optionalTotal = sum(reliefs.map(relief => relief.optional));
  const unspecified = total.minus(listed);
  if (difference.eq(optionalTotal.plus(unspecified))) {
    lines.forEach((line, index) => addAdjustment(line, reliefs[index].optional.neg()));
    allocate(lines, unspecified, eligibleGross, (line, amount) => addAdjustment(line, amount.neg()), 'a desoneração de ICMS');
  }
}

function billingDiscount(invoice, invoiceTotal, productDiscount) {
  const original = decimal(invoice, 'vOrig');
  const discount = amount(invoice, 'vDesc');
  const net = decimal(invoice, 'vLiq');
  if (discount.isZero() && (!net || net.eq(invoiceTotal)) && (!original || original.eq(invoiceTotal))) return zero;
  if (!original || !net || !original.minus(discount).eq(net) || net.gt(invoiceTotal)
      || (!net.eq(invoiceTotal) && !original.eq(invoiceTotal) && !original.eq(invoiceTotal.plus(productDiscount)))) {
    throw new Error('Os valores declarados na fatura não conferem com o total da NF-e.');
  }
  return invoiceTotal.minus(net);
}

function parseNfe(info, rowDate) {
  const seen = new Set();
  const lines = children(info, 'det').map(det => {
    const number = det.getAttribute('nItem');
    if (!/^[1-9]\d{0,2}$/.test(number || '') || seen.has(number)) throw new Error('Número de item inválido ou repetido na NF-e.');
    seen.add(number);
    return nfeItem(det, number);
  });
  if (!lines.length) throw new Error('A NF-e não contém itens no XML fiscal.');

  const total = child(info, 'total');
  const totals = child(total, 'ICMSTot');
  const products = decimal(totals, 'vProd', { required:true });
  const services = amount(child(total, 'ISSQNtot'), 'vServ');
  if (!sum(lines.filter(line => !line.service).map(eligibleGross)).eq(products)
      || !sum(lines.filter(line => line.service).map(eligibleGross)).eq(services)) {
    throw new Error('O valor total dos produtos ou serviços não confere com os itens da NF-e.');
  }
  const itemDiscounts = sum(lines.map(line => line.discount));
  const discount = decimal(totals, 'vDesc') ?? itemDiscounts;
  if (discount.lt(itemDiscounts)) throw new Error('O desconto total é menor que o declarado nos itens da NF-e.');
  allocate(lines, discount.minus(itemDiscounts), netGoods, addDiscount, 'o desconto da nota', true);

  const invoiceTotal = decimal(totals, 'vNF', { required:true });
  applyNfeCharges(lines, totals);
  reconcileIcmsRelief(lines, totals, invoiceTotal);
  if (!sumLines(lines).eq(invoiceTotal)) throw new Error('O total da NF-e não confere com os itens, descontos e acréscimos declarados.');

  const billing = child(info, 'cobr');
  const additionalDiscount = billingDiscount(child(billing, 'fat'), invoiceTotal, discount);
  allocate(lines, additionalDiscount, line => FiscalDecimal.max(0, lineTotal(line)), addDiscount, 'o desconto da fatura', true);
  const dates = children(billing, 'dup').map(installment => calendarDay(value(installment, 'dVenc')));
  const ide = child(info, 'ide');
  const dateTime = value(ide, 'dhEmi');
  const date = value(ide, 'dEmi');
  if (dateTime && date) throw new Error('A data de emissão é ambígua no XML da NF-e.');
  return {
    issueDate:invoiceIssueDate(dateTime || date, rowDate),
    dueDate:dates.length && dates.every(date => date === dates[0]) ? dates[0] : '',
    lines, total:invoiceTotal.minus(additionalDiscount),
  };
}

function parseNfse(info, rowDate) {
  const dps = child(child(info, 'DPS'), 'infDPS');
  const service = child(child(dps, 'serv'), 'cServ');
  const description = value(service, 'xDescServ', 'no serviço da NFS-e', true);
  const code = value(service, 'cTribNac');
  const values = child(dps, 'valores');
  const unitPrice = decimal(child(values, 'vServPrest'), 'vServ', { required:true });
  const discounts = child(values, 'vDescCondIncond');
  const discount = amount(discounts, 'vDescIncond');
  if (discount.gt(unitPrice)) throw new Error('O desconto incondicionado supera o valor do serviço na NFS-e.');
  return {
    issueDate:invoiceIssueDate(value(info, 'dhProc'), rowDate), dueDate:'',
    lines:[{ number:'1', code, description, unit:'', quantity:new FiscalDecimal(1), unitPrice, discount, adjustment:zero }],
    total:unitPrice.minus(discount),
  };
}

export function parseNfeProposalXml(xml, row, DOMParser) {
  if (typeof xml !== 'string' || !xml || xml.length > 1_125_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('XML fiscal inválido.');
  }
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  if (!root || root.localName === 'parsererror') throw new Error('XML fiscal inválido.');
  const isNfe = row.type === 'NF-e' && root.namespaceURI === nfeNamespace && ['nfeProc', 'NFe'].includes(root.localName);
  const isNfse = row.type === 'NFS-e' && root.namespaceURI === nfseNamespace && root.localName === 'NFSe';
  if (!isNfe && !isNfse) throw new Error('O tipo do XML fiscal não corresponde ao da nota selecionada.');

  const info = isNfe ? child(root.localName === 'NFe' ? root : child(root, 'NFe'), 'infNFe') : child(root, 'infNFSe');
  const keyPattern = isNfe ? /^\d{6}[A-Z0-9]{12}\d{26}$/ : /^\d{50}$/;
  const protocol = isNfe ? child(child(root, 'protNFe'), 'infProt') : null;
  if (!keyPattern.test(row.key) || info?.getAttribute('Id') !== `${isNfe ? 'NFe' : 'NFS'}${row.key}`
      || (protocol && value(protocol, 'chNFe') !== row.key)) {
    throw new Error('A chave de acesso do XML fiscal não corresponde à nota selecionada.');
  }

  const proposal = isNfe ? parseNfe(info, row.date) : parseNfse(info, row.date);
  return {
    issueDate:proposal.issueDate, dueDate:proposal.dueDate, total:proposal.total.toFixed(),
    lines:proposal.lines.map(({ number, code, description, unit, quantity, unitPrice, discount, adjustment }) => ({
      number, code, description, unit, quantity:quantity.toFixed(), unitPrice:unitPrice.toFixed(),
      discount:discount.toFixed(), adjustment:adjustment.toFixed(),
    })),
  };
}
