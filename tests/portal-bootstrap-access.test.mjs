import test from "node:test";
import assert from "node:assert/strict";
import { isBootstrapAuthorized } from "../portal/core/bootstrap-access.js";

test("permite somente o superadministrador inicial no bootstrap", () => {
  assert.equal(isBootstrapAuthorized("  BERNARDONOTINI@ENERGETICABR.COM "), true);
  assert.equal(isBootstrapAuthorized("outro@energeticabr.com"), false);
});
