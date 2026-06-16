/**
 * api/db.js — Vercel Serverless Function
 * الـ serviceKey يبقى هنا على السيرفر فقط
 * المتصفح يتصل بـ /api/db بدل Supabase مباشرة
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://omtrbatypecsraettrbw.supabase.co';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-store-id');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // تحقق من الـ store_id
  const storeId = req.headers['x-store-id'];
  if (!storeId) return res.status(401).json({ error: 'Missing store_id' });

  const { table, action, data, filters, select, order, limit } = req.body;

  if (!table || !action) return res.status(400).json({ error: 'Missing table or action' });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    // تطبيق store_id على كل العمليات
    let query;

    switch (action) {
      case 'select':
        query = supabase.from(table).select(select || '*').eq('store_id', storeId);
        if (filters) {
          for (const [col, val] of Object.entries(filters)) {
            query = query.eq(col, val);
          }
        }
        if (order)  query = query.order(order.column, { ascending: order.ascending ?? true });
        if (limit)  query = query.limit(limit);
        break;

      case 'insert':
        // أضف store_id تلقائياً
        const insertData = Array.isArray(data)
          ? data.map(d => ({ ...d, store_id: storeId }))
          : { ...data, store_id: storeId };
        query = supabase.from(table).insert(insertData).select();
        break;

      case 'update':
        query = supabase.from(table).update(data).eq('store_id', storeId);
        if (filters) {
          for (const [col, val] of Object.entries(filters)) {
            query = query.eq(col, val);
          }
        }
        break;

      case 'delete':
        query = supabase.from(table).delete().eq('store_id', storeId);
        if (filters) {
          for (const [col, val] of Object.entries(filters)) {
            query = query.eq(col, val);
          }
        }
        break;

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const { data: result, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ data: result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
