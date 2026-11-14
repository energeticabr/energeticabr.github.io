import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NB_APP_NAME, NB_BUNDLE_ID, NB_PORTAL_APP } from "../src/nb-participacoes.js";

const root = new URL("../", import.meta.url);
const originalBundle = "br.com.energetica.energetico";
const project = "ios/App/App.xcodeproj/project.pbxproj";
const main = "ios/App/App/";
const share = "ios/ShareExtension/";

async function change(file, transform) {
  const path = new URL(file, root);
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`NB: no expected change in ${file}`);
  await writeFile(path, after);
}

await change("capacitor.config.json", text => {
  const config = JSON.parse(text);
  config.appId = NB_BUNDLE_ID;
  config.appName = NB_APP_NAME;
  return JSON.stringify(config, null, 2) + "\n";
});
await change("index.html", text => text.replaceAll("Energético", NB_APP_NAME));
await change(project, text => {
  if (text.split("PRODUCT_BUNDLE_IDENTIFIER = " + originalBundle).length !== 5) {
    throw new Error("NB: expected four existing bundle settings");
  }
  return text.replaceAll("PRODUCT_BUNDLE_IDENTIFIER = " + originalBundle, "PRODUCT_BUNDLE_IDENTIFIER = " + NB_BUNDLE_ID);
});
await change(main + "Info.plist", text => text.replaceAll(originalBundle, NB_BUNDLE_ID)
  .replaceAll("Energético", NB_APP_NAME).replace("<string>energetico</string>", "<string>nbparticipacoes</string>"));
await change(share + "Info.plist", text => text.replaceAll("Energético", NB_APP_NAME)
  .replace("<dict>", `<dict>\n\t<key>PortalApp</key>\n\t<string>${NB_PORTAL_APP}</string>`));
for (const file of [main + "App.entitlements", share + "ShareExtension.entitlements"]) {
  await change(file, text => text.replaceAll(originalBundle, NB_BUNDLE_ID)
    .replace(/^\s*<string>\$\(AppIdentifierPrefix\)com\.microsoft\.adalcache<\/string>\r?\n/m, "\n"));
}
await change(main + "MicrosoftAuthPlugin.swift", text => text.replace('"com.microsoft.adalcache"', JSON.stringify(NB_BUNDLE_ID)));
await change(share + "ShareViewController.swift", text => text.replaceAll(originalBundle, NB_BUNDLE_ID)
  .replace('"com.microsoft.adalcache"', JSON.stringify(NB_BUNDLE_ID))
  .replaceAll("Energético", NB_APP_NAME)
  .replaceAll(" no Diário de Obras", ""));
await change(share + "SharedInboxStore.swift", text => text.replaceAll(originalBundle, NB_BUNDLE_ID));

const assetCatalog = new URL(main + "Assets.xcassets/", root);
const icon = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0c5568"/>
  <rect x="135" y="135" width="754" height="754" rx="158" fill="none" stroke="#81b2bf" stroke-width="12"/>
  <g fill="none" stroke="#fff" stroke-width="29" stroke-linecap="round" stroke-linejoin="round">
    <path d="M190 593V431l102 162V431"/>
    <path d="M326 593V431h51c54 0 54 81 0 81h-51m51 0c65 0 65 81 0 81h-51"/>
    <path d="M462 593V431h51c61 0 61 88 0 88h-51"/>
    <path d="m589 593 55-162 55 162m-91-56h72"/>
    <path d="M734 593V431h51c61 0 61 88 0 88h-51m49 0 52 74"/>
  </g>
</svg>`);
const iconSet = new URL("AppIcon.appiconset/", assetCatalog);
const { images } = JSON.parse(await readFile(new URL("Contents.json", iconSet), "utf8"));
await Promise.all([...new Map(images.map(image => [
  image.filename, Number(image.size.split("x")[0]) * Number(image.scale.replace("x", "")),
]))].map(([file, size]) => sharp(icon).resize(size).removeAlpha().png().toFile(fileURLToPath(new URL(file, iconSet)))));
const splashSet = new URL("Splash.imageset/", assetCatalog);
const splash = JSON.parse(await readFile(new URL("Contents.json", splashSet), "utf8"));
const mark = await sharp(icon).resize(320).png().toBuffer();
await Promise.all([...new Set(splash.images.map(item => item.filename).filter(Boolean))].map(async file => {
  const path = fileURLToPath(new URL(file, splashSet));
  const { width, height } = await sharp(path).metadata();
  await sharp({ create: { width, height, channels: 3, background: "#0c5568" } })
    .composite([{ input: mark, gravity: "center" }]).png().toFile(path);
}));
