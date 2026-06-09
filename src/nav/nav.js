/**
 * nav.js — Navigation Module
 */
import { State } from '../core/state.js';

const _loaders = {};
export const register = (pageId, fn) => { _loaders[pageId] = fn; };

export const go = (pageId, activeElement = null) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));

  const content  = document.getElementById('main-content');
  const qsPage   = document.getElementById('page-quicksale');
  const qsFooter = document.getElementById('qs-footer');

  if (pageId === 'quicksale') {
    // Make content flex so quicksale fills it
    if (content) {
      content.style.cssText = 'overflow:hidden !important;padding:0 !important;display:flex !important;flex-direction:column !important;';
    }
    // Show quicksale as flex
    if (qsPage) {
      qsPage.classList.add('active');
      qsPage.style.cssText = 'display:flex !important;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    }
    // Show footer
    if (qsFooter) qsFooter.style.display = 'block';
  } else {
    // Restore content
    if (content) content.removeAttribute('style');
    // Hide quicksale (class removed by loop above)
    if (qsPage) qsPage.removeAttribute('style');
    // Hide footer
    if (qsFooter) qsFooter.style.display = 'none';
    document.getElementById('page-' + pageId)?.classList.add('active');
  }

  if (activeElement) activeElement.classList.add('active');
  State.currentPage = pageId;
  _loaders[pageId]?.();
};

export const goTo = (pageId) => {
  go(pageId);
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('bn-' + pageId)?.classList.add('active');
};
