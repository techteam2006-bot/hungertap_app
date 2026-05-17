/**
 * Ensures React Native Alert body is always a plain string (never [object Object]).
 */
export function toAlertMessage(value, fallback = 'Something went wrong. Please try again.') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Error) {
    const m = String(value.message || '').trim();
    return m || fallback;
  }
  if (Array.isArray(value)) {
    const parts = value.map((x) => toAlertMessage(x, '')).filter(Boolean);
    return parts.length ? parts.join('\n') : fallback;
  }
  if (typeof value === 'object') {
    if (typeof value.message === 'string' && value.message.trim()) {
      return value.message.trim();
    }
    if (typeof value.error === 'string' && value.error.trim()) {
      return value.error.trim();
    }
    if (value.error != null) {
      const inner = toAlertMessage(value.error, '');
      if (inner) return inner;
    }
    if (typeof value.msg === 'string' && value.msg.trim()) {
      return value.msg.trim();
    }
    try {
      const j = JSON.stringify(value);
      if (j && j !== '{}') {
        return j.length > 800 ? `${j.slice(0, 800)}…` : j;
      }
    } catch (_) {
      /* ignore */
    }
    return fallback;
  }
  return fallback;
}
