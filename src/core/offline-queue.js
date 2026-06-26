/**
 * offline-queue.js — طابور البيع بدون نت
 *
 * الفلسفة: لو فشل إرسال عملية بيع بسبب انقطاع نت (لا أي سبب آخر)، نخزّنها محلياً
 * بترتيبها الزمني، ونعرض على المستخدمة فاتورة محلية فورية (تجربة بيع لا تنقطع)،
 * ثم نزامن كل عملية بالترتيب نفسه فور رجوع النت — بنفس Edge Function الحالية
 * (complete-sale)، صفر تكرار منطق. كل عملية تُحذف من الطابور فقط بعد تأكيد نجاحها
 * فعلياً من السيرفر — لا حذف متفائل قبل التأكد.
 */

import { sb }      from './db.js';
import { CONFIG }  from '../config/constants.js';
import { Notify }  from './notify.js';

const QUEUE_KEY = 'hsb_offline_sale_queue';
let _syncing = false;

export const OfflineQueue = {

  // ── إضافة عملية بيع فاشلة (بسبب نت فقط) للطابور المحلي ──
  add(salePayload) {
    const queue = OfflineQueue._read();
    const entry = {
      localId:  'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      payload:  salePayload,
      queuedAt: Date.now(),
      attempts: 0,
    };
    queue.push(entry);
    OfflineQueue._write(queue);
    return entry;
  },

  // ── عدد العمليات المعلَّقة حالياً — تُستخدم لعرض شارة بالواجهة ──
  count() {
    return OfflineQueue._read().length;
  },

  _read() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },

  _write(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {}
    OfflineQueue._updateBadge(queue.length);
  },

  _updateBadge(count) {
    const badge = document.getElementById('qs-offline-badge');
    const countEl = document.getElementById('qs-offline-count');
    if (!badge) return;
    badge.style.display = count > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = count;
  },

  // ── مزامنة الطابور بالكامل، بالترتيب الزمني الصحيح، عملية تلو الأخرى ──
  // لا تُرسَل العمليات بالتوازي عمداً — الترتيب الزمني مهم لصحة حسابات المخزون والديون
  async sync() {
    if (_syncing) return; // منع تشغيل مزامنتين بالتوازي بالخطأ
    if (!navigator.onLine) return;

    const queue = OfflineQueue._read();
    if (!queue.length) return;

    _syncing = true;
    let syncedCount = 0;

    try {
      for (const entry of queue) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) break; // لا جلسة — نوقف المزامنة، نحاول لاحقاً

        try {
          const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/complete-sale?forceFunctionRegion=eu-central-1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify(entry.payload),
          });
          const json = await res.json();

          if (res.ok) {
            // نجحت — نحذفها من الطابور فوراً (تأكيد حقيقي من السيرفر، لا حذف متفائل)
            const remaining = OfflineQueue._read().filter(e => e.localId !== entry.localId);
            OfflineQueue._write(remaining);
            syncedCount++;
          } else {
            // فشل حقيقي من السيرفر (لا مشكلة شبكة) — مثل نفاد كمية المنتج فعلياً بين وقت
            // البيع المحلي ووقت المزامنة. نوقفها هنا، تحتاج مراجعة يدوية، لا حذف صامت لبيانات بيع حقيقية
            entry.attempts = (entry.attempts || 0) + 1;
            entry.lastError = json.error || 'فشل غير معروف';
            const updated = OfflineQueue._read().map(e => e.localId === entry.localId ? entry : e);
            OfflineQueue._write(updated);
            Notify.error('⚠️ فاتورة معلَّقة فشلت بالمزامنة: ' + entry.lastError + ' — تحتاج مراجعة');
            break; // نوقف الترتيب هنا لتجنّب مزامنة عمليات لاحقة قبل حل هذي، حفاظاً على الترتيب الصحيح
          }
        } catch (err) {
          // فشل شبكي وسط المزامنة نفسها (انقطع النت مجدداً أثناء المحاولة) — نوقف، نحاول بالمرة القادمة
          break;
        }
      }
    } finally {
      _syncing = false;
    }

    if (syncedCount > 0) {
      Notify.success(`✅ تمت مزامنة ${syncedCount} فاتورة معلَّقة بنجاح`);
    }
  },

  // ── بدء الاستماع لرجوع النت — يُستدعى مرة واحدة عند تحميل التطبيق ──
  init() {
    OfflineQueue._updateBadge(OfflineQueue.count()); // عرض فوري لو فيه طابور متبقٍ من جلسة سابقة
    window.addEventListener('online', () => OfflineQueue.sync());
    // محاولة أولى عند تحميل الصفحة لو كان فيه طابور متبقٍ من جلسة سابقة
    if (navigator.onLine) OfflineQueue.sync();
  },
};
