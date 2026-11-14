"""Exercises source grounding, review scheduling and optional wording refinement."""

import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from design_review import ReviewStore
from practice_server import ProjectStore
from tutor import TutorStore


def entry(title, number):
    return {
        'problemId': f'p-{number}', 'drawingId': f'd-{number}',
        'attempt': {'prompt': title, 'chapters': []},
        'draft': {'id': f'checkpoint-{number}', 'scene': {'elements': []}},
    }


def turn(number, question, answer, *, status='complete', checkpoint='checkpoint-1'):
    return {
        'id': f't-{number}', 'question': question, 'answer': answer, 'status': status,
        'createdAt': number, 'context': {
            'checkpointId': checkpoint, 'futureExcluded': True,
            'scene': {'elements': [{'text': 'envelope encryption and wrapped DEK'}]},
        },
    }


@pytest.fixture
def practice(tmp_path):
    project = ProjectStore(tmp_path / 'project.json')
    tutor = TutorStore(tmp_path / 'tutor')
    design = entry('Design encrypted access to Drive', 1)
    other = entry('Design encrypted backup storage', 2)
    notes = entry('Design a job queue', 3)
    notes['draft']['notes'] = 'How do retries avoid duplicate jobs? Use a stable idempotency key to identify repeated submissions.'
    other['draft']['scene']['elements'].append({'text': 'Do not show this future checkpoint'})
    project.save({
        **design,
        'files': {},
        'past': [other, notes],
        'problems': [
            {'id': e['problemId'], 'title': e['attempt']['prompt']} for e in (design, other, notes)
        ],
    }, None)
    with tutor.connect() as db:
        tutor.write(db, {'id': design['drawingId'], 'revision': 1, 'turns': [
            turn(1, 'I am confused about how envelope encryption uses a wrapped DEK.',
                 'The key encryption key wraps the DEK. The DEK encrypts the stored refresh token.'),
            turn(2, 'How does a wrapped DEK protect the refresh token in envelope encryption?',
                 'No, the wrapped DEK alone cannot decrypt the token. The application asks KMS to unwrap it.'),
            turn(3, "I'm ready for the next small step. Continue from where we left off.",
                 'This is a mechanical continuation. It should not become a recall card.'),
            turn(4, 'I am confused about this failed reply.',
                 'This failed reply should never be review material.', status='error'),
        ]})
        tutor.write(db, {'id': other['drawingId'], 'revision': 1, 'turns': [
            turn(5, 'I am still confused. How does a wrapped DEK work in envelope encryption?',
                 'The key encryption key wraps the DEK. Store only the wrapped key in the backup.',
                 checkpoint='checkpoint-2'),
            turn(6, 'What is an HTTP request?',
                 'An HTTP request is the message a client sends to a server to ask for a resource.'),
        ]})
    return tmp_path, project, tutor


def test_grounded_queue_surfaces_recurring_confusion_and_keeps_schedule(practice):
    tmp_path, project, tutor = practice
    clock = [1_800_000_000]
    store = ReviewStore(tmp_path / 'review.sqlite', project, tutor, clock=lambda: clock[0])
    status = store.public()
    assert status['dueCount'] == status['totalCount'] == 2
    assert store.public(summary=True)['cards'] == []
    priority, saved_note = status['cards']
    assert '2 sketches' in priority['reason']
    assert priority['source']['drawingId'] in {'d-1', 'd-2'}
    assert priority['source']['checkpointId'] in {'checkpoint-1', 'checkpoint-2'}
    assert 'future checkpoint' not in str(status)
    assert 'duplicate jobs' in saved_note['question']

    status = store.rate({'id': priority['id'], 'reviewCount': 0, 'rating': 'again'})
    assert status['dueCount'] == 1 and status['nextDueAt'] == (clock[0] + 600) * 1000
    with pytest.raises(ValueError):
        store.rate({'id': priority['id'], 'reviewCount': 0, 'rating': 'easy'})

    store = ReviewStore(tmp_path / 'review.sqlite', project, tutor, clock=lambda: clock[0])
    clock[0] += 600
    status = store.public()
    assert status['cards'][0]['id'] == priority['id']
    assert status['cards'][0]['intervals']['easy'] == 14 * 1440
    status = store.rate({'id': priority['id'], 'reviewCount': 1, 'rating': 'known'})
    assert status['knownCount'] == 1
    assert store.refresh()['cards'][0]['id'] == saved_note['id']


def test_refinement_rewords_cards_without_sending_original_history(practice):
    tmp_path, project, tutor = practice
    finished = threading.Event()

    def refiner(provider, effort, prompt, image, work, cancel, *, instructions):
        payload = json.loads(prompt)
        assert provider == 'chatgpt' and image is None
        assert 'untrusted study material' in instructions
        assert 'future checkpoint' not in prompt and 'checkpoint-' not in prompt
        finished.set()
        return json.dumps({'cards': [{
            'id': payload['cards'][0]['id'],
            'question': 'What encrypts the data key in your design?',
            'answer': 'The key encryption key wraps the DEK. The DEK encrypts the stored data.',
        }]})

    store = ReviewStore(tmp_path / 'review.sqlite', project, tutor, refiner=refiner)
    initial = store.public()['cards'][0]
    assert store.refine()['refinement']['state'] == 'working'
    assert finished.wait(2)
    for _ in range(100):
        if not store.busy():
            break
        threading.Event().wait(.01)
    result = store.public()
    assert result['refinement']['state'] == 'complete'
    assert result['cards'][0]['id'] == initial['id']
    assert result['cards'][0]['source'] == initial['source']
    assert result['cards'][0]['question'] == 'What encrypts the data key in your design?'
