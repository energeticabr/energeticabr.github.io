import test from "node:test";
import assert from "node:assert/strict";

import { bridgeMicrosoftAuthResponse } from "../src/web/redirect-bridge.js";

test("entrega a resposta Microsoft à ponte antes de iniciar o aplicativo", async () => {
  const calls = [];

  const handled = await bridgeMicrosoftAuthResponse({
    locationRef: {
      search: "?code=authorization-code&state=msal-state",
      hash: "",
    },
    broadcastResponse: async () => calls.push("broadcast"),
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["broadcast"]);
});

test("página normal inicia sem chamar a ponte Microsoft", async () => {
  let broadcasts = 0;

  const handled = await bridgeMicrosoftAuthResponse({
    locationRef: { search: "", hash: "" },
    broadcastResponse: async () => { broadcasts += 1; },
  });

  assert.equal(handled, false);
  assert.equal(broadcasts, 0);
});
