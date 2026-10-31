"""Compaction uses synthetic conversations and fake runners; no provider is contacted."""
import base64
import copy
import importlib.util
from io import StringIO
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('compaction_design_tutor', Path(__file__).resolve().parents[1] / 'scripts/tutor.py')
tutor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tutor)


def wait(store, ident='drawing-one'):
    for _ in range(400):
        thread = store.read(ident)
        if thread['turns'][-1]['status'] != 'thinking':
            return thread
        time.sleep(.01)
    raise AssertionError('Worker did not finish')


def checkpoint(ident='cp1', prior=()):
    return {'checkpointId': ident, 'priorCheckpointIds': list(prior), 'futureExcluded': True,
            'focus': {'x': 10, 'y': 20, 'width': 100, 'height': 100},
            'scene': {'elements': [{'id': 'visible', 'text': 'CURRENT CANVAS'}]}}


def payload(revision=0, **extra):
    return dict(id='drawing-one', revision=revision, question='LATEST QUESTION', provider='chatgpt',
                effort='medium', context=checkpoint(), **extra)


def seed(store, *, count=9, answer_size=60_000, snapshot_size=0, ident='drawing-one'):
    turns = [{'id': f'old-{index}', 'question': f'Question {index}',
              'answer': f'Important decision {index}. ' + 'a' * answer_size,
              'provider': 'chatgpt', 'effort': 'low', 'createdAt': index, 'status': 'complete',
              'context': {**checkpoint(), 'snapshot': 's' * snapshot_size}}
             for index in range(count)]
    thread = {'id': ident, 'revision': 7, 'turns': turns}
    with store.connect() as db:
        store.write(db, thread)
    return copy.deepcopy(thread)


class CompactionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_saved_snapshots_over_old_limit_do_not_block_or_discard_history(self):
        calls = []
        def runner(provider, effort, prompt, *args):
            calls.append(json.loads(prompt))
            return 'A small next step.'
        store = tutor.TutorStore(self.root, runner)
        original = seed(store, count=3, answer_size=20, snapshot_size=600_000)
        self.assertGreater(len(json.dumps(original)), 1_500_000)
        store.ask(payload(original['revision']))
        result = wait(store)
        self.assertEqual(result['turns'][-1]['status'], 'complete')
        self.assertEqual(result['turns'][:-1], original['turns'])
        self.assertEqual(len(calls), 1, 'old snapshots already stay out of the provider prompt')
        self.assertEqual(len(calls[0]['conversation']), 4)
        self.assertLess(len(json.dumps(calls[0])) + len(tutor.INSTRUCTIONS), tutor.PROMPT_LIMIT)
        self.assertEqual(tutor.TutorStore(self.root, runner).read('drawing-one'), result)
        self.assertTrue(all('context' not in turn for turn in store.public('drawing-one')['turns']))

    def test_large_history_is_summarized_in_bounded_chunks_and_keeps_current_context_and_image(self):
        summaries = []; answers = []
        def runner(provider, effort, prompt, image, work, cancel):
            data = json.loads(prompt)
            self.assertEqual((provider, effort), ('chatgpt', 'medium'))
            if data.get('task') == 'compact_conversation':
                self.assertIsNone(image)
                self.assertTrue(work.name.startswith('compact-'))
                self.assertLessEqual(len(data['historyChunk']), tutor.SUMMARY_CHUNK_LIMIT)
                summaries.append(data)
                return 'Retained constraints and imported tool result.'
            answers.append((data, image.read_bytes()))
            return 'Continue with the agreed design.'
        store = tutor.TutorStore(self.root, runner)
        original = seed(store)
        original['turns'][0]['context']['codexHandoff'] = {'history': [{'type': 'tool_result', 'output': 'IMPORTED TOOL RESULT'}]}
        with store.connect() as db:
            store.write(db, original)
        raw = b'\x89PNG\r\n\x1a\ncurrent visible screenshot'
        request = payload(original['revision'], image='data:image/png;base64,' + base64.b64encode(raw).decode())
        store.ask(request)
        result = wait(store)
        self.assertEqual(result['turns'][-1]['status'], 'complete')
        self.assertTrue(result['turns'][-1]['compacted'])
        self.assertNotIn('compacting', result['turns'][-1])
        self.assertEqual(result['turns'][:-1], original['turns'])
        self.assertGreater(len(summaries), 1)
        self.assertIn('IMPORTED TOOL RESULT', ''.join(item['historyChunk'] for item in summaries))
        self.assertNotIn('LATEST QUESTION', json.dumps(summaries))
        self.assertNotIn('CURRENT CANVAS', json.dumps(summaries))
        self.assertEqual(summaries[1]['summary'], 'Retained constraints and imported tool result.')
        self.assertEqual(len(answers), 1)
        sent, image = answers[0]
        self.assertEqual(image, raw)
        self.assertEqual(sent['conversation'][0], {'summary': 'Retained constraints and imported tool result.'})
        self.assertEqual(sent['conversation'][-1]['question'], request['question'])
        self.assertEqual(sent['conversation'][-1]['context'], request['context'])
        self.assertEqual(sent['conversation'][-2]['answer'], original['turns'][-1]['answer'])
        self.assertEqual(sent['conversation'][-3]['answer'], original['turns'][-2]['answer'])
        self.assertLess(len(json.dumps(sent)) + len(tutor.INSTRUCTIONS), tutor.PROMPT_LIMIT)
        self.assertEqual((self.root / (result['turns'][-1]['id'] + '.png')).read_bytes(), raw)

    def test_summary_cache_survives_reload_provider_switch_retry_and_followups(self):
        summaries = []; answers = []
        def runner(provider, effort, prompt, image, work, cancel):
            data = json.loads(prompt)
            if data.get('task') == 'compact_conversation':
                summaries.append(data)
                return 'Cached continuity summary.'
            answers.append(data)
            raise ValueError('Temporary provider failure')
        store = tutor.TutorStore(self.root, runner)
        original = seed(store)
        store.ask(payload(original['revision']))
        failed = wait(store)
        self.assertEqual(failed['turns'][-1]['status'], 'error')
        summary_count = len(summaries)
        recovered_answer = 'Recovered ' + 'b' * 20_000
        def recovered(provider, effort, prompt, image, work, cancel):
            data = json.loads(prompt)
            if data.get('task') == 'compact_conversation':
                summaries.append(data)
                return 'Updated continuity summary.'
            answers.append(data)
            return recovered_answer
        store = tutor.TutorStore(self.root, recovered)
        request = payload(failed['revision'], retry=failed['turns'][-1]['id'])
        request.update(provider='claude', effort='low', context={'must': 'not replace saved context'})
        store.ask(request)
        complete = wait(store)
        self.assertEqual(complete['turns'][-1]['answer'], recovered_answer)
        self.assertEqual(len(summaries), summary_count, 'retry uses the durable cached summary')
        self.assertEqual(len(complete['turns']), len(original['turns']) + 1)
        self.assertEqual(answers[-1]['conversation'][-1]['context'], failed['turns'][-1]['context'])
        self.assertEqual(answers[-1]['conversation'][0]['summary'], 'Cached continuity summary.')
        store.ask(payload(complete['revision']))
        wait(store)
        self.assertGreater(len(summaries), summary_count)
        self.assertEqual(summaries[summary_count]['summary'], 'Cached continuity summary.')
        self.assertNotIn('Question 0', summaries[summary_count]['historyChunk'])

    def test_future_checkpoint_history_and_handoffs_never_enter_earlier_compaction_or_reuse(self):
        calls = []
        def runner(provider, effort, prompt, *args):
            data = json.loads(prompt); calls.append(data)
            if data.get('task') == 'compact_conversation':
                return 'FUTURE SECRET' if 'FUTURE SECRET' in prompt else 'Earlier decisions only.'
            return 'A next step.'
        store = tutor.TutorStore(self.root, runner)
        original = seed(store)
        future = copy.deepcopy(original['turns'][0])
        future.update(id='future', question='FUTURE SECRET')
        future['context'] = {**checkpoint('cp5', ['cp1', 'cp2', 'cp3', 'cp4']),
                             'codexHandoff': {'history': [{'content': 'FUTURE HANDOFF'}]}}
        original['turns'].insert(0, future)
        # A checkpoint ID alone is insufficient if that turn saw later checkpoints.
        indirect = copy.deepcopy(future)
        indirect.update(id='indirect-future', question='INDIRECT FUTURE')
        indirect['context'] = checkpoint('cp1', ['cp4'])
        original['turns'].insert(1, indirect)
        with store.connect() as db:
            store.write(db, original)
        request = payload(original['revision']); request['context'] = checkpoint('cp5', ['cp1', 'cp2', 'cp3', 'cp4'])
        store.ask(request); later = wait(store)
        self.assertIn('FUTURE SECRET', json.dumps(calls))
        calls.clear()
        request = payload(later['revision']); request['context'] = checkpoint('cp3', ['cp1', 'cp2'])
        store.ask(request); earlier = wait(store)
        self.assertEqual(earlier['turns'][-1]['status'], 'complete')
        self.assertTrue(any(item.get('task') == 'compact_conversation' for item in calls))
        for secret in ('FUTURE SECRET', 'FUTURE HANDOFF', 'INDIRECT FUTURE'):
            self.assertNotIn(secret, json.dumps(calls))
        self.assertEqual(calls[-1]['conversation'][0]['summary'], 'Earlier decisions only.')
        self.assertEqual(earlier['turns'][:len(original['turns'])], original['turns'])
        calls.clear()
        other = seed(store, ident='other-attempt')
        store.ask({**payload(other['revision']), 'id': 'other-attempt'}); wait(store, 'other-attempt')
        self.assertTrue(any(item.get('task') == 'compact_conversation' for item in calls), 'cache is isolated per attempt')

    def test_cancellation_and_conflicts_during_compaction_keep_a_retryable_question(self):
        started = threading.Event(); calls = []
        def runner(provider, effort, prompt, image, work, cancel):
            calls.append(json.loads(prompt)); started.set()
            cancel.wait(3)
            raise ValueError('Stopped')
        store = tutor.TutorStore(self.root, runner)
        original = seed(store)
        store.ask(payload(original['revision']))
        self.assertTrue(started.wait(2))
        running = store.public('drawing-one')
        self.assertTrue(running['turns'][-1]['compacting'])
        with self.assertRaisesRegex(ValueError, 'Conversation changed'):
            store.ask(payload(original['revision']))
        with self.assertRaisesRegex(ValueError, 'already running'):
            store.ask(payload(running['revision']))
        store.cancel('drawing-one'); stopped = wait(store)
        self.assertEqual(stopped['turns'][-1]['status'], 'error')
        self.assertNotIn('compacting', stopped['turns'][-1])
        self.assertEqual(stopped['turns'][:-1], original['turns'])
        self.assertEqual(len(calls), 1)
        store.runner = lambda *args: 'Recovered summary or answer'
        store.ask(payload(stopped['revision'], retry=stopped['turns'][-1]['id']))
        recovered = wait(store)
        self.assertEqual(recovered['turns'][-1]['status'], 'complete')
        self.assertEqual(len(recovered['turns']), len(stopped['turns']))

    def test_invalid_summary_never_replaces_saved_history_and_can_be_retried(self):
        for index, bad_summary in enumerate(('', 'x' * (tutor.SUMMARY_LIMIT + 1))):
            with self.subTest(size=len(bad_summary)):
                store = tutor.TutorStore(self.root / str(index), lambda *args: bad_summary)
                original = seed(store)
                store.ask(payload(original['revision'])); failed = wait(store)
                self.assertEqual(failed['turns'][-1]['status'], 'error')
                self.assertIn('compaction could not finish', failed['turns'][-1]['error'])
                self.assertEqual(failed['turns'][:-1], original['turns'])
                store.runner = lambda *args: 'Valid summary or answer'
                store.ask(payload(failed['revision'], retry=failed['turns'][-1]['id']))
                self.assertEqual(wait(store)['turns'][-1]['status'], 'complete')

    def test_imported_session_that_fits_does_not_compact_on_first_small_followup(self):
        link = 'codex://threads/00000000-0000-0000-0000-000000000000'
        handoff = {'link': link, 'threadId': 'desktop', 'recordCount': 74, 'missingImages': 0,
                   'history': [{'type': 'function_call_output', 'output': 'Saved tool result. ' * 220}
                               for _ in range(74)]}
        self.assertGreater(len(json.dumps(handoff)), 120_000)
        calls = []
        def runner(provider, effort, prompt, *args):
            data = json.loads(prompt); calls.append(data)
            self.assertNotIn('task', data, 'a handoff that fits should be sent intact')
            return 'One small next step.'
        store = tutor.TutorStore(self.root, runner, session_loader=lambda _: handoff)
        request = payload(); request['question'] = link
        store.ask(request); first = wait(store)
        store.ask(payload(first['revision'])); followup = wait(store)
        self.assertEqual(followup['turns'][-1]['status'], 'complete')
        self.assertEqual(len(calls), 2)
        for data in calls:
            self.assertEqual(data['conversation'][0]['codexHandoff'], handoff)
            self.assertLess(len(json.dumps(data)) + len(tutor.INSTRUCTIONS), tutor.PROMPT_LIMIT)
        self.assertEqual(followup['turns'][0]['context']['codexHandoff'], handoff)
        self.assertFalse(any(turn.get('compacted') for turn in followup['turns']))
        # An already-saved failure from the old threshold can use the existing
        # Retry action after an update, retaining its question and attachment.
        followup['turns'][-1].update(status='error', error='Conversation compaction could not finish.')
        followup['turns'][-1].pop('answer')
        with store.connect() as db:
            store.write(db, followup)
        store = tutor.TutorStore(self.root, runner, session_loader=lambda _: self.fail('must use saved handoff'))
        store.ask(payload(followup['revision'], retry=followup['turns'][-1]['id']))
        recovered = wait(store)
        self.assertEqual(recovered['turns'][-1]['status'], 'complete')
        self.assertEqual(len(recovered['turns']), 2)
        self.assertEqual(calls[-1]['conversation'][0]['codexHandoff'], handoff)

    def test_large_first_handoff_is_compacted_once_and_reused_on_followup(self):
        link = 'codex://threads/00000000-0000-0000-0000-000000000000'
        handoff = {'link': link, 'threadId': 'desktop', 'recordCount': 1, 'missingImages': 0,
                   'history': [{'type': 'function_call_output', 'output': 'IMPORTED DECISION ' * 30_000}]}
        summaries = []; answers = []
        def runner(provider, effort, prompt, *args):
            data = json.loads(prompt)
            if data.get('task') == 'compact_conversation':
                summaries.append(data)
                return 'The imported decision is retained.'
            answers.append(data)
            return 'One next step.'
        store = tutor.TutorStore(self.root, runner, session_loader=lambda _: handoff)
        request = payload(); request['question'] = link
        store.ask(request); first = wait(store)
        self.assertEqual(first['turns'][-1]['status'], 'complete')
        self.assertTrue(first['turns'][-1]['compacted'])
        self.assertEqual(first['turns'][0]['context']['codexHandoff'], handoff)
        self.assertIn('IMPORTED DECISION', ''.join(data['historyChunk'] for data in summaries))
        count = len(summaries)
        # Reloads use the saved reference snapshot and derived summary, without
        # opening the desktop session again or making another summary request.
        store = tutor.TutorStore(self.root, runner, session_loader=lambda _: self.fail('must use saved handoff'))
        store.ask(payload(first['revision'])); followup = wait(store)
        self.assertEqual(followup['turns'][-1]['status'], 'complete')
        self.assertEqual(len(summaries), count)
        for data in answers:
            self.assertEqual(data['conversation'][0], {'summary': 'The imported decision is retained.'})
            self.assertLess(len(json.dumps(data)) + len(tutor.INSTRUCTIONS), tutor.PROMPT_LIMIT)
            self.assertEqual(data['conversation'][-1]['context'], checkpoint())

    def test_current_context_counts_toward_compaction_budget(self):
        calls = []
        def runner(provider, effort, prompt, *args):
            data = json.loads(prompt); calls.append(data)
            return 'Saved decisions.' if data.get('task') else 'Next step.'
        store = tutor.TutorStore(self.root, runner)
        original = seed(store, count=3, answer_size=70_000)
        request = payload(original['revision'])
        request['context']['scene']['elements'][0]['text'] = 'CURRENT CANVAS ' * 18_000
        store.ask(request); complete = wait(store)
        self.assertEqual(complete['turns'][-1]['status'], 'complete')
        self.assertTrue(complete['turns'][-1]['compacted'])
        self.assertEqual(calls[-1]['conversation'][-1]['context'], request['context'])
        self.assertLess(len(json.dumps(calls[-1])) + len(tutor.INSTRUCTIONS), tutor.PROMPT_LIMIT)
        self.assertNotIn('CURRENT CANVAS', json.dumps(calls[:-1]))

    def test_overlong_summary_is_retried_without_truncating_or_replacing_history(self):
        summaries = []
        def runner(provider, effort, prompt, *args):
            data = json.loads(prompt)
            if data.get('task') == 'compact_conversation':
                summaries.append(data)
                return 'x' * (tutor.SUMMARY_LIMIT + 1) if len(summaries) == 1 else 'Concise retained decisions.'
            return 'Continue safely.'
        store = tutor.TutorStore(self.root, runner)
        original = seed(store)
        store.ask(payload(original['revision'])); complete = wait(store)
        self.assertEqual(complete['turns'][-1]['status'], 'complete')
        self.assertEqual(complete['turns'][:-1], original['turns'])
        self.assertEqual(summaries[1]['historyChunk'], summaries[0]['historyChunk'])
        self.assertEqual(summaries[1]['summary'], summaries[0]['summary'])
        self.assertIn('6,000 characters', summaries[1]['instruction'])

    def test_summary_cli_requests_use_dedicated_instructions_for_every_provider(self):
        for provider in tutor.PROVIDERS:
            with self.subTest(provider=provider):
                work = self.root / provider; work.mkdir()
                event = {'chatgpt': {'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'Summary.'}},
                         'claude': {'type': 'result', 'result': 'Summary.'}, 'gemini': {'response': 'Summary.'}}[provider]
                captured = []
                def popen(args, **kwargs):
                    captured.extend(args)
                    kwargs['stdout'].write(json.dumps(event) + '\n'); kwargs['stdout'].flush()
                    return SimpleNamespace(stdin=StringIO(), poll=lambda: 0, returncode=0)
                auth = SimpleNamespace(stdout='ChatGPT' if provider == 'chatgpt' else '{"authMethod":"claude.ai"}', stderr='')
                with patch.object(tutor, 'clean_env', return_value={}), patch.object(tutor.Path, 'home', return_value=self.root), \
                        patch.object(tutor.subprocess, 'run', return_value=auth), patch.object(tutor.subprocess, 'Popen', side_effect=popen):
                    result = tutor.run_provider(provider, 'medium', json.dumps({'task': 'compact_conversation',
                                                'summary': '', 'historyChunk': 'Earlier decisions.'}), None, work, threading.Event())
                self.assertEqual(result, 'Summary.')
                instructions = ' '.join(captured)
                self.assertIn('6,000 characters', instructions)
                self.assertNotIn('Hello Interview', instructions)
                self.assertNotIn('default to 1–3 short sentences', instructions)


    def test_conversation_only_followup_omits_canvas_and_keeps_checkpoint_history_and_retry(self):
        tmp_path = self.root
        prompts = []; images = []
        def runner(provider, effort, prompt, image, *args):
            prompts.append(json.loads(prompt)); images.append(image.read_bytes() if image else None)
            if len(prompts) == 3:
                raise ValueError('Temporary failure')
            return 'Use the same idempotency key.'
        store = tutor.TutorStore(tmp_path, runner)
        first = payload()
        first['context'] = {'checkpointId': 'cp1', 'priorCheckpointIds': [], 'futureExcluded': True,
                            'scene': {'elements': [{'text': 'CANVAS SNAPSHOT'}]}}
        raw = b'\x89PNG\r\n\x1a\ncurrent canvas'
        first['image'] = 'data:image/png;base64,' + base64.b64encode(raw).decode()
        store.ask(first); saved = wait(store, 'drawing-one')
        future = payload(saved['revision'])
        future.update(question='FUTURE SECRET', context={'checkpointId': 'cp5', 'priorCheckpointIds': ['cp1', 'cp2', 'cp3', 'cp4'], 'futureExcluded': True})
        store.ask(future); saved = wait(store, 'drawing-one')
        followup = payload(saved['revision'])
        followup.update(question='Quoted tutor response:\n> Use the same idempotency key.\n\nClarify',
                        context={'checkpointId': 'cp3', 'priorCheckpointIds': ['cp1', 'cp2'], 'futureExcluded': True,
                                 'captureMode': 'conversation-only'}, image=None)
        store.ask(followup); failed = wait(store, 'drawing-one')
        assert failed['turns'][-1]['status'] == 'error'
        retry = payload(failed['revision'], retry=failed['turns'][-1]['id'])
        store.ask(retry); complete = wait(store, 'drawing-one')
        assert complete['turns'][-1]['status'] == 'complete'
        assert complete['turns'][:-1] == saved['turns']
        assert len(complete['turns']) == 3
        assert images == [raw, None, None, None]
        for prompt in prompts[-2:]:
            assert prompt['conversation'][0]['answer'] == 'Use the same idempotency key.'
            assert prompt['conversation'][-1]['context'] == followup['context']
            assert 'FUTURE SECRET' not in json.dumps(prompt)
            assert 'CANVAS SNAPSHOT' not in json.dumps(prompt)
        assert (tmp_path / (saved['turns'][0]['id'] + '.png')).read_bytes() == raw


if __name__ == '__main__':
    unittest.main()
