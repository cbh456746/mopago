import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),port=Number(process.env.PORT??8878);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),relative=pathname==='/'?'index.html':pathname.slice(1);
    const file=path.resolve(root,relative),allowed=file.startsWith(root+path.sep)&&!relative.split(/[\\/]/).some(p=>p.startsWith('.'))&&(['index.html','style.css','favicon.svg'].includes(relative)||/^(src|models)\//.test(relative));
    if(!allowed){res.writeHead(404);res.end('Not found');return;}
    const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
  }catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Mopago: http://127.0.0.1:${port}`));
