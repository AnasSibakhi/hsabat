/**
 * admin-panel.js — Super Admin Panel Module
 * Handles store management, subscriptions, users
 */

import { sbAdmin, sb } from '../core/db.js';
import { State }       from '../core/state.js';
import { Notify }      from '../core/notify.js';
import * as DOM          from '../core/dom.js';
import * as Modal        from '../nav/modal.js';
import { ROLES }       from '../config/constants.js';
import { escape, formatDate } from '../core/utils.js';

const AdminPanel = {
  async boot() {
    DOM.get('superadmin-wrap').style.display = 'flex';
    DOM.setText('sa-admin-name', State.user.owner);
    await AdminPanel.loadDashboard();
    AdminPanel.showPage('sa-dashboard');
  },

  showPage(id) {
    document.querySelectorAll('.sa-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sa-nav-item').forEach(n => n.classList.remove('active'));
    DOM.get(id)?.classList.add('active');
    document.querySelectorAll('.sa-nav-item').forEach(n => {
      if (n.getAttribute('onclick')?.includes(id)) n.classList.add('active');
    });
    const loaders = { 'sa-stores': AdminPanel.loadStores, 'sa-subscriptions': AdminPanel.loadSubscriptions, 'sa-users': AdminPanel.loadUsers, 'sa-dashboard': AdminPanel.loadDashboard };
    loaders[id]?.();
  },

  async loadDashboard() {
    const [r1, r2] = await Promise.all([
      sb.from('stores').select('id,store_name,owner_name,is_active,subscription_end'),
      sb.from('invoices').select('total'),
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
    const status    = isExpired ? '<span class="br">منتهي</span>' : s.is_active === false ? '<span class="ba">موقوف</span>' : '<span class="bg">نشط</span>';
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

    const storeId = 'store-' + Date.now().toString(36);
    const subEnd  = new Date(); subEnd.setMonth(subEnd.getMonth() + months);
    const subStr  = subEnd.toISOString().split('T')[0];

    try {
      // 1. إنشاء المستخدم عبر Admin API — لا يغير الـ session الحالية
      const { data: adminData, error: adminErr } = await sbAdmin.auth.admin.createUser({
        email,
        password: pass,
        email_confirm: true,
        user_metadata: { store_name: store, owner_name: owner, role: ROLES.OWNER },
      });

      if (adminErr) throw adminErr;
      const authUserId = adminData?.user?.id;
      if (!authUserId) throw new Error('فشل إنشاء حساب المصادقة');

      console.log('[createStore] auth user created:', authUserId);

      // 2. إنشاء المحل — نستخدم sbAdmin لتجاوز RLS
      const { error: e1 } = await sbAdmin.from('stores').insert({
        id: storeId, store_name: store, owner_name: owner,
        phone, is_active: true, subscription_end: subStr, auth_id: authUserId,
      });
      if (e1) throw e1;

      // 3. إنشاء الحساب في app_accounts مع auth_id
      const { error: e2 } = await sbAdmin.from('app_accounts').insert({
        id:               storeId,
        username:         email,
        password:         'supabase-auth',
        store_name:       store,
        owner_name:       owner,
        role:             ROLES.OWNER,
        is_active:        true,
        subscription_end: subStr,
        auth_id:          authUserId,
      });
      if (e2) throw e2;

      // 4. تهيئة مخزون البطاقات
      await db_netCards_init(storeId);

      Notify.success('✅ تم إنشاء محل "' + store + '" — يمكن الدخول بـ: ' + email);
      Modal.close('m-new-store');
      DOM.clearInputs('sa-new-store', 'sa-new-owner', 'sa-new-phone', 'sa-new-user', 'sa-new-pass');
      await AdminPanel.loadDashboard();
      await AdminPanel.loadStores();
    } catch (err) {
      console.error('[AdminPanel.createStore]', err);
      Notify.error(err.message);
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

  editStore() { Notify.show('ميزة التعديل قريباً'); },

  async sendNotification() {
    const title = DOM.val('notif-title');
    const msg   = DOM.val('notif-msg');
    if (!title || !msg) { Notify.error('أدخل العنوان والرسالة'); return; }
    await sb.from('notifications').insert({ from_id: State.user.id, title, message: msg });
    Notify.success('تم إرسال الإشعار');
    DOM.clearInputs('notif-title', 'notif-msg');
  },
};

// Helper for initializing net card stock for new stores
async function db_netCards_init(storeId) {
  await sbAdmin.from('net_cards_stock').insert(
    ['1','2','3'].map(type => ({ store_id: storeId, card_type: type, quantity: 0 }))
  );
}

export { AdminPanel };