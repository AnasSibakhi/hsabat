/**
 * main.js — Application Entry Point
 * Wires everything together — imports, initializes, exposes globals
 */

import { Auth }       from './auth/auth.js';
import * as Nav       from './nav/nav.js';
import * as Modal     from './nav/modal.js';
import { Notify }     from './core/notify.js';
import * as DOM       from './core/dom.js';

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
import { QuickSale }  from './modules/quicksale.js';
import { AdminPanel } from './admin/admin-panel.js';

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
window.UI = { toggleDarkMode: () => toggleDark() };

Object.assign(window, {
  // Auth
  Auth, toggleDark,

  // Navigation
  Nav, Modal, Notify,

  // Modules
  Dashboard, Customers, Debts, Invoices,
  Sales, Inventory, Purchases, NetCards,
  Returns, Expenses, Reports, QuickSale,
  AdminPanel,

  // Convenience wrappers for inline onclick
  navGo:   (id, el) => Nav.go(id, el),
  navTo:   (id)     => Nav.goTo(id),
  openM:   (id)     => Modal.open(id),
  closeM:  (id)     => Modal.close(id),
});
