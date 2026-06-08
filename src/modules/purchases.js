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



// ─────────────────────────────────────────
// 19. PURCHASES MODULE
// ─────────────────────────────────────────
const Purchases = {
  async load() {
    const { data } = await DB.purchases().select('*').order('purchase_date', { ascending: false });
    DOM.setHTML('purlist', (data || []).length
      ? data.map(p => `<tr>
          <td>${Utils.escape(p.supplier)}</td>
          <td>${Utils.escape(p.product_name)}</td>
          <td>${p.quantity}</td>
          <td>₪${p.cost.toFixed(2)}</td>
          <td>${p.purchase_date}</td>
          <td><button class="ibr" onclick="Purchases.delete('${p.id}')">حذف</button></td>
        </tr>`).join('')
      : '<tr class="er"><td colspan="6">لا توجد مشتريات</td></tr>'
    );
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
      await window.Inventory.load();
      await Purchases.load();
      await window.Dashboard.load();
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    await DB.purchases().delete().eq('id', id);
    Notify.success('تم');
    await Purchases.load();
  },
};

export { Purchases };
