/**
 * QR Code Service
 * Barcode / QR display uses `order.id` and `order_token` from your backend; verify pickup in kitchen using RLS-protected data.
 */

import { parseQRValue } from '../utils/encryption';

export const QRCodeService = {
  /**
   * @param {string} orderId
   * @param {string} orderToken
   * @returns {Promise<{data: string|null, error: any}>}
   */
  async generateAndStoreQRCode(orderId, orderToken) {
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log(' Barcode = order.id for order:', orderId);
      }
      return { data: orderId, error: null };
    } catch (error) {
      console.error('Exception in generateAndStoreQRCode:', error);
      return { data: orderId || orderToken, error: null };
    }
  },

  /**
   * Display value for scanning (order UUID / barcode)
   * @param {string} orderId
   * @returns {Promise<{data: string|null, error: any}>}
   */
  async getEncryptedQRCode(orderId) {
    try {
      if (!orderId) {
        return { data: null, error: 'Order ID is required' };
      }
      return { data: orderId, error: null };
    } catch (error) {
      console.error('Exception in getEncryptedQRCode:', error);
      return { data: null, error: error.message || 'Failed to get barcode' };
    }
  },

  /**
   * Value shown to the user / encoded in the QR component (not AES — see utils/encryption.js)
   * @param {string} orderId
   * @returns {Promise<{data: string|null, error: any}>}
   */
  async getDecryptedQRCode(orderId) {
    try {
      const { data, error: fetchError } = await this.getEncryptedQRCode(orderId);
      if (fetchError || !data) {
        return { data: null, error: fetchError || 'QR code not found' };
      }
      return { data, error: null };
    } catch (error) {
      console.error('Exception in getDecryptedQRCode:', error);
      return { data: null, error: error.message || 'Failed to get QR value' };
    }
  },

  /**
   * @param {Array<{id: string, order_token: string}>} orders
   */
  async batchGenerateQRCodes(orders) {
    const results = { success: 0, failed: 0, errors: [] };
    for (const order of orders) {
      const { error } = await this.generateAndStoreQRCode(order.id, order.order_token);
      if (error) {
        results.failed++;
        results.errors.push({ orderId: order.id, error });
      } else {
        results.success++;
      }
    }
    return results;
  },

  async regenerateQRCode(orderId, orderToken) {
    return this.generateAndStoreQRCode(orderId, orderToken);
  },

  /**
   * @param {string} qrOrToken - Raw barcode string, `ORDER:...` payload, or order id
   * @param {string} orderId
   * @returns {Promise<{valid: boolean, error: any}>}
   */
  async verifyQRCode(qrOrToken, orderId) {
    try {
      if (!qrOrToken || !orderId) {
        return { valid: false, error: 'Missing QR value or order id' };
      }
      const s = String(qrOrToken);
      const want = String(orderId);
      if (s === want) {
        return { valid: true, error: null };
      }
      const parsed = parseQRValue(s);
      if (parsed && (parsed.orderId === want || s.includes(want))) {
        return { valid: true, error: null };
      }
      return { valid: s.includes(want), error: null };
    } catch (error) {
      console.error('Exception in verifyQRCode:', error);
      return { valid: false, error: error.message || 'Failed to verify QR code' };
    }
  }
};

export default QRCodeService;
