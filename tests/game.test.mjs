import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CATALOG as catalog,FULL,initialState,transition,legalActions,seededRandom,validateState,stageOf,createCatalog,probabilities} from '../src/game.js';
import {DEFAULT_SHAPES} from '../src/game.js';
import {migrateDefaultState,advanceRecommendation} from '../src/session.js';
const id=name=>catalog.findIndex(p=>p.name===name);
test('column notation produces the approved shapes and unique dihedral orientations',()=>{
  assert.equal(catalog.length,19);
  assert.deepEqual(catalog[id('ㅏ')].cells,[[0,0],[0,1],[1,1],[0,2]]);
  assert.equal(catalog[id('ㅡ')].variants[0].width,3);
  assert.equal(catalog[id('ㅡ')].variants[0].height,1);
  assert.equal(catalog[id('ㅅ')].variants[0].width,3);
  assert.equal(catalog[id('ㅅ')].variants[0].height,2);
  assert.deepEqual(catalog[id('ㅋ')].cells,[[0,0],[1,0],[1,1],[0,2],[1,2],[1,3]]);
  assert.equal(catalog[id('ㅋ')].size,6);
  assert.equal(catalog[id('ㅋ')].variants.length,8);
  assert.deepEqual(catalog[id('ㅂ')].variants[0].masks,[5,7,5,7]);
  assert.equal(catalog[id('ㅂ')].variants[0].width,3);
  assert.equal(catalog[id('ㅂ')].variants[0].height,4);
  assert.equal(catalog[id('ㅂ')].size,10);
  assert.equal(catalog[id('ㅂ')].variants.length,4);
  for(const p of catalog){assert.equal(new Set(p.variants.map(v=>JSON.stringify(v.cells))).size,p.variants.length);for(const v of p.variants)assert.equal(v.cells.length,p.size);}
});
test('advancing a recommended ㅋ consumes only its slot and rejects repeat placement',()=>{
  const s=initialState();s.hand=[id('ㅋ'),id('.'),id('ㅇ')];
  const action={type:'place',slot:0,variant:0,x:2,y:3};
  const next=advanceRecommendation(s,['ready','ready','ready'],action,catalog);
  assert.deepEqual(next.state.rows.slice(3,7),[12,8,12,8]);
  assert.deepEqual(next.state.hand,[null,id('.'),id('ㅇ')]);
  assert.deepEqual(next.slotStatus,['used','ready','ready']);
  assert.equal(next.reward,6);assert.equal(next.needsHand,false);
  assert.throws(()=>advanceRecommendation(next.state,next.slotStatus,action,catalog));
  assert.equal(s.hand[0],id('ㅋ'));
});
test('last recommended block clears its row, collects ability, and waits for real next hand',()=>{
  const s=initialState();s.rows[1]=2;s.rows[15]=FULL^512;s.hand=[null,id('.'),null];
  s.placementCounter=6;s.icons=[{x:9,y:15,type:'dot'}];
  const next=advanceRecommendation(s,['used','ready','used'],{type:'place',slot:1,variant:0,x:9,y:15},catalog);
  assert.equal(next.state.rows[1],2);assert.equal(next.state.rows[15],0);
  assert.equal(next.reward,351);assert.equal(next.state.lines,1);assert.equal(next.state.powers.dot,1);
  assert.equal(next.state.placementCounter,0);assert.deepEqual(next.state.icons,[]);
  assert.deepEqual(next.state.hand,[null,null,null]);assert.deepEqual(next.slotStatus,['pending','pending','pending']);assert.equal(next.needsHand,true);
});
test('ability advancement consumes inventory and reroll waits for actual result',()=>{
  const s=initialState();s.hand=[id('ㅋ'),null,null];s.powers={dot:1,reroll:2};
  const dot=advanceRecommendation(s,['ready','used','used'],{type:'dot',x:0,y:0},catalog);
  assert.equal(dot.state.rows[0],1);assert.equal(dot.state.powers.dot,0);assert.deepEqual(dot.slotStatus,['ready','used','used']);
  const reroll=advanceRecommendation(dot.state,dot.slotStatus,{type:'reroll',slot:0},catalog);
  assert.equal(reroll.state.powers.reroll,1);assert.deepEqual(reroll.state.hand,[null,null,null]);
  assert.deepEqual(reroll.slotStatus,['pending','used','used']);assert.equal(reroll.needsHand,false);
  assert.throws(()=>advanceRecommendation(reroll.state,reroll.slotStatus,{type:'reroll',slot:0},catalog));
});
test('simultaneous lines receive quadratic score and no gravity moves other rows',()=>{
  const s=initialState();s.rows[3]=FULL^1;s.rows[4]=FULL^1;s.rows[1]=2;s.hand=[id('ㅡ'),id('.'),id('.')];
  const vertical=catalog[id('ㅡ')].variants.findIndex(v=>v.width===1);
  const next=transition(s,{type:'place',slot:0,variant:vertical,x:0,y:3},catalog,undefined,{draw:false,spawn:false});
  assert.deepEqual(next.cleared,[3,4]);assert.equal(next.reward,1203);assert.equal(next.state.rows[1],2);assert.equal(next.state.rows[3],0);assert.equal(next.state.rows[4],0);assert.equal(next.state.rows[5],1);
  assert.equal(s.rows[3],FULL^1);assert.equal(s.hand[0],id('ㅡ'));
});
test('ability collection caps at seven and a blocked collection leaves its icon',()=>{
  const s=initialState();s.rows[0]=FULL^1;s.hand=[id('.'),null,null];s.powers={dot:6,reroll:0};s.icons=[{x:0,y:0,type:'dot'},{x:1,y:0,type:'reroll'}];
  const next=transition(s,{type:'place',slot:0,variant:0,x:0,y:0},catalog,undefined,{draw:false,spawn:false});
  assert.equal(next.reward,351);assert.equal(next.state.powers.dot,7);assert.deepEqual(next.state.icons,[{x:1,y:0,type:'reroll'}]);
});
test('dot can collect a row icon but does not advance the seven-placement counter',()=>{
  const s=initialState();s.rows[2]=FULL^4;s.powers={dot:1,reroll:0};s.placementCounter=6;s.icons=[{x:2,y:2,type:'reroll'}];
  const next=transition(s,{type:'dot',x:2,y:2},catalog);
  assert.equal(next.reward,350);assert.equal(next.state.placementCounter,6);assert.deepEqual(next.state.powers,{dot:0,reroll:1});
});
test('seventh normal placement adds an icon and removes the oldest of three',()=>{
  const s=initialState();s.hand=[id('.'),id('.'),id('.')];s.placementCounter=6;s.icons=[{x:1,y:1,type:'dot'},{x:2,y:1,type:'reroll'},{x:3,y:1,type:'dot'}];
  const next=transition(s,{type:'place',slot:0,variant:0,x:0,y:0},catalog,seededRandom(77));
  assert.equal(next.state.placementCounter,0);assert.equal(next.state.icons.length,3);assert.deepEqual(next.state.icons[0],s.icons[1]);assert.equal(next.state.rows[next.state.icons[2].y]&(1<<next.state.icons[2].x),0);
  s.powers={dot:7,reroll:0};assert.deepEqual(transition(s,{type:'place',slot:0,variant:0,x:0,y:0},catalog).state.icons,s.icons);
});
test('official ability probability boundary and random empty-cell spawn are respected',()=>{
  const action={type:'place',slot:0,variant:0,x:0,y:0};
  const s=initialState();s.hand=[id('.'),id('.'),id('.')];s.placementCounter=6;
  for(const [value,type] of [[.399999,'dot'],[.4,'reroll']]){
    const values=[.999,value];
    const next=transition(s,action,catalog,()=>values.shift(),{draw:false});
    assert.deepEqual(next.state.icons,[{x:9,y:15,type}]);
  }
  const rng=seededRandom(20261001),counts={dot:0,reroll:0},positions=new Set();
  for(let i=0;i<10000;i++){
    const next=transition(s,action,catalog,rng,{draw:false});
    const icon=next.state.icons[0];counts[icon.type]++;positions.add(icon.y*10+icon.x);
    assert.equal(next.state.rows[icon.y]&(1<<icon.x),0);
  }
  assert.deepEqual(counts,{dot:4075,reroll:5925});assert.equal(positions.size,159);
  const six=transition({...s,placementCounter:5},action,catalog,rng,{draw:false});
  assert.deepEqual(six.state.icons,[]);assert.equal(six.state.placementCounter,6);
});
test('hand is replenished only when all three pieces have been consumed',()=>{
  const s=initialState();s.hand=[id('.'),id('.'),null];
  const a=transition(s,{type:'place',slot:0,variant:0,x:0,y:0},catalog,seededRandom(10));assert.deepEqual(a.state.hand,[null,id('.'),null]);
  const b=transition(a.state,{type:'place',slot:1,variant:0,x:1,y:0},catalog,seededRandom(10));assert.ok(b.state.hand.every(n=>Number.isInteger(n)));
});
test('invalid overlaps, coordinates and inventories are rejected',()=>{
  const s=initialState();s.rows[0]=1;s.hand=[id('.'),null,null];
  assert.throws(()=>transition(s,{type:'place',slot:0,variant:0,x:0,y:0},catalog));
  assert.throws(()=>transition(s,{type:'dot',x:10,y:0},catalog));
  assert.throws(()=>validateState({...s,powers:{dot:7,reroll:1}},catalog));
  assert.throws(()=>createCatalog([{name:'x',columns:['11']}]));
  assert.deepEqual([0,30,31,60,61,100,101,150,151].map(stageOf),[0,0,1,1,2,2,3,3,4]);
});
test('custom stage distribution uses nonnegative weights and supports new shapes',()=>{
  const c=createCatalog([{name:'a',columns:['1']},{name:'b',columns:['12']}]),p=probabilities(c,31,[{a:1,b:0},{a:0,b:1},{a:1,b:1},{a:1,b:1},{a:1,b:1}]);assert.deepEqual(p,[0,1]);assert.throws(()=>probabilities(c,0,[{a:-1,b:1}]));
});
test('blocked boards still offer a usable reroll and one-cell special actions',()=>{
  const s=initialState();s.rows=s.rows.map((_,y)=>FULL^(y%2?341:682));s.hand=[id('ㅍ'),id('ㅣ'),id('ㅁ')];
  assert.equal(legalActions(s,catalog).length,0);
  s.powers.reroll=1;assert.equal(legalActions(s,catalog).length,3);
  s.powers.dot=1;assert.ok(legalActions(s,catalog).some(a=>a.type==='dot'));
});
