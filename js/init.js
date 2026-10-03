/* init.js - First paint once every script has loaded. */
// icon-only buttons get an accessible name from their tooltip text
document.querySelectorAll('[data-tip]').forEach(el=>{ if(!el.getAttribute('aria-label')&&!el.textContent.trim()) el.setAttribute('aria-label',el.dataset.tip); });
// on a narrow window start with both side panels closed (they float over the canvas when opened)
if(isNarrow()){ hideLeft(); closeProps(); }
renderTabBar(); syncZoomUI(); syncSwatch(); updatePageIndicator();
// warm up the background worker while the page is idle, so the first Save / page operation doesn't wait for it to start
setTimeout(startWorker,400);
