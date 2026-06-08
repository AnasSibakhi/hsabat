/**
 * utils.js — Pure utility functions
 * No side effects, no imports from other app modules
 * Fully testable in isolation
 */

/** Format number as currency string */
export const currency = (n) =>
  '₪ ' + (Math.round((n ?? 0) * 100) / 100).toLocaleString('en-US');

/** Sum array of objects by a key */
export const sumBy = (arr, key) =>
  (arr ?? []).reduce((acc, r) => acc + (r[key] ?? 0), 0);

/** Days elapsed since a date string */
export const daysSince = (dateStr) =>
  Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);

/** Today as YYYY-MM-DD */
export const today = () => new Date().toISOString().split('T')[0];

/** First day of current month as YYYY-MM-DD */
export const monthStart = () =>
  new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().split('T')[0];

/** N days ago as YYYY-MM-DD */
export const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

/** Period start date for 'day' | 'week' | 'month' */
export const periodStart = (period) => {
  if (period === 'day')  return today();
  if (period === 'week') return daysAgo(7);
  return monthStart();
};

/** Escape HTML to prevent XSS — use on ALL user-generated content */
export const escape = (str) =>
  String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Debounce — returns a debounced version of fn */
export const debounce = (fn, ms = 800) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

/** Generate a next invoice number — e.g. INV-0042 */
export const invoiceNumber = (count) =>
  'INV-' + String((count ?? 0) + 1).padStart(4, '0');

/** Format a date string for display */
export const formatDate = (dateStr) =>
  dateStr ? new Date(dateStr).toLocaleDateString('en-US') : '-';

/** Current time as HH:MM AM/PM */
export const currentTime = () =>
  new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
