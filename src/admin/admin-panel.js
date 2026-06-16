/**
 * admin-panel.js — Super Admin Panel Module
 * Handles store management, subscriptions, users
 */

import { sbAdmin, sb } from '../core/db.js';
import * as Utils from '../core/utils.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM          from '../core/dom.js';
import * as Modal        from '../nav/modal.js';
import { ROLES }       from '../config/constants.js';
import { escape, formatDate } from '../core/utils.js';

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
      <div style="background:#1e293b;border-radius:20px 20px 0 0;padding:1.5rem;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
          <span style="font-size:16px;font-weight:800;color:#f1f5f9;">إنشاء محل جديد</span>
          <button onclick="document.getElementById('m-new-store-dynamic').remove()" style="background:#334155;border:none;color:#94a3b8;border-radius:8px;width:32px;height:32px;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:#94a3b8;display:block;margin-bottom:5px;">اسم المحل *</label><input id="sa-new-store" style="width:100%;padding:12px 14px;border:1.5px solid #334155;border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:#f1f5f9;background:#334155;direction:rtl;box-sizing:border-box;" placeholder="بقالة أبو أحمد"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:#94a3b8;display:block;margin-bottom:5px;">اسم صاحب المحل *</label><input id="sa-new-owner" style="width:100%;padding:12px 14px;border:1.5px solid #334155;border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:#f1f5f9;background:#334155;direction:rtl;box-sizing:border-box;"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:#94a3b8;display:block;margin-bottom:5px;">رقم الجوال</label><input id="sa-new-phone" inputmode="tel" style="width:100%;padding:12px 14px;border:1.5px solid #334155;border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:#f1f5f9;background:#334155;direction:rtl;box-sizing:border-box;"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:#94a3b8;display:block;margin-bottom:5px;">البريد الإلكتروني *</label><input id="sa-new-user" type="email" inputmode="email" style="width:100%;padding:12px 14px;border:1.5px solid #334155;border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:#f1f5f9;background:#334155;direction:ltr;box-sizing:border-box;" placeholder="store@mail.com"></div>
        <div style="margin-bottom:.9rem;"><label style="font-size:13px;font-weight:600;color:#94a3b8;display:block;margin-bottom:5px;">كلمة المرور *</label><input id="sa-new-pass" type="password" style="width:100%;padding:12px 14px;border:1.5px solid #334155;border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:#f1f5f9;background:#334155;direction:ltr;box-sizing:border-box;"></div>
        <div style="margin-bottom:1rem;"><label style="font-size:13px;font-weight:600;color:#94a3b8;display:block;margin-bottom:5px;">مدة الاشتراك</label>
          <select id="sa-new-months" style="width:100%;padding:12px 14px;border:1.5px solid #334155;border-radius:10px;font-size:15px;font-family:Cairo,sans-serif;color:#f1f5f9;background:#334155;direction:rtl;box-sizing:border-box;">
            <option value="1">شهر</option><option value="3">3 أشهر</option><option value="6">6 أشهر</option><option value="12" selected>سنة كاملة</option><option value="24">سنتين</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="document.getElementById('m-new-store-dynamic').remove()" style="padding:8px 14px;border-radius:9px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-family:Cairo,sans-serif;font-size:13px;font-weight:600;cursor:pointer;">إلغاء</button>
          <button onclick="AdminPanel.createStore()" style="padding:8px 16px;border-radius:9px;border:none;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="ti ti-plus"></i> إنشاء المحل</button>
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
    const [r1, r2] = await Promise.all([
      sbAdmin.from('stores').select('id,store_name,owner_name,is_active,subscription_end'),
      sbAdmin.from('invoices').select('total'),
    ]);
    const stores      = r1.data || [];
    const totalSales  = Utils.sumBy(r2.data, 'total');
    const active      = stores.filter(s => s.is_active !== false).length;
    const expired     = stores.filter(s => s.subscription_end && new Date(s.subscription_end) < new Date()).length;

    DOM.setText('sa-stat-stores',  stores.length);
    DOM.setText('sa-stat-sales',   '₪' + totalSales.toLocaleString('en-US'));
    DOM.setText('sa-stat-active',  active);
    DOM.setText('sa-stat-expired', expired);

    DOM.setHTML('sa-stores-list', stores.length
      ? stores.map(s => AdminPanel._storeRow(s)).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#64748b;">لا توجد محلات</td></tr>'
    );
  },

  async loadStores() {
    const { data } = await sbAdmin.from('stores').select('*').order('created_at', { ascending: false });
    DOM.setHTML('sa-all-stores', (data || []).map(s => AdminPanel._storeRow(s, true)).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#64748b;">لا توجد محلات</td></tr>');
  },

  _storeRow(s, extended = false) {
    const isExpired = s.subscription_end && new Date(s.subscription_end) < new Date();
    const status    = isExpired ? '<span class="sa-badge-expired">منتهي</span>' : s.is_active === false ? '<span class="sa-badge-pending">موقوف</span>' : '<span class="sa-badge-active">نشط</span>';
    const subDate   = s.subscription_end ? new Date(s.subscription_end).toLocaleDateString('en-US') : '-';
    return `<tr>
      <td><strong>${Utils.escape(s.store_name)}</strong></td>
      <td>${Utils.escape(s.owner_name || '-')}</td>
      ${extended ? `<td>${Utils.escape(s.phone || '-')}</td>` : ''}
      <td>${status}</td>
      <td>${subDate}</td>
      <td>
        <button class="ibb" onclick="AdminPanel.editStore('${s.id}')">تعديل</button>
        <button class="${s.is_active === false ? 'ibg' : 'ibr'}" onclick="AdminPanel.toggleStore('${s.id}',${s.is_active !== false})" style="margin-right:4px;">${s.is_active === false ? 'تفعيل' : 'إيقاف'}</button>
        ${extended ? `<button class="ibr" onclick="AdminPanel.deleteStore('${s.id}')" style="margin-right:4px;">حذف</button>` : ''}
      </td>
    </tr>`;
  },

  async loadSubscriptions() {
    const { data } = await sbAdmin.from('app_accounts').select('*').order('created_at', { ascending: false });
    const list     = (data || []).filter(a => a.role !== ROLES.SUPERADMIN);
    DOM.setHTML('sa-subs-list', list.length
      ? list.map(a => {
          const isExpired = a.subscription_end && new Date(a.subscription_end) < new Date();
          return `<tr>
            <td>${Utils.escape(a.store_name)}</td>
            <td>${Utils.escape(a.username)}</td>
            <td>${isExpired ? '<span class="br">منتهي</span>' : '<span class="bg">نشط</span>'}</td>
            <td>${a.subscription_end ? new Date(a.subscription_end).toLocaleDateString('en-US') : '-'}</td>
            <td>
              <button class="ibb" onclick="AdminPanel.renewSubscription('${a.id}',365)">تجديد سنة</button>
              <button class="ibg" onclick="AdminPanel.renewSubscription('${a.id}',30)" style="margin-right:4px;">شهر</button>
            </td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#64748b;">لا يوجد اشتراكات</td></tr>'
    );
  },

  async loadUsers() {
    const { data } = await sbAdmin.from('app_accounts').select('*').order('created_at', { ascending: false });
    const list     = (data || []).filter(a => a.role !== ROLES.SUPERADMIN);
    DOM.setHTML('sa-users-list', list.length
      ? list.map(a => `<tr>
          <td>${Utils.escape(a.store_name)}</td>
          <td>${Utils.escape(a.username)}</td>
          <td>${Utils.escape(a.owner_name)}</td>
          <td><span class="${a.role === ROLES.OWNER ? 'bb' : 'ba'}">${a.role === ROLES.OWNER ? 'صاحب محل' : 'موظف'}</span></td>
          <td><span class="${a.is_active ? 'bg' : 'br'}">${a.is_active ? 'نشط' : 'موقوف'}</span></td>
          <td><button class="${a.is_active ? 'ibr' : 'ibg'}" onclick="AdminPanel.toggleAccount('${a.id}',${a.is_active})">${a.is_active ? 'إيقاف' : 'تفعيل'}</button></td>
        </tr>`).join('')
      : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#64748b;">لا يوجد مستخدمين</td></tr>'
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

    const storeId = 'store-' + Date.now().toString(36);
    const subEnd  = new Date(); subEnd.setMonth(subEnd.getMonth() + months);
    const subStr  = subEnd.toISOString().split('T')[0];

    try {
      // 1. Auth User أولاً
      const { data: adminData, error: adminErr } = await sbAdmin.auth.admin.createUser({
        email, password: pass, email_confirm: true,
        user_metadata: { store_name: store, owner_name: owner, role: ROLES.OWNER },
      });
      if (adminErr) throw adminErr;
      const authUserId = adminData?.user?.id;
      if (!authUserId) throw new Error('فشل إنشاء حساب المصادقة');

      // 2 + 3 بالتوازي
      const [r1, r2] = await Promise.all([
        sbAdmin.from('stores').insert({
          id: storeId, store_name: store, owner_name: owner,
          phone, is_active: true, subscription_end: subStr, auth_id: authUserId,
        }),
        sbAdmin.from('app_accounts').insert({
          id: storeId, username: email, password: 'supabase-auth',
          store_name: store, owner_name: owner, role: ROLES.OWNER,
          is_active: true, subscription_end: subStr, auth_id: authUserId,
        }),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;

      // 4. تهيئة البطاقات في الخلفية
      db_netCards_init(storeId).catch(() => {});

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
    const newState = !currentActive;
    await sbAdmin.from('stores').update({ is_active: newState }).eq('id', storeId);
    await sbAdmin.from('app_accounts').update({ is_active: newState }).eq('id', storeId);
    Notify.show(newState ? '✅ تم تفعيل المحل' : '⛔ تم إيقاف المحل');
    await AdminPanel.loadDashboard();
    await AdminPanel.loadStores();
  },

  async deleteStore(storeId) {
    if (!confirm('حذف هذا المحل وجميع بياناته نهائياً؟')) return;
    await sbAdmin.from('stores').delete().eq('id', storeId);
    await sbAdmin.from('app_accounts').delete().eq('id', storeId);
    Notify.success('تم الحذف');
    await AdminPanel.loadDashboard();
    await AdminPanel.loadStores();
  },

  async renewSubscription(accId, days) {
    const subEnd = new Date(); subEnd.setDate(subEnd.getDate() + days);
    const dateStr = subEnd.toISOString().split('T')[0];
    await sbAdmin.from('app_accounts').update({ subscription_end: dateStr, is_active: true }).eq('id', accId);
    await sbAdmin.from('stores').update({ subscription_end: dateStr, is_active: true }).eq('id', accId);
    Notify.success('تم التجديد حتى ' + dateStr);
    await AdminPanel.loadSubscriptions();
  },

  async toggleAccount(accId, currentActive) {
    await sbAdmin.from('app_accounts').update({ is_active: !currentActive }).eq('id', accId);
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

    const typeIcon = { info:'📢', update:'🆕', feature:'✨', warning:'⚠️' }[type] || '📢';
    const fullTitle = typeIcon + ' ' + title;

    if (sendAll) {
      // أرسل لكل المحلات
      const { data: stores } = await sbAdmin.from('app_accounts').select('id');
      const rows = (stores || []).map(s => ({
        from_id: State.user.id,
        store_id: s.id,
        title: fullTitle,
        message: msg,
        type,
      }));
      if (rows.length) await sbAdmin.from('notifications').insert(rows);
    } else {
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
    const { data } = await sbAdmin.from('app_accounts').select('id, store_name').order('store_name');
    const sel = DOM.get(selectId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">-- اختر المحل --</option>'
      + (data || []).map(s => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${Utils.escape(s.store_name)}</option>`).join('');
  },

  // ── Transfer Entities Management ──
  async loadTransferEntities() {
    const [{ data }, { data: stores }] = await Promise.all([
      sbAdmin.from('transfer_entities').select('*').order('name'),
      sbAdmin.from('app_accounts').select('id, store_name'),
    ]);
    const storeMap = Object.fromEntries((stores || []).map(s => [s.id, s.store_name]));
    DOM.setHTML('te-list', (data || []).length
      ? data.map(e => `<tr>
          <td>${Utils.escape(storeMap[e.store_id] || e.store_id)}</td>
          <td><strong>${Utils.escape(e.name)}</strong></td>
          <td>${(e.names || []).map(n => `<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:99px;font-size:11px;margin:2px;display:inline-block;">${Utils.escape(n)}</span>`).join('')}</td>
          <td>${Utils.escape(e.details || '-')}</td>
          <td><span class="${e.is_active ? 'sa-badge-active' : 'sa-badge-expired'}">${e.is_active ? 'فعّال' : 'معطّل'}</span></td>
          <td>
            <button class="ibb" onclick="AdminPanel.editTransferEntity('${e.id}','${Utils.escape(e.name)}','${Utils.escape((e.names||[]).join('\n'))}','${Utils.escape(e.details||'')}','${e.store_id}')">تعديل</button>
            <button class="ibr" onclick="AdminPanel.deleteTransferEntity('${e.id}')">حذف</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:#94a3b8;">لا توجد جهات تحويل</td></tr>'
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

    if (id) {
      await sbAdmin.from('transfer_entities').update({ name, names, details: details || null }).eq('id', id);
      Notify.success('تم التعديل');
      DOM.get('te-edit-id').value = '';
      const title = DOM.get('te-form-title');
      if (title) title.textContent = 'إضافة جهة';
    } else {
      await sbAdmin.from('transfer_entities').insert({ store_id: storeId, name, names, details: details || null });
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
    await sbAdmin.from('transfer_entities').delete().eq('id', id);
    Notify.success('تم الحذف');
    await AdminPanel.loadTransferEntities();
  },
};

// Helper for initializing net card stock for new stores
async function db_netCards_init(storeId) {
  await sbAdmin.from('net_cards_stock').insert(
    ['1','2','3'].map(type => ({ store_id: storeId, card_type: type, quantity: 0 }))
  );
}

export { AdminPanel };