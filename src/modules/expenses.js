/**
 * expenses.js — Expenses Module
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
// 22. EXPENSES MODULE
// ─────────────────────────────────────────
const Expenses = {
  async load() {
    const { data } = await DB.expenses().select('*').order('exp_date', { ascending: false });
    const list     = data || [];
    const today    = Utils.today();
    const weekAgo  = Utils.daysAgo(7);
    const monthStart = Utils.monthStart();

    DOM.setText('exp-day',   Utils.currency(list.filter(e => e.exp_date === today).reduce((s, e) => s + e.amount, 0)));
    DOM.setText('exp-week',  Utils.currency(list.filter(e => e.exp_date >= weekAgo).reduce((s, e) => s + e.amount, 0)));
    DOM.setText('exp-month', Utils.currency(list.filter(e => e.exp_date >= monthStart).reduce((s, e) => s + e.amount, 0)));

    const TYPE_ICON = { 'إيجار':'🏠', 'كهرباء':'⚡', 'ماء':'💧', 'رواتب':'👥', 'صيانة':'🔧', 'نقل':'🚚', 'تسويق':'📢' };

    DOM.setHTML('exp-list', list.length
      ? list.map(e => `<div class="exp-card">
          <div class="exp-card-icon">${TYPE_ICON[e.exp_type] || '💸'}</div>
          <div class="exp-card-body">
            <div class="exp-card-type">${Utils.escape(e.exp_type)}</div>
            <div class="exp-card-date">${e.exp_date}</div>
            ${e.notes ? `<div class="exp-card-notes">${Utils.escape(e.notes)}</div>` : ''}
          </div>
          <div class="exp-card-right">
            <div class="exp-card-amount">₪${e.amount.toFixed(2)}</div>
            <button class="exp-card-del" onclick="Expenses.delete('${e.id}')"><i class="ti ti-trash"></i></button>
          </div>
        </div>`).join('')
      : '<div class="er" style="padding:30px;text-align:center;color:var(--g5);">لا توجد مصاريف</div>'
    );
  },

  async save() {
    const amount = parseFloat(DOM.val('exp-amount'));
    if (!amount || amount <= 0) { Notify.error('أدخل المبلغ'); return; }
    State.isMutating = true;
    try {
      const { error } = await DB.expenses().insert({ store_id: State.user.id, exp_type: DOM.get('exp-type').value, amount, exp_date: DOM.val('exp-date'), notes: DOM.val('exp-notes') });
      if (error) throw error;
      Notify.success('تم تسجيل المصروف');
      Modal.close('m-expense');
      DOM.clearInputs('exp-amount', 'exp-notes');
      await Expenses.load();
    } catch (err) { const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine; Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — لم يُسجَّل المصروف، حاولي مرة أخرى' : (err.message || 'فشل تسجيل المصروف')); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async delete(id) {
    if (!confirm('حذف هذا المصروف؟')) return;
    State.isMutating = true;
    try {
      await DB.expenses().delete().eq('id', id);
      Notify.success('تم الحذف');
      await Expenses.load();
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — لم يُحذف المصروف، حاولي مرة أخرى' : (err.message || 'فشل حذف المصروف'));
    }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },
};

export { Expenses };
