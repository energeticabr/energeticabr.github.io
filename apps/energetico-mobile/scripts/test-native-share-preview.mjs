import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

assert.equal(process.platform, "darwin", "The UIKit preview requires the real iOS Simulator");
const xcrun = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 240_000 }).trim();
const root = await mkdtemp(join(tmpdir(), "energetico-share-preview-"));
const app = join(root, "NativeSharePreview.app");
await mkdir(app);
const bundleID = "br.com.energetica.tests.shareprogress";
const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>NativeSharePreview</string>
<key>CFBundleIdentifier</key><string>${bundleID}</string>
<key>CFBundleName</key><string>NativeSharePreview</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>16.0</string><key>LSRequiresIPhoneOS</key><true/>
<key>CFBundleSupportedPlatforms</key><array><string>iPhoneSimulator</string></array>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
<key>UILaunchScreen</key><dict/><key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>`;
await writeFile(join(app, "Info.plist"), plist);
await cp(resolve("../../assets/mascote-energetica-transparente.png"), join(app, "Mascote.png"));
const sdk = xcrun("--sdk", "iphonesimulator", "--show-sdk-path");
const arch = process.arch === "arm64" ? "arm64" : "x86_64";
xcrun("swiftc", "-sdk", sdk, "-target", `${arch}-apple-ios16.0-simulator`,
  "ios/ShareExtension/SharedUploadProgress.swift", "tests/native-share-preview/main.swift",
  "-o", join(app, "NativeSharePreview"));
execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
const inventory = JSON.parse(xcrun("simctl", "list", "--json"));
const runtime = inventory.runtimes.find((item) => item.isAvailable && /^iOS 26/.test(item.name));
const phone = inventory.devicetypes.find((item) => item.name === "iPhone 17")
  || inventory.devicetypes.find((item) => item.name.startsWith("iPhone"));
assert.ok(runtime && phone, "An iOS 26 phone Simulator is required");
const id = xcrun("simctl", "create", "ENERGETICO-Share-Progress-Test", phone.identifier, runtime.identifier);
const output = resolve(process.argv[2] || "build/native-share-preview");
await mkdir(output, { recursive: true });
try {
  xcrun("simctl", "boot", id);
  xcrun("simctl", "bootstatus", id, "-b");
  xcrun("simctl", "install", id, app);
  xcrun("simctl", "launch", id, bundleID);
  const data = xcrun("simctl", "get_app_container", id, bundleID, "data");
  let report;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try { report = JSON.parse(await readFile(join(data, "Documents/verification.json"), "utf8")); break; }
    catch { await setTimeout(250); }
  }
  assert.equal(report?.cases, 18, "All real UIKit layout, accessibility, light/dark and percentage cases must pass");
  await cp(join(data, "Documents"), output, { recursive: true });
  xcrun("simctl", "io", id, "screenshot", join(output, "simulator-screen.png"));
  console.log("PASS: 18 native UIKit percentage layouts; real Simulator screenshots saved");
} finally {
  try { xcrun("simctl", "shutdown", id); } catch {}
  xcrun("simctl", "delete", id); // Only the disposable Simulator created above.
}
