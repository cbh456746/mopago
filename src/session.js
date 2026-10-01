import {DEFAULT_SHAPES,transition} from './game.js';
import {DEFAULT_STAGE_WEIGHTS} from './stage-distributions.js';

// Keep board/hand data from known prior default catalogs, use the single profile.
export function migrateDefaultState(data) {
  if(!data||typeof data!=='object')throw Error('저장된 게임 상태를 확인하세요.');
  const legacy=DEFAULT_SHAPES.slice(0,data.shapes?.length);
  const sameLegacy=Array.isArray(data.shapes)&&
    [17,18,19].includes(data.shapes.length)&&data.shapes.every((p,i)=>
      p.name===legacy[i].name&&JSON.stringify(p.columns)===JSON.stringify(legacy[i].columns));
  if(!sameLegacy)throw Error('현재 지원하는 19종 조각으로 저장한 상태가 아닙니다.');
  return {...data,shapes:structuredClone(DEFAULT_SHAPES),stageWeights:structuredClone(DEFAULT_STAGE_WEIGHTS)};
}

export function validateStatuses(statuses,state) {
  if(!Array.isArray(statuses)||statuses.length!==3||statuses.some((v,i)=>
    !['ready','pending','used'].includes(v)||(v==='ready')!==(state.hand[i]!==null)))
    throw Error('슬롯 입력 상태가 올바르지 않습니다.');
}

export function advanceRecommendation(state,slotStatus,action,catalog,stageWeights=null) {
  if(action.type==='reroll') {
    if(state.powers.reroll<1||state.hand[action.slot]==null||slotStatus[action.slot]!=='ready')
      throw Error('바꿔 뽑을 조각이나 능력이 없습니다.');
    const next=structuredClone(state),statuses=[...slotStatus];
    next.powers.reroll--;next.hand[action.slot]=null;statuses[action.slot]='pending';
    return {state:next,slotStatus:statuses,reward:0,needsHand:false};
  }
  const next=transition(state,action,catalog,undefined,{draw:false,spawn:false,stageWeights});
  let statuses=[...slotStatus];
  if(action.type==='place')statuses[action.slot]='used';
  const needsHand=next.state.hand.every(id=>id===null)&&statuses.every(s=>s==='used');
  if(needsHand)statuses=['pending','pending','pending'];
  return {...next,slotStatus:statuses,needsHand};
}
