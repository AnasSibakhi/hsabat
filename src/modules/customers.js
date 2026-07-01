/**
 * customers.js — Customers Module
 * All customer-related operations
 */

import { DB, sb } from '../core/db.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM        from '../core/dom.js';
import { escape }      from '../core/utils.js';
import * as Modal      from '../nav/modal.js';
import { Debts }       from './debts.js';

export const Customers = {
  /** Load all customers into State.customers cache */
  async loadAll() {
    const { data } = await DB.customers().select('*').order('name');
    State.customers = data ?? [];
    Customers.fillSelects();
  },

  _sortMode:    'date',
  _showArchived: false,

  setSort(mode) {
    Customers._sortMode = mode;
    document.querySelectorAll('.d-sort-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('cusort-' + mode)?.classList.add('active');
    if (Customers._allData) Customers._renderUnified(Customers._allData.customers, Customers._allData.debts);
  },

  toggleArchive() {
    Customers._showArchived = !Customers._showArchived;
    const btn = document.getElementById('cu-archive-btn');
    if (btn) btn.textContent = Customers._showArchived ? '✅ نشط' : '🗄 الأرشيف';
    Customers.loadUnified();
  },

  /** Unified customers + debts page */
  async loadUnified() {
    // عرض فوري من الكاش المحلي لو موجود (مملوء من preload) — صفر انتظار مرئي
    if (Customers._allData) {
      requestAnimationFrame(() => Customers._renderUnified(
        Customers._allData.customers, Customers._allData.debts
      ));
    }

    const [custRes, debtsRes] = await Promise.all([
      DB.customers().select('*').order('name'),
      DB.debts().select('*,customers(name,phone)')
        .eq('archived', Customers._showArchived)
        .order('debt_date', { ascending: false }),
    ]);

    State.customers = custRes.data || [];
    const debts     = debtsRes.data || [];
    const today     = new Date().toISOString().split('T')[0];
    const monthStart= today.slice(0,7) + '-01';

    // إحصائيات
    const totalDebt = debts.reduce((s,d) => s + Math.max(0, d.amount - (d.paid||0)), 0);
    const lateDebts = debts.filter(d => {
      const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
      return (d.amount - (d.paid||0)) > 0 && days >= 2;
    });
    const paidMonth = debts.filter(d => d.paid > 0 && d.debt_date >= monthStart)
      .reduce((s,d) => s + (d.paid||0), 0);

    DOM.setText('cu-total', '₪' + totalDebt.toFixed(2));
    DOM.setText('cu-late',  lateDebts.length);
    DOM.setText('cu-paid',  '₪' + paidMonth.toFixed(2));

    // تنبيهات المتأخرين
    const alerts = DOM.get('cu-alerts');
    if (alerts) {
      alerts.innerHTML = lateDebts.length
        ? `<div class="mb-8" style="background:#fff;border:1px solid var(--g2);border-radius:10px;padding:12px 14px;">
            <div style="font-size:12.5px;font-weight:800;color:var(--d);margin-bottom:8px;">⚠️ متأخرون عن السداد (${lateDebts.length})</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${lateDebts.slice(0,5).map(d => {
                const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
                return `<span style="border:1px solid var(--d);color:var(--d);padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;">
                  ${escape(d.customers?.name||'-')} (${days} يوم)
                </span>`;
              }).join('')}
            </div>
          </div>` : '';
    }

    // تقرير التأخر
    const aging = { current:0, d2:0, d7:0, d30:0, old:0 };
    debts.forEach(d => {
      const rem  = d.amount - (d.paid||0);
      if (rem <= 0) return;
      const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
      if (days < 2)       aging.current += rem;
      else if (days < 7)  aging.d2      += rem;
      else if (days < 30) aging.d7      += rem;
      else if (days < 90) aging.d30     += rem;
      else                aging.old     += rem;
    });
    const agingEl = DOM.get('cu-aging');
    if (agingEl) agingEl.innerHTML = `
      <div class="aging-grid-v2">
        <div class="aging-cell" style="border:1px solid var(--g2);"><div class="aging-label" style="color:var(--s);">أقل من يومين</div><div class="aging-val" style="color:var(--g9);">₪${aging.current.toFixed(2)}</div></div>
        <div class="aging-cell" style="border:1px solid var(--g2);"><div class="aging-label" style="color:var(--p);">2-7 أيام</div><div class="aging-val" style="color:var(--g9);">₪${aging.d2.toFixed(2)}</div></div>
        <div class="aging-cell" style="border:1px solid var(--g2);"><div class="aging-label" style="color:var(--w);">7-30 يوم</div><div class="aging-val" style="color:var(--g9);">₪${aging.d7.toFixed(2)}</div></div>
        <div class="aging-cell" style="border:1px solid var(--g2);"><div class="aging-label" style="color:var(--d);">30-90 يوم</div><div class="aging-val" style="color:var(--g9);">₪${aging.d30.toFixed(2)}</div></div>
        <div class="aging-cell" style="border:1px solid var(--g2);"><div class="aging-label" style="color:#7c3aed;">أكثر من 90 يوم</div><div class="aging-val" style="color:var(--g9);">₪${aging.old.toFixed(2)}</div></div>
      </div>`;

    Customers._allData = { customers: State.customers, debts };
    requestAnimationFrame(() => Customers._renderUnified(State.customers, debts));
  },

  _renderUnified(customers, debts) {
    const list = DOM.get('cu-list');
    if (!list) return;

    // بناء map الديون لكل زبون
    const debtMap = {};
    debts.forEach(d => {
      const cid = d.customer_id;
      if (!debtMap[cid]) debtMap[cid] = [];
      debtMap[cid].push(d);
    });

    // ترتيب الزبائن حسب الـ sort mode
    let sorted = [...customers];
    if (Customers._sortMode === 'amount') {
      sorted.sort((a,b) => {
        const ra = (debtMap[a.id]||[]).reduce((s,d)=>s+Math.max(0,d.amount-(d.paid||0)),0);
        const rb = (debtMap[b.id]||[]).reduce((s,d)=>s+Math.max(0,d.amount-(d.paid||0)),0);
        return rb - ra;
      });
    } else if (Customers._sortMode === 'overdue') {
      sorted.sort((a,b) => {
        const da = (debtMap[a.id]||[]).reduce((s,d)=>Math.min(s,new Date(d.debt_date)),Infinity);
        const db = (debtMap[b.id]||[]).reduce((s,d)=>Math.min(s,new Date(d.debt_date)),Infinity);
        return da - db;
      });
    }

    // الزبائن عندهم ديون أولاً
    sorted.sort((a,b) => {
      const ha = (debtMap[a.id]||[]).some(d => d.amount-(d.paid||0) > 0);
      const hb = (debtMap[b.id]||[]).some(d => d.amount-(d.paid||0) > 0);
      return hb - ha;
    });

    list.classList.remove('sk-placeholder');
    if (!sorted.length) {
      list.innerHTML = '<div class="empty-state">لا يوجد زبائن مسجّلين</div>';
      return;
    }

    list.innerHTML = `<div class="cu-list-card">` + sorted.map(c => {
      const custDebts = debtMap[c.id] || [];
      const totalRem  = custDebts.reduce((s,d) => s + Math.max(0, d.amount - (d.paid||0)), 0);
      const hasDebt   = totalRem > 0;
      const oldestDebt = custDebts.filter(d => d.amount - (d.paid||0) > 0)
        .sort((a,b) => new Date(a.debt_date) - new Date(b.debt_date))[0];
      const days = oldestDebt ? Math.floor((new Date().setHours(0,0,0,0) - new Date(oldestDebt.debt_date)) / 86400000) : 0;

      return `<div class="cu-row" data-customer-id="${c.id}" onclick="Customers.openDetail('${c.id}')">
        <div class="cu-row-info">
          <div class="cu-row-name">${escape(c.name)}</div>
          ${hasDebt
            ? `<div class="cu-row-debt-line">₪${totalRem.toFixed(2)} متبقٍ ${days >= 2 ? `· متأخر ${days} يوم` : ''}</div>`
            : (c.phone ? `<div class="cu-row-phone">📞 ${escape(c.phone)}</div>` : '')}
        </div>
        <div class="cu-row-status">
          ${hasDebt
            ? `<span class="cu-status-pill ${days >= 2 ? 'late' : 'recent'}">${days >= 2 ? 'متأخر' : 'حديث'}</span>`
            : `<span class="cu-status-pill ok">صافي</span>`}
        </div>
        <span class="cu-row-chev">‹</span>
      </div>`;
    }).join('') + `</div>`;
  },

  // ── فتح موديل تفاصيل الزبون الكامل (ديون + سجل مشتريات) ──
  async openDetail(customerId) {
    const c = State.customers.find(x => x.id === customerId);
    if (!c) return;
    Customers._detailCustomerId = customerId;

    DOM.setText('cd-name', c.name);
    const phoneEl = DOM.get('cd-phone');
    if (phoneEl) phoneEl.textContent = c.phone ? '📞 ' + c.phone : '';
    const callBtn = DOM.get('cd-call-btn');
    if (callBtn) callBtn.onclick = () => c.phone && window.open('tel:' + c.phone);

    Modal.open('m-cust-detail');
    Customers.switchDetailTab('debts');

    // الديون (من الكاش المحلي، فوري بدون طلب شبكي)
    const { debts } = Customers._allData || { debts: [] };
    const custDebts = debts.filter(d => d.customer_id === customerId);
    Customers._renderDetailDebts(custDebts);

    // سجل المشتريات (فواتيره) — يُطلب فقط عند الحاجة
    const { data: invoices } = await DB.invoices().select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
    Customers._renderDetailInvoices(invoices || []);
  },

  switchDetailTab(tab) {
    DOM.get('cd-tab-debts')?.classList.toggle('active', tab === 'debts');
    DOM.get('cd-tab-invoices')?.classList.toggle('active', tab === 'invoices');
    DOM.get('cd-debts-panel').style.display    = tab === 'debts' ? 'block' : 'none';
    DOM.get('cd-invoices-panel').style.display = tab === 'invoices' ? 'block' : 'none';
  },

  _renderDetailDebts(custDebts) {
    const panel = DOM.get('cd-debts-panel');
    if (!panel) return;
    const active = custDebts.filter(d => d.amount - (d.paid||0) > 0);

    // بطاقة "تسديد الإجمالي" — تظهر فقط لو أكثر من دين نشط واحد، تسدّد بالترتيب الزمني
    // (الأقدم أولاً) بضغطة واحدة، بدل الاضطرار لتسديد كل فاتورة منفصلة يدوياً
    const totalRem = active.reduce((s, d) => s + (d.amount - (d.paid||0)), 0);
    const summaryHtml = active.length > 1 ? `<div class="cd-debt-summary">
        <div>
          <div class="cd-debt-summary-label">إجمالي المتبقي (${active.length} ديون)</div>
          <div class="cd-debt-summary-total">₪${totalRem.toFixed(2)}</div>
        </div>
        <button class="ibg ibg-primary" onclick="Debts.openTotalPayModal('${Customers._detailCustomerId}',${totalRem})">تسديد الإجمالي</button>
      </div>` : '';

    // زر "تسديد" المنفرد لكل دين يظهر فقط لو دين واحد نشط — لو أكثر من دين، "تسديد الإجمالي"
    // أعلى القائمة يكفي ويُغطّيها بترتيب صحيح (الأقدم أولاً)، فلا حاجة لزر منفرد قد يُسدِّد
    // دفعة جزئية على دين واحد بترتيب عشوائي يخالف منطق "الأقدم أولاً" المعتمَد بالموقع
    const showIndividualPayButton = active.length === 1;

    panel.innerHTML = summaryHtml + (active.length
      ? active.map(d => {
          const rem  = d.amount - (d.paid||0);
          const days = Math.floor((new Date().setHours(0,0,0,0) - new Date(d.debt_date)) / 86400000);
          return `<div class="cd-debt-item" data-debt-id="${d.id}">
            <div>
              <div class="cd-debt-amount">₪${rem.toFixed(2)}</div>
              <div class="cd-debt-date">${d.debt_date} ${days > 0 ? '· متأخر ' + days + ' يوم' : ''}</div>
              ${d.notes ? `<div class="cd-debt-notes">${escape(d.notes)}</div>` : ''}
            </div>
            ${showIndividualPayButton ? `<button class="ibg" onclick="Debts.openPayModal('${d.id}','${escape(State.customers.find(c=>c.id===Customers._detailCustomerId)?.name||'')}',${rem})">تسديد</button>` : ''}
          </div>`;
        }).join('')
      : '<div class="cd-empty">✅ لا توجد ديون نشطة</div>');
  },

  _renderDetailInvoices(invoices) {
    const panel = DOM.get('cd-invoices-panel');
    if (!panel) return;

    panel.innerHTML = invoices.length
      ? invoices.map(inv => `<div class="cd-inv-item">
          <div>
            <div class="cd-inv-num">${escape(inv.invoice_number || '-')}</div>
            <div class="cd-inv-date">${inv.invoice_date}${inv.sale_time ? ' · ' + inv.sale_time : ''}</div>
          </div>
          <div class="cd-inv-amount">₪${inv.total.toFixed(2)}</div>
        </div>`).join('')
      : '<div class="cd-empty">لا توجد فواتير سابقة</div>';
  },

  deleteFromDetail() {
    const id = Customers._detailCustomerId;
    if (!id) return;
    Modal.close('m-cust-detail');
    Customers.delete(id);
  },

  openNewDebtFromDetail() {
    const c = State.customers.find(x => x.id === Customers._detailCustomerId);
    if (!c) return;
    Modal.close('m-cust-detail');
    Customers.openNewDebt(c.id, c.name);
  },

  // تحديث الإجماليات بدون إعادة تحميل
  _refreshStats() {
    if (!Customers._allData) return;
    const { debts } = Customers._allData;
    const today = new Date().toISOString().split('T')[0];
    const totalDebt = debts.reduce((s,d) => s + Math.max(0, d.amount - (d.paid||0)), 0);
    const lateCount = debts.filter(d => {
      const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
      return (d.amount - (d.paid||0)) > 0 && days >= 2;
    }).length;
    DOM.setText('cu-total', '₪' + totalDebt.toFixed(2));
    DOM.setText('cu-late',  lateCount);
  },

  // تحديث بطاقة زبون معين
  _updateCustomerCard(customerId) {
    if (!Customers._allData) return;
    // إعادة عرض القائمة كاملة — التصميم الجديد خفيف وسريع بما يكفي لإعادة البناء بدون تأثير ملموس
    Customers._renderUnified(Customers._allData.customers, Customers._allData.debts);
  },

  openNewDebt(customerId, customerName) {
    Modal.open('m-debt');
    setTimeout(() => {
      const search = document.getElementById('dc-search');
      if (search) search.value = customerName;
      Debts.selectCustomer(customerId, customerName);
    }, 100);
  },

  filterUnified(q) {
    if (!Customers._allData) return;
    const { customers, debts } = Customers._allData;
    const filtered = q.trim()
      ? customers.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone||'').includes(q))
      : customers;
    Customers._renderUnified(filtered, debts);
  },

  /** Filter customers by search query */
  filter(query) {
    const q = query.toLowerCase();
    Customers._render(
      State.customers.filter(c =>
        c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)
      )
    );
  },

  _render(list) {
    DOM.setHTML('clist', list.length
      ? list.map((c, i) => {
          const debt = (c.debts ?? []).reduce((s, d) => s + (d.amount - d.paid), 0);
          return `<tr>
            <td>${i + 1}</td>
            <td>${escape(c.name)}</td>
            <td>${escape(c.phone ?? '-')}</td>
            <td>${debt > 0 ? `<span class="br">₪${debt.toFixed(2)}</span>` : '<span class="bg">₪0</span>'}</td>
            <td><button class="ibb" onclick="Customers.showStatement('${c.id}','${escape(c.name)}')">كشف</button></td>
            <td><button class="ibr" onclick="Customers.delete('${c.id}')">حذف</button></td>
          </tr>`;
        }).join('')
      : '<tr class="er"><td colspan="6">لا يوجد زبائن</td></tr>'
    );
  },

  /** Fill customer dropdowns in modals */
  fillSelects() {
    const forDebt    = '<option value="">-- اختر الزبون --</option>'
      + State.customers.map(c => `<option value="${c.id}">${escape(c.name)}</option>`).join('');
    const forInvoice = '<option value="">-- زبون عادي --</option>'
      + State.customers.map(c => `<option value="${c.id}">${escape(c.name)}</option>`).join('')
      + '<option value="__new__">➕ زبون جديد...</option>';

    DOM.setHTML('dc',      forDebt);
    DOM.setHTML('ic',      forInvoice);
    DOM.setHTML('qs-cust', forDebt);
  },

  toggleNewFields(select) {
    DOM.toggle('new-cust-wrap', 'hidden', select.value !== '__new__');
  },

  /** Save a new customer */
  async save() {
    const name = DOM.val('cn');
    if (!name) { Notify.error('يرجى إدخال الاسم'); return; }
    const phone = DOM.val('cph');

    await State.mutate(async () => {
      // نفس منطق المطابقة المركزي — تمنع تكرار الزبون لو الجوال أو الاسم مطابق لزبون موجود مسبقاً
      const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const cleanPhone = phone.trim().replace(/[\s-]/g, '');

      const { data: allCustomers } = await DB.customers().select('*').eq('store_id', State.user.id);
      let existing = null;

      if (cleanPhone) {
        existing = (allCustomers || []).find(c => (c.phone || '').trim().replace(/[\s-]/g, '') === cleanPhone);
      }
      if (!existing) {
        existing = (allCustomers || []).find(c => normalize(c.name) === normalize(name));
      }

      if (existing) {
        Notify.error('هذا الزبون موجود مسبقاً: ' + existing.name + (existing.phone ? ' — ' + existing.phone : ''));
        return;
      }

      const { error } = await DB.customers().insert({
        store_id: State.user.id,
        name,
        phone,
        address: DOM.val('cad'),
        notes:   DOM.val('cno'),
      });
      if (error) throw error;
      Notify.success('تم إضافة الزبون');
      Modal.close('m-customer');
      DOM.clearInputs('cn', 'cph', 'cad', 'cno');
      await Customers.loadAll();
      await Customers.loadUnified();
    });
  },

  /** Delete a customer */
  async delete(id) {
    if (!confirm('حذف هذا الزبون؟')) return;
    await State.mutate(async () => {
      await DB.customers().delete().eq('id', id);
      Notify.success('تم الحذف');
      await Customers.loadAll();
      await Customers.loadUnified();
    });
  },

  /** Create a customer inline (called from Invoices/QuickSale) */
  async createInline(name, phone) {
    const normalize = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const cleanName  = normalize(name);
    const cleanPhone = (phone || '').trim().replace(/[\s-]/g, ''); // إزالة المسافات والشرطات من الجوال للمطابقة الدقيقة

    // الأولوية القصوى: مطابقة بالجوال — أدق معرّف فريد فعلي للزبون (لا يتأثر باختلاف كتابة الاسم)
    if (cleanPhone) {
      const byPhoneCache = (State.customers || []).find(c =>
        (c.phone || '').trim().replace(/[\s-]/g, '') === cleanPhone
      );
      if (byPhoneCache) return byPhoneCache;

      const { data: allCustomers } = await DB.customers()
        .select('*').eq('store_id', State.user.id);
      const byPhoneDb = (allCustomers || []).find(c =>
        (c.phone || '').trim().replace(/[\s-]/g, '') === cleanPhone
      );
      if (byPhoneDb) {
        if (!State.customers) State.customers = [];
        if (!State.customers.find(c => c.id === byPhoneDb.id)) State.customers.push(byPhoneDb);
        return byPhoneDb;
      }
    }

    // احتياط: مطابقة بالاسم المُطبَّع (لو الجوال غير متوفر — مثلاً زبون كاش بدون جوال)
    const byNameCache = (State.customers || []).find(c => normalize(c.name) === cleanName);
    if (byNameCache) return byNameCache;

    const { data: byNameDb } = await DB.customers()
      .select('*').eq('store_id', State.user.id)
      .ilike('name', name.trim()).maybeSingle();
    if (byNameDb) {
      if (!State.customers) State.customers = [];
      if (!State.customers.find(c => c.id === byNameDb.id)) State.customers.push(byNameDb);
      return byNameDb;
    }

    // لا يوجد تطابق فعلي — أنشئي زبون جديد فعلاً
    try {
      const { data, error } = await DB.customers().insert({
        store_id: State.user.id, name: name.trim(), phone: phone ?? '',
      }).select().single();
      if (error) throw error;
      if (!State.customers) State.customers = [];
      State.customers.push(data);
      return data;
    } catch (err) {
      // فشل شبكي حقيقي (لا نت) — لا نوقف عملية البيع، ننشئ سجل زبون محلي مؤقت برقم سالب
      // مميَّز (يستحيل تعارضه مع id حقيقي من قاعدة البيانات)، يُستخدم فقط لإكمال هذي العملية
      // محلياً. اسم/جوال الزبون الحقيقيان يُرسَلان مباشرة ضمن بيانات البيع نفسها عند المزامنة،
      // فالزبون الحقيقي يُنشأ فعلياً بالسيرفر كجزء طبيعي من معالجة الفاتورة — لا تكرار أو فقدان
      const isNetworkFailure = err instanceof TypeError || err?.message?.includes('fetch') || !navigator.onLine;
      if (!isNetworkFailure) throw err;

      const tempCustomer = {
        id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        store_id: State.user.id,
        name: name.trim(),
        phone: phone ?? '',
        _isLocalPending: true, // علامة داخلية — لا تُستخدم بأي مكان كمعرّف حقيقي بقاعدة البيانات
      };
      if (!State.customers) State.customers = [];
      State.customers.push(tempCustomer);
      return tempCustomer;
    }
  },

  /** Show account statement modal */
  async showStatement(customerId, name) {
    DOM.setText('stmttitle', 'كشف حساب — ' + name);
    DOM.setHTML('stmtbody', '<div style="text-align:center;padding:1.5rem;"><span class="spin">↻</span></div>');
    Modal.open('m-stmt');

    const [{ data: debts }, { data: invoices }] = await Promise.all([
      DB.sb?.from('debts').select('*').eq('customer_id', customerId).order('debt_date')
        ?? import('../core/db.js').then(m => m.DB.debts().select('*').eq('customer_id', customerId).order('debt_date')),
      DB.sb?.from('invoices').select('*').eq('customer_id', customerId).order('invoice_date')
        ?? import('../core/db.js').then(m => m.DB.invoices().select('*').eq('customer_id', customerId).order('invoice_date')),
    ]);

    const totalDebt = (debts ?? []).reduce((s, d) => s + (d.amount - d.paid), 0);
    let html = `<div style="display:flex;justify-content:space-between;background:var(--g0);border-radius:8px;padding:10px 14px;margin-bottom:1rem;font-size:13px;">
      <span>إجمالي الدين:</span><strong style="color:var(--d);">₪${totalDebt.toFixed(2)}</strong>
    </div>`;

    if (!debts?.length && !invoices?.length) {
      html += '<p style="text-align:center;color:var(--g4);padding:1rem;">لا توجد معاملات</p>';
    } else {
      html += `<table class="dt" style="font-size:12px;">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>`;
      (invoices ?? []).forEach(inv => {
        html += `<tr><td>${inv.invoice_date}</td><td>${inv.invoice_number ?? 'فاتورة'}</td><td>₪${inv.total.toFixed(2)}</td><td>-</td></tr>`;
      });
      (debts ?? []).forEach(d => {
        if (d.paid > 0) html += `<tr><td>${d.debt_date}</td><td>دفعة</td><td>-</td><td style="color:var(--s);">₪${d.paid.toFixed(2)}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    DOM.setHTML('stmtbody', html);
  },

  printStatement() {
    const content = DOM.get('stmtbody')?.innerHTML ?? '';
    const title   = DOM.get('stmttitle')?.textContent ?? '';
    const w = window.open('', '_blank');
    w.document.write(`<html dir="rtl"><head><title>${title}</title>
      <style>body{font-family:Arial;padding:20px;direction:rtl;}table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid var(--g3);padding:8px;text-align:right;}th{background:var(--g0);}</style></head>
      <body><h2>${title}</h2>${content}</body></html>`);
    w.document.close();
    w.print();
  },
};
