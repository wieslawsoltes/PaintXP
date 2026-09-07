/** Deterministic integer rasterizer. No DOM, dependency, or full-canvas allocation. */
export const TILE = 256;
export const WHITE = 0xffffffff;
export const BLACK = 0xff000000;
export function color(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw new Error('Color must be #RRGGBB.');
  return (parseInt(value.slice(1,3),16) | parseInt(value.slice(3,5),16)<<8 | parseInt(value.slice(5,7),16)<<16 | 0xff000000) >>> 0;
}
export function hex(c) { return '#' + [c&255,c>>>8&255,c>>>16&255].map(v=>v.toString(16).padStart(2,'0')).join(''); }
export const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
export function dimensions(w,h) {
  if (!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>32768||h>32768||w*h>268435456)
    throw new Error('Use dimensions from 1 to 32,768 pixels, with at most 268,435,456 pixels.');
}
export function denseLimit(w,h) { dimensions(w,h); if(w*h>67108864) throw new Error('This operation is limited to 64 megapixels to protect browser memory. Crop or resize first.'); }
export function bounds(points,pad=0) {
  let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;
  for(const p of points){ x=Math.min(x,p.x);y=Math.min(y,p.y);r=Math.max(r,p.x);b=Math.max(b,p.y); }
  return {x:Math.floor(x-pad),y:Math.floor(y-pad),w:Math.ceil(r-x+1+2*pad),h:Math.ceil(b-y+1+2*pad)};
}
const equal = (a,b) => { if(a===b)return true;if(!a||!b||a.length!==b.length)return false; for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false; return true; };

