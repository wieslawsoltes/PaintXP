import {Raster,TILE,WHITE,color,hex,rgba,clamp,dimensions,denseLimit,bounds,stamp,line,shape,polygon,bezier,flood,mapColors,transform,insidePolygon} from './raster.js';
import {Renderer} from './renderer.js';
import {XPScrollbars} from './scrollbars.js';
import {encodeImage,decodeImage,documentCanvas,blobBase64} from './codecs.js';
import {UI,$,escapeHTML} from './ui.js';
import {TOOL_IDS,validateTool} from './commands.js';
import {icon,opacityIcon,TOOL_NAMES,TOOL_HELP} from './icons.js';
import {AgentBridge} from './bridge.js';
import {showDialog} from './dialogs.js';

const PALETTE=['#000000','#ffffff','#808080','#c0c0c0','#800000','#ff0000','#808000','#ffff00','#008000','#00ff00','#008080','#00ffff','#000080','#0000ff','#800080','#ff00ff','#808040','#ffff80','#004040','#00ff80','#0080ff','#80ffff','#004080','#8080ff','#400080','#ff0080','#804000','#ff8040'];
const sleep=()=>new Promise(r=>requestAnimationFrame(r));
const toPoint=p=>({x:Math.round(p.x),y:Math.round(p.y)});
const idbOpen=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('paint-xp-documents',1);r.onupgradeneeded=()=>r.result.createObjectStore('recent',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});

