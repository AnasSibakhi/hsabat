/**
 * ratelimit.js — Global Submit Guard + Rate Limiter
 * يمنع تكرار البيانات في كل الموقع
 *
 * الاستخدام في HTML:
 *   onclick="Guard.run('save-debt', () => Debts.save(), this)"
 */

const _active = new Set();
const HARD_TIMEOUT = 15000; // أمان: لو علقت أي عملية أكثر من 15 ثانية، حررها تلقائياً

export const Guard = {
  async run(key, fn, btn = null) {
    if (_active.has(key)) return; // مشغول فعلاً — تجاهل
    _active.add(key);

    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'جاري...'; }

    // أمان من التعليق الدائم — لو حصل خطأ غير متوقع ما يقفل الزر للأبد
    const safety = setTimeout(() => {
      _active.delete(key);
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }, HARD_TIMEOUT);

    try {
      return await fn();
    } finally {
      clearTimeout(safety);
      _active.delete(key);
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },

  // تحرير يدوي فوري — يُستخدم بعد إغلاق/فتح modal بسبب الكاميرا
  release(key) {
    _active.delete(key);
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
