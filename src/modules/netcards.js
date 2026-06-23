/**
 * netcards.js — NetCards Module
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
// 20. NET CARDS MODULE
// ─────────────────────────────────────────
const NetCards = {
  async loadStock() {
    const { data } = await DB.netCardStock().select('*');
    const alerts   = [];

    CONFIG.netCardTypes.forEach(type => {
      const item = (data || []).find(d => d.card_type === type);
      const qty  = item?.quantity || 0;
      const valEl = DOM.get('ncs' + type);
      if (!valEl) return;
      valEl.textContent = qty + ' بطاقة';

      const card = valEl.closest('.stat-card-v2');
      const isLow = qty <= CONFIG.lowStockThreshold;
      if (card) {
        card.classList.remove('blue', 'amber', 'green', 'red');
        card.classList.add(isLow ? 'red' : 'green');
        const iconEl = card.querySelector('.stat-icon-v2');
        if (iconEl) { iconEl.classList.remove('blue', 'amber', 'green', 'red'); iconEl.classList.add(isLow ? 'red' : 'green'); }
      }

      if (isLow) {
        alerts.push(`<div class="alert aw"><i class="ti ti-wifi-off"></i><span><strong>تنبيه:</strong> بطاقة ${type} شيكل — المتبقي ${qty} فقط</span></div>`);
      }
    });
    DOM.setHTML('ncalerts', alerts.join(''));
  },

  async loadSales(period = 'day', btn = null) {
    if (btn) { document.querySelectorAll('#page-netcards .ptab').forEach(t => t.classList.remove('active')); btn.classList.add('active'); }
    const { data } = await DB.netCardSales().select('*').gte('sale_date', Utils.periodStart(period)).order('created_at', { ascending: false });
    const list = data || [];

    DOM.setText('ns1', Utils.currency(list.reduce((s, r) => s + r.total_price, 0)));
    DOM.setText('ns2', list.reduce((s, r) => s + r.quantity, 0));
    DOM.setText('ns3', list.filter(r => r.total_price - r.paid > 0 && Utils.daysSince(r.sale_date) >= CONFIG.debtLateDays).length);

    // ربح البطاقات — منفصل تماماً عن التقارير المالية العامة
    const profit = list.reduce((s, r) => s + (r.total_price - (r.cost_at_sale || 0) * r.quantity), 0);
    const profitEl = DOM.get('nc-profit');
    if (profitEl) { profitEl.textContent = Utils.currency(profit); profitEl.style.color = profit >= 0 ? 'var(--s)' : 'var(--d)'; }

    DOM.setHTML('nslist', list.length
      ? list.map(s => {
          const remaining = s.total_price - s.paid;
          const isLate    = remaining > 0 && Utils.daysSince(s.sale_date) >= CONFIG.debtLateDays;
          const statusHtml = isLate
            ? `<span class="cu-status-pill late">متأخر ${Utils.daysSince(s.sale_date)} يوم</span>`
            : remaining > 0
            ? `<span class="cu-status-pill recent">باقي ₪${remaining.toFixed(2)}</span>`
            : `<span class="cu-status-pill ok">✅ مسدَّد</span>`;

          return `<div class="exp-card">
            <div class="exp-card-icon" style="background:var(--pl);">📶</div>
            <div class="exp-card-body">
              <div class="exp-card-type">${Utils.escape(s.buyer_name)} — ${s.card_type}₪ × ${s.quantity}</div>
              <div class="exp-card-date">${s.sale_date} · ${s.payment_type === 'full' ? 'دفع كلي' : 'دفع جزئي'}</div>
              <div style="margin-top:5px;">${statusHtml}</div>
            </div>
            <div class="exp-card-right">
              <div class="exp-card-amount" style="color:var(--p);">₪${s.total_price.toFixed(2)}</div>
              <button class="exp-card-del" onclick="NetCards.deleteSale('${s.id}')"><i class="ti ti-trash"></i></button>
            </div>
          </div>`;
        }).join('')
      : '<div class="er" style="padding:30px;text-align:center;color:var(--g5);">لا توجد مبيعات</div>'
    );
  },

  calcTotal() {
    const type = parseInt(DOM.val('nst'));
    const qty  = parseInt(DOM.val('nsq')) || 0;
    DOM.setText('nstotal', '₪ ' + (type * qty));
  },

  async sell() {
    const buyer = DOM.val('nsb');
    const type  = DOM.val('nst');
    const qty   = parseInt(DOM.val('nsq')) || 0;
    if (!buyer)   { Notify.error('أدخل اسم المشتري'); return; }
    if (qty < 1)  { Notify.error('أدخل العدد'); return; }

    const { data: stock } = await DB.netCardStock().select('id,quantity,cost_price').eq('card_type', type).single();
    if (!stock || stock.quantity < qty) { Notify.error('المخزون غير كافٍ — المتبقي: ' + (stock?.quantity || 0)); return; }

    const total = parseInt(type) * qty;
    const paymentType = document.querySelector('input[name="nsp"]:checked').value;

    State.isMutating = true;
    try {
      const { error } = await DB.netCardSales().insert({
        store_id: State.user.id, buyer_name: buyer, card_type: type,
        quantity: qty, total_price: total, paid: paymentType === 'full' ? total : 0,
        payment_type: paymentType, sale_date: Utils.today(),
        cost_at_sale: stock.cost_price || 0,
      });
      if (error) throw error;
      await DB.netCardStock().update({ quantity: stock.quantity - qty, updated_at: new Date().toISOString() }).eq('id', stock.id);
      Notify.success('تم تسجيل البيع');
      Modal.close('m-netsale');
      DOM.clearInputs('nsb');
      DOM.get('nsq').value = 1;
      NetCards.calcTotal();
      await Promise.all([NetCards.loadStock(), NetCards.loadSales('day')]);
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  calcStockCost() {
    const price    = parseFloat(DOM.val('asp')) || 0;
    const discount = parseFloat(DOM.val('asd')) || 0;
    const finalCost = price * (1 - discount / 100);
    const el = DOM.get('ast-final-cost');
    if (el) el.textContent = '₪' + finalCost.toFixed(3);
  },

  async addStock() {
    const type     = DOM.val('ast');
    const qty      = parseInt(DOM.val('asq')) || 0;
    const price    = parseFloat(DOM.val('asp')) || 0;
    const discount = parseFloat(DOM.val('asd')) || 0;
    if (qty < 1) { Notify.error('أدخل الكمية'); return; }
    const finalCost = price * (1 - discount / 100);

    const { data: s } = await DB.netCardStock().select('id,quantity,cost_price').eq('card_type', type).single();
    if (s) {
      // متوسط مرجّح للتكلفة لو كان فيه مخزون قديم بتكلفة مختلفة (دقة أعلى لحساب الربح)
      const oldQty  = s.quantity || 0;
      const oldCost = s.cost_price || 0;
      const newAvgCost = (oldQty + qty) > 0 ? ((oldQty * oldCost) + (qty * finalCost)) / (oldQty + qty) : finalCost;
      await DB.netCardStock().update({ quantity: oldQty + qty, cost_price: newAvgCost, updated_at: new Date().toISOString() }).eq('id', s.id);
    } else {
      await DB.netCardStock().insert({ store_id: State.user.id, card_type: type, quantity: qty, cost_price: finalCost });
    }
    Notify.success('تم إضافة المخزون' + (finalCost > 0 ? ' — التكلفة: ₪' + finalCost.toFixed(3) + '/وحدة' : ''));
    Modal.close('m-addstock');
    DOM.get('asq').value = 100;
    DOM.clearInputs('asp', 'asd');
    DOM.get('ast-final-cost').textContent = '₪0.00';
    await NetCards.loadStock();
  },

  async deleteSale(id) {
    if (!confirm('حذف؟')) return;
    await DB.netCardSales().delete().eq('id', id);
    Notify.success('تم');
    await NetCards.loadSales('day');
  },
};

export { NetCards };
