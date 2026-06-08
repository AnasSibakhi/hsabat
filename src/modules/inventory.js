/**
 * inventory.js — Inventory Module
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
// 18. INVENTORY MODULE
// ─────────────────────────────────────────
const Inventory = {
  async loadList() {
    const { data } = await DB.inventory().select('*').order('name');
    State.inventory = data || [];
  },

  async load() {
    await Inventory.loadList();
    const list = State.inventory;
    const low  = list.filter(i => i.quantity <= i.low_stock_alert);

    DOM.setHTML('invalerts', low.map(i =>
      `<div class="alert aw"><i class="ti ti-alert-circle"></i><span><strong>${Utils.escape(i.name)}</strong> — المتبقي: ${i.quantity} ${i.unit}</span></div>`
    ).join(''));

    DOM.setHTML('invlist', list.length
      ? list.map(i => `<tr>
          <td>${Utils.escape(i.name)}</td>
          <td>${Utils.escape(i.category)}</td>
          <td>${i.quantity} ${Utils.escape(i.unit)}</td>
          <td>${i.sale_price ? '₪' + i.sale_price : '-'}</td>
          <td>${i.quantity <= i.low_stock_alert ? '<span class="br">قارب النفاد</span>' : '<span class="bg">متوفر</span>'}</td>
          <td><button class="ibb" onclick="Inventory.openEditModal('${i.id}','${Utils.escape(i.name)}',${i.quantity},${i.sale_price || 0})">تعديل</button></td>
          <td><button class="ibr" onclick="Inventory.delete('${i.id}')">حذف</button></td>
        </tr>`).join('')
      : '<tr class="er"><td colspan="7">لا يوجد مخزون</td></tr>'
    );
  },

  async save() {
    const name = DOM.val('inn');
    if (!name) { Notify.error('أدخل اسم الصنف'); return; }
    State.isMutating = true;
    try {
      const { error } = await DB.inventory().insert({
        store_id:        State.user.id,
        name,
        category:        DOM.val('inc'),
        unit:            DOM.val('inu'),
        quantity:        parseFloat(DOM.val('inq')) || 0,
        sale_price:      parseFloat(DOM.val('insp')) || 0,
        low_stock_alert: parseFloat(DOM.val('ina')) || CONFIG.lowStockDefault,
      });
      if (error) throw error;
      Notify.success('تم إضافة الصنف');
      Modal.close('m-inv');
      DOM.clearInputs('inn', 'insp');
      await Inventory.load();
    } catch (err) { Notify.error(err.message); }
    finally { setTimeout(() => { State.isMutating = false; }, 500); }
  },

  openEditModal(id, name, qty, price) {
    DOM.get('einvid').value  = id;
    DOM.get('einvname').value = name;
    DOM.get('einvqty').value  = qty;
    DOM.get('einvprice').value = price;
    Modal.open('m-editinv');
  },

  async update() {
    const id    = DOM.val('einvid');
    const qty   = parseFloat(DOM.val('einvqty'));
    const price = parseFloat(DOM.val('einvprice')) || 0;
    await DB.inventory().update({ quantity: qty, sale_price: price }).eq('id', id);
    Notify.success('تم التحديث');
    Modal.close('m-editinv');
    await Inventory.load();
  },

  async delete(id) {
    if (!confirm('حذف؟')) return;
    await DB.inventory().delete().eq('id', id);
    Notify.success('تم');
    await Inventory.load();
  },

  /** Deduct quantities after a sale — called by Invoices and QuickSale */
  async deductItems(items) {
    for (const item of items) {
      if (!item.inventory_id) continue;
      const { data } = await DB.inventory().select('quantity').eq('id', item.inventory_id).single();
      if (data) await DB.inventory().update({ quantity: Math.max(0, data.quantity - item.quantity) }).eq('id', item.inventory_id);
    }
  },
};

export { Inventory };
