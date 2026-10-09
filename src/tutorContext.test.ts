import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpoint, createAttempt, sceneAt, updateChapter, parseAttempt } from './history';
import { tutorContext, matchesSearch } from './tutorContext';
import type { Project } from './storage';
const scene = (text: string) => ({ elements: [{ id: 'box', text, x: 100, y: 100, width: 40, height: 40 }], backgroundColor: '#ffffff' });
test('tutor receives ordered predecessors, excludes future scenes, and narrows focus', () => {
  let a=createAttempt('Payments'); for (let i=1;i<=5;i++) { a=checkpoint(a,scene(`state${i}`),`Step ${i}`,'');a.chapters[i-1].id=`cp${i}`; }
  const p:Project={attempt:a,draft:{index:2,scene:sceneAt(a,2),title:'Step 3',notes:''},files:{}};
  const c=tutorContext(p,null);assert.deepEqual(c.priorCheckpointIds,['cp1','cp2']);assert.equal(c.checkpointId,'cp3');assert.ok(!JSON.stringify(c).includes('state5'));
  const focused=tutorContext(p,{x:0,y:0,width:20,height:20});assert.equal(focused.scene.elements.length,0);assert.equal(focused.priorCheckpoints[0].scene.elements.length,0);
  assert.equal(matchesSearch(p,'payments state5'),true);assert.equal(matchesSearch(p,'missing'),false);
});
test('clean slate is a persistent boundary for inherited edits', () => {
  let a=checkpoint(createAttempt('Example'),scene('first'),'one','');
  const independent=checkpoint(createAttempt(''),{elements:[],backgroundColor:'#ffffff'},'two','').chapters[0];
  a.chapters.push({...independent,reset:true,id:'cp2'});
  a=updateChapter(a,0,scene('edited'),'one','');
  assert.equal(sceneAt(a,1).elements.length,0);
  assert.equal(parseAttempt(a).chapters[1].reset,true);
  assert.equal(parseAttempt(a).chapters[1].id,'cp2');
});
