"""Dedicated daily Asaas ingestion; only the OCI worker chooses financial targets."""
from flow_definition import connector,sp,SECURE
from silva_novais import BILL_SENDER,NF_SENDER,NF_SUBJECT,COMPANY,QUEUE

def definition(queue_id,start_time=None):
    if not start_time:raise ValueError('Explicit Brasilia calendar start time required')
    actions={
        'Read_queue':sp('GET',f"_api/web/lists(guid'{queue_id}')/items?$select=Id,MailId,AttachmentFiles/FileName&$expand=AttachmentFiles&$top=5000",'')
    }
    guards=[{'less':["@length(body('Read_queue')?['value'])",5000]}]
    for prefix,sender,search in [('Charges',BILL_SENDER,f'from:{BILL_SENDER} received>=2026-04-01'),
                                  ('Invoices',NF_SENDER,f'from:{NF_SENDER} subject:SILVA subject:NOVAIS received>=2026-04-01')]:
        search_name=prefix+'_Search';loop_name=prefix+'_Each_email';read=prefix+'_Read_email'
        known=prefix+'_Known';complete=prefix+'_Complete';create=prefix+'_Create';attach=prefix+'_Envelope';ready=prefix+'_Ready'
        actions[search_name]=connector('shared_office365','GetEmailsV3',{'folderPath':'Inbox','fetchOnlyUnread':False,'includeAttachments':False,'top':1000,'searchQuery':search})
        guards.append({'less':[f"@length(body('{search_name}')?['value'])",1000]})
        body=f"body('{read}')"
        queue_uri=f"_api/web/lists(guid'{queue_id}')/items"
        creates={
            create:sp('POST',queue_uri,{'Title':f"@concat('ASAAS ',{body}?['receivedDateTime'])",'MailId':f'@{body}?[\'id\']','EmailReceived':f'@{body}?[\'receivedDateTime\']','State':'RECEIVING'}),
            attach:connector('shared_sharepointonline','CreateAttachment',{'dataset':'https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com','table':queue_id,'itemId':f"@body('{create}')?['Id']",'displayName':'mail.json','body':f"@base64ToBinary(base64(string({body})))"},{create:['Succeeded']}),
            ready:sp('MERGE',queue_uri+f"(@{{body('{create}')?['Id']}})",{'State':'READY'},{attach:['Succeeded']})
        }
        # If a previous run created the row but failed before storing mail.json,
        # repair that same row rather than creating another MailId.
        repair=prefix+'_Repair';repair_ready=prefix+'_Repair_ready'
        repairs={repair:connector('shared_sharepointonline','CreateAttachment',{'dataset':'https://energeticaltda-my.sharepoint.com/personal/bernardonotini_energeticabr_com','table':queue_id,'itemId':f"@first(body('{known}'))?['Id']",'displayName':'mail.json','body':f"@base64ToBinary(base64(string({body})))"}),
                 repair_ready:sp('MERGE',queue_uri+f"(@{{first(body('{known}'))?['Id']}})",{'State':'READY'},{repair:['Succeeded']})}
        select={'type':'If','expression':{'greater':[f"@length(body('{known}'))",0]},'actions':repairs,'else':{'actions':creates},'runAfter':{}}
        conditions=[{'equals':[f"@toLower({body}?['from'])",sender]},
                    {'contains':[f"@toUpper({body}?['body'])",COMPANY]},
                    {'contains':[f"@toUpper({body}?['body'])",'CONTABILIDADE SILVA NOVAIS']},
                    {'not':{'contains':[f"@toUpper({body}?['body'])",'NB PARTICIPACOES']}}]
        if prefix=='Invoices':conditions.append({'equals':[f"@toUpper({body}?['subject'])",NF_SUBJECT.upper()]})
        validated={read:connector('shared_office365','GetEmailV2',{'messageId':f"@items('{loop_name}')?['id']",'includeAttachments':False}),
                   prefix+'_Only_energetica':{'type':'If','expression':{'and':conditions},'actions':{prefix+'_Repair_or_create':select},'else':{'actions':{}},'runAfter':{read:['Succeeded']}}}
        loop_actions={
            known:{'type':'Query','inputs':{'from':"@body('Read_queue')?['value']",'where':f"@equals(item()?['MailId'],items('{loop_name}')?['id'])"},'runAfter':{},'runtimeConfiguration':SECURE},
            complete:{'type':'Query','inputs':{'from':f"@body('{known}')",'where':"@contains(item()?['AttachmentFiles'],json('{\"FileName\":\"mail.json\"}'))"},'runAfter':{known:['Succeeded']},'runtimeConfiguration':SECURE},
            prefix+'_Needs_capture':{'type':'If','expression':{'equals':[f"@length(body('{complete}'))",0]},'actions':validated,'else':{'actions':{}},'runAfter':{complete:['Succeeded']}}
        }
        actions[prefix+'_Check_complete']={'type':'If','expression':{'and':[]},'actions':{loop_name:{'type':'Foreach','foreach':f"@body('{search_name}')?['value']",'actions':loop_actions,'runAfter':{},'runtimeConfiguration':{'concurrency':{'repetitions':1}}}},'else':{'actions':{prefix+'_Truncated':{'type':'Terminate','inputs':{'runStatus':'Failed','runError':{'code':'IncompleteAsaasSearch','message':'Search result is truncated; no incomplete capture accepted.'}},'runAfter':{}}}},'runAfter':{search_name:['Succeeded'],'Read_queue':['Succeeded']}}
    for name in ('Read_queue','Charges_Search','Invoices_Search'):
        for key in ('@odata.nextLink','odata.nextLink','nextLink'):guards.append({'equals':[f"@empty(body('{name}')?['{key}'])",True]})
    for prefix in ('Charges','Invoices'):
        actions[prefix+'_Check_complete']['expression']['and']=guards
        actions[prefix+'_Check_complete']['runAfter']={'Read_queue':['Succeeded'],'Charges_Search':['Succeeded'],'Invoices_Search':['Succeeded']}
    return {'$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#','contentVersion':'1.0.0.0',
            'parameters':{'$connections':{'defaultValue':{},'type':'Object'},'$authentication':{'defaultValue':{},'type':'SecureObject'}},
            'triggers':{'daily':{'type':'Recurrence','recurrence':{'frequency':'Day','interval':1,'timeZone':'E. South America Standard Time','startTime':start_time,'schedule':{'hours':[6],'minutes':[50]}},'runtimeConfiguration':{'concurrency':{'runs':1}}}},'actions':actions,'outputs':{}}

if __name__=='__main__':
    import sys,json
    print(json.dumps(definition(sys.argv[1],sys.argv[2]),ensure_ascii=False))
