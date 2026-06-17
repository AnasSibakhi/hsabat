/**
 * inventory.js — Inventory Module
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
import { FIFOService }    from '../services/FIFOService.js';
import { BarcodeScanner } from '../services/BarcodeScanner.js';
import { Guard }          from '../core/ratelimit.js';

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

  openExistingEdit() {
    const p = Inventory._existingProduct;
    if (!p) return;
    Modal.close('m-inv');
    document.getElementById('inv-bc-alert').style.display = 'none';
    document.getElementById('inb').value = '';
    document.getElementById('inn').value = '';
    Inventory._existingProduct = null;
    Inventory.openEditModal(p.id);
  },


  async openProduct(id) {
    const item = State.inventory.find(i => i.id === id);
    if (!item) return;
    window._prodId = id;

    // المعلومات الأساسية
    document.getElementById('prod-title').textContent     = item.name;
    document.getElementById('prod-name').textContent      = item.name;
    document.getElementById('prod-barcode').textContent   = item.barcode ? '📊 ' + item.barcode : '';
    document.getElementById('prod-sale-price').textContent= item.sale_price ? '₪' + item.sale_price.toFixed(2) : '-';
    document.getElementById('prod-cost-price').textContent= item.cost_price ? '₪' + item.cost_price.toFixed(2) : '-';
    document.getElementById('prod-qty').textContent       = item.quantity + ' ' + (item.unit || '');
    document.getElementById('prod-category').textContent  = item.category || '';

    // الشركة/العلامة التجارية
    const brandEl = document.getElementById('prod-brand');
    if (brandEl) {
      if (item.brand) {
        brandEl.textContent    = '🏭 ' + item.brand;
        brandEl.style.display  = 'inline-block';
      } else {
        brandEl.style.display  = 'none';
      }
    }

    // الوحدة
    const unitEl = document.getElementById('prod-unit');
    if (unitEl) unitEl.textContent = item.unit || '';

    // هامش الربح
    const margin = item.sale_price && item.cost_price && item.cost_price > 0
      ? (((item.sale_price - item.cost_price) / item.cost_price) * 100).toFixed(1) + '%'
      : '-';
    document.getElementById('prod-margin').textContent = margin;

    // حالة المخزون
    const statusEl = document.getElementById('prod-status-badge');
    if (item.quantity <= 0)
      statusEl.innerHTML = '<span style="background:#fee2e2;color:#dc2626;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:800;">🔴 نفد</span>';
    else if (item.quantity <= (item.low_stock_alert || 5))
      statusEl.innerHTML = '<span style="background:#fef3c7;color:#d97706;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:800;">🟡 منخفض</span>';
    else
      statusEl.innerHTML = '<span style="background:#dcfce7;color:#16a34a;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:800;">🟢 متوفر</span>';

    // زر الطباعة
    const printBtn = document.getElementById('prod-print-btn');
    if (printBtn) printBtn.style.display = item.barcode ? 'flex' : 'none';

    Nav.goTo('product');

    // سجل المشتريات — مع سعر البيع
    const { data: purchases } = await DB.purchases()
      .select('supplier, quantity, cost, sale_price, purchase_date')
      .eq('product_name', item.name)
      .order('purchase_date', { ascending: false })
      .limit(10);

    document.getElementById('prod-purchases-list').innerHTML = (purchases || []).length
      ? purchases.map(p => `<tr>
          <td style="color:#1e293b;font-weight:600;">${Utils.escape(p.supplier)}</td>
          <td>${p.quantity}</td>
          <td>₪${p.cost.toFixed(2)}</td>
          <td style="color:var(--p);font-weight:700;">${p.sale_price ? '₪'+p.sale_price.toFixed(2) : '-'}</td>
          <td style="color:#64748b;">${p.purchase_date}</td>
        </tr>`).join('')
      : '<tr class="er"><td colspan="5">لا يوجد سجل مشتريات</td></tr>';

    // سجل المبيعات
    const { data: soldItems } = await sb.from('invoice_items')
      .select('quantity, price, invoices(id, invoice_date, invoice_number)')
      .eq('inventory_id', id)
      .order('created_at', { ascending: false })
      .limit(15);

    let totalSold = 0, totalRevenue = 0, totalProfit = 0;
    const salesRows = [];

    (soldItems || []).forEach(it => {
      const qty    = it.quantity || 1;
      const price  = it.price   || 0;
      const profit = (price - (item.cost_price || 0)) * qty;
      totalSold    += qty;
      totalRevenue += price * qty;
      totalProfit  += profit;
      const inv    = it.invoices;
      salesRows.push(`<tr>
        <td style="color:var(--p);font-weight:700;">${inv?.invoice_number || '#' + (inv?.id?.slice(-4) || '-')}</td>
        <td>${qty}</td>
        <td style="color:var(--s);font-weight:700;">₪${price.toFixed(2)}</td>
        <td style="color:#64748b;">${inv?.invoice_date || '-'}</td>
      </tr>`);
    });

    document.getElementById('prod-total-sold').textContent    = totalSold + ' وحدة';
    document.getElementById('prod-total-revenue').textContent = '₪' + totalRevenue.toFixed(2);
    document.getElementById('prod-total-profit').textContent  = '₪' + totalProfit.toFixed(2);
    document.getElementById('prod-sales-list').innerHTML      = salesRows.length
      ? salesRows.join('')
      : '<tr class="er"><td colspan="4">لا يوجد مبيعات</td></tr>';

    // ── FIFO: طبقات المخزون ──
    const batchesSection = document.getElementById('prod-fifo-section');
    if (batchesSection) {
      try {
        const batches = await FIFOService.getBatches(id);
        if (batches.length) {
          let totalVal = 0;
          const rows = batches.map((b, i) => {
            const val = b.quantity_remaining * b.cost_price;
            totalVal += val;
            return `<tr>
              <td style="font-weight:700;color:var(--p);">طبقة ${i + 1}</td>
              <td style="color:#64748b;">${b.purchase_date}</td>
              <td style="font-weight:700;">${b.quantity_remaining}</td>
              <td style="color:var(--d);font-weight:700;">₪${b.cost_price.toFixed(2)}</td>
              <td style="color:var(--s);font-weight:700;">₪${val.toFixed(2)}</td>
            </tr>`;
          }).join('');
          batchesSection.innerHTML = `
            <div class="sec-hdr" style="margin-top:16px;">
              <span class="sec-title">🏷️ طبقات المخزون (FIFO)</span>
              <span style="font-size:12px;color:var(--g5);">القيمة الإجمالية: ₪${totalVal.toFixed(2)}</span>
            </div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead><tr>
                  <th>الطبقة</th><th>تاريخ الشراء</th>
                  <th>المتبقي</th><th>تكلفة الوحدة</th><th>القيمة</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
        } else {
          batchesSection.innerHTML = `
            <div class="sec-hdr" style="margin-top:16px;">
              <span class="sec-title">🏷️ طبقات المخزون (FIFO)</span>
            </div>
            <p style="color:var(--g4);font-size:13px;padding:8px 0;">لا توجد طبقات — سيُضاف تلقائياً عند الشراء</p>`;
        }
      } catch (e) {
        if (batchesSection) batchesSection.innerHTML = '';
      }
    }
  },

  filterList(q) {
    const query  = (q || document.getElementById('inventory-search')?.value || '').toLowerCase();
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
    const getStatusBadge = (i) => {
      if (i.quantity <= 0)                        return { cls: 'b-out', label: 'نفد' };
      if (i.quantity <= (i.low_stock_alert || 5))  return { cls: 'b-low', label: 'منخفض' };
      return { cls: 'b-ok', label: 'متوفر' };
    };
    const CAT_COLOR = {
      'مواد غذائية': '#0e9f6e', 'مشروبات': '#c27803', 'حلويات': '#c81e1e',
      'منظفات': '#1a56db', 'مستلزمات شخصية': '#7c3aed', 'خضار وفواكه': '#0e9f6e',
      'ألبان': '#1a56db', 'لحوم': '#c81e1e', 'مخبوزات': '#c27803',
    };

    DOM.setHTML('invlist', list.length
      ? list.map(i => {
          const status = getStatusBadge(i);
          const color  = CAT_COLOR[i.category] || 'var(--p)';
          return `<div class="prod-card" onclick="Inventory.openProduct('${i.id}')" style="--cat-color:${color};">
            <div class="prod-card-top">
              <span class="prod-cat-label" style="color:${color};">${Utils.escape(i.category || 'عام')}</span>
              <span class="prod-badge ${status.cls}">${status.label}</span>
            </div>
            <div class="prod-name">${Utils.escape(i.name)}</div>
            <div class="prod-meta">${Utils.escape(i.unit || '-')}${i.barcode ? ' · <span style="font-family:monospace;">' + i.barcode + '</span>' : ''}</div>
            <div class="prod-price-row">
              <div>
                <span class="prod-price-label">سعر البيع (للوحدة)</span>
                <span class="prod-price">${i.sale_price ? '₪' + i.sale_price.toFixed(2) : '-'}</span>
                ${i.cost_price ? '<span class="prod-cost">تكلفة الشراء ₪' + i.cost_price.toFixed(2) + '</span>' : ''}
                ${(i.sale_price && i.cost_price && i.cost_price > 0) ? '<span class="prod-margin">هامش الربح ' + (((i.sale_price - i.cost_price) / i.cost_price) * 100).toFixed(0) + '%</span>' : ''}
              </div>
              <div style="text-align:left;">
                <span class="prod-price-label">الكمية المتوفرة</span>
                <span class="prod-qty">${i.quantity} ${Utils.escape(i.unit || '')}</span>
              </div>
            </div>
            <div class="prod-actions">
              <button class="ibb" onclick="event.stopPropagation();Inventory.openEditModal('${i.id}')">تعديل</button>
              <button class="ibb" onclick="event.stopPropagation();Inventory.openProduct('${i.id}')">تفاصيل</button>
              ${i.barcode ? `<button class="ibb" style="background:var(--pl);color:var(--p);border-color:var(--p);" onclick="event.stopPropagation();Inventory.printBarcode('${i.id}')">🖨️</button>` : ''}
              <button class="ibr" onclick="event.stopPropagation();Inventory.delete('${i.id}')">حذف</button>
            </div>
          </div>`;
        }).join('')
      : '<div class="er" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--g5);">لا يوجد منتجات</div>'
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

  // ── Beep — نفس البيع السريع ──
  _beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 1200;
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.12);
    } catch {}
  },

  scanBarcode() {
    if (BarcodeScanner.isActive()) return;
    // أمان: حرر أي قفل معلّق على زر الحفظ قبل فتح الكاميرا
    Guard.release('save-inventory');
    Modal.close('m-inv');
    setTimeout(() => Inventory._openScanner('inb', 'm-inv'), 200);
  },

  scanBarcodeEdit() {
    if (BarcodeScanner.isActive()) return;
    Guard.release('update-inventory');
    Modal.close('m-editinv');
    setTimeout(() => Inventory._openScanner('einvbarcode', 'm-editinv'), 200);
  },

  _openScanner(targetId, returnModal) {
    const overlay   = document.getElementById('inv-scanner-overlay');
    const container = document.getElementById('inv-scanner-container');
    const hintEl    = document.querySelector('#inv-scanner-overlay p');

    if (hintEl)    hintEl.textContent = 'ضع الباركود داخل المربع';
    if (overlay)   overlay.style.display = 'flex';
    if (container) { container.innerHTML = ''; container.style.height = (window.innerHeight - 50) + 'px'; }

    BarcodeScanner.start('inv-scanner-container',
      (code) => {
        // نجح المسح
        Inventory._beep();
        const el = document.getElementById(targetId);
        if (el) {
          el.value = code;
          if (targetId === 'inb') Inventory.onBarcodeInput(code);
        }
        Inventory.stopScanner();
        if (returnModal) setTimeout(() => Modal.open(returnModal), 150);
        Notify.success('✅ ' + code);
      },
      (err) => {
        Notify.error(err || 'لا يمكن فتح الكاميرا');
        Inventory.stopScanner();
        if (returnModal) setTimeout(() => Modal.open(returnModal), 150);
      }
    );
  },

  stopScanner() {
    BarcodeScanner.stop();
    const overlay = document.getElementById('inv-scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    const container = document.getElementById('inv-scanner-container');
    if (container) { container.innerHTML = ''; container.style.height = ''; }
  },

  async toggleFlash() {
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
        brand:           DOM.val('inbrand') || null,
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

  // ═══════════════════════════════════════════
  // BULK SCAN — إضافة منتجات بالباركود أول بأول
  // ═══════════════════════════════════════════
  _bulkCount: 0,

  startBulkScan() {
    if (BarcodeScanner.isActive()) return;
    Guard.release('save-inventory');
    Modal.close('m-inv');
    Inventory._bulkCount = 0;
    Inventory._updateBulkCounter();
    setTimeout(() => Inventory._openBulkScanner(), 200);
  },

  _openBulkScanner() {
    const overlay   = document.getElementById('inv-bulk-overlay');
    const container = document.getElementById('inv-bulk-container');
    const hintEl    = document.getElementById('inv-bulk-hint');

    if (hintEl)    hintEl.textContent = 'ضع الباركود داخل المربع';
    if (overlay)   overlay.style.display = 'flex';
    if (container) { container.innerHTML = ''; container.style.height = (window.innerHeight - 50) + 'px'; }

    BarcodeScanner.start('inv-bulk-container',
      (code) => Inventory._onBulkScanned(code),
      (err)  => { Notify.error(err || 'لا يمكن فتح الكاميرا'); Inventory.stopBulkScan(); }
    );
  },

  async _onBulkScanned(code) {
    Inventory._beep();
    BarcodeScanner.pause();

    let found = State.inventory.find(i => i.barcode === code);
    if (!found) {
      const { data } = await DB.inventory().select('*').eq('barcode', code).maybeSingle();
      found = data;
    }

    if (found) {
      Notify.warn('⚠️ "' + found.name + '" موجود مسبقاً — تم تجاوزه');
      setTimeout(() => BarcodeScanner.resume(), 900);
      return;
    }

    Inventory._pendingBarcode = code;
    Inventory._openBulkForm(code);
  },

  _openBulkForm(code) {
    document.getElementById('inv-bulk-overlay').style.display = 'none';
    document.getElementById('bulk-code').textContent = code;
    document.getElementById('bulk-name').value  = '';
    document.getElementById('bulk-price').value = '';
    document.getElementById('bulk-cost').value  = '';
    document.getElementById('bulk-qty').value   = '1';
    Modal.open('m-bulk-form');
    setTimeout(() => document.getElementById('bulk-name')?.focus(), 200);
  },

  async saveBulkItem() {
    const name  = document.getElementById('bulk-name')?.value.trim();
    const price = parseFloat(document.getElementById('bulk-price')?.value) || 0;
    const cost  = parseFloat(document.getElementById('bulk-cost')?.value)  || 0;
    const qty   = parseFloat(document.getElementById('bulk-qty')?.value)   || 0;
    const code  = Inventory._pendingBarcode;

    if (!name) { Notify.error('أدخل اسم المنتج'); return; }

    try {
      const { error } = await DB.inventory().insert({
        store_id:        State.user.id,
        name,
        barcode:         code,
        category:        'عام',
        unit:            'قطعة (pcs)',
        quantity:        qty,
        sale_price:      price,
        cost_price:      cost,
        low_stock_alert: CONFIG.lowStockDefault,
      });
      if (error) throw error;

      Inventory._bulkCount++;
      Inventory._updateBulkCounter();
      await Inventory.loadList();

      Notify.success('✅ تمت إضافة "' + name + '"');
      Modal.close('m-bulk-form');

      setTimeout(() => {
        document.getElementById('inv-bulk-overlay').style.display = 'flex';
        BarcodeScanner.resume();
      }, 250);

    } catch (err) {
      Notify.error('فشل الحفظ: ' + err.message);
    }
  },

  skipBulkItem() {
    Modal.close('m-bulk-form');
    setTimeout(() => {
      document.getElementById('inv-bulk-overlay').style.display = 'flex';
      BarcodeScanner.resume();
    }, 200);
  },

  _updateBulkCounter() {
    const el = document.getElementById('inv-bulk-counter');
    if (el) el.textContent = Inventory._bulkCount;
  },

  async stopBulkScan() {
    BarcodeScanner.stop();
    const overlay = document.getElementById('inv-bulk-overlay');
    if (overlay) overlay.style.display = 'none';
    const container = document.getElementById('inv-bulk-container');
    if (container) { container.innerHTML = ''; container.style.height = ''; }

    if (Inventory._bulkCount > 0) {
      Notify.success('✅ تم إضافة ' + Inventory._bulkCount + ' منتج بنجاح');
    }
    await Promise.all([Inventory.loadList(), Inventory.load()]);
  },

  openEditModal(id) {
    const item = State.inventory.find(i => i.id === id);
    if (!item) { Notify.error('لم يُوجد المنتج'); return; }
    document.getElementById('einvid').value       = id;
    document.getElementById('einvname').value     = item.name || '';
    document.getElementById('einvbrand').value    = item.brand || '';
    document.getElementById('einvbarcode').value  = item.barcode || '';
    document.getElementById('einvqty').value      = item.quantity || 0;
    document.getElementById('einvqty-add').value  = '';
    document.getElementById('einvprice').value    = item.sale_price || 0;
    document.getElementById('einvcost').value     = item.cost_price || 0;
    document.getElementById('einvalert').value    = item.low_stock_alert || 10;
    // الفئة والنوع
    const catEl  = document.getElementById('einvcat');
    const unitEl = document.getElementById('einvunit');
    if (catEl  && item.category) [...catEl.options].forEach((o,i)  => { if (o.value === item.category) catEl.selectedIndex  = i; });
    if (unitEl && item.unit)     [...unitEl.options].forEach((o,i) => { if (o.value === item.unit)     unitEl.selectedIndex = i; });
    // إخفاء preview
    const prev = document.getElementById('einv-qty-preview');
    if (prev) prev.style.display = 'none';
    Modal.open('m-editinv');
  },

  calcNewQty() {
    const current = parseFloat(document.getElementById('einvqty')?.value) || 0;
    const add     = parseFloat(document.getElementById('einvqty-add')?.value) || 0;
    const prev    = document.getElementById('einv-qty-preview');
    if (!prev) return;
    if (add > 0) {
      prev.style.display = 'block';
      prev.textContent   = '✅ الكمية الجديدة: ' + (current + add);
    } else {
      prev.style.display = 'none';
    }
  },

  async update() {
    const id      = DOM.val('einvid');
    const name    = DOM.val('einvname')?.trim();
    const barcode = DOM.val('einvbarcode')?.trim() || null;
    const qty     = parseFloat(DOM.val('einvqty')) || 0;
    const addQty  = parseFloat(document.getElementById('einvqty-add')?.value) || 0;
    const price   = parseFloat(DOM.val('einvprice')) || 0;
    const cost    = parseFloat(DOM.val('einvcost'))  || 0;
    const alert   = parseFloat(DOM.val('einvalert')) || 10;
    const cat     = DOM.val('einvcat')  || 'عام';
    const unit    = DOM.val('einvunit') || 'قطعة (pcs)';

    if (!name) { Notify.error('أدخل اسم المنتج'); return; }

    const finalQty = qty + addQty;
    try {
      const { error } = await DB.inventory().update({
        name, barcode, brand: DOM.val('einvbrand') || null, category: cat, unit,
        quantity:        finalQty,
        sale_price:      price,
        cost_price:      cost,
        low_stock_alert: alert,
      }).eq('id', id);
      if (error) throw error;
      Notify.success('تم تحديث "' + name + '" — الكمية: ' + finalQty);
      Modal.close('m-editinv');
      await Inventory.load();
    } catch (err) { Notify.error(err.message); }
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
