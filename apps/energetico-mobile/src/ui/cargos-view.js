export function createCargosView({document:doc=globalThis.document,data}={}) {
  if(!doc?.body||typeof data?.loadSnapshot!=='function')throw new TypeError('A tabela de cargos requer documento e sessão SharePoint.');
  const make=(tag,cls='',text)=>{const node=doc.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const root=make('section','cargos-screen');root.hidden=true;root.tabIndex=-1;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Tabela de cargos');
  const header=make('header','cargos-header'),back=make('button','','←'),title=make('h1','','TABELA DE CARGOS'),refresh=make('button','','⟳');
  back.type=refresh.type='button';back.setAttribute('aria-label','Voltar ao menu inicial');refresh.setAttribute('aria-label','Atualizar tabela de cargos');header.append(back,title,refresh);
  const status=make('p','cargos-status');status.setAttribute('role','status');
  const hint=make('p','cargos-hint','Deslize para ver todas as colunas.');
  const content=make('div','cargos-scroll');content.tabIndex=0;content.setAttribute('role','region');content.setAttribute('aria-label','Valores por cargo');root.append(header,status,hint,content);doc.body.append(root);
  let destroyed=false,controller=null,revision=0,returnFocus=null,oldOverflow='',app=null,oldInert=false;
  const money=value=>Number.isFinite(value)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value):'—';
  function render(rows){
    const table=make('table','cargos-table'),thead=make('thead'),head=make('tr'),body=make('tbody');
    for(const label of ['CARGO','SALÁRIO','VALE ALIMENTAÇÃO','PRÊMIO','VALE TRANSPORTE','TOTAL']){const th=make('th','',label);th.scope='col';head.append(th);}thead.append(head);table.append(thead,body);
    let previous='';
    for(const row of rows){
      if(row.group&&row.group!==previous){const group=make('tr','cargos-group'),cell=make('th','',row.group);cell.colSpan=6;cell.scope='rowgroup';group.append(cell);body.append(group);}
      previous=row.group;const tr=make('tr');tr.dataset.cargo=row.cargo;
      const th=make('th',row.group?'cargos-level':'',row.cargo);th.scope='row';tr.append(th);
      for(const name of ['salary','food','bonus','transport','total']){const td=make('td','',money(row[name]));td.dataset.column=name;tr.append(td);}body.append(tr);
    }
    content.replaceChildren(table);status.textContent=rows.some(row=>row.total===null)?'Valores ausentes ou conflitantes na base aparecem como —.':'';
  }
  async function load(){
    if(root.hidden||destroyed)return;controller?.abort();const active=new AbortController();controller=active;const current=++revision;
    content.replaceChildren();status.textContent='Carregando cargos do SharePoint…';root.setAttribute('aria-busy','true');refresh.disabled=true;
    try{const result=await data.loadSnapshot({signal:active.signal});if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;
      if(!Array.isArray(result?.rows))throw new Error('Resposta incompleta.');render(result.rows);
    }catch(error){if(active.signal.aborted||current!==revision||root.hidden||destroyed)return;content.replaceChildren();status.textContent='Não foi possível consultar CARGOS. Toque em Atualizar para tentar novamente.';}
    finally{if(current===revision){root.setAttribute('aria-busy','false');refresh.disabled=false;}}
  }
  function close(){if(root.hidden)return;controller?.abort();revision++;root.hidden=true;root.setAttribute('aria-busy','false');refresh.disabled=false;content.replaceChildren();status.textContent='';doc.body.style.overflow=oldOverflow;if(app)app.inert=oldInert;returnFocus?.focus?.();returnFocus=null;}
  back.addEventListener('click',close);refresh.addEventListener('click',()=>{void load();});
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){const nodes=[back,refresh,content].filter(node=>!node.disabled),first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===root)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===root)){event.preventDefault();first.focus();}
    }
  });
  return Object.freeze({element:root,async open(){if(destroyed)throw new Error('A tabela foi encerrada.');if(!root.hidden)return;
    returnFocus=doc.activeElement;oldOverflow=doc.body.style.overflow;app=doc.getElementById('app');oldInert=app?.inert||false;if(app)app.inert=true;doc.body.style.overflow='hidden';root.hidden=false;root.focus();await load();
  },close,destroy(){if(destroyed)return;close();destroyed=true;root.remove();}});
}
