/**
 * nav.js — Navigation Module
 */
import { State } from '../core/state.js';

const _loaders = {};
export const register = (pageId, fn) => { _loaders[pageId] = fn; };

// Force browser to recalculate scroll after data renders
function _forceScrollRecalc() {
  const content = document.getElementById('main-content');
  if (!content) return;
  // Trigger reflow: read then write forces browser to recalculate layout
  content.style.overflow = 'hidden';
  void content.offsetHeight; // force reflow
  content.style.overflow = '';
  void content.offsetHeight; // reflow again with correct value
  content.style.overflowY = 'auto';
}

export const go = (pageId, activeElement = null) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  const content = document.getElementById('main-content');
  if (content) {
    pageId === 'quicksale'
      ? content.classList.add('qs-mode')
      : content.classList.remove('qs-mode');
  }

  document.getElementById('page-' + pageId)?.classList.add('active');
  if (activeElement) activeElement.classList.add('active');
  State.currentPage = pageId;

  // Load data then force scroll recalc
  const loader = _loaders[pageId];
  if (loader) {
    const result = loader();
    // If loader returns a Promise (async), recalc after data renders
    if (result && typeof result.then === 'function') {
      result.then(() => {
        requestAnimationFrame(() => _forceScrollRecalc());
      });
    } else {
      requestAnimationFrame(() => _forceScrollRecalc());
    }
  } else {
    requestAnimationFrame(() => _forceScrollRecalc());
  }
};

export const goTo = (pageId) => {
  go(pageId);
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('bn-' + pageId)?.classList.add('active');
};
