/**
 * store-boot.js — Store App Bootstrap
 * Initializes the store UI after successful login
 */

import { State }    from '../core/state.js';
import { ROLES }    from '../config/constants.js';
import * as DOM     from '../core/dom.js';
import * as Nav     from './nav.js';
import { Realtime } from './realtime.js';
import { sb }       from '../core/db.js';
import { CONFIG }   from '../config/constants.js';
import { Notify }   from '../core/notify.js';

// Module imports
import { Dashboard }     from '../modules/dashboard.js';
import { Customers }     from '../modules/customers.js';
import { Debts }         from '../modules/debts.js';
import { Notifications } from '../modules/notifications.js';
import { Invoices }   from '../modules/invoices.js';
import { Sales }      from '../modules/sales.js';
import { Inventory }  from '../modules/inventory.js';
import { Expenses }   from '../modules/expenses.js';
import { QuickSale }  from '../modules/quicksale.js';
// Purchases, NetCards, Returns, Reports — تحميل كسول (lazy) عند أول دخول فعلي لهذي الصفحات
// تحديداً، يقلل وزن التحميل الأولي للموقع دون أي تأثير على وظائفها (تبقى كاملة 100% بعد التحميل)
let _Purchases = null, _NetCards = null, _Returns = null, _Reports = null;
let _pPurchases = null, _pNetCards = null, _pReturns = null, _pReports = null;
// نضمن استيراداً واحداً فقط حتى لو استُدعيت الدالة مرات متعددة بسرعة (مثلاً ضغطة مزدوجة سريعة
// على الزر قبل اكتمال أول تحميل) — كل الاستدعاءات تنتظر نفس الـ Promise الجاري بدل بدء استيراد جديد
async function _loadPurchases() { if (_Purchases) return _Purchases; if (!_pPurchases) _pPurchases = import('../modules/purchases.js'); _Purchases = (await _pPurchases).Purchases; window.Purchases = _Purchases; return _Purchases; }
async function _loadNetCards()  { if (_NetCards)  return _NetCards;  if (!_pNetCards)  _pNetCards  = import('../modules/netcards.js');  _NetCards  = (await _pNetCards).NetCards;   window.NetCards  = _NetCards;  return _NetCards; }
async function _loadReturns()   { if (_Returns) return _Returns; if (window.Returns) { _Returns = window.Returns; return _Returns; } if (!_pReturns)   _pReturns   = import('../modules/returns.js');   _Returns   = (await _pReturns).Returns;     window.Returns   = _Returns;   return _Returns; }
async function _loadReports()   { if (_Reports) return _Reports; if (window.Reports) { _Reports = window.Reports; return _Reports; } if (!_pReports)   _pReports   = import('../modules/reports.js');   _Reports   = (await _pReports).Reports;     window.Reports   = _Reports;   return _Reports; }

