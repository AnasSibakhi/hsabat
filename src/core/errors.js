/**
 * errors.js — Global Error Handler
 * Error boundaries + logging لكل التطبيق
 */

import { Notify } from './notify.js';

// ── تسجيل الأخطاء (قابل للتوسع لـ Sentry لاحقاً) ──
function logError(context, error) {
  const msg = error?.message || String(error);
  console.error(`[حسابات] ${context}:`, msg, error);

  // هنا تقدري تضيفي Sentry لاحقاً:
  // Sentry.captureException(error, { extra: { context } });
}

// ── Wrapper احترافي لكل الدوال الـ async ──
export async function safe(context, fn, fallback = null) {
  try {
    return await fn();
  } catch (error) {
    logError(context, error);

    // أخطاء الشبكة
    if (!navigator.onLine) {
      Notify.warn('لا يوجد اتصال بالإنترنت');
      return fallback;
    }

    // أخطاء الـ API
    if (error?.message?.includes('Missing store_id')) {
      Notify.error('انتهت الجلسة — أعد تسجيل الدخول');
      return fallback;
    }

    // أخطاء عامة
    Notify.error('حدث خطأ — حاول مجدداً');
    return fallback;
  }
}

// ── Global uncaught errors ──
window.addEventListener('unhandledrejection', event => {
  logError('unhandledrejection', event.reason);
  event.preventDefault();
});

window.addEventListener('error', event => {
  logError('uncaught', event.error);
});

// ── Network status ──
window.addEventListener('online',  () => Notify.success('عاد الاتصال بالإنترنت'));
window.addEventListener('offline', () => Notify.warn('انقطع الاتصال بالإنترنت'));
