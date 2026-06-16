/**
 * reports.js — Reports Module (FIFO-aware)
 */

import { DB, sbAdmin } from '../core/db.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM        from '../core/dom.js';
import * as Utils      from '../core/utils.js';
import { FIFOService } from '../services/FIFOService.js';

// ─────────────────────────────────────────
// REPORTS MODULE
// ─────────────────────────────────────────
const Reports = {
  async load(period = 'month', btn = null) {
    if (btn) {
      document.querySelectorAll('#page-reports .ptab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    }
    const from  = Utils.periodStart(period);
    const label = { day: 'اليوم', week: 'الأسبوع', month: 'الشهر' }[period];

    // جلب الفواتير والمصاريف
    const [invRes, expRes] = await Promise.all([
      DB.invoices().select('id,total').gte('invoice_date', from),
      DB.expenses().select('amount,exp_type').gte('exp_date', from),
    ]);

    const invoiceIds  = (invRes.data || []).map(i => i.id);
    const totalSales  = Utils.sumBy(invRes.data, 'total');

    // COGS من FIFO allocations (أدق من تكلفة المنتج الحالية)
    let totalCOGS = 0;
    if (invoiceIds.length) {
      const { data: allocs } = await sbAdmin
        .from('sale_inventory_allocations')
        .select('quantity_taken, cost_price')
        .in('sale_invoice_id', invoiceIds)
        .eq('store_id', State.user.id);

      totalCOGS = (allocs || []).reduce(
        (sum, a) => sum + a.quantity_taken * a.cost_price, 0
      );

      // Fallback: لو ما في FIFO allocations بعد — استخدم تكلفة المنتج
      if (!totalCOGS && invoiceIds.length) {
        const { data: items } = await sbAdmin
          .from('invoice_items')
          .select('quantity, price, inventory_id, inventory(cost_price)')
          .in('invoice_id', invoiceIds);

        totalCOGS = (items || []).reduce((sum, item) => {
          const cost = item.inventory?.cost_price || 0;
          return sum + cost * (item.quantity || 1);
        }, 0);
      }
    }

    const expList   = expRes.data || [];
    const totalOpex = Utils.sumBy(expList, 'amount');
    const netProfit = totalSales - totalCOGS - totalOpex;
    const margin    = totalSales > 0 ? ((netProfit / totalSales) * 100) : 0;

    // تقييم المخزون الحالي بـ FIFO
    let inventoryValue = { costValue: 0, sellValue: 0 };
    try {
      inventoryValue = await FIFOService.getInventoryValue();
    } catch (e) { /* non-critical */ }

    // Banner
    const banner = DOM.get('profit-banner');
    if (banner) banner.style.background = netProfit >= 0 ? 'var(--sl)' : 'var(--dl)';
    const profitEl = DOM.get('profit-main');
    if (profitEl) {
      profitEl.textContent = (netProfit >= 0 ? '+ ' : '- ') + '₪' + Math.abs(netProfit).toFixed(2);
      profitEl.style.color = netProfit >= 0 ? 'var(--s)' : 'var(--d)';
    }
    DOM.setText('profit-label',        'صافي الربح (' + label + ')');
    DOM.setText('profit-margin-label', 'هامش الربح: ' + margin.toFixed(1) + '%');

    // Stats
    DOM.setText('r-sales', Utils.currency(totalSales));
    DOM.setText('r-cogs',  Utils.currency(totalCOGS));
    DOM.setText('r-opex',  Utils.currency(totalOpex));

    // Equation
    DOM.setText('eq-sales', Utils.currency(totalSales));
    DOM.setText('eq-cogs',  Utils.currency(totalCOGS));
    DOM.setText('eq-opex',  Utils.currency(totalOpex));
    const eqProfit = DOM.get('eq-profit');
    if (eqProfit) {
      eqProfit.textContent = Utils.currency(netProfit);
      eqProfit.style.color = netProfit >= 0 ? 'var(--s)' : 'var(--d)';
    }

    // قيمة المخزون
    const invValEl = DOM.get('r-inventory-value');
    if (invValEl) invValEl.textContent = Utils.currency(inventoryValue.costValue);

    // تفاصيل المصاريف
    const byType = expList.reduce((acc, e) => {
      acc[e.exp_type] = (acc[e.exp_type] || 0) + e.amount;
      return acc;
    }, {});
    DOM.setHTML('r-exp-detail', Object.keys(byType).length
      ? Object.entries(byType).map(([t, a]) =>
          `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:.5px solid var(--g1);font-size:13px;">
            <span>${Utils.escape(t)}</span>
            <strong>₪${a.toFixed(2)}</strong>
          </div>`).join('')
      : '<span style="color:var(--g4);">لا توجد مصاريف للفترة</span>'
    );
  },
};

export { Reports };
