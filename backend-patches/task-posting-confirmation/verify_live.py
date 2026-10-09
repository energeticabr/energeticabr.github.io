"""Read-only post-rollout verification; no writes, submissions or messages."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--state-key', required=True)
parser.add_argument('--previous-id', required=True, type=int)
parser.add_argument('--previous-description-sha256', required=True)
args = parser.parse_args()
ROOT = Path('/opt/energetica-whatsapp')
sys.path[:0] = [str(ROOT), str(ROOT / 'worker')]
from local_app import build_engine, load_env
load_env(Path('/etc/energetica-whatsapp.env'))
engine = build_engine()
state, _ = engine.state_store.load(args.state_key)
if not state:
    raise RuntimeError('Expected conversation state was not found')
checkpoint = state.get('sharepoint') or {}
item_id = checkpoint.get('item_id')
if not item_id or int(item_id) == args.previous_id:
    raise RuntimeError('A distinct completed task has not been confirmed')
if state.get('flow') != 'task' or state.get('stage') != 'completed':
    raise RuntimeError('Expected completed task state is not present')
flow = engine._flow_config(state)
target = flow['target_list']
token = state.get('idempotency_token') or f"WA-task-{state['batch_id']}"
found = engine.sharepoint._find_item(token, target, flow.get('idempotency_field', 'Title'))
if not found or str(found.get('Id')) != str(item_id):
    raise RuntimeError('New submission identity does not match the saved task')
verified = engine.sharepoint.verify_item(item_id, state['fields'],
    checkpoint.get('attachment_names', []), target_list=target)
if verified.get('fields') is not True or verified.get('attachments') is not True:
    raise RuntimeError('Persisted task verification failed')
previous = engine.sharepoint.get_item_fields(args.previous_id, ['DESCRIÇÃO'], target_list=target)
previous_hash = hashlib.sha256(str(previous.get('DESCRIÇÃO', '')).encode('utf-8')).hexdigest()
if previous_hash != args.previous_description_sha256:
    raise RuntimeError('Previous task description changed')
failed = [s.get('flow') for s, _ in engine.state_store.iter_states()
          if s.get('stage') == 'submission_failed']
print(json.dumps({'status': 'verified', 'task_id': item_id,
    'previous_task_id': args.previous_id, 'previous_task_preserved': True,
    'verified': verified, 'stage': state['stage'], 'failed_active_flows': failed,
    'recorded_at': checkpoint.get('recorded_at')}, ensure_ascii=False))
