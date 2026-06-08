/**
 * store-boot.js — Store App Bootstrap
 * Initializes the store UI after successful login
 */

import { State }    from '../core/state.js';
import { ROLES }    from '../config/constants.js';
import * as DOM     from '../core/dom.js';
import * as Nav     from './nav.js';
import { Realtime } from './realtime.js';

// Module imports
import { Dashboard }  from '../modules/dashboard.js';
import { Customers }  from '../modules/customers.js';
import { Debts }      from '../modules/debts.js';
import { Invoices }   from '../modules/invoices.js';
import { Sales }      from '../modules/sales.js';
import { Inventory }  from '../modules/inventory.js';
import { Purchases }  from '../modules/purchases.js';
import { NetCards }   from '../modules/netcards.js';
import { Returns }    from '../modules/returns.js';
import { Expenses }   from '../modules/expenses.js';
import { Reports }    from '../modules/reports.js';
import { QuickSale }  from '../modules/quicksale.js';

export const Store = {
  async boot(account) {
    DOM.get('exp-wrap').style.display    = 'none';
    DOM.get('app-wrap').style.display    = 'flex';
    DOM.get('auth-wrap')?.classList.add('hidden');

    // Set UI labels
    DOM.setText('store-pill', account.store_name);
    DOM.setText('hgreet',     'مرحباً، ' + account.owner + ' 👋');
    DOM.setVal?.('set1', account.store_name);
    DOM.setVal?.('set2', account.owner);
    DOM.setText('set-sub', account.subscription_end
      ? new Date(account.subscription_end).toLocaleDateString('en-US')
      : 'غير محدود'
    );

    // Apply role-based UI
    Store._applyPermissions(State.role);

    // Register nav loaders
    Nav.register('home',      () => Dashboard.load());
    Nav.register('quicksale', () => QuickSale.init());
    Nav.register('customers', () => Customers.loadTable());
    Nav.register('debts',     () => Debts.load());
    Nav.register('invoices',  () => Invoices.load());
    Nav.register('sales',     () => { Sales.load('day'); Sales.loadDailyReport(); });
    Nav.register('inventory', () => Inventory.load());
    Nav.register('purchases', () => Purchases.load());
    Nav.register('netcards',  () => { NetCards.loadStock(); NetCards.loadSales('day'); });
    Nav.register('returns',   () => Returns.load());
    Nav.register('expenses',  () => Expenses.load());
    Nav.register('reports',   () => Reports.load('month'));

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
      if (State.currentPage === 'purchases') Purchases.load();
    });

    // Initial data load
    await Inventory.loadList();
    await Promise.all([Customers.loadAll(), Debts.loadBadge()]);
    await Dashboard.load();

    Realtime.start();
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
