import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = new URL("../ios/App/App/", import.meta.url);

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("catálogo de ícones contém tamanhos iPhone, iPad e marketing", async () => {
  const catalogUrl = new URL("Assets.xcassets/AppIcon.appiconset/", app);
  const catalog = JSON.parse(await readFile(new URL("Contents.json", catalogUrl), "utf8"));
  const expected = new Map([
    ["AppIcon-20@1x.png", 20], ["AppIcon-20@2x.png", 40], ["AppIcon-20@3x.png", 60],
    ["AppIcon-29@1x.png", 29], ["AppIcon-29@2x.png", 58], ["AppIcon-29@3x.png", 87],
    ["AppIcon-40@1x.png", 40], ["AppIcon-40@2x.png", 80], ["AppIcon-40@3x.png", 120],
    ["AppIcon-60@2x.png", 120], ["AppIcon-60@3x.png", 180],
    ["AppIcon-76@1x.png", 76], ["AppIcon-76@2x.png", 152],
    ["AppIcon-83.5@2x.png", 167], ["AppIcon-1024.png", 1024],
  ]);

  const declared = new Set(catalog.images.map(image => image.filename).filter(Boolean));
  for (const [fileName, size] of expected) {
    assert.equal(declared.has(fileName), true, `${fileName} ausente do catálogo`);
    assert.deepEqual(pngDimensions(await readFile(new URL(fileName, catalogUrl))), {
      width: size,
      height: size,
    });
  }
});

test("mascote está no pacote web, no splash e na extensão", async () => {
  const files = [
    new URL("../src/assets/mascote.png", import.meta.url),
    new URL("Assets.xcassets/Mascote.imageset/mascote@3x.png", app),
    new URL("Assets.xcassets/Splash.imageset/splash-2732x2732.png", app),
  ];
  for (const file of files) {
    const dimensions = pngDimensions(await readFile(file));
    assert.ok(dimensions.width > 0 && dimensions.height > 0);
  }
});

test("declara câmera, fotos e privacidade sem rastreamento", async () => {
  const info = await readFile(new URL("Info.plist", app), "utf8");
  const privacy = await readFile(new URL("PrivacyInfo.xcprivacy", app), "utf8");
  const extensionPrivacy = await readFile(
    new URL("../../ShareExtension/PrivacyInfo.xcprivacy", app),
    "utf8",
  );
  const project = await readFile(new URL("../App.xcodeproj/project.pbxproj", app), "utf8");

  assert.match(info, /NSCameraUsageDescription[\s\S]*tirar fotos/i);
  assert.match(info, /NSPhotoLibraryUsageDescription[\s\S]*escolher fotos/i);
  for (const manifest of [privacy, extensionPrivacy]) {
    assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    assert.match(manifest, /NSPrivacyAccessedAPICategoryFileTimestamp/);
    assert.match(manifest, /C617\.1/);
    assert.match(manifest, /3B52\.1/);
  }
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
});

test("declara dados funcionais do login e dos formulários internos sem publicidade", async () => {
  const expected = ["Name", "EmailAddress", "PhoneNumber", "PhysicalAddress", "PaymentInfo",
    "OtherFinancialInfo", "UserID", "PhotosorVideos", "OtherUserContent",
    "PerformanceData", "OtherDiagnosticData", "OtherDataTypes"];
  const manifest = await readFile(new URL("PrivacyInfo.xcprivacy", app), "utf8");
  for (const type of expected) {
    const entry = manifest.match(new RegExp(`<dict>\\s*<key>NSPrivacyCollectedDataType</key>\\s*<string>NSPrivacyCollectedDataType${type}</string>[\\s\\S]*?</dict>`));
    assert.ok(entry, `Tipo funcional não declarado: ${type}`);
    assert.match(entry[0], /<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
    assert.match(entry[0], /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
    assert.match(entry[0], /NSPrivacyCollectedDataTypePurposeAppFunctionality/);
    assert.doesNotMatch(entry[0], /Purpose(?:Analytics|ThirdPartyAdvertising|DeveloperAdvertising)/);
  }
});
