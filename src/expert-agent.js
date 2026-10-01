import {legalActions,transition,features,FEATURE_NAMES,probabilities,signature,popcount} from './game.js';
export const GAMMA=.985;
export const EXPERT_FEATURE_NAMES=[...FEATURE_NAMES,'nearFullRows','shortHorizontalGaps','shortVerticalGaps','adjacentRowPotential','iconRowFill','readyIconRows'];
const SHORT_GAPS=Array.from({length:1024},(_,row)=>{let run=0,total=0;for(let x=0;x<=10;x++){if(x<10&&!(row&(1<<x)))run++;else{if(run&&run<=2)total+=run;run=0;}}return total;});
function expertFeatures(state,catalog){
  const f=features(state,catalog);let near=0,shortH=0,shortV=0,pairs=0,iconFill=0,ready=0;
  const rows=state.rows,counts=rows.map(popcount);
  for(let y=0;y<16;y++){near+=counts[y]>=7?1:0;shortH+=SHORT_GAPS[rows[y]];if(y<15)pairs+=counts[y]*counts[y+1];
    const empty=1023^rows[y],above=y?rows[y-1]:1023,below=y<15?rows[y+1]:1023;
    shortV+=popcount(empty&above&below);if(y<15)shortV+=2*popcount(empty&(1023^rows[y+1])&above&(y<14?rows[y+2]:1023));}
  for(const icon of state.icons){iconFill+=counts[icon.y]/10;ready+=counts[icon.y]>=8?1:0;}
  return [...f,near/16,shortH/160,shortV/160,pairs/1500,iconFill/3,ready/3];
}
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function validateModel(model,catalog,stageWeights=null) {
  if(!model||model.format!=='mopago-expert-policy-v5'||model.signature!==signature(catalog,stageWeights)||!Array.isArray(model.weights)||model.weights.length!==EXPERT_FEATURE_NAMES.length||model.weights.some(n=>!Number.isFinite(n)||Math.abs(n)>1000)||!Number.isInteger(model.episodes)||model.episodes<0||model.gamma!==GAMMA||JSON.stringify(model.featureNames)!==JSON.stringify(EXPERT_FEATURE_NAMES))throw Error('모델의 규칙·블록·확률 설정 또는 형식이 현재 환경과 맞지 않습니다.');
  if(!model.search||!Number.isInteger(model.search.beamWidth)||model.search.beamWidth<1||model.search.beamWidth>64||!Number.isInteger(model.search.depth)||model.search.depth<1||model.search.depth>3)throw Error('모델의 탐색 설정을 확인하세요.');
  return model;
}
function expectedFeatures(state,catalog,stageWeights) {
  const f=expertFeatures(state,catalog);
  if(state.hand.every(id=>id===null)) {
    const p=probabilities(catalog,state.lines,stageWeights),mean=catalog.reduce((sum,c,i)=>sum+p[i]*c.size,0);
    f[9]=1;f[10]=mean*3/60;f[11]=mean/20;
  }
  return f;
}
function evaluateAction(state,action,catalog,model,stageWeights) {
  const options={draw:false,spawn:false,stageWeights};
  if(action.type==='reroll') {
    let q=0;const probs=probabilities(catalog,state.lines,stageWeights);
    for(let i=0;i<catalog.length;i++)if(probs[i]) {
      const next=transition(state,{...action,pieceResult:i},catalog,undefined,options);
      q+=probs[i]*(next.reward/300+GAMMA*dot(model.weights,expectedFeatures(next.state,catalog,stageWeights)));
    }
    return {action,q,next:null,reward:0,cleared:[],acquired:0};
  }
  const next=transition(state,action,catalog,undefined,options);
  const f=expectedFeatures(next.state,catalog,stageWeights);
  return {action,q:next.reward/300+GAMMA*dot(model.weights,f),next:next.state,reward:next.reward,cleared:next.cleared,acquired:next.acquired};
}
export function rankedActions(state,catalog,model,stageWeights=null,{limit=8}={}) {
  const actions=legalActions(state,catalog);
  // Keep full successor boards only for the small selected frontier.
  const candidates=actions.map(a=>{
    const candidate=evaluateAction(state,a,catalog,model,stageWeights);
    candidate.next=null;return candidate;
  }).sort((a,b)=>b.q-a.q||b.reward-a.reward).slice(0,limit);
  for(const candidate of candidates)if(candidate.action.type!=='reroll')
    candidate.next=transition(state,candidate.action,catalog,undefined,{draw:false,spawn:false,stageWeights}).state;
  return candidates;
}
export function recommend(state,catalog,model,stageWeights=null,{beamWidth=model.search?.beamWidth??12,depth=3}={}) {
  const first=rankedActions(state,catalog,model,stageWeights,{limit:Math.max(beamWidth,5)});
  if(!first.length)return {recommendations:[],method:'no-legal-actions'};
  let beam=first.map(c=>({state:c.next,path:[c],reward:c.reward/300,rank:c.q}));
  let finished=[];
  for(let level=1;level<depth;level++) {
    const expanded=[];
    for(const branch of beam) {
      if(!branch.state||branch.state.hand.every(id=>id===null)) {finished.push(branch);continue;}
      const choices=rankedActions(branch.state,catalog,model,stageWeights,{limit:beamWidth});
      if(!choices.length){finished.push({...branch,rank:branch.reward});continue;}
      for(const c of choices) {
        const reward=branch.reward+GAMMA**level*c.reward/300;
        const rank=reward+GAMMA**(level+1)*(c.next?dot(model.weights,expectedFeatures(c.next,catalog,stageWeights)):c.q/GAMMA);
        expanded.push({state:c.next,path:[...branch.path,c],reward,rank});
      }
    }
    beam=expanded.sort((a,b)=>b.rank-a.rank).slice(0,beamWidth*2);
    if(!beam.length)break;
  }
  finished.push(...beam);
  const recommendations=[],seen=new Set();
  for(const branch of finished.sort((a,b)=>b.rank-a.rank)) {
    const c=branch.path[0],key=JSON.stringify([c.action.type,c.action.slot,c.action.x,c.action.y,c.action.variant]);
    if(seen.has(key))continue;seen.add(key);
    recommendations.push({...c,plan:branch.path.map(p=>({action:p.action,reward:p.reward,cleared:p.cleared})),searchValue:branch.rank});
    if(recommendations.length===3)break;
  }
  // Keep a special ability candidate visible when it was outside the narrow beam.
  const special=first.find(c=>c.action.type!=='place');
  if(special&&!recommendations.some(c=>JSON.stringify(c.action)===JSON.stringify(special.action)))recommendations.push({...special,plan:[special],searchValue:special.q});
  for(const c of first) {
    if(recommendations.length>=3)break;
    if(!recommendations.some(p=>JSON.stringify(p.action)===JSON.stringify(c.action)))recommendations.push({...c,plan:[c],searchValue:c.q});
  }
  return {recommendations,method:'expert-value-plus-beam',beamWidth,depth};
}
