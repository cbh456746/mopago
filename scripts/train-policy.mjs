import fs from 'node:fs/promises';
import os from 'node:os';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {DEFAULT_CATALOG,seededRandom} from '../src/game.js';
import {validateModel} from '../src/expert-agent.js';
import {DEFAULT_STAGE_WEIGHTS} from '../src/stage-distributions.js';
import {evaluate,summarize} from './lib/evaluation.mjs';

if(!isMainThread) {
  parentPort.on('message',job=>{
    try{parentPort.postMessage({id:job.id,metrics:evaluate(job.model,job.weights,job)});}
    catch(error){parentPort.postMessage({id:job.id,error:error.stack});}
  });
}else {
  const rounds=Number(process.argv[2]??30),games=Number(process.argv[3]??24),population=Number(process.argv[4]??16);
  if(![rounds,games,population].every(Number.isInteger)||rounds<1||rounds>100||games<1||games>1000||population<6||population>64)throw Error('Use rounds 1-100, games 1-1000, population 6-64');
  const base=JSON.parse(await fs.readFile(process.argv[5]??new URL('../models/default.json',import.meta.url),'utf8'));
  validateModel(base,DEFAULT_CATALOG,DEFAULT_STAGE_WEIGHTS);
  await fs.mkdir(new URL('../.local/',import.meta.url),{recursive:true});
  const weights=JSON.parse(base.signature).stageWeights;
  const workers=Array.from({length:Math.min(10,Math.max(1,os.availableParallelism()-2))},()=>new Worker(new URL(import.meta.url)));
  let sequence=0,trainingGames=0,validationGames=0,mean=[...base.weights];
  let spread=[.3,1.2,1.2,.8,1,1,1.5,.6,.6,1,1,1,.3,.2,1,.6,.6,.6,.6,.6,.6];
  const seed=202610011,rng=seededRandom(seed),started=Date.now(),history=[];
  async function batch(jobs) {
    let cursor=0;const results=Array(jobs.length);
    await Promise.all(workers.map(async worker=>{while(cursor<jobs.length){
      const index=cursor++,id=sequence++;
      const metrics=await new Promise((resolve,reject)=>{
        const failed=error=>{worker.off('message',receive);reject(error);};
        const receive=m=>{if(m.id!==id)return;worker.off('message',receive);worker.off('error',failed);m.error?reject(Error(m.error)):resolve(m.metrics);};
        worker.on('message',receive);worker.once('error',failed);worker.postMessage({...jobs[index],weights,id});
      });results[index]=metrics;
    }}));return results;
  }
  async function check(model,count,checkSeed) {
    const chunk=10,jobs=[];
    for(let offset=0;offset<count;offset+=chunk)jobs.push({model,games:Math.min(chunk,count-offset),seed:checkSeed,offset});
    const results=await batch(jobs);
    return {model,metrics:summarize(results.flatMap(r=>r.scores),{truncated:results.reduce((n,r)=>n+r.truncated,0)})};
  }
  const validationSeed=730031,validationCount=100;
  let incumbent=await check(base,validationCount,validationSeed),selectedRound=0;validationGames+=validationCount;
  const objective=m=>Math.log(Math.max(m.averageScore,1)/100000)+.15*Math.log(Math.max(m.p90Score,1)/130000);
  console.log(JSON.stringify({phase:'initial-validation',...incumbent.metrics,workers:workers.length}));
  try{
    for(let round=0;round<rounds;round++) {
      const normal=()=>Math.sqrt(-2*Math.log(Math.max(rng(),1e-12)))*Math.cos(2*Math.PI*rng());
      const models=[structuredClone(base),structuredClone(incumbent.model),{...structuredClone(base),weights:[...mean]}];
      while(models.length<population){const noise=spread.map(s=>s*normal());
        for(const sign of [1,-1])if(models.length<population)models.push({...structuredClone(base),weights:mean.map((w,i)=>Math.max(-50,Math.min(50,w+sign*noise[i])))});
      }
      const trainingSeed=(3100000+Math.imul(round,104729)+seed)>>>0;
      const metrics=await batch(models.map(model=>({model,games,seed:trainingSeed})));
      const ranked=models.map((model,i)=>({model,metrics:metrics[i]})).sort((a,b)=>objective(b.metrics)-objective(a.metrics));
      trainingGames+=population*games;
      if(metrics.some(m=>m.truncated))throw Error('A training game hit the action cap; increase maxSteps before claiming complete games');
      const elite=ranked.slice(0,Math.max(3,Math.floor(population/4))),eliteMean=mean.map((_,i)=>elite.reduce((n,c)=>n+c.model.weights[i],0)/elite.length);
      mean=mean.map((w,i)=>.4*w+.6*eliteMean[i]);
      spread=spread.map((s,i)=>Math.max(.08,.4*s+.6*Math.sqrt(elite.reduce((n,c)=>n+(c.model.weights[i]-eliteMean[i])**2,0)/elite.length)));
      const finalists=[ranked[0].model,{...structuredClone(base),weights:[...mean]}];
      for(const model of finalists){const checked=await check(model,validationCount,validationSeed);validationGames+=validationCount;
        if(objective(checked.metrics)>objective(incumbent.metrics)){incumbent=checked;selectedRound=round+1;}}
      const record={round:round+1,trainingSeed,trainingBest:ranked[0].metrics.averageScore,
        validationAverage:incumbent.metrics.averageScore,validationP90:incumbent.metrics.p90Score,trainingGames,validationGames};history.push(record);
      const candidate=structuredClone(incumbent.model);candidate.episodes=trainingGames;candidate.metrics=null;
      candidate.training={algorithm:'episodic-cross-entropy-policy-search',objective:'log(mean/100000) + 0.15 log(P90/130000)',
        additionalGames:trainingGames,validationGames,seed,rounds:round+1,selectedRound,population,gamesPerCandidate:games,
        validationSeed,validationCount,maxSteps:10000,search:candidate.search,initialization:'warm-start from supplied expert policy weights',
        validation:incumbent.metrics};
      await fs.writeFile(new URL('../.local/expert-candidate.json',import.meta.url),JSON.stringify(candidate,null,2)+'\n');
      await fs.writeFile(new URL('../.local/expert-search.json',import.meta.url),JSON.stringify({settings:{rounds,games,population,seed,validationSeed,validationCount},history,elapsedSeconds:(Date.now()-started)/1000},null,2)+'\n');
      console.log(JSON.stringify(record));
    }
  }finally{await Promise.all(workers.map(w=>w.terminate()));}
  console.log(JSON.stringify({complete:true,trainingGames,validationGames,...incumbent.metrics,elapsedSeconds:(Date.now()-started)/1000}));
}
