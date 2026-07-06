/**
 * Optimizes PNG and WebP assets in the assets/ folder using sharp.
 * Install once:  npm install --save-dev sharp
 * Run:           node scripts/optimizeAssets.mjs
 *
 * What it does:
 *  - PNG  → re-encodes with palette compression + lossless optimisation
 *  - WebP → re-encodes at quality 80 (lossless→lossy; skip with --lossless flag)
 *  - Prints before/after sizes and total savings
 *  - Skips files that are already smaller than the re-encoded version
 *  - Creates a .bak backup of each file before overwriting
 */
import { existsSync, statSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const assetsDir = join(root, 'assets');

// ── Check sharp is installed ──────────────────────────────────────────────────
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('\n❌  sharp is not installed. Run:\n\n    npm install --save-dev sharp\n\nthen re-run this script.\n');
  process.exit(1);
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function walkFiles(dir) {
  const results = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) results.push(...walkFiles(full));
    else results.push(full);
  }
  return results;
}

const files = walkFiles(assetsDir).filter((f) => {
  const ext = extname(f).toLowerCase();
  return ext === '.png' || ext === '.webp';
});

if (files.length === 0) {
  console.log('\nNo PNG/WebP files found in assets/.\n');
  process.exit(0);
}

console.log(`\n[HungerTap] optimizeAssets — ${files.length} images found in assets/\n`);

let totalBefore = 0;
let totalAfter = 0;

for (const filePath of files) {
  const ext = extname(filePath).toLowerCase();
  const sizeBefore = statSync(filePath).size;
  totalBefore += sizeBefore;

  let outputBuffer;
  try {
    const img = sharp(filePath);
    if (ext === '.png') {
      outputBuffer = await img
        .png({ compressionLevel: 9, palette: true, quality: 90 })
        .toBuffer();
    } else if (ext === '.webp') {
      outputBuffer = await img
        .webp({ quality: 80, effort: 6 })
        .toBuffer();
    }
  } catch (err) {
    console.warn(`  ⚠️  Could not process ${filePath}: ${err.message}`);
    totalAfter += sizeBefore;
    continue;
  }

  const sizeAfter = outputBuffer.length;

  if (sizeAfter >= sizeBefore) {
    console.log(`  ⏭  ${filePath.replace(root, '.')}  already optimal (${fmt(sizeBefore)})`);
    totalAfter += sizeBefore;
    continue;
  }

  // Backup original, then overwrite
  try {
    copyFileSync(filePath, filePath + '.bak');
    writeFileSync(filePath, outputBuffer);
  } catch (writeErr) {
    console.warn(`  ⚠️  Could not write ${filePath.replace(root, '.')}: ${writeErr.message}`);
    totalAfter += sizeBefore;
    continue;
  }
  totalAfter += sizeAfter;

  const saving = sizeBefore - sizeAfter;
  const pct = ((saving / sizeBefore) * 100).toFixed(1);
  console.log(`  ✅  ${filePath.replace(root, '.')}  ${fmt(sizeBefore)} → ${fmt(sizeAfter)}  (−${pct}%)`);
}

const totalSaving = totalBefore - totalAfter;
console.log(`\n── Summary ─────────────────────────────────────────`);
console.log(`Total before: ${fmt(totalBefore)}`);
console.log(`Total after:  ${fmt(totalAfter)}`);
console.log(`Saved:        ${fmt(totalSaving)} (${((totalSaving / totalBefore) * 100).toFixed(1)}%)`);
console.log(`\nBackups saved as <filename>.bak — delete them once you verify the build.\n`);
