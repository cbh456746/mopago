import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),dist=new URL('../dist/',import.meta.url);
const projectPath=path.resolve(fileURLToPath(root)),outputPath=path.resolve(fileURLToPath(dist));
if(outputPath!==path.join(projectPath,'dist'))throw Error('Refusing to replace unexpected output path');
const version=process.env.BUILD_VERSION??'local';
if(!/^[A-Za-z0-9_-]{1,64}$/.test(version))throw Error('Invalid build version');
// Only the verified generated output directory is replaced.
await fs.rm(outputPath,{recursive:true,force:true});
const release=new URL(`releases/${version}/`,dist);
await fs.mkdir(release,{recursive:true});
for(const file of ['style.css','favicon.svg'])await fs.copyFile(new URL(file,root),new URL(file,release));
for(const dir of ['src','models'])await fs.mkdir(new URL(dir+'/',release),{recursive:true});
for(const file of ['src/app.js','src/game.js','src/expert-agent.js','src/session.js','src/stage-distributions.js','src/worker.js','models/default.json'])
  await fs.copyFile(new URL(file,root),new URL(file,release));
let html=await fs.readFile(new URL('index.html',root),'utf8');
for(const file of ['style.css','favicon.svg','src/app.js'])html=html.replace(`./${file}`,`./releases/${version}/${file}`);
await fs.writeFile(new URL('index.html',dist),html);
await fs.writeFile(new URL('.nojekyll',dist),'');
console.log('Static site ready: dist/ (gameplay app and one trained model)');
