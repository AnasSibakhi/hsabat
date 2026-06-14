/**
 * dashboard.js — Dashboard Module
 * Extracted from monolithic app.js into clean module
 */

import { DB }     from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
import { sb }     from '../core/db.js';
import * as Utils from '../core/utils.js';
import { escape, currency, sumBy, daysSince, today, monthStart, daysAgo, periodStart, invoiceNumber, currentTime, formatDate } from '../core/utils.js';
import { PAYMENT, ROLES, RETURN_TYPE, CONFIG } from '../config/constants.js';
import * as Modal   from '../nav/modal.js';

// ─────────────────────────────────────────
// 13. DASHBOARD MODULE
// ─────────────────────────────────────────
const Dashboard = {
  async load() {
    try {
      const todayStr = Utils.today();

      // جلب فواتير اليوم + عناصرها + المخزون + الديون
      const [todayInv, debts, inventory, purchasesRes] = await Promise.all([
        DB.invoices().select('id,total').eq('invoice_date', todayStr),
        DB.debts().select('amount,paid'),
        DB.inventory().select('id,name,quantity,low_stock_alert,cost_price'),
        DB.purchases().select('*').eq('payment_status','defer').gt('remaining',0),
      ]);

      // ١. مبيعات اليوم
      const todaySales = Utils.sumBy(todayInv.data, 'total');
      DOM.setText('hs1', Utils.currency(todaySales));

      // ٢. ربح اليوم الحقيقي من invoice_items
      const todayInvIds = (todayInv.data || []).map(i => i.id);
      let todayProfit = 0;

      if (todayInvIds.length > 0) {
        const { data: soldItems } = await sb.from('invoice_items')
          .select('quantity, price, inventory_id, inventory(cost_price)')
          .in('invoice_id', todayInvIds);

        todayProfit = (soldItems || []).reduce((sum, it) => {
          const cost  = it.inventory?.cost_price || 0;
          const qty   = it.quantity || 1;
          const price = it.price   || 0;
          return sum + (price - cost) * qty;
        }, 0);
      }

      const profitEl = DOM.get('hs-profit');
      if (profitEl) {
        profitEl.textContent = Utils.currency(todayProfit);
        profitEl.style.color = todayProfit >= 0 ? 'var(--s)' : 'var(--r)';
      }

      // ٣. عدد الفواتير اليوم
      DOM.setText('hs-invoices', (todayInv.data || []).length + ' فاتورة');

      // ٤. إجمالي الديون
      DOM.setText('hs2', Utils.currency((debts.data || []).reduce((s, d) => s + (d.amount - d.paid), 0)));

      // ٥. تنبيهات المخزون
      Dashboard._loadInventoryAlerts(inventory.data || []);

      await Dashboard._loadOverdueDebts();
    } catch(err) {
      console.error('[Dashboard.load] ERROR:', err);
    }
  },

  _loadInventoryAlerts(items) {
    const outOfStock = items.filter(i => i.quantity <= 0);
    const lowStock   = items.filter(i => i.quantity > 0 && i.quantity <= (i.low_stock_alert || 5));
    const el = DOM.get('hs-inventory-alerts');
    if (!el) return;

    if (!outOfStock.length && !lowStock.length) {
      el.innerHTML = '<div class="card" style="padding:12px 14px;color:var(--s);font-size:13px;font-weight:700;">✅ المخزون في حالة جيدة</div>';
      return;
    }

    let html = '';

    if (outOfStock.length) {
      html += `<div class="card" style="margin-bottom:8px;border-right:4px solid var(--r);">
        <div style="padding:10px 14px;">
          <div style="font-size:13px;font-weight:800;color:var(--r);margin-bottom:8px;">🔴 منتهية المخزون (${outOfStock.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${outOfStock.map(i => `<span style="background:var(--rl);color:var(--r);padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;">${Utils.escape(i.name)}</span>`).join('')}
          </div>
        </div>
      </div>`;
    }

    if (lowStock.length) {
      html += `<div class="card" style="border-right:4px solid var(--amber,#f59e0b);">
        <div style="padding:10px 14px;">
          <div style="font-size:13px;font-weight:800;color:#d97706;margin-bottom:8px;">🟡 قاربت النفاد (${lowStock.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${lowStock.map(i => `<span style="background:#fef3c7;color:#d97706;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;">${Utils.escape(i.name)} (${i.quantity})</span>`).join('')}
          </div>
        </div>
      </div>`;
    }

    el.innerHTML = html;
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
