export const $=id=>document.getElementById(id);
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const item=(label,id,shortcut='',extra={})=>({label,id,shortcut,...extra});
export const MENUS={
 File:[item('&New','new','Ctrl+N'),item('&Open…','open','Ctrl+O'),item('&Save','save','Ctrl+S'),item('Save &As…','save-as'),null,item('From Scanner or &Camera…','camera'),null,item('Print Pre&view','print-preview'),item('Page Set&up…','page-setup'),item('&Print…','print','Ctrl+P'),null,item('Sen&d…','send'),null,item('Set As Background (&Tiled)','wallpaper-tiled'),item('Set As Background (&Centered)','wallpaper-centered'),null,item('E&xit','exit')],
 Edit:[item('&Undo','undo','Ctrl+Z'),item('&Repeat','redo','Ctrl+Y'),null,item('Cu&t','cut','Ctrl+X'),item('&Copy','copy','Ctrl+C'),item('&Paste','paste','Ctrl+V'),item('C&lear Selection','delete','Del'),item('Select &All','select-all','Ctrl+A'),null,item('Copy &To…','copy-to'),item('Paste &From…','paste-from')],
 View:[item('&Tool Box','toggle-toolbox','Ctrl+T'),item('&Color Box','toggle-palette','Ctrl+L'),item('&Status Bar','toggle-statusbar'),item('T&ext Toolbar','toggle-fontbar'),null,item('&Zoom','zoom-menu','',{children:[item('&Normal Size','zoom-normal','Ctrl+PgUp'),item('&Large Size','zoom-large','Ctrl+PgDn'),item('C&ustom…','zoom-custom'),null,item('Show &Grid','toggle-grid','Ctrl+G'),item('Show T&humbnail','toggle-thumbnail')]}),item('&View Bitmap','view-bitmap','Ctrl+F'),null,item('Touch-sized controls','toggle-touch')],
 Image:[item('&Flip/Rotate…','flip-rotate','Ctrl+R'),item('&Stretch/Skew…','stretch-skew','Ctrl+W'),item('&Invert Colors','invert','Ctrl+I'),item('&Attributes…','attributes','Ctrl+E'),item('&Clear Image','clear','Ctrl+Shift+N'),null,item('&Draw Opaque','toggle-opaque')],
 Colors:[item('&Edit Colors…','edit-colors')],
 Help:[item('&Help Topics','help'),null,item('&About Paint','about'),null,item('AI Agent Control (MCP)…','mcp'),item('Rendering Diagnostics…','diagnostics')]
};
const labelHTML=label=>escapeHTML(label).replace(/&amp;(.)/,'<u>$1</u>');
export class UI{
  constructor(app){this.app=app;this.openName=null;this.popups=[];this.dialogs=[];
    for(const name of Object.keys(MENUS)){const b=document.createElement('button');b.innerHTML='<u>'+name[0]+'</u>'+name.slice(1);b.dataset.menu=name;b.setAttribute('role','menuitem');b.setAttribute('aria-haspopup','true');b.setAttribute('aria-expanded','false');b.addEventListener('click',()=>this.openName===name?this.closeMenus():this.openMenu(name));b.addEventListener('pointerenter',()=>{if(this.openName)this.openMenu(name);});$('menubar').append(b);}
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('#menubar,#menus'))this.closeMenus();});
    document.addEventListener('keydown',e=>this.key(e));
    for(const panel of document.querySelectorAll('.floating-panel'))this.draggable(panel.querySelector('.panel-title'),panel);
  }
  openMenu(name){this.closeMenus();const anchor=document.querySelector(`[data-menu="${name}"]`);if(!anchor)return;
    this.openName=name;anchor.classList.add('open');anchor.setAttribute('aria-expanded','true');const rect=anchor.getBoundingClientRect();
    let items=MENUS[name];if(name==='File'&&this.app.recent?.length){items=[...items];items.splice(items.length-2,0,...this.app.recent.slice(0,4).map((r,i)=>item(`${i+1} ${r.name}`,`recent-${i}`)),null);}
    this.popup(items,rect.left,rect.bottom,0);
  }
  popup(items,x,y,level){
    while(this.popups.length>level)this.popups.pop().remove();const p=document.createElement('div');p.className='menu-popup';p.setAttribute('role','menu');p.style.left=x+'px';p.style.top=y+'px';$('menus').append(p);this.popups.push(p);
    for(const entry of items){if(!entry){const sep=document.createElement('div');sep.className='menu-separator';sep.setAttribute('role','separator');p.append(sep);continue;}
      const state=this.app.menuState(entry.id),b=document.createElement('button');b.className='menu-item';b.dataset.command=entry.id;b.setAttribute('role',state.checked!==undefined?'menuitemcheckbox':'menuitem');if(state.checked!==undefined)b.setAttribute('aria-checked',String(state.checked));b.disabled=state.disabled||false;
      b.innerHTML=`<span class="check">${state.checked?'✓':''}</span><span class="label">${labelHTML(entry.label)}</span><span class="shortcut">${escapeHTML(entry.shortcut)}</span>${entry.children?'<span class="arrow">▶</span>':''}`;
      const submenu=()=>{if(entry.children){const r=b.getBoundingClientRect();this.popup(entry.children,r.right-4,r.top-2,level+1);}else while(this.popups.length>level+1)this.popups.pop().remove();};
      b.addEventListener('pointerenter',submenu);b.addEventListener('click',()=>{if(entry.children){submenu();this.popups.at(-1).querySelector('button:not(:disabled)')?.focus();return;}this.closeMenus();this.app.runCommand(entry.id);});p.append(b);
    }
    const r=p.getBoundingClientRect();p.style.left=Math.max(2,Math.min(x,innerWidth-r.width-2))+'px';p.style.top=Math.max(2,Math.min(y,innerHeight-r.height-2))+'px';
  }
  closeMenus(){for(const p of this.popups)p.remove();this.popups=[];this.openName=null;for(const b of document.querySelectorAll('[data-menu]')){b.classList.remove('open');b.setAttribute('aria-expanded','false');}}
  key(e){
    const top=this.dialogs.at(-1);
    if(top){
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();top.close(null);return;}
      if(e.key==='Tab'){const els=[...top.element.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,a[href]')].filter(e=>e.offsetParent);if(!els.length)return;const i=els.indexOf(document.activeElement),n=e.shiftKey?(i<=0?els.length-1:i-1):(i+1)%els.length;els[n].focus();e.preventDefault();return;}
      if(e.key==='Enter'&&document.activeElement.tagName!=='TEXTAREA'&&document.activeElement.tagName!=='BUTTON'){top.element.querySelector('.dialog-buttons .default')?.click();e.preventDefault();}return;
    }
    if(e.altKey&&!e.ctrlKey){const name=Object.keys(MENUS).find(n=>n[0].toLowerCase()===e.key.toLowerCase());if(name){e.preventDefault();this.openMenu(name);this.popups[0].querySelector('button:not(:disabled)')?.focus();return;}}
    if(!this.openName)return;
    if(e.key==='Escape'){this.closeMenus();e.preventDefault();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){const p=document.activeElement.closest('.menu-popup')||this.popups.at(-1),buttons=[...p.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();e.preventDefault();}
    if(['ArrowLeft','ArrowRight'].includes(e.key)){const names=Object.keys(MENUS),i=names.indexOf(this.openName);this.openMenu(names[(i+(e.key==='ArrowRight'?1:-1)+names.length)%names.length]);this.popups[0].querySelector('button:not(:disabled)')?.focus();e.preventDefault();}
    if(e.key.length===1){const p=document.activeElement.closest('.menu-popup')||this.popups[0],buttons=[...p.querySelectorAll('button:not(:disabled)')],b=buttons.find(b=>b.querySelector('u')?.textContent.toLowerCase()===e.key.toLowerCase());if(b){b.click();e.preventDefault();}}
  }
  dialog(title,html,{width=360,buttons=[{label:'OK',value:true,default:true},{label:'Cancel',value:null}],onMount=null}={}){
    this.closeMenus();const oldFocus=document.activeElement;const shade=document.createElement('div');shade.className='dialog-shade';
    const el=document.createElement('section');el.className='xp-dialog';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',title);el.style.width=width+'px';el.tabIndex=-1;
    el.innerHTML=`<div class="dialog-title"><span>${escapeHTML(title)}</span><button class="dialog-close" aria-label="Close">×</button></div><div class="dialog-content">${html}<p class="dialog-error dialog-warning" hidden role="alert"></p></div><div class="dialog-buttons"></div>`;
    shade.append(el);$('dialogs').append(shade);let resolve;const promise=new Promise(r=>resolve=r);
    const entry={element:el,title,close:value=>{const i=this.dialogs.indexOf(entry);if(i<0)return;this.dialogs.splice(i,1);shade.remove();resolve(value);oldFocus?.focus({preventScroll:true});}};this.dialogs.push(entry);
    el.querySelector('.dialog-close').onclick=()=>entry.close(null);
    const values=()=>Object.fromEntries([...el.querySelectorAll('[name]')].filter(e=>e.type!=='radio'||e.checked).map(e=>[e.name,e.type==='checkbox'?e.checked:e.type==='number'?Number(e.value):e.value]));
    buttons.forEach(def=>{const b=document.createElement('button');b.textContent=def.label;b.className=def.default?'default':'';if(def.id)b.id=def.id;b.onclick=async()=>{
      try{b.disabled=true;const data=values();const result=def.onClick?await def.onClick(data,el):def.value;if(result!==false)entry.close(result===undefined?data:result);}
      catch(error){const p=el.querySelector('.dialog-error');p.textContent=error.message;p.hidden=false;}finally{b.disabled=false;}
    };el.querySelector('.dialog-buttons').append(b);});
    this.draggable(el.querySelector('.dialog-title'),el,true);onMount?.(el,entry);queueMicrotask(()=>{const focus=el.querySelector('[autofocus]')||el.querySelector('.dialog-buttons .default')||el.querySelector('button');focus?.focus();focus?.select?.();});promise.element=el;promise.close=entry.close;return promise;
  }
  message(title,message){return this.dialog(title,`<span class="info-mark">i</span><p>${escapeHTML(message).replace(/\n/g,'<br>')}</p>`,{buttons:[{label:'OK',default:true,value:true}]});}
  draggable(handle,el,dialog=false){let start=null;handle.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const r=el.getBoundingClientRect();start={x:e.clientX,y:e.clientY,left:r.left,top:r.top};handle.setPointerCapture(e.pointerId);e.preventDefault();});handle.addEventListener('pointermove',e=>{if(!start)return;el.style.position='fixed';el.style.margin='0';el.style.left=Math.max(0,Math.min(innerWidth-80,start.left+e.clientX-start.x))+'px';el.style.top=Math.max(0,Math.min(innerHeight-28,start.top+e.clientY-start.y))+'px';el.style.right='auto';});handle.addEventListener('pointerup',()=>start=null);handle.addEventListener('pointercancel',()=>start=null);}
}
