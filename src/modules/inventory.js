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
    const low  = list.filter(i => i.quantity > 0 && i.quantity <= (i.low_stock_alert || 5));
    const out  = list.filter(i => i.quantity <= 0);

    const alerts = [
      ...out.map(i  => `<div class="alert ad"><i class="ti ti-alert-triangle"></i><span><strong>${Utils.escape(i.name)}</strong> — نفد المخزون 🔴</span></div>`),
      ...low.map(i  => `<div class="alert aw"><i class="ti ti-alert-circle"></i><span><strong>${Utils.escape(i.name)}</strong> — المتبقي: ${i.quantity} ${i.unit} 🟡</span></div>`),
    ];
    DOM.setHTML('invalerts', alerts.join(''));
    Inventory._renderList(list);
  },

  _existingProduct: null,

  async onBarcodeInput(val) {
    const alert  = document.getElementById('inv-bc-alert');
    const nameEl = document.getElementById('inv-bc-alert-name');
    Inventory._existingProduct = null;
    if (!val || val.length < 6) { if (alert) alert.style.display = 'none'; return; }

    // ابحث في الـ cache أولاً
    let found = State.inventory.find(i => i.barcode === val);
    if (!found) {
      const { data } = await DB.inventory().select('*').eq('barcode', val).maybeSingle();
      found = data;
    }

    if (found) {
      Inventory._existingProduct = found;
      // عبّي الاسم تلقائياً
      const nameInput = document.getElementById('inn');
      if (nameInput && !nameInput.value) nameInput.value = found.name;
      // أظهر التنبيه
      if (alert) alert.style.display = 'block';
      if (nameEl) nameEl.innerHTML =
        '<b>' + Utils.escape(found.name) + '</b>' +
        ' — الكمية الحالية: <b>' + found.quantity + ' ' + (found.unit || '') + '</b>' +
        ' — سعر البيع: <b>₪' + (found.sale_price || 0) + '</b>';
    } else {
      if (alert) alert.style.display = 'none';
    }
  },

  async updateExistingQty() {
    const p = Inventory._existingProduct;
    if (!p) return;
    const addQty = parseFloat(document.getElementById('inq')?.value) || 0;
    if (addQty <= 0) { Notify.error('أدخل الكمية المضافة'); return; }

    const newQty = p.quantity + addQty;
    try {
      const { error } = await DB.inventory().update({ quantity: newQty }).eq('id', p.id);
      if (error) throw error;
      Notify.success('تم تحديث كمية "' + p.name + '" إلى ' + newQty);
      Modal.close('m-inv');
      document.getElementById('inb').value = '';
      document.getElementById('inv-bc-alert').style.display = 'none';
      document.getElementById('inn').value = '';
      Inventory._existingProduct = null;
      await Inventory.load();
    } catch (err) { Notify.error(err.message); }
  },

  filterList(q) {
    const query  = (q || document.getElementById('inv-search')?.value || '').toLowerCase();
    const status = document.getElementById('inv-filter-status')?.value || '';
    const list   = State.inventory.filter(i => {
      const matchQ = !query || i.name?.toLowerCase().includes(query) || i.barcode?.includes(query);
      const qty    = i.quantity;
      const low    = i.low_stock_alert || 5;
      const matchS = !status
        || (status === 'out' && qty <= 0)
        || (status === 'low' && qty > 0 && qty <= low)
        || (status === 'ok'  && qty > low);
      return matchQ && matchS;
    });
    Inventory._renderList(list);
  },

  _renderList(list) {
    const getStatus = (i) => {
      if (i.quantity <= 0)                              return '<span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;">🔴 نفد</span>';
      if (i.quantity <= (i.low_stock_alert || 5))       return '<span style="background:#fef3c7;color:#d97706;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;">🟡 منخفض</span>';
      return '<span style="background:#dcfce7;color:#16a34a;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;">🟢 متوفر</span>';
    };
    DOM.setHTML('invlist', list.length
      ? list.map(i => `<tr>
          <td style="font-weight:700;">${Utils.escape(i.name)}</td>
          <td style="font-family:monospace;color:var(--g6);font-size:12px;">${i.barcode || '-'}</td>
          <td>${Utils.escape(i.category || '-')}</td>
          <td style="color:var(--p);font-weight:700;">${i.sale_price ? '₪' + i.sale_price.toFixed(2) : '-'}</td>
          <td style="color:var(--g6);">${i.cost_price ? '₪' + i.cost_price.toFixed(2) : '-'}</td>
          <td style="font-weight:700;">${i.quantity} ${Utils.escape(i.unit || '')}</td>
          <td>${getStatus(i)}</td>
          <td style="white-space:nowrap;display:flex;gap:4px;">
            <button class="ibb" onclick="Inventory.openEditModal('${i.id}','${Utils.escape(i.name)}',${i.quantity},${i.sale_price || 0})">تعديل</button>
            ${i.barcode ? `<button class="ibb" style="background:var(--pl);color:var(--p);border-color:var(--p);" onclick="Inventory.printBarcode('${i.id}')">🖨️</button>` : ''}
            <button class="ibr" onclick="Inventory.delete('${i.id}')">حذف</button>
          </td>
        </tr>`).join('')
      : '<tr class="er"><td colspan="8">لا يوجد منتجات</td></tr>'
    );
  },

  printBarcode(id) {
    const item = State.inventory.find(i => i.id === id);
    if (!item || !item.barcode) { Notify.error('لا يوجد باركود'); return; }

    const win = window.open('', '_blank', 'width=400,height=300');
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
      <style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;font-family:Cairo,sans-serif;}
      .label{text-align:center;padding:16px;border:1px dashed #ccc;border-radius:8px;}
      .name{font-size:13px;font-weight:700;margin-bottom:6px;color:#1e293b;}
      .price{font-size:15px;font-weight:900;color:#6366f1;margin-top:6px;}
      </style></head><body>
      <div class="label">
        <div class="name">${Utils.escape(item.name)}</div>
        <svg id="bc"></svg>
        <div class="price">${item.sale_price ? '₪' + item.sale_price.toFixed(2) : ''}</div>
      </div>
      <script>
        window.onload = function() {
          JsBarcode('#bc', '${item.barcode}', {format:'CODE128',width:2,height:60,displayValue:true,fontSize:14});
          setTimeout(() => { window.print(); window.close(); }, 500);
        };
      <\/script></body></html>`);
    win.document.close();
  },

  scanBarcode() {
    const overlay = document.getElementById('inv-scanner-overlay');
    if (overlay) overlay.style.display = 'flex';
    const container = document.getElementById('inv-scanner-container');
    if (container) { container.innerHTML = ''; container.style.height = (window.innerHeight - 50) + 'px'; }

    import('../services/BarcodeScanner.js').then(({ BarcodeScanner }) => {
      BarcodeScanner.start('inv-scanner-container', (code) => {
        const el = document.getElementById('inb');
        if (el) el.value = code;
        Inventory.stopScanner();
        Notify.success('✅ تم مسح الباركود: ' + code);
      }, (err) => {
        Notify.error(err);
        Inventory.stopScanner();
      });
    });
  },

  stopScanner() {
    import('../services/BarcodeScanner.js').then(({ BarcodeScanner }) => BarcodeScanner.stop());
    const overlay = document.getElementById('inv-scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    const container = document.getElementById('inv-scanner-container');
    if (container) { container.innerHTML = ''; container.style.height = ''; }
  },

  async toggleFlash() {
    const { BarcodeScanner } = await import('../services/BarcodeScanner.js');
    await BarcodeScanner.toggleFlash();
  },

  async save() {
    const name = DOM.val('inn');
    if (!name) { Notify.error('أدخل اسم الصنف'); return; }
    State.isMutating = true;
    try {
      const { error } = await DB.inventory().insert({
        store_id:        State.user.id,
        name,
        barcode:         DOM.val('inb') || null,
        category:        DOM.val('inc'),
        unit:            DOM.val('inu'),
        quantity:        parseFloat(DOM.val('inq')) || 0,
        sale_price:      parseFloat(DOM.val('insp')) || 0,
        cost_price:      parseFloat(DOM.val('incp')) || 0,
        low_stock_alert: parseFloat(DOM.val('ina')) || CONFIG.lowStockDefault,
      });
      if (error) throw error;
      Notify.success('تم إضافة الصنف');
      Modal.close('m-inv');
      DOM.clearInputs('inn', 'insp', 'incp');
      await Promise.all([Inventory.loadList(), Inventory.load()]);
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
