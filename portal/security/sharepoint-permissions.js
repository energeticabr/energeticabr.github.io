import { ACTIONS, can } from "../access/access-model.js";

export const PERMISSION_KINDS = Object.freeze({
  view: 1,
  create: 2,
  edit: 3,
  delete: 4,
  approve: 5,
  openItems: 6,
  viewVersions: 7,
  deleteVersions: 8,
  cancelCheckout: 9,
  managePersonalViews: 10,
  manageLists: 12,
  viewFormPages: 13,
  anonymousSearchAccessList: 14,
  open: 17,
  viewPages: 18,
  addAndCustomizePages: 19,
  applyThemeAndBorder: 20,
  applyStyleSheets: 21,
  viewUsageData: 22,
  createSSCSite: 23,
  manageSubwebs: 24,
  createGroups: 25,
  managePermissions: 26,
  browseDirectories: 27,
  browseUserInfo: 28,
  addDelPrivateWebParts: 29,
  updatePersonalWebParts: 30,
  manageWeb: 31,
  anonymousSearchAccessWebLists: 32,
  useClientIntegration: 37,
  useRemoteAPIs: 38,
  manageAlerts: 39,
  createAlerts: 40,
  editMyUserInfo: 41,
  enumeratePermissions: 63,
});

export const PORTAL_BASE_PERMISSIONS = Object.freeze([
  "view",
  "openItems",
  "viewVersions",
  "viewFormPages",
  "open",
  "viewPages",
  "browseUserInfo",
  "useClientIntegration",
  "useRemoteAPIs",
]);

export const FULL_CONTROL_MASK = 0x7fffffffffffffffn;

export function permissionMaskValue(value) {
  const high = value?.High ?? value?.high;
  const low = value?.Low ?? value?.low;
  if (!/^\d+$/.test(String(high ?? "")) || !/^\d+$/.test(String(low ?? ""))) return undefined;
  try {
    const highValue = BigInt(high);
    const lowValue = BigInt(low);
    if (highValue > 0xffffffffn || lowValue > 0xffffffffn) return undefined;
    return (highValue << 32n) | lowValue;
  } catch {
    return undefined;
  }
}

export function maskForPermissionKinds(kinds = []) {
  return kinds.reduce((mask, kind) => mask | (1n << BigInt(kind - 1)), 0n);
}

export function permissionMaskObject(mask) {
  return Object.freeze({
    High: String((mask >> 32n) & 0xffffffffn),
    Low: String(mask & 0xffffffffn),
  });
}

export function maskForPermissionNames(names = []) {
  return maskForPermissionKinds(names.map(name => {
    const kind = PERMISSION_KINDS[name];
    if (!kind) throw new RangeError(`Permissao SharePoint desconhecida: ${name}`);
    return kind;
  }));
}

export function permissionMaskSignature(value) {
  const mask = typeof value === "bigint" ? value : permissionMaskValue(value);
  return mask === undefined ? "" : `${String((mask >> 32n) & 0xffffffffn)}:${String(mask & 0xffffffffn)}`;
}

export function portalEffectiveActionAllowed(access, moduleId, action) {
  return can(access, moduleId, action)
    || (action === "edit" && can(access, moduleId, "approve"));
}

export function portalEntityEffectiveActionAllowed(access, moduleId, capabilities, action) {
  if (!ACTIONS.includes(action)) return false;
  if (action === "edit" && capabilities?.approve === true && can(access, moduleId, "approve")) return true;
  return capabilities?.[action] === true && can(access, moduleId, action);
}

export function portalEntityActionMask(access, moduleId, capabilities) {
  const actions = ACTIONS
    .filter(action => portalEntityEffectiveActionAllowed(access, moduleId, capabilities, action))
    .map(action => PERMISSION_KINDS[action]);
  return actions.length
    ? maskForPermissionNames(PORTAL_BASE_PERMISSIONS) | maskForPermissionKinds(actions)
    : 0n;
}

export function portalActionMask(access, moduleId) {
  const actions = ACTIONS
    .filter(action => portalEffectiveActionAllowed(access, moduleId, action))
    .map(action => PERMISSION_KINDS[action]);
  return actions.length
    ? maskForPermissionNames(PORTAL_BASE_PERMISSIONS) | maskForPermissionKinds(actions)
    : 0n;
}

export function unexpectedPermissionKinds(actualMask, expectedMask) {
  const unexpected = actualMask & ~expectedMask;
  const kinds = [];
  for (let kind = 1; kind <= 64; kind += 1) {
    if ((unexpected & (1n << BigInt(kind - 1))) !== 0n) kinds.push(kind);
  }
  return Object.freeze(kinds);
}

export function missingPermissionKinds(actualMask, expectedMask) {
  return unexpectedPermissionKinds(expectedMask, actualMask);
}
