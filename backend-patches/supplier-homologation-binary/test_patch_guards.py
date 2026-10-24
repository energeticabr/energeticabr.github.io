"""Scope and fail-closed safety checks; filesystem changes use temporary dirs."""
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch as mock_patch
import patch_backend as patch
import deploy as deployment

SOURCE = Path(os.environ['HOMOLOGATION_CAPTURE_DIR'])


class PatchGuardTests(unittest.TestCase):
    def config(self):
        return json.loads((SOURCE / 'workflow_config.json').read_text(encoding='utf-8'))

    def test_only_the_homologation_step_changes_and_original_config_is_not_mutated(self):
        original = self.config()
        saved = copy.deepcopy(original)
        changed = patch.patch_config(original)
        steps = changed['sharepoint'][patch.FLOW]['steps']
        target = next(step for step in steps if step['key'] == patch.KEY)
        self.assertNotIn('confirm_recommended', target)
        # Put back only the reviewed step: everything else must be byte-equivalent as data.
        index = next(i for i, step in enumerate(steps) if step['key'] == patch.KEY)
        steps[index] = saved['sharepoint'][patch.FLOW]['steps'][index]
        self.assertEqual(changed, saved)
        self.assertEqual(original, saved)

    def test_config_drift_duplicate_and_already_patched_sources_are_rejected(self):
        for kind in ['target', 'duplicate', 'ids', 'branch', 'patched']:
            config = self.config()
            steps = config['sharepoint'][patch.FLOW]['steps']
            step = next(item for item in steps if item['key'] == patch.KEY)
            if kind == 'target':
                step['target_field'] = 'FORNECEDOR'
            elif kind == 'duplicate':
                steps.append(copy.deepcopy(step))
            elif kind == 'ids':
                step['source']['default']['options'][0]['value'] = 'SIM'
            elif kind == 'branch':
                step['source']['branches'][0]['when']['equals'] = 'NÃO'
            else:
                config = patch.patch_config(config)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                patch.patch_config(config)

    def test_workflow_patch_does_not_touch_code_outside_the_selection_handler(self):
        for name in ['workflow-app.py', 'workflow.py']:
            source = (SOURCE / name).read_text(encoding='utf-8')
            changed = patch.patch_workflow(source)
            start = source.index('    def _handle_selection_reply(')
            end = source.index('\n    def ', start + 1)
            changed_end = changed.index('\n    def ', start + 1)
            self.assertEqual(changed[:start], source[:start])
            self.assertEqual(changed[changed_end:], source[end:])
            with self.assertRaises(ValueError):
                patch.patch_workflow(changed)

    def test_generator_refuses_source_drift_before_creating_any_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in patch.BEFORE:
                (root / name).write_bytes((SOURCE / name).read_bytes())
            with (root / 'workflow.py').open('ab') as stream:
                stream.write(b'\n# concurrent change\n')
            with self.assertRaisesRegex(ValueError, 'drift'):
                patch.generate(root, root / 'candidate')
            self.assertFalse((root / 'candidate').exists())

    def test_manifest_refuses_duplicates_unrelated_targets_path_traversal_and_bad_hashes(self):
        original = json.loads(Path(__file__).with_name('deploy-manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(deployment.validate_manifest(original)), 4)
        for kind in ['duplicate', 'target', 'candidate', 'hash']:
            manifest = copy.deepcopy(original)
            if kind == 'duplicate':
                manifest['files'][1] = copy.deepcopy(manifest['files'][0])
            elif kind == 'target':
                manifest['files'][0]['destination'] = '/etc/energetica-whatsapp.env'
            elif kind == 'candidate':
                manifest['files'][0]['candidate'] = '../other.py'
            else:
                manifest['files'][0]['before_sha256'] = 'wrong'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                deployment.validate_manifest(manifest)

    def test_health_accepts_worker_and_bridge_and_rejects_a_false_ok(self):
        worker, channel = io.BytesIO(b'ok'), io.BytesIO(b'{"status":"ok"}')
        worker.status = channel.status = 200
        with mock_patch.object(deployment.subprocess, 'run'), mock_patch.object(deployment, 'urlopen', side_effect=[worker, channel]):
            deployment.health()
        for body, status in [(b'not healthy', 200), (b'ok', 503)]:
            response = io.BytesIO(body)
            response.status = status
            with self.subTest(body=body), mock_patch.object(deployment.subprocess, 'run'), mock_patch.object(deployment, 'urlopen', return_value=response), self.assertRaises((RuntimeError, ValueError)):
                deployment.health()


if __name__ == '__main__':
    unittest.main()
