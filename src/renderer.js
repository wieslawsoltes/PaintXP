import {TILE,hex,rgba} from './raster.js';
const shader = `
struct View { size:vec2f, offset:vec2f, zoom:f32, grid:f32, doc:vec2f, background:vec4f };
@group(0) @binding(0) var<uniform> view:View;
@group(1) @binding(0) var image:texture_2d<f32>;
@group(1) @binding(1) var nearest:sampler;
struct VOut { @builtin(position) pos:vec4f, @location(0) uv:vec2f, @location(1) pixel:vec2f };
@vertex fn tileVertex(@builtin(vertex_index) i:u32, @location(0) rect:vec4f)->VOut {
  let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let uv=corners[i]; let p=rect.xy+uv*rect.zw;let screen=p*view.zoom+view.offset;
  var o:VOut;o.pos=vec4f(screen/view.size*vec2f(2,-2)+vec2f(-1,1),0,1);o.uv=uv;o.pixel=p;return o;
}
@fragment fn tileFragment(i:VOut)->@location(0) vec4f {
  if(any(i.pixel<vec2f(0))||any(i.pixel>=view.doc)){discard;}
  var c=textureSampleLevel(image,nearest,i.uv,0.0);
  if(view.grid>0.5 && view.zoom>=4.0 && (fract(i.pixel.x)<1.0/view.zoom || fract(i.pixel.y)<1.0/view.zoom)) {c=vec4f(c.rgb*0.72,c.a);}
  return c;
}
@vertex fn baseVertex(@builtin(vertex_index) i:u32)->VOut {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:VOut;
  o.pos=vec4f(p[i],0,1);o.uv=(p[i]*vec2f(1,-1)+1)*0.5;o.pixel=(o.uv*view.size-view.offset)/view.zoom;return o;
}
@fragment fn baseFragment(i:VOut)->@location(0) vec4f {
  if(any(i.pixel<vec2f(0))||any(i.pixel>=view.doc)){return vec4f(0.502,0.502,0.502,1);}
  var c=view.background;
  if(view.grid>0.5 && view.zoom>=4.0 && (fract(i.pixel.x)<1.0/view.zoom || fract(i.pixel.y)<1.0/view.zoom)){c=vec4f(c.rgb*0.72,1);}
  return c;
}`;
const computeShader=`
@group(0) @binding(0) var<storage,read> input:array<u32>;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@group(0) @binding(2) var<uniform> mode:vec4u;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id:vec3u) {
  let i=id.x;if(i>=arrayLength(&input)){return;}let c=input[i];
  if(mode.x==0u){output[i]=c^0x00ffffffu;}else{
    let l=(c&255u)*299u+((c>>8u)&255u)*587u+((c>>16u)&255u)*114u;
    output[i]=select(0xff000000u,0xffffffffu,l>=128000u);if((c>>24u)==0u){output[i]=0u;}
  }
}`;

