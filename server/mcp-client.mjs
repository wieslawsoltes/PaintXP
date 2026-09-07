#!/usr/bin/env node
/** Stdio-to-HTTP adapter for an already-running local Paint server. No npm packages. */
import {createInterface} from 'node:readline';
const url=new URL(process.env.PAINT_MCP_URL||'http://127.0.0.1:5173/mcp');
if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('The Paint stdio adapter only connects to local HTTP endpoints.');
const token=process.env.PAINT_MCP_TOKEN;if(!token||token.length<24)throw new Error('Set PAINT_MCP_TOKEN to the token printed by npm start.');
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',async line=>{
  let message;
  try{
    if(Buffer.byteLength(line)>32*1024*1024)throw new Error('Message is too large.');message=JSON.parse(line);
    const response=await fetch(url,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:line,signal:AbortSignal.timeout(130000)});
    if(response.status===202)return;const body=await response.text();if(!response.ok)throw new Error(`Paint server returned ${response.status}: ${body}`);
    JSON.parse(body);process.stdout.write(body+'\n');
  }catch(e){if(message?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:e.message}})+'\n');else process.stderr.write(`[Paint MCP adapter] ${e.message}\n`);}
});
