import test from "node:test";
import assert from "node:assert/strict";
import xcode from "xcode";
import { configureDistributionSigning } from "../scripts/distribution-signing.mjs";
import { fileURLToPath } from "node:url";

const projectPath = fileURLToPath(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url));
const profiles = {
  "br.com.energetica.energetico": "11111111-1111-1111-1111-111111111111",
  "br.com.energetica.energetico.share": "22222222-2222-2222-2222-222222222222",
};
function load() { const project = xcode.project(projectPath); project.parseSync(); return project; }

test("distribution uses separate profiles only in the two Release targets", () => {
  const project = load();
  const before = structuredClone(project.pbxXCBuildConfigurationSection());
  configureDistributionSigning(project, "GAJL3L258F", profiles);
  const configs = project.pbxXCBuildConfigurationSection();
  let signed = 0;
  for (const [id, config] of Object.entries(configs)) {
    if (!config.buildSettings) continue;
    const bundle = config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
    if (config.name === "Release" && profiles[bundle]) {
      signed++;
      assert.equal(config.buildSettings.CODE_SIGN_STYLE, "Manual");
      assert.equal(config.buildSettings.CODE_SIGN_IDENTITY, '"Apple Distribution"');
      assert.equal(config.buildSettings.PROVISIONING_PROFILE_SPECIFIER, profiles[bundle]);
      assert.equal(config.buildSettings.DEVELOPMENT_TEAM, "GAJL3L258F");
    } else {
      assert.deepEqual(structuredClone(config), before[id], "debug/project/dependency settings must stay unchanged");
    }
  }
  assert.equal(signed, 2);
  const first = project.writeSync();
  configureDistributionSigning(project, "GAJL3L258F", profiles);
  assert.equal(project.writeSync(), first, "repeat preparation must be idempotent");
});

test("missing or foreign signing input fails without mutating the project", () => {
  for (const [team, selected] of [["", profiles], ["GAJL3L258F", {}], ["GAJL3L258F", {...profiles, "another.app": "x"}]]) {
    const project = load();
    const before = project.writeSync();
    assert.throws(() => configureDistributionSigning(project, team, selected));
    assert.equal(project.writeSync(), before);
  }
});
