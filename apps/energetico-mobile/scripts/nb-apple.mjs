import { appendFile } from "node:fs/promises";
import { createAppleClient } from "./app-store-submission.mjs";
import { attachLatestTestFlightBuild } from "./attach-testflight-build.mjs";
import { NB_APP_NAME, NB_BUNDLE_ID } from "../src/nb-participacoes.js";

const client = createAppleClient();
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
  if (mode === "attach") {
    console.log(JSON.stringify(await attachLatestTestFlightBuild(client, {
      appId: record.id, groupName: "NB Validação", requireInternal: true,
    })));
  }
}
if (process.env.GITHUB_STEP_SUMMARY && mode !== "attach") {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `- App Store Connect: ${record ? "cadastro localizado" : "cadastro pendente"}\n`);
}
