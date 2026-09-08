import xcode from "xcode";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const bundles = ["br.com.energetica.energetico", "br.com.energetica.energetico.share"];
const clean = (value) => String(value || "").replace(/^"|"$/g, "");

export function configureDistributionSigning(project, team, profiles) {
  if (!/^[A-Z0-9]{10}$/.test(team) || Object.keys(profiles).length !== 2 ||
      bundles.some(bundle => !/^[0-9a-f-]{36}$/i.test(profiles[bundle] || ""))) {
    throw new Error("Expected a team and exactly two ENERGETICO distribution profiles.");
  }
  const objects = project.hash.project.objects;
  const selected = [];
  for (const target of Object.values(project.pbxNativeTargetSection())) {
    if (typeof target !== "object") continue;
    const list = objects.XCConfigurationList[target.buildConfigurationList];
    for (const ref of list?.buildConfigurations || []) {
      const config = objects.XCBuildConfiguration[ref.value];
      const bundle = clean(config.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER);
      if (clean(config.name) === "Release" && bundles.includes(bundle)) selected.push({config, bundle});
    }
  }
  if (selected.length !== 2 || new Set(selected.map(item => item.bundle)).size !== 2) {
    throw new Error("Expected exactly the App and ShareExtension Release targets.");
  }
  for (const {config, bundle} of selected) {
    Object.assign(config.buildSettings, {
      CODE_SIGN_STYLE: "Manual",
      CODE_SIGN_IDENTITY: '"Apple Distribution"',
      DEVELOPMENT_TEAM: team,
      PROVISIONING_PROFILE_SPECIFIER: profiles[bundle],
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = JSON.parse(await readFile(process.argv[2], "utf8"));
  const projectPath = fileURLToPath(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url));
  const project = xcode.project(projectPath);
  project.parseSync();
  configureDistributionSigning(project, settings.team, settings.profiles);
  await writeFile(projectPath, project.writeSync());
  console.log("Distribution signing configured for App and ShareExtension only.");
}