/** Viewport-only presentation; document dimensions never determine canvas allocation. */
export class Renderer {
  constructor(canvas,onChange=()=>{}){
    this.canvas=canvas;this.onChange=onChange;this.mode='Starting';this.reason='';this.cache=new Map();this.maxCache=192;
    this.stats={frames:0,lastFrameMs:0,uploadedBytes:0,visibleTiles:0,gpuComputePixels:0};this.document=null;
  }
  async init(){
    try{
      if(!navigator.gpu)throw new Error('WebGPU is unavailable in this browser/context.');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter is available.');
      this.device=await adapter.requestDevice();this.context=this.canvas.getContext('webgpu');if(!this.context)throw new Error('WebGPU canvas initialization failed.');
      this.format=navigator.gpu.getPreferredCanvasFormat();this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
      const d=this.device;const module=d.createShaderModule({code:shader});const diagnostics=await module.getCompilationInfo();
      if(diagnostics.messages.some(m=>m.type==='error'))throw new Error(diagnostics.messages.map(m=>m.message).join('\n'));
      this.viewLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
      this.tileLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}}]});
      this.uniform=d.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.viewGroup=d.createBindGroup({layout:this.viewLayout,entries:[{binding:0,resource:{buffer:this.uniform}}]});
      const baseLayout=d.createPipelineLayout({bindGroupLayouts:[this.viewLayout]});
      this.basePipeline=await d.createRenderPipelineAsync({layout:baseLayout,vertex:{module,entryPoint:'baseVertex'},fragment:{module,entryPoint:'baseFragment',targets:[{format:this.format}]},primitive:{topology:'triangle-list'}});
      this.tilePipeline=await d.createRenderPipelineAsync({layout:d.createPipelineLayout({bindGroupLayouts:[this.viewLayout,this.tileLayout]}),vertex:{module,entryPoint:'tileVertex',buffers:[{arrayStride:16,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'}]}]},fragment:{module,entryPoint:'tileFragment',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
      this.sampler=d.createSampler({magFilter:'nearest',minFilter:'nearest'});this.instanceCapacity=16384;
      this.instances=d.createBuffer({size:this.instanceCapacity*16,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
      const computeModule=d.createShaderModule({code:computeShader});const computeDiagnostics=await computeModule.getCompilationInfo();if(computeDiagnostics.messages.some(m=>m.type==='error'))throw new Error(computeDiagnostics.messages.map(m=>m.message).join('\n'));
      this.computePipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module:computeModule,entryPoint:'main'}});
      this.mode='WebGPU';this.adapterInfo=adapter.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description}:{};
      d.lost.then(info=>{this.fallback(`WebGPU device lost: ${info.message||info.reason}`);this.onChange();});
      d.addEventListener('uncapturederror',e=>{console.error('WebGPU:',e.error);this.reason=e.error.message;});
    }catch(error){this.fallback(error.message);}
    this.onChange();return this;
  }
  fallback(reason){
    this.reason=reason;this.clearCache();
    if(this.context){const next=this.canvas.cloneNode(false);this.canvas.replaceWith(next);this.canvas=next;this.context=null;}
    this.ctx=this.canvas.getContext('2d',{alpha:false});this.mode='Canvas 2D';
  }
  clearCache(){for(const c of this.cache.values())c.texture?.destroy();this.cache.clear();}
  tileCanvas(data){const c=document.createElement('canvas');c.width=c.height=TILE;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength),TILE,TILE),0,0);return c;}
  presentationTiles(doc,view){
    const {width,height,zoom,offsetX,offsetY}=view;
    // Power-of-two presentation LOD bounds GPU memory when a huge image is zoomed out.
    let factor=2**Math.max(0,Math.floor(Math.log2(1/zoom)));
    while((Math.ceil(width/(TILE*factor*zoom))+1)*(Math.ceil(height/(TILE*factor*zoom))+1)>this.maxCache)factor*=2;
    const groups=new Map(),size=TILE*factor;
    for(const [key,data] of doc.tiles){const [tx,ty]=key.split(',').map(Number),gx=Math.floor(tx/factor),gy=Math.floor(ty/factor),x=gx*size,y=gy*size;
      if(x>=doc.width||y>=doc.height||(x+size)*zoom+offsetX<0||(y+size)*zoom+offsetY<0||x*zoom+offsetX>width||y*zoom+offsetY>height)continue;
      const cacheKey=factor===1?key:`lod:${factor}:${gx},${gy}`;
      if(factor===1){groups.set(cacheKey,{x,y,size,data,version:doc.versions.get(key)||0});continue;}
      let group=groups.get(cacheKey);if(!group){group={x,y,size,factor,source:[],version:String(doc.background)};groups.set(cacheKey,group);}
      group.source.push({x:tx*TILE,y:ty*TILE,data});group.version+=`|${key}:${doc.versions.get(key)||0}`;
    }return groups;
  }
  composeLOD(group,background){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=TILE;const c=canvas.getContext('2d',{willReadFrequently:true});c.fillStyle=hex(background);c.fillRect(0,0,TILE,TILE);c.imageSmoothingEnabled=false;
    if(!this.lodScratch){this.lodScratch=document.createElement('canvas');this.lodScratch.width=this.lodScratch.height=TILE;}
    const scratch=this.lodScratch.getContext('2d');
    for(const t of group.source){scratch.putImageData(new ImageData(new Uint8ClampedArray(t.data.buffer,t.data.byteOffset,t.data.byteLength),TILE,TILE),0,0);c.drawImage(this.lodScratch,(t.x-group.x)/group.factor,(t.y-group.y)/group.factor,TILE/group.factor,TILE/group.factor);}
    return canvas;
  }
  render(doc,view){
    if(this.mode==='Starting')return;
    const t=performance.now();if(this.document!==doc){this.clearCache();this.document=doc;}
    const {width,height,zoom,offsetX,offsetY,grid}=view;
    const limit=this.device?.limits.maxTextureDimension2D||8192,dpr=Math.min(window.devicePixelRatio||1,3,limit/Math.max(1,width,height));
    const pw=Math.max(1,Math.round(width*dpr)),ph=Math.max(1,Math.round(height*dpr));
    if(this.canvas.width!==pw||this.canvas.height!==ph){this.canvas.width=pw;this.canvas.height=ph;}
    this.canvas.style.width=width+'px';this.canvas.style.height=height+'px';
    const visible=[];let tick=this.stats.frames+1;
    for(const [key,tile] of this.presentationTiles(doc,view)){const {x,y,size,version}=tile;let data=tile.data;
      let c=this.cache.get(key);
      if(!c){c={version:-1};this.cache.set(key,c);}c.tick=tick;
      if(c.version!==version){
        if(tile.source){c.canvas=this.composeLOD(tile,doc.background);data=c.canvas.getContext('2d').getImageData(0,0,TILE,TILE).data;}
        if(this.mode==='WebGPU'){
          if(!c.texture){c.texture=this.device.createTexture({size:[TILE,TILE],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});c.group=this.device.createBindGroup({layout:this.tileLayout,entries:[{binding:0,resource:c.texture.createView()},{binding:1,resource:this.sampler}]});}
          this.device.queue.writeTexture({texture:c.texture},data,{bytesPerRow:TILE*4},[TILE,TILE]);this.stats.uploadedBytes+=data.byteLength;
        }else if(!tile.source)c.canvas=this.tileCanvas(data);
        c.version=version;
      }visible.push({x,y,size,c});
    }
    if(this.mode==='WebGPU'){
      const bg=doc.background,values=new Float32Array([width,height,offsetX,offsetY,zoom,grid?1:0,doc.width,doc.height,(bg&255)/255,(bg>>>8&255)/255,(bg>>>16&255)/255,1]);
      this.device.queue.writeBuffer(this.uniform,0,values);
      const vertices=new Float32Array(visible.length*4);visible.forEach((v,i)=>vertices.set([v.x,v.y,v.size,v.size],i*4));
      if(vertices.length)this.device.queue.writeBuffer(this.instances,0,vertices);
      const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.5,g:.5,b:.5,a:1}}]});
      pass.setPipeline(this.basePipeline);pass.setBindGroup(0,this.viewGroup);pass.draw(3);
      pass.setPipeline(this.tilePipeline);pass.setVertexBuffer(0,this.instances);
      for(let i=0;i<visible.length;i++){pass.setBindGroup(1,visible[i].c.group);pass.draw(6,1,0,i);}
      pass.end();this.device.queue.submit([encoder.finish()]);
    }else{
      const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#808080';ctx.fillRect(0,0,width,height);ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(zoom,zoom);ctx.imageSmoothingEnabled=false;
      ctx.fillStyle=hex(doc.background);ctx.fillRect(0,0,doc.width,doc.height);ctx.beginPath();ctx.rect(0,0,doc.width,doc.height);ctx.clip();
      for(const {x,y,size,c} of visible)ctx.drawImage(c.canvas,x,y,size,size);
      if(grid&&zoom>=4){ctx.strokeStyle='rgba(0,0,0,.28)';ctx.lineWidth=1/zoom;ctx.beginPath();
        for(let x=Math.max(0,Math.floor(-offsetX/zoom));x<=Math.min(doc.width,(width-offsetX)/zoom);x++){ctx.moveTo(x,0);ctx.lineTo(x,doc.height);}
        for(let y=Math.max(0,Math.floor(-offsetY/zoom));y<=Math.min(doc.height,(height-offsetY)/zoom);y++){ctx.moveTo(0,y);ctx.lineTo(doc.width,y);}ctx.stroke();}
      ctx.restore();
    }
    // Keep the current visible working set; evict least-recently-used offscreen tiles.
    const stale=[...this.cache].filter(([,c])=>c.tick!==tick).sort((a,b)=>a[1].tick-b[1].tick);
    while(this.cache.size>Math.max(this.maxCache,visible.length)&&stale.length){const [k,c]=stale.shift();c.texture?.destroy();this.cache.delete(k);}
    this.stats.frames++;this.stats.visibleTiles=visible.length;this.stats.lastFrameMs=performance.now()-t;
  }
  async computeColors(doc,kind){
    if(this.mode!=='WebGPU')return null;
    const entries=[...doc.tiles],output=[];const d=this.device;
    // Bound staging memory to 8 MiB per batch; no giant full-document GPU buffer.
    for(let offset=0;offset<entries.length;offset+=32){
      const chunk=entries.slice(offset,offset+32),length=chunk.length*TILE*TILE,bytes=length*4,joined=new Uint32Array(length);
      chunk.forEach(([,v],i)=>joined.set(v,i*TILE*TILE));
      const input=d.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const out=d.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=d.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const mode=d.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      try{
        d.queue.writeBuffer(input,0,joined);d.queue.writeBuffer(mode,0,new Uint32Array([kind==='invert'?0:1,0,0,0]));
        const group=d.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:out}},{binding:2,resource:{buffer:mode}}]});
        const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(this.computePipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(Math.ceil(length/256));p.end();e.copyBufferToBuffer(out,0,read,0,bytes);d.queue.submit([e.finish()]);
        await read.mapAsync(GPUMapMode.READ);const result=new Uint32Array(read.getMappedRange());
        chunk.forEach(([key],i)=>output.push({key,data:result.slice(i*TILE*TILE,(i+1)*TILE*TILE)}));read.unmap();this.stats.gpuComputePixels+=length;
      }finally{input.destroy();out.destroy();read.destroy();mode.destroy();}
    }
    const c=doc.background,background=kind==='invert'?((c^0xffffff)>>>0):((c&255)*299+(c>>>8&255)*587+(c>>>16&255)*114>=128000?0xffffffff:0xff000000);
    return {...doc.meta(),background,tiles:output};
  }
}
