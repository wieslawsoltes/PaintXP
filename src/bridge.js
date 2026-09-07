/** Opt-in browser peer for the local server. Each pairing has an independent epoch. */
export class AgentBridge {
  constructor(app) {
    this.app=app;this.active=false;this.controller=null;this.lastError='';this.calls=0;this.chain=Promise.resolve();this.epoch=0;
    this.clientId=crypto.randomUUID?.()||('paint-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join(''));
    const hash=new URLSearchParams(location.hash.slice(1));let saved='';try{saved=sessionStorage.getItem('paint-mcp-token')||'';}catch{}
    this.token=hash.get('token')||saved;
    if(hash.has('token')){try{sessionStorage.setItem('paint-mcp-token',this.token);}catch{}history.replaceState(null,'',location.pathname+location.search);}
  }
  headers(token=this.token){return {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};}
  async connect(token=this.token) {
    if(this.active)return;this.token=token.trim();if(!this.token)throw new Error('Start npm start and use the token printed by the local server.');
    const epoch=++this.epoch;this.controller?.abort();const controller=new AbortController();this.controller=controller;
    const response=await fetch('/bridge/connect',{method:'POST',headers:this.headers(),body:JSON.stringify({clientId:this.clientId}),signal:controller.signal});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Cannot connect.');if(epoch!==this.epoch)return;
    this.active=true;this.lastError='';try{sessionStorage.setItem('paint-mcp-token',this.token);}catch{}
    this.readEvents(epoch,controller,this.token);this.app.announce('AI agent control enabled for this tab.');
  }
  async readEvents(epoch,controller,token) {
    try {
      const response=await fetch(`/bridge/events?clientId=${encodeURIComponent(this.clientId)}`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
      if(!response.ok)throw new Error('MCP event stream was refused.');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(this.active&&epoch===this.epoch) {
        const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;
        while((end=buffer.indexOf('\n\n'))>=0) {
          const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=event.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;
          const task=JSON.parse(line.slice(6));if(['ready','ping','cancel'].includes(task.type))continue;
          this.chain=this.chain.then(async()=>{
            if(!this.active||epoch!==this.epoch||task.expiresAt<Date.now())return;
            let result,error;try{result=await this.app.execute(task.name,task.arguments||{});this.calls++;}catch(e){error=e.message;}
            // Revoking access cannot undo an in-flight edit, but it prevents stale tasks/results
            // from crossing into a later pairing session.
            if(!this.active||epoch!==this.epoch)return;
            const r=await fetch('/bridge/result',{method:'POST',headers:this.headers(token),body:JSON.stringify({clientId:this.clientId,id:task.id,result,error})});
            if(!r.ok)throw new Error('Could not return the agent result.');
          }).catch(e=>{if(epoch===this.epoch){this.lastError=e.message;console.error(e);}});
        }
      }
      if(this.active&&epoch===this.epoch)throw new Error('MCP server disconnected. Re-enable agent control to reconnect.');
    } catch(e) {
      if(e.name!=='AbortError'&&epoch===this.epoch){this.lastError=e.message;this.app.announce(this.lastError);}
    } finally {
      if(epoch===this.epoch)this.active=false;
    }
  }
  async disconnect() {
    this.epoch++;this.active=false;this.controller?.abort();
    try{await fetch('/bridge/disconnect',{method:'POST',headers:this.headers(),body:JSON.stringify({clientId:this.clientId})});}catch{}
    this.app.announce('AI agent control disabled.');
  }
}
