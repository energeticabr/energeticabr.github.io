import { payrollFieldKey as key } from './payroll-editor-policy.js';
import { PAYROLL_RUBRICS, validPayrollDate } from './supplier-payroll.js';

const scalar = value => String(value && typeof value === 'object' ? value.LookupValue ?? value.Value ?? value.value ?? '' : value ?? '').trim();
const id = value => { const result = String(value ?? ''); if (!/^[1-9]\d{0,14}$/.test(result) || !Number.isSafeInteger(Number(result))) throw new Error('Selecione um ID cadastrado.'); return result; };
const month = value => {
  const raw = scalar(value), br = raw.match(/^(\d{1,2})\/(\d{4})$/), iso = raw.match(/^(\d{4})-(\d{2})(?:$|[-T])/);
  const year = br?.[2] || iso?.[1], number = Number(br?.[1] || iso?.[2]);
  return year && number >= 1 && number <= 12 ? `${year}-${String(number).padStart(2,'0')}` : '';
};
function monthWindow(now) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(now);
  const year = Number(parts.find(p=>p.type==='year').value), number = Number(parts.find(p=>p.type==='month').value);
  return [-1,0,1].map(offset=>new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7));
}

/** Link an existing launch to payroll; this never creates or edits a launch. */
export function createPayrollPaymentData({repository,siteKey='personal',now=()=>new Date(),assertSession=()=>{}}={}) {
  const descriptors = new Map(), operations = new Map();
  let saving = false;
  async function describe(name) {
    assertSession();
    if (!descriptors.has(name)) {
      const list = await repository.resolveList(siteKey,[name]);
      if(list?.status!=='resolved'||!list.id) throw new Error(`A lista ${name} não está disponível.`);
      const columns = await repository.getColumns(siteKey,list.id);
      assertSession();descriptors.set(name,{...list,columns});
    }
    return descriptors.get(name);
  }
  function column(descriptor,aliases,required=true) {
    const found = descriptor.columns.find(c=>[c.name,c.displayName].some(name=>aliases.some(alias=>key(name)===key(alias))));
    if(!found&&required) throw new Error(`O campo ${aliases[0]} não foi identificado.`);
    return found;
  }
  function value(descriptor,row,aliases,required=true) { const c=column(descriptor,aliases,required);return c ? scalar(row.fields?.[c.name]) : ''; }
  async function all(descriptor,{signal,filter=''}={}) {
    const rows=[], seen=new Set();let cursor;
    for(let pageNumber=1;pageNumber<=100;pageNumber++) {
      assertSession();if(signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.','AbortError');
      const page=await repository.getItemsPage(siteKey,descriptor.id,`$expand=fields&$top=100${filter?`&$filter=${filter}`:''}`,{pageNumber,maxPages:100,headers:{Prefer:'HonorNonIndexedQueriesWarningMayFailRandomly'},...(cursor?{cursor}:{}),...(signal?{signal}:{})});
      assertSession();rows.push(...(page.items||[]));
      if(!page.hasMore) return rows;
      if(!page.nextLink||seen.has(page.nextLink)) throw new Error('A consulta dos pagamentos não pôde ser concluída.');
      cursor=page.nextLink;seen.add(cursor);
    }
    throw new Error('A consulta excedeu o limite de páginas; refine a base de lançamentos.');
  }
  function activeSupplier(descriptor,row) { return key(value(descriptor,row,['STATUS']))==='ATIVO' && key(value(descriptor,row,['EMPREITEIRO']))==='SIM'; }
  function supplierName(descriptor,row) { return value(descriptor,row,['CADASTRO','FORNECEDOR']); }
  function types(descriptor) { return column(descriptor,['TIPOPGTO']).choice?.choices?.length ? [...column(descriptor,['TIPOPGTO']).choice.choices] : PAYROLL_RUBRICS.map(r=>r.payrollType); }
  function launchRow(descriptor,row,supplier) {
    return {id:id(row.id),supplier:supplier.label,supplierId:supplier.id,
      date:value(descriptor,row,['DATA']).slice(0,10),
      unitValue:value(descriptor,row,['VALOR UNITÁRIO','VALORUNITARIO']),quantity:value(descriptor,row,['QUANTIDADE','QTD']),
      description:value(descriptor,row,['DESCRICAOPGTO','PRODUTO'],false)};
  }
  async function loadOptions({signal}={}) {
    const [suppliers,launches,sheets,payroll]=await Promise.all(['FORNECEDORES','LANCAMENTOS','IDFOLHA','FOLHAPGTO'].map(describe));
    const [supplierRows,launchRows,sheetRows]=await Promise.all([suppliers,launches,sheets].map(d=>all(d,{signal})));
    const eligible=supplierRows.filter(row=>activeSupplier(suppliers,row)).map(row=>({id:id(row.id),label:supplierName(suppliers,row)}));
    const window=monthWindow(now());
    return {
      launches:launchRows.flatMap(row=>{const name=value(launches,row,['FORNECEDOR']),matches=eligible.filter(s=>key(s.label)===key(name));return matches.length===1?[launchRow(launches,row,matches[0])]:[];}).sort((a,b)=>Number(b.id)-Number(a.id)),
      sheets:sheetRows.flatMap(row=>{const reference=value(sheets,row,['MESREFERENCIA','MES REFERENCIA']),supplier=value(sheets,row,['FORNECEDOR']);return window.includes(month(reference))?[{id:id(row.id),supplier,label:reference}]:[];}).sort((a,b)=>month(a.label).localeCompare(month(b.label))||Number(a.id)-Number(b.id)),
      paymentTypes:types(payroll),
    };
  }
  async function get(descriptor,rawId) {
    const item=await repository.getItem(siteKey,descriptor.id,id(rawId),'$expand=fields');assertSession();
    if(String(item?.id)!==String(rawId)) throw new Error('O registro selecionado não foi confirmado.');return item;
  }
  async function save(draft,{operationId}={}) {
    if(saving) throw new Error('O pagamento já está sendo cadastrado.');
    if(!/^[a-zA-Z0-9-]{1,80}$/.test(String(operationId||''))) throw new Error('A operação não foi identificada.');
    const selection={launchId:id(draft?.launchId),sheetId:id(draft?.sheetId),paymentType:scalar(draft?.paymentType)};
    const fingerprint=JSON.stringify(selection),previous=operations.get(operationId);
    if(previous&&previous.fingerprint!==fingerprint) throw new Error('A operação não pode ser alterada depois de iniciar o cadastro.');
    saving=true;
    try {
      const [launches,suppliers,sheets,payroll]=await Promise.all(['LANCAMENTOS','FORNECEDORES','IDFOLHA','FOLHAPGTO'].map(describe));
      const token=`APP-folha-vinculo-${operationId}`,title=column(payroll,['Title']).name;
      let found;
      try { found=await all(payroll,{filter:`fields/${title} eq '${token}'`}); }
      catch(error) { if(error.status!==400) throw error;found=await all(payroll); }
      found=found.filter(row=>scalar(row.fields?.[title])===token);
      if(found.length>1) throw new Error('Mais de um pagamento foi encontrado para essa operação.');
      const verify=async (item,expected) => {
        const verified=await get(payroll,id(item?.id));
        for(const [name,value] of Object.entries(expected)) {
          const actual=verified.fields?.[name];
          const equal=typeof value==='number'?actual!=null&&Number(actual)===value:scalar(actual)===String(value)||column(payroll,[name]).dateTime&&scalar(actual).slice(0,10)===String(value).slice(0,10);
          if(!equal)throw new Error('O SharePoint não confirmou os dados do pagamento. Tente novamente.');
        }
        return verified;
      };
      if(found[0]) {
        const expected=previous?.fields || Object.fromEntries(Object.entries({Title:token,TIPOPGTO:selection.paymentType,IDFOLHA:Number(selection.sheetId),IDLANCAMENTO:Number(selection.launchId)}).map(([label,value])=>[column(payroll,[label]).name,value]));
        return verify(found[0],expected);
      }
      const launch=await get(launches,selection.launchId),name=value(launches,launch,['FORNECEDOR']);
      const matches=(await all(suppliers)).filter(row=>key(supplierName(suppliers,row))===key(name));
      if(matches.length!==1||!activeSupplier(suppliers,matches[0])) throw new Error('O fornecedor deve ser empreiteiro SIM e estar ATIVO.');
      const supplier=supplierName(suppliers,matches[0]),sheet=await get(sheets,selection.sheetId);
      if(key(value(sheets,sheet,['FORNECEDOR']))!==key(supplier)||!monthWindow(now()).includes(month(value(sheets,sheet,['MESREFERENCIA','MES REFERENCIA'])))) throw new Error('Selecione uma folha desse fornecedor do mês anterior, atual ou próximo.');
      if(!types(payroll).includes(selection.paymentType)) throw new Error('Selecione um tipo de pagamento cadastrado.');
      const currentLaunch=await get(launches,selection.launchId);
      if(key(value(launches,currentLaunch,['FORNECEDOR']))!==key(name)) throw new Error('O fornecedor do lançamento foi alterado; revise a seleção.');
      const date=value(launches,currentLaunch,['DATA']).slice(0,10);
      if(!validPayrollDate(date)) throw new Error('O lançamento não possui uma data válida.');
      const number=aliases=>{const raw=value(launches,currentLaunch,aliases),normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;if(!raw||!Number.isFinite(Number(normalized)))throw new Error('O lançamento contém valores inválidos.');return Number(normalized);};
      const fields={};
      for(const [label,raw] of Object.entries({Title:token,FORNECEDOR:supplier,TIPOPGTO:selection.paymentType,VALORUNITARIO:number(['VALOR UNITÁRIO','VALORUNITARIO']),QTD:number(['QUANTIDADE','QTD']),DATA:date,IDFOLHA:Number(selection.sheetId),IDLANCAMENTO:Number(selection.launchId)})) {
        const c=column(payroll,[label]);
        if(c.readOnly||c.calculated||c.lookup||c.personOrGroup) throw new Error(`O campo ${label} não permite esse cadastro.`);
        fields[c.name]=c.dateTime&&label==='DATA'?`${raw}T12:00:00Z`:raw;
      }
      operations.set(operationId,{fingerprint,fields});
      assertSession();const saved=await repository.createItem(siteKey,payroll.id,fields);assertSession();
      return verify(saved,fields);
    } finally {saving=false;}
  }
  return Object.freeze({loadOptions,save});
}
