/**
 * offline-queue.js — طابور العمليات بدون نت (بيع سريع + فاتورة جديدة + إضافة منتج)
 *
 * الفلسفة: لو فشل إرسال عملية بسبب انقطاع نت (لا أي سبب آخر)، نخزّنها محلياً بترتيبها
 * الزمني، ونعرض على المستخدمة نتيجة محلية فورية (تجربة لا تنقطع)، ثم نزامن كل عملية
 * بالترتيب نفسه فور رجوع النت — كل نوع يُرسَل بصيغته الحقيقية الصحيحة لخدمته الخاصة،
 * صفر تكرار منطق. كل عملية تُحذف من الطابور فقط بعد تأكيد نجاحها فعلياً من السيرفر.
 */

import { sb }      from './db.js';
import { CONFIG }  from '../config/constants.js';
import { Notify }  from './notify.js';

const QUEUE_KEY = 'hsb_offline_sale_queue';
let _syncing = false;

// ── خريطة: نوع العملية → طريقة الاستدعاء الصحيحة لخدمتها الحقيقية ──
// 'sale'/'invoice' تستدعيان Edge Function مخصَّصة (complete-sale/complete-invoice) بمنطق
// معقَّد (FIFO، خصم مخزون). 'inventory' تستدعي الطبقة العامة (inventory-db) بنفس صيغة
// insert البسيطة التي يستخدمها db.js نفسه — لا تكرار منطق، فقط استدعاء حقيقي مطابق
const ENDPOINT_BY_TYPE = {
  sale:      'complete-sale',
  invoice:   'complete-invoice',
  inventory: 'inventory-db',
};

export const OfflineQueue = {

  // ── إضافة عملية فاشلة (بسبب نت فقط) للطابور المحلي — type: 'sale'/'invoice'/'inventory' ──
  add(payload, type = 'sale') {
    const queue = OfflineQueue._read();
    const entry = {
      localId:  'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      type,
      payload,
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
      const queue = raw ? JSON.parse(raw) : [];
      // توافق مع طابور قديم لم يحمل type أصلاً (كل العمليات القديمة كانت بيعاً فقط)
      return queue.map(e => ({ type: e.type || 'sale', ...e }));
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

  // ── بناء جسم الطلب الصحيح حسب نوع العملية — كل نوع له صيغة مختلفة لخدمته الحقيقية ──
  _buildRequestBody(entry) {
    if (entry.type === 'inventory') {
      // نفس الصيغة التي يستخدمها db.js نفسه فعلياً عبر callInventoryDB('insert', { row })
      return JSON.stringify({ action: 'insert', params: { row: entry.payload } });
    }
    // sale/invoice ترسل الـpayload مباشرة كما هو، بنفس صيغة complete-sale/complete-invoice
    return JSON.stringify(entry.payload);
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

        const endpoint = ENDPOINT_BY_TYPE[entry.type] || ENDPOINT_BY_TYPE.sale;
        const regionParam = entry.type === 'sale' ? '?forceFunctionRegion=eu-central-1' : '';

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 ثانية — حد زمني صريح يمنع التعليق اللانهائي على شبكة متقطعة/بطيئة

          const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${endpoint}${regionParam}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: OfflineQueue._buildRequestBody(entry),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          const json = await res.json();

          if (res.ok) {
            // نجحت — نحذفها من الطابور فوراً (تأكيد حقيقي من السيرفر، لا حذف متفائل)
            const remaining = OfflineQueue._read().filter(e => e.localId !== entry.localId);
            OfflineQueue._write(remaining);
            syncedCount++;
          } else {
            // فشل حقيقي من السيرفر (لا مشكلة شبكة) — مثل باركود مكرر فعلياً بين وقت الإنشاء
            // المحلي ووقت المزامنة. نوقفها هنا، تحتاج مراجعة يدوية، لا حذف صامت لبيانات حقيقية
            entry.attempts = (entry.attempts || 0) + 1;
            entry.lastError = json.error || 'فشل غير معروف';
            const updated = OfflineQueue._read().map(e => e.localId === entry.localId ? entry : e);
            OfflineQueue._write(updated);
            const typeLabel = entry.type === 'invoice' ? 'فاتورة' : entry.type === 'inventory' ? 'منتج' : 'فاتورة بيع';
            Notify.error('⚠️ ' + typeLabel + ' معلَّق فشل بالمزامنة: ' + entry.lastError + ' — تحتاج مراجعة');
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
      Notify.success(`✅ تمت مزامنة ${syncedCount} عملية معلَّقة بنجاح`);
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
