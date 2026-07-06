/**
 * Ensures React Native Alert body is always a plain, user-friendly string.
 * Never exposes raw JSON, HTTP codes, or internal server messages.
 */
export function toAlertMessage(value, fallback = 'Something went wrong. Please try again.') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return fallback;
  }
  if (value instanceof Error) {
    return fallback;
  }
  if (Array.isArray(value)) {
    const parts = value.map((x) => toAlertMessage(x, '')).filter(Boolean);
    return parts.length ? parts.join('\n') : fallback;
  }
  return fallback;
}
