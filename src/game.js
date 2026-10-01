export const WIDTH = 10, HEIGHT = 16, FULL = 1023;
export const RULE_VERSION = 'mopago-rules-v1';
export const DEFAULT_SHAPES = [
  ['ㅏ',['123','2']], ['ㅑ',['12345','24']], ['.',['1']],
  ['ㅍ',['13','123','123','13']], ['ㄱ',['1','123']],
  ['ㅌ',['12345','135']], ['ㅣ',['12345']], ['ㄷ',['123','13']],
  ['ㅁ',['123','13','123']], ['ㅡ',['1','1','1']],
  ['ㅊ',['24','123','24']], ['ㄹ',['1345','1235']],
  ['ㅎ',['2','23','124','23','2']], ['ㅇ',['2','13','2']],
  ['ㅅ',['2','1','2']], ['ㅈ',['13','12','13']], ['ㄴ',['12','2']],
  ['ㅋ',['13','1234']], ['ㅂ',['1234','24','1234']]
].map(([name,columns])=>({name,columns}));
const POP = Uint8Array.from({length:1024}, (_,n)=>n.toString(2).replaceAll('0','').length);
export const popcount = n => POP[n & FULL];
export function normalize(cells) {
  const minX=Math.min(...cells.map(c=>c[0])),minY=Math.min(...cells.map(c=>c[1]));
  return cells.map(([x,y])=>[x-minX,y-minY]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
}
export function createCatalog(definitions=DEFAULT_SHAPES) {
  if (!Array.isArray(definitions)||!definitions.length||definitions.length>40) throw Error('블록은 1~40개를 정의하세요.');
  const names=new Set();
  return definitions.map(({name,columns})=>{
    if(typeof name!=='string'||!name.trim()||name.length>16||names.has(name))throw Error('블록 이름은 비어 있지 않은 고유한 문자열이어야 합니다.');
    names.add(name);
    if(!Array.isArray(columns)||!columns.length||columns.length>WIDTH)throw Error('열별 표기를 확인하세요.');
    let cells=[];
    columns.forEach((rows,x)=>{
      if(typeof rows!=='string'||!/^[1-9]*$/.test(rows)||new Set(rows).size!==rows.length)throw Error('각 열은 중복 없는 행 번호 문자열이어야 합니다.');
      for(const row of rows)cells.push([x,Number(row)-1]);
    });
    if(!cells.length)throw Error('블록에 최소 한 칸이 필요합니다.');
    cells=normalize(cells);
    const variants=[],seen=new Set();
    for(const mirror of [false,true]) {
      let transformed=cells.map(([x,y])=>[mirror?-x:x,y]);
      for(let rotation=0;rotation<4;rotation++) {
        const normalized=normalize(transformed),key=JSON.stringify(normalized);
        if(!seen.has(key)) {
          seen.add(key);
          const width=Math.max(...normalized.map(c=>c[0]))+1,height=Math.max(...normalized.map(c=>c[1]))+1;
          const masks=Array(height).fill(0);normalized.forEach(([x,y])=>masks[y]|=1<<x);
          variants.push({cells:normalized,width,height,masks,rotation:rotation*90,mirror});
        }
        transformed=transformed.map(([x,y])=>[-y,x]);
      }
    }
    const placements=[];
    variants.forEach((variant,v)=>{
      for(let y=0;y<=HEIGHT-variant.height;y++)for(let x=0;x<=WIDTH-variant.width;x++)
        placements.push({type:'place',x,y,variant:v,masks:variant.masks.map(m=>m<<x)});
    });
    return {name,columns,cells,size:cells.length,variants,placements};
  });
}
export const DEFAULT_CATALOG=createCatalog();
export function seededRandom(seed=20261001) {
  let value=seed>>>0||1;
  return ()=>{value^=value<<13;value^=value>>>17;value^=value<<5;return (value>>>0)/4294967296;};
}
export function stageOf(lines) { return lines<=30?0:lines<=60?1:lines<=100?2:lines<=150?3:4; }
export function probabilities(catalog,lines,stageWeights=null) {
  const map=stageWeights?.[stageOf(lines)];
  const weights=catalog.map(p=>map ? Number(map[p.name]??0):1);
  if(weights.some(w=>!Number.isFinite(w)||w<0)||weights.reduce((a,b)=>a+b,0)<=0)throw Error('확률 가중치는 음수가 아니어야 하며 합이 0보다 커야 합니다.');
  const total=weights.reduce((a,b)=>a+b,0);return weights.map(w=>w/total);
}
export function drawPiece(catalog,lines,rng,stageWeights=null) {
  const probs=probabilities(catalog,lines,stageWeights);let n=rng();
  for(let i=0;i<probs.length;i++){n-=probs[i];if(n<0)return i;}return probs.length-1;
}
export function initialState() {
  return {rows:Array(HEIGHT).fill(0),hand:[null,null,null],powers:{dot:0,reroll:0},icons:[],placementCounter:0,lines:0,score:0};
}
export function validateState(state,catalog=DEFAULT_CATALOG) {
  if(!state||!Array.isArray(state.rows)||state.rows.length!==HEIGHT||state.rows.some(n=>!Number.isInteger(n)||n<0||n>FULL))throw Error('게임판은 10×16 행 비트맵이어야 합니다.');
  if(!Array.isArray(state.hand)||state.hand.length!==3||state.hand.some(n=>n!==null&&(!Number.isInteger(n)||n<0||n>=catalog.length)))throw Error('보유 조각을 확인하세요.');
  if(!state.powers||['dot','reroll'].some(k=>!Number.isInteger(state.powers[k])||state.powers[k]<0)||state.powers.dot+state.powers.reroll>7)throw Error('능력은 합계 7개까지 보유할 수 있습니다.');
  if(!Array.isArray(state.icons)||state.icons.length>3||state.icons.some(p=>!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.x>=WIDTH||p.y<0||p.y>=HEIGHT||!['dot','reroll'].includes(p.type))||new Set(state.icons.map(p=>p.y*WIDTH+p.x)).size!==state.icons.length)throw Error('능력 아이콘은 서로 다른 칸에 최대 3개입니다.');
  if(!Number.isInteger(state.placementCounter)||state.placementCounter<0||state.placementCounter>6||!Number.isInteger(state.lines)||state.lines<0||!Number.isInteger(state.score)||state.score<0)throw Error('점수·제거한 줄·배치 주기를 확인하세요.');
  return state;
}
export function fits(rows,p) { return p.masks.every((mask,i)=>(rows[p.y+i]&mask)===0); }
export function legalActions(state,catalog=DEFAULT_CATALOG,includeReroll=true) {
  const actions=[];
  state.hand.forEach((id,slot)=>{if(id!==null)for(const p of catalog[id].placements)if(fits(state.rows,p))actions.push({...p,slot,piece:id});});
  if(state.powers.dot>0)for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)if(!(state.rows[y]&(1<<x)))actions.push({type:'dot',x,y});
  if(includeReroll&&state.powers.reroll>0)state.hand.forEach((id,slot)=>{if(id!==null)actions.push({type:'reroll',slot});});
  return actions;
}
export function resolveRows(state) {
  const fullRows=[];state.rows.forEach((row,y)=>{if(row===FULL)fullRows.push(y);});
  let acquired=0;
  state.icons=state.icons.filter(icon=>{
    if(fullRows.includes(icon.y)&&state.powers.dot+state.powers.reroll<7) {
      state.powers[icon.type]++;acquired++;return false;
    }return true;
  });
  fullRows.forEach(y=>state.rows[y]=0);
  state.lines+=fullRows.length;
  return {cleared:fullRows,acquired,lineScore:300*fullRows.length**2};
}
export function transition(input,action,catalog=DEFAULT_CATALOG,rng=seededRandom(),options={}) {
  const state={...input,rows:[...input.rows],hand:[...input.hand],powers:{...input.powers},icons:input.icons.map(i=>({...i}))};
  let placementScore=0,spawned=null;
  if(action.type==='place') {
    const id=state.hand[action.slot],piece=catalog[id],v=piece?.variants[action.variant];
    if(!piece||!v||!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<0||action.y<0||action.x+v.width>WIDTH||action.y+v.height>HEIGHT)throw Error('올바른 블록 배치가 아닙니다.');
    const p={...action,masks:v.masks.map(m=>m<<action.x)};
    if(!fits(state.rows,p))throw Error('이미 채워진 칸에는 블록을 놓을 수 없습니다.');
    p.masks.forEach((mask,i)=>state.rows[p.y+i]|=mask);
    state.hand[action.slot]=null;placementScore=piece.size;state.placementCounter++;
  } else if(action.type==='dot') {
    if(state.powers.dot<1||!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<0||action.x>=WIDTH||action.y<0||action.y>=HEIGHT||state.rows[action.y]&(1<<action.x))throw Error('점 찍기는 빈 칸에만 사용할 수 있습니다.');
    state.powers.dot--;state.rows[action.y]|=1<<action.x;
  } else if(action.type==='reroll') {
    if(state.powers.reroll<1||state.hand[action.slot]===null||state.hand[action.slot]===undefined)throw Error('바꿔 뽑을 조각이나 능력이 없습니다.');
    const id=action.pieceResult??drawPiece(catalog,state.lines,rng,options.stageWeights);
    if(!Number.isInteger(id)||id<0||id>=catalog.length)throw Error('재추첨 결과를 확인하세요.');
    state.powers.reroll--;state.hand[action.slot]=id;
  } else throw Error('지원하지 않는 행동입니다.');
  const result=resolveRows(state),reward=placementScore+result.lineScore+result.acquired*50;
  state.score+=reward;
  if(state.placementCounter===7) {
    state.placementCounter=0;
    if(options.spawn!==false&&state.powers.dot+state.powers.reroll<7) {
      const empty=[];for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)if(!(state.rows[y]&(1<<x))&&!state.icons.some(i=>i.x===x&&i.y===y))empty.push({x,y});
      if(empty.length) {
        if(state.icons.length===3)state.icons.shift();
        spawned={...empty[Math.floor(rng()*empty.length)],type:rng()<.4?'dot':'reroll'};state.icons.push(spawned);
      }
    }
  }
  if(options.draw!==false&&state.hand.every(id=>id===null))state.hand=Array.from({length:3},()=>drawPiece(catalog,state.lines,rng,options.stageWeights));
  return {state,reward,cleared:result.cleared,acquired:result.acquired,spawned};
}
export const FEATURE_NAMES=['bias','occupied','rowPotential','emptyRows','horizontalRoom','verticalRoom','isolatedEmpty','dot','reroll','remainingPieces','handSize','largestPiece','placementCounter','stage','icons'];
export function features(state,catalog=DEFAULT_CATALOG) {
  let occupied=0,potential=0,emptyRows=0,horizontal=0,vertical=0,isolated=0;
  for(let y=0;y<HEIGHT;y++) {
    const row=state.rows[y],n=POP[row],empty=FULL^row;
    occupied+=n;potential+=n*n;if(!row)emptyRows++;
    horizontal+=POP[empty&(empty<<1)&FULL];
    if(y<HEIGHT-1)vertical+=POP[empty&(FULL^state.rows[y+1])];
    const neighbours=((empty<<1)|(empty>>>1)|(y?FULL^state.rows[y-1]:0)|(y<HEIGHT-1?FULL^state.rows[y+1]:0))&FULL;
    isolated+=POP[empty&(~neighbours&FULL)];
  }
  const sizes=state.hand.filter(id=>id!==null).map(id=>catalog[id].size);
  return [1,occupied/160,potential/1600,emptyRows/16,horizontal/144,vertical/150,isolated/160,state.powers.dot/7,state.powers.reroll/7,sizes.length/3,sizes.reduce((a,b)=>a+b,0)/60,(sizes.length?Math.max(...sizes):0)/20,state.placementCounter/7,stageOf(state.lines)/4,state.icons.length/3];
}
export function signature(catalog,stageWeights=null) { return JSON.stringify({rules:RULE_VERSION,shapes:catalog.map(p=>({name:p.name,columns:p.columns})),stageWeights}); }
