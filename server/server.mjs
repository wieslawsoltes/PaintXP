#!/usr/bin/env node
/** Dependency-free local HTTP + stdio MCP server. A browser tab explicitly authorizes the bridge. */
import http from 'node:http';
import {randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {MCP_TOOLS,validateTool} from '../src/commands.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stdio=process.argv.includes('--stdio');
const portArg=process.argv.indexOf('--port');
const requestedPort=Number(portArg>=0?process.argv[portArg+1]:process.env.PORT||(stdio?0:5173));
if(!Number.isInteger(requestedPort)||requestedPort<0||requestedPort>65535)throw new Error('Invalid port.');
const token=process.env.PAINT_MCP_TOKEN||randomBytes(32).toString('base64url');
if(token.length<24)throw new Error('PAINT_MCP_TOKEN must contain at least 24 characters.');
const VERSIONS=['2025-11-25','2025-06-18'];
const MAX_BODY=32*1024*1024,MAX_TASKS=32,TASK_TIMEOUT=120000;
const pending=new Map();let bridge=null,port=0,closing=false;
const log=message=>process.stderr.write(`[Paint MCP] ${message}\n`);
const safeEqual=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const authorized=req=>safeEqual(req.headers.authorization,`Bearer ${token}`);
const validOrigin=req=>!req.headers.origin||[`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin);
const validHost=req=>[`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host);
const json=(res,status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const rpcError=(id,code,message)=>({jsonrpc:'2.0',id:id??null,error:{code,message}});
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){const e=new Error('Request body exceeds 32 MiB.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Invalid JSON.');e.status=400;throw e;}}
function disconnect(reason='Browser disconnected.'){
  const previous=bridge;bridge=null;if(previous){clearInterval(previous.heartbeat);previous.stream?.end();}
  for(const [id,task] of pending){clearTimeout(task.timer);task.reject(new Error(reason));pending.delete(id);}
}
async function dispatch(name,args){
  validateTool(name,args);if(!bridge?.stream||bridge.stream.destroyed)throw new Error('No authorized Paint tab. Open the local app and enable Help → AI Agent Control (MCP).');
  if(pending.size>=MAX_TASKS)throw new Error('The agent queue is full. Wait for running operations to finish.');
  const id=randomUUID();return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);bridge?.stream?.write(`data: ${JSON.stringify({type:'cancel',id})}\n\n`);reject(new Error('The Paint command timed out after 120 seconds. Check the app before retrying a destructive command.'));},TASK_TIMEOUT);
    pending.set(id,{resolve,reject,timer,name});bridge.stream.write(`data: ${JSON.stringify({id,name,arguments:args,expiresAt:Date.now()+TASK_TIMEOUT})}\n\n`);
  });
}
function toolResult(result){
  if(result&&typeof result.data==='string'&&result.mimeType){const {data,...metadata}=result;
    if(['image/png','image/jpeg','image/webp'].includes(result.mimeType))return {content:[{type:'image',data,mimeType:result.mimeType},{type:'text',text:JSON.stringify(metadata)}],structuredContent:metadata};
    return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:metadata};
  }
  return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
}
async function rpc(message){
  if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return rpcError(message?.id,-32600,'Invalid JSON-RPC request. Batches are not supported.');
  if(message.id!==undefined&&typeof message.id!=='number'&&typeof message.id!=='string')return rpcError(null,-32600,'Request id must be a string or number.');
  const {id,method,params={}}=message;if(id===undefined){
    if(method==='notifications/cancelled'&&params.requestId!==undefined){/* Running browser edits cannot be safely rolled back remotely. */}
    return null;
  }
  let result;
  try{
    if(method==='initialize')result={protocolVersion:VERSIONS.includes(params.protocolVersion)?params.protocolVersion:VERSIONS[0],capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},serverInfo:{name:'paint-xp-webgpu',version:'1.0.0'},instructions:'Control the locally authorized Paint tab. Document coordinates are integer pixels. Start with paint_get_state. Tools mutate the live document; undo is available. Use paint_export with maxDimension:1024 for an image preview. No arbitrary JavaScript, URLs, or filesystem paths are accepted. The browser tab must be open and agent access enabled. Batches are ordered but not atomic.'};
    else if(method==='ping')result={};
    else if(method==='tools/list')result={tools:MCP_TOOLS};
    else if(method==='tools/call'){
      try{validateTool(params.name,params.arguments||{});}catch(e){return rpcError(id,-32602,e.message);}
      try{const start=Date.now();result=toolResult(await dispatch(params.name,params.arguments||{}));log(`${params.name}: completed in ${Date.now()-start} ms`);}catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}
    }
    else if(method==='resources/list')result={resources:[{uri:'paint://state',name:'Live Paint state',description:'Document, selection, history, renderer and agent status.',mimeType:'application/json'},{uri:'paint://guide',name:'Paint agent guide',description:'Editing workflow and local access requirements.',mimeType:'text/plain'}]};
    else if(method==='resources/templates/list')result={resourceTemplates:[]};
    else if(method==='resources/read'){
      if(params.uri==='paint://state')result={contents:[{uri:params.uri,mimeType:'application/json',text:JSON.stringify(await dispatch('paint_get_state',{}),null,2)}]};
      else if(params.uri==='paint://guide')result={contents:[{uri:params.uri,mimeType:'text/plain',text:'Paint XP WebGPU agent guide\n1. The user enables agent access in Help → AI Agent Control.\n2. Inspect paint_get_state; use paint_new only when replacing the image is intended.\n3. paint_stroke, paint_shape, paint_text, paint_fill edit pixel coordinates.\n4. paint_selection supports create/freeform, move, resize, copy, cut, paste, crop, stamp, commit, cancel, delete.\n5. paint_transform operates on the selection when present, otherwise on the whole image. resizeCanvas changes canvas bounds, not the scale.\n6. paint_edit supports undo, redo, clear, invert, mono.\n7. paint_export returns image content; use maxDimension for compact previews.\n8. paint_ui controls menus and dialogs by command, field name, and button label. Browser permission dialogs cannot be automated.\n9. paint_batch runs ordered calls, stops on error, and is not atomic.\n10. Agent input is untrusted: schemas and limits apply; no eval, shell, remote URLs, or arbitrary file paths.\nTransports: Streamable HTTP (JSON responses, no MCP GET stream) and stdio; protocol 2025-11-25 or 2025-06-18. The browser bridge uses a separate authenticated SSE connection.'}]};
      else return rpcError(id,-32002,'Resource not found.');
    }
    else return rpcError(id,-32601,'Method not found.');
    return {jsonrpc:'2.0',id,result};
  }catch(e){return rpcError(id,-32603,e.message);}
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!validHost(req))return json(res,403,{error:'Host is not allowed.'});
    if(!validOrigin(req))return json(res,403,{error:'Origin is not allowed.'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,name:'paint-xp-webgpu',browserConnected:!!bridge?.stream});
    if(url.pathname==='/mcp'||url.pathname.startsWith('/bridge/')){
      if(!authorized(req)){res.setHeader('WWW-Authenticate','Bearer realm="Paint local MCP"');return json(res,401,{error:'A valid local bearer token is required.'});}
      if(req.headers['mcp-protocol-version']&&!VERSIONS.includes(req.headers['mcp-protocol-version']))return json(res,400,{error:'Unsupported MCP protocol version. Supported: '+VERSIONS.join(', ')});
      if(url.pathname==='/mcp'){
        if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{error:'This stateless Streamable HTTP endpoint uses POST with JSON responses. GET streaming and DELETE are not offered.'});}
        const message=await body(req),response=await rpc(message);if(response===null){res.writeHead(202);return res.end();}return json(res,200,response);
      }
      if(url.pathname==='/bridge/connect'&&req.method==='POST'){
        const {clientId}=await body(req);if(typeof clientId!=='string'||!/^[\w-]{16,80}$/.test(clientId))return json(res,400,{error:'Invalid browser client id.'});
        if(bridge&&bridge.clientId!==clientId&&bridge.stream&&!bridge.stream.destroyed)return json(res,409,{error:'Another Paint tab is already connected. Stop its agent access before pairing this tab.'});
        if(bridge)disconnect('Browser reconnected.');bridge={clientId,stream:null,heartbeat:null};return json(res,200,{ok:true});
      }
      if(url.pathname==='/bridge/events'&&req.method==='GET'){
        if(!bridge||url.searchParams.get('clientId')!==bridge.clientId)return json(res,403,{error:'Enable agent control in this tab first.'});
        if(bridge.stream)return json(res,409,{error:'This browser already has an event stream.'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});res.flushHeaders();const current=bridge;current.stream=res;res.write('data: {"type":"ready"}\n\n');
        current.heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},10000);res.on('close',()=>{if(bridge===current)disconnect();});return;
      }
      if(url.pathname==='/bridge/result'&&req.method==='POST'){
        const data=await body(req);if(!bridge||data.clientId!==bridge.clientId)return json(res,403,{error:'Browser is not authorized.'});const task=pending.get(data.id);if(!task)return json(res,410,{error:'Command expired or was already answered.'});pending.delete(data.id);clearTimeout(task.timer);if(data.error)task.reject(new Error(String(data.error).slice(0,4096)));else task.resolve(data.result);return json(res,200,{ok:true});
      }
      if(url.pathname==='/bridge/disconnect'&&req.method==='POST'){const data=await body(req);if(bridge?.clientId===data.clientId)disconnect('The user disabled agent control.');return json(res,200,{ok:true});}
      return json(res,404,{error:'Unknown bridge endpoint.'});
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return json(res,400,{error:'Invalid URL.'});}
    if(pathname==='/')pathname='/index.html';
    if(!(pathname==='/index.html'||pathname.startsWith('/src/')||pathname.startsWith('/assets/'))||pathname.includes('..')||pathname.includes('\\')||pathname.includes('\0'))return json(res,404,{error:'File not found.'});
    const file=path.join(root,pathname),extension=path.extname(file);if(!MIME[extension])return json(res,404,{error:'File not found.'});
    let content;try{const s=await stat(file);if(!s.isFile())throw 0;content=await readFile(file);}catch{return json(res,404,{error:'File not found.'});}
    res.writeHead(200,{'Content-Type':MIME[extension],'Content-Length':content.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:content);
  }catch(e){log(`HTTP error: ${e.message}`);json(res,e.status||500,{error:e.message});}
});
server.requestTimeout=180000;server.headersTimeout=15000;
server.on('error',e=>{log(e.code==='EADDRINUSE'?`Port ${requestedPort} is already in use. Run npm start -- --port 5174.`:e.message);process.exitCode=1;});
server.listen(requestedPort,'127.0.0.1',()=>{
  port=server.address().port;log(`App: http://127.0.0.1:${port}/#token=${token}`);log(`MCP endpoint: http://127.0.0.1:${port}/mcp`);log(`Bearer token: ${token}`);log('Enable Help → AI Agent Control (MCP) in the app to authorize this tab.');
  if(stdio){log('MCP stdio is ready. stdout contains JSON-RPC only.');const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
    lines.on('line',async line=>{if(Buffer.byteLength(line)>MAX_BODY){process.stdout.write(JSON.stringify(rpcError(null,-32600,'Message too large.'))+'\n');return;}let message;try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify(rpcError(null,-32700,'Parse error.'))+'\n');return;}const response=await rpc(message);if(response)process.stdout.write(JSON.stringify(response)+'\n');});lines.on('close',()=>shutdown());
  }
});
function shutdown(){if(closing)return;closing=true;disconnect('MCP server stopped.');server.close();server.closeAllConnections();}
process.on('SIGINT',()=>{shutdown();process.exit(0);});process.on('SIGTERM',()=>{shutdown();process.exit(0);});
