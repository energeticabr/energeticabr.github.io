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
  <path fill="#fff" d="M259 666V358h63l122 184V358h65v308h-63L324 482v184zm300 0V358h116c61 0 96 29 96 80 0 32-13 54-36 67 32 13 48 39 48 76 0 53-38 85-103 85zm65-184h44c26 0 39-13 39-35s-13-33-39-33h-44zm0 128h52c27 0 42-13 42-37s-15-36-42-36h-52z"/>
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
