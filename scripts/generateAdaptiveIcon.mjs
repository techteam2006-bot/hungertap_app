/**
 * Builds a padded Android adaptive-icon foreground so launchers do not crop/zoom the logo.
 * Safe zone is the inner 66% of the 108dp layer (Android adaptive-icon spec).
 *
 * Run: node scripts/generateAdaptiveIcon.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcPath = join(root, 'assets', 'splash_icon.png');
const outAdaptive = join(root, 'assets', 'adaptive-icon.png');
const resDir = join(root, 'android', 'app', 'src', 'main', 'res');

const CANVAS = 1024;
const SAFE_RATIO = 0.66;
const FALLBACK_BG = '#FFB301';

const FOREGROUND_SIZES = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

const LEGACY_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function sampleCornerColor(inputPath) {
  const { data } = await sharp(inputPath)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [r, g, b] = data;
  return { r, g, b, alpha: 1 };
}

async function buildPaddedForeground(bg) {
  const safePx = Math.round(CANVAS * SAFE_RATIO);
  const inset = Math.round((CANVAS - safePx) / 2);
  const logo = await sharp(srcPath)
    .resize(safePx, safePx, { fit: 'contain', background: bg })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: bg,
    },
  })
    .composite([{ input: logo, left: inset, top: inset }])
    .png({ compressionLevel: 9 });
}

async function writeWebp(image, dest, size) {
  mkdirSync(dirname(dest), { recursive: true });
  await image
    .clone()
    .resize(size, size, { fit: 'fill' })
    .webp({ lossless: true, effort: 6 })
    .toFile(dest);
}

const bg = await sampleCornerColor(srcPath);
console.log(`Background from splash_icon corner: rgb(${bg.r}, ${bg.g}, ${bg.b})`);

const padded = await buildPaddedForeground(bg);
await padded.clone().toFile(outAdaptive);
console.log(`Wrote ${outAdaptive}`);

const paddedBuffer = await padded.clone().png().toBuffer();
const splashBuffer = await sharp(srcPath).png().toBuffer();

for (const [folder, size] of Object.entries(FOREGROUND_SIZES)) {
  const dest = join(resDir, folder, 'ic_launcher_foreground.webp');
  await writeWebp(sharp(paddedBuffer), dest, size);
  console.log(`Wrote ${dest} (${size}x${size})`);
}

for (const [folder, size] of Object.entries(LEGACY_SIZES)) {
  const launcher = join(resDir, folder, 'ic_launcher.webp');
  const round = join(resDir, folder, 'ic_launcher_round.webp');
  await writeWebp(sharp(splashBuffer), launcher, size);
  await writeWebp(sharp(splashBuffer), round, size);
  console.log(`Wrote ${launcher} and round (${size}x${size})`);
}

console.log('\nDone. Adaptive foreground logo is confined to the inner 66% safe zone.');