export const Store = {

  // ── Pre-load ذكي لكل الصفحات — يُملأ الكاش مرة واحدة عند الإقلاع ──
  // يستدعي نفس الطلبات التي ستستدعيها كل صفحة عند فتحها، بنفس الـparams بالضبط
  // لضمان تطابق مفاتيح الكاش (SWR يبحث بالـhash عن params مطابقة تماماً)
  // الطلبات كلها بالتوازي (Promise.all) — أسرع ما يمكن، وكلها بدون await بالخارج
  // ── render فوري من State — صفر شبكة ──
  // شرط أساسي: State._loadedForStore يجب أن يطابق المحل الحالي
  // هذا يمنع عرض بيانات محل قديم عند تسجيل دخول محل جديد
  _renderPage(page, module = null) {
    requestAnimationFrame(() => {
      // لو البيانات المحفوظة لمحل مختلف عن الحالي — نجلب من السيرفر مباشرة
      const dataReady = Store._loadedForStore === State.user?.id;

      switch (page) {
        case 'home':
          Dashboard.load();
          break;
        case 'inventory':
          if (dataReady && State.inventory?.length) Inventory._renderList(State.inventory);
          else Inventory.load();
          break;
        case 'customers':
          if (dataReady && Customers._allData) {
            Customers._renderUnified(Customers._allData.customers, Customers._allData.debts);
          } else Customers.loadUnified();
          break;
        case 'debts':
          Debts.load();
          break;
        case 'invoices':
          if (dataReady) Invoices.applyFilters();
          else Invoices.load();
          break;
        case 'sales':
          Sales.load('day');
          break;
        case 'expenses':
          Expenses.load();
          break;
        case 'purchases':
          if (module) module.load();
          break;
      }
    });
  },

  _loadedForStore: null, // ID المحل الذي جُلبت بياناته فعلياً

  // ── تحديث دوري بالخلفية — كل 3 دقائق، لا عند كل تنقّل ──
  // ID محفوظ لإلغائه عند تسجيل الخروج — يمنع تراكم intervals لو تكرّر login/logout
  _periodicRefreshId: null,

  _startPeriodicRefresh() {
    // إلغاء أي interval سابق قبل بدء جديد — حماية من التراكم
    if (Store._periodicRefreshId) {
      clearInterval(Store._periodicRefreshId);
      Store._periodicRefreshId = null;
    }
    const refresh = () => {
      const page = State.currentPage;
      if (page === 'inventory')  Inventory.loadList().then(() => {
        if (State.currentPage === 'inventory') requestAnimationFrame(() => Inventory._renderList(State.inventory));
      }).catch(() => {});
      if (page === 'customers')  Customers.loadUnified().catch(() => {});
      if (page === 'debts')      Debts.load().catch(() => {});
      if (page === 'invoices')   Invoices.load().catch(() => {});
      if (page === 'home')       Dashboard.load().catch(() => {});
      if (page === 'expenses')   Expenses.load().catch(() => {});
    };
    Store._periodicRefreshId = setInterval(refresh, 3 * 60 * 1000);
  },

  _stopPeriodicRefresh() {
    if (Store._periodicRefreshId) {
      clearInterval(Store._periodicRefreshId);
      Store._periodicRefreshId = null;
    }
  },

  _preloadAllPages() {
    const wrap = fn => fn().catch(() => {});
    return Promise.all([
      // الرئيسية + البيع السريع + المخزون
      wrap(() => Inventory.loadList()),
      // الزبائن
      wrap(() => Customers.loadAll()),
      // الديون
      wrap(() => Debts.loadBadge()),
      // الرئيسية
      wrap(() => Dashboard.load()),
      // الفواتير — تحتاج 3 طلبات (invoices + returns + debts) فنُحمّلها مسبقاً
      wrap(() => Invoices.load()),
    ]);
    // صفحات ثانوية — نُحمّل ملفاتها JS مسبقاً بعد ثانيتين (بدون تشغيل load)
    // هذا يحذف تأخير "تحميل ملف JS" عند أول دخول للصفحة، ويُبقي أولوية للصفحات الرئيسية
    setTimeout(async () => {
      // pre-import فقط — يُخزّن الملف بكاش المتصفح، لا يُنفَّذ load() بعد
      const [
        { Expenses },
        { Purchases },
        { Returns },
        { Reports },
      ] = await Promise.all([
        import('../modules/expenses.js').catch(() => ({})),
        import('../modules/purchases.js').catch(() => ({})),
        import('../modules/returns.js').catch(() => ({})),
        import('../modules/reports.js').catch(() => ({})),
      ]);
      // نُخزّن المراجع عالمياً لتجنّب إعادة import عند الدخول للصفحة
      if (Expenses)  window.Expenses  = Expenses;
      if (Purchases) window.Purchases = Purchases;
      if (Returns)   window.Returns   = Returns;
      if (Reports)   window.Reports   = Reports;
      // pre-load البيانات كذلك (invoices وexpenses مشتركة مع صفحات أخرى — الكاش سيخدمها)
      wrap(() => Expenses?.load?.() || Promise.resolve());
      wrap(() => Reports?.load?.('month') || Promise.resolve());
    }, 2000);
  },

  async boot(account) {
    DOM.get('exp-wrap').style.display    = 'none';
    DOM.get('app-wrap').classList.add('ready');
    DOM.get('auth-wrap')?.classList.add('hidden');

    // Set UI labels
    DOM.setText('store-pill', account.store_name);
    DOM.setText('hgreet',     'مرحباً، ' + account.owner + ' 👋');
    DOM.setVal?.('set1', account.store_name  || '');
    DOM.setVal?.('set2', account.owner       || '');
    DOM.setVal?.('set3', account.phone       || '');
    DOM.setText('set-sub', account.subscription_end
      ? new Date(account.subscription_end).toLocaleDateString('en-US')
      : 'غير محدود'
    );

    // Apply role-based UI
    Store._applyPermissions(State.role);

    // Register nav loaders
    // ── فصل التنقّل عن التحديث — مبدأ أساسي ──
    // التنقّل: render فوري من State (الذاكرة) — صفر شبكة، صفر تأخير
    // التحديث: يحصل بالخلفية كل 3 دقائق، لا عند كل تنقّل
    Nav.register('home',      () => Store._renderPage('home'));
    Nav.register('quicksale', () => QuickSale.init());
    Nav.register('customers', () => Store._renderPage('customers'));
    Nav.register('debts',     () => Store._renderPage('debts'));
    Nav.register('invoices',  () => Store._renderPage('invoices'));
    Nav.register('sales',     () => Store._renderPage('sales'));
    Nav.register('inventory', () => Store._renderPage('inventory'));
    Nav.register('product',   () => {});
    Nav.register('purchases', async () => { const P = await _loadPurchases(); Store._renderPage('purchases', P); });
    Nav.register('netcards',  async () => { const N = await _loadNetCards();  N.loadStock(); N.loadSales('day'); });
    Nav.register('returns',   async () => { const R = await _loadReturns();   R.load(); });
    Nav.register('expenses',  () => Store._renderPage('expenses'));
    Nav.register('reports',   async () => { const Rp = await _loadReports();  Rp.load('month'); });

    // Register realtime handlers
    Realtime.on('inventory', async () => {
      await Inventory.loadList();
      if (State.currentPage === 'inventory') Inventory.load();
    });
    Realtime.on('invoices', async () => {
      if (State.currentPage === 'invoices') Invoices.load();
      Dashboard.load();
    });
    Realtime.on('debts', async () => {
      Debts.loadBadge();
      if (State.currentPage === 'debts') Debts.load();
    });
    Realtime.on('customers', async () => {
      await Customers.loadAll();
      if (State.currentPage === 'customers') Customers.loadTable();
    });
    Realtime.on('purchases', async () => {
      // لا نحمّل الوحدة هنا لمجرد إشعار وصل بالخلفية — فقط لو المستخدمة فعلياً بصفحة المشتريات
      // الآن (يعني الوحدة محمَّلة فعلياً مسبقاً من Nav.register أعلاه عند دخولها للصفحة)
      if (State.currentPage === 'purchases' && _Purchases) _Purchases.load();
    });

    // ── مستمع تحديث الكاش الخلفي — يُحدِّث الصفحة النشطة فعلياً بصمت لو تغيّرت بياناتها ──
    // يُطلَق من db.js بعد كل تحديث خلفي ناجح (Stale-While-Revalidate)، نفس فلسفة Realtime
    // لكن للبيانات غير المشتركة (لا يوجد Realtime مُفعَّل لها بـSupabase)
    window.addEventListener('hsb:cache-refreshed', ({ detail: { table } }) => {
      const page = State.currentPage;
      if (table === 'inventory'  && (page === 'inventory' || page === 'quicksale')) Inventory.load();
      if (table === 'customers'  && page === 'customers')  Customers.loadTable?.();
      if (table === 'invoices'   && page === 'invoices')   Invoices.load();
      if (table === 'sales'      && page === 'sales')      Sales.load?.('day');
      if (table === 'expenses'   && page === 'expenses')   Expenses.load?.();
    });

    // ── الإقلاع الفوري مع Pre-load ذكي ──
    // الواجهة تفتح فوراً (بدون await)، ثم نجلب بيانات كل الصفحات بالخلفية دفعة واحدة.
    // هذا يملأ الكاش المحلي (db.js يحفظه تلقائياً) فأي صفحة تُفتَح لاحقاً تجد بياناتها
    // جاهزة فوراً من SWR بدون أي انتظار شبكي — أول زيارة وكل زيارة تالية كلتيهما فوريتان
    if (navigator.onLine) {
      Store._preloadAllPages().then(() => {
        Store._loadedForStore = State.user?.id;
      });
      Store._startPeriodicRefresh();
      Notifications.startAutoRefresh();
      Realtime.start();
    } else {
      window.addEventListener('online', () => {
        Store._preloadAllPages();
        Notifications.startAutoRefresh();
        Realtime.start();
      }, { once: true });
    }

  },

  _applyPermissions(role) {
    // Owner-only nav items
    document.querySelectorAll('.owner-only').forEach(el => {
      el.style.display = (role === ROLES.OWNER) ? '' : 'none';
    });

    // Admin panel always hidden in store view
    DOM.show('admin-panel', false);

    // Employee — hide financial sections
    if (role === ROLES.EMPLOYEE) {
      ['nav-debts', 'nav-expenses', 'nav-reports'].forEach(id => DOM.show(id, false));
    }
  },
};

// ── Settings Module ──
export const Settings = {
  async save() {
    const storeName = (document.getElementById('set1')?.value || '').trim();
    const owner     = (document.getElementById('set2')?.value || '').trim();
    const phone     = (document.getElementById('set3')?.value || '').trim();

    if (!storeName) { Notify.error('اسم المحل مطلوب'); return; }
    if (!owner)     { Notify.error('اسم صاحب المحل مطلوب'); return; }

    try {
      const { data: { session } } = await sb.auth.getSession();
            const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/get-account`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization':  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'updateOwnSettings', params: { storeName, owner, phone } }),
      });
            clearTimeout(timeoutId);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تحديث الإعدادات');

      // حدّث الـ State والـ UI
      State.user.store_name = storeName;
      State.user.owner      = owner;
      State.user.phone      = phone;

      DOM.setText('store-pill', storeName);
      DOM.setText('hgreet', 'مرحباً، ' + owner + ' 👋');

      // أظهر رسالة نجاح
      const msg = document.getElementById('set-save-msg');
      if (msg) {
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
      }

      Notify.success('تم حفظ الإعدادات');
    } catch (e) {
      Notify.error('فشل الحفظ: ' + e.message);
    }
  },
};
