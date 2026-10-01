import {DEFAULT_CATALOG as catalog,initialState,drawPiece,seededRandom,transition,legalActions} from '../../src/game.js';
import {recommend} from '../../src/expert-agent.js';

export function summarize(scores,extra={}) {
  const sorted=[...scores].sort((a,b)=>a-b),n=sorted.length;
  if(!n)throw Error('Evaluation needs at least one game');
  return {episodes:n,averageScore:scores.reduce((a,b)=>a+b,0)/n,
    p90Score:sorted[Math.ceil(.9*n)-1],medianScore:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,
    minScore:sorted[0],maxScore:sorted[n-1],atLeast130000:scores.filter(s=>s>=130000).length,...extra};
}
export function evaluate(model,weights,{games,seed,offset=0,maxSteps=10000}) {
  const scores=[],abilities={spawnedDot:0,spawnedReroll:0,acquired:0,usedDot:0,usedReroll:0};
  let truncated=0,totalSteps=0,totalLines=0;
  for(let game=0;game<games;game++) {
    const rng=seededRandom((seed+Math.imul(game+offset,2654435761))>>>0);
    let state=initialState();state.hand=Array.from({length:3},()=>drawPiece(catalog,0,rng,weights));let steps=0;
    for(;steps<maxSteps;steps++) {
      const action=recommend(state,catalog,model,weights,model.search).recommendations[0]?.action;
      if(!action)break;
      const next=transition(state,action,catalog,rng,{stageWeights:weights});
      if(next.spawned)abilities[next.spawned.type==='dot'?'spawnedDot':'spawnedReroll']++;
      abilities.acquired+=next.acquired;
      if(action.type==='dot')abilities.usedDot++;
      if(action.type==='reroll')abilities.usedReroll++;
      state=next.state;
    }
    if(steps===maxSteps&&legalActions(state,catalog).length)truncated++;
    scores.push(state.score);totalSteps+=steps;totalLines+=state.lines;
  }
  return summarize(scores,{scores,truncated,totalSteps,totalLines,abilities});
}
