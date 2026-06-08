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
          + '<td>' + (p.supplier_phone ? '<a href="tel:' + p.supplier_phone + '" style="color:var(--p);">' + Utils.escape(p.supplier_phone) + '</a>' : '-') + '</td>'
          + '<td>' + Utils.escape(p.invoice_ref || '-') + '</td>'
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



  async save() {
    const supplier = DOM.val('pus');
    const manual   = DOM.val('pup');
    const cost     = parseFloat(DOM.val('puc'));
    const qty      = parseFloat(DOM.val('puq')) || 1;

    const salePrice = parseFloat(DOM.val('pus-price'));
    if (!manual)                      { Notify.error('أدخل اسم الصنف');       return; }
    if (!cost || cost <= 0)           { Notify.error('أدخل التكلفة الإجمالية'); return; }
    if (!salePrice || salePrice <= 0) { Notify.error('أدخل سعر البيع');        return; }
    if (!supplier)                    { Notify.error('أدخل اسم المورد');        return; }

    const productName = manual;
    const invId = null;

    const supplierPhone   = DOM.val('pus-phone');
    const invoiceNumber   = DOM.val('pus-invoice');

    State.isMutating = true;
    try {
      const { error } = await DB.purchases().insert({
        store_id: State.user.id, supplier, product_name: productName,
        quantity: qty, cost, purchase_date: DOM.val('pud'),
        supplier_phone: supplierPhone || null,
        invoice_ref:    invoiceNumber || null,
      });
      if (error) throw error;

      // ربط المخزون — ابحث عن الصنف بالاسم وأضف الكمية
      const unit = DOM.get('pu-unit')?.value || 'قطعة (pcs)';
      const { data: existing } = await DB.inventory().select('id,quantity').eq('name', productName).maybeSingle();

      if (existing) {
        // صنف موجود — أضف الكمية وحدّث سعر البيع
        await DB.inventory().update({
          quantity:   existing.quantity + qty,
          sale_price: salePrice,
        }).eq('id', existing.id);
        Notify.success('تم — المجموع: ' + (existing.quantity + qty) + ' — سعر البيع: ₪' + salePrice);
      } else {
        // صنف جديد — أنشئه في المخزون
        await DB.inventory().insert({
          store_id:        State.user.id,
          name:            productName,
          category:        'عام',
          unit:            unit,
          quantity:        qty,
          sale_price:      salePrice,
          low_stock_alert: CONFIG.lowStockDefault,
        });
        Notify.success('تم — أُضيف "' + productName + '" — سعر البيع: ₪' + salePrice);
      }

      // تحديث كاش المخزون
      await getInventory()?.loadList();

      Modal.close('m-pur');
      DOM.clearInputs('pus', 'pup', 'puc');
      DOM.get('pur-inv-sel').value = '';
      const puq = DOM.get('puq'); if (puq) puq.value = '1';
      const puu      = DOM.get('puu');      if (puu)      puu.value      = '';
      const pusPrice = DOM.get('pus-price'); if (pusPrice) pusPrice.value = '';
      const phone = DOM.get('pus-phone'); if (phone) phone.value = '';
      const invno = DOM.get('pus-invoice');if (invno) invno.value = '';
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
    document.getElementById('edit-pur-phone').value    = p.supplier_phone || '';
    document.getElementById('edit-pur-invoice').value  = p.invoice_ref || '';
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
      const phone = document.getElementById('edit-pur-phone').value.trim();
      const invno = document.getElementById('edit-pur-invoice').value.trim();
      const { error } = await DB.purchases().update({
        supplier, product_name: product, quantity: qty, cost, purchase_date: date,
        supplier_phone: phone || null,
        invoice_ref:    invno || null,
      }).eq('id', id);
      if (error) throw error;
      Notify.success('تم التعديل');
      window.Modal.close('m-edit-pur');
      await Purchases.load();
      // Scroll content area back to top
      const contentEl = document.querySelector('.content');
      if (contentEl) contentEl.scrollTop = 0;
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
