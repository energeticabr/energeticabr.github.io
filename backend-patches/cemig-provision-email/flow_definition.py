"""Cloud connector ingestion; the server alone validates PDFs/financial targets."""
import json
import sys
from datetime import datetime,timedelta,timezone
from cemig_sync import PROFILES

SITE='https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com'
SECURE={'secureData':{'properties':['inputs','outputs']}}


def connector(api,operation,parameters,after=None):
    return {'type':'OpenApiConnection','inputs':{'host':{
        'apiId':f'/providers/Microsoft.PowerApps/apis/{api}','connectionName':api,'operationId':operation},
        'parameters':parameters,'authentication':"@parameters('$authentication')"},
        'runAfter':after or {},'runtimeConfiguration':SECURE}


def sp(method,uri,body,after=None):
    headers={'Accept':'application/json;odata=nometadata','Content-Type':'application/json;odata=nometadata'}
    if method=='MERGE': method='POST';headers.update({'IF-MATCH':'*','X-HTTP-Method':'MERGE'})
    if isinstance(body,dict):
        body=json.dumps({k:('@{'+v[1:]+'}' if isinstance(v,str) and v.startswith('@') else v) for k,v in body.items()})
    return connector('shared_sharepointonline','HttpRequest',{'dataset':SITE,'parameters/method':method,
        'parameters/uri':uri,'parameters/headers':headers,'parameters/body':body},after)


def envelope_actions(queue_id,provider,message,existing_id=None,prefix=''):
    if provider not in {'cemig','petranet'}:raise ValueError('Unknown invoice provider')
    sender='fatura@cemig.com.br' if provider=='cemig' else 'boleto@grupopetranet.com.br'
    subject='CEMIG FATURA ONLINE' if provider=='cemig' else 'Boleto da Petranet internet'
    read_name=prefix+'Read_email'
    create_name=prefix+'Create_queue'
    store_name=prefix+'Store_original_email'
    read=connector('shared_office365','GetEmailV2',{'messageId':message,'includeAttachments':True})
    queue_uri=f"_api/web/lists(guid'{queue_id}')/items"
    expression_uri=queue_uri.replace("'","''")
    body_ref=f"body('{read_name}')"
    actions={}
    if existing_id is None:
        actions[create_name]=sp('POST',queue_uri,{'Title':f"@concat('{provider.upper()} ',{body_ref}?['receivedDateTime'])",
            'MailId':f"@{body_ref}?['id']",'EmailReceived':f"@{body_ref}?['receivedDateTime']",'State':'RECEIVING'})
    target=existing_id or f"@body('{create_name}')?['Id']"
    actions[store_name]=connector('shared_sharepointonline','CreateAttachment',{
        'dataset':SITE,'table':queue_id,'itemId':target,'displayName':'mail.json',
        'body':f"@base64ToBinary(base64(string({body_ref})))"},
        {create_name:['Succeeded']} if existing_id is None else None)
    actions[prefix+'Mark_ready']=sp('MERGE',f"@concat('{expression_uri}(',string({target[1:]}),')')",
        {'State':'READY'},{store_name:['Succeeded']})
    body_expression=f"@toUpper({body_ref}?['body'])"
    property_filters=[]
    for profile in PROFILES:
        if profile.supplier!='CEMIG':continue
        parts=[{'contains':[body_expression,token]} for token in profile.address_tokens]
        parts.append({'or':[{'contains':[body_expression,number]} for number in profile.numbers]})
        if profile.room:parts.append({'contains':[body_expression,profile.room]})
        property_filters.append({'and':parts})
    property_condition=({'or':property_filters} if provider=='cemig' else
        {'and':[{'contains':[body_expression,'BERNARDO NOTINI MOREIRA BAHIA']},
                {'contains':[body_expression,'PETRANET']}]})
    condition={'type':'If','expression':{'and':[
        {'equals':[f"@toLower({body_ref}?['from'])",sender]},
        {'equals':[f"@toUpper({body_ref}?['subject'])",subject.upper()]},
        property_condition]},
        'actions':actions,'else':{'actions':{}},'runAfter':{read_name:['Succeeded']}}
    return {read_name:read,prefix+'Only_configured_properties':condition}


