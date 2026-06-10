// Debug script - paste in browser console
(function debugOverflow() {
  const vw = document.documentElement.clientWidth;
  const results = [];
  
  document.querySelectorAll('*').forEach(el => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    // Check 1: element extends beyond right edge
    if (rect.right > vw + 1) {
      results.push({
        element: el.tagName + (el.id ? '#'+el.id : '') + (el.className ? '.'+[...el.classList].join('.') : ''),
        issue: 'extends beyond right: ' + Math.round(rect.right) + 'px (viewport: ' + vw + 'px)',
        overflow: Math.round(rect.right - vw) + 'px',
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        computedWidth: style.width,
        computedMinWidth: style.minWidth,
        computedMaxWidth: style.maxWidth,
        computedPosition: style.position,
        parent: el.parentElement?.tagName + '.' + [...(el.parentElement?.classList||[])].join('.')
      });
    }
    
    // Check 2: element has scrollWidth > clientWidth
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      results.push({
        element: el.tagName + (el.id ? '#'+el.id : '') + (el.className ? '.'+[...el.classList].join('.') : ''),
        issue: 'scrollWidth > clientWidth',
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        diff: el.scrollWidth - el.clientWidth + 'px extra',
        computedOverflow: style.overflow,
        computedOverflowX: style.overflowX
      });
    }
  });
  
  // Sort by overflow amount
  results.sort((a,b) => (parseInt(b.overflow)||0) - (parseInt(a.overflow)||0));
  
  console.log('=== OVERFLOW DEBUG REPORT ===');
  console.log('Viewport width:', vw);
  console.log('Document scrollWidth:', document.documentElement.scrollWidth);
  console.log('Overflow:', document.documentElement.scrollWidth - vw, 'px');
  console.log('\nOffending elements:');
  results.slice(0, 20).forEach((r,i) => {
    console.group(i+1 + '. ' + r.element);
    Object.entries(r).forEach(([k,v]) => k !== 'element' && console.log(k+':', v));
    console.groupEnd();
  });
  
  return results;
})();
