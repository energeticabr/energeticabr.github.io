import unittest
from unittest.mock import Mock

from icsee_source import run_live_source


class CaptureError(Exception):
    pass


class CameraSourceTest(unittest.TestCase):
    def test_preview_reopens_once_after_the_source_ends(self):
        for first in ("finished", CaptureError()):
            with self.subTest(first=first):
                play = Mock(side_effect=[first, "reconnected"])
                reset = Mock()
                stop = Mock()
                stop.is_set.return_value = False
                stop.wait.return_value = False
                result = run_live_source(play, reset, stop, preview=True, capture_error=CaptureError)
                self.assertEqual(result, "reconnected")
                self.assertEqual(play.call_count, 2)
                reset.assert_called_once_with()

    def test_stop_and_single_view_preserve_the_first_result(self):
        for preview in (False, True):
            with self.subTest(preview=preview):
                play = Mock(return_value="finished")
                reset = Mock()
                stop = Mock()
                stop.wait.return_value = True
                result = run_live_source(play, reset, stop, preview=preview, capture_error=CaptureError)
                self.assertEqual(result, "finished")
                play.assert_called_once_with()
                reset.assert_not_called()
