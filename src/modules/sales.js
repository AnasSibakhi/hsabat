/**
 * sales.js — Sales Module
 * Extracted from monolithic app.js into clean module
 */

import { DB, sb }   from '../core/db.js';
import { FIFOService } from '../services/FIFOService.js';
import { State }  from '../core/state.js';
import { Notify } from '../core/notify.js';
import * as DOM     from '../core/dom.js';
import * as Utils from '../core/utils.js';
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
    const [{ data: invs }] = await Promise.all([
      DB.invoices().select('id,total,payment_type').eq('invoice_date', Utils.today()),
    ]);
    const list       = invs || [];
    const totalSales = Utils.sumBy(list, 'total');

    // COGS Edge Function ثقيلة — نعرض إجمالي المبيعات أولاً فوراً ثم نكمل
    DOM.setText('sv1', Utils.currency(totalSales));
    let totalCOGS = 0;
    const invoiceIds = list.map(i => i.id);
    if (invoiceIds.length) {
      try {
        totalCOGS = await FIFOService.calculateCOGS(invoiceIds);
      } catch (e) { /* يبقى 0 لو فشل */ }
    }

    const profit     = totalSales - totalCOGS;
    const cash       = list.filter(r => r.payment_type === PAYMENT.CASH).reduce((s, r) => s + r.total, 0);
    const transfer   = list.filter(r => r.payment_type === PAYMENT.TRANSFER).reduce((s, r) => s + r.total, 0);
    const defer      = list.filter(r => [PAYMENT.DEFER, PAYMENT.PARTIAL].includes(r.payment_type)).reduce((s, r) => s + r.total, 0);

    DOM.setHTML('daily-report', `
      <div class="dr-grid">
        <div class="dr-cell" style="background:var(--sl);"><div class="dr-label" style="color:var(--s);">إجمالي المبيعات</div><div class="dr-val" style="color:var(--s);">${Utils.currency(totalSales)}</div></div>
        <div class="dr-cell" style="background:${profit >= 0 ? 'var(--sl)' : 'var(--dl)'};"><div class="dr-label" style="color:${profit >= 0 ? 'var(--s)' : 'var(--d)'};">صافي الربح</div><div class="dr-val" style="color:${profit >= 0 ? 'var(--s)' : 'var(--d)'};">${Utils.currency(profit)}</div></div>
        <div class="dr-cell"><div class="dr-label">نقدي</div><div class="dr-val plain">${Utils.currency(cash)}</div></div>
        <div class="dr-cell"><div class="dr-label">تحويل</div><div class="dr-val plain">${Utils.currency(transfer)}</div></div>
        <div class="dr-cell" style="background:var(--dl);"><div class="dr-label" style="color:var(--d);">دين اليوم</div><div class="dr-val" style="color:var(--d);">${Utils.currency(defer)}</div></div>
        <div class="dr-cell"><div class="dr-label">تكلفة البضاعة المباعة</div><div class="dr-val plain">${Utils.currency(totalCOGS)}</div></div>
      </div>`
    );
  },
};

export { Sales };
