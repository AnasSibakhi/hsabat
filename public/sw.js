const CACHE_VERSION = 'hesabat-v88-PRECACHE-' + '20260629ae';
const CACHE_VERSION = 'hesabat-v95-NAVFIX-' + '20260629al';
// ── Install: pre-cache الصفحة الرئيسية فقط (index.html) ──
// هذا يحل مشكلة Safari "can't open page" عند فتح الاختصار بدون نت — Safari يحتاج
// استجابة حقيقية (200 OK) لطلب navigate، و503 أو undefined يعرض شاشته الخاصة بدل
// الموقع. بتخزين index.html أثناء install، نضمن وجود نسخة حقيقية دائماً بالكاش
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(['/', '/index.html']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // CDN وخارجي — مباشرة للشبكة بدون تدخّل
  if (!e.request.url.startsWith(self.location.origin)) return;

  // ── Navigation requests (فتح الاختصار/الصفحة) — Cache-First ──
  // الأهم: لو الكاش يحتوي index.html (محفوظة أثناء install)، نُرجعها فوراً بدون شبكة.
  // هذا يجعل الموقع يفتح حتى بدون نت كامل، ثم JS يقرر ما يعرضه (offline boot أو login)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('/index.html').then(cached => {
        if (cached) {
          // يوجد كاش — أرجعه فوراً وجدّده بالخلفية
          fetch(e.request).then(res => {
            if (res && res.ok) caches.open(CACHE_VERSION).then(c => c.put('/index.html', res)).catch(() => {});
          }).catch(() => {});
          return cached;
        }
        // لا كاش — حاول الشبكة
        return fetch(e.request).catch(() =>
          new Response(
            '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>حسابات</title><style>body{font-family:sans-serif;text-align:center;' +
            'padding:60px 20px;background:#f8fafc;color:#1e293b;}h2{margin-bottom:12px;}' +
            'button{padding:12px 28px;font-size:15px;background:#6366f1;color:#fff;' +
            'border:none;border-radius:10px;cursor:pointer;}</style></head>' +
            '<body><h2>لا يوجد اتصال</h2><p>تحققي من النت وحاولي مجدداً</p>' +
            '<button onclick="location.reload()">إعادة المحاولة</button></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        );
      })
    );
    return;
  }

  // ── باقي الموارد (JS، CSS، أيقونات) — Network-First مع Cache Fallback ──
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(cached => cached || new Response('', { status: 503 })))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
