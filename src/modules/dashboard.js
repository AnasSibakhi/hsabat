/**
 * dashboard.js — Dashboard Module
 * Extracted from monolithic app.js into clean module
 */

import { DB }     from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
import { sb }     from '../core/db.js';
import { escape, currency, sumBy, daysSince, today, monthStart, daysAgo, periodStart, invoiceNumber, currentTime, formatDate } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal   from '../nav/modal.js';

// ─────────────────────────────────────────
// 13. DASHBOARD MODULE
// ─────────────────────────────────────────
const Dashboard = {
  async load() {
    const [todayInvoices, monthInvoices, debts, inventory] = await Promise.all([
      DB.invoices().select('total').eq('invoice_date', Utils.today()),
      DB.invoices().select('total').gte('invoice_date', Utils.monthStart()),
      DB.debts().select('amount,paid'),
      DB.inventory().select('quantity,low_stock_alert'),
    ]);

    DOM.setText('hs1', Utils.currency(Utils.sumBy(todayInvoices.data, 'total')));
    DOM.setText('hs2', Utils.currency((debts.data || []).reduce((s, d) => s + (d.amount - d.paid), 0)));
    DOM.setText('hs3', Utils.currency(Utils.sumBy(monthInvoices.data, 'total')));
    DOM.setText('hs4', (inventory.data || []).filter(i => i.quantity <= i.low_stock_alert).length);

    await Dashboard._loadOverdueDebts();
  },

  async _loadOverdueDebts() {
    const { data } = await DB.debts().select('*,customers(name)');
    const overdue = (data || []).filter(d => d.amount - d.paid > 0 && Utils.daysSince(d.debt_date) >= CONFIG.debtLateDays);

    DOM.setHTML('halerts', overdue.length
      ? `<div class="alert ad"><i class="ti ti-alert-triangle"></i><span><strong>تنبيه:</strong> ${overdue.length} زبون متأخر — ${overdue.map(d => Utils.escape(d.customers?.name)).join('، ')}</span></div>`
      : ''
    );

    DOM.setHTML('hoverdue', overdue.length
      ? overdue.map(d => Dashboard._overdueRow(d)).join('')
      : '<tr class="er"><td colspan="4">✅ لا يوجد متأخرون</td></tr>'
    );
  },

  _overdueRow: (d) => `
    <tr>
      <td>${Utils.escape(d.customers?.name || '-')}</td>
      <td>₪${(d.amount - d.paid).toFixed(2)}</td>
      <td><span class="br">${Utils.daysSince(d.debt_date)} يوم</span></td>
      <td><button class="ibg" onclick="Debts.openPayModal('${d.id}','${Utils.escape(d.customers?.name)}',${d.amount - d.paid})">تسديد</button></td>
    </tr>`,
};

export { Dashboard };
