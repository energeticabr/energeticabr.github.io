"""Run real workflow/channel tests with a private backend and synthetic records."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

root = Path(os.environ['PER_PAYMENT_SOURCE']).resolve()
package = Path(__file__).resolve().parents[1]
repo = package.parents[1]
sys.path[:0] = list(map(str, [root/'worker', root, root/'tests', package/'tests',
    repo/'backend-patches/launch-payroll-per-payment',
    repo/'backend-patches/provision-contractor-payroll/tests',
    repo/'backend-patches/payroll-batch-assignment/tests']))

with tempfile.TemporaryDirectory() as temporary:
    tempfile.tempdir = temporary
    import provision_attachment_sync
    provision_attachment_sync.STATE_DIR = Path(temporary)/'sync'
    # Pin the requested source before archived fixtures add their own paths.
    import workflow
    print('Workflow under test:', workflow.__file__)
    import test_attachments
    import test_channel
    import test_batch_assignment
    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(test_attachments.LaunchPayrollAttachmentTests),
        test_channel.Integration('test_collective_submission_copies_only_each_launch_files'),
        test_channel.Integration('test_collective_attachment_failure_resumes_remaining_without_recreating_rows')])
    if '--existing' in sys.argv:
        suite.addTests(test_channel.Integration(name)
                       for name in test_batch_assignment.BatchAssignmentTests.__dict__
                       if name.startswith('test_'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
