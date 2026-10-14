// Screen orientation is presentation only. No data, request or authentication
// state belongs here; turning the device must retain the live report DOM.
export function bindReportLandscape(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  root.classList.add('report-landscape-viewport');
  let destroyed = false, previous = null;
  function update() {
    if (destroyed) return;
    let width = win.innerWidth || doc.documentElement.clientWidth;
    let height = win.innerHeight || doc.documentElement.clientHeight;
    // Android can resize the layout viewport for the keyboard. Keep the
    // landscape canvas while typing; an actual width change is a new layout.
    const keyboardResize = previous && width === previous.width && height < previous.height
      && root.contains(doc.activeElement) && doc.activeElement.matches('input,textarea');
    if (keyboardResize) height = previous.height;
    const portrait = keyboardResize ? previous.portrait
      : win.matchMedia ? win.matchMedia('(orientation: portrait)').matches : height > width;
    previous = {width,height,portrait};
    const logicalWidth=portrait?height:width,logicalHeight=portrait?width:height;
    root.dataset.reportPortrait = String(portrait);
    root.dataset.reportWidthMode = logicalWidth<=600?'narrow':logicalWidth<=900?'compact':'wide';
    root.dataset.reportCompactHeight = String(logicalHeight<=500);
    for (const limit of [650,680,850,900]) root.setAttribute(`data-report-max-${limit}`,String(logicalWidth<=limit));
    root.setAttribute('data-report-min-650',String(logicalWidth>=650));
    root.style.setProperty('--report-physical-width',`${width}px`);
    root.style.setProperty('--report-width',`${logicalWidth}px`);
    root.style.setProperty('--report-height',`${logicalHeight}px`);
    root.style.setProperty('--report-vw',`${logicalWidth/100}px`);
    root.style.setProperty('--report-navigation-size',logicalHeight<=500?'46px':'56px');
  }
  win.addEventListener('resize',update); win.addEventListener('orientationchange',update);
  update();
  return Object.freeze({update,destroy(){destroyed=true;win.removeEventListener('resize',update);win.removeEventListener('orientationchange',update);}});
}

export function reportLayoutViewport(element) {
  const root = element.closest('.report-landscape-viewport'), win = element.ownerDocument.defaultView;
  if (root?.dataset.reportPortrait === 'true') {
    // Fixed descendant pickers share this transformed containing block. Its
    // lateral backdrop padding and the dialog's internal notch/home-indicator
    // padding are mapped to logical edges. Keep expanded pickers in that area.
    const style=win.getComputedStyle(root);
    const panel=element.closest('[role="dialog"]')||root.querySelector('[role="dialog"]');
    const panelStyle=panel&&panel!==root?win.getComputedStyle(panel):null;
    const top=parseFloat(style.paddingTop)||0,bottom=parseFloat(style.paddingBottom)||0;
    const left=(parseFloat(style.paddingLeft)||0)+(parseFloat(panelStyle?.paddingLeft)||0);
    const right=(parseFloat(style.paddingRight)||0)+(parseFloat(panelStyle?.paddingRight)||0);
    return {rotated:true,top,left,
      width:Math.max(0,parseFloat(root.style.getPropertyValue('--report-width'))-left-right),
      height:Math.max(0,parseFloat(root.style.getPropertyValue('--report-height'))-top-bottom)};
  }
  const viewport=win.visualViewport;
  return {rotated:false,top:viewport?.offsetTop||0,left:viewport?.offsetLeft||0,width:viewport?.width||win.innerWidth,height:viewport?.height||win.innerHeight};
}

export function reportLayoutRect(element) {
  const rect = element.getBoundingClientRect();
  if (!reportLayoutViewport(element).rotated) return rect;
  // A screen-rotated width is the row height. PDF/table geometry must use the
  // original logical width (including when layout is mocked by a DOM test).
  return {...rect,width:element.offsetWidth||rect.height,height:element.offsetHeight||rect.width};
}
