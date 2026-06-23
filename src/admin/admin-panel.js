/**
 * admin-panel.js — Super Admin Panel Module
 * Handles store management, subscriptions, users
 */

import { sb }           from '../core/db.js';
import * as Utils from '../core/utils.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM          from '../core/dom.js';
import * as Modal        from '../nav/modal.js';
import { ROLES, CONFIG } from '../config/constants.js';
import { escape, formatDate } from '../core/utils.js';

// ── استدعاء عام لأي عملية إدارية عبر Edge Function آمنة (يتحقق من صلاحية الأدمن على السيرفر) ──
async function callAdminFunction(action, params) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('غير مسجّل دخول');

  const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/admin-service`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization':  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, params }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'فشل الاتصال بخدمة الإدارة');
  return json.data;
}

const AdminPanel = {
  async boot() {
    DOM.get('superadmin-wrap').style.display = 'flex';
    DOM.get('app-wrap').style.display = 'none';
    DOM.get('auth-wrap')?.classList.add('hidden');
    DOM.setText('sa-admin-name', State.user.owner);
    await AdminPanel.loadDashboard();
    AdminPanel.showPage('sa-dashboard');
  },

  // ── فتح modal إضافة محل جديد ──
  openNewStore() {
    // احذف أي modal قديم
    document.getElementById('m-new-store-dynamic')?.remove();

    const modal = document.createElement('div');
    modal.id = 'm-new-store-dynamic';
    modal.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.55);';
    modal.innerHTML = `
      <div style="background:var(--g9);border-radius:20px 20px 0 0;padding:1.5rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
          <span style="font-size:16px;font-weight:800;color:var(--g1);">إنشاء محل جديد</span>
          <button onclick="document.getElementById('m-new-store-dynamic').remove()" style="background:var(--g7);border:none;color:var(--g4);border-radius:8px;width:32px;height:32px;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:var(--g4);display:block;margin-bottom:5px;">اسم المحل *</label><input id="sa-new-store" style="width:100%;padding:12px 14px;border:1.5px solid var(--g7);border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:var(--g1);background:var(--g7);direction:rtl;box-sizing:border-box;" placeholder="بقالة أبو أحمد"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:var(--g4);display:block;margin-bottom:5px;">اسم صاحب المحل *</label><input id="sa-new-owner" style="width:100%;padding:12px 14px;border:1.5px solid var(--g7);border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:var(--g1);background:var(--g7);direction:rtl;box-sizing:border-box;"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:var(--g4);display:block;margin-bottom:5px;">رقم الجوال</label><input id="sa-new-phone" inputmode="tel" style="width:100%;padding:12px 14px;border:1.5px solid var(--g7);border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:var(--g1);background:var(--g7);direction:rtl;box-sizing:border-box;"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:var(--g4);display:block;margin-bottom:5px;">البريد الإلكتروني *</label><input id="sa-new-user" type="email" inputmode="email" style="width:100%;padding:12px 14px;border:1.5px solid var(--g7);border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:var(--g1);background:var(--g7);direction:ltr;box-sizing:border-box;" placeholder="store@mail.com"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:var(--g4);display:block;margin-bottom:5px;">كلمة المرور *</label><input id="sa-new-pass" type="password" style="width:100%;padding:12px 14px;border:1.5px solid var(--g7);border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:var(--g1);background:var(--g7);direction:ltr;box-sizing:border-box;"></div>
        <div style="margin-bottom:1rem;"><label style="font-size:13px;font-weight:600;color:var(--g4);display:block;margin-bottom:5px;">مدة الاشتراك</label>
          <select id="sa-new-months" style="width:100%;padding:12px 14px;border:1.5px solid var(--g7);border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:var(--g1);background:var(--g7);direction:rtl;box-sizing:border-box;">
            <option value="1">شهر</option><option value="3">3 أشهر</option><option value="6">6 أشهر</option><option value="12" selected>سنة كاملة</option><option value="24">سنتين</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="document.getElementById('m-new-store-dynamic').remove()" style="padding:8px 14px;border-radius:9px;border:1px solid var(--g7);background:var(--g9);color:var(--g4);font-family:Cairo,sans-serif;font-size:13px;font-weight:600;cursor:pointer;">إلغاء</button>
          <button onclick="AdminPanel.createStore()" style="padding:8px 16px;border-radius:9px;border:none;background:linear-gradient(135deg,var(--p),var(--pd));color:#fff;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="ti ti-plus"></i> إنشاء المحل</button>
        </div>
      </div>
    `;

    // إغلاق عند الضغط على الخلفية
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('sa-new-store')?.focus(), 100);
  },
  toggleSidebar() {
    const sidebar  = document.getElementById('sa-sidebar');
    const overlay  = document.getElementById('sa-sidebar-overlay');
    const isOpen   = sidebar?.classList.contains('open');
    if (isOpen) {
      sidebar?.classList.remove('open');
      overlay.style.display = 'none';
    } else {
      sidebar?.classList.add('open');
      overlay.style.display = 'block';
    }
  },

  closeSidebar() {
    document.getElementById('sa-sidebar')?.classList.remove('open');
    const overlay = document.getElementById('sa-sidebar-overlay');
    if (overlay) overlay.style.display = 'none';
  },

  showPage(id) {
    document.querySelectorAll('.sa-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sa-nav-item').forEach(n => n.classList.remove('active'));
    DOM.get(id)?.classList.add('active');
    document.querySelectorAll('.sa-nav-item').forEach(n => {
      if (n.getAttribute('onclick')?.includes(id)) n.classList.add('active');
    });
    AdminPanel.closeSidebar();
    const loaders = { 'sa-stores': AdminPanel.loadStores, 'sa-subscriptions': AdminPanel.loadSubscriptions, 'sa-users': AdminPanel.loadUsers, 'sa-dashboard': AdminPanel.loadDashboard, 'sa-transfer-entities': async () => { await AdminPanel._fillStoresDropdown('te-store-id'); await AdminPanel.loadTransferEntities(); } };
    loaders[id]?.();
  },

  async loadDashboard() {
    const { stores: storesData, invoices: invoicesData } = await callAdminFunction('loadDashboard', {});
    const stores      = storesData || [];
    const totalSales  = Utils.sumBy(invoicesData, 'total');
    const active      = stores.filter(s => s.is_active !== false).length;
    const expired     = stores.filter(s => s.subscription_end && new Date(s.subscription_end) < new Date()).length;

    DOM.setText('sa-stat-stores',  stores.length);
    DOM.setText('sa-stat-sales',   '₪' + totalSales.toLocaleString('en-US'));
    DOM.setText('sa-stat-active',  active);
    DOM.setText('sa-stat-expired', expired);

    DOM.setHTML('sa-stores-list', stores.length
      ? stores.map(s => AdminPanel._storeRow(s)).join('')
      : '<div style="text-align:center;padding:2rem;color:var(--g5);">لا توجد محلات</div>'
    );
  },

  async loadStores() {
    const data = await callAdminFunction('loadStores', {});
    DOM.setHTML('sa-all-stores', (data || []).map(s => AdminPanel._storeRow(s, true)).join('') || '<div style="text-align:center;padding:2rem;color:var(--g5);">لا توجد محلات</div>');
  },

  _storeRow(s, extended = false) {
    const isExpired = s.subscription_end && new Date(s.subscription_end) < new Date();
    const status    = isExpired ? '<span class="sa-badge-expired">منتهي</span>' : s.is_active === false ? '<span class="sa-badge-pending">موقوف</span>' : '<span class="sa-badge-active">نشط</span>';
    const subDate   = s.subscription_end ? new Date(s.subscription_end).toLocaleDateString('en-US') : '-';
    return `<div class="sa-row-card">
      <div class="sa-row-info">
        <div class="sa-row-name">${Utils.escape(s.store_name)}</div>
        <div class="sa-row-sub">${Utils.escape(s.owner_name || '-')}${extended && s.phone ? ' · ' + Utils.escape(s.phone) : ''}</div>
      </div>
      <div class="sa-row-mid">
        ${status}
        <div class="sa-row-date">${subDate}</div>
      </div>
      <div class="sa-row-actions">
        <button class="ibb" onclick="AdminPanel.editStore('${s.id}')">تعديل</button>
        <button class="${s.is_active === false ? 'ibg' : 'ibr'}" onclick="AdminPanel.toggleStore('${s.id}',${s.is_active !== false})">${s.is_active === false ? 'تفعيل' : 'إيقاف'}</button>
        ${extended ? `<button class="ibr" onclick="AdminPanel.deleteStore('${s.id}')">حذف</button>` : ''}
      </div>
    </div>`;
  },

  async loadSubscriptions() {
    const data = await callAdminFunction('loadSubscriptions', {});
    const list = (data || []).filter(a => a.role !== ROLES.SUPERADMIN);
    DOM.setHTML('sa-subs-list', list.length
      ? list.map(a => {
          const isExpired = a.subscription_end && new Date(a.subscription_end) < new Date();
          return `<div class="sa-row-card">
            <div class="sa-row-info">
              <div class="sa-row-name">${Utils.escape(a.store_name)}</div>
              <div class="sa-row-sub">${Utils.escape(a.username)}</div>
            </div>
            <div class="sa-row-mid">
              ${isExpired ? '<span class="sa-badge-expired">منتهي</span>' : '<span class="sa-badge-active">نشط</span>'}
              <div class="sa-row-date">${a.subscription_end ? new Date(a.subscription_end).toLocaleDateString('en-US') : '-'}</div>
            </div>
            <div class="sa-row-actions">
              <button class="ibb" onclick="AdminPanel.renewSubscription('${a.id}',365)">سنة</button>
              <button class="ibg" onclick="AdminPanel.renewSubscription('${a.id}',30)">شهر</button>
            </div>
          </div>`;
        }).join('')
      : '<div style="text-align:center;padding:2rem;color:var(--g5);">لا يوجد اشتراكات</div>'
    );
  },

  async loadUsers() {
    const data = await callAdminFunction('loadUsers', {});
    const list = (data || []).filter(a => a.role !== ROLES.SUPERADMIN);
    DOM.setHTML('sa-users-list', list.length
      ? list.map(a => `<div class="sa-row-card">
          <div class="sa-row-info">
            <div class="sa-row-name">${Utils.escape(a.store_name)}</div>
            <div class="sa-row-sub">${Utils.escape(a.username)} · ${Utils.escape(a.owner_name)}</div>
          </div>
          <div class="sa-row-mid">
            <span class="${a.role === ROLES.OWNER ? 'sa-badge-active' : 'sa-badge-pending'}">${a.role === ROLES.OWNER ? 'صاحب محل' : 'موظف'}</span>
            <span class="${a.is_active ? 'sa-badge-active' : 'sa-badge-expired'}">${a.is_active ? 'نشط' : 'موقوف'}</span>
          </div>
          <div class="sa-row-actions">
            <button class="${a.is_active ? 'ibr' : 'ibg'}" onclick="AdminPanel.toggleAccount('${a.id}',${a.is_active})">${a.is_active ? 'إيقاف' : 'تفعيل'}</button>
          </div>
        </div>`).join('')
      : '<div style="text-align:center;padding:2rem;color:var(--g5);">لا يوجد مستخدمين</div>'
    );
  },

  async createStore() {
    const store  = DOM.val('sa-new-store');
    const owner  = DOM.val('sa-new-owner');
    const phone  = DOM.val('sa-new-phone');
    const email  = DOM.val('sa-new-user');
    const pass   = DOM.val('sa-new-pass');
    const months = parseInt(DOM.val('sa-new-months')) || 12;
    if (!store || !owner || !email || !pass) { Notify.error('يرجى تعبئة الحقول المطلوبة'); return; }
    if (pass.length < 6) { Notify.error('كلمة المرور 6 أحرف على الأقل'); return; }

    const btn = document.querySelector('#m-new-store-dynamic button:last-child');
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الإنشاء...'; }

    try {
      await callAdminFunction('createStore', { store, owner, phone, email, pass, months });

      Notify.success('✅ تم إنشاء محل "' + store + '" — يمكن الدخول بـ: ' + email);
      document.getElementById('m-new-store-dynamic')?.remove();
      DOM.clearInputs('sa-new-store', 'sa-new-owner', 'sa-new-phone', 'sa-new-user', 'sa-new-pass');
      await Promise.all([AdminPanel.loadDashboard(), AdminPanel.loadStores()]);
    } catch (err) {
      Notify.error(err.message);
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  },


  async toggleStore(storeId, currentActive) {
    await callAdminFunction('toggleStore', { storeId, currentActive });
    Notify.show(!currentActive ? '✅ تم تفعيل المحل' : '⛔ تم إيقاف المحل');
    await AdminPanel.loadDashboard();
    await AdminPanel.loadStores();
  },

  async deleteStore(storeId) {
    if (!confirm('حذف هذا المحل وجميع بياناته نهائياً؟')) return;
    await callAdminFunction('deleteStore', { storeId });
    Notify.success('تم الحذف');
    await AdminPanel.loadDashboard();
    await AdminPanel.loadStores();
  },

  async renewSubscription(accId, days) {
    const result = await callAdminFunction('renewSubscription', { accId, days });
    Notify.success('تم التجديد حتى ' + result.dateStr);
    await AdminPanel.loadSubscriptions();
  },

  async toggleAccount(accId, currentActive) {
    await callAdminFunction('toggleAccount', { accId, currentActive });
    Notify.show(!currentActive ? '✅ تم التفعيل' : '⛔ تم الإيقاف');
    await AdminPanel.loadUsers();
  },

  toggleDrawer() {
    const sidebar  = document.getElementById('sa-sidebar');
    const overlay  = document.getElementById('sa-overlay');
    const isOpen   = sidebar.classList.contains('open');
    sidebar.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
  },

  closeDrawer() {
    document.getElementById('sa-sidebar')?.classList.remove('open');
    document.getElementById('sa-overlay')?.classList.remove('open');
  },

  resetTransferForm() {
    DOM.get('te-edit-id').value  = '';
    DOM.get('te-name').value     = '';
    DOM.get('te-names').value    = '';
    DOM.get('te-details').value  = '';
    DOM.get('te-store-id').value = '';
    const title = DOM.get('te-form-title');
    if (title) title.textContent = 'إضافة جهة';
  },

  editStore() { Notify.show('ميزة التعديل قريباً'); },

  async sendNotification() {
    const title   = DOM.val('notif-title');
    const msg     = DOM.val('notif-msg');
    const type    = DOM.val('notif-type') || 'info';
    const sendAll = DOM.get('notif-all')?.checked;
    if (!title || !msg) { Notify.error('أدخل العنوان والرسالة'); return; }

    if (sendAll) {
      // أرسل لكل المحلات — عبر Edge Function آمنة (تتطلب صلاحية أدمن)
      await callAdminFunction('sendNotification', { title, msg, type, sendAll: true });
    } else {
      const typeIcon = { info:'📢', update:'🆕', feature:'✨', warning:'⚠️' }[type] || '📢';
      const fullTitle = typeIcon + ' ' + title;
      await sb.from('notifications').insert({
        from_id: State.user.id,
        title: fullTitle,
        message: msg,
        type,
      });
    }
    Notify.success('تم إرسال الإشعار لـ ' + (sendAll ? 'جميع المحلات' : 'المحل الحالي'));
    DOM.clearInputs('notif-title', 'notif-msg');
  },

  async _fillStoresDropdown(selectId) {
    const data = await callAdminFunction('fillStoresDropdown', {});
    const sel = DOM.get(selectId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">-- اختر المحل --</option>'
      + (data || []).map(s => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${Utils.escape(s.store_name)}</option>`).join('');
  },

  // ── Transfer Entities Management ──
  async loadTransferEntities() {
    const { entities: data, stores } = await callAdminFunction('loadTransferEntitiesAdmin', {});
    const storeMap = Object.fromEntries((stores || []).map(s => [s.id, s.store_name]));
    DOM.setHTML('te-list', (data || []).length
      ? data.map(e => `<div class="sa-row-card" style="align-items:flex-start;">
          <div class="sa-row-info">
            <div class="sa-row-name">${Utils.escape(e.name)}</div>
            <div class="sa-row-sub">${Utils.escape(storeMap[e.store_id] || e.store_id)}</div>
            <div style="margin-top:6px;">${(e.names || []).map(n => `<span style="background:var(--pl);color:var(--pd);padding:2px 8px;border-radius:99px;font-size:11px;margin:2px;display:inline-block;">${Utils.escape(n)}</span>`).join('')}</div>
            ${e.details ? `<div class="sa-row-sub" style="margin-top:4px;">${Utils.escape(e.details)}</div>` : ''}
          </div>
          <div class="sa-row-mid">
            <span class="${e.is_active ? 'sa-badge-active' : 'sa-badge-expired'}">${e.is_active ? 'فعّال' : 'معطّل'}</span>
          </div>
          <div class="sa-row-actions">
            <button class="ibb" onclick="AdminPanel.editTransferEntity('${e.id}','${Utils.escape(e.name)}','${Utils.escape((e.names||[]).join('\n'))}','${Utils.escape(e.details||'')}','${e.store_id}')">تعديل</button>
            <button class="ibr" onclick="AdminPanel.deleteTransferEntity('${e.id}')">حذف</button>
          </div>
        </div>`).join('')
      : '<div style="text-align:center;padding:1.5rem;color:var(--g4);">لا توجد جهات تحويل</div>'
    );
  },

  async saveTransferEntity() {
    const id      = DOM.val('te-edit-id');
    const storeId = DOM.val('te-store-id');
    const name    = DOM.val('te-name').trim();
    const raw     = DOM.val('te-names').trim();
    const details = DOM.val('te-details').trim();
    if (!storeId) { Notify.error('اختر المحل'); return; }
    if (!name)    { Notify.error('أدخل اسم المجموعة'); return; }
    if (!raw)     { Notify.error('أدخل الجهات'); return; }

    const names = raw.split('\n').map(n => n.trim()).filter(n => n);

    await callAdminFunction('saveTransferEntity', { id: id || null, storeId, name, names, details: details || null });

    if (id) {
      Notify.success('تم التعديل');
      DOM.get('te-edit-id').value = '';
      const title = DOM.get('te-form-title');
      if (title) title.textContent = 'إضافة جهة';
    } else {
      Notify.success(`تمت الإضافة — ${names.length} جهة`);
    }
    DOM.get('te-name').value    = '';
    DOM.get('te-names').value   = '';
    DOM.get('te-details').value = '';
    DOM.get('te-name').focus();
    await AdminPanel.loadTransferEntities();
  },

  editTransferEntity(id, name, namesRaw, details, storeId) {
    DOM.get('te-edit-id').value   = id;
    DOM.get('te-name').value      = name;
    DOM.get('te-names').value     = namesRaw;
    DOM.get('te-details').value   = details;
    DOM.get('te-store-id').value  = storeId || '';
    const title = DOM.get('te-form-title');
    if (title) title.textContent  = 'تعديل الجهة';
    DOM.get('te-name').focus();
  },

  async deleteTransferEntity(id) {
    if (!confirm('حذف جهة التحويل؟')) return;
    await callAdminFunction('deleteTransferEntity', { id });
    Notify.success('تم الحذف');
    await AdminPanel.loadTransferEntities();
  },
};

export { AdminPanel };