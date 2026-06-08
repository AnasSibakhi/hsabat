/**
 * sales.js — Sales Module
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
// 17. SALES MODULE
// ─────────────────────────────────────────
const Sales = {
  async load(period = 'day', btn = null) {
    if (btn) { document.querySelectorAll('#page-sales .ptab').forEach(t => t.classList.remove('active')); btn.classList.add('active'); }
    const { data } = await DB.invoices().select('total,payment_type').gte('invoice_date', Utils.periodStart(period));
    const list     = data || [];
    const total    = Utils.sumBy(list, 'total');
    const cash     = list.filter(r => r.payment_type === PAYMENT.CASH).reduce((s, r) => s + r.total, 0);
    const transfer = list.filter(r => r.payment_type === PAYMENT.TRANSFER).reduce((s, r) => s + r.total, 0);
    const defer    = list.filter(r => [PAYMENT.DEFER, PAYMENT.PARTIAL].includes(r.payment_type)).reduce((s, r) => s + r.total, 0);

    DOM.setText('sv1', Utils.currency(total));
    DOM.setText('sv2', list.length);
    DOM.setText('sv3', list.length ? Utils.currency(total / list.length) : '₪0');
    DOM.setText('sv4', Utils.currency(cash));
    DOM.setText('sv5', Utils.currency(transfer));
    DOM.setText('sv6', Utils.currency(defer));
    await Sales.loadDailyReport();
  },

  async loadDailyReport() {
    const [{ data: invs }, { data: purs }] = await Promise.all([
      DB.invoices().select('total,payment_type').eq('invoice_date', Utils.today()),
      DB.purchases().select('cost').eq('purchase_date', Utils.today()),
    ]);
    const totalSales = Utils.sumBy(invs, 'total');
    const totalCost  = Utils.sumBy(purs, 'cost');
    const profit     = totalSales - totalCost;
    const list       = invs || [];
    const cash       = list.filter(r => r.payment_type === PAYMENT.CASH).reduce((s, r) => s + r.total, 0);
    const transfer   = list.filter(r => r.payment_type === PAYMENT.TRANSFER).reduce((s, r) => s + r.total, 0);
    const defer      = list.filter(r => [PAYMENT.DEFER, PAYMENT.PARTIAL].includes(r.payment_type)).reduce((s, r) => s + r.total, 0);

    DOM.setHTML('daily-report', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="background:var(--sl);border-radius:8px;padding:10px 14px;"><div style="font-size:11px;color:var(--s);">إجمالي المبيعات</div><div style="font-size:18px;font-weight:800;color:var(--s);">${Utils.currency(totalSales)}</div></div>
        <div style="background:${profit >= 0 ? 'var(--sl)' : 'var(--dl)'};border-radius:8px;padding:10px 14px;"><div style="font-size:11px;color:${profit >= 0 ? 'var(--s)' : 'var(--d)'};">صافي الربح</div><div style="font-size:18px;font-weight:800;color:${profit >= 0 ? 'var(--s)' : 'var(--d)'};">${Utils.currency(profit)}</div></div>
        <div style="background:var(--g0);border-radius:8px;padding:10px 14px;"><div style="font-size:11px;color:var(--g5);">نقدي</div><div style="font-size:16px;font-weight:700;">${Utils.currency(cash)}</div></div>
        <div style="background:var(--g0);border-radius:8px;padding:10px 14px;"><div style="font-size:11px;color:var(--g5);">تحويل</div><div style="font-size:16px;font-weight:700;">${Utils.currency(transfer)}</div></div>
        <div style="background:var(--dl);border-radius:8px;padding:10px 14px;"><div style="font-size:11px;color:var(--d);">دين اليوم</div><div style="font-size:16px;font-weight:700;color:var(--d);">${Utils.currency(defer)}</div></div>
        <div style="background:var(--g0);border-radius:8px;padding:10px 14px;"><div style="font-size:11px;color:var(--g5);">مشتريات</div><div style="font-size:16px;font-weight:700;">${Utils.currency(totalCost)}</div></div>
      </div>`
    );
  },
};

export { Sales };
