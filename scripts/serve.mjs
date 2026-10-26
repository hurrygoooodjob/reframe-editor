import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname,resolve,extname,sep } from 'node:path';
import { spawn } from 'node:child_process';
const htmlPath=process.env.NIUNIU_HTML||process.env.REFRAME_HTML||fileURLToPath(new URL('../dist/index.html',import.meta.url));
const root=dirname(resolve(htmlPath)),portArg=process.argv.indexOf('--port'),port=portArg>=0?Number(process.argv[portArg+1]):0;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream','.md':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  const path=pathname==='/'||pathname==='/index.html'?resolve(htmlPath):resolve(root,'.'+pathname);
  if(!path.startsWith(root+sep)||(!['/','/index.html'].includes(pathname)&&!pathname.startsWith('/models/')&&!pathname.startsWith('/vision/'))){res.writeHead(404);return res.end('Not found');}
  const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',error=>{console.error('无法启动本机服务：',error.message);process.exit(1);});
server.listen(port,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}/`;console.log(`Niuniu 已就绪\n${url}\n图片仅在本机处理。关闭此窗口或按 Ctrl+C 停止。`);if(process.argv.includes('--open'))spawn(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[url],{stdio:'ignore'}).on('error',()=>{});});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
