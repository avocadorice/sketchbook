import base64, json, threading, time
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

def test_gpt_balanced_default_and_explicit_reasoning(tmp_path):
    settings=[]
    def runner(provider, effort, *args):
        settings.append((provider, effort)); return 'Hint'
    s=TutorStore(tmp_path,runner)
    request=payload(); request.pop('provider'); request.pop('effort')
    s.ask(request); first=wait(s,'drawing-one')
    assert settings == [('chatgpt','medium')]
    assert first['turns'][0]['provider']=='chatgpt'
    assert first['turns'][0]['effort']=='medium'
    assert first['turns'][0]['model']=='gpt-6.1-sol'
    request=payload(first['revision']); request['effort']='xhigh'
    s.ask(request); wait(s,'drawing-one')
    assert settings[-1] == ('chatgpt','xhigh')

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
    prompts=[]; images=[]
    def runner(provider,effort,prompt,image,*args):
        prompts.append(json.loads(prompt)); images.append(image.read_bytes() if image else None); return 'reply'
    s=TutorStore(tmp_path,runner)
    p=payload();p['context']={'checkpointId':'cp5','priorCheckpointIds':['cp1','cp2','cp3','cp4'],'futureExcluded':True}
    raw=b'\x89PNG\r\n\x1a\nfuture screenshot'
    p['image']='data:image/png;base64,'+base64.b64encode(raw).decode()
    p['question']='future secret';s.ask(p);t=wait(s,'drawing-one')
    p=payload(t['revision']);p['context']={'checkpointId':'cp3','priorCheckpointIds':['cp1','cp2'],'futureExcluded':True}
    p['question']='earlier question';s.ask(p);wait(s,'drawing-one')
    assert 'future secret' not in json.dumps(prompts[-1])
    assert images == [raw, None]
    assert (tmp_path / (t['turns'][0]['id']+'.png')).read_bytes() == raw
    assert s.public('drawing-one')['turns'][0]['image'] is True
    assert len(s.read('drawing-one')['turns'])==2
