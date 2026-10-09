import json, threading, time
import pytest
from scripts.tutor import TutorStore, clean_env

def wait(store, ident):
    for _ in range(100):
        t=store.read(ident)
        if t['turns'][-1]['status']!='thinking': return t
        time.sleep(.01)
    raise AssertionError('Worker did not finish')

def payload(revision=0, **kw):
    return dict(id='drawing-one',revision=revision,question='What is missing?',provider='chatgpt',effort='low',context={'scene':{'elements':[]}},**kw)

def test_handoff_and_durable_history(tmp_path):
    prompts=[]
    def runner(provider, effort, prompt, image, work, cancel):
        prompts.append(json.loads(prompt));return 'Use an idempotency key.'
    s=TutorStore(tmp_path,runner)
    s.ask(payload()); first=wait(s,'drawing-one')
    second=payload(first['revision']);second['provider']='claude';second['question']='Explain that key.'
    s.ask(second);wait(s,'drawing-one')
    assert prompts[1]['conversation'][0]['answer']=='Use an idempotency key.'
    assert prompts[1]['conversation'][0]['provider']=='chatgpt'
    assert len(TutorStore(tmp_path,runner).read('drawing-one')['turns'])==2
    assert 'context' not in s.public('drawing-one')['turns'][0]

def test_conflicts_cancellation_retry(tmp_path):
    started=threading.Event()
    def runner(provider, effort, prompt, image, work, cancel):
        started.set();cancel.wait(2);raise ValueError('Stopped')
    s=TutorStore(tmp_path,runner);s.ask(payload());assert started.wait(1)
    with pytest.raises(ValueError): s.ask(payload())
    s.cancel('drawing-one');t=wait(s,'drawing-one');assert t['turns'][0]['status']=='error'
    s.runner=lambda *args: 'Recovered'
    s.ask(payload(t['revision'],retry=t['turns'][0]['id']));t=wait(s,'drawing-one')
    assert len(t['turns'])==1 and t['turns'][0]['answer']=='Recovered'

def test_input_and_api_keys(tmp_path,monkeypatch):
    monkeypatch.setenv('ANTHROPIC_API_KEY','secret');monkeypatch.setenv('GEMINI_API_KEY','secret');monkeypatch.setenv('OPENAI_API_KEY','secret')
    assert not any('API_KEY' in k for k in clean_env())
    s=TutorStore(tmp_path)
    with pytest.raises(ValueError): s.read('../escape')
    with pytest.raises(ValueError): s.ask(payload(image='data:image/png;base64,bm90LXB uZw=='))
    assert not s.read('drawing-one')['turns']

def test_future_checkpoint_conversation_is_excluded(tmp_path):
    prompts=[]
    def runner(provider,effort,prompt,*args): prompts.append(json.loads(prompt)); return 'reply'
    s=TutorStore(tmp_path,runner)
    p=payload();p['context']={'checkpointId':'cp5','priorCheckpointIds':['cp1','cp2','cp3','cp4'],'futureExcluded':True}
    p['question']='future secret';s.ask(p);t=wait(s,'drawing-one')
    p=payload(t['revision']);p['context']={'checkpointId':'cp3','priorCheckpointIds':['cp1','cp2'],'futureExcluded':True}
    p['question']='earlier question';s.ask(p);wait(s,'drawing-one')
    assert 'future secret' not in json.dumps(prompts[-1])
    assert len(s.read('drawing-one')['turns'])==2
