import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {AgentBridge} from '../src/bridge.js';

test('actual AgentBridge class pairs, executes, reports errors and re-pairs over local HTTP', {timeout:15000}, async()=>{
  const token='bridge-test-token-12345678901234567890';
  const child=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname,'--port','0'],{env:{...process.env,PAINT_MCP_TOKEN:token},stdio:['ignore','ignore','pipe']});
  const base=await new Promise((resolve,reject)=>{let log='';child.stderr.on('data',part=>{log+=part;const m=log.match(/App: (http:\/\/127\.0\.0\.1:\d+)\//);if(m)resolve(m[1]);});child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited before startup: ${code}\n${log}`)));});
  const nativeFetch=globalThis.fetch, previous={location:globalThis.location,sessionStorage:globalThis.sessionStorage,history:globalThis.history};
  const saved=new Map();let bridge;
  try {
    globalThis.location={hash:'',pathname:'/',search:''};globalThis.history={replaceState(){}};
    globalThis.sessionStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
    // Node executes the unchanged browser bridge with a minimal app peer. This is not a browser/GPU test.
    globalThis.fetch=(url,options={})=>nativeFetch(new URL(url,base),{...options,headers:{...options.headers,Origin:base}});
    const calls=[];
    bridge=new AgentBridge({announce(){},async execute(name,args){calls.push([name,args]);if(name==='paint_fill')throw new Error('fixture drawing failure');return {width:640,height:480};}});
    const ready=async()=>{const deadline=Date.now()+3000;while(Date.now()<deadline){if((await (await nativeFetch(base+'/health')).json()).browserConnected)return;await new Promise(r=>setTimeout(r,10));}throw new Error('SSE connection did not become ready.');};
    const invoke=async(name,args={})=>(await (await nativeFetch(base+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})).json()).result;
    await bridge.connect(token);await ready();
    assert.deepEqual((await invoke('paint_get_state')).structuredContent,{width:640,height:480});
    assert.equal(bridge.calls,1);assert.equal(saved.get('paint-mcp-token'),token);
    const error=await invoke('paint_fill',{x:0,y:0});assert.equal(error.isError,true);assert.match(error.content[0].text,/fixture drawing failure/);
    await bridge.disconnect();assert.equal(bridge.active,false);
    await bridge.connect(token);await ready();await new Promise(r=>setTimeout(r,25));assert.equal(bridge.active,true);
    assert.deepEqual((await invoke('paint_get_state')).structuredContent,{width:640,height:480});assert.equal(calls.length,3);
  } finally {
    await bridge?.disconnect();globalThis.fetch=nativeFetch;
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
    child.kill('SIGTERM');
  }
});
