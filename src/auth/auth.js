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

import { sb }           from '../core/db.js';
import { State }        from '../core/state.js';
import { ROLES, CONFIG } from '../config/constants.js';
import * as DOM         from '../core/dom.js';
import { Notify }       from '../core/notify.js';

const Loading = {
  show() {
    const el = document.getElementById('loading-wrap');
    if (!el) return;
    el.style.display = 'flex';
    el.classList.add('fade-out');           // يبدأ شفافاً
    requestAnimationFrame(() => el.classList.remove('fade-out')); // ثم يتلاشى للظهور الكامل
  },
  hide() {
    const el = document.getElementById('loading-wrap');
    if (!el) return;
    el.classList.add('fade-out');            // يتلاشى للاختفاء أولاً
    setTimeout(() => { el.style.display = 'none'; }, 350); // ثم يُخفى فعلياً بعد اكتمال التلاشي
  },
};

export const Auth = {

  async init() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        // جلسة صالحة محلياً — أقلع فوراً (مع أو بدون نت، Supabase يجدّد التوكن بالخلفية)
        Loading.show();
        await Auth._bootFromSession(session);
      } else {
        // لا جلسة صالحة — قد يكون منتهية الصلاحية أو لم يسجّل دخول قبلاً
        // لو بدون نت وكان مسجّلاً دخول قبلاً، نحاول الإقلاع بالبيانات المحفوظة مباشرة
        if (!navigator.onLine) {
          const cachedAccount = (() => {
            try { return JSON.parse(localStorage.getItem('hsb_cached_account') || 'null'); } catch { return null; }
          })();
          if (cachedAccount) {
            // يوجد حساب محفوظ — نبني جلسة "وهمية" بما يكفي للإقلاع المحلي بدون أي طلب شبكي
            // البيانات الكافية: user.id (=store_id)، role، store_name، is_active، subscription_end
            Loading.show();
            await Auth._bootOffline(cachedAccount);
            return;
          }
        }
        // لا نت ولا بيانات محفوظة، أو في نت وانتهت الجلسة — عرض شاشة تسجيل الدخول
        Auth._showLogin();
        if (!navigator.onLine) Auth._showError('لا يوجد اتصال. سجّلي دخول مرة واحدة بنت لتفعيل الوصول بدون نت.');
      }
    } catch(err) {
      console.error('[Auth.init]', err);
      // أي خطأ غير متوقع — نحاول الإقلاع بالبيانات المحفوظة كخط دفاع أخير
      const cachedAccount = (() => {
        try { return JSON.parse(localStorage.getItem('hsb_cached_account') || 'null'); } catch { return null; }
      })();
      if (cachedAccount && !navigator.onLine) {
        Loading.show();
        await Auth._bootOffline(cachedAccount);
        return;
      }
      Loading.hide();
      Auth._showLogin();
    }

    sb.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        State.reset();
        // مسح كاشات localStorage عند أي حدث خروج (تلقائي أو يدوي)
        Object.keys(localStorage)
          .filter(k => k.startsWith('hsb_cache_'))
          .forEach(k => localStorage.removeItem(k));
        // إيقاف التحديث الدوري + مسح علامة المحل — يمنع interval leak و data leak
        try {
          const { Store } = await import('../nav/store-boot.js');
          Store._stopPeriodicRefresh();
          Store._loadedForStore = null;
        } catch {}
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

      // Show loading screen before booting — بانتقال ناعم بدل القطع الفوري
      const authEl = DOM.get('auth-wrap');
      if (authEl) authEl.classList.add('fade-out');
      await new Promise(resolve => setTimeout(resolve, 280));
      authEl?.classList.add('hidden');
      Loading.show();

      await Auth._bootFromSession(data.session);
    } catch (err) {
      Loading.hide();
      const authEl2 = DOM.get('auth-wrap');
      if (authEl2) { authEl2.classList.remove('hidden'); authEl2.classList.remove('fade-out'); }
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

  // ── إقلاع بدون شبكة — يستخدم بيانات الحساب المحفوظة محلياً من آخر جلسة ناجحة ──
  // هذا المسار لا يستدعي أي طلب شبكي على الإطلاق، يقلع الموقع كاملاً بالبيانات المحفوظة
  // محلياً (مخزون، فواتير، زبائن — كلها بـcache الموقع المحلي). البيع والإضافة تعمل فوراً
  // وتُزامَن لاحقاً عند رجوع النت، نفس فلسفة Optimistic UI التي بنيناها بكل أجزاء الموقع
  async _bootOffline(cachedAccount) {
    try {
      if (!cachedAccount?.is_active) {
        Loading.hide();
        Auth._showLogin();
        Auth._showError('لا يوجد اتصال. سجّلي دخول مرة واحدة بنت لتفعيل الوصول بدون نت.');
        return;
      }

      // تعيين State من البيانات المحفوظة — نفس ما يفعله _bootFromSession بالضبط
      State.user = {
        id:               cachedAccount.id,
        user:             cachedAccount.username,
        store_name:       cachedAccount.store_name,
        owner:            cachedAccount.owner_name,
        role:             cachedAccount.role ?? ROLES.OWNER,
        is_active:        cachedAccount.is_active,
        subscription_end: cachedAccount.subscription_end,
      };
      State.role = cachedAccount.role;

      // فحص انتهاء الاشتراك بالبيانات المحفوظة
      const expiry = cachedAccount.subscription_end;
      if (expiry && new Date(expiry) < new Date()) {
        Loading.hide();
        document.getElementById('exp-wrap').style.display = 'flex';
        return;
      }

      // إقلاع الواجهة كاملاً بدون أي انتظار شبكي — نفس مسار _bootFromSession العادي
      const { Store } = await import('../nav/store-boot.js');
      await Store.boot(State.user);

      Loading.hide();

      // تنبيه بسيط إن الموقع يعمل بوضع بدون نت — لا يمنع العمل، فقط معلومة
      setTimeout(() => {
        Notify.warn('📡 وضع بدون نت — البيانات محفوظة محلياً، ستُزامَن تلقائياً عند رجوع النت');
      }, 1500);

    } catch (err) {
      console.error('[Auth._bootOffline]', err);
      Loading.hide();
      Auth._showLogin();
      Auth._showError('خطأ في الإقلاع بدون نت: ' + err.message);
    }
  },

  async _bootFromSession(session) {
    try {
      // جلب حساب التطبيق عبر Edge Function آمنة — لا يصل مفتاح service_role أبداً للمتصفح
      let account = null;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/get-account`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const json = await res.json();
        if (res.ok) account = json.data;
      } catch (fetchErr) {
        console.error('[Auth] فشل الاتصال بخدمة الحسابات:', fetchErr.message);
      }

      if (!account) {
        // فشل الجلب — قد يكون فعلياً "لا حساب"، أو فقط انقطاع نت. نحاول الرجوع لآخر بيانات
        // حساب محفوظة محلياً قبل افتراض الأسوأ — تسجيل خروج هنا يدمّر إمكانية العمل بدون نت بالكامل
        const isNetworkFailure = !navigator.onLine || fetchErr?.name === 'AbortError';
        if (isNetworkFailure) {
          try {
            const cachedAccount = JSON.parse(localStorage.getItem('hsb_cached_account') || 'null');
            if (cachedAccount) account = cachedAccount;
          } catch {}
        }
      }

      if (!account) {
        Loading.hide();
        Auth._showLogin();
        Auth._showError(navigator.onLine ? 'لم يُوجد حساب مرتبط. تواصل مع المسؤول.' : 'لا يوجد اتصال بالإنترنت، ولا توجد بيانات محفوظة بعد.');
        if (navigator.onLine) await sb.auth.signOut(); // فقط نسجّل خروج فعلياً لو متأكدين إن المشكلة بالحساب نفسه، لا بالشبكة
        return;
      }

      // حفظ نسخة من بيانات الحساب محلياً — تُستخدم فقط كخط دفاع أخير عند انقطاع نت كامل لاحقاً
      try { localStorage.setItem('hsb_cached_account', JSON.stringify(account)); } catch {}

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
        window.AdminPanel = AdminPanel; // إتاحته لكل onclick بـ HTML بعد التحميل المؤجل
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
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);padding:1rem;';

    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:20px;width:100%;max-width:340px;
        overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.15);
        animation:slideUp .25s cubic-bezier(.34,1.2,.64,1);
      ">
        <!-- Header بلون الموقع -->
        <div style="
          background:linear-gradient(135deg,var(--p),var(--pd));
          padding:28px 24px 20px;text-align:center;
        ">
          <div style="
            width:56px;height:56px;border-radius:16px;
            background:rgba(255,255,255,0.15);
            display:flex;align-items:center;justify-content:center;
            margin:0 auto 12px;
          ">
            <i class="ti ti-building-store" style="font-size:26px;color:#fff;"></i>
          </div>
          <div style="font-size:17px;font-weight:900;color:#fff;margin-bottom:3px;">
            ${State.user?.store_name || 'حسابات'}
          </div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);">
            ${State.user?.owner || ''}
          </div>
        </div>

        <!-- Body -->
        <div style="padding:20px;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:15px;font-weight:700;color:var(--g9);margin-bottom:6px;">
              هل تريد تسجيل الخروج؟
            </div>
            <div style="font-size:13px;color:var(--g4);">
              سيتم إنهاء جلستك الحالية
            </div>
          </div>

          <button onclick="document.getElementById('logout-overlay').remove();Auth.logout()"
            style="
              width:100%;padding:13px;border-radius:12px;border:none;
              background:var(--d);color:#fff;
              font-family:Cairo,sans-serif;font-weight:800;font-size:14px;
              cursor:pointer;margin-bottom:8px;
              display:flex;align-items:center;justify-content:center;gap:6px;
            ">
            <i class="ti ti-logout" style="font-size:16px;"></i>
            تأكيد الخروج
          </button>

          <button onclick="document.getElementById('logout-overlay').remove()"
            style="
              width:100%;padding:12px;border-radius:12px;
              border:1.5px solid var(--g2);background:#fff;
              color:var(--g5);font-family:Cairo,sans-serif;
              font-weight:700;font-size:14px;cursor:pointer;
            ">
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

    // ── مسح كامل وقاطع لكل بيانات المتجر الحالي ──
    // State الأساسية
    State.reset();

    // ── مسح شامل وقاطع لكل بيانات المحل السابق ──
    // Module-level variables لا تُصفَّر بـState.reset() — يجب مسحها صريحاً
    await Promise.allSettled([
      import('../modules/customers.js').then(m => { m.Customers._allData = null; }),
      import('../modules/invoices.js').then(m  => { m.resetInvoicesCache?.(); }),
      import('../modules/debts.js').then(m     => { m.resetDebtsCache?.(); }),
      import('../modules/quicksale.js').then(m => { m.QuickSale?.clearCart?.(true); }),
    ]);

    // مسح window globals (pre-imported modules)
    ['Expenses','Purchases','Returns','Reports'].forEach(k => { delete window[k]; });

    // مسح كل كاشات localStorage (SWR cache)
    Object.keys(localStorage)
      .filter(k => k.startsWith('hsb_cache_'))
      .forEach(k => localStorage.removeItem(k));

    // إيقاف التحديث الدوري + مسح علامة المحل
    try {
      const { Store } = await import('../nav/store-boot.js');
      Store._stopPeriodicRefresh();
      Store._loadedForStore = null;
    } catch {}

    const { Realtime } = await import('../nav/realtime.js');
    Realtime.stop();
    DOM.show('app-wrap', false);
    DOM.show('superadmin-wrap', false);
    Loading.hide();
    await new Promise(resolve => setTimeout(resolve, 350));
    Auth._showLogin();
  },

  _showLogin() {
    DOM.show('app-wrap', false);
    DOM.show('superadmin-wrap', false);
    const authEl = DOM.get('auth-wrap');
    if (authEl) { authEl.classList.remove('hidden'); authEl.classList.remove('fade-out'); }
  },

  _showError(msg) {
    const el = DOM.get('lmsg');
    if (!el) return;
    el.textContent   = msg;
    el.className     = 'amsg err';
    el.style.display = 'block';
  },
};

window.Auth = Auth; // إتاحته لـ onclick بـ HTML (زر الدخول، تسجيل الخروج)
