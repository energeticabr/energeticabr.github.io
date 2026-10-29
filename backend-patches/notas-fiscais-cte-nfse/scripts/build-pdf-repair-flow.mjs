import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/energetica.json')));
const list=`_api/web/lists/getbytitle('${cfg.listTitle}')`;
const origin=new URL(cfg.siteUrl).origin;
const lit=s=>`'${s.replaceAll("'","''")}'`;
const after=name=>name?{[name]:['Succeeded']}:{};
const schemaTrue={type:'object',required:['valid'],properties:{valid:{type:'boolean',enum:[true]}}};
const gate=(predicate,previous)=>({type:'ParseJson',inputs:{content:`@if(${predicate},json('{"valid":true}'),json('{}'))`,schema:schemaTrue},runAfter:after(previous)});
const secure={secureData:{properties:['inputs','outputs']}};
function sp(method,uri,previous){return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{dataset:cfg.siteUrl,'parameters/method':method,'parameters/uri':uri,'parameters/headers':{Accept:'application/json;odata=verbose'}},authentication:"@parameters('$authentication')"},runAfter:after(previous)};}
function native(operationId,parameters,previous){return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId},parameters:{dataset:cfg.siteUrl,...parameters},authentication:"@parameters('$authentication')"},runtimeConfiguration:secure,runAfter:after(previous)};}
const doc=name=>`items('Documentos')?['${name}']`;
const key=doc('key'),sha=doc('xmlSha256'),pdf="items('Documentos')?['danfe']";
const only=(v,chars)=>`equals(${[...chars].reduce((s,c)=>`replace(${s},'${c}','')`,v)},'')`;
const item=`concat(${lit(list+'/items(')},string(int(outputs('Nota')?['Id'])),')')`;
const name=`${pdf}?['fileName']`;
const isNfse=`equals(length(${key}),50)`;
const fiscalType=`if(${isNfse},'NFS-e','CT-e')`;
const prefix=`if(${isNfse},'DANFSe-','DACTE-')`;
const attachmentTail=`concat('/Attachments/',string(int(outputs('Nota')?['Id'])),'/',${name})`;
const repair={
 Conferir_identidade:gate(`and(or(${isNfse},and(equals(length(${key}),44),equals(substring(${key},20,2),'57'))),${only(key,'0123456789')},equals(coalesce(${doc('fiscalType')},${fiscalType}),${fiscalType}),equals(length(${sha}),64),${only(sha,'0123456789abcdef')},equals(${name},concat(${prefix},${key},'-',substring(${sha},0,16),'.pdf')),equals(length(${pdf}?['sha256']),64),${only(`${pdf}?['sha256']`,'0123456789abcdef')})`),
 Localizar_nota:sp('GET',`@concat(${lit(list+"/items?$select=*&$filter=CHAVE_ACESSO eq '")},${key},${lit("'&$top=2")})`,'Conferir_identidade'),
 Conferir_nota_unica:gate("equals(length(body('Localizar_nota')?['d']?['results']),1)",'Localizar_nota'),
 Nota:{type:'Compose',inputs:"@first(body('Localizar_nota')?['d']?['results'])",runAfter:after('Conferir_nota_unica')},
 Conferir_estado:gate(`and(equals(outputs('Nota')?['CHAVE_ACESSO'],${key}),equals(outputs('Nota')?['STATUS_IMPORTACAO'],'XML_COMPLETO'),equals(outputs('Nota')?['SITUACAO'],${doc('expectedSituation')}),equals(outputs('Nota')?['TIPO_FISCAL'],${fiscalType}),or(${isNfse},and(equals(string(outputs('Nota')?['MODELO']),'57'),equals(outputs('Nota')?['TIPO_DOCUMENTO'],'cteProc'))),startsWith(outputs('Nota')?['XML_URL']?['Url'],concat(${lit(origin+cfg.libraryPath+'/')},${key},'-')),endsWith(outputs('Nota')?['XML_URL']?['Url'],concat('-',substring(${sha},0,16),'.xml')),startsWith(outputs('Nota')?['DANFE_URL']?['Url'],${lit(origin+new URL(cfg.siteUrl).pathname+'/Lists/')}),endsWith(outputs('Nota')?['DANFE_URL']?['Url'],${attachmentTail}))`,'Nota'),
 Baixar_XML:native('GetFileContentByPath',{path:`@substring(outputs('Nota')?['XML_URL']?['Url'],${(origin+new URL(cfg.siteUrl).pathname).length})`,inferContentType:false},'Conferir_estado'),
 Conferir_XML:gate(`equals(body('Baixar_XML')?['$content'],${doc('xmlBase64')})`,'Baixar_XML'),
 Localizar_anexo:sp('GET',`@concat(${item},${lit("/AttachmentFiles('")},${name},${lit("')?$select=FileName,ServerRelativeUrl")})`,'Conferir_XML'),
 Conferir_anexo:gate(`and(equals(body('Localizar_anexo')?['d']?['FileName'],${name}),equals(concat(${lit(origin)},body('Localizar_anexo')?['d']?['ServerRelativeUrl']),outputs('Nota')?['DANFE_URL']?['Url']),endsWith(body('Localizar_anexo')?['d']?['ServerRelativeUrl'],${attachmentTail}))`,'Localizar_anexo'),
 Metadados_anexo:native('GetFileMetadataByPath',{path:`@substring(body('Localizar_anexo')?['d']?['ServerRelativeUrl'],${new URL(cfg.siteUrl).pathname.length})`},'Conferir_anexo'),
 Atualizar_PDF:native('UpdateFile',{id:"@body('Metadados_anexo')?['Id']",body:`@base64ToBinary(${pdf}?['pdfBase64'])`},'Metadados_anexo'),
 Baixar_PDF:native('GetFileContentByPath',{path:`@substring(body('Localizar_anexo')?['d']?['ServerRelativeUrl'],${new URL(cfg.siteUrl).pathname.length})`,inferContentType:true},'Atualizar_PDF'),
 Conferir_PDF:gate(`equals(body('Baixar_PDF')?['$content'],${pdf}?['pdfBase64'])`,'Baixar_PDF'),
 Nota_depois:sp('GET',`@concat(${item},'?$select=Id,CHAVE_ACESSO,SITUACAO,STATUS_IMPORTACAO,TIPO_FISCAL,MODELO,TIPO_DOCUMENTO,XML_URL,DANFE_URL')`,'Conferir_PDF'),
 Conferir_estado_final:gate(`and(equals(body('Nota_depois')?['d']?['Id'],outputs('Nota')?['Id']),equals(body('Nota_depois')?['d']?['CHAVE_ACESSO'],${key}),equals(body('Nota_depois')?['d']?['SITUACAO'],${doc('expectedSituation')}),equals(body('Nota_depois')?['d']?['STATUS_IMPORTACAO'],'XML_COMPLETO'),equals(body('Nota_depois')?['d']?['TIPO_FISCAL'],outputs('Nota')?['TIPO_FISCAL']),equals(body('Nota_depois')?['d']?['MODELO'],outputs('Nota')?['MODELO']),equals(body('Nota_depois')?['d']?['TIPO_DOCUMENTO'],outputs('Nota')?['TIPO_DOCUMENTO']),equals(body('Nota_depois')?['d']?['XML_URL']?['Url'],outputs('Nota')?['XML_URL']?['Url']),equals(body('Nota_depois')?['d']?['DANFE_URL']?['Url'],outputs('Nota')?['DANFE_URL']?['Url']))`,'Nota_depois'),
};
const requestSchema={type:'object',required:['source','companyCnpj','documents'],properties:{source:{type:'string',enum:['FISCAL_PDF_LAYOUT_REPAIR']},companyCnpj:{type:'string',enum:[cfg.companyCnpj]},documents:{type:'array',maxItems:10,items:{type:'object',required:['key','xmlSha256','xmlBase64','expectedSituation','danfe'],properties:{key:{type:'string',minLength:44,maxLength:50},fiscalType:{type:'string',enum:['NFS-e','CT-e']},xmlSha256:{type:'string',minLength:64,maxLength:64},xmlBase64:{type:'string',minLength:20,maxLength:1500000},expectedSituation:{type:'string',enum:['AUTORIZADA','CANCELADA','SUBSTITUIDA']},danfe:{type:'object',required:['fileName','pdfBase64','sha256'],properties:{fileName:{type:'string',minLength:1,maxLength:120},pdfBase64:{type:'string',minLength:28,maxLength:2700000},sha256:{type:'string',minLength:64,maxLength:64}}}}}}}};
const definition={$schema:'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',parameters:{$authentication:{defaultValue:{},type:'SecureObject'},$connections:{defaultValue:{},type:'Object'}},triggers:{manual:{type:'Request',kind:'Button',inputs:{schema:requestSchema},runtimeConfiguration:{concurrency:{runs:1},secureData:{properties:['outputs']}}}},actions:{
 Validar_lote:{type:'ParseJson',inputs:{content:'@triggerBody()',schema:requestSchema},runtimeConfiguration:{secureData:{properties:['inputs']}},runAfter:{}},
 Documentos:{type:'Foreach',foreach:"@body('Validar_lote')?['documents']",actions:repair,runtimeConfiguration:{concurrency:{repetitions:1}},runAfter:after('Validar_lote')},
 Chaves_confirmadas:{type:'Select',inputs:{from:"@body('Validar_lote')?['documents']",select:{key:"@item()?['key']",pdfSha256:"@item()?['danfe']?['sha256']"}},runAfter:after('Documentos')},
 Recibo:{type:'Compose',inputs:{source:'FISCAL_PDF_LAYOUT_REPAIR',documents:"@body('Chaves_confirmadas')"},runAfter:after('Chaves_confirmadas')},
},outputs:{}};
fs.writeFileSync(path.join(root,'powerautomate/07-Corrigir-Espelhos-PDF.definition.json'),JSON.stringify(definition,null,2)+'\n');
