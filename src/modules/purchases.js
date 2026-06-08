/**
 * purchases.js — Purchases Module
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
import { getDashboard, getInventory } from '../core/registry.js';




// ─────────────────────────────────────────
// 19. PURCHASES MODULE
// ─────────────────────────────────────────
const Purchases = {
  async load() {
    const { data } = await DB.purchases().select('*').order('purchase_date', { ascending: false });
    // Cache for edit
    Purchases._cache = {};
    (data || []).forEach(p => { Purchases._cache[p.id] = p; });

    DOM.setHTML('purlist', (data || []).length
      ? data.map(p => '<tr>'
          + '<td>' + Utils.escape(p.supplier) + '</td>'
          + '<td>' + Utils.escape(p.product_name) + '</td>'
          + '<td>' + p.quantity + '</td>'
          + '<td>₪' + p.cost.toFixed(2) + '</td>'
          + '<td>' + p.purchase_date + '</td>'
          + '<td>'
          + '<button class="ibb" onclick="Purchases.openEdit(\'' + p.id + '\')" style="margin-left:4px;">تعديل</button>'
          + '<button class="ibr" onclick="Purchases.delete(\'' + p.id + '\')">حذف</button>'
          + '</td>'
          + '</tr>').join('')
      : '<tr class="er"><td colspan="6">لا توجد مشتريات</td></tr>'
    );
  },

  calcTotal() {
    const qty      = parseFloat(document.getElementById('puq')?.value) || 0;
    const unitCost = parseFloat(document.getElementById('puu')?.value) || 0;
    const totalEl  = document.getElementById('puc');
    if (totalEl && qty > 0 && unitCost > 0) {
      totalEl.value = (qty * unitCost).toFixed(2);
      totalEl.style.background = 'var(--sl)';
      totalEl.style.color      = 'var(--s)';
    }
  },

  fillInventorySelect() {
    const select = DOM.get('pur-inv-sel');
    if (!select) return;
    if (State.inventory.length) {
      select.innerHTML = '<option value="">-- اختر من المخزون --</option>' +
        State.inventory.map(i => `<option value="${i.id}" data-name="${Utils.escape(i.name)}">${Utils.escape(i.name)} (${i.quantity} ${i.unit || ''})</option>`).join('');
    } else {
      Purchases._fillFromServer(select);
    }
  },

  async _fillFromServer(select) {
    select.innerHTML = '<option value="">⏳ جاري التحميل...</option>';
    const { data } = await DB.inventory().select('id,name,quantity,unit').order('name');
    State.inventory = data || [];
    Purchases.fillInventorySelect();
  },

  onInventorySelect(select) {
    const name = select.options[select.selectedIndex]?.getAttribute('data-name') || '';
    const input = DOM.get('pup');
    if (input) input.placeholder = name ? 'تم الاختيار: ' + name : 'اتركه فارغاً لو اخترت من فوق';
  },

  async save() {
    const supplier = DOM.val('pus');
    const invId    = DOM.val('pur-inv-sel');
    const manual   = DOM.val('pup');
    const cost     = parseFloat(DOM.val('puc'));
    const qty      = parseFloat(DOM.val('puq')) || 1;

    if (!supplier)          { Notify.error('أدخل اسم المورد'); return; }
    if (!cost || cost <= 0) { Notify.error('أدخل التكلفة');   return; }
    if (!invId && !manual)  { Notify.error('اختر صنف أو اكتب اسماً'); return; }

    const productName = invId ? (State.inventory.find(i => i.id === invId)?.name || manual) : manual;

    State.isMutating = true;
    try {
      const { error } = await DB.purchases().insert({
        store_id: State.user.id, supplier, product_name: productName,
        quantity: qty, cost, purchase_date: DOM.val('pud'),
      });
      if (error) throw error;

      // Update inventory
      if (invId) {
        const { data: fresh } = await DB.inventory().select('quantity').eq('id', invId).single();
        const newQty = (fresh?.quantity || 0) + qty;
        await DB.inventory().update({ quantity: newQty }).eq('id', invId);
        Notify.success(`أضيف ${qty} لـ "${productName}" — المجموع: ${newQty}`);
      } else {
        const unit = DOM.get('pu-unit')?.value || 'قطعة (pcs)';
        await DB.inventory().insert({ store_id: State.user.id, name: productName, category: 'عام', quantity: qty, unit, low_stock_alert: CONFIG.lowStockDefault, sale_price: 0 });
        Notify.success(`أُضيف "${productName}" للمخزون`);
      }

      Modal.close('m-pur');
      DOM.clearInputs('pus', 'pup', 'puc');
      DOM.get('pur-inv-sel').value = '';
      const puq = DOM.get('puq'); if (puq) puq.value = '1';
      const puu = DOM.get('puu'); if (puu) puu.value = '';
      const pud = DOM.get('pud'); if (pud) pud.value = new Date().toISOString().split('T')[0];
      const inp = DOM.get('pup'); if (inp) inp.placeholder = 'اتركه فارغاً لو اخترت من فوق';
      await getInventory().load();
      await Purchases.load();
      await getDashboard().load();
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  openEdit(id) {
    const p = Purchases._cache[id];
    if (!p) { Notify.error('لم يُوجد السجل'); return; }
    document.getElementById('edit-pur-id').value       = p.id;
    document.getElementById('edit-pur-supplier').value = p.supplier || '';
    document.getElementById('edit-pur-product').value  = p.product_name || '';
    document.getElementById('edit-pur-qty').value      = p.quantity || 1;
    document.getElementById('edit-pur-cost').value     = p.cost || '';
    document.getElementById('edit-pur-date').value     = p.purchase_date || '';
    window.Modal.open('m-edit-pur');
  },

  async updatePurchase() {
    const id       = document.getElementById('edit-pur-id').value;
    const supplier = document.getElementById('edit-pur-supplier').value.trim();
    const product  = document.getElementById('edit-pur-product').value.trim();
    const qty      = parseFloat(document.getElementById('edit-pur-qty').value) || 1;
    const cost     = parseFloat(document.getElementById('edit-pur-cost').value);
    const date     = document.getElementById('edit-pur-date').value;

    if (!supplier) { Notify.error('أدخل اسم المورد'); return; }
    if (!cost || cost <= 0) { Notify.error('أدخل التكلفة'); return; }

    try {
      const { error } = await DB.purchases().update({
        supplier, product_name: product, quantity: qty, cost, purchase_date: date,
      }).eq('id', id);
      if (error) throw error;
      Notify.success('تم التعديل');
      window.Modal.close('m-edit-pur');
      await Purchases.load();
    } catch(err) { Notify.error(err.message); }
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    await DB.purchases().delete().eq('id', id);
    Notify.success('تم');
    await Purchases.load();
  },
};

export { Purchases };
