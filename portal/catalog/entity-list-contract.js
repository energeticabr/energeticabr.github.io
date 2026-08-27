import { ACTIONS } from "../access/access-model.js";

function frozenCapabilities(value = {}) {
  return Object.freeze(Object.fromEntries(ACTIONS.map(action => [action, value?.[action] === true])));
}

function declaredEvidence(entity = {}) {
  const declared = entity?.listCapabilityEvidence;
  if (Array.isArray(declared) && declared.length) {
    const byName = new Map();
    for (const item of declared) {
      const listName = String(item?.listName || "").trim();
      if (!listName || byName.has(listName)) throw new TypeError("A evidência de lista da entidade é inválida ou duplicada.");
      byName.set(listName, Object.freeze({ listName, capabilities: frozenCapabilities(item?.capabilities) }));
    }
    const expected = [...new Set((entity.listNames || []).map(name => String(name || "").trim()).filter(Boolean))];
    if (expected.length !== byName.size || expected.some(name => !byName.has(name))) {
      throw new TypeError("A evidência de capacidade não cobre exatamente todos os nomes de lista da entidade.");
    }
    return Object.freeze(expected.map(name => byName.get(name)));
  }

  return Object.freeze((entity?.listNames || []).map(listName => Object.freeze({
    listName: String(listName || "").trim(),
    capabilities: frozenCapabilities({ view: entity?.available !== false }),
  })));
}

function mergeCapabilities(evidence = []) {
  return frozenCapabilities(Object.fromEntries(ACTIONS.map(action => [
    action,
    evidence.some(item => item.capabilities?.[action] === true),
  ])));
}

export async function resolveEntityListContracts(sharepoint, entity) {
  if (!sharepoint?.resolveList) throw new TypeError("A resolução do contrato requer o repositório SharePoint.");
  const evidence = declaredEvidence(entity);
  const proofs = [];
  const unresolved = [];

  for (const item of evidence) {
    let list;
    try {
      list = await sharepoint.resolveList(entity.siteKey, [item.listName]);
    } catch (error) {
      unresolved.push(Object.freeze({ listName: item.listName, status: "unavailable", error }));
      continue;
    }
    if (list?.status !== "resolved" || !String(list?.id || "").trim()) {
      unresolved.push(Object.freeze({ listName: item.listName, status: list?.status || "missing" }));
      continue;
    }
    proofs.push(Object.freeze({
      listName: item.listName,
      listId: String(list.id),
      displayName: String(list.displayName || item.listName),
      capabilities: item.capabilities,
    }));
  }

  const byPhysicalList = new Map();
  for (const proof of proofs) {
    const current = byPhysicalList.get(proof.listId) || [];
    current.push(proof);
    byPhysicalList.set(proof.listId, current);
  }
  const contracts = [...byPhysicalList.entries()].map(([listId, capabilityEvidence]) => Object.freeze({
    entityId: entity.id,
    moduleId: entity.moduleId,
    siteKey: entity.siteKey,
    listId,
    displayName: capabilityEvidence[0].displayName,
    capabilities: mergeCapabilities(capabilityEvidence),
    capabilityEvidence: Object.freeze([...capabilityEvidence]),
  }));

  return Object.freeze({
    contracts: Object.freeze(contracts),
    unresolved: Object.freeze(unresolved),
  });
}

export function entityCapabilityAllowed(contract, action) {
  return ACTIONS.includes(action) && contract?.capabilities?.[action] === true;
}

export { declaredEvidence as entityListCapabilityEvidence };
