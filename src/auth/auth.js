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
        // Has session — show loading then boot
        Loading.show();
        await Auth._bootFromSession(session);
      } else {
        // No session — show login directly
        Auth._showLogin();
      }
    } catch(err) {
      console.error('[Auth.init]', err);
      // فشل شبكي وقت فحص الجلسة (لا نت أصلاً عند فتح الموقع) — لا نفترض خروجاً، نحاول القراءة
      // المباشرة من التخزين المحلي الذي يحفظه Supabase نفسه، ونكمل الإقلاع بالبيانات المحفوظة
      const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
      if (isNetworkFailure) {
        try {
          const raw = localStorage.getItem(`sb-${CONFIG.supabaseUrl.replace(/^https?:\/\//, '').split('.')[0]}-auth-token`);
          const stored = raw ? JSON.parse(raw) : null;
          // فحص أمني محلي — التوكن المحفوظ صالح فعلياً عند الإصدار، لكن له تاريخ انتهاء حقيقي.
          // بدون نت لا نقدر نتحقق من الخادم، فنضع حد سماحية معقول (7 أيام) قبل رفض توكن قديم
          // جداً بدل قبوله للأبد بثقة كاملة — هذا يقلل نافذة الخطر لو الجهاز فُقد أو حساب أُوقف
          const expiresAt = stored?.expires_at ? stored.expires_at * 1000 : 0;
          const isReasonablyFresh = expiresAt > 0 && (Date.now() - expiresAt) < 7 * 24 * 3600 * 1000;
          if (stored?.access_token && isReasonablyFresh) {
            Loading.show();
            await Auth._bootFromSession(stored);
            return;
          }
        } catch {}
      }
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

  async _bootFromSession(session) {
    try {
      // جلب حساب التطبيق عبر Edge Function آمنة — لا يصل مفتاح service_role أبداً للمتصفح
      let account = null;
      let fetchErr = null;
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
      } catch (err) {
        fetchErr = err;
        console.error('[Auth] فشل الاتصال بخدمة الحسابات:', err.message);
      }

      if (!account) {
        // فشل الجلب — قد يكون فعلياً "لا حساب"، أو فقط انقطاع نت. نحاول الرجوع لآخر بيانات
        // حساب محفوظة محلياً قبل افتراض الأسوأ — تسجيل خروج هنا يدمّر إمكانية العمل بدون نت بالكامل
        const isNetworkFailure = !navigator.onLine || fetchErr?.name === 'AbortError' || fetchErr instanceof TypeError;
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
    try {
      await sb.auth.signOut();
    } catch (err) {
      // فشل شبكي وقت الخروج (لا نت) — لا نوقف عملية الخروج بصرياً بسببها، الجلسة المحلية
      // ستُمحى بكل الأحوال أدناه، فلا يمكن استخدامها مجدداً للدخول التلقائي حتى لو الخادم
      // لم يُعلَم بعد بإلغاء الجلسة (سيحدث تلقائياً لاحقاً عبر آلية Supabase الداخلية)
      console.warn('[Auth.logout] فشل إلغاء الجلسة من الخادم (الجلسة المحلية ستُمحى بكل الأحوال):', err.message);
    }
    // محو نسخة الحساب المحفوظة محلياً — تمنع استخدامها لإعادة دخول تلقائي بعد خروج صريح
    try { localStorage.removeItem("hsb_cached_account"); } catch {}
    // محو مفتاح جلسة Supabase نفسه صريحاً — حماية إضافية حرجة: لو signOut() فشلت بدون نت
    // (لا اتصال لإلغاء التوكن من الخادم)، هذا يضمن عدم بقاء جلسة صالحة محلياً تُستخدَم
    // تلقائياً بالمرة القادمة، بغض النظر عن نجاح/فشل الاستدعاء الشبكي أعلاه
    try {
      const tokenKey = `sb-${CONFIG.supabaseUrl.replace(/^https?:\/\//, "").split(".")[0]}-auth-token`;
      localStorage.removeItem(tokenKey);
    } catch {}
    State.reset();
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
