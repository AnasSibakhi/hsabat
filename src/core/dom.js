/**
 * dom.js — Safe DOM access helpers
 * Centralizes all DOM manipulation — never use document.getElementById elsewhere
 */

/** Get element by ID — never throws */
export const get = (id) => document.getElementById(id);

/** Get trimmed value of input by ID */
export const val = (id) => document.getElementById(id)?.value?.trim() ?? '';

/** Set text content safely */
export const setText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

/** Set innerHTML — only use with escaped content */
export const setHTML = (id, html) => {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
};

/** Show or hide element */
export const show = (id, visible = true) => {
  const el = document.getElementById(id);
  if (!el) return;
  // Use class-based hiding for elements that need specific display values
  // app-wrap needs display:flex, others use display:block
  if (id === 'app-wrap') {
    visible ? el.classList.remove('hidden') : el.classList.add('hidden');
  } else {
    el.style.display = visible ? '' : 'none';
  }
};

/** Toggle CSS class on element */
export const toggle = (id, cls, force) =>
  document.getElementById(id)?.classList?.toggle(cls, force);

/** Clear multiple input values */
export const clearInputs = (...ids) =>
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

/** Show loading spinner in a table body */
export const showLoading = (id, cols) =>
  setHTML(id, `<tr class="er"><td colspan="${cols}"><span class="spin">↻</span></td></tr>`);

/** Show empty state message in a table body */
export const showEmpty = (id, cols, msg) =>
  setHTML(id, `<tr class="er"><td colspan="${cols}">${msg}</td></tr>`);

/** Set value of an input */
export const setVal = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.value = value;
};
