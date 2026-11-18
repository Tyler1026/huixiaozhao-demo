"""Disconnected clients must not trigger a second response or lose committed results."""
import io
import unittest
from unittest.mock import Mock, patch

from backend.auth_routes import respond
from backend.funnel_route import serve_funnel
from tests.test_topic_priorities_route import Handler


class DisconnectDeliveryTests(unittest.TestCase):
    def test_json_reply_handles_a_browser_closed_after_the_operation(self):
        for failure in (BrokenPipeError, ConnectionResetError):
            handler = Mock()
            handler.wfile.write.side_effect = failure()
            respond(handler, 200, {'ok': True})
            handler.send_response.assert_called_once_with(200)
            handler.wfile.write.assert_called_once()

    def test_funnel_disconnect_preserves_exact_committed_state(self):
        for phase in ('initial', 'result', 'error'):
            with self.subTest(phase=phase):
                handler = Handler()
                events = []
                class Stream(io.BytesIO):
                    def write(self, value):
                        if phase == 'initial' or phase == 'result' and b'finish_reason' in value or phase == 'error' and b'"error"' in value:
                            raise BrokenPipeError()
                        return super().write(value)
                handler.wfile = Stream()
                def build(context, complete, **options):
                    if phase == 'error':
                        raise ValueError('upstream')
                    return {'companies': [{'name': 'offline fixture'}], 'status': 'completed'}
                with patch('backend.funnel_route.require_session', return_value=handler._principal), patch(
                    'backend.access_control.scoped_sync_view', side_effect=lambda state, principal: state
                ):
                    serve_funnel(handler, {'projectKey': 'p', 'topic': handler.data['PROJECTS']['p']['topic']},
                                 complete=lambda *args: None, audit=events.append, build=build)
                self.assertEqual(handler.writes, 1 if phase == 'result' else 0)
                self.assertEqual(events[-1]['outcome'], 'client_disconnected')
                self.assertEqual(events[-1]['persisted'], phase == 'result')
