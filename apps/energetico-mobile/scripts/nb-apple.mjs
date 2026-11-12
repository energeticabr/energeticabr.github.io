import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAppleClient } from "./app-store-submission.mjs";
import { attachLatestTestFlightBuild } from "./attach-testflight-build.mjs";
import { NB_APP_NAME, NB_BUNDLE_ID } from "../src/nb-participacoes.js";

const client = createAppleClient();
const groupName = "NB Validação";
const signingProfiles = [
  { bundle: NB_BUNDLE_ID, name: "NB AppStore", file: "nb-app.mobileprovision" },
  { bundle: `${NB_BUNDLE_ID}.share`, name: "NB Share AppStore", file: "nb-share.mobileprovision" },
];
const app = async () => {
  const { data } = await client.request("GET", `/v1/apps?filter[bundleId]=${NB_BUNDLE_ID}`);
  return data?.find(item => item.attributes?.bundleId === NB_BUNDLE_ID);
};

async function registerBundle(identifier, name) {
  const find = async () => {
    const { data } = await client.request("GET", `/v1/bundleIds?filter[identifier]=${identifier}`);
    return data?.find(item => item.attributes?.identifier === identifier);
  };
  if (!await find()) {
    try {
      await client.request("POST", "/v1/bundleIds", {
        data: { type: "bundleIds", attributes: { identifier, name, platform: "IOS" } },
      });
    } catch (error) {
      if (!/HTTP 409|timed out|timeout/i.test(error.message) || !await find()) throw error;
    }
  }
  if (!await find()) throw new Error(`Identificador não confirmado: ${identifier}`);
  console.log(`Identificador confirmado: ${identifier}`);
}

async function ensureGroup(appId) {
  const find = async () => {
    const { data } = await client.request("GET", `/v1/apps/${appId}/betaGroups?limit=200`);
    return data?.find(item => item.attributes?.name === groupName && item.attributes?.isInternalGroup === true);
  };
  if (!await find()) {
    try {
      await client.request("POST", "/v1/betaGroups", {
        data: {
          type: "betaGroups",
          attributes: { name: groupName, isInternalGroup: true, hasAccessToAllBuilds: false },
          relationships: { app: { data: { type: "apps", id: appId } } },
        },
      });
    } catch (error) {
      if (!/HTTP 409|timed out|timeout/i.test(error.message) || !await find()) throw error;
    }
  }
  const group = await find();
  if (!group) throw new Error("Grupo interno NB não confirmado na Apple.");
  console.log(`Grupo interno confirmado: ${groupName}`);
  return group.id;
}

async function addExistingTester(sourceGroupId, targetGroupId) {
  if (!/^[a-f0-9-]{36}$/i.test(sourceGroupId) || sourceGroupId === targetGroupId) {
    throw new Error("Grupo de origem do testador inválido.");
  }
  const { data: source } = await client.request("GET", `/v1/betaGroups/${sourceGroupId}?include=app`);
  if (source?.attributes?.isInternalGroup !== true
      || source.attributes.name !== "ENERGETICO Validacao"
      || source.relationships?.app?.data?.id !== "6809887853") {
    throw new Error("O grupo de origem não corresponde à validação interna do Energético.");
  }
  const relationship = groupId => `/v1/betaGroups/${groupId}/relationships/betaTesters`;
  const { data, links } = await client.request("GET", relationship(sourceGroupId));
  if (data?.length !== 1 || links?.next || data[0].type !== "betaTesters" || !data[0].id) {
    throw new Error("Esperava somente o testador já ativo no grupo de origem.");
  }
  const hasTester = async () => {
    const { data: testers } = await client.request("GET", relationship(targetGroupId));
    return testers?.some(item => item.type === "betaTesters" && item.id === data[0].id);
  };
  if (!await hasTester()) {
    try {
      await client.request("POST", relationship(targetGroupId), { data });
    } catch (error) {
      if (!/HTTP 409|timed out|timeout/i.test(error.message) || !await hasTester()) throw error;
    }
  }
  if (!await hasTester()) throw new Error("A Apple não confirmou o testador interno no grupo do NB.");
  console.log("Testador interno existente confirmado no NB.");
}

