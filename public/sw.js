// نسخة الكاش — لازم تتغيّر مع كل نشر جديد لضمان وصول التحديثات فوراً
// (السبب الجذري للمشكلة السابقة: الاسم كان ثابتاً "hesabat-v1" فلا يعتبر المتصفح أي نشر تحديثاً حقيقياً)
const CACHE_VERSION = 'hesabat-v10-' + '20260626i';
const ASSETS = ['/', '/pos.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting(); // فعّل النسخة الجديدة فوراً بدون انتظار إغلاق كل التابات القديمة
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // تحكّم فوري بكل التابات المفتوحة بدون إعادة تحميل يدوي
  );
});

self.addEventListener('fetch', e => {
  // Network-first مع تحديث فعلي للكاش — لو نجحت الشبكة، نحدّث الكاش بالنسخة الجديدة لحظياً
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // خزّن نسخة من أي رد ناجح بالكاش الحالي (يضمن تحديث مستمر بدل تجميد قديم)
        // ملاحظة: الموارد من نطاقات خارجية بدون CORS صريح (خطوط Google، أيقونات CDN) تُرجِع
        // status:0 مع type:'opaque' حتى عند النجاح الحقيقي — الفحص السابق status===200 كان
        // يرفضها بصمت من التخزين رغم نجاح التحميل فعلياً، فتبقى غير متاحة عند انقطاع النت
        const looksOk = response && (response.ok || response.type === 'opaque');
        if (looksOk) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(e.request)) // فقط عند فشل الشبكة فعلياً (بدون نت) نرجع للكاش
  );
});

// السماح بالتحديث الفوري من main.js عند اكتشاف نسخة جديدة (بدون انتظار إغلاق كل التابات)
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
