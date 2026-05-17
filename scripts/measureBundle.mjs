/**
 * Export the Android JS bundle + assets and print size breakdown + APK estimates.
 * Usage: npm run measure-bundle
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outRel = 'dist/measure-bundle';
const outDir = join(root, outRel);

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push({ path: p, size: st.size });
  }
  return acc;
}

function sum(files) {
  return files.reduce((n, f) => n + f.size, 0);
}

function estimateApk(hbcBytes, assetBytes) {
  const jsInApk = Math.round(hbcBytes * 0.55);
  const assetsInApk = Math.round(assetBytes * 0.85);
  const nativeArm64 = 42 * 1024 * 1024;
  const low = jsInApk + assetsInApk + nativeArm64 - 5 * 1024 * 1024;
  const high = jsInApk + assetsInApk + nativeArm64 + 18 * 1024 * 1024;
  const playLow = Math.round(low * 0.72);
  const playHigh = Math.round(high * 0.78);
  return { low, high, playLow, playHigh };
}

console.log('\n[HungerTap] measure-bundle — Android export + size report\n');

if (!existsSync(join(root, 'node_modules'))) {
  console.error('Run npm install first.\n');
  process.exit(1);
}

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

console.log('Exporting (npx expo export --platform android)…\n');
const exportRun = spawnSync(
  `npx expo export --platform android --output-dir "${outRel.replace(/"/g, '')}"`,
  { cwd: root, stdio: 'inherit', shell: true, env: process.env }
);

if (exportRun.status !== 0) {
  console.error('\nExport failed.\n');
  process.exit(exportRun.status ?? 1);
}

const allFiles = walkFiles(outDir);
const hbcFiles = allFiles.filter((f) => f.path.endsWith('.hbc'));
const hbcTotal = sum(hbcFiles);
const hashedAssetsDir = join(outDir, 'assets');
const hashedAssets = walkFiles(hashedAssetsDir);
const assetsTotal = sum(hashedAssets);
const exportTotal = sum(allFiles);

let ttfBytes = 0;
let imageBytes = 0;
const metaPath = join(outDir, 'metadata.json');
if (existsSync(metaPath)) {
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const listed = meta?.fileMetadata?.android?.assets || [];
    const sizeByHash = new Map(
      hashedAssets.map((f) => {
        const base = f.path.split(/[/\\]/).pop();
        return [base, f.size];
      })
    );
    for (const a of listed) {
      const hash = String(a.path || '').split(/[/\\]/).pop();
      const sz = sizeByHash.get(hash) || 0;
      if (a.ext === 'ttf') ttfBytes += sz;
      else imageBytes += sz;
    }
  } catch (_) {
    ttfBytes = sum(hashedAssets.filter((f) => f.size > 200 * 1024));
    imageBytes = assetsTotal - ttfBytes;
  }
} else {
  imageBytes = assetsTotal;
}

console.log('\n── Export summary ──────────────────────────────────');
console.log(`Output folder:     dist/measure-bundle`);
console.log(`Total export:      ${fmt(exportTotal)}`);
console.log(`Hermes (.hbc):     ${fmt(hbcTotal)}`);
console.log(`Hashed assets:     ${fmt(assetsTotal)}`);
console.log(`  Fonts (.ttf):    ${fmt(ttfBytes)}`);
console.log(`  Images/other:    ${fmt(imageBytes)}`);

const { low, high, playLow, playHigh } = estimateApk(hbcTotal, assetsTotal);
console.log('\n── APK estimates (arm64-v8a only, release) ─────────');
console.log(`Preview APK file:     ~${fmt(low)} – ${fmt(high)}`);
console.log(`Play download (typ.): ~${fmt(playLow)} – ${fmt(playHigh)}`);
console.log('\nNative layer is estimated (~42 MB baseline + WebView/notifications).');
console.log('Exact size: eas build --platform android --profile preview\n');
console.log('Tips: trim unused @expo/vector-icons fonts; build with production profile for AAB.\n');
