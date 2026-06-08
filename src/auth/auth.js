/**
 * auth.js — Authentication Module
 * Handles login, logout, session management via Supabase Auth
 */

import { sb, sbAdmin }  from '../core/db.js';
import { State }        from '../core/state.js';
import { ROLES }        from '../config/constants.js';
import * as DOM         from '../core/dom.js';
import { Notify }       from '../core/notify.js';

// Lazy imports to avoid circular dependencies
let AdminPanel, Store;
const getAdminPanel = async () => { if (!AdminPanel) ({ AdminPanel } = await import('../admin/admin-panel.js')); return AdminPanel; };
const getStore      = async () => { if (!Store)      ({ Store }      = await import('../nav/store-boot.js')); return Store; };

export const Auth = {
  /** Called on app load — restore session if exists */
  async init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await Auth._bootFromSession(session);
    } else {
      Auth._showAuth();
    }

    // Handle SIGNED_OUT only — don't re-boot on SIGNED_IN (we do that manually)
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        State.reset();
        Auth._showAuth();
      }
    });
  },

  /** Login with email + password via Supabase Auth */
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
      await Auth._bootFromSession(data.session);
    } catch (err) {
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

  /** Boot the app after a valid session */
  async _bootFromSession(session) {
    try {
      // Try auth_id first
      let { data: account } = await sbAdmin
        .from('app_accounts')
        .select('*')
        .eq('auth_id', session.user.id)
        .maybeSingle();

      // Fallback — try by email and auto-fix the missing auth_id
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
        Auth._showError('لم يُوجد حساب مرتبط بهذا البريد. تواصل مع المسؤول.');
        await Auth.logout();
        return;
      }

      if (!account.is_active) {
        Auth._showError('هذا الحساب موقوف. تواصل مع المسؤول.');
        await Auth.logout();
        return;
      }

      State.user = Auth._mapAccount(account);
      State.role = account.role;
      DOM.get('auth-wrap')?.classList.add('hidden');

      if (State.isAdmin()) {
        const panel = await getAdminPanel();
        await panel.boot();
      } else {
        if (Auth._isExpired(State.user)) { DOM.get('exp-wrap').style.display = 'flex'; return; }
        const store = await getStore();
        await store.boot(State.user);
      }
    } catch (err) {
      console.error('[Auth._bootFromSession]', err);
      Auth._showError('خطأ غير متوقع: ' + err.message);
    }
  },

  /** Map DB row to app account object */
  _mapAccount: (a) => ({
    id:               a.id,
    user:             a.username,
    store_name:       a.store_name,
    owner:            a.owner_name,
    role:             a.role ?? ROLES.OWNER,
    is_active:        a.is_active,
    subscription_end: a.subscription_end,
  }),

  _isExpired: (account) =>
    account.subscription_end && new Date(account.subscription_end) < new Date(),

  async logout() {
    await sb.auth.signOut();
    State.reset();
    const { Realtime } = await import('../nav/realtime.js');
    Realtime.stop();
    DOM.show('app-wrap', false);
    DOM.show('superadmin-wrap', false);
    Auth._showAuth();
  },

  _showAuth() {
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
