import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const htmlPath=process.env.REFRAME_HTML||fileURLToPath(new URL('../dist/index.html',import.meta.url));
const html=await readFile(htmlPath);
const portArg=process.argv.indexOf('--port');
const port=portArg>=0?Number(process.argv[portArg+1]):0;
const server=createServer((req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
  if(req.url==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(req.url!=='/'&&req.url!=='/index.html'){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:html);
});
server.on('error',error=>{console.error('无法启动本机服务：',error.message);process.exit(1);});
server.listen(port,'127.0.0.1',()=>{const address=server.address();const url=`http://127.0.0.1:${address.port}/`;console.log(`折形 Reframe 已就绪\n${url}\n图片仅在本机处理。关闭此窗口或按 Ctrl+C 停止。`);if(process.argv.includes('--open')){const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';spawn(command,[url],{stdio:'ignore'}).on('error',()=>{});}});
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
