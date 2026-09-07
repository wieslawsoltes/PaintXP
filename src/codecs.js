import {Raster,rgba,denseLimit} from './raster.js';
export const VGA=[0x000000,0x800000,0x008000,0x808000,0x000080,0x800080,0x008080,0x808080,0xc0c0c0,0xff0000,0x00ff00,0xffff00,0x0000ff,0xff00ff,0x00ffff,0xffffff].map(v=>rgba(v>>16,v>>8&255,v&255));
export function palette332(){return Array.from({length:256},(_,i)=>rgba(Math.round((i>>5)*255/7),Math.round((i>>2&7)*255/7),Math.round((i&3)*255/3)));}
function indexOf(c,bits){
  const r=c&255,g=c>>>8&255,b=c>>>16&255;
  if(bits===1)return r*299+g*587+b*114>=128000?1:0;
  if(bits===8)return (Math.round(r*7/255)<<5)|(Math.round(g*7/255)<<2)|Math.round(b*3/255);
  let best=0,dist=Infinity;VGA.forEach((p,i)=>{const d=(r-(p&255))**2+(g-(p>>>8&255))**2+(b-(p>>>16&255))**2;if(d<dist){dist=d;best=i;}});return best;
}
export function encodeBMP(doc,bits=24){
  denseLimit(doc.width,doc.height);if(![1,4,8,24,32].includes(bits))throw new Error('Unsupported BMP bit depth.');
  const w=doc.width,h=doc.height,stride=Math.ceil(w*bits/32)*4,colors=bits<=8?1<<bits:0,offset=54+colors*4;
  const data=new Uint8Array(offset+stride*h),v=new DataView(data.buffer);v.setUint16(0,0x4d42,true);v.setUint32(2,data.length,true);v.setUint32(10,offset,true);v.setUint32(14,40,true);v.setInt32(18,w,true);v.setInt32(22,h,true);v.setUint16(26,1,true);v.setUint16(28,bits,true);v.setUint32(34,stride*h,true);v.setInt32(38,3780,true);v.setInt32(42,3780,true);v.setUint32(46,colors,true);
  const palette=bits===1?[rgba(0,0,0),rgba(255,255,255)]:bits===4?VGA:palette332();
  for(let i=0;i<colors;i++){const c=palette[i],p=54+i*4;data[p]=c>>>16&255;data[p+1]=c>>>8&255;data[p+2]=c&255;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const c=doc.get(x,y),p=offset+(h-1-y)*stride;
    if(bits>=24){const i=p+x*(bits/8);data[i]=c>>>16&255;data[i+1]=c>>>8&255;data[i+2]=c&255;if(bits===32)data[i+3]=255;}
    else if(bits===8)data[p+x]=indexOf(c,8);else if(bits===4)data[p+(x>>1)]|=indexOf(c,4)<<(x%2===0?4:0);else data[p+(x>>3)]|=indexOf(c,1)<<(7-(x&7));
  }return data;
}
export function decodeBMP(bytes){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(data.length<54||v.getUint16(0,true)!==0x4d42)throw new Error('Invalid BMP file.');
  const offset=v.getUint32(10,true),dib=v.getUint32(14,true);if(dib<40)throw new Error('OS/2 BMP headers are not supported.');
  const w=v.getInt32(18,true),rawh=v.getInt32(22,true),h=Math.abs(rawh),bits=v.getUint16(28,true),compression=v.getUint32(30,true);denseLimit(w,h);
  if(![1,4,8,16,24,32].includes(bits)||![0,1,2,3].includes(compression)||(compression===1&&bits!==8)||(compression===2&&bits!==4))throw new Error('Unsupported BMP encoding.');
  const count=bits<=8?(v.getUint32(46,true)||1<<bits):0,palette=[];
  for(let i=0;i<count;i++){const p=14+dib+i*4;if(p+3>=data.length)throw new Error('Truncated BMP palette.');palette.push(rgba(data[p+2],data[p+1],data[p]));}
  let masks=bits===16?[0x7c00,0x3e0,0x1f]:[0xff0000,0xff00,0xff];if(compression===3){const p=14+(dib>=52?40:dib);masks=[v.getUint32(p,true),v.getUint32(p+4,true),v.getUint32(p+8,true)];}
  const channel=(c,m)=>{if(!m)return 0;let shift=0;while(((m>>>shift)&1)===0&&shift<32)shift++;return Math.round(((c&m)>>>shift)*255/(m>>>shift));};
  const out=new Uint8ClampedArray(w*h*4),u32=new Uint32Array(out.buffer);u32.fill(0xffffffff);
  const put=(x,y,c)=>{if(x>=0&&x<w&&y>=0&&y<h)u32[(rawh<0?y:h-1-y)*w+x]=c;};
  if(compression===1||compression===2){
    let p=offset,x=0,y=0;while(p+1<data.length&&y<h){const n=data[p++],val=data[p++];if(n){for(let i=0;i<n;i++)put(x++,y,palette[bits===8?val:(i%2?val&15:val>>4)]??0xff000000);}
      else if(val===0){x=0;y++;}else if(val===1)break;else if(val===2){if(p+1>=data.length)throw new Error('Truncated BMP RLE delta.');x+=data[p++];y+=data[p++];}
      else{const size=bits===8?val:Math.ceil(val/2);if(p+size>data.length)throw new Error('Truncated BMP RLE pixels.');for(let i=0;i<val;i++)put(x++,y,palette[bits===8?data[p+i]:(i%2?data[p+(i>>1)]&15:data[p+(i>>1)]>>4)]??0xff000000);p+=size+(size&1);}
    }
  }else{
    const stride=Math.ceil(w*bits/32)*4;if(offset+stride*h>data.length)throw new Error('Truncated BMP image.');
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=offset+y*stride;let c;
      if(bits===24){const i=p+x*3;c=rgba(data[i+2],data[i+1],data[i]);}
      else if(bits===16||bits===32){const i=p+x*bits/8,raw=bits===16?v.getUint16(i,true):v.getUint32(i,true);c=rgba(...masks.map(m=>channel(raw,m)));}
      else{const index=bits===8?data[p+x]:bits===4?(x%2?data[p+(x>>1)]&15:data[p+(x>>1)]>>4):(data[p+(x>>3)]>>(7-(x&7))&1);c=palette[index]??0xff000000;}put(x,y,c);
    }
  }return Raster.fromRGBA(w,h,out);
}
export function encodeGIF(doc){
  denseLimit(doc.width,doc.height);if(doc.width>65535||doc.height>65535)throw new Error('GIF dimensions are too large.');
  const w=doc.width,h=doc.height,header=new Uint8Array(13+768+10);header.set(new TextEncoder().encode('GIF89a'));const view=new DataView(header.buffer);view.setUint16(6,w,true);view.setUint16(8,h,true);header[10]=0xf7;
  palette332().forEach((c,i)=>header.set([c&255,c>>>8&255,c>>>16&255],13+i*3));let p=781;header[p++]=0x2c;view.setUint16(p+4,w,true);view.setUint16(p+6,h,true);
  // A valid bounded-dictionary LZW stream. Periodic clear codes keep code width at 9 bits.
  const packed=[];let accumulator=0,nbits=0,count=0;const code=c=>{accumulator|=c<<nbits;nbits+=9;while(nbits>=8){packed.push(accumulator&255);accumulator>>>=8;nbits-=8;}};
  code(256);for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(count===200){code(256);count=0;}code(indexOf(doc.get(x,y),8));count++;}code(257);if(nbits)packed.push(accumulator&255);
  const result=new Uint8Array(header.length+1+packed.length+Math.ceil(packed.length/255)+2);result.set(header);p=header.length;result[p++]=8;
  for(let i=0;i<packed.length;i+=255){const n=Math.min(255,packed.length-i);result[p++]=n;result.set(packed.slice(i,i+n),p);p+=n;}result[p++]=0;result[p]=0x3b;return result;
}
export function encodeTIFF(doc){
  denseLimit(doc.width,doc.height);const n=12,ifd=8,bitsAt=ifd+2+n*12+4,xres=bitsAt+6,yres=xres+8,pixels=yres+8,size=doc.width*doc.height*3;
  const out=new Uint8Array(pixels+size),v=new DataView(out.buffer);out.set([73,73,42,0]);v.setUint32(4,ifd,true);v.setUint16(ifd,n,true);let i=0;
  const tag=(id,type,count,value)=>{const p=ifd+2+i++*12;v.setUint16(p,id,true);v.setUint16(p+2,type,true);v.setUint32(p+4,count,true);if(type===3&&count===1)v.setUint16(p+8,value,true);else v.setUint32(p+8,value,true);};
  tag(256,4,1,doc.width);tag(257,4,1,doc.height);tag(258,3,3,bitsAt);tag(259,3,1,1);tag(262,3,1,2);tag(273,4,1,pixels);tag(277,3,1,3);tag(278,4,1,doc.height);tag(279,4,1,size);tag(282,5,1,xres);tag(283,5,1,yres);tag(296,3,1,2);
  for(let k=0;k<3;k++)v.setUint16(bitsAt+k*2,8,true);for(const p of [xres,yres]){v.setUint32(p,96,true);v.setUint32(p+4,1,true);}
  let p=pixels;for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++){const c=doc.get(x,y);out[p++]=c&255;out[p++]=c>>>8&255;out[p++]=c>>>16&255;}return out;
}
function unpackBits(src,size){const out=new Uint8Array(size);let p=0,q=0;while(p<src.length&&q<size){let n=src[p++];if(n<128){n++;if(p+n>src.length||q+n>size)throw new Error('Invalid TIFF PackBits.');out.set(src.subarray(p,p+n),q);p+=n;q+=n;}else if(n>128){n=257-n;if(p>=src.length||q+n>size)throw new Error('Invalid TIFF PackBits.');out.fill(src[p++],q,q+n);q+=n;}}if(q!==size)throw new Error('Truncated TIFF strip.');return out;}
function tiffLZW(src,size){
  const output=new Uint8Array(size);let bit=0,width=9,next=258,previous=null,q=0,table=[];
  const reset=()=>{table=Array.from({length:258},(_,i)=>i<256?new Uint8Array([i]):null);width=9;next=258;previous=null;};reset();
  const read=()=>{if(bit+width>src.length*8)return -1;let c=0;for(let i=0;i<width;i++,bit++)c=(c<<1)|((src[bit>>3]>>(7-(bit&7)))&1);return c;};
  while(q<size){const c=read();if(c<0||c===257)break;if(c===256){reset();continue;}let entry=table[c];
    if(!entry&&c===next&&previous){entry=new Uint8Array(previous.length+1);entry.set(previous);entry[previous.length]=previous[0];}
    if(!entry||q+entry.length>size)throw new Error('Invalid TIFF LZW stream.');output.set(entry,q);q+=entry.length;
    if(previous&&next<4096){const n=new Uint8Array(previous.length+1);n.set(previous);n[previous.length]=entry[0];table[next++]=n;if(next===(1<<width)-1&&width<12)width++;}previous=entry;
  }if(q!==size)throw new Error('Truncated TIFF LZW strip.');return output;
}
export function decodeTIFF(bytes){
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(a.buffer,a.byteOffset,a.byteLength),le=a[0]===73;
  if(a.length<8||!((a[0]===73&&a[1]===73)||(a[0]===77&&a[1]===77))||v.getUint16(2,le)!==42)throw new Error('Invalid TIFF file.');
  const at=v.getUint32(4,le),n=v.getUint16(at,le),tags=new Map(),sizes={1:1,3:2,4:4,5:8};if(n>4096)throw new Error('Invalid TIFF directory.');
  for(let i=0;i<n;i++){const p=at+2+i*12,id=v.getUint16(p,le),type=v.getUint16(p+2,le),count=v.getUint32(p+4,le),size=sizes[type];if(!size)continue;if(count>1000000)throw new Error('TIFF tag is too large.');const off=count*size<=4?p+8:v.getUint32(p+8,le);if(off+count*size>a.length)throw new Error('Truncated TIFF tag.');const values=[];for(let j=0;j<count;j++)values.push(type===3?v.getUint16(off+j*2,le):type===4?v.getUint32(off+j*4,le):a[off+j]);tags.set(id,values);}
  const tag=(id,fallback)=>tags.get(id)?.[0]??fallback,w=tag(256,0),h=tag(257,0),samples=tag(277,1),bits=tags.get(258)||[1],photo=tag(262,1),compression=tag(259,1),rows=tag(278,h);denseLimit(w,h);
  if(![1,5,32773].includes(compression)||tag(284,1)!==1||![1,8].includes(bits[0])||bits.some(b=>b!==bits[0])||![0,1,2,3].includes(photo)||samples<1||samples>4||(photo===2&&(bits[0]!==8||samples<3))||(photo!==2&&samples!==1))throw new Error('Unsupported TIFF variant. Use chunky 1/8-bit RGB, indexed, or grayscale with uncompressed, LZW, or PackBits strips.');
  const offsets=tags.get(273),counts=tags.get(279);if(!offsets||!counts||!rows)throw new Error('TIFF strip table is missing.');
  const stride=Math.ceil(w*samples*bits[0]/8),raw=new Uint8Array(stride*h);
  for(let i=0;i<offsets.length;i++){const size=stride*Math.min(rows,h-i*rows);if(size<=0)break;const off=offsets[i],len=counts[i];if(off+len>a.length)throw new Error('Truncated TIFF strip.');const src=a.subarray(off,off+len),decoded=compression===32773?unpackBits(src,size):compression===5?tiffLZW(src,size):src;if(decoded.length<size)throw new Error('Truncated TIFF pixels.');raw.set(decoded.subarray(0,size),i*rows*stride);}
  if(tag(317,1)===2){if(bits[0]!==8)throw new Error('Unsupported TIFF predictor.');for(let y=0;y<h;y++)for(let x=samples;x<stride;x++)raw[y*stride+x]=(raw[y*stride+x]+raw[y*stride+x-samples])&255;}
  const pixels=new Uint8ClampedArray(w*h*4),palette=tags.get(320);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*stride+x*samples,i=(y*w+x)*4;if(photo===2){pixels[i]=raw[p];pixels[i+1]=raw[p+1];pixels[i+2]=raw[p+2];}
    else{const value=bits[0]===1?((raw[y*stride+(x>>3)]>>(7-(x&7)))&1)*255:raw[p];if(photo===3){if(!palette)throw new Error('TIFF palette is missing.');const n=palette.length/3,idx=bits[0]===1?value/255:value;pixels[i]=palette[idx]>>8;pixels[i+1]=palette[n+idx]>>8;pixels[i+2]=palette[2*n+idx]>>8;}else pixels[i]=pixels[i+1]=pixels[i+2]=photo===0?255-value:value;}pixels[i+3]=255;
  }return Raster.fromRGBA(w,h,pixels);
}
export function documentCanvas(doc){denseLimit(doc.width,doc.height);const canvas=document.createElement('canvas');canvas.width=doc.width;canvas.height=doc.height;const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(doc.toRGBA(),doc.width,doc.height),0,0);return canvas;}
export async function encodeImage(doc,format='png',quality=.92){
  const variants={'bmp':24,'bmp24':24,'bmp256':8,'bmp16':4,'bmpmono':1};
  if(format in variants)return new Blob([encodeBMP(doc,variants[format])],{type:'image/bmp'});
  if(format==='gif')return new Blob([encodeGIF(doc)],{type:'image/gif'});
  if(format==='tiff')return new Blob([encodeTIFF(doc)],{type:'image/tiff'});
  if(!['png','jpeg','webp'].includes(format))throw new Error('Unknown image format.');
  const canvas=documentCanvas(doc),type='image/'+format;return new Promise((resolve,reject)=>canvas.toBlob(blob=>{canvas.width=canvas.height=1;if(!blob)reject(new Error('The browser could not encode this image.'));else if(blob.type!==type)reject(new Error('This browser does not support '+type+' encoding.'));else resolve(blob);},type,quality));
}
/** Read common image dimensions before asking the browser to allocate a decoder. */
export function imageDimensions(a){
  const v=new DataView(a.buffer,a.byteOffset,a.byteLength),u24=p=>a[p]|a[p+1]<<8|a[p+2]<<16;
  if(a.length>=24&&a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71)return [v.getUint32(16),v.getUint32(20)];
  if(a.length>=10&&a[0]===71&&a[1]===73&&a[2]===70)return [v.getUint16(6,true),v.getUint16(8,true)];
  if(a.length>=4&&a[0]===255&&a[1]===216){
    let p=2;while(p+3<a.length){if(a[p++]!==255)break;while(p<a.length&&a[p]===255)p++;const marker=a[p++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;if(p+2>a.length)break;const n=v.getUint16(p);if(n<2||p+n>a.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&n>=8)return [v.getUint16(p+5),v.getUint16(p+3)];p+=n;
    }
  }
  if(a.length>=30&&String.fromCharCode(...a.subarray(0,4))==='RIFF'&&String.fromCharCode(...a.subarray(8,12))==='WEBP'){
    const kind=String.fromCharCode(...a.subarray(12,16));
    if(kind==='VP8X')return [u24(24)+1,u24(27)+1];
    if(kind==='VP8L'&&a[20]===47)return [1+(a[21]|(a[22]&63)<<8),1+((a[22]>>6)|a[23]<<2|(a[24]&15)<<10)];
    if(kind==='VP8 '&&a[23]===157&&a[24]===1&&a[25]===42)return [v.getUint16(26,true)&16383,v.getUint16(28,true)&16383];
  }
  return null;
}
export async function decodeImage(file){
  if(file.size>256*1024*1024)throw new Error('Image files are limited to 256 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes[0]===0x42&&bytes[1]===0x4d)return decodeBMP(bytes);
  if((bytes[0]===73&&bytes[1]===73)||(bytes[0]===77&&bytes[1]===77))return decodeTIFF(bytes);
  const preflight=imageDimensions(bytes);if(preflight)denseLimit(...preflight);
  let image;
  try{image=await createImageBitmap(file);}catch{throw new Error('This image cannot be read. Supported formats: PNG, JPEG, GIF, BMP, WebP, and baseline TIFF.');}
  try{denseLimit(image.width,image.height);const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0);return Raster.fromRGBA(c.width,c.height,ctx.getImageData(0,0,c.width,c.height).data);}finally{image.close();}
}
export async function blobBase64(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
