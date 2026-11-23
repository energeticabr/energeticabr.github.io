import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { CONTRACTOR_EMPLOYMENT_CARGOS } from '../../../../portal/forms/contractor-employment.js';
import { buildCargosTable, cargoKey, cargoRoleKey } from './cargos-model.js';

export function createCargosData({tokenProvider,repository:supplied,fetchImpl=globalThis.fetch,siteConfig=SHAREPOINT_SITES,now=()=>new Date()}={}) {
  if(!supplied&&typeof tokenProvider!=='function')throw new TypeError('A tabela de cargos requer a sessão Microsoft ativa.');
  const repository=supplied||createSharePointRepository(createGraphClient(tokenProvider,{fetch:fetchImpl}),siteConfig);
  const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Consulta cancelada.','AbortError');};
  async function resolveList(name, signal) {
    check(signal);const options=signal?{signal}:{};
    const list=await repository.resolveList('personal',[name],options);check(signal);
    if(list?.status!=='resolved'||!list.id)throw new Error(`A lista ${name} não está disponível nesta conta.`);
    return list.id;
  }
  async function readItems(listId, name, fields, signal) {
    check(signal);
    const query=new URLSearchParams({$expand:fields,$top:'100'}).toString();
    const items=[],seen=new Set();let cursor='';
    for(let pageNumber=1;pageNumber<=100;pageNumber++){
      const page=await repository.getItemsPage('personal',listId,query,{...(signal?{signal}:{}),pageNumber,maxPages:100,...(cursor?{cursor}:{})});check(signal);
      if(!Array.isArray(page?.items)||typeof page.hasMore!=='boolean')throw new Error(`A paginação de ${name} retornou dados incompletos.`);
      items.push(...page.items);
      if(!page.hasMore)return items;
      if(typeof page.nextLink!=='string'||!page.nextLink||seen.has(page.nextLink))throw new Error(`A paginação de ${name} está incompleta ou repetida.`);
      seen.add(page.nextLink);cursor=page.nextLink;
    }
    throw new Error(`A paginação de ${name} excedeu o limite.`);
  }

  async function loadSnapshot({signal}={}) {
    const listId=await resolveList('CARGOS',signal);
    const columns=await repository.getColumns('personal',listId,signal?{signal}:{});
    const items=await readItems(listId,'CARGOS','fields',signal);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
    return {rows:buildCargosTable(items,columns,today)};
  }

  async function loadAssignments({signal}={}) {
    const name='FUNCIONARIOSRH';
    const listId=await resolveList(name,signal);
    const items=await readItems(listId,name,'fields($select=Title,CARGO,FILIAL,STATUS)',signal);
    const assignments=new Map(), ids=new Set();
    for(const {id,fields} of items){
      if(!id||ids.has(String(id))||!fields)throw new Error('A consulta de vínculos de RH retornou registros incompletos ou repetidos.');
      ids.add(String(id));
      const cargo=cargoRoleKey(fields.CARGO);
      if(!cargo)continue;
      if(!assignments.has(cargo))assignments.set(cargo,[]);
      assignments.get(cargo).push({
        name:fields.Title?.trim()||`Cadastro RH #${id}`,
        branch:fields.FILIAL?.trim()||'',
        status:fields.STATUS?.trim()||'',
      });
    }
    for(const people of assignments.values())people.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    return assignments;
  }

  function requiredColumn(columns, label, aliases = []) {
    const accepted = new Set([label, ...aliases].map(cargoKey));
    const matches = columns.filter(column => column?.name && [column.name, column.displayName].some(name => accepted.has(cargoKey(name))));
    const writable = matches.filter(column => column.readOnly !== true);
    const selected = writable.length ? writable : matches;
    if (selected.length !== 1) throw new Error(`A coluna ${label} de FORNECEDORES não pôde ser identificada.`);
    return selected[0].name;
  }

  async function loadUnassignedContractors({signal}={}) {
    const supplierListId = await resolveList('FORNECEDORES', signal);
    const employeeListId = await resolveList('FUNCIONARIOSRH', signal);
    const columns = await repository.getColumns('personal', supplierListId, signal ? {signal} : {});
    if (!Array.isArray(columns)) throw new Error('Os metadados de FORNECEDORES estão indisponíveis.');
    const names = {
      name: requiredColumn(columns, 'CADASTRO', ['Title']),
      status: requiredColumn(columns, 'STATUS'),
      contractor: requiredColumn(columns, 'EMPREITEIRO'),
    };
    const [suppliers, employees] = await Promise.all([
      readItems(supplierListId, 'FORNECEDORES', `fields($select=${[...new Set(Object.values(names))].join(',')})`, signal),
      readItems(employeeListId, 'FUNCIONARIOSRH', 'fields($select=IDFORNECEDORORIGEM,CARGO)', signal),
    ]);
    const assigned = new Set(employees.filter(item => String(item.fields?.CARGO ?? '').trim())
      .map(item => String(item.fields?.IDFORNECEDORORIGEM ?? '').trim()).filter(Boolean));
    return suppliers.filter(item => item?.id && item.fields
      && cargoKey(item.fields[names.status]) === 'ATIVO'
      && cargoKey(item.fields[names.contractor]) === 'SIM'
      && !assigned.has(String(item.id)))
      .map(item => ({id:String(item.id),name:String(item.fields[names.name] ?? '').trim()}))
      .filter(item => item.name)
      .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  }

  async function assignContractorRole(supplierId, role, {signal}={}) {
    const origin = String(supplierId ?? '').trim();
    if (!/^[1-9]\d*$/.test(origin) || !Number.isSafeInteger(Number(origin))) throw new Error('Fornecedor inválido. Atualize a tabela e tente novamente.');
    if (!CONTRACTOR_EMPLOYMENT_CARGOS.includes(role)) throw new Error('Selecione um cargo válido.');
    const supplierListId = await resolveList('FORNECEDORES', signal);
    const employeeListId = await resolveList('FUNCIONARIOSRH', signal);
    const columns = await repository.getColumns('personal', supplierListId, signal ? {signal} : {});
    if (!Array.isArray(columns)) throw new Error('Os metadados de FORNECEDORES estão indisponíveis.');
    const names = {
      name: requiredColumn(columns, 'CADASTRO', ['Title']),
      status: requiredColumn(columns, 'STATUS'),
      contractor: requiredColumn(columns, 'EMPREITEIRO'),
    };
    const supplier = await repository.getItem('personal', supplierListId, origin, '$expand=fields', signal ? {signal} : {});
    if (String(supplier?.id) !== origin || !supplier.fields
      || cargoKey(supplier.fields[names.status]) !== 'ATIVO' || cargoKey(supplier.fields[names.contractor]) !== 'SIM') {
      throw new Error('O fornecedor não está mais ativo como empreiteiro. Atualize a tabela antes de atribuir o cargo.');
    }
    const employees = await readItems(employeeListId, 'FUNCIONARIOSRH', 'fields($select=IDFORNECEDORORIGEM,CARGO)', signal);
    const linked = employees.filter(item => String(item.fields?.IDFORNECEDORORIGEM ?? '').trim() === origin);
    if (linked.some(item => String(item.fields?.CARGO ?? '').trim())) throw new Error('Este fornecedor já possui um cargo vinculado. Atualize a tabela.');
    if (linked.length > 1) throw new Error('Há mais de um cadastro RH sem cargo para este fornecedor. Confira os registros antes de continuar.');
    if (linked.length === 1) {
      const item = linked[0];
      const current = await repository.getItem('personal', employeeListId, String(item.id), '$expand=fields', signal ? {signal} : {});
      if (String(current?.fields?.IDFORNECEDORORIGEM ?? '').trim() !== origin
        || String(current?.fields?.CARGO ?? '').trim()) throw new Error('O vínculo RH mudou durante a gravação. Atualize a tabela.');
      const eTag = current.eTag || current['@odata.etag'];
      if (!eTag || eTag === '*') throw new Error('A versão do vínculo RH não pôde ser confirmada. Atualize a tabela antes de atribuir o cargo.');
      await repository.updateItem('personal', employeeListId, String(item.id), {CARGO:role}, {
        eTag, signal, readbackFields:['CARGO'],
      });
      const confirmed = await repository.getItem('personal', employeeListId, String(item.id), '$expand=fields', signal ? {signal} : {});
      if (String(confirmed?.fields?.IDFORNECEDORORIGEM ?? '').trim() !== origin || confirmed.fields.CARGO !== role) throw new Error('A atribuição do cargo não foi confirmada no RH. Atualize e confira os registros.');
      return {id:origin,name:String(supplier.fields[names.name] ?? '').trim(),role};
    }
    const fields = {
      Title:String(supplier.fields[names.name] ?? '').trim(),
      IDFORNECEDORORIGEM:origin,
      CARGO:role,
      EMPREITEIRO:'SIM',
      STATUS:'ATIVO',
    };
    if (!fields.Title) throw new Error('O nome do fornecedor está vazio; confira o cadastro antes de continuar.');
    try {
      const created = await repository.createItem('personal', employeeListId, fields, signal ? {signal} : {});
      if (!created?.id) throw new Error('O SharePoint não confirmou o novo vínculo RH. Atualize a tabela e confira antes de tentar novamente.');
      const confirmed = await repository.getItem('personal', employeeListId, String(created.id), '$expand=fields', signal ? {signal} : {});
      if (String(confirmed?.fields?.IDFORNECEDORORIGEM ?? '').trim() !== origin || confirmed.fields.CARGO !== role) throw new Error('O SharePoint não confirmou os dados do vínculo RH. Atualize e confira os registros.');
      return {id:origin,name:fields.Title,role};
    } catch (error) {
      // A response can be lost after SharePoint commits. Reconcile before surfacing the failure
      // so a retry cannot create a second role for the same supplier.
      const after = await readItems(employeeListId, 'FUNCIONARIOSRH', 'fields($select=IDFORNECEDORORIGEM,CARGO)', signal).catch(()=>[]);
      const matches = after.filter(item => String(item.fields?.IDFORNECEDORORIGEM ?? '').trim() === origin);
      if (matches.length === 1 && matches[0].fields?.CARGO === role) return {id:origin,name:fields.Title,role};
      throw error;
    }
  }

  return Object.freeze({loadSnapshot,loadAssignments,loadUnassignedContractors,assignContractorRole});
}
