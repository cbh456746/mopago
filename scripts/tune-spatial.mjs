import fs from 'node:fs/promises';
import os from 'node:os';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {DEFAULT_CATALOG} from '../src/game.js';
import {validateModel} from '../src/expert-agent.js';
import {DEFAULT_STAGE_WEIGHTS} from '../src/stage-distributions.js';
import {evaluate,summarize} from './lib/evaluation.mjs';

if(!isMainThread){
  parentPort.on('message',job=>{try{parentPort.postMessage({id:job.id,result:evaluate(job.model,DEFAULT_STAGE_WEIGHTS,job)});}
    catch(error){parentPort.postMessage({id:job.id,error:error.stack});}});
}else{
  const base=validateModel(JSON.parse(await fs.readFile(process.argv[2]??new URL('../.local/expert-candidate.json',import.meta.url),'utf8')),DEFAULT_CATALOG,DEFAULT_STAGE_WEIGHTS);
  if(!base.training||base.training.spatialTuning)throw Error('Use an untuned training candidate');
  const pairs=[[null,null],[1,.5],[1.5,.75],[2,1],[2.5,1.25],[3,1.5],[2,.5],[2,1.5]];
  const models=pairs.map(([h,v],index)=>{const model=structuredClone(base);
    if(h!==null){model.weights[16]=-h;model.weights[17]=-v;}return {index,model};});
  const trainingSeed=111303,games=80,validationSeed=193011,validationCount=200;
  const workers=Array.from({length:Math.min(10,Math.max(1,os.availableParallelism()-2))},()=>new Worker(new URL(import.meta.url)));
  let sequence=0;
  async function batch(jobs){
    const results=Array(jobs.length);let cursor=0;
    await Promise.all(workers.map(async worker=>{while(cursor<jobs.length){
      const index=cursor++,id=sequence++;
      results[index]=await new Promise((resolve,reject)=>{
        const failed=e=>{worker.off('message',received);reject(e);};
        const received=m=>{if(m.id!==id)return;worker.off('message',received);worker.off('error',failed);m.error?reject(Error(m.error)):resolve(m.result);};
        worker.on('message',received);worker.once('error',failed);worker.postMessage({...jobs[index],id});
      });
    }}));return results;
  }
  async function play(model,count,seed){
    const jobs=[];for(let offset=0;offset<count;offset+=10)jobs.push({model,games:Math.min(10,count-offset),seed,offset});
    const results=await batch(jobs);
    if(results.some(r=>r.truncated))throw Error('A game hit the action cap');
    return summarize(results.flatMap(r=>r.scores),{truncated:0});
  }
  const objective=m=>Math.log(m.averageScore/100000)+.15*Math.log(m.p90Score/130000);
  try{
    // Candidate games use a common seed; this is optimization, not held-out evaluation.
    const results=[];
    for(const entry of models){const metrics=await play(entry.model,games,trainingSeed);results.push({...entry,metrics});console.log(JSON.stringify({phase:'spatial-search',index:entry.index,...metrics}));}
    const ranked=results.filter(r=>r.index!==0).sort((a,b)=>objective(b.metrics)-objective(a.metrics));
    const finalists=[results[0],...ranked.slice(0,2)],checked=[];
    for(const entry of finalists){const metrics=await play(entry.model,validationCount,validationSeed);checked.push({...entry,metrics});console.log(JSON.stringify({phase:'spatial-validation',index:entry.index,...metrics}));}
    checked.sort((a,b)=>objective(b.metrics)-objective(a.metrics));
    const selected=checked[0],candidate=structuredClone(selected.model);
    const trainingGames=models.length*games,validationGames=finalists.length*validationCount;
    candidate.episodes=base.episodes+trainingGames;candidate.metrics=null;
    candidate.training.additionalGames=candidate.episodes;
    candidate.training.validationGames+=validationGames;
    candidate.training.spatialTuning={candidates:models.length,gamesPerCandidate:games,trainingGames,trainingSeed,
      validationSeed,validationCount,validationGames,selectedIndex:selected.index,horizontalVerticalPenalties:pairs[selected.index]};
    candidate.training.validation=selected.metrics;
    await fs.mkdir(new URL('../.local/',import.meta.url),{recursive:true});
    await fs.writeFile(new URL('../.local/expert-candidate.json',import.meta.url),JSON.stringify(candidate,null,2)+'\n');
    await fs.writeFile(new URL('../.local/spatial-tuning.json',import.meta.url),JSON.stringify({results,checked},null,2)+'\n');
    console.log(JSON.stringify({complete:true,selectedIndex:selected.index,additionalGames:candidate.episodes,...selected.metrics}));
  }finally{await Promise.all(workers.map(w=>w.terminate()));}
}
