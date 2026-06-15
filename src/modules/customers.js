/**
 * customers.js — Customers Module
 * All customer-related operations
 */

import { DB }          from '../core/db.js';
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

  /** Unified customers + debts page */
  async loadUnified() {
    const list = DOM.get('cu-list');
    if (list) list.innerHTML = '<div class="empty-state"><span class="spin">↻</span></div>';

    const [custRes, debtsRes] = await Promise.all([
      DB.customers().select('*').order('name'),
      DB.debts().select('*').eq('archived', false).order('debt_date', { ascending: false }),
    ]);

    State.customers = custRes.data || [];
    const debts     = debtsRes.data || [];
    const today     = new Date().toISOString().split('T')[0];

    // حساب الإحصائيات
    const totalDebt = debts.reduce((s,d) => s + Math.max(0, d.amount - (d.paid||0)), 0);
    const lateCount = debts.filter(d => {
      const days = Math.floor((new Date(today) - new Date(d.debt_date)) / 86400000);
      return (d.amount - (d.paid||0)) > 0 && days >= 2;
    }).length;
    const paidMonth = debts.filter(d => d.paid > 0 && d.debt_date >= today.slice(0,7)+'-01')
      .reduce((s,d) => s + (d.paid||0), 0);

    DOM.setText('cu-total', '₪' + totalDebt.toFixed(2));
    DOM.setText('cu-late',  lateCount);
    DOM.setText('cu-paid',  '₪' + paidMonth.toFixed(2));

    Customers._allData = { customers: State.customers, debts };
    Customers._renderUnified(State.customers, debts);
  },

  _renderUnified(customers, debts) {
    const list = DOM.get('cu-list');
    if (!list) return;

    if (!customers.length) {
      list.innerHTML = '<div class="empty-state">لا يوجد زبائن مسجّلين</div>';
      return;
    }

    // بناء map الديون لكل زبون
    const debtMap = {};
    debts.forEach(d => {
      if (!debtMap[d.customer_id]) debtMap[d.customer_id] = [];
      debtMap[d.customer_id].push(d);
    });

    list.innerHTML = customers.map(c => {
      const custDebts = debtMap[c.id] || [];
      const totalRem  = custDebts.reduce((s,d) => s + Math.max(0, d.amount - (d.paid||0)), 0);
      const hasDebt   = totalRem > 0;

      return `
      <div class="card" style="margin-bottom:.6rem;">
        <div style="padding:12px 14px;">
          <!-- اسم + جوال + إجمالي -->
          <div class="flex-between" style="margin-bottom:${hasDebt ? '10px' : '0'};">
            <div>
              <div style="font-size:15px;font-weight:800;color:#1e293b;">${escape(c.name)}</div>
              ${c.phone ? `<div style="font-size:12px;color:var(--g5);margin-top:2px;">📞 ${c.phone}</div>` : ''}
            </div>
            <div style="text-align:left;">
              ${hasDebt
                ? `<div style="font-size:16px;font-weight:900;color:var(--r);">₪${totalRem.toFixed(2)}</div><div style="font-size:10px;color:var(--g4);">إجمالي الديون</div>`
                : `<span style="background:#dcfce7;color:#16a34a;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;">✅ صافي</span>`
              }
            </div>
          </div>

          <!-- قائمة الديون -->
          ${custDebts.filter(d => d.amount - (d.paid||0) > 0).map(d => {
            const rem  = d.amount - (d.paid||0);
            const days = Math.floor((new Date().setHours(0,0,0,0) - new Date(d.debt_date)) / 86400000);
            return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${days>=2?'#fff5f5':'#f8fafc'};border-radius:8px;margin-bottom:4px;">
              <div>
                <div style="font-size:12px;font-weight:700;color:#1e293b;">₪${rem.toFixed(2)}</div>
                <div style="font-size:10px;color:var(--g4);">${d.debt_date} ${days>0?'· متأخر '+days+' يوم':''}</div>
              </div>
              <div class="flex-gap6">
                ${d.notes ? `<span style="font-size:10px;color:var(--g5);">${escape(d.notes)}</span>` : ''}
                <button class="ibg" onclick="Debts.openPayModal('${d.id}','${escape(c.name)}',${rem})" style="font-size:11px;padding:5px 10px;">تسديد</button>
              </div>
            </div>`;
          }).join('')}

          <!-- أزرار الزبون -->
          <div class="flex-gap6" style="margin-top:${hasDebt?'8px':'0'};">
            <button class="ibb" onclick="Customers.openNewDebt('${c.id}','${escape(c.name)}')" style="font-size:11px;">+ دين جديد</button>
            ${c.phone ? `<button class="ibb" onclick="window.open('tel:${c.phone}')" style="font-size:11px;">📞 اتصال</button>` : ''}
            <button class="ibr" onclick="Customers.delete('${c.id}')" style="font-size:11px;">حذف</button>
          </div>
        </div>
      </div>`;
    }).join('');
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

    await State.mutate(async () => {
      const { error } = await DB.customers().insert({
        store_id: State.user.id,
        name,
        phone:   DOM.val('cph'),
        address: DOM.val('cad'),
        notes:   DOM.val('cno'),
      });
      if (error) throw error;
      Notify.success('تم إضافة الزبون');
      Modal.close('m-customer');
      DOM.clearInputs('cn', 'cph', 'cad', 'cno');
      await Customers.loadAll();
      Customers.loadTable();
    });
  },

  /** Delete a customer */
  async delete(id) {
    if (!confirm('حذف هذا الزبون؟')) return;
    await State.mutate(async () => {
      await DB.customers().delete().eq('id', id);
      Notify.success('تم الحذف');
      await Customers.loadAll();
      Customers.loadTable();
    });
  },

  /** Create a customer inline (called from Invoices/QuickSale) */
  async createInline(name, phone) {
    const { data, error } = await DB.customers().insert({
      store_id: State.user.id, name, phone: phone ?? '',
    }).select().single();
    if (error) throw error;
    return data;
  },

  /** Show account statement modal */
  async showStatement(customerId, name) {
    DOM.setText('stmttitle', 'كشف حساب — ' + name);
    DOM.setHTML('stmtbody', '<div style="text-align:center;padding:1.5rem;"><span class="spin">↻</span></div>');
    Modal.open('m-stmt');

    const [{ data: debts }, { data: invoices }] = await Promise.all([
      DB.sb?.from('debts').select('*').eq('customer_id', customerId).order('debt_date')
        ?? import('../core/db.js').then(m => m.sb.from('debts').select('*').eq('customer_id', customerId).order('debt_date')),
      DB.sb?.from('invoices').select('*').eq('customer_id', customerId).order('invoice_date')
        ?? import('../core/db.js').then(m => m.sb.from('invoices').select('*').eq('customer_id', customerId).order('invoice_date')),
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
      th,td{border:1px solid #ddd;padding:8px;text-align:right;}th{background:#f5f5f5;}</style></head>
      <body><h2>${title}</h2>${content}</body></html>`);
    w.document.close();
    w.print();
  },
};
