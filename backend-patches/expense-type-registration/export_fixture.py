"""Serialize actual server polls from synthetic expense catalog states."""
import ast
import json
from pathlib import Path
import sys
from test_registration import ExpenseTypeTests, ROOT
from logic import condition_matches, is_binary_choice, visual_choice_title, visual_form_prompt, visual_option_title
from rhid_badge_source import attendance_rhid_option_context

bridge = ast.parse((ROOT / 'channel_bridge.py').read_text(encoding='utf-8'))
serializer = next(n for n in bridge.body if isinstance(n, ast.ClassDef) and n.name == 'ChannelMessenger')
exec(compile(ast.Module(body=[serializer], type_ignores=[]), 'actual-channel-serializer', 'exec'), globals())
case = ExpenseTypeTests()
case.setUp()
packets = {}
try:
    case.open(rows=[{'id': 1, 'title': '1 - MATERIAL', 'value': 'MATERIAL'},
        {'id': 12, 'title': '12 - TIPO FICTÍCIO COM NOME MUITO LONGO PARA MATERIAIS E SERVIÇOS DE CONSTRUÇÃO',
         'value': 'TIPO FICTÍCIO COM NOME MUITO LONGO PARA MATERIAIS E SERVIÇOS DE CONSTRUÇÃO'}])
    for name, query in [('select', None), ('filtered', 'MATERIAL'), ('empty', 'INEXISTENTE')]:
        if query is not None:
            case.reply('filter_query', query)
        previous = case.engine.messenger
        real = ChannelMessenger()
        case.engine.messenger = real
        case.engine._emit_option_page(case.current)
        messages = real.drain()
        case.engine.messenger = previous
        poll = next(m for m in messages if m['type'] == 'poll')
        assert poll['options'][0]['label'] == '➕ CADASTRAR TIPO DESPESA'
        packets[name] = {'messages': messages}
    Path(sys.argv[1]).write_text(json.dumps(packets, ensure_ascii=False, indent=2), encoding='utf-8')
finally:
    case.doCleanups()
