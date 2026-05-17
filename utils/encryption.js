/**
 * QR / order token helpers.
 *
 * Prior versions used CryptoJS with a static passphrase; that is not secure (the key
 * ships in the app bundle). Do not reintroduce "encryption" on the client for security —
 * use Supabase RLS, signed tokens from an Edge Function, or HMAC verified server-side.
 */

/**
 * @param {string} orderId - Order UUID
 * @param {string} orderToken - Order token (e.g. display code)
 * @param {number} [timestamp]
 * @returns {string}
 */
export const generateQRValue = (orderId, orderToken, timestamp = Date.now()) => {
  return `ORDER:${orderToken}:${orderId}:${timestamp}`;
};

/**
 * @param {string} qrValue
 * @returns {object|null}
 */
export const parseQRValue = (qrValue) => {
  try {
    const parts = String(qrValue).split(':');
    if (parts.length >= 3) {
      return {
        type: parts[0],
        orderToken: parts[1],
        orderId: parts[2],
        timestamp: parts[3] ? parseInt(parts[3], 10) : null
      };
    }
    throw new Error('Invalid QR code format');
  } catch (error) {
    console.error('QR parsing error:', error);
    return null;
  }
};
