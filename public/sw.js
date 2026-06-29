// نسخة الكاش — لازم تتغيّر مع كل نشر جديد لضمان وصول التحديثات فوراً
const CACHE_VERSION = 'hesabat-v76-NEVERUNDEFINED-' + '20260629q';

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
  // السبب الجذري الأول لتعطّل/توقّف PWA المتكرر على Android — Cache.put() ترفض رياضياً وقاطعاً
  // أي طلب غير GET (يرمي TypeError حقيقي: "Request method 'POST' is unsupported")، وهذا يحصل
  // بكل عملية بيع/إضافة منتج بالموقع كله. لا نحاول تخزين أي شي سوى طلبات GET على الإطلاق
  if (e.request.method !== 'GET') {
    return; // نترك المتصفح يتعامل معها طبيعياً، صفر تدخّل من Service Worker لغير GET
  }

  // السبب الجذري الثاني والأهم، مؤكَّد رسمياً بمواصفة W3C نفسها: لو فشلت الشبكة (شائع جداً
  // عند فتح اختصار PWA من شاشة باردة، قبل استقرار الاتصال) و caches.match() ترجع undefined
  // (الكاش فاضٍ تماماً، حالة "أول فتح بعد إعادة تثبيت اختصار جديد")، فإن respondWith(undefined)
  // يُعامَل رسمياً كـ"NetworkError" حقيقي — يعني فشل تحميل الصفحة بالكامل، يطابق بدقة "توقف
  // كلي خارج المتصفح". الحل: نضمن دائماً إرجاع Response حقيقية، حتى لو رسالة خطأ بسيطة بدل
  // undefined أبداً، تحت أي ظرف
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
      .catch(() =>
        caches.match(e.request).then(cached => {
          if (cached) return cached;
          // صفر كاش وصفر شبكة — نُرجع استجابة حقيقية دائماً، لا undefined أبداً تحت أي ظرف
          if (e.request.mode === 'navigate') {
            return new Response(
              '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>حسابات</title></head><body style="font-family:sans-serif;text-align:center;padding:40px 20px;"><h2>لا يوجد اتصال بالإنترنت</h2><p>تحققي من الاتصال وحاولي مرة أخرى</p><button onclick="location.reload()" style="padding:10px 24px;font-size:16px;">إعادة المحاولة</button></body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
          return new Response('', { status: 503 });
        })
      )
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
