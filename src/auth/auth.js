/**
 * auth.js — Authentication Module
 *
 * Flow:
 * 1. Page load → check session
 *    - Session exists → show loading → boot → dashboard
 *    - No session    → show login
 * 2. Login → show loading → boot → dashboard
 * 3. Logout → show login
 */

import { sb, sbAdmin }  from '../core/db.js';
import { State }        from '../core/state.js';
import { ROLES }        from '../config/constants.js';
import * as DOM         from '../core/dom.js';
import { Notify }       from '../core/notify.js';

const Loading = {
  show() {
    const el = document.getElementById('loading-wrap');
    if (el) { el.style.display = 'flex'; }
  },
  hide() {
    const el = document.getElementById('loading-wrap');
    if (el) el.style.display = 'none';
  },
};

export const Auth = {

  async init() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        // Has session — show loading then boot
        Loading.show();
        await Auth._bootFromSession(session);
      } else {
        // No session — show login directly
        Auth._showLogin();
      }
    } catch(err) {
      console.error('[Auth.init]', err);
      Loading.hide();
      Auth._showLogin();
    }

    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        State.reset();
        Loading.hide();
        Auth._showLogin();
      }
    });
  },

  async login() {
    const email    = DOM.val('le');
    const password = DOM.val('lp');
    if (!email || !password) { Auth._showError('يرجى تعبئة الحقول'); return; }

    const btn = DOM.get('btn-li');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الدخول...'; }

    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data?.session) throw new Error('No session returned');

      // Show loading screen before booting
      Loading.show();
      DOM.get('auth-wrap')?.classList.add('hidden');

      await Auth._bootFromSession(data.session);
    } catch (err) {
      Loading.hide();
      DOM.get('auth-wrap')?.classList.remove('hidden');
      const msg = err.message?.includes('Invalid login credentials')
        ? 'البريد أو كلمة المرور غير صحيحة'
        : err.message?.includes('Email not confirmed')
        ? 'البريد غير مفعّل'
        : 'خطأ: ' + (err.message ?? 'غير معروف');
      Auth._showError(msg);
    } finally {
      if (btn) {
        btn.disabled  = false;
        btn.innerHTML = '<i class="ti ti-login" style="vertical-align:-2px;margin-left:5px;"></i> دخول';
      }
    }
  },

  async _bootFromSession(session) {
    try {
      // Fetch account by auth_id
      let { data: account } = await sbAdmin
        .from('app_accounts')
        .select('*')
        .eq('auth_id', session.user.id)
        .maybeSingle();

      // Fallback by email
      if (!account) {
        const { data: byEmail } = await sbAdmin
          .from('app_accounts')
          .select('*')
          .eq('username', session.user.email)
          .maybeSingle();

        if (byEmail) {
          await sbAdmin.from('app_accounts')
            .update({ auth_id: session.user.id })
            .eq('id', byEmail.id);
          account = { ...byEmail, auth_id: session.user.id };
        }
      }

      if (!account) {
        Loading.hide();
        Auth._showLogin();
        Auth._showError('لم يُوجد حساب مرتبط. تواصل مع المسؤول.');
        await sb.auth.signOut();
        return;
      }

      if (!account.is_active) {
        Loading.hide();
        Auth._showLogin();
        Auth._showError('هذا الحساب موقوف.');
        await sb.auth.signOut();
        return;
      }

      // Set state
      State.user = {
        id:               account.id,
        user:             account.username,
        store_name:       account.store_name,
        owner:            account.owner_name,
        role:             account.role ?? ROLES.OWNER,
        is_active:        account.is_active,
        subscription_end: account.subscription_end,
      };
      State.role = account.role;

      // Boot panel — hide loading after boot
      if (State.isAdmin()) {
        const { AdminPanel } = await import('../admin/admin-panel.js');
        await AdminPanel.boot();
      } else {
        const expiry = account.subscription_end;
        if (expiry && new Date(expiry) < new Date()) {
          Loading.hide();
          document.getElementById('exp-wrap').style.display = 'flex';
          return;
        }
        const { Store } = await import('../nav/store-boot.js');
        await Store.boot(State.user);
      }

      // Done — hide loading
      Loading.hide();

    } catch (err) {
      console.error('[Auth._bootFromSession]', err);
      Loading.hide();
      Auth._showLogin();
      Auth._showError('خطأ غير متوقع: ' + err.message);
    }
  },

  confirmLogout() {
    document.getElementById('logout-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'logout-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:999999',
      'display:flex;align-items:center;justify-content:center',
      'background:rgba(0,0,0,0.45);backdrop-filter:blur(6px)',
      'padding:1rem;animation:fadeIn .2s ease',
    ].join(';');

    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:24px;padding:0;
        width:100%;max-width:360px;overflow:hidden;
        box-shadow:0 24px 64px rgba(0,0,0,0.2);
        animation:slideUp .25s cubic-bezier(.34,1.56,.64,1);
      ">
        <!-- Header gradient -->
        <div style="
          background:linear-gradient(135deg,#1e293b 0%,#334155 100%);
          padding:28px 24px 24px;text-align:center;position:relative;
        ">
          <!-- Avatar -->
          <div style="
            width:64px;height:64px;border-radius:50%;
            background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.2);
            display:flex;align-items:center;justify-content:center;
            margin:0 auto 14px;font-size:26px;
          ">👤</div>

          <div style="font-size:18px;font-weight:900;color:#fff;margin-bottom:4px;">
            ${State.user?.owner || 'المستخدم'}
          </div>
          <div style="
            display:inline-flex;align-items:center;gap:5px;
            background:rgba(255,255,255,0.1);border-radius:20px;
            padding:4px 12px;font-size:12px;color:#94a3b8;margin-top:2px;
          ">
            <i class="ti ti-building-store" style="font-size:13px;"></i>
            ${State.user?.store_name || ''}
          </div>
        </div>

        <!-- Body -->
        <div style="padding:24px;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="
              width:48px;height:48px;border-radius:14px;
              background:#fee2e2;display:flex;align-items:center;
              justify-content:center;margin:0 auto 12px;
            ">
              <i class="ti ti-logout" style="font-size:22px;color:#dc2626;"></i>
            </div>
            <div style="font-size:16px;font-weight:800;color:#1e293b;margin-bottom:6px;">
              تسجيل الخروج
            </div>
            <div style="font-size:13px;color:#94a3b8;line-height:1.6;">
              هل أنت متأكد من تسجيل الخروج؟<br>سيتم إنهاء جلستك الحالية
            </div>
          </div>

          <!-- Buttons -->
          <button onclick="document.getElementById('logout-overlay').remove();Auth.logout()"
            style="
              width:100%;padding:14px;border-radius:14px;border:none;
              background:linear-gradient(135deg,#dc2626,#b91c1c);
              color:#fff;font-family:Cairo,sans-serif;font-weight:800;
              font-size:15px;cursor:pointer;margin-bottom:10px;
              display:flex;align-items:center;justify-content:center;gap:8px;
              box-shadow:0 4px 14px rgba(220,38,38,0.35);
              transition:transform .15s;
            "
            onmousedown="this.style.transform='scale(.97)'"
            onmouseup="this.style.transform='scale(1)'">
            <i class="ti ti-logout" style="font-size:17px;"></i>
            تأكيد الخروج
          </button>

          <button onclick="document.getElementById('logout-overlay').remove()"
            style="
              width:100%;padding:13px;border-radius:14px;
              border:1.5px solid #e2e8f0;background:#f8fafc;
              color:#64748b;font-family:Cairo,sans-serif;font-weight:700;
              font-size:14px;cursor:pointer;transition:background .15s;
            "
            onmouseenter="this.style.background='#f1f5f9'"
            onmouseleave="this.style.background='#f8fafc'">
            إلغاء
          </button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  },

  async logout() {
    Loading.show();
    await sb.auth.signOut();
    State.reset();
    const { Realtime } = await import('../nav/realtime.js');
    Realtime.stop();
    DOM.show('app-wrap', false);
    DOM.show('superadmin-wrap', false);
    Loading.hide();
    Auth._showLogin();
  },

  _showLogin() {
    DOM.show('app-wrap', false);
    DOM.show('superadmin-wrap', false);
    DOM.get('auth-wrap')?.classList.remove('hidden');
  },

  _showError(msg) {
    const el = DOM.get('lmsg');
    if (!el) return;
    el.textContent   = msg;
    el.className     = 'amsg err';
    el.style.display = 'block';
  },
};
