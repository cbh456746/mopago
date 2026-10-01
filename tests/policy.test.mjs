import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DEFAULT_CATALOG as catalog,DEFAULT_SHAPES,initialState,signature,probabilities,legalActions} from '../src/game.js';
import {DEFAULT_STAGE_WEIGHTS as weights} from '../src/stage-distributions.js';
import {recommend,validateModel,EXPERT_FEATURE_NAMES} from '../src/expert-agent.js';
import {migrateDefaultState,validateStatuses} from '../src/session.js';
import {summarize,evaluate} from '../scripts/lib/evaluation.mjs';
const model=JSON.parse(fs.readFileSync(new URL('../models/default.json',import.meta.url),'utf8'));

test('single model matches the fixed catalog and decline profile',()=>{
  assert.deepEqual(fs.readdirSync(new URL('../models/',import.meta.url)),['default.json']);
  assert.equal(model.weights.length,21);assert.deepEqual(model.featureNames,EXPERT_FEATURE_NAMES);
  validateModel(model,catalog,weights);
  assert.throws(()=>validateModel({...model,format:'mopago-linear-td-v1'},catalog,weights));
  assert.throws(()=>validateModel({...model,signature:signature(catalog,null)},catalog,weights));
  assert.throws(()=>validateModel({...model,weights:model.weights.map(()=>NaN)},catalog,weights));
});
test('published model is the evaluated policy with an accounted additional training budget',()=>{
  const training=model.training,evaluation=model.metrics.evaluation;
  assert.ok(training.additionalGames>=10000);
  assert.equal(model.episodes,training.additionalGames);
  assert.equal(training.rounds*training.population*training.gamesPerCandidate+(training.spatialTuning?.trainingGames??0),training.additionalGames);
  if(training.spatialTuning)assert.equal(training.spatialTuning.candidates*training.spatialTuning.gamesPerCandidate,training.spatialTuning.trainingGames);
  assert.ok(evaluation.episodes>=1500);assert.equal(evaluation.truncated,0);
  assert.equal(evaluation.distribution,'mild-small-piece-decline');
  assert.equal(evaluation.targets.averageMet,evaluation.averageScore>=100000);
  assert.equal(evaluation.targets.p90Met,evaluation.p90Score>=130000);
  const hash=createHash('sha256').update(JSON.stringify({signature:model.signature,weights:model.weights,featureNames:model.featureNames,gamma:model.gamma,search:model.search})).digest('hex');
  const engine=createHash('sha256').update(fs.readFileSync(new URL('../src/expert-agent.js',import.meta.url),'utf8').replaceAll('\r\n','\n')).digest('hex');
  assert.equal(evaluation.policySha256,hash);assert.equal(evaluation.engineSha256,engine);
  assert.equal(evaluation.runs.reduce((n,r)=>n+r.episodes,0),evaluation.episodes);
});
test('mild profile uses the published formula and reduces small-piece probability',()=>{
  let previous=Infinity;
  for(let stage=0;stage<5;stage++){
    for(const p of catalog)assert.ok(Math.abs(weights[stage][p.name]-.6**(stage/4*(10-p.size)/9))<1e-9);
    const probs=probabilities(catalog,[0,31,61,101,151][stage],weights);
    assert.ok(Math.abs(probs.reduce((a,b)=>a+b)-1)<1e-12);
    const small=probs.reduce((sum,p,i)=>sum+(catalog[i].size<=4?p:0),0);
    assert.ok(small<previous);previous=small;
  }
  assert.equal(weights[4]['.'],.6);assert.equal(weights[4]['ㅂ'],1);
});
test('old default boards preserve cells, hand, icons and counters when adopting one profile',()=>{
  for(const n of [17,18,19]){
    const old={version:1,shapes:DEFAULT_SHAPES.slice(0,n),stageWeights:null,state:initialState(),slotStatus:['ready','used','used']};
    old.state.rows[8]=511;old.state.hand[0]=n-1;old.state.lines=151;old.state.powers.dot=2;old.state.icons=[{x:9,y:8,type:'dot'}];
    const saved=structuredClone(old),next=migrateDefaultState(old);
    assert.deepEqual(next.state,saved.state);assert.deepEqual(next.slotStatus,saved.slotStatus);
    assert.deepEqual(next.shapes,DEFAULT_SHAPES);assert.deepEqual(next.stageWeights,weights);assert.deepEqual(old,saved);
    validateStatuses(next.slotStatus,next.state);
  }
  assert.throws(()=>migrateDefaultState({shapes:[{name:'custom',columns:['1']}]}));
  assert.throws(()=>validateStatuses(['used','used','used'],{hand:[0,null,null]}));
});
test('recommendation gives a legal row-clearing action without changing the input',()=>{
  const s=initialState();s.rows[15]=511;s.hand=[2,null,null];s.icons=[{x:9,y:15,type:'dot'}];
  const before=structuredClone(s),r=recommend(s,catalog,model,weights);
  assert.ok(r.recommendations.length);const a=r.recommendations[0].action;
  assert.ok(legalActions(s,catalog).some(b=>b.type===a.type&&b.slot===a.slot&&b.x===a.x&&b.y===a.y&&b.variant===a.variant));
  assert.equal(a.x,9);assert.equal(a.y,15);assert.equal(r.recommendations[0].reward,351);assert.deepEqual(s,before);
});
test('P90 is nearest-rank score, distinct from top-decile mean',()=>{
  const scores=Array.from({length:100},(_,i)=>(i+1)*1000),r=summarize(scores);
  assert.equal(r.p90Score,90000);assert.equal(r.averageScore,50500);assert.equal(r.maxScore,100000);
  assert.equal(summarize([10000,130000,200000]).atLeast130000,2);
  assert.throws(()=>summarize([]));
});
test('evaluation is reproducible and counts spawned abilities and action caps',()=>{
  const options={games:2,seed:19,maxSteps:8},a=evaluate(model,weights,options),b=evaluate(model,weights,options);
  assert.deepEqual(a,b);assert.equal(a.episodes,2);assert.equal(a.truncated,2);
  assert.equal(a.abilities.spawnedDot+a.abilities.spawnedReroll,2);
});