def definition(queue_id,replay=False,provider='cemig',start_time=None):
    if provider not in {'cemig','petranet'}:raise ValueError('Unknown invoice provider')
    if replay:
        triggers={'manual':{'type':'Request','kind':'Http','inputs':{
            'method':'POST','schema':{'type':'object','required':['messageId'],
            'properties':{'messageId':{'type':'string'}}}},
            'runtimeConfiguration':{'concurrency':{'runs':1},'secureData':{'properties':['outputs']}}}}
        actions=envelope_actions(queue_id,provider,"@triggerBody()?['messageId']")
    else:
        if start_time is None:
            now=datetime.now(timezone.utc)
            first=now.replace(hour=9,minute=45,second=0,microsecond=0)
            if first<=now:first+=timedelta(days=1)
            start_time=first.strftime('%Y-%m-%dT06:45:00')
        triggers={'daily':{'type':'Recurrence','recurrence':{'frequency':'Day','interval':1,
            'timeZone':'E. South America Standard Time','startTime':start_time,
            'schedule':{'hours':[6],'minutes':[45]}},'runtimeConfiguration':{'concurrency':{'runs':1}}}}
        sender='fatura@cemig.com.br' if provider=='cemig' else 'boleto@grupopetranet.com.br'
        subject_token='CEMIG' if provider=='cemig' else 'Petranet'
        search=connector('shared_office365','GetEmailsV3',{'folderPath':'Inbox','fetchOnlyUnread':False,
            'includeAttachments':False,'top':1000,
            # The connector wraps $search in quotes itself; nested quotes cause HTTP 400.
            # Full subject equality is enforced again before any envelope is stored.
            'searchQuery':f'from:{sender} subject:{subject_token} hasattachments:true received>=2026-11-04'})
        queue=sp('GET',f"_api/web/lists(guid'{queue_id}')/items?$select=Id,MailId,AttachmentFiles/FileName&$expand=AttachmentFiles&$top=5000",'')
        known={'type':'Query','inputs':{'from':"@body('Read_queue')?['value']",
            'where':"@equals(item()?['MailId'],items('Each_email')?['id'])"},'runAfter':{},'runtimeConfiguration':SECURE}
        complete={'type':'Query','inputs':{'from':"@body('Known_mail')",
            'where':"@contains(item()?['AttachmentFiles'],json('{\"FileName\":\"mail.json\"}'))"},
            'runAfter':{'Known_mail':['Succeeded']},'runtimeConfiguration':SECURE}
        recovery={'type':'If','expression':{'greater':["@length(body('Known_mail'))",0]},
            'actions':envelope_actions(queue_id,provider,"@items('Each_email')?['id']",
                existing_id="@first(body('Known_mail'))?['Id']",prefix='Repair_'),
            'else':{'actions':envelope_actions(queue_id,provider,"@items('Each_email')?['id']")},'runAfter':{}}
        needs={'type':'If','expression':{'equals':["@length(body('Complete_mail'))",0]},
            'actions':{'Recover_existing':recovery},'else':{'actions':{}},'runAfter':{'Complete_mail':['Succeeded']}}
        loop={'type':'Foreach','foreach':"@body('Search_emails')?['value']",
            'actions':{'Known_mail':known,'Complete_mail':complete,'Needs_capture':needs},
            'runAfter':{},'runtimeConfiguration':{'concurrency':{'repetitions':1}}}
        guards=[{'less':["@length(body('Search_emails')?['value'])",1000]},
                {'less':["@length(body('Read_queue')?['value'])",5000]}]
        for name in ['Search_emails','Read_queue']:
            for key in ['@odata.nextLink','odata.nextLink','nextLink']:
                guards.append({'equals':[f"@empty(body('{name}')?['{key}'])",True]})
        check={'type':'If','expression':{'and':guards},'actions':{'Each_email':loop},
            'else':{'actions':{'Truncated_result':{'type':'Terminate','inputs':{'runStatus':'Failed',
                'runError':{'code':'IncompleteDailySearch','message':'Daily capture result is truncated; review before continuing.'}},'runAfter':{}}}},
            'runAfter':{'Search_emails':['Succeeded'],'Read_queue':['Succeeded']}}
        actions={'Search_emails':search,'Read_queue':queue,'Check_complete_result':check}
    return {'$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        'contentVersion':'1.0.0.0','parameters':{'$connections':{'defaultValue':{},'type':'Object'},
        '$authentication':{'defaultValue':{},'type':'SecureObject'}},'triggers':triggers,
        'actions':actions,'outputs':{}}


if __name__=='__main__':
    provider=sys.argv[sys.argv.index('--provider')+1] if '--provider' in sys.argv else 'cemig'
    print(json.dumps(definition(sys.argv[1],replay='--replay' in sys.argv,provider=provider),ensure_ascii=False))
