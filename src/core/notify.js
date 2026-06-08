/**
 * notify.js — User notification system
 * Single place for all user-facing messages
 */

let _timer = null;

const _show = (msg, type = '') => {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `show ${type}`.trim();
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), 3000);
};

export const Notify = {
  show:    (msg)  => _show(msg),
  success: (msg)  => _show('✅ ' + msg, 'success'),
  error:   (msg)  => _show('❌ ' + msg, 'error'),
  sync:    (msg)  => _show('🔄 ' + msg, 'sync'),
  warn:    (msg)  => _show('⚠️ ' + msg, 'warn'),
};
