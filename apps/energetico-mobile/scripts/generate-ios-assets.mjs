import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = new URL("../", import.meta.url);
const source = new URL("../../../assets/mascote-energetica-transparente.png", import.meta.url);
const webAsset = new URL("src/assets/mascote.png", appRoot);
const assetCatalog = new URL("ios/App/App/Assets.xcassets/", appRoot);
const iconDirectory = new URL("AppIcon.appiconset/", assetCatalog);
const splashDirectory = new URL("Splash.imageset/", assetCatalog);
const mascotDirectory = new URL("Mascote.imageset/", assetCatalog);
const pwaIconDirectory = new URL("pwa/icons/", appRoot);

await Promise.all([
  mkdir(new URL("src/assets/", appRoot), { recursive: true }),
  mkdir(iconDirectory, { recursive: true }),
  mkdir(splashDirectory, { recursive: true }),
  mkdir(mascotDirectory, { recursive: true }),
  mkdir(pwaIconDirectory, { recursive: true }),
]);
await copyFile(source, webAsset);

const sourcePath = fileURLToPath(source);

const foreground = await sharp(sourcePath)
  .trim()
  .resize(860, 860, {
    fit: "contain",
    withoutEnlargement: false,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
const masterIcon = await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 3,
    background: "#06356b",
  },
})
  .composite([{ input: foreground, gravity: "center" }])
  .png()
  .toBuffer();

const iconFiles = new Map([
  ["AppIcon-20@1x.png", 20], ["AppIcon-20@2x.png", 40], ["AppIcon-20@3x.png", 60],
  ["AppIcon-29@1x.png", 29], ["AppIcon-29@2x.png", 58], ["AppIcon-29@3x.png", 87],
  ["AppIcon-40@1x.png", 40], ["AppIcon-40@2x.png", 80], ["AppIcon-40@3x.png", 120],
  ["AppIcon-60@2x.png", 120], ["AppIcon-60@3x.png", 180],
  ["AppIcon-76@1x.png", 76], ["AppIcon-76@2x.png", 152],
  ["AppIcon-83.5@2x.png", 167], ["AppIcon-1024.png", 1024],
]);
for (const [fileName, size] of iconFiles) {
  await sharp(masterIcon)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(fileName, iconDirectory)));
}
for (const size of [192, 512]) {
  await sharp(masterIcon)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`mascote-${size}.png`, pwaIconDirectory)));
}
await rm(new URL("AppIcon-512@2x.png", iconDirectory), { force: true });

const iconContents = {
  images: [
    { size: "20x20", idiom: "iphone", filename: "AppIcon-20@2x.png", scale: "2x" },
    { size: "20x20", idiom: "iphone", filename: "AppIcon-20@3x.png", scale: "3x" },
    { size: "29x29", idiom: "iphone", filename: "AppIcon-29@2x.png", scale: "2x" },
    { size: "29x29", idiom: "iphone", filename: "AppIcon-29@3x.png", scale: "3x" },
    { size: "40x40", idiom: "iphone", filename: "AppIcon-40@2x.png", scale: "2x" },
    { size: "40x40", idiom: "iphone", filename: "AppIcon-40@3x.png", scale: "3x" },
    { size: "60x60", idiom: "iphone", filename: "AppIcon-60@2x.png", scale: "2x" },
    { size: "60x60", idiom: "iphone", filename: "AppIcon-60@3x.png", scale: "3x" },
    { size: "20x20", idiom: "ipad", filename: "AppIcon-20@1x.png", scale: "1x" },
    { size: "20x20", idiom: "ipad", filename: "AppIcon-20@2x.png", scale: "2x" },
    { size: "29x29", idiom: "ipad", filename: "AppIcon-29@1x.png", scale: "1x" },
    { size: "29x29", idiom: "ipad", filename: "AppIcon-29@2x.png", scale: "2x" },
    { size: "40x40", idiom: "ipad", filename: "AppIcon-40@1x.png", scale: "1x" },
    { size: "40x40", idiom: "ipad", filename: "AppIcon-40@2x.png", scale: "2x" },
    { size: "76x76", idiom: "ipad", filename: "AppIcon-76@1x.png", scale: "1x" },
    { size: "76x76", idiom: "ipad", filename: "AppIcon-76@2x.png", scale: "2x" },
    { size: "83.5x83.5", idiom: "ipad", filename: "AppIcon-83.5@2x.png", scale: "2x" },
    { size: "1024x1024", idiom: "ios-marketing", filename: "AppIcon-1024.png", scale: "1x" },
  ],
  info: { version: 1, author: "xcode" },
};
await writeFile(
  new URL("Contents.json", iconDirectory),
  `${JSON.stringify(iconContents, null, 2)}\n`,
  "utf8",
);

const splashForeground = await sharp(sourcePath)
  .trim()
  .resize(1120, 1780, {
    fit: "contain",
    withoutEnlargement: false,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
const splash = await sharp({
  create: {
    width: 2732,
    height: 2732,
    channels: 3,
    background: "#f2f7fb",
  },
})
  .composite([{ input: splashForeground, gravity: "center" }])
  .png()
  .toBuffer();
for (const fileName of [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
]) {
  await sharp(splash).toFile(fileURLToPath(new URL(fileName, splashDirectory)));
}

for (const [fileName, width] of [
  ["mascote.png", 256], ["mascote@2x.png", 512], ["mascote@3x.png", 768],
]) {
  await sharp(sourcePath)
    .resize({ width })
    .png()
    .toFile(fileURLToPath(new URL(fileName, mascotDirectory)));
}
await writeFile(
  new URL("Contents.json", mascotDirectory),
  `${JSON.stringify({
    images: [
      { idiom: "universal", filename: "mascote.png", scale: "1x" },
      { idiom: "universal", filename: "mascote@2x.png", scale: "2x" },
      { idiom: "universal", filename: "mascote@3x.png", scale: "3x" },
    ],
    info: { version: 1, author: "xcode" },
  }, null, 2)}\n`,
  "utf8",
);

process.stdout.write("Ícones, splash e mascote gerados.\n");
