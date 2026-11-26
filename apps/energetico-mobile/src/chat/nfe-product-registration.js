import { nfeProposalKey } from './nfe-proposal-model.js';

const clean = value => String(value ?? '').trim();
const activeRow = fields => !['inativo','inativa','bloqueado','bloqueada','cancelado','cancelada'].includes(nfeProposalKey(fields.STATUS ?? fields.SATUS));
const productOf = row => ({ id:String(row.id), label:clean(row.fields.field_1), unit:clean(row.fields.UNIDADE),
  expenseType:clean(row.fields.TIPODESPESA), disburses:clean(row.fields.GERADESEMBOLSO) });
const unique = values => [...new Set(values.map(clean).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
// The launch and provision services can share a repository in one app session.
const repositoryWrites = new WeakMap();

export function createNfeProductRegistration({ repository, authorizeWrite, assertSession = () => {} }) {
  const contexts = new WeakSet(), pending = new WeakMap();
  const active = signal => { assertSession(); signal?.throwIfAborted(); };
  async function list(names, signal) {
    const result = await repository.resolveList('personal', names, {signal}); active(signal);
    if(result?.status !== 'resolved' || !result.id) throw new Error(`O cadastro ${names[0]} está indisponível.`);
    return result;
  }
  async function rows(id, fields, signal) {
    const result = await repository.getItems('personal', id, `$select=id&$expand=fields($select=${fields.join(',')})&$top=200`, {signal});
    active(signal);
    if(!Array.isArray(result) || result.some(row=>!/^\d+$/.test(String(row?.id)) || !row.fields)) throw new Error('A consulta do cadastro está incompleta.');
    return result;
  }
  async function activeExpenseTypes(id, signal) {
    const expenses = await rows(id, ['Title','STATUS'], signal);
    return unique(expenses.filter(row=>nfeProposalKey(row.fields.STATUS)==='ativo').map(row=>row.fields.Title));
  }
  const productFields = ['Title','field_1','UNIDADE','TIPO','TIPODESPESA','GERADESEMBOLSO','SATUS'];
  async function load({signal} = {}) {
    active(signal);
    const [products, families, expenses] = await Promise.all([
      list(['CADASTROPRODUTO','CADASTRO PRODUTO'],signal),
      list(['CADASTROSUBFAMÍLIA','CADASTROSUBFAMILIA','CADASTRO SUBFAMÍLIA','CADASTRO SUBFAMILIA'],signal),
      list(['CADASTROTIPOMATERIAL'],signal),
    ]);
    const [columns, subfamilies, expenseTypes] = await Promise.all([
      repository.getColumns('personal', products.id, {signal}),
      rows(families.id,['field_1','field_3','STATUS'],signal),
      activeExpenseTypes(expenses.id,signal),
    ]);
    active(signal);
    for(const name of productFields) if(!columns.some(column=>column.name===name && !column.readOnly))
      throw new Error(`O campo ${name} do cadastro de produtos está indisponível.`);
    const choices = name => columns.find(column=>column.name===name)?.choice?.choices || [];
    const context = {
      listId:products.id, expenseListId:expenses.id,
      subfamilies:subfamilies.filter(row=>activeRow(row.fields) && nfeProposalKey(row.fields.field_3)!=='receita')
        .map(row=>({id:String(row.id),label:clean(row.fields.field_1)})).filter(row=>row.label),
      expenseTypes,
      disburses:choices('GERADESEMBOLSO').length ? choices('GERADESEMBOLSO') : ['SIM','NÃO'],
      status:choices('SATUS').find(value=>nfeProposalKey(value)==='ativo') || (choices('SATUS').length ? null : 'ATIVO'),
      choices:Object.fromEntries(productFields.map(name=>[name,choices(name)])),
    };
    if(!context.status) throw new Error('O status ATIVO não está disponível no cadastro de produtos.');
    contexts.add(context); return context;
  }
  async function persist(context, values, {signal} = {}) {
    active(signal);
    const name=clean(values.name),unit=clean(values.unit), family=context.subfamilies.find(row=>row.id===values.subfamilyId);
    if(!name || name.length>255) throw new Error('Informe o nome do produto com até 255 caracteres.');
    if(!unit || unit.length>255) throw new Error('Informe a unidade de medida.');
    if(!family) throw new Error('Selecione a subfamília do produto.');
    if(!context.expenseTypes.includes(values.expenseType)) throw new Error('Selecione o tipo de despesa.');
    if(!context.disburses.includes(values.disburses)) throw new Error('Informe se o produto gera desembolso.');
    const fields={Title:family.label,field_1:name,UNIDADE:unit,TIPO:'DESPESA',TIPODESPESA:values.expenseType,GERADESEMBOLSO:values.disburses,SATUS:context.status};
    for(const [key,value] of Object.entries(fields)) if(context.choices[key]?.length && !context.choices[key].includes(value))
      throw new Error(`O valor de ${key} não está disponível no cadastro.`);
    const existing=(await rows(context.listId,productFields,signal)).filter(row=>nfeProposalKey(row.fields.field_1)===nfeProposalKey(name));
    if(existing.length) {
      const match=existing.find(row=>activeRow(row.fields) && Object.entries(fields).every(([key,value])=>clean(row.fields[key]).toLocaleUpperCase('pt-BR')===clean(value).toLocaleUpperCase('pt-BR')));
      if(existing.length===1 && match) return productOf(match);
      throw new Error('Já existe um produto cadastrado com esse nome. Confira o cadastro antes de continuar.');
    }
    await authorizeWrite?.({signal}); active(signal);
    if(!(await activeExpenseTypes(context.expenseListId,signal)).includes(values.expenseType))
      throw new Error('O tipo de despesa deixou de estar ativo. Reabra o cadastro e selecione um tipo ativo.');
    active(signal);
    const saved=await repository.createItem('personal',context.listId,fields,{signal}); active(signal);
    if(!/^\d+$/.test(String(saved?.id))) throw new Error('Não foi possível confirmar o cadastro. Confira os dados e tente novamente.');
    return productOf({id:saved.id,fields});
  }
  return Object.freeze({load, save(context,values,options) {
    if(!contexts.has(context)) return Promise.reject(new Error('Reabra o cadastro de produto.'));
    if(pending.has(context)) return pending.get(context);
    let queue=repositoryWrites.get(repository);
    if(!queue){queue=new Map();repositoryWrites.set(repository,queue);}
    const key=JSON.stringify([context.listId,nfeProposalKey(values.name)]);
    const request=(queue.get(key)||Promise.resolve()).catch(()=>{}).then(()=>persist(context,values,options)).finally(()=>{
      pending.delete(context);if(queue.get(key)===request)queue.delete(key);
    });
    queue.set(key,request);
    pending.set(context,request); return request;
  }});
}
