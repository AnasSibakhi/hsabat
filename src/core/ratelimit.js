/**
 * ratelimit.js — Client-side Rate Limiter
 * يمنع إرسال طلبات كثيرة في وقت قصير
 */

const _limits = new Map();

/**
 * checkRate — يتحقق من معدل الطلبات
 * @param {string} key — مفتاح العملية (مثل 'sell', 'save-debt')
 * @param {number} maxCalls — أقصى عدد طلبات
 * @param {number} windowMs — النافذة الزمنية بالميلي ثانية
 */
export function checkRate(key, maxCalls = 10, windowMs = 5000) {
  const now   = Date.now();
  const entry = _limits.get(key) || { calls: [], blocked: false };

  // احذف الطلبات القديمة خارج النافذة
  entry.calls = entry.calls.filter(t => now - t < windowMs);

  if (entry.calls.length >= maxCalls) {
    _limits.set(key, entry);
    return false; // محظور
  }

  entry.calls.push(now);
  _limits.set(key, entry);
  return true; // مسموح
}

/**
 * rateGuard — wrapper جاهز للاستخدام
 * @param {string} key
 * @param {Function} fn
 * @param {string} errorMsg
 */
export async function rateGuard(key, fn, errorMsg = 'الرجاء الانتظار قبل المحاولة مجدداً') {
  if (!checkRate(key)) {
    throw new Error(errorMsg);
  }
  return await fn();
}
