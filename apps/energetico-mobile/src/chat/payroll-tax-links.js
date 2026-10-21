import { payrollKey } from './supplier-payroll.js';

const inFlight = new Set();
const text = value => String(value ?? '').trim();
function taxStorage(storage) {
  try {
    const available=storage??globalThis.localStorage;
    if(!available?.getItem||!available?.setItem||!available?.removeItem)throw new Error();
    return available;
  } catch {throw new Error('O armazenamento seguro da retomada está indisponível. Nenhum novo vínculo de encargo será enviado.');}
}
export function assertPayrollTaxStorage(storage) {
  const journal=taxStorage(storage),probe=`energetico:payroll-tax-probe:${globalThis.crypto.randomUUID()}`;
  try {journal.setItem(probe,'ready');if(journal.getItem(probe)!=='ready')throw new Error('Não foi possível confirmar o armazenamento da retomada.');}
  finally {journal.removeItem(probe);}
}

/** Same-source reconciliation shared by both payroll entry points. */
export async function ensurePayrollTaxLink({descriptor,fields,allRows,readItem,createItem,
  assertContext,assertSession=()=>{},storage,siteKey='personal',matchFinancials=false,onAttempt=()=>{}}) {
  const column = label => {
    const found=descriptor.columns.find(c=>[c.name,c.displayName].some(name=>payrollKey(name)===payrollKey(label)));
    if(!found)throw new Error(`O campo ${label} não foi identificado.`);
    return found.name;
  };
  const launch=column('IDLANCAMENTO'),type=column('TIPOPGTO');
  const key=`energetico:payroll-tax-attempt:${siteKey}:${descriptor.id}:${fields[launch]}:${payrollKey(fields[type])}`;
  const store=()=>taxStorage(storage);
  async function verify(item,existing) {
    const saved=await readItem(String(item?.id||''));assertSession();
    const labels=existing&&!matchFinancials?['FORNECEDOR','TIPOPGTO','IDFOLHA','IDLANCAMENTO']:Object.keys(fields).filter(name=>name!==column('Title'));
    for(const label of labels) {
      const name=Object.hasOwn(fields,label)?label:column(label),actual=saved?.fields?.[name],expected=fields[name];
      const c=descriptor.columns.find(c=>c.name===name);
      const equal=c?.dateTime?text(actual).slice(0,10)===text(expected).slice(0,10):typeof expected==='number'?actual!=null&&Number(actual)===expected:text(actual)===text(expected);
      if(!equal)throw new Error('O SharePoint não confirmou os dados do vínculo INSS/FGTS. Confira a origem e a competência.');
    }
    return saved;
  }
  async function run() {
    if(inFlight.has(key))throw new Error('O vínculo desse encargo já está em andamento. Aguarde a confirmação.');
    inFlight.add(key);
    try {
      assertSession();await assertContext();
      const matches=(await allRows()).filter(row=>text(row.fields?.[launch])===text(fields[launch])&&payrollKey(row.fields?.[type])===payrollKey(fields[type]));
      if(matches.length>1)throw new Error('Mais de um pagamento está vinculado à mesma origem e rubrica. Confira a galeria.');
      if(matches[0]) {
        await assertContext();const saved=await verify(matches[0],true);
        store().removeItem(key);return saved;
      }
      const journal=store();
      if(journal.getItem(key))throw new Error('O envio anterior desse encargo ainda não foi confirmado. Aguarde a reconciliação da origem; não inicie outro cadastro.');
      await assertContext({creating:true});assertSession();
      // Persist by financial origin BEFORE the POST, not by the current screen UUID.
      journal.setItem(key,'pending');
      if(journal.getItem(key)!=='pending')throw new Error('Não foi possível salvar a retomada antes do envio.');
      onAttempt();
      const saved=await verify(await createItem(fields),false);
      journal.removeItem(key);return saved;
    } finally {inFlight.delete(key);}
  }
  const locks=globalThis.navigator?.locks;
  return locks?.request?locks.request(key,run):run();
}
