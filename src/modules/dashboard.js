/**
 * dashboard.js — Dashboard Module
 * Extracted from monolithic app.js into clean module
 */

import { DB, sb } from '../core/db.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
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
        DB.debts().select('amount,paid').limit(500),
        DB.inventory().select('id,name,quantity,low_stock_alert,cost_price').limit(1000),
        DB.purchases().select('*').eq('payment_status','defer').gt('remaining',0).limit(100),
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
      el.innerHTML = '<div class="all-good-v2">✅ المخزون في حالة جيدة</div>';
      return;
    }

    let html = '';

    if (outOfStock.length) {
      html += `<div class="alert-card-v2 out">
        <div class="alert-head-v2 out">🔴 منتهية المخزون (${outOfStock.length})</div>
        <div class="alert-chips-v2">
          ${outOfStock.map(i => `<span class="chip-v2 out">${Utils.escape(i.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    if (lowStock.length) {
      html += `<div class="alert-card-v2 low">
        <div class="alert-head-v2 low">🟡 قاربت النفاد (${lowStock.length})</div>
        <div class="alert-chips-v2">
          ${lowStock.map(i => `<span class="chip-v2 low">${Utils.escape(i.name)} (${i.quantity})</span>`).join('')}
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
      : '<div style="padding:1rem;text-align:center;color:var(--s);font-size:13px;font-weight:700;">✅ لا يوجد متأخرون</div>'
    );
  },

  _overdueRow: (d) => `
    <div class="debt-row-v2">
      <div>
        <div class="debt-row-v2-name">${Utils.escape(d.customers?.name || '-')}</div>
        <span class="debt-row-v2-days">${Utils.daysSince(d.debt_date)} يوم متأخر</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="debt-row-v2-amount">₪${(d.amount - d.paid).toFixed(2)}</span>
        <button class="debt-row-v2-btn" onclick="Debts.openPayModal('${d.id}','${Utils.escape(d.customers?.name)}',${d.amount - d.paid})">تسديد</button>
      </div>
    </div>`,
};

export { Dashboard };
