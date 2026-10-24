"""Patch/deployment guards and narrow config scope; no production writes."""
import copy
import json
import io
from pathlib import Path
import unittest
from unittest.mock import patch as mock_patch
import patch_backend as patch
import deploy as deployment
from deploy import validate_manifest


class PatchGuardTests(unittest.TestCase):
    def config(self):
        return {'sharepoint': {'construction_stage_demonstrative_create_flow': {'steps': [{
            'key': patch.KEY, 'kind': 'selection', 'target_field': 'ATIVIDADEEXECUTADA',
            'source': {'type': 'sharepoint_list', 'list': 'ATIVIDADE EXECUTADA'}, 'empty_message': 'empty'}]},
            'unrelated': {'steps': [{'key': 'other', 'target_field': 'FORNECEDOR'}]}}}

    def test_only_activity_opt_in_changes_and_input_is_not_mutated(self):
        before = self.config()
        saved = copy.deepcopy(before)
        after = patch.patch_config(before)
        step = after['sharepoint']['construction_stage_demonstrative_create_flow']['steps'][0]
        self.assertEqual(step['free_text_target_field'], 'ATIVIDADEEXECUTADA')
        self.assertTrue(step['filter_with_direct_text'])
        self.assertNotIn('empty_message', step)
        self.assertEqual(after['sharepoint']['unrelated'], saved['sharepoint']['unrelated'])
        self.assertEqual(before, saved)

    def test_drift_duplicate_and_already_patched_question_are_rejected(self):
        for alteration in ('target', 'duplicate', 'patched'):
            config = self.config()
            steps = config['sharepoint']['construction_stage_demonstrative_create_flow']['steps']
            if alteration == 'target':
                steps[0]['target_field'] = 'FORNECEDOR'
            elif alteration == 'duplicate':
                steps.append(copy.deepcopy(steps[0]))
            else:
                config = patch.patch_config(config)
            with self.subTest(alteration=alteration), self.assertRaises(ValueError):
                patch.patch_config(config)

    def test_source_patch_rejects_missing_or_ambiguous_anchor(self):
        for source in ('nothing', 'same same'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                patch.replace_once(source, 'same', 'replacement')

    def test_manifest_rejects_duplicates_unrelated_targets_and_traversal(self):
        original = json.loads(Path(__file__).with_name('deploy-manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(validate_manifest(original)), 6)
        for mutation in ('duplicate', 'target', 'candidate', 'hash'):
            manifest = copy.deepcopy(original)
            if mutation == 'duplicate':
                manifest['files'][1] = copy.deepcopy(manifest['files'][0])
            elif mutation == 'target':
                manifest['files'][0]['destination'] = '/etc/energetica-whatsapp.env'
            elif mutation == 'candidate':
                manifest['files'][0]['candidate'] = '../other.py'
            else:
                manifest['files'][0]['before_sha256'] = 'wrong'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_manifest(manifest)

    def test_health_accepts_actual_worker_plain_ok_and_bridge_json(self):
        worker, channel = io.BytesIO(b'ok'), io.BytesIO(b'{"status":"ok","channel":"generic"}')
        worker.status = channel.status = 200
        with mock_patch.object(deployment.subprocess, 'run'), mock_patch.object(deployment, 'urlopen', side_effect=[worker, channel]):
            deployment.health()

    def test_health_rejects_wrong_payload_or_failed_status(self):
        for body, status in [(b'not healthy', 200), (b'ok', 503)]:
            response = io.BytesIO(body)
            response.status = status
            with self.subTest(body=body), mock_patch.object(deployment.subprocess, 'run'), mock_patch.object(deployment, 'urlopen', return_value=response), self.assertRaises((RuntimeError, ValueError)):
                deployment.health()


if __name__ == '__main__':
    unittest.main()
