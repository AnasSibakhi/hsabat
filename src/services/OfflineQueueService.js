/**
 * OfflineQueueService.js
 * البنية الأساسية لنظام Offline-First — تبدأ بصفحة البيع السريع فقط
 *
 * المبدأ: عملية البيع تُكتب فوراً بقاعدة بيانات محلية (IndexedDB) بالجوال،
 * وتُعرض الفاتورة فوراً للمستخدم — يعمل حتى بدون نت تماماً.
 * كل عملية تُعلَّم "pending" وتدخل بطابور، ولما يرجع النت تتزامن تلقائياً مع Supabase.
 */

const DB_NAME    = 'hesabat-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'sync_queue'; // العمليات المعلّقة بانتظار المزامنة

let _dbInstance = null;

// ── فتح/إنشاء قاعدة IndexedDB المحلية ──
function _openDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'localId' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _dbInstance = e.target.result;
      resolve(_dbInstance);
    };

    req.onerror = () => reject(new Error('فشل فتح قاعدة البيانات المحلية: ' + req.error?.message));
  });
}

// ── توليد معرّف محلي فريد (مستقل عن السيرفر تماماً) ──
function _generateLocalId() {
  return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

export const OfflineQueueService = {

  // ═══════════════════════════════════════
  // كشف حالة الاتصال بالنت
  // ═══════════════════════════════════════
  isOnline() {
    return navigator.onLine;
  },

  // مراقبة تغيّر حالة الاتصال — تُستدعى دالة callback عند رجوع/فقدان النت
  watchConnection(onOnline, onOffline) {
    window.addEventListener('online',  () => onOnline?.());
    window.addEventListener('offline', () => onOffline?.());
  },

  // ═══════════════════════════════════════
  // إضافة عملية جديدة للطابور (يُستخدم وقت البيع بدون انتظار السيرفر)
  // ═══════════════════════════════════════
  async enqueue(type, payload) {
    const db = await _openDB();
    const localId = _generateLocalId();

    const record = {
      localId,
      type,                    // مثلاً: 'quicksale'
      payload,                 // كل بيانات العملية اللازمة لإعادة تنفيذها بالسيرفر
      status:    'pending',    // pending → syncing → synced | failed
      createdAt: Date.now(),
      attempts:  0,
      lastError: null,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      tx.objectStore(STORE_QUEUE).add(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror    = () => reject(new Error('فشل حفظ العملية محلياً: ' + tx.error?.message));
    });
  },

  // ═══════════════════════════════════════
  // تحديث حالة عملية موجودة بالطابور (بعد نجاح/فشل المزامنة)
  // ═══════════════════════════════════════
  async updateStatus(localId, status, extra = {}) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_QUEUE);
      const req   = store.get(localId);

      req.onsuccess = () => {
        const record = req.result;
        if (!record) { resolve(null); return; }
        Object.assign(record, { status, ...extra });
        store.put(record);
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(new Error('فشل تحديث حالة العملية: ' + tx.error?.message));
    });
  },

  // ═══════════════════════════════════════
  // جلب كل العمليات المعلّقة (pending أو failed) لإعادة المزامنة
  // ═══════════════════════════════════════
  async getPending() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_QUEUE);
      const req   = store.getAll();

      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter(r => r.status === 'pending' || r.status === 'failed'));
      };
      req.onerror = () => reject(new Error('فشل جلب العمليات المعلّقة: ' + req.error?.message));
    });
  },

  // عدد العمليات المعلّقة فقط (لعرض مؤشر بسيط بالواجهة)
  async getPendingCount() {
    const pending = await OfflineQueueService.getPending();
    return pending.length;
  },

  // ═══════════════════════════════════════
  // حذف عملية من الطابور بعد نجاح مزامنتها نهائياً
  // ═══════════════════════════════════════
  async remove(localId) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      tx.objectStore(STORE_QUEUE).delete(localId);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(new Error('فشل حذف العملية من الطابور: ' + tx.error?.message));
    });
  },

  // ═══════════════════════════════════════
  // معالجة كل العمليات المعلّقة بالطابور — تُستدعى تلقائياً عند رجوع النت
  // syncFn: دالة تأخذ سجل واحد من الطابور وتحاول مزامنته (مثل QuickSale._syncOne)
  // ═══════════════════════════════════════
  async processQueue(syncFn) {
    if (!OfflineQueueService.isOnline()) return { processed: 0, failed: 0 };
    if (OfflineQueueService._processing) return { processed: 0, failed: 0 }; // منع تشغيل متوازي مزدوج

    OfflineQueueService._processing = true;
    let processed = 0, failed = 0;

    try {
      const pending = await OfflineQueueService.getPending();
      // ترتيب زمني — الأقدم يُزامن أولاً (يحافظ على ترتيب أرقام الفواتير منطقياً)
      pending.sort((a, b) => a.createdAt - b.createdAt);

      for (const record of pending) {
        if (!OfflineQueueService.isOnline()) break; // النت انقطع وسط المعالجة — توقف فوراً
        try {
          await syncFn(record);
          processed++;
        } catch (err) {
          failed++;
          console.warn('[OfflineQueue] sync failed for', record.localId, err.message);
        }
      }
    } finally {
      OfflineQueueService._processing = false;
    }

    return { processed, failed };
  },

  _processing: false,
};
