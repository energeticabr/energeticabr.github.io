import {buildDepreciationOverview} from '../chat/depreciation-report-model.js';
import {provisionDateKey} from '../chat/pending-provision-dates.js';

const LOGO=new URL('../../../../assets/logo-energetica-oficial.png',import.meta.url).href;
const date=value=>`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`;
const money=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const integer=value=>value.toLocaleString('pt-BR',{maximumFractionDigits:0});
const percent=value=>`${value.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
const COLUMNS=[
 ['Nº PATRIM.',5.5],['DATA DEPREC.',8],['GRUPO',9],['IMOBILIZADO',16],['% DEPREC.',6.5],['VALOR UNIT.',9],
 ['QTD.',4.5],['VALOR TOTAL',9.5],['VALOR DEPRECIADO',10.5],['VALOR ATUAL',10.5],['A DEPRECIAR',11],
];

export function createDepreciationReportView({document:doc=globalThis.document,data,now=()=>new Date()}={}){
 if(!doc?.body||typeof data?.loadSnapshot!=='function'||typeof now!=='function')throw new TypeError('O relatório requer documento e sessão SharePoint.');
 const win=doc.defaultView,make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const root=make('div','dr-overlay');root.hidden=true;
 const panel=make('section','dr-dialog');panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Controle de depreciação do imobilizado');
 const warning=make('p','dr-orientation','PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');warning.setAttribute('role','status');
 const toolbar=make('div','dr-toolbar'),refresh=make('button','dr-refresh','⟳');refresh.type='button';refresh.setAttribute('aria-label','Atualizar depreciação do imobilizado');refresh.title='Atualizar dados';
 toolbar.append(refresh);
 const content=make('div','dr-content');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Indicadores e depreciação por filial');
 panel.append(warning,toolbar,content);root.append(panel);doc.body.append(root);
 let controller=null,revision=0,destroyed=false,returnFocus=null,oldOverflow='',app=null,oldInert=false;
 const portrait=()=>win?.matchMedia?win.matchMedia('(orientation: portrait)').matches:win?.innerHeight>win?.innerWidth;

 function render(snapshot){
  const result=buildDepreciationOverview(snapshot,provisionDateKey(now()));content.replaceChildren();
  const header=make('header','dr-header'),brand=make('div','dr-brand'),logo=make('img');logo.src=LOGO;logo.alt='Energética Construtora';brand.append(logo);
  header.append(brand,make('h2','','CONTROLE DE DEPRECIAÇÃO DO IMOBILIZADO'),make('p','dr-subtitle',`ITENS COM DEPRECIAÇÃO PREVISTA ATÉ ${date(result.limitDate)} | POSIÇÃO EM ${date(result.today)}`));content.append(header);
  if(!result.metrics.records){content.append(make('p','dr-empty',`NENHUM ITEM A DEPRECIAR ATÉ ${date(result.limitDate)}`));return;}
  const cards=make('div','dr-cards');
  for(const [key,label,currency] of [
   ['records','TOTAL DE REGISTROS',false],['active','REGISTROS ATIVOS',false],['branches','FILIAIS',false],
   ['total','VALOR TOTAL',true],['toDepreciate','VALOR A DEPRECIAR',true],['depreciated','VALOR DEPRECIADO',true],['current','VALOR ATUAL',true],
  ]){
   const card=make('div',`dr-card dr-metric-${key}`);card.dataset.metric=key;
   card.append(make('span','',label),make('strong','',currency?money(result.metrics[key]):integer(result.metrics[key])));cards.append(card);
  }
  content.append(cards);
  for(const branch of result.branches){
   const block=make('article','dr-branch'),bar=make('header','dr-branch-header');
   bar.append(make('h3','',`FILIAL: ${branch.branch}`),make('span','',`REGISTROS: ${branch.records}`),make('strong','',`VALOR TOTAL: ${money(branch.total)}`));block.append(bar);
   const table=make('table','dr-table'),cols=make('colgroup'),head=make('thead'),headRow=make('tr'),body=make('tbody');
   table.setAttribute('aria-label',`Depreciação da filial ${branch.branch}`);
   for(const [label,width] of COLUMNS){const col=make('col');col.style.width=`${width}%`;cols.append(col);const th=make('th','',label);th.scope='col';headRow.append(th);}
   head.append(headRow);table.append(cols,head,body);
   for(const row of branch.assets){
    const tr=make('tr');tr.dataset.assetId=String(row.id);
    for(const [value,cls] of [
     [row.patrimony||'-','dr-patrimony'],[date(row.depreciationDate),`dr-date-${row.dateTone}`],[row.group||'-',''],[row.asset||'-','dr-name'],
     [percent(row.rate),'dr-rate'],[money(row.estimatedUnit),'dr-unit'],[integer(row.quantity),''],
     [money(row.total),'dr-total'],[money(row.depreciated),'dr-depreciated'],[money(row.current),'dr-current'],[money(row.toDepreciate),'dr-next'],
    ])tr.append(make('td',cls,value));
    body.append(tr);
   }
   const foot=make('tfoot'),totalRow=make('tr'),label=make('td','',`TOTAL DA FILIAL ${branch.branch}`);label.colSpan=6;totalRow.append(label);
   for(const value of [integer(branch.quantity),money(branch.total),money(branch.depreciated),money(branch.current),money(branch.toDepreciate)])totalRow.append(make('td','',value));
   foot.append(totalRow);table.append(foot);block.append(table);content.append(block);
  }
 }

 async function load(){
  if(root.hidden||portrait()||destroyed)return;
  if(content.contains(doc.activeElement))panel.focus();
  controller?.abort();const current=++revision,active=new AbortController();controller=active;refresh.disabled=true;
  content.replaceChildren(make('p','dr-notice','Carregando depreciação do SharePoint…'));content.setAttribute('aria-busy','true');
  try{
   const snapshot=await data.loadSnapshot({signal:active.signal});
   if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
   render(snapshot);
  }catch(error){
   if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
   const message=make('p','dr-notice','Não foi possível carregar a depreciação do imobilizado.');message.setAttribute('role','status');
   const retry=make('button','dr-retry','Tentar novamente');retry.type='button';retry.addEventListener('click',()=>void load());content.replaceChildren(message,retry);
  }finally{
   if(current===revision){content.setAttribute('aria-busy','false');refresh.disabled=false;}
  }
 }
 refresh.addEventListener('click',()=>void load());
 function orientationChanged(){
  if(root.hidden)return;
  const vertical=portrait();warning.hidden=!vertical;toolbar.hidden=vertical;panel.classList.toggle('dr-portrait',vertical);
  if(vertical){if(panel.contains(doc.activeElement))panel.focus();controller?.abort();revision++;content.replaceChildren();content.hidden=true;content.setAttribute('aria-busy','false');refresh.disabled=false;}
  else if(content.hidden){content.hidden=false;void load();}
 }
 function close(){
  if(root.hidden)return;controller?.abort();revision++;content.replaceChildren();root.hidden=true;doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;
 }
 root.addEventListener('click',event=>{if(event.target===root)close();});
 root.addEventListener('keydown',event=>{
  if(root.hidden)return;
  if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key!=='Tab')return;
  const nodes=[...panel.querySelectorAll('button,[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden]')),first=nodes[0],last=nodes.at(-1);
  if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===panel)){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===panel)){event.preventDefault();first?.focus();}
 });
 win?.addEventListener('resize',orientationChanged);win?.addEventListener('orientationchange',orientationChanged);
 return Object.freeze({
  element:root,
  async open(){
   if(destroyed)throw new Error('O relatório foi encerrado.');if(!root.hidden)return;
   returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;doc.body.style.overflow='hidden';if(app)app.inert=true;
   root.hidden=false;const vertical=portrait();warning.hidden=!vertical;content.hidden=toolbar.hidden=vertical;panel.classList.toggle('dr-portrait',vertical);panel.focus();content.scrollTop=0;if(!vertical)await load();
  },
  close,
  destroy(){if(destroyed)return;close();destroyed=true;win?.removeEventListener('resize',orientationChanged);win?.removeEventListener('orientationchange',orientationChanged);root.remove();},
 });
}
