/**
 * netcards.js — NetCards Module
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
// 20. NET CARDS MODULE
// ─────────────────────────────────────────
const NetCards = {
  async loadStock() {
    const { data } = await DB.netCardStock().select('*');
    const alerts   = [];

    CONFIG.netCardTypes.forEach(type => {
      const item = (data || []).find(d => d.card_type === type);
      const qty  = item?.quantity || 0;
      const card = DOM.get('ncs' + type);
      if (!card) return;
      card.querySelector('.sc-v').textContent = qty + ' بطاقة';
      if (qty <= CONFIG.lowStockThreshold) {
        card.className = 'sc red';
        alerts.push(`<div class="alert aw"><i class="ti ti-wifi-off"></i><span><strong>تنبيه:</strong> بطاقة ${type} شيكل — المتبقي ${qty} فقط</span></div>`);
      } else {
        card.className = 'sc green';
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

    DOM.setHTML('nslist', list.length
      ? list.map(s => {
          const remaining = s.total_price - s.paid;
          const isLate    = remaining > 0 && Utils.daysSince(s.sale_date) >= CONFIG.debtLateDays;
          return `<tr>
            <td>${Utils.escape(s.buyer_name)}</td><td>${s.card_type}₪</td><td>${s.quantity}</td><td>₪${s.total_price.toFixed(2)}</td>
            <td>${s.payment_type === 'full' ? '<span class="bg">كلي</span>' : '<span class="ba">جزئي</span>'}</td>
            <td>${s.sale_date}</td>
            <td>${isLate ? `<span class="br">متأخر ${Utils.daysSince(s.sale_date)} يوم</span>` : remaining > 0 ? `<span class="ba">باقي ₪${remaining.toFixed(2)}</span>` : '<span class="bg">مسدَّد</span>'}</td>
            <td><button class="ibr" onclick="NetCards.deleteSale('${s.id}')">حذف</button></td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="8">لا توجد مبيعات</td></tr>'
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

    const { data: stock } = await DB.netCardStock().select('id,quantity').eq('card_type', type).single();
    if (!stock || stock.quantity < qty) { Notify.error('المخزون غير كافٍ — المتبقي: ' + (stock?.quantity || 0)); return; }

    const total = parseInt(type) * qty;
    const paymentType = document.querySelector('input[name="nsp"]:checked').value;

    State.isMutating = true;
    try {
      const { error } = await DB.netCardSales().insert({
        store_id: State.user.id, buyer_name: buyer, card_type: type,
        quantity: qty, total_price: total, paid: paymentType === 'full' ? total : 0,
        payment_type: paymentType, sale_date: Utils.today(),
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

  async addStock() {
    const type = DOM.val('ast');
    const qty  = parseInt(DOM.val('asq')) || 0;
    if (qty < 1) { Notify.error('أدخل الكمية'); return; }
    const { data: s } = await DB.netCardStock().select('id,quantity').eq('card_type', type).single();
    if (s) await DB.netCardStock().update({ quantity: s.quantity + qty, updated_at: new Date().toISOString() }).eq('id', s.id);
    else   await DB.netCardStock().insert({ store_id: State.user.id, card_type: type, quantity: qty });
    Notify.success('تم إضافة المخزون');
    Modal.close('m-addstock');
    DOM.get('asq').value = 50;
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
