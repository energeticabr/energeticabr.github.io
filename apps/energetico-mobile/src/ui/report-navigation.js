import { bindReportLandscape } from './report-landscape.js';

// Visual mascot families in HOME order. Illustrated/gray mascots remain
// singletons; families are never inferred from inherited button CSS.
const GROUPS = [
 ['open-pending-provisions','open-sicoob-transaction-report','open-nfe-report','open-dda-report','open-provision-report','open-payment-ledger','open-management-report','open-order-validation-report','open-document-control-report'],
 ['open-cargos-table','open-attendance-summary','open-stage-progress','open-supplier-payroll-report','open-trancid-report','open-contractor-control-report','open-pending-supplier-payments-report'],
 ['open-commercial-receipts','open-commercial-milestones','open-commercial-documents','open-sac-pathologies'],
];

export function getReportNeighbors(action) {
 const group=GROUPS.find(items=>items.includes(action)),index=group?.indexOf(action);
 return {previous:group?.[index-1]??null,next:group?.[index+1]??null};
}

// Keep only the outgoing presentation alive. Its real view still closes and
// aborts requests, so a slow neighbor cannot leave a stale report interactive.
export function retainReportPresentation(root, { onCancel } = {}) {
 if (!root?.isConnected) return () => {};
 root=root.closest('.report-landscape-viewport')||root;
 const doc=root.ownerDocument, layer=doc.createElement('div'), copy=root.cloneNode(true);
 layer.dataset.reportTransition='';
 layer.className='report-transition';
 copy.setAttribute('aria-hidden','true');copy.setAttribute('inert','');copy.inert=true;
 copy.removeAttribute('data-report-action');
 for (const node of [copy,...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
 layer.append(copy);
 // cloneNode does not copy current form values or scrolled table positions.
 const sources=[root,...root.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
 doc.body.append(layer);
 // The copy owns presentation only; native orientation stays with the real
 // reports and the controller's existing transition lease.
 const layout=root.classList.contains('report-landscape-viewport')
  ?bindReportLandscape(copy,{orientation:{bind:()=>({update(){},destroy(){}})}}):null;
 sources.forEach((source,index)=>{
  const target=copies[index];
  target.scrollTop=source.scrollTop;target.scrollLeft=source.scrollLeft;
  if (source.matches('input:not([type="file"]),textarea,select')) target.value=source.value;
  if ('checked' in source) target.checked=source.checked;
 });
 // A real close target remains usable by touch and keyboard while the copy is
 // inert; all other clicks are blocked rather than reaching the loading view.
 const close=copy.querySelector('.report-close-control,button[aria-label^="Fechar"]');
 let positionCancel=()=>{};
 if(close){
  const cancel=doc.createElement('button');
  cancel.type='button';cancel.className='report-transition-cancel';cancel.tabIndex=-1;
  cancel.setAttribute('aria-label','Cancelar troca de relatório');
  positionCancel=()=>{const rect=close.getBoundingClientRect();Object.assign(cancel.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});};
  positionCancel();
  cancel.addEventListener('click',()=>onCancel?.());layer.append(cancel);
 }
 // Do not move focus into this temporary layer: the destination must capture
 // its normal return focus, not a button that disappears when loading finishes.
 const keydown=event=>{event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape')onCancel?.();};
 doc.addEventListener('keydown',keydown,true);
 doc.defaultView.addEventListener('resize',positionCancel);
 doc.defaultView.addEventListener('orientationchange',positionCancel);
 return ()=>{doc.removeEventListener('keydown',keydown,true);doc.defaultView.removeEventListener('resize',positionCancel);doc.defaultView.removeEventListener('orientationchange',positionCancel);layout?.destroy();layer.remove();};
}

function arrowMarkup(direction) {
 // One centered chevron: next is an exact reflection around the circle center.
 const reflection=direction==='next'?' transform="translate(52 0) scale(-1 1)"':'';
 return `<svg viewBox="0 0 52 52" aria-hidden="true" focusable="false"><path d="M34 10 L18 26 L34 42"${reflection} fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
}

export function reportNavigationMarkup(action) {
 const neighbors=getReportNeighbors(action);
 return `<nav class="report-navigation" aria-label="Navegação entre relatórios">${['previous','next'].filter(direction=>neighbors[direction]).map(direction=>`<button type="button" class="report-navigation-arrow report-navigation-arrow--${direction}" data-action="navigate-mascot-report" data-from="${action}" data-report-direction="${direction}" data-direction="${direction}" aria-label="${direction==='previous'?'Recuar para o relatório anterior':'Avançar para o próximo relatório'}">${arrowMarkup(direction)}</button>`).join('')}</nav>`;
}

export function decorateReportNavigation(panel,{action,onNavigate}) {
 const root=panel?.element;
 if(!root?.ownerDocument)return panel;
 root.dataset.reportAction=action;
 const neighbors=getReportNeighbors(action);
 if(!neighbors.previous&&!neighbors.next)return panel;
 const holder=root.ownerDocument.createElement('div');holder.innerHTML=reportNavigationMarkup(action);
 const nav=holder.firstElementChild;
 // Inside the dialog for focus trapping and popup isolation, outside content
 // so scrolling or re-rendering rows cannot remove the controls.
 (root.matches('[role=dialog]')?root:root.querySelector('[role=dialog]')||root).append(nav);
 let busy=false,destroyed=false;
 async function navigate(event) {
  const arrow=event.target.closest('[data-report-direction]');
  if(!arrow||busy||destroyed||root.hidden||!root.isConnected)return;
  event.preventDefault();event.stopPropagation();busy=true;
  const buttons=[...nav.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
  try{await onNavigate?.(neighbors[arrow.dataset.reportDirection]);}
  finally{busy=false;if(!destroyed)buttons.forEach(button=>button.disabled=false);}
 }
 nav.addEventListener('click',navigate);
 return Object.freeze({...panel,destroy(){if(destroyed)return;destroyed=true;nav.removeEventListener('click',navigate);nav.remove();panel.destroy?.();}});
}
