import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {Raster,shape,flood,transform,color,mapColors} from '../src/raster.js';
const results=[];
function timed(name,fn){const start=performance.now();const value=fn();results.push({name,milliseconds:Math.round((performance.now()-start)*100)/100});return value;}
const d=timed('Create 16,384 × 16,384 sparse document',()=>new Raster(16384,16384));
timed('One 100 px stroke on sparse canvas',()=>{d.begin();shape(d,'line',16000,16000,16100,16100,color('#000000'));d.end();});
const dense=new Raster(4096,4096);
timed('4,096 × 4,096 rectangle boundary',()=>shape(dense,'rect',0,0,4095,4095,color('#000000')));
timed('Flood 16,760,836-pixel interior',()=>flood(dense,2,2,color('#00ff00')));
const sel=timed('Extract 2,048 × 2,048 selection',()=>dense.extract(100,100,2048,2048));
timed('Paste 2,048 × 2,048 selection',()=>dense.blit(sel,2000,2000));
timed('CPU invert 4,096 × 4,096 tiled image',()=>mapColors(dense,'invert'));
timed('Rotate 2,048 × 2,048 selection, 90°',()=>transform(sel,{type:'rotate',angle:90}));
const report={environment:{runtime:process.version,platform:process.platform,architecture:process.arch},note:'Single-run CPU raster measurements inside this container. Not browser, GPU, or mobile benchmarks. No timing guarantees.',sparseTiles:d.tiles.size,denseTiles:dense.tiles.size,results};
console.log(JSON.stringify(report,null,2));await writeFile(new URL('../docs/benchmark-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
