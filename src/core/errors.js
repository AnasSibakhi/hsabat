/**
 * errors.js — Global Error Handler
 * Error boundaries + logging لكل التطبيق
 */

import { Notify } from './notify.js';

// ── تسجيل الأخطاء (قابل للتوسع لـ Sentry لاحقاً) ──
// تسجيل دائم بـ localStorage — يبقى محفوظاً حتى لو توقف التطبيق بالكامل بعدها (خلاف console،
// الذي يُفقَد فوراً عند أي توقف فعلي). يمكن قراءته لاحقاً من نفس الجهاز عبر فتح أي صفحة من
// نفس الموقع وكتابة: localStorage.getItem('hsb_error_log') بأدوات المطوّر، أو من شاشة /debug
function logError(context, error) {
  const msg = error?.message || String(error);
  console.error(`[حسابات] ${context}:`, msg, error);

  try {
    const entry = {
      time: new Date().toISOString(),
      context,
      message: msg,
      stack: error?.stack || null,
      url: location.href,
      userAgent: navigator.userAgent,
    };
    const log = JSON.parse(localStorage.getItem('hsb_error_log') || '[]');
    log.push(entry);
    // نحتفظ بآخر 20 خطأ فقط — يكفي للتشخيص، لا يستهلك مساحة بلا حدود
    localStorage.setItem('hsb_error_log', JSON.stringify(log.slice(-20)));
  } catch {}

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
