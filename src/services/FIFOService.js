/**
 * FIFOService.js
 * خدمة FIFO — First In First Out
 * كل العمليات المتعلقة بطبقات المخزون
 */

import { sbAdmin } from '../core/db.js';
import { State }   from '../core/state.js';

export const FIFOService = {

  // ── إضافة batch جديد عند الشراء ──
  async addBatch({ productId, quantity, costPrice, sellingPrice, purchaseInvoiceId, supplierId, purchaseDate }) {
    const { data, error } = await sbAdmin
      .from('inventory_batches')
      .insert({
        store_id:             State.user.id,
        product_id:           productId,
        supplier_id:          supplierId   || null,
        purchase_invoice_id:  purchaseInvoiceId || null,
        quantity_added:       quantity,
        quantity_remaining:   quantity,
        cost_price:           costPrice,
        selling_price:        sellingPrice || null,
        purchase_date:        purchaseDate || new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) throw new Error('FIFO addBatch: ' + error.message);
    return data;
  },

  // ── استهلاك FIFO عند البيع ──
  // يرجع: { allocations, totalCost }
  async consumeFIFO({ productId, quantityNeeded, invoiceId, saleItemId }) {
    const storeId = State.user.id;

    // جلب الـ batches الأقدم أولاً (FIFO)
    const { data: batches, error } = await sbAdmin
      .from('inventory_batches')
      .select('id, quantity_remaining, cost_price')
      .eq('store_id', storeId)
      .eq('product_id', productId)
      .gt('quantity_remaining', 0)
      .order('purchase_date', { ascending: true })
      .order('created_at',    { ascending: true });

    if (error) throw new Error('FIFO consumeFIFO fetch: ' + error.message);
    if (!batches?.length) throw new Error('لا يوجد مخزون كافٍ للمنتج');

    let remaining = quantityNeeded;
    const allocations = [];
    let totalCost = 0;

    for (const batch of batches) {
      if (remaining <= 0) break;

      const take = Math.min(remaining, batch.quantity_remaining);
      const newQty = batch.quantity_remaining - take;

      // تحديث الـ batch
      const { error: upErr } = await sbAdmin
        .from('inventory_batches')
        .update({ quantity_remaining: newQty })
        .eq('id', batch.id);

      if (upErr) throw new Error('FIFO update batch: ' + upErr.message);

      // تسجيل الـ allocation
      allocations.push({
        store_id:            storeId,
        sale_invoice_id:     invoiceId,
        sale_item_id:        saleItemId || null,
        inventory_batch_id:  batch.id,
        product_id:          productId,
        quantity_taken:      take,
        cost_price:          batch.cost_price,
      });

      totalCost += take * batch.cost_price;
      remaining -= take;
    }

    if (remaining > 0) throw new Error('المخزون غير كافٍ — نقص ' + remaining + ' وحدة');

    // حفظ الـ allocations
    if (allocations.length) {
      const { error: aErr } = await sbAdmin
        .from('sale_inventory_allocations')
        .insert(allocations);
      if (aErr) throw new Error('FIFO save allocations: ' + aErr.message);
    }

    return { allocations, totalCost };
  },

  // ── إرجاع المخزون للـ batches عند الإرجاع ──
  async reverseFIFO(invoiceId) {
    const { data: allocs, error } = await sbAdmin
      .from('sale_inventory_allocations')
      .select('*')
      .eq('sale_invoice_id', invoiceId);

    if (error || !allocs?.length) return;

    for (const alloc of allocs) {
      // إرجاع الكمية للـ batch الأصلي
      const { data: batch } = await sbAdmin
        .from('inventory_batches')
        .select('quantity_remaining')
        .eq('id', alloc.inventory_batch_id)
        .single();

      if (batch) {
        await sbAdmin
          .from('inventory_batches')
          .update({ quantity_remaining: batch.quantity_remaining + alloc.quantity_taken })
          .eq('id', alloc.inventory_batch_id);
      }
    }

    // حذف الـ allocations
    await sbAdmin
      .from('sale_inventory_allocations')
      .delete()
      .eq('sale_invoice_id', invoiceId);
  },

  // ── حساب تكلفة FIFO للمنتج (بدون استهلاك) ──
  async estimateCost(productId, quantity) {
    const { data: batches } = await sbAdmin
      .from('inventory_batches')
      .select('quantity_remaining, cost_price')
      .eq('store_id', State.user.id)
      .eq('product_id', productId)
      .gt('quantity_remaining', 0)
      .order('purchase_date', { ascending: true })
      .order('created_at',    { ascending: true });

    if (!batches?.length) return 0;

    let remaining = quantity;
    let totalCost = 0;

    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.quantity_remaining);
      totalCost += take * b.cost_price;
      remaining -= take;
    }

    return totalCost;
  },

  // ── جلب طبقات المخزون لعرضها ──
  async getBatches(productId) {
    const { data } = await sbAdmin
      .from('inventory_batches')
      .select('*')
      .eq('store_id', State.user.id)
      .eq('product_id', productId)
      .gt('quantity_remaining', 0)
      .order('purchase_date', { ascending: true });

    return data || [];
  },

  // ── تقييم المخزون الكلي (للتقارير) ──
  async getInventoryValue() {
    const { data } = await sbAdmin
      .from('inventory_batches')
      .select('quantity_remaining, cost_price, selling_price')
      .eq('store_id', State.user.id)
      .gt('quantity_remaining', 0);

    if (!data) return { costValue: 0, sellValue: 0 };

    const costValue = data.reduce((s, b) => s + b.quantity_remaining * b.cost_price, 0);
    const sellValue = data.reduce((s, b) => s + b.quantity_remaining * (b.selling_price || 0), 0);

    return { costValue, sellValue };
  },
};
