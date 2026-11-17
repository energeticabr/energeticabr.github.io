import { reportOrientation } from '../native/report-orientation.js';

// Screen orientation is presentation only. No data, request or authentication
// state belongs here; turning the device must retain the live report DOM.
export function bindReportLandscape(root, { orientation = reportOrientation } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView;
  root.classList.add('report-landscape-viewport');
  const nativeOrientation = orientation.bind(root);
  let destroyed = false, previous = null;
  function update() {
    if (destroyed) return;
    nativeOrientation.update();
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
  return Object.freeze({update,destroy(){destroyed=true;win.removeEventListener('resize',update);win.removeEventListener('orientationchange',update);return nativeOrientation.destroy();}});
}

function insetReportViewport(viewport, width, height, ...styles) {
  const inset = side => styles.reduce((sum, style) => sum + (parseFloat(style?.[`padding${side}`]) || 0), 0);
  const top = Math.max(viewport.top, inset('Top'));
  const left = Math.max(viewport.left, inset('Left'));
  const right = Math.min(viewport.left + viewport.width, width - inset('Right'));
  const bottom = Math.min(viewport.top + viewport.height, height - inset('Bottom'));
  return { rotated:viewport.rotated, top, left, width:Math.max(0, right - left), height:Math.max(0, bottom - top) };
}

export function reportLayoutViewport(element, frame) {
  const root = element.closest('.report-landscape-viewport'), win = element.ownerDocument.defaultView;
  const viewport = win.visualViewport;
  if (root?.dataset.reportPortrait === 'true') {
    const width = parseFloat(root.style.getPropertyValue('--report-width'));
    const height = parseFloat(root.style.getPropertyValue('--report-height'));
    // Convert the visible area to the rotated report's coordinates before
    // clipping it to the report's safe area.
    const visibleWidth = viewport?.width || height;
    const visible = {
      rotated:true,
      top:height - (viewport?.offsetLeft || 0) - visibleWidth,
      left:viewport?.offsetTop || 0,
      width:viewport?.height || width,
      height:visibleWidth,
    };
    if (frame) return insetReportViewport(visible, width, height, win.getComputedStyle(frame));
    const panel = element.closest('[role="dialog"]') || root.querySelector('[role="dialog"]');
    const panelStyle = panel && panel !== root ? win.getComputedStyle(panel) : null;
    return insetReportViewport(visible, width, height, win.getComputedStyle(root), panelStyle);
  }
  const visible = {rotated:false,top:viewport?.offsetTop||0,left:viewport?.offsetLeft||0,width:viewport?.width||win.innerWidth,height:viewport?.height||win.innerHeight};
  return frame ? insetReportViewport(visible, win.innerWidth, win.innerHeight, win.getComputedStyle(frame)) : visible;
}

export function reportLayoutRect(element) {
  const rect = element.getBoundingClientRect();
  if (!reportLayoutViewport(element).rotated) return rect;
  // A screen-rotated width is the row height. PDF/table geometry must use the
  // original logical width (including when layout is mocked by a DOM test).
  return {...rect,width:element.offsetWidth||rect.height,height:element.offsetHeight||rect.width};
}
