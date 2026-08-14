import Constants from 'expo-constants';

/** Installed marketing version from app config (e.g. 1.0.1). */
export function getInstalledAppVersion() {
  return String(Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0').trim();
}

function parseVersionParts(version) {
  return String(version || '0')
    .trim()
    .split('.')
    .map((part) => {
      const n = parseInt(String(part).replace(/[^0-9].*$/, ''), 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * Semver-style numeric compare (major.minor.patch).
 * @returns {number} 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** True when installed is strictly below minimum (empty/0.0.0 minimum never blocks). */
export function isVersionBelowMinimum(installed, minimum) {
  const min = String(minimum || '').trim();
  if (!min || min === '0.0.0' || min === '0') return false;
  return compareVersions(installed, min) < 0;
}
