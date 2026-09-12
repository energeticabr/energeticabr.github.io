import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appRoot = new URL("../", import.meta.url);
const source = new URL("../../../assets/mascote-energetica-transparente.png", import.meta.url);
const resources = new URL("android/app/src/main/res/", appRoot);

const densities = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

const sourcePath = fileURLToPath(source);
const foreground = await sharp(sourcePath)
  .trim()
  .resize(760, 760, {
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

for (const [density, scale] of densities) {
  const directory = new URL(`mipmap-${density}/`, resources);
  await mkdir(directory, { recursive: true });
  const legacySize = Math.round(48 * scale);
  const adaptiveSize = Math.round(108 * scale);

  await sharp(masterIcon)
    .resize(legacySize, legacySize)
    .png()
    .toFile(fileURLToPath(new URL("ic_launcher.png", directory)));
  await sharp(masterIcon)
    .resize(legacySize, legacySize)
    .png()
    .toFile(fileURLToPath(new URL("ic_launcher_round.png", directory)));

  const foregroundForDensity = await sharp(foreground)
    .resize(adaptiveSize, adaptiveSize, { fit: "contain" })
    .png()
    .toBuffer();
  const adaptiveForeground = await sharp({
    create: {
      width: adaptiveSize,
      height: adaptiveSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: foregroundForDensity, gravity: "center" }])
    .png()
    .toBuffer();
  await sharp(adaptiveForeground)
    .toFile(fileURLToPath(new URL("ic_launcher_foreground.png", directory)));
}

const colors = new URL("values/ic_launcher_background.xml", resources);
await mkdir(new URL("values/", resources), { recursive: true });
await writeFile(
  colors,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#06356B</color>\n</resources>\n`,
  "utf8",
);

process.stdout.write("Ícones Android do Energético gerados.\n");
