import unittest
try:
    import install
except ModuleNotFoundError:
    install = None


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(install, 'hash-pinned installer is not implemented')

    def test_rejects_unknown_base_before_creating_candidate(self):
        with self.assertRaises(RuntimeError):
            install.candidate('print("unexpected source")\n')

    def test_rejects_ambiguous_anchor(self):
        with self.assertRaises(RuntimeError):
            install.candidate(install.ANCHOR * 2)

    def test_authenticated_hook_dispatches_and_preserves_existing_action(self):
        source = 'class Handler:\n    def run(self, action, identity, body, origin):\n        if True:\n            if True:\n' + install.ANCHOR + '                    return "existing"\n'
        namespace = {}
        exec(install.candidate(source), namespace)
        handler = namespace['Handler']()
        self.assertEqual(handler.run('dda_refresh', {}, {}, ''), 'existing')
        self.assertIsNone(handler.run('unrelated', {}, {}, ''))


if __name__ == '__main__':
    unittest.main()
