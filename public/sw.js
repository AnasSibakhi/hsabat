// نسخة الكاش — لازم تتغيّر مع كل نشر جديد لضمان وصول التحديثات فوراً
const CACHE_VERSION = 'hesabat-v75-FORCEUNREG-' + '20260629p';

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
  // السبب الجذري لتعطّل/توقّف PWA المتكرر على Android — Cache.put() ترفض رياضياً وقاطعاً أي
  // طلب غير GET (يرمي TypeError حقيقي: "Request method 'POST' is unsupported")، وهذا يحصل
  // بكل عملية بيع/إضافة منتج (كل استدعاءات complete-sale، inventory-db، إلخ كلها POST)،
  // فاستثناء JS غير مُعالَج يتكرر بكل عملية بالموقع بداخل Service Worker نفسه. لا نحاول
  // تخزين أي شي سوى طلبات GET على الإطلاق — طلبات POST تمر مباشرة للشبكة بدون أي تخزين محاوَل
  if (e.request.method !== 'GET') {
    return; // نترك المتصفح يتعامل معها طبيعياً، صفر تدخّل من Service Worker لغير GET
  }

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
