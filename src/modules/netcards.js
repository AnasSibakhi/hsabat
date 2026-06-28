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
    const buyer     = DOM.val('nsb');
    const type      = DOM.val('nst');
    const qty       = parseInt(DOM.val('nsq')) || 0;
    const batchId   = DOM.val('ns-supplier');
    if (!buyer)   { Notify.error('أدخل اسم المشتري'); return; }
    if (qty < 1)  { Notify.error('أدخل العدد'); return; }
    if (!batchId) { Notify.error('اختاري المورد اللي بدك تبيعي من مخزونه'); return; }

    if (!navigator.onLine) { Notify.error('📡 لا يوجد اتصال — لا يمكن التحقق من المخزون حالياً'); return; }

    const { data: batch } = await DB.netCardPurchases().select('id,remaining_qty,final_cost,supplier_name').eq('id', batchId).maybeSingle();
    if (!batch || batch.remaining_qty < qty) { Notify.error('مخزون هذا المورد غير كافٍ — المتبقي: ' + (batch?.remaining_qty || 0)); return; }

    const { data: stock } = await DB.netCardStock().select('id,quantity').eq('card_type', type).maybeSingle();
    if (!stock || stock.quantity < qty) { Notify.error('المخزون الإجمالي غير كافٍ — المتبقي: ' + (stock?.quantity || 0)); return; }

    const total = parseInt(type) * qty;
    const paymentType = document.querySelector('input[name="nsp"]:checked').value;

    State.isMutating = true;
    try {
      const { error } = await DB.netCardSales().insert({
        store_id: State.user.id, buyer_name: buyer, card_type: type,
        quantity: qty, total_price: total, paid: paymentType === 'full' ? total : 0,
        payment_type: paymentType, sale_date: Utils.today(),
        cost_at_sale: batch.final_cost || 0,
        supplier_name: batch.supplier_name || null,
      });
      if (error) throw error;
      // خصم من الدفعة المحدَّدة بالاسم + من الإجمالي المُجمَّع
      await DB.netCardPurchases().update({ remaining_qty: batch.remaining_qty - qty }).eq('id', batch.id);
      await DB.netCardStock().update({ quantity: stock.quantity - qty, updated_at: new Date().toISOString() }).eq('id', stock.id);
      Notify.success('تم تسجيل البيع');
      Modal.close('m-netsale');
      DOM.clearInputs('nsb');
      DOM.get('nsq').value = 1;
      NetCards.calcTotal();
      await Promise.all([NetCards.loadStock(), NetCards.loadSales('day')]);
    } catch (err) { const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine; Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — لم يُسجَّل البيع، تحققي من المخزون قبل إعادة المحاولة' : (err.message || 'فشل تسجيل البيع')); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async loadSupplierBatches() {
    const type = DOM.val('nst');
    const sel  = DOM.get('ns-supplier');
    if (!sel) return;
    sel.innerHTML = '<option value="">جاري التحميل...</option>';

    const { data } = await DB.netCardPurchases()
      .select('id,supplier_name,remaining_qty,purchase_date')
      .eq('card_type', type)
      .gt('remaining_qty', 0)
      .order('purchase_date', { ascending: true });

    const batches = data || [];
    if (!batches.length) {
      sel.innerHTML = '<option value="">⚠️ لا يوجد مخزون من أي مورد لهذا النوع</option>';
      return;
    }

    sel.innerHTML = batches.map(b =>
      `<option value="${b.id}">${Utils.escape(b.supplier_name || 'مورد غير محدد')} — متبقي ${b.remaining_qty} (${b.purchase_date})</option>`
    ).join('');
  },

  async loadSupplierSuggestions() {
    const { data } = await DB.netCardPurchases().select('supplier_name').order('created_at', { ascending: false }).limit(100);
    const seen = new Map();
    (data || []).forEach(r => {
      const raw = (r.supplier_name || '').trim();
      if (!raw) return;
      const normalized = raw.replace(/\s+/g, ' ').toLowerCase();
      if (!seen.has(normalized)) seen.set(normalized, raw); // أول ظهور (الأحدث، بسبب الترتيب) يحدد الشكل المعروض
    });
    const names = [...seen.values()];
    const list = DOM.get('ast-supplier-list');
    if (list) list.innerHTML = names.map(n => `<option value="${Utils.escape(n)}"></option>`).join('');
  },

  autofillPrice() {
    const type = DOM.val('ast');
    DOM.get('asp').value = type;
    NetCards.calcStockCost();
  },

  calcStockCost() {
    const type     = DOM.val('ast');
    const price    = parseFloat(DOM.val('asp')) || 0;
    const discount = parseFloat(DOM.val('asd')) || 0;
    const multiplier = parseInt(type) || 1;
    const costPerCard = price * (1 - discount / 100);
    const costPerUnit = costPerCard / multiplier;
    const el = DOM.get('ast-final-cost');
    if (el) el.textContent = '₪' + costPerCard.toFixed(3) + ' للبطاقة (₪' + costPerUnit.toFixed(3) + ' للوحدة بالمخزون)';
  },

  async addStock() {
    const type       = DOM.val('ast');
    const supplier   = DOM.val('ast-supplier').trim();
    const enteredQty = parseInt(DOM.val('asq')) || 0;
    const price      = parseFloat(DOM.val('asp')) || 0;
    const discount   = parseFloat(DOM.val('asd')) || 0;
    if (enteredQty < 1) { Notify.error('أدخل الكمية'); return; }

    // كل بطاقة من نوع "2 شيكل" أو "3 شيكل" تساوي فعلياً 2 أو 3 وحدات بالمخزون — تُضرَب تلقائياً عند الشراء
    const multiplier = parseInt(type) || 1;
    const qty = enteredQty * multiplier;

    // تكلفة البطاقة الواحدة (بعد الخصم)، مقسومة على عدد الوحدات بداخلها = تكلفة الوحدة الواحدة الحقيقية بالمخزون
    const costPerCard = price * (1 - discount / 100);
    const finalCost    = costPerCard / multiplier;

    try {
      const { data: s } = await DB.netCardStock().select('id,quantity,cost_price').eq('card_type', type).maybeSingle();
      if (s) {
        // متوسط مرجّح للتكلفة لو كان فيه مخزون قديم بتكلفة مختلفة (دقة أعلى لحساب الربح)
        const oldQty  = s.quantity || 0;
        const oldCost = s.cost_price || 0;
        const newAvgCost = (oldQty + qty) > 0 ? ((oldQty * oldCost) + (qty * finalCost)) / (oldQty + qty) : finalCost;
        await DB.netCardStock().update({ quantity: oldQty + qty, cost_price: newAvgCost, updated_at: new Date().toISOString() }).eq('id', s.id);
      } else {
        await DB.netCardStock().insert({ store_id: State.user.id, card_type: type, quantity: qty, cost_price: finalCost });
      }

      // سجل كامل لهذي دفعة الشراء بالذات، مع اسم المورد الخاص بها (الكمية المسجَّلة هي الفعلية بعد الضرب)
      await DB.netCardPurchases().insert({
        store_id: State.user.id, card_type: type, supplier_name: supplier || null,
        quantity: qty, remaining_qty: qty, unit_price: price, discount_pct: discount, final_cost: finalCost,
        purchase_date: Utils.today(),
      });

      Notify.success('تم إضافة المخزون' + (finalCost > 0 ? ' — التكلفة: ₪' + finalCost.toFixed(3) + '/وحدة' : ''));
      Modal.close('m-addstock');
      DOM.get('asq').value = 100;
      DOM.clearInputs('asd', 'ast-supplier');
      NetCards.autofillPrice();
      DOM.get('ast-final-cost').textContent = '₪0.00';
      await NetCards.loadStock();
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — لم يُضاف المخزون، تحققي قبل إعادة المحاولة لتجنّب تكرار الإضافة' : (err.message || 'فشل إضافة المخزون'));
    }
  },


  async deleteSale(id) {
    if (!confirm('حذف؟')) return;
    try {
      await DB.netCardSales().delete().eq('id', id);
      Notify.success('تم');
      await NetCards.loadSales('day');
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — لم يُحذف البيع، حاولي مرة أخرى' : (err.message || 'فشل حذف البيع'));
    }
  },
};

export { NetCards };