async function loadProfile({ bundle, name }) {
  const { data: bundles } = await client.request("GET", `/v1/bundleIds?filter[identifier]=${bundle}`);
  const bundleId = bundles?.find(item => item.attributes?.identifier === bundle)?.id;
  if (!bundleId) throw new Error(`Bundle não localizado: ${bundle}`);
  const { data: profiles } = await client.request("GET", `/v1/bundleIds/${bundleId}/profiles?limit=200`);
  const profile = profiles?.find(item => item.attributes?.name === name
    && item.attributes?.profileType === "IOS_APP_STORE"
    && item.attributes?.profileState === "ACTIVE"
    && Date.parse(item.attributes.expirationDate) > Date.now());
  return { bundleId, profile };
}

async function prepareSigning({ allowCreate }) {
  const [main, extension] = await Promise.all(signingProfiles.map(loadProfile));
  if (!main.profile) throw new Error("Perfil principal NB AppStore não encontrado.");
  if (!extension.profile && allowCreate) {
    const { data: certificates } = await client.request("GET", `/v1/profiles/${main.profile.id}/relationships/certificates`);
    if (certificates?.length !== 1 || certificates[0].type !== "certificates") {
      throw new Error("O perfil principal não confirmou um único certificado de distribuição.");
    }
    try {
      await client.request("POST", "/v1/profiles", {
        data: {
          type: "profiles",
          attributes: { name: signingProfiles[1].name, profileType: "IOS_APP_STORE" },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: extension.bundleId } },
            certificates: { data: certificates },
          },
        },
      });
    } catch (error) {
      if (!/HTTP 409|timed out|timeout/i.test(error.message) || !(await loadProfile(signingProfiles[1])).profile) throw error;
    }
    extension.profile = (await loadProfile(signingProfiles[1])).profile;
  }
  if (!extension.profile) throw new Error("Perfil NB Share AppStore não encontrado.");
  for (const [index, { profile }] of [main, extension].entries()) {
    const base64 = profile.attributes.profileContent;
    if (typeof base64 !== "string" || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error("Conteúdo de perfil inválido.");
    await writeFile(join(process.env.RUNNER_TEMP, signingProfiles[index].file), Buffer.from(base64, "base64"), { mode: 0o600 });
    console.log(`Perfil localizado: ${signingProfiles[index].name}`);
  }
}

async function waitForSigningProfiles() {
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      await prepareSigning({ allowCreate: false });
      return;
    } catch (error) {
      if (error.message !== "Perfil NB Share AppStore não encontrado." || attempt === 40) throw error;
      if (attempt === 1 || attempt % 5 === 0) console.log("Aguardando o perfil NB Share AppStore.");
      await new Promise(resolve => setTimeout(resolve, 30_000));
    }
  }
}

const mode = process.argv[2];
if (mode === "register") {
  await registerBundle(NB_BUNDLE_ID, NB_APP_NAME);
  await registerBundle(`${NB_BUNDLE_ID}.share`, `${NB_APP_NAME} Share`);
}
const record = await app();
if (!record) {
  console.log(`Cadastro do app pendente no App Store Connect para ${NB_BUNDLE_ID}.`);
  if (mode !== "register") process.exitCode = 1;
} else {
  console.log(`Cadastro do app confirmado para ${NB_BUNDLE_ID}.`);
  if (mode === "group") await ensureGroup(record.id);
  if (mode === "profiles" || mode === "setup-signing") await prepareSigning({ allowCreate: mode === "setup-signing" });
  if (mode === "wait-profiles") await waitForSigningProfiles();
  if (mode === "attach") {
    const groupId = await ensureGroup(record.id);
    console.log(JSON.stringify(await attachLatestTestFlightBuild(client, {
      appId: record.id, groupName, requireInternal: true,
    })));
    if (process.env.NB_SOURCE_BETA_GROUP) await addExistingTester(process.env.NB_SOURCE_BETA_GROUP, groupId);
  }
}
if (process.env.GITHUB_STEP_SUMMARY && mode !== "attach") {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `- App Store Connect: ${record ? "cadastro localizado" : "cadastro pendente"}\n`);
}
