/**
 * InventoryService.js — Inventory Management Service
 */

import { DB }    from '../core/db.js';
import { State } from '../core/state.js';

export const InventoryService = {

  /** Find product by barcode */
  async findByBarcode(barcode) {
    const { data } = await DB.inventory()
      .select('*')
      .eq('barcode', barcode)
      .maybeSingle();
    return data || null;
  },

  /** Find product by ID */
  async findById(id) {
    const { data } = await DB.inventory()
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return data || null;
  },

  /** Check if barcode already exists */
  async barcodeExists(barcode, excludeId = null) {
    const { data } = await DB.inventory()
      .select('id,name')
      .eq('barcode', barcode)
      .maybeSingle();
    if (!data) return false;
    if (excludeId && data.id === excludeId) return false;
    return data;
  },

  /** Add new product */
  async addProduct(payload) {
    // Check barcode uniqueness
    if (payload.barcode) {
      const exists = await InventoryService.barcodeExists(payload.barcode);
      if (exists) throw new Error('الباركود موجود مسبقاً لـ "' + exists.name + '"');
    }

    const { data, error } = await DB.inventory().insert({
      store_id:        State.user.id,
      name:            payload.name,
      barcode:         payload.barcode  || null,
      category:        payload.category || 'عام',
      unit:            payload.unit     || 'قطعة (pcs)',
      quantity:        parseFloat(payload.quantity)  || 0,
      sale_price:      parseFloat(payload.sellPrice) || 0,
      low_stock_alert: parseFloat(payload.minStock)  || 10,
    }).select().single();

    if (error) throw error;
    return data;
  },

  /** Deduct stock after sale — returns updated product */
  async deductStock(productId, qty) {
    const product = await InventoryService.findById(productId);
    if (!product) throw new Error('المنتج غير موجود');
    if (product.quantity < qty) throw new Error('المخزون غير كافٍ — المتبقي: ' + product.quantity);

    const newQty = Math.max(0, product.quantity - qty);
    const { error } = await DB.inventory()
      .update({ quantity: newQty })
      .eq('id', productId);

    if (error) throw error;
    return { ...product, quantity: newQty };
  },

  /** Restore stock after return */
  async restoreStock(productId, qty) {
    const product = await InventoryService.findById(productId);
    if (!product) throw new Error('المنتج غير موجود');

    const newQty = product.quantity + qty;
    await DB.inventory().update({ quantity: newQty }).eq('id', productId);
    return { ...product, quantity: newQty };
  },

  /** Get all inventory for current store */
  async getAll() {
    const { data } = await DB.inventory().select('*').order('name');
    return data || [];
  },

  /** Search inventory by name */
  async search(query) {
    const q = (query || '').toLowerCase();
    const all = await InventoryService.getAll();
    return all.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.barcode || '').includes(q)
    );
  },
};
