"""Export actual channel packets from synthetic payroll registration states."""
import json,sys
from pathlib import Path
from test_registration import PaymentTypeTests
from channel_bridge import ChannelMessenger
case=PaymentTypeTests();case.setUp();packets={}
try:
 real=ChannelMessenger();case.engine.messenger=real
 def capture(name):
  messages=real.drain();assert any(m.get('type')=='poll' for m in messages);packets[name]={'messages':messages}
 case.prompt();capture('select')
 case.catalog=[];case.prompt();capture('empty')
 case.send('launch_payroll_type_create');capture('name')
 case.send(text='TIPO FICTÍCIO COM NOME MUITO LONGO PARA PAGAMENTO DE SERVIÇOS E REEMBOLSOS');capture('confirm')
 case.send('cancelar');real.drain()
 case.catalog=[{'id':100+i,'title':f'TIPO FICTÍCIO {i:02d} PARA PAGAMENTO DE SERVIÇOS E REEMBOLSOS','value':f'TIPO FICTÍCIO {i:02d} PARA PAGAMENTO DE SERVIÇOS E REEMBOLSOS'} for i in range(20)]
 case.current['pending_launch_payroll']['catalog_page']=1
 case.prompt();capture('page')
 Path(sys.argv[1]).write_text(json.dumps(packets,ensure_ascii=False,indent=2),encoding='utf-8')
finally:case.doCleanups()
