/**
 * main.js — Application Entry Point
 * Wires everything together — imports, initializes, exposes globals
 */

import { Auth }       from './auth/auth.js';
import * as Nav       from './nav/nav.js';
import * as Modal     from './nav/modal.js';
import { Notify }     from './core/notify.js';
import * as DOM       from './core/dom.js';
import './core/errors.js';

// Modules
import { Dashboard }  from './modules/dashboard.js';
import { Customers }  from './modules/customers.js';
import { Debts }      from './modules/debts.js';
import { Invoices }   from './modules/invoices.js';
import { Sales }      from './modules/sales.js';
import { Inventory }  from './modules/inventory.js';
import { Purchases }  from './modules/purchases.js';
import { NetCards }   from './modules/netcards.js';
import { Returns }    from './modules/returns.js';
import { Expenses }   from './modules/expenses.js';
import { Reports }    from './modules/reports.js';
import { QuickSale }      from './modules/quicksale.js';
import { Notifications }  from './modules/notifications.js';
import { Settings }       from './nav/store-boot.js';
import { Guard }          from './core/ratelimit.js';
import { Registry }   from './core/registry.js';

// ── Expose services globally ──
import { BarcodeScanner }   from './services/BarcodeScanner.js';
import { InventoryService } from './services/InventoryService.js';
import { POSService }       from './services/POSService.js';

// ── Register modules in registry (breaks circular deps) ──
Registry.register('Dashboard',  Dashboard);
Registry.register('Customers',  Customers);
Registry.register('Debts',      Debts);
Registry.register('Invoices',   Invoices);
Registry.register('Inventory',  Inventory);
Registry.register('Purchases',  Purchases);
Registry.register('NetCards',   NetCards);
Registry.register('Returns',    Returns);
Registry.register('Expenses',   Expenses);
Registry.register('Reports',    Reports);
Registry.register('QuickSale',  QuickSale);
Registry.register('Sales',      Sales);

// ── Expose all modules to window — required for onclick="X.method()" attributes in HTML to work ──
window.Nav              = Nav;
window.Modal             = Modal;
window.Notify            = Notify;
window.DOM               = DOM;
window.Dashboard         = Dashboard;
window.Customers         = Customers;
window.Debts             = Debts;
window.Invoices          = Invoices;
window.Sales             = Sales;
window.Inventory         = Inventory;
window.Purchases         = Purchases;
window.NetCards          = NetCards;
window.Returns           = Returns;
window.Expenses          = Expenses;
window.Reports           = Reports;
window.QuickSale         = QuickSale;
window.Notifications     = Notifications;
window.Registry          = Registry;
window.BarcodeScanner    = BarcodeScanner;
window.InventoryService  = InventoryService;
window.POSService        = POSService;

// ── Initialize ──
window.addEventListener('DOMContentLoaded', () => {
  // Date inputs
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(e => e.value = today);

  // Home date
  DOM.setText('hdate', new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }));

  // Modal click-outside
  Modal.init();

  // Invoice form
  Invoices.resetForm();

  // Enter key on password
  DOM.get('lp')?.addEventListener('keydown', e => { if (e.key === 'Enter') Auth.login(); });

  // Boot auth
  Auth.init();
});

// ─────────────────────────────────────────
// Global bindings — required for onclick handlers in HTML
// In a future refactor, replace with event delegation
// ─────────────────────────────────────────
// Backward compat — UI object
window.UI = {
  toggleDarkMode: () => toggleDark(),
  toggleProfileMenu() {
    const menu = document.getElementById('profile-menu');
    if (!menu) return;
    const open = menu.style.display === 'block';
    menu.style.display = open ? 'none' : 'block';
    if (!open) {
      setTimeout(() => {
        document.addEventListener('click', function h(e) {
          if (!document.getElementById('profile-wrap')?.contains(e.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', h);
          }
        });
      }, 0);
    }
  },
};
window.Settings = Settings;
window.Guard    = Guard;

Object.assign(window, {
  // Auth
  Auth, toggleDark, confirmLogout: () => Auth.confirmLogout(),

  // Navigation
  Nav, Modal, Notify,

  // Modules
  Dashboard, Customers, Debts, Invoices,
  Sales, Inventory, Purchases, NetCards,
  Returns, Expenses, Reports, QuickSale, Notifications,

  // Convenience wrappers for inline onclick
  navGo:   (id, el) => Nav.go(id, el),
  navTo:   (id)     => Nav.goTo(id),
  openM:   (id)     => Modal.open(id),
  closeM:  (id)     => Modal.close(id),
});

// ── PWA Service Worker — مع تحديث تلقائي فوري عند نشر نسخة جديدة ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // فحص تحديثات فوري عند تحميل الصفحة
      reg.update().catch(() => {});

      // لو وجدنا Service Worker جديد قيد التثبيت — فعّله فوراً وأعد تحميل الصفحة
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage('SKIP_WAITING');
          }
        });
      });
    }).catch(() => {});

    // لما يتغيّر الـ controller (نسخة جديدة فعّالة) — أعد تحميل الصفحة مرة واحدة لضمان آخر نسخة
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloaded) return;
      _reloaded = true;
      window.location.reload();
    });
  });
}

// ── القيم الصفرية بحقول الأرقام تظهر شفافة باهتة بكل الموقع ──
function _applyZeroFade(el) {
  const v = el.value.trim();
  el.classList.toggle('zero-val', v === '' || parseFloat(v) === 0);
}

// فحص فوري لكل حقل رقمي موجود حالياً (يشمل الحقول اللي تتفتح بـ modal لاحقاً عبر delegation)
document.addEventListener('input', e => {
  if (e.target.matches('input[type="number"]')) _applyZeroFade(e.target);
});

// عند الضغط على حقل أرقام أو باركود — حدد المحتوى كامل تلقائياً، فالكتابة تستبدله مباشرة بدون حذف يدوي
// (لا يشمل حقول الاسم/البحث العامة لأن المستخدم قد يريد تعديل جزء منها فقط)
document.addEventListener('focus', e => {
  const isNumberInput = e.target.tagName === 'INPUT' && e.target.type === 'number';
  const isBarcodeField = e.target.id && /barcode|bc-|^inb$/i.test(e.target.id);
  if (isNumberInput || isBarcodeField) {
    // استخدام setTimeout لضمان التحديد يصير بعد أن يضع المتصفح نفسه مكان الكتابة الافتراضي
    setTimeout(() => e.target.select(), 0);
  }
}, true); // capture:true لأن focus لا ينتشر (bubble) بشكل طبيعي

// مراقب خفيف يفحص فقط العناصر الجديدة المضافة للـ DOM (مودالز تُفتح ديناميكياً)
const _zeroFadeObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes.length) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('input[type="number"]')) _applyZeroFade(node);
        node.querySelectorAll?.('input[type="number"]').forEach(_applyZeroFade);
      });
    }
  }
});
_zeroFadeObserver.observe(document.body, { childList: true, subtree: true });

// فحص أولي عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[type="number"]').forEach(_applyZeroFade);
});

// إغلاق الـ dropdowns عند الضغط خارجها
document.addEventListener('click', e => {
  // لو الضغط على خيار في dropdown — لا تغلقه
  if (e.target.closest('.dc-opt')) return;

  ['dc-dropdown','inv-cust-dropdown','qs-buyer-dropdown','qs-buyer-dd-tr','qs-buyer-dd-df','qs-debt-pay-dd'].forEach(id => {
    const dd = document.getElementById(id);
    if (!dd || dd.style.display === 'none') return;
    if (!dd.contains(e.target)) {
      dd.style.display = 'none';
    }
  });
});
