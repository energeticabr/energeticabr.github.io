import { access, readFile } from "node:fs/promises";

const appRoot = new URL("../", import.meta.url);
const read = relative => readFile(new URL(relative, appRoot), "utf8");

function requireMatch(value, pattern, label) {
  if (!pattern.test(value)) {
    throw new Error(`Projeto iOS inválido: ${label}.`);
  }
}

function requireCount(value, pattern, expected, label) {
  const count = (value.match(pattern) || []).length;
  if (count !== expected) {
    throw new Error(`Projeto iOS inválido: ${label}; esperado ${expected}, encontrado ${count}.`);
  }
}

const [
  capacitorText,
  project,
  appInfo,
  appEntitlements,
  extensionInfo,
  extensionEntitlements,
  appPrivacy,
  extensionPrivacy,
  bridge,
  clientConfig,
] = await Promise.all([
  read("capacitor.config.json"),
  read("ios/App/App.xcodeproj/project.pbxproj"),
  read("ios/App/App/Info.plist"),
  read("ios/App/App/App.entitlements"),
  read("ios/ShareExtension/Info.plist"),
  read("ios/ShareExtension/ShareExtension.entitlements"),
  read("ios/App/App/PrivacyInfo.xcprivacy"),
  read("ios/ShareExtension/PrivacyInfo.xcprivacy"),
  read("ios/App/App/EnergeticoBridgeViewController.swift"),
  read("src/config.js"),
]);

const capacitor = JSON.parse(capacitorText);
if (capacitor.appId !== "br.com.energetica.energetico") {
  throw new Error("Projeto iOS inválido: appId inesperado.");
}
if (capacitor.webDir !== "dist" || capacitor.server?.url) {
  throw new Error("Projeto iOS inválido: o app deve empacotar dist e não apontar para um site remoto.");
}
if (capacitor.server?.hostname !== "localhost" || capacitor.server?.iosScheme !== "capacitor") {
  throw new Error("Projeto iOS inválido: origem nativa deve ser capacitor://localhost.");
}
if (capacitor.ios?.minVersion !== "16.0") {
  throw new Error("Projeto iOS inválido: versão mínima deve ser iOS 16.0.");
}

requireCount(project, /PRODUCT_BUNDLE_IDENTIFIER = br\.com\.energetica\.energetico;/g, 2, "bundle ID do aplicativo");
requireCount(project, /PRODUCT_BUNDLE_IDENTIFIER = br\.com\.energetica\.energetico\.share;/g, 2, "bundle ID da extensão");
requireCount(project, /IPHONEOS_DEPLOYMENT_TARGET = 16\.0;/g, 6, "alvos mínimos iOS 16");
requireCount(project, /name = "Embed App Extensions";/g, 1, "incorporação única da extensão");
requireCount(project, /ShareExtension\.appex in Embed App Extensions \*\/ =/g, 1, "produto da extensão incorporado uma vez");
requireMatch(project, /repositoryURL = "https:\/\/github\.com\/AzureAD\/microsoft-authentication-library-for-objc\.git";[\s\S]*kind = exactVersion;[\s\S]*version = 2\.14\.1;/, "MSAL deve estar fixado exatamente em 2.14.1");
requireCount(project, /PrivacyInfo\.xcprivacy in Resources/g, 4, "manifests de privacidade nos dois targets");
requireMatch(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/, "entitlements do aplicativo");
requireMatch(project, /CODE_SIGN_ENTITLEMENTS = \.\.\/ShareExtension\/ShareExtension\.entitlements;/, "entitlements da extensão");

requireMatch(appInfo, /<string>msauth\.br\.com\.energetica\.energetico<\/string>/, "URL de retorno do Microsoft Auth");
requireMatch(appInfo, /NSCameraUsageDescription[\s\S]*O Energético usa a câmera/, "descrição de uso da câmera");
requireMatch(appInfo, /NSPhotoLibraryUsageDescription[\s\S]*O Energético permite escolher fotos/, "descrição de uso das fotos");
requireMatch(extensionInfo, /<string>com\.apple\.share-services<\/string>/, "ponto de extensão Compartilhar");

for (const [label, entitlements] of [
  ["aplicativo", appEntitlements],
  ["extensão", extensionEntitlements],
]) {
  requireMatch(entitlements, /group\.br\.com\.energetica\.energetico/, `App Group do ${label}`);
  requireMatch(entitlements, /com\.microsoft\.adalcache/, `grupo de chaves MSAL do ${label}`);
}

for (const [label, privacy] of [
  ["aplicativo", appPrivacy],
  ["extensão", extensionPrivacy],
]) {
  requireMatch(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/, `rastreamento desativado no ${label}`);
  requireMatch(privacy, /NSPrivacyAccessedAPICategoryFileTimestamp/, `API de timestamp declarada no ${label}`);
  requireMatch(privacy, /C617\.1/, `motivo de App Group no ${label}`);
  requireMatch(privacy, /3B52\.1/, `motivo de arquivo escolhido no ${label}`);
}

for (const plugin of ["DocumentPickerPlugin", "MicrosoftAuthPlugin", "ShareInboxPlugin"]) {
  requireMatch(bridge, new RegExp(`registerPluginInstance\\(${plugin}\\(\\)\\)`), `registro de ${plugin}`);
}
requireMatch(clientConfig, /clientId:\s*"94018e25-f756-4aa6-974e-27b8b43d7fe9"/, "client ID Microsoft");
requireMatch(clientConfig, /tenantId:\s*"0c10f511-7ede-4702-a2d9-bedb26937e0e"/, "tenant ID Microsoft");

await Promise.all([
  access(new URL("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png", appRoot)),
  access(new URL("ios/App/App/Assets.xcassets/Mascote.imageset/mascote@3x.png", appRoot)),
  access(new URL("ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png", appRoot)),
]);

process.stdout.write("Projeto iOS validado: app local, extensão, autenticação, privacidade e identidade consistentes.\n");
