/**
 * FIFOService.js
 * خدمة FIFO — الآن تستدعي Edge Function آمنة بدل sbAdmin المباشر
 * نفس الواجهة العامة بالضبط (نفس أسماء الدوال والمعاملات) — لا حاجة لتعديل أي ملف آخر يستخدمها
 */

import { sb } from '../core/db.js';
import { CONFIG } from '../config/constants.js';

// استدعاء عام لأي عملية FIFO عبر الـ Edge Function
async function callFifoFunction(action, params) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('FIFO: غير مسجّل دخول');

  
  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/fifo-service`, {
    method: 'POST',
        signal: controller.signal,
    headers: {
      'Content-Type':  'application/json',
      'Authorization':  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, params }),
  });

  
  clearTimeout(timeoutId);

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'FIFO: فشل الاتصال بالخدمة');
  return json.data;
}

export const FIFOService = {

  async addBatch(params) {
    return callFifoFunction('addBatch', params);
  },

  async consumeFIFO(params) {
    return callFifoFunction('consumeFIFO', params);
  },

  async reverseFIFO(invoiceId) {
    return callFifoFunction('reverseFIFO', { invoiceId });
  },

  async estimateCost(productId, quantity) {
    return callFifoFunction('estimateCost', { productId, quantity });
  },

  async getBatches(productId) {
    return callFifoFunction('getBatches', { productId });
  },

  async getInventoryValue() {
    return callFifoFunction('getInventoryValue', {});
  },

  async removeBatchByPurchase(purchaseId, productId) {
    return callFifoFunction('removeBatchByPurchase', { purchaseId, productId });
  },

  async calculateCOGS(invoiceIds) {
    const result = await callFifoFunction('calculateCOGS', { invoiceIds });
    return result.totalCOGS;
  },
};
