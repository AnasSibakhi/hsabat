/**
 * ratelimit.js — Global Submit Guard + Rate Limiter
 * يمنع تكرار البيانات في كل الموقع
 * 
 * الاستخدام في HTML:
 *   onclick="Guard.run('save-debt', () => Debts.save(), this)"
 */

// ── Global Submit Guard ──
const _active = new Set();

export const Guard = {
  /**
   * run — ينفذ الدالة مرة واحدة فقط حتى تنتهي
   * @param {string} key   — مفتاح العملية
   * @param {Function} fn  — الدالة المراد تنفيذها
   * @param {HTMLElement} btn — الزر (اختياري)
   */
  async run(key, fn, btn = null) {
    if (_active.has(key)) return; // مشغول — تجاهل
    _active.add(key);

    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'جاري...'; }

    try {
      return await fn();
    } finally {
      _active.delete(key);
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },

  isRunning: (key) => _active.has(key),
};

// ── Rate Limiter ──
const _limits = new Map();

export function checkRate(key, maxCalls = 10, windowMs = 5000) {
  const now   = Date.now();
  const entry = _limits.get(key) || { calls: [] };
  entry.calls = entry.calls.filter(t => now - t < windowMs);
  if (entry.calls.length >= maxCalls) { _limits.set(key, entry); return false; }
  entry.calls.push(now);
  _limits.set(key, entry);
  return true;
}

export async function rateGuard(key, fn, errorMsg = 'الرجاء الانتظار قبل المحاولة مجدداً') {
  if (!checkRate(key)) throw new Error(errorMsg);
  return await fn();
}
