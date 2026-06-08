/**
 * reports.js — Reports Module
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
// 23. REPORTS MODULE
// ─────────────────────────────────────────
const Reports = {
  async load(period = 'month', btn = null) {
    if (btn) { document.querySelectorAll('#page-reports .ptab').forEach(t => t.classList.remove('active')); btn.classList.add('active'); }
    const from = Utils.periodStart(period);
    const label = { day: 'اليوم', week: 'الأسبوع', month: 'الشهر' }[period];

    const [{ data: invData }, { data: purData }, { data: expData }] = await Promise.all([
      DB.invoices().select('total').gte('invoice_date', from),
      DB.purchases().select('cost').gte('purchase_date', from),
      DB.expenses().select('amount,exp_type').gte('exp_date', from),
    ]);

    const totalSales   = Utils.sumBy(invData, 'total');
    const totalCOGS    = Utils.sumBy(purData, 'cost');
    const expList      = expData || [];
    const totalOpex    = Utils.sumBy(expList, 'amount');
    const netProfit    = totalSales - totalCOGS - totalOpex;
    const margin       = totalSales > 0 ? ((netProfit / totalSales) * 100) : 0;

    // Banner
    const banner = DOM.get('profit-banner');
    if (banner) banner.style.background = netProfit >= 0 ? 'var(--sl)' : 'var(--dl)';
    const profitEl = DOM.get('profit-main');
    if (profitEl) { profitEl.textContent = (netProfit >= 0 ? '+ ' : '- ') + '₪' + Math.abs(netProfit).toFixed(2); profitEl.style.color = netProfit >= 0 ? 'var(--s)' : 'var(--d)'; }
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
    if (eqProfit) { eqProfit.textContent = Utils.currency(netProfit); eqProfit.style.color = netProfit >= 0 ? 'var(--s)' : 'var(--d)'; }

    // Expenses breakdown
    const byType = expList.reduce((acc, e) => { acc[e.exp_type] = (acc[e.exp_type] || 0) + e.amount; return acc; }, {});
    DOM.setHTML('r-exp-detail', Object.keys(byType).length
      ? Object.entries(byType).map(([t, a]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:.5px solid var(--g1);font-size:13px;"><span>${Utils.escape(t)}</span><strong>₪${a.toFixed(2)}</strong></div>`).join('')
      : '<span style="color:var(--g4);">لا توجد مصاريف للفترة</span>'
    );
  },
};

export { Reports };
