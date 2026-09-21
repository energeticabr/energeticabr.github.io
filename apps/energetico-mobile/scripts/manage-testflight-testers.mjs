import { pathToFileURL } from "node:url";
import { createAppleClient } from "./app-store-submission.mjs";
import { chooseInternalGroup } from "./attach-testflight-build.mjs";

const APP_ID = "6809887853";
const GROUP_NAME = "ENERGETICO Validacao";
const DEFAULT_EMAIL = "bernardonotini@energeticabr.com";
const DEFAULT_FIRST_NAME = "Bernardo";
const DEFAULT_LAST_NAME = "Notini";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const attr = value => value?.attributes || {};

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function parseAllowedEmails(value = DEFAULT_EMAIL) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[;,\n]/);
  const emails = [...new Set(values.map(normalizeEmail).filter(Boolean))];
  if (!emails.length || emails.some(email => !EMAIL_PATTERN.test(email))) {
    throw new Error("Informe pelo menos um e-mail válido para o TestFlight.");
  }
  return emails;
}

export function planTesterChanges(testers, allowedEmails) {
  const allowed = parseAllowedEmails(allowedEmails);
  const allowedSet = new Set(allowed);
  const keep = [];
  const remove = [];
  const keptEmails = new Set();
  for (const tester of testers || []) {
    const email = normalizeEmail(attr(tester).email);
    if (allowedSet.has(email) && !keptEmails.has(email)) {
      keptEmails.add(email);
      keep.push(tester);
    } else {
      remove.push(tester);
    }
  }
  return {
    allowed,
    keep,
    remove,
    missing: allowed.filter(email => !keptEmails.has(email)),
  };
}

export function createTesterPayload(email, groupId) {
  return {
    data: {
      type: "betaTesters",
      attributes: { email: normalizeEmail(email) },
      relationships: { betaGroups: { data: [{ type: "betaGroups", id: groupId }] } },
    },
  };
}

export function createUserInvitationPayload(email, appId = APP_ID) {
  return {
    data: {
      type: "userInvitations",
      attributes: {
        email: normalizeEmail(email),
        firstName: DEFAULT_FIRST_NAME,
        lastName: DEFAULT_LAST_NAME,
        roles: ["DEVELOPER"],
        allAppsVisible: false,
        provisioningAllowed: false,
      },
      relationships: {
        visibleApps: { data: [{ type: "apps", id: appId }] },
      },
    },
  };
}

const linkagePayload = ids => ({
  data: ids.map(id => ({ type: "betaTesters", id })),
});

async function list(client, path) {
  const result = [];
  const seen = new Set();
  while (path) {
    if (seen.has(path) || seen.size >= 30) throw new Error("Paginação inesperada na Apple.");
    seen.add(path);
    const page = await client.request("GET", path);
    result.push(...(page.data || []));
    path = page.links?.next;
  }
  return result;
}

async function findExistingTester(client, email) {
  const query = encodeURIComponent(email);
  const filtered = await list(client, `/v1/betaTesters?filter%5Bemail%5D=${query}&limit=200`);
  const match = filtered.find(tester => normalizeEmail(attr(tester).email) === email);
  if (match) return match;
  // Internal App Store Connect users can be present in Apple's general tester
  // list while the email filter omits them. Recheck the unfiltered list before
  // attempting creation, which would otherwise return HTTP 409.
  const all = await list(client, "/v1/betaTesters?limit=200");
  return all.find(tester => normalizeEmail(attr(tester).email) === email) || null;
}

async function findAppStoreUser(client, email) {
  const query = encodeURIComponent(email);
  const filtered = await list(client, `/v1/users?filter%5Busername%5D=${query}&limit=200`);
  const match = filtered.find(user => normalizeEmail(attr(user).username) === email);
  if (match) return match;
  // The filtered users endpoint can omit a team member even when the member
  // exists. Recheck the bounded global list before sending a duplicate invite.
  const all = await list(client, "/v1/users?limit=200");
  return all.find(user => normalizeEmail(attr(user).username) === email) || null;
}

async function findPendingInvitation(client, email) {
  const query = encodeURIComponent(email);
  const filtered = await list(client, `/v1/userInvitations?filter%5Bemail%5D=${query}&limit=200`);
  const match = filtered.find(invitation => normalizeEmail(attr(invitation).email) === email);
  if (match) return match;
  const all = await list(client, "/v1/userInvitations?limit=200");
  return all.find(invitation => normalizeEmail(attr(invitation).email) === email) || null;
}

async function loadGroupTesters(client, groupId) {
  return list(client, `/v1/betaGroups/${groupId}/betaTesters?limit=200&fields%5BbetaTesters%5D=email`);
}

export async function reconcileTestFlightTesters(client, { allowedEmails = DEFAULT_EMAIL } = {}) {
  const allowed = parseAllowedEmails(allowedEmails);
  const groups = await list(client, `/v1/betaGroups?filter%5Bapp%5D=${APP_ID}&limit=200`);
  const group = chooseInternalGroup(groups, GROUP_NAME);
  if (!group) throw new Error(`Grupo interno ${GROUP_NAME} não encontrado; nenhuma alteração foi feita.`);

  let current = await loadGroupTesters(client, group.id);
  let plan = planTesterChanges(current, allowed);
  const added = [];
  const removed = plan.remove.map(tester => normalizeEmail(attr(tester).email));

  // Resolve and add all desired testers first. If one cannot be resolved, the
  // function exits before removing anybody from the existing group.
  for (const email of plan.missing) {
    const existing = await findExistingTester(client, email);
    if (existing) {
      await client.request("POST", `/v1/betaGroups/${group.id}/relationships/betaTesters`, linkagePayload([existing.id]));
      added.push(email);
      continue;
    }
    const appStoreUser = await findAppStoreUser(client, email);
    if (!appStoreUser) {
      const pending = await findPendingInvitation(client, email);
      if (pending) {
        return {
          status: "INVITATION_PENDING",
          group: attr(group).name || GROUP_NAME,
          allowedEmails: allowed,
          added: [],
          removed: [],
          invitationId: pending.id,
        };
      }
      const invitation = await client.request("POST", "/v1/userInvitations", createUserInvitationPayload(email));
      const invitationId = invitation.data?.id;
      if (!invitationId) throw new Error(`A Apple não retornou o convite de ${email}; nenhuma remoção foi feita.`);
      return {
        status: "INVITATION_SENT",
        group: attr(group).name || GROUP_NAME,
        allowedEmails: allowed,
        added: [],
        removed: [],
        invitationId,
      };
    }
    const created = await client.request("POST", "/v1/betaTesters", createTesterPayload(email, group.id));
    const tester = created.data;
    if (!tester?.id) throw new Error(`A Apple não retornou o testador ${email}; nenhuma remoção foi feita.`);
    added.push(email);
  }

  if (plan.remove.length) {
    await client.request(
      "DELETE",
      `/v1/betaGroups/${group.id}/relationships/betaTesters`,
      linkagePayload(plan.remove.map(tester => tester.id)),
    );
  }

  current = await loadGroupTesters(client, group.id);
  plan = planTesterChanges(current, allowed);
  if (plan.missing.length || plan.remove.length || plan.keep.length !== allowed.length) {
    throw new Error("A Apple não confirmou a lista exata de testadores permitidos; verifique o App Store Connect.");
  }

  return {
    group: attr(group).name || GROUP_NAME,
    allowedEmails: allowed,
    added,
    removed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await reconcileTestFlightTesters(createAppleClient(), {
      allowedEmails: process.env.TESTFLIGHT_ALLOWED_EMAILS || DEFAULT_EMAIL,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