export class Raster {
  constructor(width=640,height=480,background=WHITE,{historyBytes=128*1024*1024}={}) {
    dimensions(width,height); this.width=width;this.height=height;this.background=background>>>0;
    this.tiles=new Map();this.versions=new Map();this.revision=0;this.undoStack=[];this.redoStack=[];
    this.historyBytes=historyBytes;this.usedHistory=0;this.transaction=null;this.dirty=new Set();this._readX=-1;this._readY=-1;this._readTile=null;
  }
  meta(){return {width:this.width,height:this.height,background:this.background};}
  begin(label='Edit'){if(this.transaction)throw new Error('An edit is already in progress.');this.transaction={label,before:this.meta(),tiles:new Map()};}
  _record(key){if(this.transaction&&!this.transaction.tiles.has(key))this.transaction.tiles.set(key,this.tiles.get(key)?.slice()||null);}
  _touch(key){this.versions.set(key,(this.versions.get(key)||0)+1);this.dirty.add(key);this.revision++;}
  writable(tx,ty){
    const key=`${tx},${ty}`;this._record(key);let tile=this.tiles.get(key);
    if(!tile){tile=new Uint32Array(TILE*TILE);tile.fill(this.background);this.tiles.set(key,tile);}
    if(this._readX===tx&&this._readY===ty)this._readTile=tile;this._touch(key);return tile;
  }
  get(x,y){x=Math.floor(x);y=Math.floor(y);if(x<0||y<0||x>=this.width||y>=this.height)return this.background;
    const tx=x>>8,ty=y>>8;if(tx!==this._readX||ty!==this._readY){this._readX=tx;this._readY=ty;this._readTile=this.tiles.get(`${tx},${ty}`);}const tile=this._readTile;return tile?tile[(y&255)*TILE+(x&255)]:this.background;}
  set(x,y,c,replace=null){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=this.width||y>=this.height)return;
    c>>>=0;if(replace!==null&&this.get(x,y)!==(replace>>>0))return;if(this.get(x,y)===c)return;
    this.writable(x>>8,y>>8)[(y&255)*TILE+(x&255)]=c;
  }
  span(y,x0,x1,c,replace=null){
    y=Math.round(y);if(y<0||y>=this.height)return;x0=clamp(Math.ceil(x0),0,this.width);x1=clamp(Math.floor(x1),-1,this.width-1);c>>>=0;
    for(let x=x0;x<=x1;){const end=Math.min(x1,(x|255)),key=`${x>>8},${y>>8}`;
      if(!this.tiles.has(key)&&c===this.background&&replace===null){x=end+1;continue;}
      const a=this.writable(x>>8,y>>8),start=(y&255)*TILE+(x&255),stop=start+end-x+1;
      if(replace===null)a.fill(c,start,stop);else for(let i=start;i<stop;i++)if(a[i]===(replace>>>0))a[i]=c;x=end+1;
    }
  }
  rect(x,y,w,h,c){let x0=Math.round(x),y0=Math.round(y),x1=x0+Math.round(w)-1,y1=y0+Math.round(h)-1;
    for(let yy=Math.max(0,y0);yy<=Math.min(this.height-1,y1);yy++)this.span(yy,x0,x1,c);}
  replaceTile(key,value){this._readX=-1;this._record(key);if(value)this.tiles.set(key,value);else this.tiles.delete(key);this._touch(key);}
  end(){
    const t=this.transaction;if(!t)return false;this.transaction=null;t.after=this.meta();t.patches=[];t.bytes=0;
    for(const [key,before] of t.tiles){const current=this.tiles.get(key)||null;if(equal(before,current))continue;
      const after=current?.slice()||null;t.patches.push({key,before,after});t.bytes+=(before?.byteLength||0)+(after?.byteLength||0);}
    delete t.tiles;if(!t.patches.length&&JSON.stringify(t.before)===JSON.stringify(t.after))return false;
    this.usedHistory-=this.redoStack.reduce((s,t)=>s+t.bytes,0);this.redoStack=[];this.undoStack.push(t);this.usedHistory+=t.bytes;
    while(this.usedHistory>this.historyBytes&&this.undoStack.length>1)this.usedHistory-=this.undoStack.shift().bytes;
    this.revision++;return true;
  }
  cancel(){this._readX=-1;const t=this.transaction;if(!t)return;this.transaction=null;Object.assign(this,t.before);
    for(const [k,v] of t.tiles){if(v)this.tiles.set(k,v);else this.tiles.delete(k);this._touch(k);}this.revision++;}
  _restore(t,side){this._readX=-1;Object.assign(this,t[side]);for(const p of t.patches){if(p[side])this.tiles.set(p.key,p[side].slice());else this.tiles.delete(p.key);this._touch(p.key);}this.revision++;}
  undo(){if(this.transaction)this.cancel();const t=this.undoStack.pop();if(!t)return false;this._restore(t,'before');this.redoStack.push(t);return true;}
  redo(){const t=this.redoStack.pop();if(!t)return false;this._restore(t,'after');this.undoStack.push(t);return true;}
  clearHistory(){this.undoStack=[];this.redoStack=[];this.usedHistory=0;}
  clear(c=this.background){for(const key of [...this.tiles.keys()])this.replaceTile(key,null);this.background=c>>>0;this.revision++;}
  resize(w,h){dimensions(w,h);const ow=this.width,oh=this.height;this.width=w;this.height=h;
    for(const [key,tile] of [...this.tiles]){const [tx,ty]=key.split(',').map(Number),x=tx*TILE,y=ty*TILE;
      if(x>=w||y>=h){this.replaceTile(key,null);continue;}
      if((w<ow&&x+TILE>w)||(h<oh&&y+TILE>h)){
        const a=this.writable(tx,ty);for(let yy=0;yy<TILE;yy++){if(y+yy>=h)a.fill(this.background,yy*TILE,(yy+1)*TILE);else if(x+TILE>w)a.fill(this.background,yy*TILE+w-x,(yy+1)*TILE);}
      }
    }this.revision++;
  }
  serialize(){return {...this.meta(),tiles:[...this.tiles].map(([key,data])=>({key,data:data.slice()}))};}
  static from(obj){const d=new Raster(obj.width,obj.height,obj.background);for(const {key,data} of obj.tiles){d.tiles.set(key,data instanceof Uint32Array?data:new Uint32Array(data));d.versions.set(key,1);}return d;}
  replaceWith(other){for(const key of new Set([...this.tiles.keys(),...other.tiles.keys()])){const a=this.tiles.get(key)||null,b=other.tiles.get(key)||null;if(!equal(a,b))this.replaceTile(key,b?.slice()||null);}Object.assign(this,other.meta());this.revision++;}
  extract(x,y,w,h,mask=null){denseLimit(w,h);const out=new Raster(w,h,0);
    for(let ty=0;ty<Math.ceil(h/TILE);ty++)for(let tx=0;tx<Math.ceil(w/TILE);tx++){
      const tile=new Uint32Array(TILE*TILE);let changed=false;
      for(let yy=0;yy<Math.min(TILE,h-ty*TILE);yy++)for(let xx=0;xx<Math.min(TILE,w-tx*TILE);xx++){
        const sx=x+tx*TILE+xx,sy=y+ty*TILE+yy;if(mask&&!mask(sx,sy))continue;const c=this.get(sx,sy);tile[yy*TILE+xx]=c;if(c)changed=true;
      }if(changed){const key=`${tx},${ty}`;out.tiles.set(key,tile);out.versions.set(key,1);}
    }return out;
  }
  blit(source,x,y,{transparent=null,mask=null}={}){
    x=Math.round(x);y=Math.round(y);const x0=Math.max(0,-x),x1=Math.min(source.width,this.width-x);
    for(let sy=Math.max(0,-y);sy<Math.min(source.height,this.height-y);sy++){
      for(let sx=x0;sx<x1;){const dx=sx+x,dy=sy+y,end=Math.min(x1,sx+TILE-(dx&255));let dest=null;
        for(;sx<end;sx++){
          let c=source.get(sx,sy);if((c>>>24)===0||c===transparent||(mask&&!mask(sx,sy)))continue;
          const xx=sx+x,old=this.get(xx,dy);
          if((c>>>24)!==255){const a=(c>>>24)/255;c=rgba(Math.round((c&255)*a+(old&255)*(1-a)),Math.round((c>>>8&255)*a+(old>>>8&255)*(1-a)),Math.round((c>>>16&255)*a+(old>>>16&255)*(1-a)));}
          if(c===old)continue;if(!dest)dest=this.writable(xx>>8,dy>>8);dest[(dy&255)*TILE+(xx&255)]=c;
        }
      }
    }
  }
  toRGBA(){denseLimit(this.width,this.height);const out=new Uint32Array(this.width*this.height);out.fill(this.background);
    for(const [key,a] of this.tiles){const [tx,ty]=key.split(',').map(Number),x=tx*TILE,y=ty*TILE;
      if(x>=this.width||y>=this.height)continue;const w=Math.min(TILE,this.width-x),h=Math.min(TILE,this.height-y);
      for(let row=0;row<h;row++)out.set(a.subarray(row*TILE,row*TILE+w),(y+row)*this.width+x);
    }return new Uint8ClampedArray(out.buffer);
  }
  static fromRGBA(width,height,data){denseLimit(width,height);const d=new Raster(width,height,WHITE),src=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
    for(let ty=0;ty<Math.ceil(height/TILE);ty++)for(let tx=0;tx<Math.ceil(width/TILE);tx++){
      const tile=new Uint32Array(TILE*TILE);tile.fill(WHITE);let nonwhite=false;
      for(let y=0;y<Math.min(TILE,height-ty*TILE);y++){const row=src.subarray((ty*TILE+y)*width+tx*TILE,(ty*TILE+y)*width+Math.min(width,(tx+1)*TILE));tile.set(row,y*TILE);for(const c of row)if(c!==WHITE){nonwhite=true;break;}}
      if(nonwhite){const k=`${tx},${ty}`;d.tiles.set(k,tile);d.versions.set(k,1);}
    }return d;
  }
}
export const rgba=(r,g,b,a=255)=>(r|g<<8|b<<16|a<<24)>>>0;
export function stamp(d,x,y,c,size=1,shape='square',replace=null){
  size=clamp(Math.round(size),1,128);x=Math.round(x);y=Math.round(y);const lo=-Math.floor(size/2),hi=lo+size-1;
  if(size===1){d.set(x,y,c,replace);return;}
  if(shape==='slash'||shape==='backslash'){for(let i=lo;i<=hi;i++)d.set(x+i,y+(shape==='slash'?-i:i),c,replace);return;}
  for(let yy=lo;yy<=hi;yy++){
    if(shape==='round'){const radius=size/2,cy=yy+(size%2===0?.5:0),half=Math.sqrt(Math.max(0,radius*radius-cy*cy));d.span(y+yy,x+Math.ceil(-half-(size%2===0?.5:0)),x+Math.floor(half-(size%2===0?.5:0)),c,replace);}
    else d.span(y+yy,x+lo,x+hi,c,replace);
  }
}
export function line(d,x0,y0,x1,y1,c,size=1,shape='square',replace=null){
  x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
  // Clipping avoids unbounded work for off-document agent coordinates.
  const pad=Math.ceil(size/2),clipped=clipLine(x0,y0,x1,y1,-pad,-pad,d.width+pad,d.height+pad);if(!clipped)return;
  [x0,y0,x1,y1]=clipped.map(Math.round);const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let err=dx+dy;
  for(;;){stamp(d,x0,y0,c,size,shape,replace);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}
}
function clipLine(x0,y0,x1,y1,xmin,ymin,xmax,ymax){const dx=x1-x0,dy=y1-y0;let a=0,b=1;
  for(const [p,q] of [[-dx,x0-xmin],[dx,xmax-x0],[-dy,y0-ymin],[dy,ymax-y0]]){if(p===0){if(q<0)return null;continue;}const r=q/p;if(p<0)a=Math.max(a,r);else b=Math.min(b,r);if(a>b)return null;}
  return [x0+a*dx,y0+a*dy,x0+b*dx,y0+b*dy];}
