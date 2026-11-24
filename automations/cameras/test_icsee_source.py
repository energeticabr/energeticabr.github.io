import unittest
from unittest.mock import Mock

from icsee_source import run_guarded_live_attempt, run_live_source


class CaptureError(Exception):
    pass


class CameraSourceTest(unittest.TestCase):
    def test_preview_reopens_once_after_the_source_ends(self):
        for first in ("finished", CaptureError()):
            with self.subTest(first=first):
                play = Mock(side_effect=[first, "reconnected"])
                stop = Mock()
                stop.is_set.return_value = False
                stop.wait.return_value = False
                result = run_live_source(play, stop, can_reconnect=lambda: True, capture_error=CaptureError)
                self.assertEqual(result, "reconnected")
                self.assertEqual(play.call_count, 2)

    def test_stop_and_single_view_preserve_the_first_result(self):
        for preview in (False, True):
            with self.subTest(preview=preview):
                play = Mock(return_value="finished")
                stop = Mock()
                stop.wait.return_value = True
                result = run_live_source(play, stop, can_reconnect=lambda: preview, capture_error=CaptureError)
                self.assertEqual(result, "finished")
                play.assert_called_once_with()

    def test_preview_that_produced_no_video_does_not_retry(self):
        play = Mock(side_effect=CaptureError())
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = False
        with self.assertRaises(CaptureError):
            run_live_source(play, stop, can_reconnect=lambda: False, capture_error=CaptureError)
        play.assert_called_once_with()

    def test_old_attempt_cannot_write_or_cancel_a_new_attempt(self):
        def first(receive, stopped):
            self.assertTrue(receive(b"first", "key"))
            return receive, stopped

        forward = Mock(return_value=True)
        old_receive, old_stop = run_guarded_live_attempt(first, forward)

        def second(receive, stopped):
            self.assertTrue(old_stop.is_set())
            self.assertFalse(stopped.is_set())
            self.assertFalse(old_receive(b"late", "key"))
            self.assertTrue(receive(b"second", "key"))

        run_guarded_live_attempt(second, forward)
        self.assertEqual([call.args[0] for call in forward.call_args_list], [b"first", b"second"])
