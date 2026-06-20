/**
 * FIFOService.js
 * خدمة FIFO — First In First Out
 * كل العمليات المتعلقة بطبقات المخزون
 */

import { sbAdmin } from '../core/db.js';
import { State }   from '../core/state.js';

// helper — يتحقق من store_id قبل أي عملية
function storeId() {
  const id = State.user?.id;
  if (!id) throw new Error('FIFO: غير مسجّل دخول');
  return id;
}

export const FIFOService = {

  // ── إضافة batch جديد عند الشراء ──
  async addBatch({ productId, quantity, costPrice, sellingPrice, purchaseInvoiceId, supplierId, purchaseDate }) {
    const sid = storeId();

    if (!productId)      throw new Error('FIFO addBatch: productId مطلوب');
    if (quantity <= 0)   throw new Error('FIFO addBatch: الكمية يجب أن تكون أكبر من صفر');
    if (costPrice < 0)   throw new Error('FIFO addBatch: سعر التكلفة غير صحيح');

    const { data, error } = await sbAdmin
      .from('inventory_batches')
      .insert({
        store_id:            sid,
        product_id:          productId,
        supplier_id:         supplierId        || null,
        purchase_invoice_id: purchaseInvoiceId || null,
        quantity_added:      quantity,
        quantity_remaining:  quantity,
        cost_price:          costPrice,
        selling_price:       sellingPrice      || null,
        purchase_date:       purchaseDate      || new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) throw new Error('FIFO addBatch: ' + error.message);
    return data;
  },

  // ── استهلاك FIFO عند البيع ──
  async consumeFIFO({ productId, quantityNeeded, invoiceId, saleItemId }) {
    const sid = storeId();

    if (!productId)        throw new Error('FIFO consumeFIFO: productId مطلوب');
    if (quantityNeeded <= 0) throw new Error('FIFO consumeFIFO: الكمية يجب أن تكون أكبر من صفر');
    if (!invoiceId)        throw new Error('FIFO consumeFIFO: invoiceId مطلوب');

    // جلب الـ batches الأقدم أولاً — مع تأكيد store_id
    const { data: batches, error } = await sbAdmin
      .from('inventory_batches')
      .select('id, quantity_remaining, cost_price')
      .eq('store_id', sid)
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

      const take   = Math.min(remaining, batch.quantity_remaining);
      const newQty = batch.quantity_remaining - take;

      // تحديث الـ batch — مع تأكيد store_id في الـ where
      const { error: upErr } = await sbAdmin
        .from('inventory_batches')
        .update({ quantity_remaining: newQty })
        .eq('id', batch.id)
        .eq('store_id', sid); // ✅ حماية إضافية

      if (upErr) throw new Error('FIFO update batch: ' + upErr.message);

      allocations.push({
        store_id:           sid,
        sale_invoice_id:    invoiceId,
        sale_item_id:       saleItemId || null,
        inventory_batch_id: batch.id,
        product_id:         productId,
        quantity_taken:     take,
        cost_price:         batch.cost_price,
      });

      totalCost += take * batch.cost_price;
      remaining -= take;
    }

    if (remaining > 0) throw new Error('المخزون غير كافٍ — نقص ' + remaining + ' وحدة');

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
    const sid = storeId();

    if (!invoiceId) return;

    // جلب الـ allocations — مع تأكيد store_id ✅
    const { data: allocs, error } = await sbAdmin
      .from('sale_inventory_allocations')
      .select('*')
      .eq('sale_invoice_id', invoiceId)
      .eq('store_id', sid); // ✅ حماية

    if (error || !allocs?.length) return;

    for (const alloc of allocs) {
      // جلب الـ batch — مع تأكيد store_id ✅
      const { data: batch } = await sbAdmin
        .from('inventory_batches')
        .select('quantity_remaining')
        .eq('id', alloc.inventory_batch_id)
        .eq('store_id', sid) // ✅ حماية
        .single();

      if (batch) {
        await sbAdmin
          .from('inventory_batches')
          .update({ quantity_remaining: batch.quantity_remaining + alloc.quantity_taken })
          .eq('id', alloc.inventory_batch_id)
          .eq('store_id', sid); // ✅ حماية
      }
    }

    // حذف الـ allocations — مع تأكيد store_id ✅
    await sbAdmin
      .from('sale_inventory_allocations')
      .delete()
      .eq('sale_invoice_id', invoiceId)
      .eq('store_id', sid); // ✅ حماية
  },

  // ── حساب تكلفة FIFO للمنتج (بدون استهلاك) ──
  async estimateCost(productId, quantity) {
    const sid = storeId();

    const { data: batches } = await sbAdmin
      .from('inventory_batches')
      .select('quantity_remaining, cost_price')
      .eq('store_id', sid)
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
    const sid = storeId();

    const { data } = await sbAdmin
      .from('inventory_batches')
      .select('*')
      .eq('store_id', sid)
      .eq('product_id', productId)
      .gt('quantity_remaining', 0)
      .order('purchase_date', { ascending: true });

    return data || [];
  },

  // ── تقييم المخزون الكلي (للتقارير) ──
  async getInventoryValue() {
    const sid = storeId();

    const { data } = await sbAdmin
      .from('inventory_batches')
      .select('quantity_remaining, cost_price, selling_price')
      .eq('store_id', sid)
      .gt('quantity_remaining', 0);

    if (!data) return { costValue: 0, sellValue: 0 };

    const costValue = data.reduce((s, b) => s + b.quantity_remaining * b.cost_price, 0);
    const sellValue = data.reduce((s, b) => s + b.quantity_remaining * (b.selling_price || 0), 0);

    return { costValue, sellValue };
  },

  // ── التراجع عن عملية شراء محذوفة: يرجّع للمخزون فقط الكمية غير المُباعة فعلياً ──
  // (الكمية اللي استُهلكت بالفعل ببيع سابق لا تُمس — حذف عملية الشراء لا يبطل بيعاً تم بالفعل)
  async removeBatchByPurchase(purchaseId, productId) {
    const sid = storeId();

    const { data: batch } = await sbAdmin
      .from('inventory_batches')
      .select('*')
      .eq('store_id', sid)
      .eq('purchase_invoice_id', purchaseId)
      .maybeSingle();

    // لا يوجد batch مرتبط (عملية شراء قديمة قبل ربط الـ batches، أو فشل إنشاء الـ batch أصلاً)
    if (!batch) return { reverted: 0, found: false };

    const unsoldQty = batch.quantity_remaining; // الكمية المتبقية غير المُباعة فعلياً من هذا الـ batch بالضبط

    if (unsoldQty > 0 && productId) {
      const { data: inv } = await sbAdmin
        .from('inventory')
        .select('quantity')
        .eq('id', productId)
        .maybeSingle();
      if (inv) {
        await sbAdmin
          .from('inventory')
          .update({ quantity: Math.max(0, inv.quantity - unsoldQty) })
          .eq('id', productId);
      }
    }

    // صفّر الـ batch بدل حذفه نهائياً — يحافظ على السجل التاريخي لأي مبيعات استهلكت منه بالفعل
    await sbAdmin
      .from('inventory_batches')
      .update({ quantity_remaining: 0 })
      .eq('id', batch.id);

    return { reverted: unsoldQty, found: true };
  },
};
