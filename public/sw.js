// نسخة الكاش — لازم تتغيّر مع كل نشر جديد لضمان وصول التحديثات فوراً
const CACHE_VERSION = 'hesabat-v72-' + '20260629m';

self.addEventListener('install', e => {
  self.skipWaiting(); // فعّل النسخة الجديدة فوراً بدون انتظار إغلاق كل التابات القديمة
});

self.addEventListener('activate', e => {
  e.waitUntil(
    // حذف قاطع لكل كاش قديم بأي اسم سابق — يضمن صفر أثر لأي نسخة معطوبة محتملة من تحديثات سابقة
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim()) // تحكّم فوري بكل التابات المفتوحة بدون إعادة تحميل يدوي
  );
});

self.addEventListener('fetch', e => {
  // Network-first بسيط — نخزّن فقط بعد نجاح الشبكة، نرجع للكاش فقط عند فشل الشبكة الحقيقي.
  // لا تخزين أثناء install، صفر تعقيد إضافي — يقلل احتمالات أي سباق أو تلف بالتخزين
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const looksOk = response && (response.ok || response.type === 'opaque');
        if (looksOk) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
