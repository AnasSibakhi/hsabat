/**
 * db.js - Database Layer
 */

import { createClient } from '@supabase/supabase-js';
import { CONFIG }       from '../config/constants.js';

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// ── استدعاء عام لجدول inventory عبر Edge Function آمنة ──
async function callInventoryDB(action, params) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('غير مسجّل دخول');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/inventory-db`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization':  `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, params }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'فشل الاتصال بخدمة المخزون');

    saveToOfflineCache('inventory', action, params, json.data);
    return json.data;

  } catch (err) {
    const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
    if (isNetworkFailure && action === 'select') {
      const cached = loadFromOfflineCache('inventory', action, params);
      if (cached !== null) return cached;
    }
    throw err;
  }
}


// ── Query builder آمن لجدول inventory — نفس الواجهة المتسلسلة المستخدمة بالموقع بالضبط ──
function secureInventoryTable() {
  return {
    select: (columns) => {
      const filters = [];
      let orderSpec = null, limitSpec = null;
      const b = {
        eq:  (c, v) => { filters.push({ op: 'eq',  col: c, val: v }); return b; },
        gt:  (c, v) => { filters.push({ op: 'gt',  col: c, val: v }); return b; },
        gte: (c, v) => { filters.push({ op: 'gte', col: c, val: v }); return b; },
        in:  (c, v) => { filters.push({ op: 'in',  col: c, val: v }); return b; },
        order: (c, o) => { orderSpec = { col: c, ascending: o?.ascending !== false }; return b; },
        limit: (n)    => { limitSpec = n; return b; },
        single:      () => callInventoryDB('select', { columns, filters, order: orderSpec, limit: limitSpec, single: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        maybeSingle: () => callInventoryDB('select', { columns, filters, order: orderSpec, limit: limitSpec, maybeSingle: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then: (resolve, reject) => callInventoryDB('select', { columns, filters, order: orderSpec, limit: limitSpec })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    insert: (row) => {
      const promise = callInventoryDB('insert', { row });
      return {
        select: () => ({
          single: () => promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
          then:   (resolve, reject) => promise.then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
        }),
        single: () => promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then:   (resolve, reject) => promise.then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
    },

    update: (changes) => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callInventoryDB('update', { changes, filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callInventoryDB('update', { changes, filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    delete: () => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callInventoryDB('delete', { filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callInventoryDB('delete', { filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    eq:  (c, v) => secureInventoryTable().select('*').eq(c, v),
    gte: (c, v) => secureInventoryTable().select('*').gte(c, v),
    gt:  (c, v) => secureInventoryTable().select('*').gt(c, v),
  };
}

// ── طبقة العرض بدون نت — تخزين مؤقت شفاف لنتائج القراءة، نقطة واحدة تخدم كل الموقع ──
const OFFLINE_CACHE_PREFIX = 'hsb_cache_';
const OFFLINE_CACHE_VERSION = 'v1';

function offlineCacheKey(table, action, params) {
  // مفتاح ثابت ومميَّز لكل تركيبة (جدول + نوع عملية + فلاتر)، بدون تضمين بيانات حساسة بالمفتاح نفسه
  const sig = JSON.stringify({ table, action, params });
  let hash = 0;
  for (let i = 0; i < sig.length; i++) { hash = (hash * 31 + sig.charCodeAt(i)) | 0; }
  return `${OFFLINE_CACHE_PREFIX}${OFFLINE_CACHE_VERSION}_${table}_${hash}`;
}

function saveToOfflineCache(table, action, params, data) {
  // فقط عمليات القراءة تُخزَّن — الكتابة (insert/update/delete) لا تُحفَظ هنا لتجنّب أي التباس بالبيانات الفعلية
  if (action !== 'select') return;
  try {
    localStorage.setItem(offlineCacheKey(table, action, params), JSON.stringify({ data, savedAt: Date.now() }));
  } catch {} // لو امتلأت المساحة المحلية، نتجاهل بصمت — هذا تحسين اختياري، لا وظيفة حرجة
}

function loadFromOfflineCache(table, action, params) {
  if (action !== 'select') return null;
  try {
    const raw = localStorage.getItem(offlineCacheKey(table, action, params));
    if (!raw) return null;
    const { data } = JSON.parse(raw);
    return data;
  } catch { return null; }
}

// ── استدعاء عام لكل الجداول المتبقية عبر Edge Function موحّدة آمنة ──
async function callStoreDB(table, action, params) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('غير مسجّل دخول');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/store-db`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization':  `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ table, action, params }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'فشل الاتصال بالخدمة');

    saveToOfflineCache(table, action, params, json.data);
    return json.data;

  } catch (err) {
    // فشل الشبكة (لا نت، أو انقطاع وسط الطلب) — نحاول الرجوع لآخر نسخة محفوظة بدل رمي الخطأ
    const isNetworkFailure = err instanceof TypeError || err?.name === 'AbortError' || err?.message?.includes('fetch') || !navigator.onLine;
    if (isNetworkFailure && action === 'select') {
      const cached = loadFromOfflineCache(table, action, params);
      if (cached !== null) return cached; // وجدنا نسخة محفوظة — نرجعها بصمت، الصفحة تعمل بشكل طبيعي بالبيانات القديمة
    }
    throw err; // لا نسخة محفوظة، أو هذي عملية كتابة (لا تُخزَّن أبداً) — الخطأ الحقيقي يظهر كما كان سابقاً
  }
}

// ── Query builder آمن — نفس الواجهة المتسلسلة المستخدمة بالموقع بالضبط، لكل الجداول المتبقية ──
function secureStoreTable(table) {
  return {
    select: (columns) => {
      const filters = [];
      let orderSpec = null, limitSpec = null, offsetSpec = null;
      const b = {
        eq:  (c, v) => { filters.push({ op: 'eq',  col: c, val: v }); return b; },
        gt:  (c, v) => { filters.push({ op: 'gt',  col: c, val: v }); return b; },
        gte: (c, v) => { filters.push({ op: 'gte', col: c, val: v }); return b; },
        in:  (c, v) => { filters.push({ op: 'in',  col: c, val: v }); return b; },
        order: (c, o) => { orderSpec = { col: c, ascending: o?.ascending !== false }; return b; },
        limit: (n)    => { limitSpec = n; return b; },
        offset: (n)   => { offsetSpec = n; return b; },
        single:      () => callStoreDB(table, 'select', { columns, filters, order: orderSpec, limit: limitSpec, offset: offsetSpec, single: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        maybeSingle: () => callStoreDB(table, 'select', { columns, filters, order: orderSpec, limit: limitSpec, offset: offsetSpec, maybeSingle: true })
          .then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then: (resolve, reject) => {
          // دعم نمط count: select('*', { count: 'exact', head: true })
          const isCountQuery = typeof columns === 'object' && columns?.count === 'exact';
          const action = isCountQuery
            ? callStoreDB(table, 'select', { filters, countOnly: true })
            : callStoreDB(table, 'select', { columns, filters, order: orderSpec, limit: limitSpec, offset: offsetSpec });
          return action
            .then(data => resolve(isCountQuery ? { count: data.count, error: null } : { data, error: null }))
            .catch(error => (reject ? reject(error) : resolve({ data: null, error, count: null })));
        },
      };
      return b;
    },

    insert: (rowOrRows) => {
      const isArray = Array.isArray(rowOrRows);
      const promise = isArray
        ? callStoreDB(table, 'insert', { rows: rowOrRows })
        : callStoreDB(table, 'insert', { row: rowOrRows });
      return {
        select: () => ({
          single: () => promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
          then:   (resolve, reject) => promise.then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
        }),
        single: () => promise.then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
        then:   (resolve, reject) => promise.then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
    },

    update: (changes) => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callStoreDB(table, 'update', { changes, filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callStoreDB(table, 'update', { changes, filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    delete: () => {
      const filters = [];
      const b = {
        eq: (c, v) => {
          filters.push({ op: 'eq', col: c, val: v });
          return { then: (resolve, reject) => callStoreDB(table, 'delete', { filters })
            .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))) };
        },
        then: (resolve, reject) => callStoreDB(table, 'delete', { filters })
          .then(data => resolve({ data, error: null })).catch(error => (reject ? reject(error) : resolve({ data: null, error }))),
      };
      return b;
    },

    eq:  (c, v) => secureStoreTable(table).select('*').eq(c, v),
    gte: (c, v) => secureStoreTable(table).select('*').gte(c, v),
    gt:  (c, v) => secureStoreTable(table).select('*').gt(c, v),
  };
}

export const DB = {
  customers:        () => secureStoreTable('customers'),
  debts:            () => secureStoreTable('debts'),
  invoices:         () => secureStoreTable('invoices'),
  invoiceItems:     () => secureStoreTable('invoice_items'),
  inventory:        () => secureInventoryTable(),
  purchases:        () => secureStoreTable('purchases'),
  netCardStock:     () => secureStoreTable('net_cards_stock'),
  netCardSales:     () => secureStoreTable('net_card_sales'),
  netCardPurchases: () => secureStoreTable('net_card_purchases'),
  expenses:         () => secureStoreTable('expenses'),
  returns:          () => secureStoreTable('returns'),
  notifications:    () => secureStoreTable('notifications'),
};
