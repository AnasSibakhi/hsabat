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
import { OfflineQueue } from '../core/offline-queue.js';
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

    // هامش الربح — لون ديناميكي حسب القيمة الفعلية (أحمر للخسارة، أخضر للربح)، لا أخضر ثابت
    const marginVal = item.sale_price && item.cost_price && item.cost_price > 0
      ? ((item.sale_price - item.cost_price) / item.cost_price) * 100
      : null;
    const marginEl = document.getElementById('prod-margin');
    if (marginEl) {
      marginEl.textContent = marginVal !== null ? marginVal.toFixed(1) + '%' : '-';
      marginEl.style.color = marginVal !== null && marginVal < 0 ? 'var(--d)' : 'var(--s)';
    }
    // تحذير صريح ومنفصل عن حالة المخزون لو سعر البيع فعلياً أقل من التكلفة — يمنع الالتباس
    // بين "متوفر بالكمية" (حالة المخزون) و"مربح" (حالة السعر)، فهما مفهومان مختلفان تماماً
    const lossWarnEl = document.getElementById('prod-loss-warning');
    if (lossWarnEl) {
      lossWarnEl.style.display = (marginVal !== null && marginVal < 0) ? 'block' : 'none';
    }


    // حالة المخزون
    const statusEl = document.getElementById('prod-status-badge');
    if (item.quantity <= 0)
      statusEl.innerHTML = '<span style="background:var(--dl);color:var(--d);padding:5px 12px;border-radius:20px;font-size:12px;font-weight:800;">🔴 نفد</span>';
    else if (item.quantity <= (item.low_stock_alert || 5))
      statusEl.innerHTML = '<span style="background:var(--wl);color:var(--w);padding:5px 12px;border-radius:20px;font-size:12px;font-weight:800;">🟡 منخفض</span>';
    else
      statusEl.innerHTML = '<span style="background:var(--sl);color:var(--s);padding:5px 12px;border-radius:20px;font-size:12px;font-weight:800;">🟢 متوفر</span>';

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
      ? purchases.map(p => `<div class="exp-card">
          <div class="exp-card-icon" style="background:var(--pl);">🛒</div>
          <div class="exp-card-body">
            <div class="exp-card-type">${Utils.escape(p.supplier)}</div>
            <div class="exp-card-date">${p.purchase_date} · الكمية: ${p.quantity}</div>
          </div>
          <div class="exp-card-right">
            <div class="exp-card-amount" style="color:var(--g9);font-size:13px;">تكلفة ₪${p.cost.toFixed(2)}</div>
            ${p.sale_price ? `<div style="font-size:12px;font-weight:800;color:var(--p);">بيع ₪${p.sale_price.toFixed(2)}</div>` : ''}
          </div>
        </div>`).join('')
      : '<div class="er" style="padding:20px;text-align:center;color:var(--g5);">لا يوجد سجل مشتريات</div>';

    // سجل المبيعات
    const { data: soldItems } = await DB.invoiceItems()
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
      salesRows.push(`<div class="exp-card">
        <div class="exp-card-icon" style="background:var(--pl);">🧾</div>
        <div class="exp-card-body">
          <div class="exp-card-type" style="color:var(--p);">${inv?.invoice_number || '#' + (inv?.id?.slice(-4) || '-')}</div>
          <div class="exp-card-date">${inv?.invoice_date || '-'} · الكمية: ${qty}</div>
        </div>
        <div class="exp-card-right">
          <div class="exp-card-amount" style="color:var(--s);">₪${price.toFixed(2)}</div>
        </div>
      </div>`);
    });

    document.getElementById('prod-total-sold').textContent    = totalSold + ' وحدة';
    document.getElementById('prod-total-revenue').textContent = '₪' + totalRevenue.toFixed(2);
    document.getElementById('prod-total-profit').textContent  = '₪' + totalProfit.toFixed(2);
    document.getElementById('prod-sales-list').innerHTML      = salesRows.length
      ? salesRows.join('')
      : '<div class="er" style="padding:20px;text-align:center;color:var(--g5);">لا يوجد مبيعات</div>';

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
              <td style="color:var(--g5);">${b.purchase_date}</td>
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
    const getStatus = (i) => {
      if (i.quantity <= 0)                        return { cls: 'out', label: 'نفد' };
      if (i.quantity <= (i.low_stock_alert || 5))  return { cls: 'low', label: 'منخفض' };
      return { cls: 'ok', label: 'متوفر' };
    };

    DOM.setHTML('invlist', list.length
      ? list.map(i => {
          const status = getStatus(i);
          const hasPrice  = i.sale_price > 0;
          const hasCost   = i.cost_price > 0;
          const hasMargin = hasPrice && hasCost;

          let marginCellHtml = '<span class="lbl">الربح</span><span class="v" style="color:var(--g4);">—</span>';
          if (hasMargin) {
            const marginPct = ((i.sale_price - i.cost_price) / i.cost_price) * 100;
            const isLoss = marginPct < 0;
            const diff = Math.abs(i.sale_price - i.cost_price);
            marginCellHtml = `<span class="lbl">الربح</span>
              <span class="v ${isLoss ? 'loss' : 'profit'}">${isLoss ? '-' : ''}${Math.abs(marginPct).toFixed(0)}%</span>
              <span class="micro ${isLoss ? 'down' : 'up'}">${isLoss ? '▼' : '▲'} ₪${diff.toFixed(2)}</span>`;
          }

          const stockPct = Math.max(2, Math.min(100, (i.quantity / ((i.low_stock_alert || 5) * 4)) * 100));
          const stockColor = status.cls === 'out' ? 'var(--d)' : status.cls === 'low' ? 'var(--w)' : 'var(--s)';

          const canPrint = !!i.barcode;

          return `<div class="prod-card-v2 ${status.cls}" onclick="Inventory.openProduct('${i.id}')">
            <div class="pcv2-top">
              <div class="pcv2-name-area">
                <span class="pcv2-name">${Utils.escape(i.name)}</span>
                <span class="pcv2-cat-tag">${Utils.escape(i.category || 'عام')}</span>
              </div>
              <span class="pcv2-status ${status.cls}">● ${status.label}</span>
            </div>
            <div class="pcv2-metrics">
              <div class="pcv2-cell">
                <span class="lbl">السعر</span>
                <span class="v price">${hasPrice ? '₪' + i.sale_price.toFixed(2) : '—'}</span>
              </div>
              <div class="pcv2-cell">
                <span class="lbl">التكلفة</span>
                <span class="v">${hasCost ? '₪' + i.cost_price.toFixed(2) : '—'}</span>
              </div>
              <div class="pcv2-cell">${marginCellHtml}</div>
              <div class="pcv2-cell">
                <span class="lbl">الكمية</span>
                <span class="v" style="${status.cls !== 'ok' ? 'color:var(--' + (status.cls === 'out' ? 'd' : 'w') + ');' : ''}">${i.quantity} <span class="pcv2-unit">${Utils.escape(i.unit || '')}</span></span>
                <div class="pcv2-stockbar"><div class="pcv2-stockfill" style="width:${stockPct}%;background:${stockColor};"></div></div>
              </div>
            </div>
            <div class="pcv2-bottom">
              <span class="pcv2-barcode">${i.barcode ? Utils.escape(i.barcode) : 'بدون باركود'}</span>
              <div class="pcv2-actions">
                <button onclick="event.stopPropagation();Inventory.openEditModal('${i.id}')" title="تعديل">✎</button>
                <button onclick="event.stopPropagation();Inventory.openProduct('${i.id}')" title="تفاصيل">ℹ</button>
                <button ${canPrint ? `onclick="event.stopPropagation();Inventory.printBarcode('${i.id}')"` : 'disabled'} title="طباعة باركود">🖨</button>
                <button class="danger" onclick="event.stopPropagation();Inventory.delete('${i.id}')" title="حذف">🗑</button>
              </div>
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
      .label{text-align:center;padding:16px;border:1px dashed var(--g3);border-radius:8px;}
      .name{font-size:13px;font-weight:700;margin-bottom:6px;color:var(--g9);}
      .price{font-size:15px;font-weight:900;color:var(--p);margin-top:6px;}
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
    const hintEl    = document.querySelector('#inv-scanner-overlay .scn-float-card span');

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

  // ── تحقق لحظي وذكي أثناء الكتابة — يعطّل زر الحفظ فوراً لو سعر البيع أقل من التكلفة
  // (منع جذري من الإدخال نفسه، لا انتظار للضغط على حفظ ثم تحذير قابل للتجاوز) ──
  checkPriceWarning() {
    const sp = parseFloat(DOM.val('insp')) || 0;
    const cp = parseFloat(DOM.val('incp')) || 0;
    const isInvalid = sp > 0 && cp > 0 && sp < cp;
    const warnEl = document.getElementById('inv-price-warning');
    const saveBtn = document.getElementById('inv-save-btn');
    if (warnEl) warnEl.style.display = isInvalid ? 'block' : 'none';
    if (saveBtn) {
      saveBtn.disabled = isInvalid;
      saveBtn.style.opacity = isInvalid ? '0.5' : '1';
      saveBtn.style.cursor = isInvalid ? 'not-allowed' : 'pointer';
    }
  },

  async save() {
    const name = DOM.val('inn');
    if (!name) { Notify.error('أدخل اسم الصنف'); return; }
    const _sp = parseFloat(DOM.val('insp')) || 0;
    const _cp = parseFloat(DOM.val('incp')) || 0;
    // منع قاطع، لا تحذير قابل للتجاوز — الزر معطَّل أصلاً بفضل checkPriceWarning() اللحظية،
    // هذا الفحص النهائي خط دفاع إضافي يضمن عدم الحفظ حتى لو تجاوز المستخدمة الواجهة بأي شكل
    if (_sp > 0 && _cp > 0 && _sp < _cp) {
      Notify.error('⚠️ سعر البيع أقل من سعر التكلفة — صحّحي السعر قبل الحفظ');
      return;
    }
    State.isMutating = true;

    const productRow = {
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
    };

    try {
      const { error } = await DB.inventory().insert(productRow);
      if (error) throw error;
      Notify.success('تم إضافة الصنف');
      Modal.close('m-inv');
      DOM.clearInputs('inn', 'insp', 'incp');
      Inventory.loadList();
      Inventory.load();
    } catch (err) {
      // فشل شبكي حقيقي (لا نت) — لا نوقف الإضافة، نخزّنها بالطابور المحلي (نفس آلية البيع
      // السريع بالضبط) ونعرض تأكيداً محلياً فورياً. الإضافة بسيطة الاتجاه (لا تعتمد على
      // قراءة كمية حالية قد تتغيّر بجهاز آخر بنفس الوقت)، فهي آمنة لهذا النمط من الطوابير
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      if (!isNetworkFailure) {
        Notify.error(err.message || 'فشل إضافة الصنف');
      } else {
        OfflineQueue.add(productRow, 'inventory');
        // إضافة محلية فورية للقائمة المعروضة — تعطي إحساساً حقيقياً بالنجاح، تُستبدَل
        // ببيانات السيرفر الحقيقية تلقائياً بعد المزامنة، لكن لا نستدعي loadList() هنا (يستبدل
        // State.inventory بالكامل من السيرفر، يمحو المنتج المحلي المؤقت قبل نجاح مزامنته)
        State.inventory = [...(State.inventory || []), { ...productRow, id: 'local_' + Date.now(), _isLocalPending: true }];
        Notify.warn('📡 لا يوجد اتصال — تم حفظ الصنف محلياً وسيُزامَن تلقائياً عند رجوع النت');
        Modal.close('m-inv');
        DOM.clearInputs('inn', 'insp', 'incp');
        Inventory._renderList(State.inventory);
      }
    } finally { setTimeout(() => { State.isMutating = false; }, 500); }
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
    Inventory.checkEditPriceWarning(); // تحقق فوري عند فتح الموديل — لو منتج موجود فعلاً بهامش سالب
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

  // ── نفس فلسفة checkPriceWarning، لكن لحقول موديل التعديل المختلفة (einvprice/einvcost) ──
  checkEditPriceWarning() {
    const sp = parseFloat(DOM.val('einvprice')) || 0;
    const cp = parseFloat(DOM.val('einvcost')) || 0;
    const isInvalid = sp > 0 && cp > 0 && sp < cp;
    const warnEl = document.getElementById('einv-price-warning');
    const saveBtn = document.getElementById('einv-save-btn');
    if (warnEl) warnEl.style.display = isInvalid ? 'block' : 'none';
    if (saveBtn) {
      saveBtn.disabled = isInvalid;
      saveBtn.style.opacity = isInvalid ? '0.5' : '1';
      saveBtn.style.cursor = isInvalid ? 'not-allowed' : 'pointer';
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

    // منع قاطع، لا تحذير قابل للتجاوز — نفس فلسفة save()، خط دفاع نهائي
    if (price > 0 && cost > 0 && price < cost) {
      Notify.error('⚠️ سعر البيع أقل من سعر التكلفة — صحّحي السعر قبل الحفظ');
      return;
    }

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
    try {
      await DB.inventory().delete().eq('id', id);
      Notify.success('تم');
      await Inventory.load();
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — لم يُحذف المنتج، حاولي مرة أخرى' : (err.message || 'فشل حذف المنتج'));
    }
  },

  /** Deduct quantities after a sale — called by Invoices and QuickSale */
  async deductItems(items) {
    try {
      for (const item of items) {
        if (!item.inventory_id) continue;
        const { data } = await DB.inventory().select('quantity').eq('id', item.inventory_id).single();
        if (data) await DB.inventory().update({ quantity: Math.max(0, data.quantity - item.quantity) }).eq('id', item.inventory_id);
      }
    } catch (err) {
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      Notify.error(isNetworkFailure ? '📡 لا يوجد اتصال — تحديث المخزون لم يكتمل بالكامل، تحققي يدوياً' : (err.message || 'فشل تحديث المخزون'));
      throw err; // نرمي الخطأ للمستدعي — هذي عملية حرجة، يجب يعرف المستدعي إنها فشلت لمعالجتها بمنطقه الخاص
    }
  },
};

export { Inventory };
