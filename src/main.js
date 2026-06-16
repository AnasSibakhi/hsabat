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
import { AdminPanel } from './admin/admin-panel.js';
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

// ── Initialize ──
window.addEventListener('DOMContentLoaded', () => {
  // Dark mode
  if (localStorage.getItem('dark') === 'true') {
    document.body.classList.add('dark');
    setTimeout(() => {
      const icon = DOM.get('dark-icon');
      if (icon) icon.className = 'ti ti-sun';
    }, 50);
  }

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

// ── Dark mode toggle ──
function toggleDark() {
  document.body.classList.toggle('dark');
  localStorage.setItem('dark', document.body.classList.contains('dark'));
  const icon = DOM.get('dark-icon');
  if (icon) icon.className = document.body.classList.contains('dark') ? 'ti ti-sun' : 'ti ti-moon';
}

// ─────────────────────────────────────────
// Global bindings — required for onclick handlers in HTML
// In a future refactor, replace with event delegation
// ─────────────────────────────────────────
// Backward compat — UI object
window.UI       = { toggleDarkMode: () => toggleDark() };
window.Settings = Settings;

Object.assign(window, {
  // Auth
  Auth, toggleDark, confirmLogout: () => Auth.confirmLogout(),

  // Navigation
  Nav, Modal, Notify,

  // Modules
  Dashboard, Customers, Debts, Invoices,
  Sales, Inventory, Purchases, NetCards,
  Returns, Expenses, Reports, QuickSale, Notifications,
  AdminPanel,

  // Convenience wrappers for inline onclick
  navGo:   (id, el) => Nav.go(id, el),
  navTo:   (id)     => Nav.goTo(id),
  openM:   (id)     => Modal.open(id),
  closeM:  (id)     => Modal.close(id),
});

// ── PWA Service Worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

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
