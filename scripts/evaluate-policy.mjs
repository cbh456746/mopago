import fs from 'node:fs/promises';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {DEFAULT_CATALOG} from '../src/game.js';
import {validateModel} from '../src/expert-agent.js';
import {DEFAULT_STAGE_WEIGHTS} from '../src/stage-distributions.js';
import {evaluate,summarize} from './lib/evaluation.mjs';

if(!isMainThread) {
  parentPort.on('message',job=>{try{parentPort.postMessage({id:job.id,result:evaluate(job.model,DEFAULT_STAGE_WEIGHTS,job)});}
    catch(error){parentPort.postMessage({id:job.id,error:error.stack});}});
}else {
  const file=process.argv[2]??new URL('../models/default.json',import.meta.url),gamesPerSeed=Number(process.argv[3]??500);
  if(!Number.isInteger(gamesPerSeed)||gamesPerSeed<1)throw Error('gamesPerSeed must be a positive integer');
  const model=validateModel(JSON.parse(await fs.readFile(file,'utf8')),DEFAULT_CATALOG,DEFAULT_STAGE_WEIGHTS);
  const seeds=[1141003,1152009,1163017],chunk=10,jobs=[];
  for(const seed of seeds)for(let offset=0;offset<gamesPerSeed;offset+=chunk)
    jobs.push({model,games:Math.min(chunk,gamesPerSeed-offset),seed,offset});
  const workers=Array.from({length:Math.min(10,Math.max(1,os.availableParallelism()-2))},()=>new Worker(new URL(import.meta.url)));
  let cursor=0,done=0;const results=Array(jobs.length),started=Date.now();
  try{await Promise.all(workers.map(async worker=>{while(cursor<jobs.length){
    const index=cursor++,job=jobs[index];
    results[index]=await new Promise((resolve,reject)=>{
      const failed=error=>{worker.off('message',received);reject(error);};
      const received=m=>{if(m.id!==index)return;worker.off('message',received);worker.off('error',failed);m.error?reject(Error(m.error)):resolve(m.result);};
      worker.on('message',received);worker.once('error',failed);worker.postMessage({...job,id:index});
    });done+=job.games;if(done%100===0)console.log(JSON.stringify({completed:done,total:gamesPerSeed*seeds.length}));
  }}));}finally{await Promise.all(workers.map(w=>w.terminate()));}
  const aggregate=items=>{
    const totals={truncated:0,totalSteps:0,totalLines:0,abilities:{spawnedDot:0,spawnedReroll:0,acquired:0,usedDot:0,usedReroll:0}};
    for(const r of items){for(const k of ['truncated','totalSteps','totalLines'])totals[k]+=r[k];for(const k in totals.abilities)totals.abilities[k]+=r.abilities[k];}
    return summarize(items.flatMap(r=>r.scores),totals);
  };
  const fingerprint=createHash('sha256').update(JSON.stringify({signature:model.signature,weights:model.weights,featureNames:model.featureNames,gamma:model.gamma,search:model.search})).digest('hex');
  const engineSha256=createHash('sha256').update((await fs.readFile(new URL('../src/expert-agent.js',import.meta.url),'utf8')).replaceAll('\r\n','\n')).digest('hex');
  const result={modelFormat:model.format,policySha256:fingerprint,engineSha256,distribution:'mild-small-piece-decline',seeds,gamesPerSeed,maxSteps:10000,search:model.search,
    p90Definition:'nearest rank: sorted[ceil(0.9*N)-1]',...aggregate(results),
    runs:seeds.map(seed=>({seed,...aggregate(results.filter((_,i)=>jobs[i].seed===seed))})),elapsedSeconds:(Date.now()-started)/1000};
  result.targets={average:100000,p90:130000,averageMet:result.averageScore>=100000,p90Met:result.p90Score>=130000};
  await fs.mkdir(new URL('../.local/',import.meta.url),{recursive:true});
  await fs.writeFile(new URL('../.local/held-out-evaluation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
