/**
 * auth.js — Authentication Module
 */

import { sb, sbAdmin }  from '../core/db.js';
import { State }        from '../core/state.js';
import { ROLES }        from '../config/constants.js';
import * as DOM         from '../core/dom.js';
import { Notify }       from '../core/notify.js';

const SESSION_KEY = 'hesabat_account_id';

export const Auth = {

  async init() {
    try {
      // First try Supabase Auth session (persisted in localStorage automatically)
      const { data: { session } } = await sb.auth.getSession();

      if (session) {
        await Auth._bootFromSession(session);
        return;
      }

      // No session — show login
      Auth._showAuth();
    } catch(err) {
      console.error('[Auth.init] failed:', err);
      Auth._showAuth(); // Always hide loading screen even on error
    }

    // Listen for sign out
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        State.reset();
        Auth._showAuth();
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

  async _bootFromSession(session) {
    try {
      // Fetch account by auth_id
      let { data: account } = await sbAdmin
        .from('app_accounts')
        .select('*')
        .eq('auth_id', session.user.id)
        .maybeSingle();

      // Fallback: match by email and auto-fix auth_id
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
        Auth._showError('لم يُوجد حساب مرتبط. تواصل مع المسؤول.');
        await sb.auth.signOut();
        return;
      }

      if (!account.is_active) {
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

      // Hide loading screen and auth screen
      DOM.show('loading-wrap', false);
      DOM.get('auth-wrap')?.classList.add('hidden');

      // Boot correct panel
      if (State.isAdmin()) {
        const { AdminPanel } = await import('../admin/admin-panel.js');
        await AdminPanel.boot();
      } else {
        const expiry = account.subscription_end;
        if (expiry && new Date(expiry) < new Date()) {
          DOM.get('exp-wrap').style.display = 'flex';
          return;
        }
        const { Store } = await import('../nav/store-boot.js');
        await Store.boot(State.user);
      }

    } catch (err) {
      console.error('[Auth._bootFromSession]', err);
      Auth._showAuth(); // Always hide loading screen
      Auth._showError('خطأ: ' + err.message);
    }
  },

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
    DOM.show('loading-wrap', false);
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
