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
async function _loadReturns()   { if (_Returns)   return _Returns;   if (!_pReturns)   _pReturns   = import('../modules/returns.js');   _Returns   = (await _pReturns).Returns;     window.Returns   = _Returns;   return _Returns; }
async function _loadReports()   { if (_Reports)   return _Reports;   if (!_pReports)   _pReports   = import('../modules/reports.js');   _Reports   = (await _pReports).Reports;     window.Reports   = _Reports;   return _Reports; }

export const Store = {
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
    Nav.register('home',      () => Dashboard.load());
    Nav.register('quicksale', () => QuickSale.init());
    Nav.register('customers', () => Customers.loadUnified());
    Nav.register('debts',     () => Debts.load());
    Nav.register('invoices',  () => Invoices.load());
    Nav.register('sales',     () => { Sales.load('day'); Sales.loadDailyReport(); });
    Nav.register('inventory', () => Inventory.load());
    Nav.register('product',   () => {});
    Nav.register('purchases', async () => { const P = await _loadPurchases(); P.load(); });
    Nav.register('netcards',  async () => { const N = await _loadNetCards();  N.loadStock(); N.loadSales('day'); });
    Nav.register('returns',   async () => { const R = await _loadReturns();   R.load(); });
    Nav.register('expenses',  () => Expenses.load());
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

    // ── الإقلاع الفوري (Zero-Wait Boot) ──
    // لا ننتظر أي بيانات من السيرفر قبل إظهار الواجهة — كل الجلب يحصل بالخلفية بعد الفتح
    // مباشرة. المستخدمة ترى الواجهة فوراً، والبيانات تظهر خلال ثوانٍ بصمت بدون أي spinner
    // إضافي. لو كان عندها كاش محلي من جلسة سابقة (يحفظه db.js تلقائياً)، ستُعرَض البيانات
    // القديمة فوراً ثم تُستبدَل بالجديدة بصمت — تجربة سلسة تماماً بدون أي انتظار مرئي
    if (navigator.onLine) {
      // جلب بالخلفية بدون await — الواجهة تفتح فوراً
      Promise.all([
        Inventory.loadList().catch(() => {}),
        Customers.loadAll().catch(() => {}),
        Debts.loadBadge().catch(() => {}),
        Dashboard.load().catch(() => {}),
      ]);
      Notifications.startAutoRefresh();
      Realtime.start();
    } else {
      // بدون نت: نسجّل مستمع يبدأ تلقائياً عند رجوع النت
      window.addEventListener('online', () => {
        Promise.all([
          Inventory.loadList().catch(() => {}),
          Customers.loadAll().catch(() => {}),
          Debts.loadBadge().catch(() => {}),
          Dashboard.load().catch(() => {}),
        ]);
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
