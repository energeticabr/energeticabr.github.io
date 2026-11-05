"""Cloud connector ingestion; the server alone validates PDFs/financial targets."""
import json
import sys
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


def definition(queue_id,replay=False):
    if replay:
        triggers={'manual':{'type':'Request','kind':'Http','inputs':{
            'method':'POST','schema':{'type':'object','required':['messageId'],
            'properties':{'messageId':{'type':'string'}}}},
            'runtimeConfiguration':{'concurrency':{'runs':1},'secureData':{'properties':['outputs']}}}}
        message="@triggerBody()?['messageId']"
    else:
        triggers={'email':{'type':'OpenApiConnectionNotification','splitOn':"@triggerOutputs()?['body/value']",
            'inputs':{'host':{'apiId':'/providers/Microsoft.PowerApps/apis/shared_office365',
            'connectionName':'shared_office365','operationId':'OnNewEmailV3'},'parameters':{
            'folderPath':'Inbox','from':'fatura@cemig.com.br','subjectFilter':'CEMIG FATURA ONLINE',
            'fetchOnlyWithAttachment':True,'includeAttachments':False},'authentication':"@parameters('$authentication')"},
            'runtimeConfiguration':{'secureData':{'properties':['outputs']}}}}
        message="@triggerBody()?['id']"
    read=connector('shared_office365','GetEmailV2',{'messageId':message,'includeAttachments':True})
    queue_uri=f"_api/web/lists(guid'{queue_id}')/items"
    expression_uri=queue_uri.replace("'","''")
    actions={
        'Create_queue':sp('POST',queue_uri,{'Title':"@concat('CEMIG ',body('Read_email')?['receivedDateTime'])",
            'MailId':"@body('Read_email')?['id']",'EmailReceived':"@body('Read_email')?['receivedDateTime']",'State':'RECEIVING'}),
        'Store_original_email':connector('shared_sharepointonline','CreateAttachment',{
            'dataset':SITE,'table':queue_id,'itemId':"@body('Create_queue')?['Id']",'displayName':'mail.json',
            'body':"@base64ToBinary(base64(string(body('Read_email'))))"},{'Create_queue':['Succeeded']}),
        'Mark_ready':sp('MERGE',f"@concat('{expression_uri}(',string(body('Create_queue')?['Id']),')')",
            {'State':'READY'},{'Store_original_email':['Succeeded']})}
    body_expression="@toUpper(body('Read_email')?['body'])"
    property_filters=[]
    for profile in PROFILES:
        parts=[{'contains':[body_expression,token]} for token in profile.address_tokens]
        parts.append({'or':[{'contains':[body_expression,number]} for number in profile.numbers]})
        if profile.room:parts.append({'contains':[body_expression,profile.room]})
        property_filters.append({'and':parts})
    condition={'type':'If','expression':{'and':[
        {'equals':["@toLower(body('Read_email')?['from'])",'fatura@cemig.com.br']},
        {'equals':["@toUpper(body('Read_email')?['subject'])",'CEMIG FATURA ONLINE']},
        {'or':property_filters}]},
        'actions':actions,'else':{'actions':{}},'runAfter':{'Read_email':['Succeeded']}}
    return {'$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        'contentVersion':'1.0.0.0','parameters':{'$connections':{'defaultValue':{},'type':'Object'},
        '$authentication':{'defaultValue':{},'type':'SecureObject'}},'triggers':triggers,
        'actions':{'Read_email':read,'Only_configured_properties':condition},'outputs':{}}


if __name__=='__main__':
    print(json.dumps(definition(sys.argv[1],replay='--replay' in sys.argv),ensure_ascii=False))