export function polygon(d,points,fg,bg=WHITE,mode='outline',size=1,close=true){
  if(points.length<2)return;
  if(mode!=='outline'&&points.length>2){const box=bounds(points);for(let y=Math.max(0,box.y);y<Math.min(d.height,box.y+box.h);y++){
    const xs=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));}
    xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)d.span(y,Math.ceil(xs[i]),Math.floor(xs[i+1]),mode==='solid'?fg:bg);
  }}
  if(mode!=='solid'||close){const c=fg;for(let i=1;i<points.length;i++)line(d,points[i-1].x,points[i-1].y,points[i].x,points[i].y,c,size);if(close)line(d,points.at(-1).x,points.at(-1).y,points[0].x,points[0].y,c,mode==='solid'?1:size);}
}
export function shape(d,kind,x0,y0,x1,y1,fg,bg=WHITE,mode='outline',size=1){
  const l=Math.round(Math.min(x0,x1)),r=Math.round(Math.max(x0,x1)),t=Math.round(Math.min(y0,y1)),b=Math.round(Math.max(y0,y1));
  if(kind==='line'){line(d,x0,y0,x1,y1,fg,size);return;}
  if(kind==='rect'){polygon(d,[{x:l,y:t},{x:r,y:t},{x:r,y:b},{x:l,y:b}],fg,bg,mode,size);return;}
  const cx=(l+r)/2,cy=(t+b)/2,rx=(r-l)/2,ry=(b-t)/2;
  if(rx<.5||ry<.5){line(d,l,t,r,b,fg,size);return;}
  const inset=Math.max(1,size),rad=kind==='roundrect'?Math.min(12,rx,ry):0;
  const extents=(y,insetBy)=>{
    const left=l+insetBy,right=r-insetBy,top=t+insetBy,bottom=b-insetBy;if(y<top||y>bottom||left>right||top>bottom)return null;
    if(kind==='ellipse'){const ax=rx-insetBy,ay=ry-insetBy;if(ax<=0||ay<=0)return null;const dx=ax*Math.sqrt(Math.max(0,1-((y-cy)/ay)**2));return [Math.ceil(cx-dx),Math.floor(cx+dx)];}
    const rr=Math.max(0,rad-insetBy),dy=y<top+rr?top+rr-y:y>bottom-rr?y-(bottom-rr):0;
    const dx=rr-Math.sqrt(Math.max(0,rr*rr-dy*dy));return [Math.ceil(left+dx),Math.floor(right-dx)];
  };
  for(let y=Math.max(0,t);y<=Math.min(d.height-1,b);y++){
    const ex=extents(y,0);if(!ex)continue;const ins=extents(y,inset);
    if(mode==='solid'){d.span(y,ex[0],ex[1],fg);continue;}
    if(mode==='filled')d.span(y,ex[0],ex[1],bg);
    if(!ins)d.span(y,ex[0],ex[1],fg);else {d.span(y,ex[0],ins[0]-1,fg);d.span(y,ins[1]+1,ex[1],fg);}
  }
}
export function bezier(d,points,fg,size=1){
  if(points.length!==4)throw new Error('A cubic curve requires four points.');
  const length=points.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-points[i].x,p.y-points[i].y),0),steps=clamp(Math.ceil(length*1.5),8,65536);let prev=points[0];
  for(let i=1;i<=steps;i++){const t=i/steps,u=1-t;const p={x:u*u*u*points[0].x+3*u*u*t*points[1].x+3*u*t*t*points[2].x+t*t*t*points[3].x,y:u*u*u*points[0].y+3*u*u*t*points[1].y+3*u*t*t*points[2].y+t*t*t*points[3].y};line(d,prev.x,prev.y,p.x,p.y,fg,size);prev=p;}
}
export function flood(d,x,y,c){
  x=Math.floor(x);y=Math.floor(y);c>>>=0;if(x<0||y<0||x>=d.width||y>=d.height)return 0;const old=d.get(x,y);if(old===c)return 0;
  if(!d.tiles.size){const count=d.width*d.height;d.clear(c);return count;}
  denseLimit(d.width,d.height); // A nonblank fill can materialize every pixel.
  const stack=[x,y];let count=0;
  while(stack.length){const yy=stack.pop(),xx=stack.pop();if(d.get(xx,yy)!==old)continue;let l=xx,r=xx;
    while(l>0&&d.get(l-1,yy)===old)l--;while(r<d.width-1&&d.get(r+1,yy)===old)r++;
    d.span(yy,l,r,c);count+=r-l+1;
    for(const ny of [yy-1,yy+1]){if(ny<0||ny>=d.height)continue;let inRun=false;for(let nx=l;nx<=r;nx++){const match=d.get(nx,ny)===old;if(match&&!inRun)stack.push(nx,ny);inRun=match;}}
  }return count;
}
export function insidePolygon(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))inside=!inside;
}return inside;}
export function mapColors(d,kind){const convert=c=>kind==='invert'?((c^0x00ffffff)>>>0):((c>>>24)===0?0:((c&255)*299+(c>>>8&255)*587+(c>>>16&255)*114>=128000?WHITE:BLACK));
  const bg=convert(d.background);for(const [key,src] of [...d.tiles]){const out=new Uint32Array(src.length);for(let i=0;i<src.length;i++)out[i]=convert(src[i]);d.replaceTile(key,out);}d.background=bg;d.revision++;
}
export function transform(source,{type,width,height,angle=90,horizontal=100,vertical=100,skewX=0,skewY=0,background=source.background}){
  let w=source.width,h=source.height,fn;
  if(type==='flipH')fn=(x,y)=>[w-1-x,y];else if(type==='flipV')fn=(x,y)=>[x,h-1-y];
  else if(type==='rotate'){
    angle=((angle%360)+360)%360;if(![0,90,180,270].includes(angle))throw new Error('Rotation must be 0, 90, 180, or 270 degrees.');
    if(angle===90){w=source.height;h=source.width;fn=(x,y)=>[y,source.height-1-x];}
    else if(angle===270){w=source.height;h=source.width;fn=(x,y)=>[source.width-1-y,x];}
    else if(angle===180)fn=(x,y)=>[source.width-1-x,source.height-1-y];else fn=(x,y)=>[x,y];
  }else if(type==='scale'){w=Math.round(width);h=Math.round(height);fn=(x,y)=>[Math.floor(x*source.width/w),Math.floor(y*source.height/h)];}
  else if(type==='stretch'){
    if(!Number.isFinite(horizontal)||!Number.isFinite(vertical)||horizontal<=0||vertical<=0||Math.abs(skewX)>80||Math.abs(skewY)>80)throw new Error('Stretch must be positive. Skew must be between -80 and 80 degrees.');
    const sx=horizontal/100,sy=vertical/100,kx=Math.tan(skewX*Math.PI/180),ky=Math.tan(skewY*Math.PI/180),det=1-kx*ky;if(Math.abs(det)<.01)throw new Error('These skew values collapse the image.');
    const sw=source.width*sx,sh=source.height*sy,minX=Math.min(0,kx*sh),minY=Math.min(0,ky*sw);
    w=Math.ceil(sw+Math.abs(kx*sh));h=Math.ceil(sh+Math.abs(ky*sw));fn=(x,y)=>{x+=minX;y+=minY;return [Math.floor((x-kx*y)/det/sx),Math.floor((y-ky*x)/det/sy)];};
  }else throw new Error('Unknown transformation.');
  denseLimit(w,h);const out=new Raster(w,h,background);
  for(let ty=0;ty<Math.ceil(h/TILE);ty++)for(let tx=0;tx<Math.ceil(w/TILE);tx++){
    const tile=new Uint32Array(TILE*TILE);tile.fill(background);let changed=false;
    for(let yy=0;yy<Math.min(TILE,h-ty*TILE);yy++)for(let xx=0;xx<Math.min(TILE,w-tx*TILE);xx++){
      const [sx,sy]=fn(tx*TILE+xx,ty*TILE+yy),c=sx<0||sy<0||sx>=source.width||sy>=source.height?background:source.get(sx,sy);tile[yy*TILE+xx]=c;if(c!==background)changed=true;
    }if(changed){const key=`${tx},${ty}`;out.tiles.set(key,tile);out.versions.set(key,1);}
  }return out;
}
