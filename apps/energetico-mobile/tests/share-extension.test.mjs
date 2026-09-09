import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ios = new URL("../ios/", import.meta.url);

test("projeto contém uma única extensão de compartilhamento incorporada", async () => {
  const project = await readFile(new URL("App/App.xcodeproj/project.pbxproj", ios), "utf8");

  assert.equal((project.match(/PBXNativeTarget section[\s\S]*?\/\* ShareExtension \*\/ = \{/g) || []).length, 1);
  assert.equal((project.match(/name = "Embed App Extensions";/g) || []).length, 1);
  assert.match(project, /ShareExtension\.appex in Embed App Extensions/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = br\.com\.energetica\.energetico\.share/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = \.\.\/ShareExtension\/ShareExtension\.entitlements/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 16\.0/);
});

test("caixa compartilhada usa coordenação, identificadores opacos e gravação atômica", async () => {
  const store = await readFile(new URL("ShareExtension/SharedInboxStore.swift", ios), "utf8");
  const plugin = await readFile(new URL("App/App/ShareInboxPlugin.swift", ios), "utf8");
  const bridge = await readFile(new URL("App/App/EnergeticoBridgeViewController.swift", ios), "utf8");

  assert.match(store, /NSFileCoordinator/);
  assert.match(store, /\.atomic/);
  assert.match(store, /UUID\(uuidString:/);
  assert.match(store, /group\.br\.com\.energetica\.energetico/);
  assert.match(plugin, /CAPBridgedPlugin/);
  assert.match(plugin, /CAPPluginMethod\(name: "list"/);
  assert.match(plugin, /CAPPluginMethod\(name: "read"/);
  assert.match(plugin, /CAPPluginMethod\(name: "remove"/);
  assert.match(bridge, /registerPluginInstance\(ShareInboxPlugin\(\)\)/);
});

test("extensão aceita arquivos e nunca força a abertura do aplicativo", async () => {
  const controller = await readFile(new URL("ShareExtension/ShareViewController.swift", ios), "utf8");
  const info = await readFile(new URL("ShareExtension/Info.plist", ios), "utf8");
  const entitlements = await readFile(new URL("ShareExtension/ShareExtension.entitlements", ios), "utf8");

  assert.match(controller, /Adicionar ao Energético/);
  assert.match(controller, /MSALSilentTokenParameters/);
  assert.match(controller, /confirmed-response\.json/);
  assert.doesNotMatch(controller, /openURL|UIApplication\.shared|responder/i);
  assert.match(info, /com\.apple\.share-services/);
  assert.match(info, /public\.item/);
  assert.match(entitlements, /group\.br\.com\.energetica\.energetico/);
  assert.match(entitlements, /com\.microsoft\.adalcache/);
});

test("sessão silenciosa da extensão usa cache do app sem validar seu URI contra o bundle da extensão", async () => {
  const controller = await readFile(new URL("ShareExtension/ShareViewController.swift", ios), "utf8");
  const main = await readFile(new URL("App/App/MicrosoftAuthPlugin.swift", ios), "utf8");
  const silent = controller.slice(controller.indexOf("private func acquireTokenSilently"), controller.indexOf("private func currentAccount"));
  assert.match(silent, /MSALGlobalConfig\.brokerAvailability = \.none/);
  assert.match(silent, /configuration\.bypassRedirectURIValidation = true[\s\S]*MSALPublicClientApplication\(configuration: configuration\)/);
  assert.match(silent, /keychainSharingGroup = "com\.microsoft\.adalcache"/);
  assert.match(silent, /MSALSilentTokenParameters\(scopes: \["User.Read"\]/);
  assert.doesNotMatch(controller, /MSALInteractiveTokenParameters/);
  assert.doesNotMatch(main, /bypassRedirectURIValidation\s*=\s*true/);
});

test("envio bloqueia detalhes concorrentes para não esconder o alerta final", async () => {
  const controller = await readFile(new URL("ShareExtension/ShareViewController.swift", ios), "utf8");
  const sending = controller.slice(controller.indexOf("@objc private func addItems"), controller.indexOf("@objc private func cancel"));
  assert.match(sending, /failuresButton\.isEnabled = false[\s\S]*Task\s*\{/);
});

test("envio totalmente confirmado fecha a extensão sem alerta de sucesso", async () => {
  const controller = await readFile(new URL("ShareExtension/ShareViewController.swift", ios), "utf8");
  const sending = controller.slice(controller.indexOf("@objc private func addItems"), controller.indexOf("@objc private func cancel"));
  assert.match(sending, /uploaded == stagedItems\.count[\s\S]*finish\(message: nil, closeImmediately: true\)/);
  assert.match(controller, /private func finish\(message: String\?, closeImmediately: Bool = false\)/);
  assert.match(controller, /if closeImmediately \{[\s\S]*completeRequest\(returningItems: \[\], completionHandler: nil\)/);
  assert.match(controller, /UIAlertController\(title: "Envio ao Energético"/);
});
