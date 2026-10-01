import {WIDTH,HEIGHT,FULL,DEFAULT_SHAPES,createCatalog,initialState,validateState,stageOf,popcount} from './game.js';
import {validateModel} from './expert-agent.js';
import {migrateDefaultState,advanceRecommendation,validateStatuses} from './session.js';
import {DEFAULT_STAGE_WEIGHTS} from './stage-distributions.js';
const $=id=>document.getElementById(id),make=(tag,className='',text='')=>{const el=document.createElement(tag);el.className=className;el.textContent=text;return el;};
const KEY='mopago.state.v1';
let shapes=structuredClone(DEFAULT_SHAPES),catalog=createCatalog(shapes),stageWeights=DEFAULT_STAGE_WEIGHTS,state=initialState(),slotStatus=['pending','pending','pending'];
let model=null,modelReady=false,activeSlot=0,brush='fill',history=[],cells=[],inputs=[],previews=[],usedButtons=[];
let result=null,selected=0,recWorker=null,recId=0,timer=null,toastTimer=null,drag=null;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function persist(){try{localStorage.setItem(KEY,JSON.stringify({version:1,shapes,stageWeights,state,slotStatus}));}catch{toast('브라우저에 자동 저장하지 못했습니다. 현재 화면에서는 계속 사용할 수 있습니다.');}}
function remember(){history.push({state:structuredClone(state),slotStatus:[...slotStatus]});if(history.length>80)history.shift();}
function invalidate(){$('next-step').disabled=true;recId++;result=null;selected=0;clearTimeout(timer);if(recWorker){recWorker.terminate();recWorker=null;}$('recommendations').replaceChildren();$('move-detail').hidden=true;}
function changed(){invalidate();persist();renderBoard();renderCounters();$('undo').disabled=!history.length;timer=setTimeout(requestRecommendation,300);}
function edit(fn){const before={state:structuredClone(state),slotStatus:[...slotStatus]};remember();try{fn();validateState(state,catalog);changed();}catch(error){history.pop();state=before.state;slotStatus=before.slotStatus;toast(error.message);renderAll();}}
function drawMini(container,piece){container.replaceChildren();if(!piece){container.append(make('span','slot-placeholder','·'));return;}const v=piece.variants[0],grid=make('div','mini-piece');grid.style.setProperty('--w',v.width);grid.style.setProperty('--h',v.height);const occupied=new Set(v.cells.map(([x,y])=>y*v.width+x));for(let i=0;i<v.width*v.height;i++)grid.append(make('span','mini-cell'+(occupied.has(i)?' on':'')));container.append(grid);}
function renderSlot(i){const slot=$('slot-'+i),id=state.hand[i];slot.classList.toggle('active',activeSlot===i);slot.classList.toggle('used',slotStatus[i]==='used');inputs[i].classList.toggle('invalid',slotStatus[i]==='pending'&&inputs[i].value.trim()!=='');drawMini(previews[i],id===null?null:catalog[id]);usedButtons[i].textContent=slotStatus[i]==='used'?'다시 입력':'사용 완료';}
function renderSlots(){for(let i=0;i<3;i++){inputs[i].value=state.hand[i]===null?'':catalog[state.hand[i]].name;renderSlot(i);}}
function activate(i,focus=true){activeSlot=i;for(let j=0;j<3;j++)renderSlot(j);if(focus){inputs[i].focus();inputs[i].select();}}
const jamo={'ᄀ':'ㄱ','ᄂ':'ㄴ','ᄃ':'ㄷ','ᄅ':'ㄹ','ᄆ':'ㅁ','ᄇ':'ㅂ','ᄉ':'ㅅ','ᄋ':'ㅇ','ᄌ':'ㅈ','ᄎ':'ㅊ','ᄏ':'ㅋ','ᄐ':'ㅌ','ᄑ':'ㅍ','ᄒ':'ㅎ','ᅡ':'ㅏ','ᅣ':'ㅑ','ᅳ':'ㅡ','ᅵ':'ㅣ','·':'.','ㆍ':'.'};
function setPiece(i,value,{fromInput=false}={}){value=jamo[value.trim()]??value.trim();const id=catalog.findIndex(p=>p.name===value);if(state.hand[i]===(id<0?null:id)&&slotStatus[i]===(id<0?'pending':'ready'))return;edit(()=>{state.hand[i]=id<0?null:id;slotStatus[i]=id<0?'pending':'ready';});if(!fromInput)inputs[i].value=id<0?'':catalog[id].name;renderSlot(i);}
function buildSlots(){ $('slots').replaceChildren();inputs=[];previews=[];usedButtons=[];for(let i=0;i<3;i++){const slot=make('div','slot');slot.id='slot-'+i;const heading=make('div','slot-number',`${i+1}번 슬롯`);heading.append(make('span','',String(i+1)));const input=make('input');input.type='text';input.maxLength=16;input.placeholder='입력';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',`${i+1}번 슬롯 블록 입력`);const preview=make('div','piece-preview');preview.setAttribute('aria-hidden','true');const used=make('button','quiet','사용 완료');used.type='button';used.setAttribute('aria-label',`${i+1}번 슬롯 사용 완료 또는 다시 입력`);slot.append(heading,input,preview,used);$('slots').append(slot);inputs.push(input);previews.push(preview);usedButtons.push(used);input.addEventListener('focus',()=>activate(i,false));input.addEventListener('input',()=>setPiece(i,input.value,{fromInput:true}));input.addEventListener('compositionend',()=>setPiece(i,input.value,{fromInput:true}));input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();activate((i+1)%3);}});used.addEventListener('click',()=>{edit(()=>{state.hand[i]=null;slotStatus[i]=slotStatus[i]==='used'?'pending':'used';});renderSlot(i);input.value='';});}
  $('palette').replaceChildren();catalog.forEach((piece,id)=>{const b=make('button','',piece.name);b.type='button';b.title=`${piece.name} · ${piece.variants[0].width}×${piece.variants[0].height} · ${piece.size}칸`;b.setAttribute('aria-label',`${piece.name} 블록 선택`);b.addEventListener('click',()=>{setPiece(activeSlot,piece.name);activate(activeSlot);});$('palette').append(b);});renderSlots();}
function buildBoard(){const board=$('board');board.replaceChildren();cells=[];$('column-labels').replaceChildren();$('row-labels').replaceChildren();for(let x=1;x<=WIDTH;x++)$('column-labels').append(make('span','',String(x)));for(let y=0;y<HEIGHT;y++){ $('row-labels').append(make('span','',String(y+1)));const row=make('div','board-row');row.style.display='contents';row.setAttribute('role','row');for(let x=0;x<WIDTH;x++){const b=make('button','board-cell');b.type='button';b.setAttribute('role','gridcell');b.tabIndex=x===0&&y===0?0:-1;b.dataset.x=x;b.dataset.y=y;b.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();focusCell(y*WIDTH+x);remember();drag={brush,value:!(state.rows[y]&(1<<x)),visited:new Set()};paint(x,y);});b.addEventListener('pointerenter',()=>{if(drag)paint(x,y);});b.addEventListener('click',event=>{if(event.detail===0){remember();drag={brush,value:!(state.rows[y]&(1<<x)),visited:new Set()};paint(x,y);drag=null;}});b.addEventListener('keydown',event=>{const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:-WIDTH,ArrowDown:WIDTH};if(event.key in moves){event.preventDefault();const n=Math.max(0,Math.min(WIDTH*HEIGHT-1,y*WIDTH+x+moves[event.key]));focusCell(n);}});row.append(b);cells.push(b); }board.append(row); }renderBoard();}
function focusCell(n){cells.forEach((b,i)=>b.tabIndex=i===n?0:-1);cells[n].focus();}
function paint(x,y){const key=y*WIDTH+x;if(drag.visited.has(key))return;drag.visited.add(key);if(drag.brush==='fill'){if(drag.value)state.rows[y]|=1<<x;else state.rows[y]&=~(1<<x);}else if(drag.brush==='erase'){state.rows[y]&=~(1<<x);state.icons=state.icons.filter(i=>i.x!==x||i.y!==y);}else if(drag.brush==='remove-icon'){state.icons=state.icons.filter(i=>i.x!==x||i.y!==y);}else{const exists=state.icons.find(i=>i.x===x&&i.y===y);state.icons=state.icons.filter(i=>i.x!==x||i.y!==y);if(exists?.type!==drag.brush){if(state.icons.length===3)state.icons.shift();state.icons.push({x,y,type:drag.brush});}}changed();}
document.addEventListener('pointerup',()=>drag=null);document.addEventListener('pointercancel',()=>drag=null);
function renderBoard(){const chosen=result?.recommendations[selected],a=chosen?.action,ghost=new Set();if(a?.type==='place'){const p=catalog[state.hand[a.slot]],v=p?.variants[a.variant];v?.cells.forEach(([x,y])=>ghost.add((a.y+y)*WIDTH+a.x+x));}else if(a?.type==='dot')ghost.add(a.y*WIDTH+a.x);for(let i=0;i<cells.length;i++){const x=i%WIDTH,y=Math.floor(i/WIDTH),filled=!!(state.rows[y]&(1<<x)),icon=state.icons.find(p=>p.x===x&&p.y===y);cells[i].className='board-cell'+(filled?' filled':'')+(ghost.has(i)?' ghost':'')+(chosen?.cleared.includes(y)?' clearing':'')+(a?.x===x&&a?.y===y?' anchor':'');cells[i].textContent=icon?(icon.type==='dot'?'◎':'↻'):'';cells[i].setAttribute('aria-label',`${x+1}열 ${y+1}행, ${filled?'채워짐':'빈 칸'}${icon?', '+(icon.type==='dot'?'점':'교체')+' 능력 아이콘':''}${ghost.has(i)?', 추천 배치':''}`);cells[i].setAttribute('aria-selected',ghost.has(i)?'true':'false');}$('board-count').textContent=`${state.rows.reduce((n,row)=>n+popcount(row),0)} / 160칸`;}
function renderCounters(){
  $('dot-count').value=state.powers.dot;$('reroll-count').value=state.powers.reroll;
  $('line-count').value=state.lines;$('placement-counter').value=state.placementCounter;
  $('stage-label').textContent=`출현 단계 ${stageOf(state.lines)+1} / 5`;
  $('undo').disabled=!history.length;
}
function renderAll(){renderBoard();renderSlots();renderCounters();}
function requestRecommendation(){clearTimeout(timer);if(!modelReady){$('recommend-status').textContent='학습 모델을 준비하고 있습니다.';return;}if(slotStatus.some(s=>s==='pending')){$('recommend-status').textContent=slotStatus.every(s=>s==='pending')&&state.hand.every(id=>id===null)?'실제 게임에서 새로 나온 세 조각을 입력하세요.':'남은 조각을 입력하고, 이미 사용한 슬롯은 ‘사용 완료’로 표시하세요.';return;}if(state.hand.every(id=>id===null)){$('recommend-status').textContent='다음 세 조각을 입력하세요.';return;}if(state.rows.some(row=>row===FULL)){$('recommend-status').textContent='완전히 채워진 줄이 있습니다. 게임에서 지워진 뒤의 보드를 입력하세요.';return;}invalidate();const id=++recId;recWorker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});$('recommend-status').textContent='가능한 배치와 능력 사용을 비교하고 있습니다…';recWorker.onmessage=({data})=>{if(data.id!==recId)return;if(data.type==='error'){$('recommend-status').textContent=data.message;return;}result=data.result;selected=0;showRecommendations();recWorker?.terminate();recWorker=null;};recWorker.onerror=()=>{$('recommend-status').textContent='추천 엔진을 불러오지 못했습니다. 로컬 서버 또는 HTTPS에서 실행해 주세요.';};recWorker.postMessage({id,type:'recommend',shapes,stageWeights,model,state});}
function describe(a){if(a.type==='reroll')return {title:`${a.slot+1}번 조각 바꿔 뽑기`,detail:'교체 능력 1개 사용 · 결과는 무작위'};if(a.type==='dot')return {title:`(${a.x+1}, ${a.y+1})에 점 찍기`,detail:'점 능력 1개 사용 · 1칸 채우기'};const p=catalog[state.hand[a.slot]],v=p.variants[a.variant];return {title:`${a.slot+1}번 ${p.name} → (${a.x+1}, ${a.y+1})`,detail:`${v.mirror?'좌우반전 후 ':''}${v.rotation?`${v.rotation}° 시계방향 회전`:'기본 방향'} · ${p.size}칸`};}
function showRecommendations(){const list=$('recommendations');list.replaceChildren();if(!result.recommendations.length){$('recommend-status').textContent='회전·반전과 보유 능력을 포함해 가능한 행동이 없습니다. 입력을 확인하세요.';renderBoard();return;}$('recommend-status').textContent='추천 카드를 선택하면 보드에 표시됩니다. 좌표는 (열, 행)입니다.';result.recommendations.forEach((c,i)=>{const d=describe(c.action),b=make('button','recommend-card'+(i===selected?' selected':''));b.type='button';b.append(make('span','rank',i===0?'추천 01':`대안 ${String(i+1).padStart(2,'0')}`),make('strong','',d.title),make('span','action-detail',d.detail),make('span','points',c.action.type==='reroll'?'재추첨 후 조각을 다시 입력하세요':`즉시 +${c.reward}점 · ${c.cleared.length}줄 제거${c.acquired?' · 능력 '+c.acquired+'개 획득':''}`));b.addEventListener('click',()=>{selected=i;showRecommendations();});list.append(b);});const c=result.recommendations[selected],d=describe(c.action),detail=$('move-detail');detail.hidden=false;detail.replaceChildren();let message=c.action.type==='reroll'?'새로 나온 조각은 직접 입력해야 합니다.':`진한 점은 블록을 둘러싼 직사각형의 왼쪽 위 기준칸입니다. ${c.action.type==='place'?'기준칸 자체는 빈 모양일 수도 있습니다.':'노란 칸을 채우세요.'}`;if(c.plan.length>1)message+=` 이후 ${c.plan.length-1}행동까지 비교했으며, 실제 새 아이콘·추첨 결과에 따라 다시 추천합니다.`;detail.append(make('p','',message));$('next-step').disabled=false;renderBoard();}
function applyMove(action){
  const beforeCounter=state.placementCounter;
  edit(()=>{
    const next=advanceRecommendation(state,slotStatus,action,catalog,stageWeights);
    state=next.state;slotStatus=next.slotStatus;
    if(action.type==='reroll')toast('교체 능력 1개를 사용했습니다. 실제로 나온 새 조각을 해당 슬롯에 입력하세요.');
    else toast(`다음 단계로 진행했습니다. 즉시 +${next.reward}점${next.needsHand?' · 새로 나온 세 조각을 입력하세요.':''}${beforeCounter===6&&action.type==='place'&&state.powers.dot+state.powers.reroll<7?' · 새 아이콘은 실제 위치에 직접 표시하세요.':''}`);
  });
  renderSlots();
  if(action.type==='reroll')activate(action.slot);
  else if(slotStatus.every(s=>s==='pending'))activate(0);
}
$('next-step').addEventListener('click',()=>{
  const chosen=result?.recommendations[selected];
  if(chosen)applyMove(chosen.action);
});
document.querySelectorAll('[data-brush]').forEach(b=>b.addEventListener('click',()=>{brush=b.dataset.brush;document.querySelectorAll('[data-brush]').forEach(p=>p.setAttribute('aria-pressed',String(p===b)));}));
$('recommend').addEventListener('click',requestRecommendation);
$('undo').addEventListener('click',()=>{const previous=history.pop();if(previous){state=previous.state;slotStatus=previous.slotStatus;changed();renderAll();}});
$('clear-board').addEventListener('click',()=>edit(()=>{state.rows=Array(HEIGHT).fill(0);state.icons=[];}));
$('reset-game').addEventListener('click',()=>{
  invalidate();
  state=initialState();slotStatus=['pending','pending','pending'];
  history=[];activeSlot=0;brush='fill';drag=null;
  document.querySelectorAll('[data-brush]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.brush===brush)));
  cells.forEach((cell,i)=>cell.tabIndex=i===0?0:-1);
  persist();renderAll();activate(0);requestRecommendation();
  toast('보드·조각·능력·진행 기록을 모두 초기화했습니다.');
});
for(const kind of ['dot','reroll'])$(kind+'-count').addEventListener('change',event=>edit(()=>state.powers[kind]=Number(event.target.value)));
function updateLineCount(event){if(event.target.value==='')return;const lines=Number(event.target.value);if(lines===state.lines)return;edit(()=>state.lines=lines);}
$('line-count').addEventListener('input',updateLineCount);
$('line-count').addEventListener('change',updateLineCount);
$('placement-counter').addEventListener('change',event=>edit(()=>state.placementCounter=Number(event.target.value)));
document.addEventListener('keydown',event=>{if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(['1','2','3'].includes(event.key)){event.preventDefault();activate(Number(event.key)-1);}});
function restoreState(){
  try{
    const stored=JSON.parse(localStorage.getItem(KEY));if(!stored)return;
    const data=migrateDefaultState(stored);
    if(data.version!==1)throw Error('저장 형식을 확인하세요.');
    validateState(data.state,catalog);validateStatuses(data.slotStatus,data.state);
    state=data.state;slotStatus=data.slotStatus;persist();
  }catch{toast('저장된 상태를 읽지 못했습니다. 현재 지원하는 조각으로 다시 입력하세요.');}
}
async function loadModel(){
  try{
    const response=await fetch(new URL('../models/default.json',import.meta.url));
    if(!response.ok)throw Error('모델 파일을 불러오지 못했습니다.');
    model=validateModel(await response.json(),catalog,stageWeights);modelReady=true;
    requestRecommendation();
  }catch(error){$('recommend-status').textContent=error.message+' 페이지를 새로고침해 주세요.';}
}
const observer=new MutationObserver(()=>{
  const a=result?.recommendations[selected]?.action;
  $('board-preview-label').textContent=a?'추천: '+describe(a).title+' · '+describe(a).detail:'현재 게임 상태를 직접 입력하세요.';
});
observer.observe($('recommendations'),{childList:true});
$('board').addEventListener('pointermove',event=>{
  if(!drag||event.pointerType==='mouse')return;
  const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('.board-cell');
  if(cell&&$('board').contains(cell))paint(Number(cell.dataset.x),Number(cell.dataset.y));
});
restoreState();buildBoard();buildSlots();renderCounters();loadModel();
