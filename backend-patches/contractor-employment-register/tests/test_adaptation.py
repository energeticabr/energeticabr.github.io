"""Current independent engine behavior; HTTP, files and records are synthetic."""
import copy
import json
import os
from pathlib import Path

import pytest

from test_workflow import Store, Messenger, Catalog, Summary, ROLES, ROLE, ADMISSION
from workflow import WorkflowEngine

ROOT = Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])


@pytest.mark.parametrize('link', ['CLT', 'TERCEIRIZADO', 'INFORMAL'])
@pytest.mark.parametrize('role', ROLES)
def test_current_engine_requires_each_role_and_admission_for_every_link(tmp_path, link, role):
    config = json.loads((ROOT / 'worker/workflow_config.json').read_text(encoding='utf-8'))
    steps = config['sharepoint']['supply_supplier_registration_flow']['steps']
    store = Store()
    store.directory = tmp_path
    catalog = Catalog()
    engine = WorkflowEngine(config, store, None, Messenger(), catalog, summary_builder=Summary())
    state = engine._new_state({'message_id': 'synthetic', 'sender': 'qa',
        'conversation_id': 'qa', 'phone_number_id': 'portal-admin'}, 'qa')
    state.update(flow='supply_supplier_registration', stage='selecting_fields',
        supplier_employment_version=2,
        step_index=next(i for i, s in enumerate(steps) if s['key'] == ROLE),
        fields={'EMPREITEIRO': 'SIM', 'VINCULO': link})
    result = engine._prompt_next_or_summary(state, None)
    assert result.get('field') == ROLE
    assert [o['value'] for o in state['options'] if isinstance(o['id'], int)] == ROLES
    selected = ROLES.index(role) + 1
    result = engine._handle_step_reply({'kind': 'text', 'message_id': 'synthetic-role',
        'text': '', 'reply_id': f'choice:{ROLE}:{selected}'}, state, None)
    assert state['fields']['CARGO'] == role
    assert result.get('field') == ADMISSION
    assert not catalog.rows
