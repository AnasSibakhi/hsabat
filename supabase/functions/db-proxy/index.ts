// supabase/functions/db-proxy/index.ts
// Edge Function — تستقبل طلبات DB وتنفذها بالـ serviceKey على السيرفر

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-store-id, Authorization',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // تحقق من store_id
  const storeId = req.headers.get('x-store-id');
  if (!storeId) {
    return new Response(JSON.stringify({ error: 'Missing store_id' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { table, action, data, filters, select, order, limit, offset, gte, gt, in: inFilter } = await req.json();

  if (!table || !action) {
    return new Response(JSON.stringify({ error: 'Missing table or action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
    let query: any;

    switch (action) {
      case 'select':
        query = supabase.from(table).select(select || '*').eq('store_id', storeId);
        if (filters)   for (const [c, v] of Object.entries(filters)) query = query.eq(c, v);
        if (gte)       query = query.gte(gte.col, gte.val);
        if (gt)        query = query.gt(gt.col, gt.val);
        if (inFilter)  query = query.in(inFilter.col, inFilter.vals);
        if (order)     query = query.order(order.column, { ascending: order.ascending ?? true });
        if (limit)     query = query.limit(limit);
        if (offset !== undefined) query = query.range(offset, offset + (limit || 50) - 1);
        break;

      case 'insert':
        const insertData = Array.isArray(data)
          ? data.map((d: any) => ({ ...d, store_id: storeId }))
          : { ...data, store_id: storeId };
        query = supabase.from(table).insert(insertData).select();
        break;

      case 'update':
        query = supabase.from(table).update(data).eq('store_id', storeId);
        if (filters) for (const [c, v] of Object.entries(filters)) query = query.eq(c, v);
        break;

      case 'delete':
        query = supabase.from(table).delete().eq('store_id', storeId);
        if (filters) for (const [c, v] of Object.entries(filters)) query = query.eq(c, v);
        break;

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const { data: result, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ data: result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
