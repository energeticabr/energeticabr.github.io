import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../ios/App/App/", import.meta.url);

test("document picker usa cópia segura e seleção múltipla", async () => {
  const plugin = await readFile(new URL("DocumentPickerPlugin.swift", appUrl), "utf8");

  assert.match(plugin, /CAPBridgedPlugin/);
  assert.match(plugin, /UIDocumentPickerViewController/);
  assert.match(plugin, /forOpeningContentTypes: \[\.item\]/);
  assert.match(plugin, /asCopy: true/);
  assert.match(plugin, /allowsMultipleSelection = true/);
  assert.match(plugin, /startAccessingSecurityScopedResource/);
  assert.match(plugin, /stopAccessingSecurityScopedResource/);
});

test("o pacote iOS fixa alvo mínimo 16", async () => {
  const packageSwift = await readFile(new URL("../CapApp-SPM/Package.swift", appUrl), "utf8");
  const project = await readFile(new URL("../App.xcodeproj/project.pbxproj", appUrl), "utf8");

  assert.match(packageSwift, /\.iOS\(\.v16\)/);
  assert.doesNotMatch(project, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 16\.0/);
});

test("registra as pontes nativas no target e no bridge do Capacitor", async () => {
  const project = await readFile(new URL("../App.xcodeproj/project.pbxproj", appUrl), "utf8");
  const controller = await readFile(new URL("EnergeticoBridgeViewController.swift", appUrl), "utf8");
  const scene = await readFile(new URL("SceneDelegate.swift", appUrl), "utf8");

  assert.match(project, /DocumentPickerPlugin\.swift in Sources/);
  assert.match(project, /EnergeticoBridgeViewController\.swift in Sources/);
  assert.match(controller, /registerPluginInstance\(DocumentPickerPlugin\(\)\)/);
  assert.match(scene, /EnergeticoBridgeViewController\(\)/);
});

test("configura login Microsoft seguro com MSAL compatível com iOS 16", async () => {
  const project = await readFile(new URL("../App.xcodeproj/project.pbxproj", appUrl), "utf8");
  const plugin = await readFile(new URL("MicrosoftAuthPlugin.swift", appUrl), "utf8");
  const controller = await readFile(new URL("EnergeticoBridgeViewController.swift", appUrl), "utf8");
  const delegate = await readFile(new URL("AppDelegate.swift", appUrl), "utf8");
  const info = await readFile(new URL("Info.plist", appUrl), "utf8");
  const entitlements = await readFile(new URL("App.entitlements", appUrl), "utf8");

  assert.match(project, /microsoft-authentication-library-for-objc/);
  assert.match(project, /version = 2\.14\.1/);
  assert.match(project, /MicrosoftAuthPlugin\.swift in Sources/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/);
  assert.match(plugin, /MSALPublicClientApplication/);
  assert.match(plugin, /MSALInteractiveTokenParameters/);
  assert.match(plugin, /MSALSilentTokenParameters/);
  assert.match(plugin, /MSALError\.interactionRequired/);
  assert.match(controller, /registerPluginInstance\(MicrosoftAuthPlugin\(\)\)/);
  assert.match(delegate, /MSALPublicClientApplication\.handleMSALResponse/);
  assert.match(info, /msauth\.br\.com\.energetica\.energetico/);
  assert.match(entitlements, /group\.br\.com\.energetica\.energetico/);
  assert.match(entitlements, /com\.microsoft\.adalcache/);
});
