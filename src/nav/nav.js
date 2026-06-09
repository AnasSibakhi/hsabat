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
  const appBody  = document.querySelector('.app-body');

  if (pageId === 'quicksale') {
    // POS mode: content = flex column, no padding/scroll
    if (content) {
      content.style.cssText = 'overflow:hidden;padding:0;display:flex;flex-direction:column;flex:1;min-height:0;';
    }
    if (qsPage) {
      qsPage.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    }
    if (qsFooter) qsFooter.style.display = 'flex';
  } else {
    // Normal mode
    if (content) content.style.cssText = '';
    if (qsPage)  qsPage.style.cssText  = 'display:none;';
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
