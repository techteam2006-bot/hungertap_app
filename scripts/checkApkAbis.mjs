/**
 * Assert every ABI in a built APK/AAB ships the same set of native libraries.
 *
 * Why this exists: `reactNativeArchitectures` in android/gradle.properties controls
 * which ABIs get libraries built from source (expo-modules-core, react-native-screens).
 * Prebuilt AARs still ship all four ABIs, so a narrowed list produces an artifact that
 * looks complete — lib/armeabi-v7a/ exists and is full of .so files — but is silently
 * missing the ones built from source. Those devices then die at launch with
 * SoLoader "couldn't find DSO to load: libexpo-modules-core.so", which happens before
 * Sentry's JS init runs and is therefore invisible in crash reporting.
 *
 * Usage:
 *   npm run check-abis                 # auto-discovers release/debug APK + AAB
 *   node scripts/checkApkAbis.mjs <path-to.apk|.aab> [more...]
 *
 * Exits non-zero when an ABI is incomplete, so it can gate CI / a release build.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Libraries that must exist in every ABI. These are the ones built from source by the
// RN/Expo gradle plugins, i.e. the ones `reactNativeArchitectures` can silently drop.
const REQUIRED = ['libexpo-modules-core.so', 'librnscreens.so'];

// ABIs a minSdk-24 Android build is expected to serve.
const EXPECTED_ABIS = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];

const DEFAULT_TARGETS = [
  'android/app/build/outputs/apk/release/app-release.apk',
  'android/app/build/outputs/apk/debug/app-debug.apk',
  'android/app/build/outputs/bundle/release/app-release.aab',
];

/** Read the filenames out of a zip's central directory. Names only — no inflation. */
function listZipEntries(file) {
  const buf = readFileSync(file);

  // Locate End Of Central Directory (0x06054b50), scanning back over the comment field.
  let eocd = -1;
  const floor = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`not a zip archive: ${file}`);

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: sentinel values mean the real numbers live in the ZIP64 EOCD record.
  if (cdOffset === 0xffffffff || count === 0xffff) {
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) {
        loc = i;
        break;
      }
    }
    if (loc === -1) throw new Error(`zip64 locator not found: ${file}`);
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new Error(`bad zip64 EOCD: ${file}`);
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // central directory header
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Map ABI -> Set(lib filenames). Handles APK (lib/<abi>/) and AAB (base/lib/<abi>/). */
function collectAbis(names) {
  const abis = new Map();
  for (const name of names) {
    const m = name.match(/(?:^|\/)lib\/([^/]+)\/([^/]+\.so)$/);
    if (!m) continue;
    const [, abi, lib] = m;
    if (!abis.has(abi)) abis.set(abi, new Set());
    abis.get(abi).add(lib);
  }
  return abis;
}

function checkArtifact(file) {
  const abis = collectAbis(listZipEntries(file));
  const rel = relative(root, file) || file;

  console.log(`\n${rel}  (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);

  if (abis.size === 0) {
    console.log('  no native libraries found — skipping');
    return [];
  }

  // Union across ABIs is the reference set: whatever the richest ABI has, all should have.
  const union = new Set();
  for (const libs of abis.values()) for (const l of libs) union.add(l);

  const problems = [];

  for (const abi of [...abis.keys()].sort()) {
    const libs = abis.get(abi);
    const missingRequired = REQUIRED.filter((l) => !libs.has(l));
    const missingVsUnion = [...union].filter((l) => !libs.has(l)).sort();

    if (missingRequired.length === 0 && missingVsUnion.length === 0) {
      console.log(`  ✅ ${abi.padEnd(12)} ${libs.size} libs`);
      continue;
    }

    console.log(`  ❌ ${abi.padEnd(12)} ${libs.size} libs`);
    if (missingRequired.length) {
      console.log(`       missing REQUIRED: ${missingRequired.join(', ')}`);
      problems.push(`${rel}: ${abi} is missing ${missingRequired.join(', ')}`);
    }
    const extra = missingVsUnion.filter((l) => !missingRequired.includes(l));
    if (extra.length) {
      console.log(`       missing vs other ABIs: ${extra.join(', ')}`);
      if (!missingRequired.length) {
        problems.push(`${rel}: ${abi} is missing ${extra.join(', ')} (present in other ABIs)`);
      }
    }
  }

  const absentAbis = EXPECTED_ABIS.filter((a) => !abis.has(a));
  if (absentAbis.length) {
    console.log(`  ⚠️  no lib/ directory at all for: ${absentAbis.join(', ')}`);
    problems.push(`${rel}: no native libraries for ${absentAbis.join(', ')}`);
  }

  return problems;
}

const args = process.argv.slice(2);
const targets = (args.length ? args : DEFAULT_TARGETS.map((p) => join(root, p))).filter((p) => {
  if (existsSync(p)) return true;
  if (args.length) {
    console.error(`not found: ${p}`);
    process.exit(2);
  }
  return false;
});

if (targets.length === 0) {
  console.error('No built APK/AAB found. Build one first, e.g. npm run build:apk:local');
  process.exit(2);
}

const allProblems = targets.flatMap(checkArtifact);

if (allProblems.length) {
  console.error('\nABI CHECK FAILED\n');
  for (const p of allProblems) console.error(`  - ${p}`);
  console.error(
    '\nFix: set reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64 in' +
      '\nandroid/gradle.properties, then rebuild clean (gradlew clean assembleRelease).\n'
  );
  process.exit(1);
}

console.log('\nABI check passed — every ABI ships the full native library set.\n');
