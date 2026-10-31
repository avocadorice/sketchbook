"""Handoff fixtures are synthetic; no installed Codex session or CLI is accessed."""
import json
import importlib.util
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('handoff_design_tutor', Path(__file__).resolve().parents[1] / 'scripts/tutor.py')
tutor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tutor)
codex = tutor._handoff
load_session, session_links = codex.load_session, codex.session_links
TutorStore = tutor.TutorStore


def wait(store, ident):
    for _ in range(150):
        thread = store.read(ident)
        if thread['turns'][-1]['status'] != 'thinking':
            return thread
        time.sleep(.01)
    raise AssertionError('Worker did not finish')


def payload(revision=0, **extra):
    return dict(id='drawing-one', revision=revision, question='What is missing?', provider='chatgpt',
                effort='low', context={'scene': {'elements': []}}, **extra)

IDENT = '01a17e5d-23c9-7632-ba1e-f43c55095cd4'
LINK = 'codex://threads/' + IDENT


def rollout(home, records, directory='sessions'):
    path = home / directory / '2026/10/27' / f'rollout-2026-10-27T12-00-00-{IDENT}.jsonl'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(json.dumps(record) for record in [
        {'type': 'session_meta', 'payload': {'id': IDENT, 'cwd': '/unread-workspace'}}, *records]) + '\n')
    return path


def item(kind, **values):
    return {'type': 'response_item', 'payload': {'type': kind, **values}}


class HandoffTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)

    def test_link_extraction_accepts_desktop_paste_and_rejects_paths_and_other_schemes(self):
        assert session_links(f'Continue from ({LINK}). Explain the trade-off.') == [LINK]
        assert session_links(f'{LINK.upper()}/ {LINK}') == [LINK]
        assert session_links('A regular diagram question') == []
        for suffix in ('/../../private', '?file=secret', '/extra'):
            with self.assertRaises(ValueError):
                session_links(LINK + suffix)
        with self.assertRaises(ValueError):
            session_links('codex://threads/not-an-id')
        with self.assertRaises(ValueError):
            session_links(LINK + ' codex://threads/00000000-0000-0000-0000-000000000000')
        with self.assertRaises(ValueError):
            load_session('file:///private/file')


    def test_selected_session_preserves_messages_tools_and_compaction_as_reference_data(self):
        tmp_path = self.home
        directory = "sessions"
        records = [
            item('message', role='developer', content=[{'type': 'input_text', 'text': 'DO NOT IMPORT INSTRUCTIONS'}]),
            item('message', role='user', content=[{'type': 'input_text', 'text': 'Design delivery tracking'}]),
            item('function_call', call_id='tool-1', name='exec_command', arguments='{"cmd":"pytest"}'),
            item('function_call_output', call_id='tool-1', output='3 passed'),
            item('message', role='assistant', content=[{'type': 'output_text', 'text': 'Use idempotency keys.'}]),
            {'type': 'compacted', 'payload': {'message': 'Earlier requirements summary', 'replacement_history': []}},
        ]
        rollout(tmp_path, records, directory)
        # Unrelated malformed files must never be opened.
        (tmp_path / directory / 'unrelated.jsonl').write_text('not json')
        snapshot = load_session(LINK, tmp_path)
        assert snapshot['threadId'] == IDENT and snapshot['recordCount'] == 5
        text = json.dumps(snapshot)
        for expected in ('Design delivery tracking', 'exec_command', '3 passed', 'Use idempotency keys.', 'Earlier requirements summary'):
            assert expected in text
        assert 'DO NOT IMPORT INSTRUCTIONS' not in text
        assert '/unread-workspace' not in text


    def test_images_are_explicitly_unavailable_and_paths_are_never_followed(self):
        tmp_path = self.home
        rollout(tmp_path, [item('message', role='user', content=[
            {'type': 'input_text', 'text': 'Discuss this diagram'},
            {'type': 'input_image', 'image_url': 'file:///unread-workspace/private.png'},
            {'type': 'input_image', 'image_url': 'data:image/png;base64,not-read'},
        ])])
        snapshot = load_session(LINK, tmp_path)
        assert snapshot['missingImages'] == 2
        assert 'attach this image separately' in json.dumps(snapshot)
        assert '/unread-workspace' not in json.dumps(snapshot)
        assert 'base64' not in json.dumps(snapshot)


    def test_event_only_session_fallback_preserves_conversation(self):
        tmp_path = self.home
        rollout(tmp_path, [{'type': 'event_msg', 'payload': {'type': 'user_message', 'message': 'A question'}},
                           {'type': 'event_msg', 'payload': {'type': 'agent_message', 'message': 'An answer'}}])
        snapshot = load_session(LINK, tmp_path)
        assert [item['role'] for item in snapshot['history']] == ['user', 'assistant']

    def test_archived_session_can_be_selected_by_the_same_desktop_link(self):
        rollout(self.home, [item('message', role='user', content='Archived requirements')], 'archived_sessions')
        assert 'Archived requirements' in json.dumps(load_session(LINK, self.home))

    def test_event_mirrors_are_deduplicated_without_losing_a_recent_question(self):
        rollout(self.home, [
            {'type': 'event_msg', 'payload': {'type': 'user_message', 'message': 'First question'}},
            item('message', role='user', content=[{'type': 'input_text', 'text': 'First question'}]),
            item('message', role='assistant', content=[{'type': 'output_text', 'text': 'First answer'}]),
            {'type': 'event_msg', 'payload': {'type': 'agent_message', 'message': 'First answer'}},
            {'type': 'event_msg', 'payload': {'type': 'user_message', 'message': 'Most recent question'}},
        ])
        snapshot = load_session(LINK, self.home)
        assert snapshot['recordCount'] == 3
        assert snapshot['history'][-1]['content'] == 'Most recent question'


    def test_unavailable_incomplete_mismatched_empty_and_oversized_sessions_fail_without_truncation(self):
        tmp_path = self.home
        with self.assertRaisesRegex(ValueError, 'not saved on the host Mac'):
            load_session(LINK, tmp_path)
        path = rollout(tmp_path, [])
        with self.assertRaisesRegex(ValueError, 'no saved conversation'):
            load_session(LINK, tmp_path)
        path.write_text('{partial')
        with self.assertRaisesRegex(ValueError, 'read completely'):
            load_session(LINK, tmp_path)
        path.write_text(json.dumps({'type': 'session_meta', 'payload': {'id': 'different'}}))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            load_session(LINK, tmp_path)
        rollout(tmp_path, [item('message', role='user', content='large question' * 100)])
        with patch.object(codex, 'MAX_CONTEXT_BYTES', 100), self.assertRaisesRegex(ValueError, 'too large to attach intact'):
            load_session(LINK, tmp_path)


    def test_symlinked_rollout_cannot_open_a_file_outside_session_storage(self):
        tmp_path = self.home
        path = rollout(tmp_path, [item('message', role='user', content='allowed')])
        outside = tmp_path / 'outside.jsonl'
        path.rename(outside)
        path.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'not saved on the host Mac'):
            load_session(LINK, tmp_path)

    def test_duplicate_session_copies_and_oversized_files_are_rejected(self):
        records = [item('message', role='user', content='Requirements')]
        rollout(self.home, records)
        with patch.object(codex, 'MAX_SESSION_BYTES', 10), self.assertRaisesRegex(ValueError, 'too large'):
            load_session(LINK, self.home)
        rollout(self.home, records, 'archived_sessions')
        with self.assertRaisesRegex(ValueError, 'More than one saved copy'):
            load_session(LINK, self.home)

    def test_desktop_handoff_is_durable_used_on_followups_and_isolated_by_checkpoint(self):
        tmp_path = self.home
        home = tmp_path / 'synthetic-codex'
        rollout(home, [item('message', role='user', content='DESKTOP REQUIREMENTS'),
                       item('function_call_output', call_id='tool', output='DESKTOP TOOL RESULT')])
        prompts = []
        loads = []
        def loader(link):
            loads.append(link)
            return load_session(link, home)
        def runner(provider, effort, prompt, *args):
            prompts.append(json.loads(prompt))
            return 'Continue with an idempotency key.'
        store = TutorStore(tmp_path / 'tutor', runner, session_loader=loader)
        later = {'checkpointId': 'cp2', 'priorCheckpointIds': ['cp1'], 'futureExcluded': True}
        request = payload(); request.update(question='Continue from ' + LINK, context=later)
        store.ask(request); first = wait(store, 'drawing-one')
        assert len(loads) == 1
        assert 'DESKTOP TOOL RESULT' in json.dumps(prompts[-1])
        public = store.public('drawing-one')['turns'][0]
        assert public['handoff']['recordCount'] == 2
        assert public['handoff']['link'] == LINK
        assert 'context' not in public and 'DESKTOP REQUIREMENTS' not in json.dumps(public)
        # A reload and provider change keep the original saved handoff snapshot.
        store = TutorStore(tmp_path / 'tutor', runner, session_loader=lambda _: self.fail('must not reload desktop files'))
        request = payload(first['revision']); request.update(question='Why that key?', provider='claude', context=later)
        store.ask(request); followup = wait(store, 'drawing-one')
        assert 'DESKTOP REQUIREMENTS' in json.dumps(prompts[-1])
        assert 'DESKTOP TOOL RESULT' in json.dumps(prompts[-1])
        # Earlier checkpoints and independent attempts cannot receive imported future context.
        request = payload(followup['revision']); request['context'] = {'checkpointId': 'cp1', 'priorCheckpointIds': [], 'futureExcluded': True}
        store.ask(request); wait(store, 'drawing-one')
        assert 'DESKTOP REQUIREMENTS' not in json.dumps(prompts[-1])
        request = payload(); request['id'] = 'different-attempt'
        store.ask(request); wait(store, 'different-attempt')
        assert 'DESKTOP REQUIREMENTS' not in json.dumps(prompts[-1])


    def test_handoff_failure_keeps_conversation_unchanged_and_retry_uses_saved_snapshot(self):
        tmp_path = self.home
        loads = []
        def loader(link):
            loads.append(link)
            raise ValueError('Session unavailable')
        store = TutorStore(tmp_path, lambda *args: 'Answer', session_loader=loader)
        request = payload(); request['question'] = LINK
        with self.assertRaisesRegex(ValueError, 'Session unavailable'):
            store.ask(request)
        assert store.read('drawing-one') == {'id': 'drawing-one', 'revision': 0, 'turns': []}
        with self.assertRaisesRegex(ValueError, 'Conversation changed'):
            store.ask({**request, 'revision': 99})
        assert len(loads) == 1
        snapshot = {'link': LINK, 'threadId': 'desktop', 'recordCount': 1, 'missingImages': 0,
                    'history': [{'type': 'message', 'role': 'user', 'content': 'Saved desktop context'}]}
        store.session_loader = lambda _: snapshot
        def fail(*args):
            raise ValueError('Provider unavailable')
        store.runner = fail
        store.ask(request); failed = wait(store, 'drawing-one')
        store.session_loader = lambda _: self.fail('retry must use the saved snapshot')
        prompts = []
        def runner(provider, effort, prompt, *args):
            prompts.append(prompt)
            return 'Recovered'
        store.runner = runner
        store.ask(payload(failed['revision'], retry=failed['turns'][0]['id']))
        retried = wait(store, 'drawing-one')
        assert len(retried['turns']) == 1 and retried['turns'][0]['answer'] == 'Recovered'
        assert 'Saved desktop context' in prompts[-1]

if __name__ == "__main__":
    unittest.main()
