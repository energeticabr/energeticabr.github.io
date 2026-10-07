// Visual mascot families in HOME order. Illustrated/gray mascots remain
// singletons; families are never inferred from inherited button CSS.
const GROUPS = [
 ['open-pending-provisions','open-provision-report','open-payment-ledger','open-management-report','open-order-validation-report','open-document-control-report'],
 ['open-cargos-table','open-attendance-summary','open-stage-progress','open-supplier-payroll-report'],
 ['open-commercial-receipts','open-commercial-milestones','open-commercial-documents','open-sac-pathologies'],
 ['open-task-association-report','open-delegated-deadline-report'],
];

export function getReportNeighbors(action) {
 const group=GROUPS.find(items=>items.includes(action)),index=group?.indexOf(action);
 return {previous:group?.[index-1]??null,next:group?.[index+1]??null};
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
