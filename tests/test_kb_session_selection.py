import io
import json
import math
import unittest
from unittest.mock import Mock

from backend.sync_route import SyncDependencies, _chat_selection, handle_sync


class KbSessionSelectionTests(unittest.TestCase):
    def merge(self, old, incoming, tombs=None):
        state = {'PROJECTS': {'a': {'city': '闵行'}, 'b': {'city': '闵行'}}, 'KB_CHAT': old}
        writes = []
        payload = {'KB_CHAT': incoming}
        if tombs:
            payload['KB_CHAT_TOMBS'] = tombs
        deps = SyncDependencies(True, lambda: json.dumps(state), lambda v: writes.append(json.loads(v)) or True,
                                'unused', lambda: None, lambda v: v)
        responder = Mock(wfile=io.BytesIO())
        handle_sync(responder, json.dumps(payload).encode(), deps)
        self.assertEqual(json.loads(responder.wfile.getvalue()), {'ok': True})
        return writes[-1]['KB_CHAT']

    def test_newer_selection_survives_stale_longer_snapshot_in_both_orders(self):
        older = {'sessions': [{'id': 's1', 'ts': 1, 'messages': [{'text': 'longer'}]}, {'id': 's2', 'messages': []}], 'activeId': 's1', 'selectedAt': 10}
        newer = {'sessions': [{'id': 's2', 'messages': []}], 'activeId': 's2', 'selectedAt': 20}
        for a, b in ((older, newer), (newer, older)):
            result = self.merge({'workspace:a': a}, {'workspace:a': b})['workspace:a']
            self.assertEqual((result['activeId'], result['selectedAt']), ('s2', 20))
            self.assertEqual(next(s for s in result['sessions'] if s['id'] == 's1')['messages'], [{'text': 'longer'}])

    def test_selection_update_does_not_remove_other_workspace_or_transcript(self):
        other = {'sessions': [{'id': 'secret-b', 'messages': [{'text': 'workspace b'}]}], 'activeId': 'secret-b', 'selectedAt': 99}
        result = self.merge({'workspace:a': {'sessions': [{'id': 's', 'messages': [{'text': 'original'}]}]}, 'workspace:b': other},
                            {'workspace:a': {'sessions': [{'id': 's', 'messages': []}], 'activeId': 's', 'selectedAt': 100}})
        self.assertEqual(result['workspace:b'], other)
        self.assertEqual(result['workspace:a']['sessions'][0]['messages'], [{'text': 'original'}])

    def test_deleted_session_cannot_be_selected_or_resurrected(self):
        sessions = [{'id': 'dead', 'messages': []}, {'id': 'live', 'messages': []}]
        result = self.merge({'workspace:a': {'sessions': sessions, 'activeId': 'live', 'selectedAt': 10}},
                            {'workspace:a': {'sessions': sessions, 'activeId': 'dead', 'selectedAt': 999}},
                            {'workspace:a::dead': 123})['workspace:a']
        self.assertEqual(result['activeId'], 'live')
        self.assertEqual([s['id'] for s in result['sessions']], ['live'])

    def test_legacy_missing_timestamp_prefers_valid_incoming(self):
        sessions = [{'id': 'a'}, {'id': 'b'}]
        self.assertEqual(_chat_selection({'activeId': 'a'}, {'activeId': 'b'}, sessions), {'activeId': 'b', 'selectedAt': 0})
        self.assertEqual(_chat_selection({'activeId': 'a', 'selectedAt': 5}, {'activeId': 'bad', 'selectedAt': 100}, sessions)['activeId'], 'a')

    def test_invalid_timestamp_cannot_override_valid_selection(self):
        for invalid in (math.nan, math.inf, -1, True, '1000', None):
            self.assertEqual(_chat_selection({'activeId': 'a', 'selectedAt': 2}, {'activeId': 'b', 'selectedAt': invalid}, [{'id': 'a'}, {'id': 'b'}])['activeId'], 'a')

    def test_equal_positive_timestamps_tie_break_deterministically(self):
        a = {'activeId': 'a', 'selectedAt': 100}
        b = {'activeId': 'b', 'selectedAt': 100}
        self.assertEqual(_chat_selection(a, b, [{'id': 'a'}, {'id': 'b'}]), _chat_selection(b, a, [{'id': 'a'}, {'id': 'b'}]))


if __name__ == '__main__':
    unittest.main()
