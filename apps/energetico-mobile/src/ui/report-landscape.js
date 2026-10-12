// Screen orientation is presentation only. No data, request or authentication
// state belongs here; turning the device must retain the live report DOM.
const STYLE_ID = 'report-landscape-style';
const CSS = `
.report-landscape-viewport[data-report-portrait="true"] {
 position:fixed!important; inset:auto!important; top:0!important;
 left:var(--report-physical-width)!important;
 width:var(--report-width)!important; height:var(--report-height)!important;
 max-width:none!important; max-height:none!important;
 transform:rotate(90deg); transform-origin:0 0;
 box-sizing:border-box;
 padding:max(3px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(3px,env(safe-area-inset-left)) max(8px,env(safe-area-inset-top))!important;
}
.report-landscape-viewport[data-report-portrait="true"] [role="dialog"] {
 width:100%!important; height:100%!important; max-height:100%!important;
 padding:3px!important; border-radius:0!important;
}
`;

export function bindReportLandscape(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style'); style.id = STYLE_ID; style.textContent = CSS; doc.head.append(style);
  }
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
    root.dataset.reportPortrait = String(portrait);
    root.style.setProperty('--report-physical-width',`${width}px`);
    root.style.setProperty('--report-width',`${portrait ? height : width}px`);
    root.style.setProperty('--report-height',`${portrait ? width : height}px`);
    root.style.setProperty('--report-vw',`${(portrait ? height : width)/100}px`);
  }
  win.addEventListener('resize',update); win.addEventListener('orientationchange',update);
  update();
  return Object.freeze({update,destroy(){destroyed=true;win.removeEventListener('resize',update);win.removeEventListener('orientationchange',update);}});
}

export function reportLayoutViewport(element) {
  const root = element.closest('.report-landscape-viewport'), win = element.ownerDocument.defaultView;
  if (root?.dataset.reportPortrait === 'true') {
    // Fixed descendant pickers share this transformed containing block. Its
    // safe padding is already mapped to logical edges; do not use the physical
    // viewport's env() insets a second time when positioning their controls.
    const style=win.getComputedStyle(root);
    const top=parseFloat(style.paddingTop)||0,bottom=parseFloat(style.paddingBottom)||0;
    const left=parseFloat(style.paddingLeft)||0,right=parseFloat(style.paddingRight)||0;
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