export class PaintApp{
  constructor(){
    this.doc=new Raster(640,480);this.name='untitled';this.format='png';this.modified=false;this.savedHandle=null;
    this.tool='pencil';this.previousTool='pencil';this.fg=color('#000000');this.bg=WHITE;this.size=1;this.brush='round';this.brushSize=4;this.eraserSize=6;this.airSize=17;this.fillStyle='outline';this.opaque=true;
    this.zoom=1;this.largeZoom=6;this.grid=false;this.active=null;this.selection=null;this.clipboard=null;this.poly=null;this.curve=null;this.textEditor=null;this.font={family:'Arial',size:16,bold:false,italic:false,underline:false};
    this.pointers=new Map();this.pinch=null;this.space=false;this.busy=false;this.framePending=false;this.queue=Promise.resolve();this.recent=[];this.stats={lastOperationMs:0,lastOperation:'',workerOperations:0};this.pageSetup={orientation:'portrait',margin:19,fit:true,scale:100,centerH:true,centerV:false};
    this.ui=new UI(this);this.renderer=new Renderer($('view-canvas'),()=>this.invalidate());this.bridge=new AgentBridge(this);this.worker=null;this.workerRequests=new Map();this.nextWorkerId=1;
    try{this.worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});this.worker.onmessage=({data})=>{const task=this.workerRequests.get(data.id);if(!task)return;this.workerRequests.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data);};this.worker.onerror=e=>{for(const p of this.workerRequests.values())p.reject(new Error(e.message||'Raster worker failed.'));this.workerRequests.clear();this.worker?.terminate();this.worker=null;};}catch{}
    this.scrollbars=new XPScrollbars($('scroller'),$('drawing-area'),()=>this.invalidate());this.buildTools();this.buildPalette();this.bindEvents();this.updateOptions();this.updateChrome();this.loadRecent();
    this.ready=this.renderer.init().then(()=>{this.invalidate();$('live').textContent='Paint is ready.';return this;});
    setInterval(()=>{if(this.selection)this.invalidate();},220);
  }
  announce(message){$('status-help').textContent=message;$('live').textContent=message;}
  buildTools(){for(const id of TOOL_IDS){const b=document.createElement('button');b.className='tool';b.dataset.tool=id;b.innerHTML=icon(id);b.title=TOOL_NAMES[id];b.setAttribute('aria-label',TOOL_NAMES[id]);b.setAttribute('aria-pressed',String(id===this.tool));b.addEventListener('click',()=>this.setTool(id));b.addEventListener('pointerenter',()=>this.announce(TOOL_HELP[id]));b.addEventListener('pointerleave',()=>this.defaultStatus());$('tools').append(b);}}
  defaultStatus(){this.announce(this.bridge.active?'AI agent control is enabled. Help → AI Agent Control to stop.':'For Help, click Help Topics on the Help Menu.');}
  buildPalette(){if(!this.palette){try{this.palette=JSON.parse(localStorage.getItem('paint-xp-palette'))||PALETTE.slice();if(!Array.isArray(this.palette)||this.palette.length!==28||this.palette.some(c=>!/^#[0-9a-f]{6}$/i.test(c)))throw 0;}catch{this.palette=PALETTE.slice();}}
    $('palette').replaceChildren();this.palette.forEach((c,i)=>{const b=document.createElement('button');b.className='swatch';b.innerHTML=`<span style="background:${c}"></span>`;b.title=c+' (right-click for background)';b.setAttribute('aria-label',`Color ${c}`);b.dataset.index=i;b.addEventListener('pointerdown',e=>{if(e.button===2){this.bg=color(this.palette[i]);this.updateChrome();e.preventDefault();}});b.onclick=()=>{this.fg=color(this.palette[i]);this.activeColorIndex=i;this.updateChrome();};b.ondblclick=()=>{this.activeColorIndex=i;showDialog(this,'edit-colors');};b.oncontextmenu=e=>e.preventDefault();$('palette').append(b);});
    $('current-colors').onclick=()=>{[this.fg,this.bg]=[this.bg,this.fg];this.updateChrome();};
  }
  updateOptions(){
    for(const b of document.querySelectorAll('[data-tool]')){const selected=b.dataset.tool===this.tool;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}
    const box=$('tool-options');box.replaceChildren();box.className='';const add=(html,selected,callback,title)=>{const b=document.createElement('button');b.className='option'+(selected?' selected':'');b.innerHTML=html;b.title=title||'';b.setAttribute('aria-label',title||'Tool option');b.setAttribute('aria-pressed',String(selected));b.onclick=()=>{callback();this.updateOptions();this.updateChrome();};box.append(b);return b;};
    if(['select','free-select','text'].includes(this.tool)){for(const opaque of [true,false])add(opacityIcon(opaque),this.opaque===opaque,()=>{this.opaque=opaque;this.selection?.cache&&(this.selection.cache=null);this.updateTextStyle();},opaque?'Opaque background':'Transparent background').classList.add('opaque-option');}
    else if(this.tool==='brush'){box.className='brush-options';for(const kind of ['round','square','slash','backslash'])for(const size of [1,4,7])add(`<span class="brush-mark" style="width:${kind==='slash'||kind==='backslash'?1:size}px;height:${size}px;${kind==='round'?'border-radius:50%;':''}${kind==='slash'?'transform:rotate(45deg)':''}${kind==='backslash'?'transform:rotate(-45deg)':''}"></span>`,this.brush===kind&&this.brushSize===size,()=>{this.brush=kind;this.brushSize=size;},`${kind} brush, ${size} pixels`);}
    else if(this.tool==='eraser'){for(const size of [4,6,8,10])add(`<span class="brush-mark" style="width:${size}px;height:${size}px"></span>`,this.eraserSize===size,()=>this.eraserSize=size,`${size} pixel eraser`);}
    else if(this.tool==='airbrush'){for(const size of [9,17,25])add(`<svg viewBox="0 0 30 20" width="30" height="20">${Array.from({length:16},(_,i)=>`<rect x="${15+Math.cos(i*7)*size/2*(i%3+1)/3}" y="${10+Math.sin(i*7)*size/3*(i%3+1)/3}" width="1" height="1" fill="currentColor"/>`).join('')}</svg>`,this.airSize===size,()=>this.airSize=size,`${size} pixel spray`);}
    else if(this.tool==='magnifier'){for(const zoom of [1,2,6,8])add(`${zoom}x`,this.largeZoom===zoom,()=>this.largeZoom=zoom,`${zoom*100}% zoom`);}
    else if(['line','curve'].includes(this.tool)){for(let size=1;size<=5;size++)add(`<span class="line-sample" style="height:${size}px"></span>`,this.size===size,()=>this.size=size,`${size} pixel line`);}
    else if(['rect','ellipse','roundrect','polygon'].includes(this.tool)){for(const mode of ['outline','filled','solid'])add(`<svg width="31" height="15"><rect x="2" y="2" width="27" height="11" fill="${mode==='outline'?'none':mode==='filled'?'white':'currentColor'}" stroke="currentColor" stroke-width="2"/></svg>`,this.fillStyle===mode,()=>this.fillStyle=mode,mode==='outline'?'Outline only':mode==='filled'?'Outline and background fill':'Solid foreground');}
  }
  setTool(id){if(!TOOL_IDS.includes(id))throw new Error('Unknown drawing tool.');if(this.busy)return;this.commitText();if(this.poly)this.finishPolygon();if(this.curve)this.finishCurve();if(!['select','free-select'].includes(id))this.commitSelection();if(!['picker','magnifier'].includes(this.tool))this.previousTool=this.tool;this.tool=id;this.updateOptions();$('overlay').style.cursor=id==='text'?'text':id==='magnifier'?'zoom-in':'crosshair';this.announce(TOOL_HELP[id]);this.invalidate();}
  updateChrome(){const title=`${this.name} - Paint`;$('window-title').textContent=title;document.title=title;$('restore-window').lastChild.textContent=' '+title;$('foreground-swatch').style.background=hex(this.fg);$('background-swatch').style.background=hex(this.bg);$('status-size').textContent=`${this.doc.width} × ${this.doc.height}`;this.updateTextStyle();this.invalidate();}
  menuState(id){const sel=!!this.selection;const states={'toggle-toolbox':!$('toolbox').hidden,'toggle-palette':!$('colorbox').hidden,'toggle-statusbar':!$('statusbar').hidden,'toggle-fontbar':!$('fontbar').hidden,'toggle-grid':this.grid,'toggle-thumbnail':!$('thumbnail').hidden,'toggle-opaque':this.opaque,'toggle-touch':document.body.classList.contains('touch')};if(id in states)return {checked:states[id]};
    return {disabled:id==='undo'?!this.doc.undoStack.length&&!this.doc.transaction:id==='redo'?!this.doc.redoStack.length:['cut','copy','copy-to','delete'].includes(id)?!sel:false};}
  view(){const s=$('scroller');return {width:s.clientWidth,height:s.clientHeight,zoom:this.zoom,offsetX:3-s.scrollLeft,offsetY:3-s.scrollTop,grid:this.grid};}
  invalidate(){if(this.framePending)return;this.framePending=true;requestAnimationFrame(()=>{this.framePending=false;try{this.render();}catch(e){console.error(e);this.announce(e.message);}});}
  render(){const s=$('paper-space');s.style.width=(this.doc.width*this.zoom+9)+'px';s.style.height=(this.doc.height*this.zoom+9)+'px';this.scrollbars.update();const v=this.view();this.renderer.render(this.doc,v);this.renderOverlay(v);if(!$('thumbnail').hidden)this.renderThumbnail();}
  renderOverlay(v){const canvas=$('overlay'),dpr=Math.min(devicePixelRatio||1,3),w=Math.max(1,Math.round(v.width*dpr)),h=Math.max(1,Math.round(v.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}canvas.style.width=v.width+'px';canvas.style.height=v.height+'px';
    const c=canvas.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.setTransform(dpr*v.zoom,0,0,dpr*v.zoom,dpr*v.offsetX,dpr*v.offsetY);c.imageSmoothingEnabled=false;
    if(this.selection){const s=this.selection;if(!s.cache||s.cacheKey!==`${this.opaque}:${this.bg}`){s.cacheKey=`${this.opaque}:${this.bg}`;s.cache=documentCanvas(s.source);if(!this.opaque){const ctx=s.cache.getContext('2d'),im=ctx.getImageData(0,0,s.source.width,s.source.height),arr=new Uint32Array(im.data.buffer);for(let i=0;i<arr.length;i++)if(arr[i]===this.bg)arr[i]=0;ctx.putImageData(im,0,0);}}
      c.save();c.beginPath();c.rect(0,0,this.doc.width,this.doc.height);c.clip();c.drawImage(s.cache,s.x,s.y,s.w||s.source.width,s.h||s.source.height);c.restore();this.drawSelectionBorder(c,s.x,s.y,s.w||s.source.width,s.h||s.source.height,v.zoom);}
    const a=this.active;
    if(a&&['shape','select','textRect','free-select','curveBase','curveControl','resizePaper'].includes(a.kind)){
      c.save();c.lineWidth=this.size;c.strokeStyle=hex(a.color??this.fg);c.fillStyle=hex(a.background??this.bg);
      if(a.kind==='shape'){this.previewShape(c,a.tool,a.start,a.last);}
      else if(a.kind==='select'||a.kind==='textRect'){const b=this.rectBetween(a.start,a.last);this.drawSelectionBorder(c,b.x,b.y,b.w,b.h,v.zoom,false);}
      else if(a.kind==='free-select'){this.previewPath(c,a.points,false);}
      else if(a.kind==='curveBase'){c.beginPath();c.moveTo(a.start.x,a.start.y);c.lineTo(a.last.x,a.last.y);c.stroke();}
      else if(a.kind==='resizePaper'){this.drawSelectionBorder(c,0,0,Math.max(1,a.last.x),Math.max(1,a.last.y),v.zoom,false);}
      c.restore();
    }
    if(this.poly){c.strokeStyle=hex(this.poly.color);c.lineWidth=this.size;this.previewPath(c,[...this.poly.points,this.hover||this.poly.points.at(-1)],false);}
    if(this.curve){const {start,end,c1,c2}=this.curve;c.lineWidth=this.size;c.strokeStyle=hex(this.curve.color);c.beginPath();c.moveTo(start.x,start.y);c.bezierCurveTo(c1.x,c1.y,c2.x,c2.y,end.x,end.y);c.stroke();}
    if(!this.selection){const r=3/v.zoom;c.fillStyle='#fff';c.strokeStyle='#003367';c.lineWidth=1/v.zoom;for(const [x,y] of [[this.doc.width/2,this.doc.height],[this.doc.width,this.doc.height/2],[this.doc.width,this.doc.height]]){c.fillRect(x,y,r,r);c.strokeRect(x,y,r,r);}}
    this.positionText();
  }
  previewPath(c,points,close){if(!points.length)return;c.beginPath();c.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))c.lineTo(p.x,p.y);if(close)c.closePath();c.stroke();}
  previewShape(c,kind,a,b){const box=this.rectBetween(a,b);c.beginPath();if(kind==='line'){c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}else if(kind==='ellipse')c.ellipse(box.x+box.w/2,box.y+box.h/2,box.w/2,box.h/2,0,0,Math.PI*2);else if(kind==='roundrect')c.roundRect(box.x,box.y,box.w,box.h,Math.min(12,box.w/2,box.h/2));else c.rect(box.x,box.y,box.w,box.h);
    if(kind!=='line'&&this.fillStyle!=='outline'){if(this.fillStyle==='solid')c.fillStyle=c.strokeStyle;c.fill();}if(this.fillStyle!=='solid'||kind==='line')c.stroke();}
  drawSelectionBorder(c,x,y,w,h,zoom,handles=true){c.save();c.lineWidth=1/zoom;c.setLineDash([3/zoom,3/zoom]);c.strokeStyle='white';c.strokeRect(x-.5/zoom,y-.5/zoom,w+1/zoom,h+1/zoom);c.strokeStyle='black';c.lineDashOffset=Math.floor(performance.now()/220)%6/zoom;c.strokeRect(x-.5/zoom,y-.5/zoom,w+1/zoom,h+1/zoom);c.setLineDash([]);
    if(handles){const r=3/zoom;c.fillStyle='white';c.strokeStyle='#001f49';for(const [hx,hy] of this.handlePoints(x,y,w,h)){c.fillRect(hx-r/2,hy-r/2,r,r);c.strokeRect(hx-r/2,hy-r/2,r,r);}}c.restore();}
  handlePoints(x,y,w,h){return [[x,y],[x+w/2,y],[x+w,y],[x+w,y+h/2],[x+w,y+h],[x+w/2,y+h],[x,y+h],[x,y+h/2]];}
  rectBetween(a,b){return {x:Math.round(Math.min(a.x,b.x)),y:Math.round(Math.min(a.y,b.y)),w:Math.max(1,Math.abs(Math.round(b.x)-Math.round(a.x))+1),h:Math.max(1,Math.abs(Math.round(b.y)-Math.round(a.y))+1)};}
  point(e){const r=$('overlay').getBoundingClientRect(),v=this.view();return {x:(e.clientX-r.left-v.offsetX)/this.zoom,y:(e.clientY-r.top-v.offsetY)/this.zoom};}
  snap(a,b,shift,kind){b=toPoint(b);if(!shift)return b;let dx=b.x-a.x,dy=b.y-a.y;if(['line','curve'].includes(kind)){const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,len=Math.hypot(dx,dy);b={x:Math.round(a.x+Math.cos(angle)*len),y:Math.round(a.y+Math.sin(angle)*len)};}else{const size=Math.max(Math.abs(dx),Math.abs(dy));b={x:a.x+Math.sign(dx||1)*size,y:a.y+Math.sign(dy||1)*size};}return b;}
  bindEvents(){
    const overlay=$('overlay');overlay.addEventListener('pointerdown',e=>this.pointerDown(e));overlay.addEventListener('pointermove',e=>this.pointerMove(e));overlay.addEventListener('pointerup',e=>this.pointerUp(e));overlay.addEventListener('pointercancel',e=>this.pointerCancel(e));overlay.addEventListener('contextmenu',e=>e.preventDefault());overlay.addEventListener('dblclick',e=>{if(this.tool==='polygon'){this.finishPolygon();e.preventDefault();}});
    overlay.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey)this.setZoom(clamp(this.zoom*(e.deltaY<0?1.25:.8),.03125,16),{x:e.clientX,y:e.clientY});else{const s=$('scroller');s.scrollLeft+=e.shiftKey?e.deltaY:e.deltaX;s.scrollTop+=e.shiftKey?0:e.deltaY;}},{passive:false});
    $('scroller').onscroll=()=>this.invalidate();new ResizeObserver(()=>this.invalidate()).observe($('drawing-area'));
    document.addEventListener('keydown',e=>this.keyDown(e));document.addEventListener('keyup',e=>{if(e.code==='Space')this.space=false;});window.addEventListener('blur',()=>{this.space=false;if(this.active)this.cancelDrawing();});
    window.addEventListener('beforeunload',e=>{if(this.modified){e.preventDefault();e.returnValue='';}});
    $('open-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(file)await this.loadFile(file,this.fileMode||'open');};$('camera-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(file)await this.loadFile(file,'open');};
    $('drawing-area').addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});$('drawing-area').addEventListener('drop',async e=>{e.preventDefault();if(this.busy)return;const file=e.dataTransfer.files[0];if(file)await this.loadFile(file,e.shiftKey?'paste':'open');});
    document.addEventListener('paste',async e=>{if(e.target.closest('input,textarea')||this.ui.dialogs.length)return;const image=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'));if(image){e.preventDefault();await this.loadFile(image.getAsFile(),'paste');}else if(e.clipboardData.getData('text/plain')){e.preventDefault();this.openText(4,4,300,80,e.clipboardData.getData('text/plain'));}});
    $('maximize').onclick=async()=>{try{document.fullscreenElement?await document.exitFullscreen():await $('paint-window').requestFullscreen();}catch{this.announce('Full screen is unavailable in this browser.');}};$('titlebar').ondblclick=()=>$('maximize').click();$('minimize').onclick=()=>{$('paint-window').hidden=true;$('restore-window').hidden=false;};$('restore-window').onclick=()=>{$('paint-window').hidden=false;$('restore-window').hidden=true;this.invalidate();};$('close-window').onclick=()=>this.runCommand('exit');
    $('fontbar').querySelector('.panel-close').onclick=()=>{$('fontbar').hidden=true;};$('thumbnail').querySelector('.panel-close').onclick=()=>{$('thumbnail').hidden=true;};
    $('font-family').onchange=e=>{this.font.family=e.target.value;this.updateTextStyle();};$('font-size').onchange=e=>{this.font.size=Number(e.target.value)*4/3;this.updateTextStyle();};for(const type of ['bold','italic','underline'])$('font-'+type).onclick=()=>{this.font[type]=!this.font[type];this.updateTextStyle();};
  }
  pointerDown(e){
    if(this.busy||this.ui.dialogs.length)return;e.preventDefault();$('overlay').focus({preventScroll:true});$('overlay').setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.pointers.size===2){this.cancelDrawing();const [a,b]=[...this.pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,anchor:this.point({clientX:mid.x,clientY:mid.y})};return;}
    if(this.pinch)return;const p=toPoint(this.point(e));this.hover=p;
    if(e.button===1||this.space){this.active={kind:'pan',screen:{x:e.clientX,y:e.clientY},scroll:{x:$('scroller').scrollLeft,y:$('scroller').scrollTop}};return;}
    this.commitText();
    if(this.selection&&['select','free-select'].includes(this.tool)){
      const s=this.selection,handles=this.handlePoints(s.x,s.y,s.source.width,s.source.height),r=(e.pointerType==='touch'?10:5)/this.zoom,handle=handles.findIndex(([x,y])=>Math.abs(p.x-x)<r&&Math.abs(p.y-y)<r);
      if(handle>=0){this.active={kind:'resizeSelection',handle,start:p,original:{x:s.x,y:s.y,w:s.source.width,h:s.source.height}};return;}
      if(p.x>=s.x&&p.y>=s.y&&p.x<s.x+s.source.width&&p.y<s.y+s.source.height){if(e.ctrlKey||e.altKey)this.doc.blit(s.source,s.x,s.y,{transparent:this.opaque?null:this.bg});this.active={kind:'moveSelection',start:p,x:s.x,y:s.y,trail:e.shiftKey};return;}
    }
    if(!this.selection){const threshold=(e.pointerType==='touch'?12:5)/this.zoom,w=this.doc.width,h=this.doc.height;
      if(Math.abs(p.x-w)<threshold&&Math.abs(p.y-h)<threshold){this.active={kind:'resizePaper',start:p,last:p,axis:'both'};return;}
      if(Math.abs(p.x-w)<threshold&&Math.abs(p.y-h/2)<threshold){this.active={kind:'resizePaper',start:p,last:{x:p.x,y:h},axis:'x'};return;}
      if(Math.abs(p.y-h)<threshold&&Math.abs(p.x-w/2)<threshold){this.active={kind:'resizePaper',start:p,last:{x:w,y:p.y},axis:'y'};return;}
    }
    this.commitSelection();if(p.x<0||p.y<0||p.x>=this.doc.width||p.y>=this.doc.height)return;
    const c=e.button===2?this.bg:this.fg,bg=e.button===2?this.fg:this.bg;
    if(this.tool==='fill'){this.doFill(p.x,p.y,c).catch(e=>this.error(e));return;}
    if(this.tool==='picker'){if(e.button===2)this.bg=this.doc.get(p.x,p.y);else this.fg=this.doc.get(p.x,p.y);this.setTool(this.previousTool);this.updateChrome();return;}
    if(this.tool==='magnifier'){this.setZoom(e.button===2||this.zoom>1?1:this.largeZoom,{x:e.clientX,y:e.clientY});return;}
    if(this.tool==='polygon'){if(!this.poly)this.poly={points:[p],color:c,background:bg};else{const first=this.poly.points[0];if(this.poly.points.length>2&&Math.hypot(p.x-first.x,p.y-first.y)<6/this.zoom){this.finishPolygon();return;}if(Math.hypot(p.x-this.poly.points.at(-1).x,p.y-this.poly.points.at(-1).y)>0)this.poly.points.push(p);}this.invalidate();return;}
    if(this.tool==='curve'&&this.curve){this.active={kind:'curveControl',start:p,last:p};this.curve[this.curve.stage===1?'c1':'c2']=p;this.invalidate();return;}
    if(['pencil','brush','eraser','airbrush'].includes(this.tool)){
      this.doc.begin(TOOL_NAMES[this.tool]);this.active={kind:'stroke',tool:this.tool,start:p,last:p,color:this.tool==='eraser'?this.bg:c,size:this.tool==='pencil'?this.size:this.tool==='brush'?this.brushSize:this.tool==='eraser'?this.eraserSize:this.airSize,brush:this.tool==='eraser'?'square':this.brush,replace:this.tool==='eraser'&&e.button===2?this.fg:null,seed:(Date.now()&0x7fffffff)||1};
      this.strokeSegment(this.active,p,p);if(this.tool==='airbrush')this.sprayTimer=setInterval(()=>{if(this.active?.kind==='stroke'){this.spray(this.active,this.active.last);this.invalidate();}},40);
    }else{this.active={kind:this.tool==='select'?'select':this.tool==='free-select'?'free-select':this.tool==='text'?'textRect':this.tool==='curve'?'curveBase':'shape',tool:this.tool,start:p,last:p,color:c,background:bg,points:[p]};}
    this.invalidate();
  }
  pointerMove(e){
    if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.pinch&&this.pointers.size>=2){const [a,b]=[...this.pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y);const z=clamp(this.pinch.zoom*distance/Math.max(1,this.pinch.distance),.03125,16);this.zoom=z;this.render();const r=$('overlay').getBoundingClientRect();$('scroller').scrollLeft=this.pinch.anchor.x*z+3-(mid.x-r.left);$('scroller').scrollTop=this.pinch.anchor.y*z+3-(mid.y-r.top);this.invalidate();return;}
    const p=toPoint(this.point(e));this.hover=p;$('status-position').textContent=p.x>=0&&p.y>=0&&p.x<this.doc.width&&p.y<this.doc.height?`${p.x}, ${p.y}`:'';const a=this.active;if(!a){if(this.poly)this.invalidate();return;}
    if(a.kind==='pan'){const s=$('scroller');s.scrollLeft=a.scroll.x+a.screen.x-e.clientX;s.scrollTop=a.scroll.y+a.screen.y-e.clientY;return;}
    if(a.kind==='stroke'){const events=e.getCoalescedEvents?.()||[e];for(const ev of events.length?events:[e]){const next=toPoint(this.point(ev));this.strokeSegment(a,a.last,next);a.last=next;}}
    else if(a.kind==='moveSelection'){this.selection.x=a.x+p.x-a.start.x;this.selection.y=a.y+p.y-a.start.y;if(a.trail)this.doc.blit(this.selection.source,this.selection.x,this.selection.y,{transparent:this.opaque?null:this.bg});}
    else if(a.kind==='resizeSelection'){const s=this.selection,o=a.original,dx=p.x-a.start.x,dy=p.y-a.start.y;let l=o.x,t=o.y,r=o.x+o.w,b=o.y+o.h;if([0,6,7].includes(a.handle))l+=dx;if([2,3,4].includes(a.handle))r+=dx;if([0,1,2].includes(a.handle))t+=dy;if([4,5,6].includes(a.handle))b+=dy;s.x=Math.min(l,r-1);s.y=Math.min(t,b-1);s.w=Math.max(1,Math.abs(r-l));s.h=Math.max(1,Math.abs(b-t));}
    else if(a.kind==='resizePaper'){a.last={x:a.axis==='y'?this.doc.width:Math.max(1,p.x),y:a.axis==='x'?this.doc.height:Math.max(1,p.y)};}
    else if(a.kind==='curveControl'){this.curve[this.curve.stage===1?'c1':'c2']=p;}
    else{a.last=this.snap(a.start,p,e.shiftKey,a.tool);if(a.kind==='free-select')a.points.push(p);}
    this.invalidate();
  }
  pointerUp(e){this.pointers.delete(e.pointerId);if(this.pinch){if(!this.pointers.size)this.pinch=null;return;}const a=this.active;if(!a)return;this.active=null;clearInterval(this.sprayTimer);
    try{
      if(a.kind==='stroke')this.endEdit();
      else if(a.kind==='shape'){this.doc.begin(TOOL_NAMES[a.tool]);shape(this.doc,a.tool,a.start.x,a.start.y,a.last.x,a.last.y,a.color,a.background,this.fillStyle,this.size);this.endEdit();}
      else if(a.kind==='select'||a.kind==='free-select'){const box=a.kind==='free-select'?bounds(a.points):this.rectBetween(a.start,a.last);if(box.w>1&&box.h>1)this.select(box.x,box.y,box.w,box.h,a.kind==='free-select'?a.points:null);}
      else if(a.kind==='textRect'){const b=this.rectBetween(a.start,a.last);this.openText(b.x,b.y,Math.max(120,b.w),Math.max(28,b.h));}
      else if(a.kind==='curveBase'){this.curve={start:a.start,end:a.last,c1:{x:a.start.x+(a.last.x-a.start.x)/3,y:a.start.y+(a.last.y-a.start.y)/3},c2:{x:a.start.x+2*(a.last.x-a.start.x)/3,y:a.start.y+2*(a.last.y-a.start.y)/3},stage:1,color:a.color};}
      else if(a.kind==='curveControl'){if(this.curve.stage===1)this.curve.stage=2;else this.finishCurve();}
      else if(a.kind==='resizeSelection'){const s=this.selection;if(s.w&&s.h){s.source=transform(s.source,{type:'scale',width:s.w,height:s.h});s.w=s.h=null;s.cache=null;}}
      else if(a.kind==='resizePaper'){this.doc.begin('Resize canvas');this.doc.resize(Math.round(a.last.x),Math.round(a.last.y));this.endEdit();}
    }catch(e){if(this.doc.transaction&&!this.selection)this.doc.cancel();this.error(e);}this.updateChrome();
  }
  pointerCancel(e){this.pointers.delete(e.pointerId);if(!this.pointers.size)this.pinch=null;this.cancelDrawing();}
  cancelDrawing(){clearInterval(this.sprayTimer);if(this.active?.kind==='stroke')this.doc.cancel();if(this.active?.kind==='moveSelection'&&this.selection){this.selection.x=this.active.x;this.selection.y=this.active.y;}if(this.active?.kind==='resizeSelection'&&this.selection){Object.assign(this.selection,{x:this.active.original.x,y:this.active.original.y,w:null,h:null});}this.active=null;this.invalidate();}
  strokeSegment(a,from,to){if(a.tool==='airbrush'){const length=Math.hypot(to.x-from.x,to.y-from.y),steps=Math.min(10000,Math.max(1,Math.ceil(length/4)));for(let i=1;i<=steps;i++)this.spray(a,{x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps});}else line(this.doc,from.x,from.y,to.x,to.y,a.color,a.size,a.tool==='pencil'?'square':a.brush,a.replace);}
  spray(a,p){const random=()=>{let s=a.seed;s^=s<<13;s^=s>>>17;s^=s<<5;a.seed=s;return (s>>>0)/4294967296;};for(let i=0;i<Math.max(6,a.size*a.size/18);i++){const angle=random()*Math.PI*2,r=Math.sqrt(random())*a.size/2;this.doc.set(Math.round(p.x+Math.cos(angle)*r),Math.round(p.y+Math.sin(angle)*r),a.color);}}
  endEdit(){if(this.doc.end())this.modified=true;this.updateChrome();}
  finishPolygon(){if(!this.poly)return;const p=this.poly;this.poly=null;if(p.points.length<2)return;this.doc.begin('Polygon');polygon(this.doc,p.points,p.color,p.background,this.fillStyle,this.size,true);this.endEdit();}
  finishCurve(){if(!this.curve)return;const p=this.curve;this.curve=null;this.doc.begin('Curve');bezier(this.doc,[p.start,p.c1,p.c2,p.end],p.color,this.size);this.endEdit();}
  select(x,y,w,h,points=null){this.commitText();this.commitSelection();const right=Math.min(this.doc.width,Math.round(x+w)),bottom=Math.min(this.doc.height,Math.round(y+h));x=Math.max(0,Math.round(x));y=Math.max(0,Math.round(y));w=right-x;h=bottom-y;if(w<1||h<1)throw new Error('The selection does not intersect the picture.');denseLimit(w,h);
    const mask=points?(px,py)=>insidePolygon(px+.5,py+.5,points):null,source=this.doc.extract(x,y,w,h,mask);this.doc.begin('Selection');
    if(!mask)this.doc.rect(x,y,w,h,this.bg);else for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(source.get(xx,yy)>>>24)this.doc.set(x+xx,y+yy,this.bg);
    this.selection={source,x,y,cache:null};this.tool=points?'free-select':'select';this.updateOptions();this.invalidate();
  }
  commitSelection(){if(!this.selection)return;const s=this.selection;this.doc.blit(s.source,s.x,s.y,{transparent:this.opaque?null:this.bg});this.selection=null;this.endEdit();}
  cancelSelection(){if(!this.selection)return;this.selection=null;this.doc.cancel();this.invalidate();}
  deleteSelection(){if(!this.selection)return;this.selection=null;this.endEdit();}
  pasteDocument(source,x=0,y=0){this.commitText();this.commitSelection();this.doc.begin('Paste');if(source.width+x>this.doc.width||source.height+y>this.doc.height)this.doc.resize(Math.max(this.doc.width,source.width+x),Math.max(this.doc.height,source.height+y));this.selection={source,x,y,cache:null};this.tool='select';this.updateOptions();this.updateChrome();}
  async copy(cut=false,system=true){if(!this.selection)return;this.clipboard=Raster.from(this.selection.source.serialize());if(cut)this.deleteSelection();if(system&&navigator.clipboard?.write&&globalThis.ClipboardItem){try{const blob=await encodeImage(this.clipboard);await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);}catch{this.announce('Copied inside Paint. Browser clipboard permission was not granted.');}}}
  async paste(){
    this.commitText();if(navigator.clipboard?.read){try{const items=await navigator.clipboard.read();for(const item of items){const mime=item.types.find(t=>t.startsWith('image/'));if(mime){this.pasteDocument(await decodeImage(await item.getType(mime)));return;}}}catch{}}
    if(this.clipboard){this.pasteDocument(Raster.from(this.clipboard.serialize()));return;}throw new Error('The clipboard has no picture available. Use Paste From, drop an image, or grant clipboard permission.');
  }
  cropSelection(){if(!this.selection)throw new Error('Select a region first.');const s=this.selection,out=new Raster(s.source.width,s.source.height,this.bg);out.blit(s.source,0,0,{transparent:this.opaque?null:this.bg});this.doc.replaceWith(out);this.selection=null;this.endEdit();}
  snapshot(){if(!this.selection)return this.doc;const out=Raster.from(this.doc.serialize());out.blit(this.selection.source,this.selection.x,this.selection.y,{transparent:this.opaque?null:this.bg});return out;}
  openText(x,y,w,h,text=''){this.commitText();this.commitSelection();this.tool='text';this.updateOptions();x=clamp(x,0,this.doc.width-1);y=clamp(y,0,this.doc.height-1);w=Math.min(w,this.doc.width-x);h=Math.min(h,this.doc.height-y);const el=document.createElement('textarea');el.className='text-editor';el.setAttribute('aria-label','Text to insert');el.spellcheck=false;el.value=text;$('text-layer').append(el);this.textEditor={el,x,y,w,h};$('fontbar').hidden=false;this.updateTextStyle();this.positionText();el.focus();el.addEventListener('input',()=>{const t=this.textEditor;if(!t)return;el.style.height=Math.max(t.h*this.zoom,el.scrollHeight)+'px';});}
  positionText(){if(!this.textEditor)return;const t=this.textEditor,v=this.view();Object.assign(t.el.style,{left:(t.x*this.zoom+v.offsetX)+'px',top:(t.y*this.zoom+v.offsetY)+'px',width:(t.w*this.zoom)+'px',minHeight:(t.h*this.zoom)+'px'});}
  updateTextStyle(){for(const key of ['bold','italic','underline'])$('font-'+key)?.classList.toggle('selected',this.font[key]);if(!this.textEditor)return;Object.assign(this.textEditor.el.style,{fontFamily:this.font.family,fontSize:(this.font.size*this.zoom)+'px',fontWeight:this.font.bold?'bold':'normal',fontStyle:this.font.italic?'italic':'normal',textDecoration:this.font.underline?'underline':'none',color:hex(this.fg),background:this.opaque?hex(this.bg):'transparent'});}
  commitText(){if(!this.textEditor)return;const t=this.textEditor;this.textEditor=null;const w=Math.max(1,Math.round(t.el.offsetWidth/this.zoom)),h=Math.max(1,Math.round(t.el.offsetHeight/this.zoom)),text=t.el.value;t.el.remove();$('fontbar').hidden=true;if(!text)return;this.doc.begin('Text');this.drawText({x:t.x,y:t.y,width:w,height:h,text});this.endEdit();}
  drawText(args){const {text,x,y}=args,size=args.size??this.font.size,family=args.font||this.font.family,bold=args.bold??this.font.bold,italic=args.italic??this.font.italic,underline=args.underline??this.font.underline,fg=args.color?color(args.color):this.fg,bg=args.background?color(args.background):this.bg,opaque=args.opaque??this.opaque;
    const w=Math.max(1,Math.min(args.width??this.doc.width-x,this.doc.width-Math.max(0,x))),maxH=Math.max(1,Math.min(args.height??this.doc.height-y,this.doc.height-Math.max(0,y)));denseLimit(w,maxH);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=maxH;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.font=`${italic?'italic ':''}${bold?'bold ':''}${size}px "${family.replace(/["\\]/g,'')}"`;ctx.textBaseline='top';const rows=[];
    for(const paragraph of text.split('\n')){let current='';for(const word of paragraph.split(/(\s+)/)){if(ctx.measureText(current+word).width>w&&current){rows.push(current.trimEnd());current='';}if(ctx.measureText(word).width>w){for(const ch of word){if(ctx.measureText(current+ch).width>w&&current){rows.push(current);current='';}current+=ch;}}else current+=word;}rows.push(current);}
    if(opaque){ctx.fillStyle=hex(bg);ctx.fillRect(0,0,w,maxH);}ctx.fillStyle=hex(fg);rows.forEach((text,i)=>{const ty=i*size*1.2;ctx.fillText(text,1,ty);if(underline)ctx.fillRect(1,ty+size,ctx.measureText(text).width,Math.max(1,Math.round(size/14)));});
    const raster=Raster.fromRGBA(w,maxH,ctx.getImageData(0,0,w,maxH).data);this.doc.blit(raster,Math.round(x),Math.round(y));
  }
  async work(label,fn){if(this.busy)throw new Error('An image operation is already running.');this.busy=true;$('busy-label').textContent=label+'…';$('busy').hidden=false;const start=performance.now();try{await sleep();return await fn();}finally{this.stats.lastOperation=label;this.stats.lastOperationMs=performance.now()-start;this.busy=false;$('busy').hidden=true;this.updateChrome();}}
  async workerOp(operation,args,source=this.doc){
    if(!this.worker){const d=Raster.from(source.serialize());if(operation==='fill')flood(d,args.x,args.y,args.color);else if(operation==='transform')return transform(d,args);else mapColors(d,operation);return d;}
    const id=this.nextWorkerId++,document=source.serialize();const promise=new Promise((resolve,reject)=>this.workerRequests.set(id,{resolve,reject}));this.worker.postMessage({id,operation,args,document},document.tiles.map(t=>t.data.buffer));const result=await promise;this.stats.workerOperations++;return Raster.from(result.document);
  }
  async doFill(x,y,c=this.fg){this.commitText();this.commitSelection();if(this.doc.get(x,y)===c)return;if(this.doc.tiles.size)denseLimit(this.doc.width,this.doc.height);await this.work('Fill with color',async()=>{const result=await this.workerOp('fill',{x,y,color:c});this.doc.begin('Fill with color');this.doc.replaceWith(result);this.endEdit();});}
  async colorOperation(kind){this.commitText();await this.work(kind==='invert'?'Invert colors':'Black and white',async()=>{
    const source=this.selection?.source||this.doc;let result;if(this.renderer.mode==='WebGPU'){try{const gpu=await this.renderer.computeColors(source,kind);if(gpu)result=Raster.from(gpu);}catch(e){console.warn('GPU compute fallback:',e);}}
    if(!result)result=await this.workerOp(kind,{},source);
    if(this.selection){this.selection.source=result;this.selection.cache=null;}else{this.doc.begin(kind==='invert'?'Invert colors':'Black and white');this.doc.replaceWith(result);this.endEdit();}
  });}
  async transformImage(args){this.commitText();if(args.type==='resizeCanvas'){this.commitSelection();dimensions(args.width,args.height);this.doc.begin('Attributes');this.doc.resize(args.width,args.height);this.endEdit();return;}
    const source=this.selection?.source||this.doc;await this.work('Transform image',async()=>{const result=await this.workerOp('transform',{...args,angle:Number(args.angle??90)},source);if(this.selection){this.selection.source=result;this.selection.cache=null;}else{this.doc.begin('Transform image');this.doc.replaceWith(result);this.endEdit();}});
  }
  setZoom(value,screen=null){value=clamp(value,.03125,16);const r=$('overlay').getBoundingClientRect();screen??={x:r.left+r.width/2,y:r.top+r.height/2};const p=this.point({clientX:screen.x,clientY:screen.y});this.zoom=value;this.updateTextStyle();this.render();$('scroller').scrollLeft=p.x*value+3-(screen.x-r.left);$('scroller').scrollTop=p.y*value+3-(screen.y-r.top);this.announce(`${Math.round(value*100)}% magnification`);this.invalidate();}
  previewCanvas(doc=this.snapshot(),max=1024){const scale=Math.min(1,max/Math.max(doc.width,doc.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(doc.width*scale));canvas.height=Math.max(1,Math.round(doc.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle=hex(doc.background);ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;ctx.scale(scale,scale);
    for(const [key,data] of doc.tiles){const [tx,ty]=key.split(',').map(Number);ctx.drawImage(this.renderer.tileCanvas(data),tx*TILE,ty*TILE);}return canvas;}
  renderThumbnail(){const target=$('thumbnail').querySelector('canvas'),ctx=target.getContext('2d');const source=this.previewCanvas(this.snapshot(),160);ctx.fillStyle='#808080';ctx.fillRect(0,0,160,120);const scale=Math.min(160/source.width,120/source.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0,source.width*scale,source.height*scale);}
  async reset(width=640,height=480,background=WHITE,name='untitled'){dimensions(width,height);this.cancelDrawing();this.cancelSelection();if(this.textEditor){this.textEditor.el.remove();this.textEditor=null;}$('fontbar').hidden=true;this.poly=null;this.curve=null;this.doc=new Raster(width,height,background);this.name=name;this.modified=false;this.savedHandle=null;this.format='png';this.zoom=1;$('scroller').scrollLeft=$('scroller').scrollTop=0;this.updateChrome();}
  async confirmDiscard(){this.commitText();this.commitSelection();if(!this.modified)return true;const answer=await this.ui.dialog('Paint',`<p>Save changes to ${escapeHTML(this.name)}?</p>`,{buttons:[{label:'Yes',value:'save',default:true},{label:'No',value:'discard'},{label:'Cancel',value:null}]});if(answer==='save')return await this.save();return answer==='discard';}
  async loadFile(file,mode='open'){try{if(mode==='open'&&!await this.confirmDiscard())return;await this.work('Opening picture',async()=>{const source=await decodeImage(file);if(mode==='paste')this.pasteDocument(source);else{await this.reset(source.width,source.height,source.background,file.name||'untitled');this.doc=source;this.modified=false;this.format=/\.jpe?g$/i.test(file.name||'')?'jpeg':/\.bmp$/i.test(file.name||'')?'bmp':/\.gif$/i.test(file.name||'')?'gif':/\.tiff?$/i.test(file.name||'')?'tiff':'png';this.updateChrome();await this.remember(file);}});}catch(e){this.error(e);}}
  chooseFile(mode='open'){this.fileMode=mode;$('open-file').click();}
  async save(as=false,selectionOnly=false){this.commitText();const source=selectionOnly?this.selection?.source:this.snapshot();if(!source)return false;let name=this.name==='untitled'?'untitled.png':this.name,format=this.format;
    if(as||this.name==='untitled'||selectionOnly){const result=await showDialog(this,'save-as',{name,format,selectionOnly});if(!result)return false;({name,format}=result);}
    try{await this.work('Saving picture',async()=>{const blob=await encodeImage(source,format);this.download(blob,name);if(!selectionOnly){this.name=name;this.format=format;this.modified=false;await this.remember(new File([blob],name,{type:blob.type}));}});return true;}catch(e){this.error(e);return false;}
  }
  download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async remember(file){if(file.size>16*1024*1024)return;try{const db=await idbOpen();await new Promise((resolve,reject)=>{const tx=db.transaction('recent','readwrite'),store=tx.objectStore('recent');store.put({id:file.name,name:file.name,modified:Date.now(),blob:file});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();await this.loadRecent();}catch{}}
  async loadRecent(){try{const db=await idbOpen();const rows=await new Promise((resolve,reject)=>{const r=db.transaction('recent').objectStore('recent').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});this.recent=rows.sort((a,b)=>b.modified-a.modified).slice(0,4);if(rows.length>4){const tx=db.transaction('recent','readwrite');for(const r of rows.sort((a,b)=>b.modified-a.modified).slice(4))tx.objectStore('recent').delete(r.id);}db.close();}catch{}}
  async runCommand(id){try{return await this.command(id);}catch(e){this.error(e);}}
  async command(id){
    if(this.busy)return;this.ui.closeMenus();if(id.startsWith('recent-')){const r=this.recent[Number(id.slice(7))];if(r)await this.loadFile(new File([r.blob],r.name,{type:r.blob.type}));return;}
    switch(id){
      case 'new':if(await this.confirmDiscard())await this.reset();break;
      case 'open':this.chooseFile();break;case 'paste-from':this.chooseFile('paste');break;case 'camera':$('camera-file').click();break;
      case 'save':return this.save();case 'save-as':return this.save(true);case 'copy-to':return this.save(true,true);
      case 'undo':this.commitText();this.commitSelection();this.poly=null;this.curve=null;if(this.doc.undo())this.modified=true;break;
      case 'redo':this.commitSelection();if(this.doc.redo())this.modified=true;break;
      case 'cut':await this.copy(true);break;case 'copy':await this.copy();break;case 'paste':await this.paste();break;
      case 'delete':this.deleteSelection();break;case 'select-all':this.select(0,0,this.doc.width,this.doc.height);break;
      case 'clear':this.commitText();this.commitSelection();this.doc.begin('Clear image');this.doc.clear(this.bg);this.endEdit();break;
      case 'invert':await this.colorOperation('invert');break;
      case 'toggle-opaque':this.opaque=!this.opaque;if(this.selection)this.selection.cache=null;this.updateOptions();this.updateTextStyle();break;
      case 'toggle-toolbox':$('toolbox').hidden=!$('toolbox').hidden;break;case 'toggle-palette':$('colorbox').hidden=!$('colorbox').hidden;break;case 'toggle-statusbar':$('statusbar').hidden=!$('statusbar').hidden;break;
      case 'toggle-fontbar':$('fontbar').hidden=!$('fontbar').hidden;break;case 'toggle-thumbnail':$('thumbnail').hidden=!$('thumbnail').hidden;break;
      case 'toggle-grid':this.grid=!this.grid;break;case 'toggle-touch':document.body.classList.toggle('touch');break;
      case 'zoom-normal':this.setZoom(1);break;case 'zoom-large':this.setZoom(this.largeZoom);break;
      case 'exit':if(await this.confirmDiscard()){$('paint-window').hidden=true;$('restore-window').hidden=false;}break;
      case 'print':await this.print();break;
      case 'send':{this.commitText();const blob=await encodeImage(this.snapshot()),file=new File([blob],this.name==='untitled'?'untitled.png':this.name,{type:blob.type});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:this.name});}else{this.download(blob,file.name);await this.ui.message('Send picture','The picture was downloaded. Attach it in your mail application. This browser cannot attach a file to an email automatically.');}break;}
      default:if(['flip-rotate','stretch-skew','attributes','edit-colors','zoom-custom','help','about','mcp','diagnostics','print-preview','page-setup','view-bitmap','wallpaper-tiled','wallpaper-centered'].includes(id))return showDialog(this,id);else throw new Error('Unknown menu command: '+id);
    }this.updateChrome();
  }
  async print(){this.commitText();let img=$('print-image');if(!img){img=document.createElement('img');img.id='print-image';img.hidden=true;document.body.append(img);}const blob=await encodeImage(this.snapshot()),url=URL.createObjectURL(blob);img.src=url;await img.decode();let style=$('print-style');if(!style){style=document.createElement('style');style.id='print-style';document.head.append(style);}const p=this.pageSetup;style.textContent=`@page{size:A4 ${p.orientation};margin:${p.margin}mm}@media print{#print-image{${p.fit?'max-width:100%;max-height:95vh;object-fit:contain;':`max-width:none;width:${this.doc.width*p.scale/100}px;`}${p.centerH?'margin-left:auto;margin-right:auto;':''}${p.centerV?'position:absolute;top:50%;transform:translateY(-50%);':''}}}`;window.print();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  keyDown(e){
    if(this.ui.dialogs.length||this.ui.openName||this.busy)return;const editing=e.target.closest('input,textarea,select');if(editing){if(e.key==='Escape'&&this.textEditor){this.textEditor.el.remove();this.textEditor=null;$('fontbar').hidden=true;$('overlay').focus();e.preventDefault();}return;}
    if(e.key==='Escape'){this.cancelDrawing();this.cancelSelection();this.poly=null;this.curve=null;this.invalidate();return;}
    if(e.key==='Enter'){this.finishPolygon();this.finishCurve();this.commitSelection();return;}
    if(e.code==='Space'){this.space=true;e.preventDefault();return;}
    if(this.selection&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){const step=e.shiftKey?10:1;this.selection.x+=(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0);this.selection.y+=(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);this.invalidate();e.preventDefault();return;}
    const ctrl=e.ctrlKey||e.metaKey;let id;
    if(ctrl){const key=e.key.toLowerCase();id={n:e.shiftKey?'clear':'new',o:'open',s:e.shiftKey?'save-as':'save',p:'print',z:e.shiftKey?'redo':'undo',y:'redo',x:'cut',c:'copy',v:'paste',a:'select-all',t:'toggle-toolbox',l:'toggle-palette',g:'toggle-grid',f:'view-bitmap',r:'flip-rotate',w:'stretch-skew',i:'invert',e:'attributes',pageup:'zoom-normal',pagedown:'zoom-large'}[key];
      if(['+','=','-','_'].includes(e.key)){const delta=['+','='].includes(e.key)?1:-1;if(this.tool==='brush')this.brushSize=clamp(this.brushSize+delta,1,128);else if(this.tool==='eraser')this.eraserSize=clamp(this.eraserSize+delta,1,128);else if(this.tool==='airbrush')this.airSize=clamp(this.airSize+delta,1,128);else this.size=clamp(this.size+delta,1,128);this.updateOptions();e.preventDefault();return;}
    }else if(e.key==='Delete')id='delete';else if(e.key==='F1')id='help';else if(e.key==='F4')id='mcp';
    if(id){e.preventDefault();this.runCommand(id);}
  }
  error(e){console.error(e);this.announce(e.message||String(e));this.ui.message('Paint',e.message||String(e));}
  state(){return {name:this.name,width:this.doc.width,height:this.doc.height,modified:this.modified,foreground:hex(this.fg),background:hex(this.bg),tool:this.tool,options:{lineWidth:this.size,brush:this.brush,brushSize:this.brushSize,eraserSize:this.eraserSize,airbrushSize:this.airSize,fillStyle:this.fillStyle,opaque:this.opaque,font:{...this.font}},selection:this.selection?{x:this.selection.x,y:this.selection.y,width:this.selection.source.width,height:this.selection.source.height}:null,view:{zoom:this.zoom,scrollX:$('scroller').scrollLeft,scrollY:$('scroller').scrollTop,grid:this.grid,touch:document.body.classList.contains('touch')},history:{undo:this.doc.undoStack.length,redo:this.doc.redoStack.length,bytes:this.doc.usedHistory,limit:this.doc.historyBytes},renderer:{mode:this.renderer.mode,reason:this.renderer.reason,...this.renderer.stats,allocatedTiles:this.doc.tiles.size,tileBytes:this.doc.tiles.size*TILE*TILE*4},operations:{...this.stats},dialog:this.ui.dialogs.at(-1)?.title||null,agent:{connected:this.bridge.active,calls:this.bridge.calls,lastError:this.bridge.lastError},limits:{maxDimension:32768,maxPixels:268435456,maxDensePixels:67108864},busy:this.busy};}
  execute(name,args={}){const next=this.queue.then(()=>this._execute(name,args));this.queue=next.catch(()=>{});return next;}
  async _execute(name,args={}){
    validateTool(name,args);await this.ready;if(this.busy&&!['paint_get_state','paint_get_pixels'].includes(name))throw new Error('An image operation is running. Wait until paint_get_state reports busy: false.');if(this.active)throw new Error('Finish the active pointer gesture before agent editing.');
    if(name==='paint_get_state')return this.state();
    if(name==='paint_batch'){const results=[];for(const operation of args.operations){if(operation.tool==='paint_batch')throw new Error('Nested batches are forbidden.');results.push(await this._execute(operation.tool,operation.arguments||{}));}return {completed:results.length,results};}
    if(name==='paint_get_pixels'){const doc=this.snapshot();return {pixels:args.points.map(p=>{const c=doc.get(p.x,p.y);return {...p,color:hex(c),rgba:[c&255,c>>>8&255,c>>>16&255,c>>>24]};})};}
    if(name==='paint_export'){
      this.commitText();let source=this.snapshot(),blob;const format=args.format||'png';if(args.maxDimension){const canvas=this.previewCanvas(source,args.maxDimension);source=Raster.fromRGBA(canvas.width,canvas.height,canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);}blob=await encodeImage(source,format,args.quality??.92);if(blob.size>16*1024*1024)throw new Error('Agent exports are limited to 16 MiB. Set maxDimension or choose JPEG.');return {mimeType:blob.type,data:await blobBase64(blob),width:source.width,height:source.height,name:this.name};
    }
    if(name==='paint_ui')return this.agentUI(args);
    if(name==='paint_new'){await this.reset(args.width,args.height,args.background?color(args.background):WHITE,args.name||'untitled');}
    else if(name==='paint_set_tool'){this.setTool(args.tool);if(args.size!==undefined){this.size=this.brushSize=this.eraserSize=this.airSize=args.size;}if(args.brush)this.brush=args.brush;if(args.fillStyle)this.fillStyle=args.fillStyle;if(args.opaque!==undefined)this.opaque=args.opaque;this.updateOptions();}
    else if(name==='paint_set_colors'){if(args.foreground)this.fg=color(args.foreground);if(args.background)this.bg=color(args.background);if(args.swap)[this.fg,this.bg]=[this.bg,this.fg];if(this.selection)this.selection.cache=null;}
    else if(name==='paint_stroke'){
      this.commitText();this.commitSelection();this.doc.begin('Agent stroke');const tool=args.tool||'pencil',a={tool,color:tool==='eraser'?this.bg:args.color?color(args.color):this.fg,size:args.size??(tool==='pencil'?1:tool==='brush'?this.brushSize:tool==='eraser'?this.eraserSize:this.airSize),brush:args.brush||this.brush,replace:args.replace?this.fg:null,seed:args.seed||1};try{for(let i=0;i<args.points.length;i++)this.strokeSegment(a,args.points[Math.max(0,i-1)],args.points[i]);this.endEdit();}catch(e){this.doc.cancel();throw e;}
    }
    else if(name==='paint_shape'){
      this.commitText();this.commitSelection();const fg=args.color?color(args.color):this.fg,bg=args.background?color(args.background):this.bg,size=args.size??this.size,style=args.fillStyle||this.fillStyle;this.doc.begin('Agent '+args.kind);
      try{if(args.kind==='polygon'){if(!args.points||args.points.length<3)throw new Error('Polygon requires at least three points.');polygon(this.doc,args.points,fg,bg,style,size,true);}else if(args.kind==='curve'){if(args.points?.length!==4)throw new Error('Curve requires exactly four points.');bezier(this.doc,args.points,fg,size);}else if(args.kind==='line'&&args.points?.length>=2){line(this.doc,args.points[0].x,args.points[0].y,args.points[1].x,args.points[1].y,fg,size);}else{if([args.x,args.y,args.width,args.height].some(v=>v===undefined))throw new Error('Shape requires x, y, width and height.');shape(this.doc,args.kind,args.x,args.y,args.x+args.width-1,args.y+args.height-1,fg,bg,style,size);}this.endEdit();}catch(e){this.doc.cancel();throw e;}
    }
    else if(name==='paint_text'){this.commitText();this.commitSelection();this.doc.begin('Agent text');try{this.drawText(args);this.endEdit();}catch(e){this.doc.cancel();throw e;}}
    else if(name==='paint_fill')await this.doFill(args.x,args.y,args.color?color(args.color):this.fg);
    else if(name==='paint_selection')await this.agentSelection(args);
    else if(name==='paint_transform')await this.transformImage(args);
    else if(name==='paint_edit'){if(args.action==='mono')await this.colorOperation('mono');else await this.command(args.action);}
    else if(name==='paint_view'){if(args.zoom!==undefined)this.setZoom(args.zoom);if(args.scrollX!==undefined)$('scroller').scrollLeft=args.scrollX;if(args.scrollY!==undefined)$('scroller').scrollTop=args.scrollY;if(args.grid!==undefined)this.grid=args.grid;for(const [key,id] of Object.entries({toolbox:'toolbox',palette:'colorbox',statusbar:'statusbar',thumbnail:'thumbnail'}))if(args[key]!==undefined)$(id).hidden=!args[key];if(args.touch!==undefined)document.body.classList.toggle('touch',args.touch);}
    else if(name==='paint_import'){
      if(!/^[A-Za-z0-9+/]*={0,2}$/.test(args.base64))throw new Error('Invalid base64 image.');const data=Uint8Array.from(atob(args.base64),c=>c.charCodeAt(0));const source=await decodeImage(new Blob([data],{type:args.mime}));if(args.mode==='paste')this.pasteDocument(source);else{await this.reset(source.width,source.height,source.background,args.name||'imported.png');this.doc=source;this.modified=true;}
    }
    this.updateChrome();return this.state();
  }
  async agentSelection(a){if(a.opaque!==undefined){this.opaque=a.opaque;if(this.selection)this.selection.cache=null;}
    if(a.action==='create'){if([a.x,a.y,a.width,a.height].some(v=>v===undefined))throw new Error('Selection requires x, y, width and height.');this.select(a.x,a.y,a.width,a.height);}
    else if(a.action==='freeform'){if(!a.points||a.points.length<3)throw new Error('Free-form selection needs at least three points.');const b=bounds(a.points);this.select(b.x,b.y,b.w,b.h,a.points);}
    else if(a.action==='all')this.select(0,0,this.doc.width,this.doc.height);
    else if(a.action==='paste'){if(!this.clipboard)throw new Error('The internal clipboard is empty.');this.pasteDocument(Raster.from(this.clipboard.serialize()),a.x||0,a.y||0);}
    else{const s=this.selection;if(!s)throw new Error('No active selection.');if(a.action==='move'){if(a.x!==undefined)s.x=a.x;if(a.y!==undefined)s.y=a.y;}else if(a.action==='resize'){await this.work('Resize selection',async()=>{s.source=await this.workerOp('transform',{type:'scale',width:a.width,height:a.height},s.source);s.cache=null;});}else if(a.action==='copy')await this.copy(false,false);else if(a.action==='cut')await this.copy(true,false);else if(a.action==='stamp')this.doc.blit(s.source,a.x??s.x,a.y??s.y,{transparent:this.opaque?null:this.bg});else if(a.action==='delete')this.deleteSelection();else if(a.action==='crop')this.cropSelection();else if(a.action==='commit')this.commitSelection();else if(a.action==='cancel')this.cancelSelection();}
  }
  agentUI(a){
    if(a.action==='menu'){this.ui.openMenu(a.target);}
    else if(a.action==='close'){if(this.bitmapView){this.bitmapView.close();return {state:this.state()};}if(this.ui.dialogs.length)this.ui.dialogs.at(-1).close(null);else this.ui.closeMenus();}
    else if(a.action==='command'){this.runCommand(a.target);}
    else{const dialog=this.ui.dialogs.at(-1)?.element;if(!dialog)throw new Error('No open dialog.');
      if(a.action==='set'){const fields=[...dialog.querySelectorAll('[name]')],matches=fields.filter(e=>e.name===a.target);if(!matches.length)throw new Error('Dialog field not found.');const field=matches.find(e=>e.type==='radio'&&e.value===String(a.value))||matches[0];if(field.type==='checkbox')field.checked=Boolean(a.value);else if(field.type==='radio')field.checked=true;else field.value=String(a.value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
      else if(a.action==='click'){const b=[...dialog.querySelectorAll('button')].find(b=>b.id===a.target||b.textContent.trim()===a.target);if(!b||b.disabled)throw new Error('Dialog button not available.');b.click();}
    }
    const d=this.ui.dialogs.at(-1);return {state:this.state(),dialog:d?{title:d.title,fields:[...d.element.querySelectorAll('[name]')].map(e=>({name:e.name,type:e.type,value:e.type==='password'?'[redacted]':e.value,checked:e.checked})),buttons:[...d.element.querySelectorAll('button')].map(b=>({id:b.id,label:b.textContent.trim(),disabled:b.disabled}))}:null};
  }
}
const app=new PaintApp();window.paintXP={ready:app.ready,execute:(name,args)=>app.execute(name,args),state:()=>app.state(),app};
