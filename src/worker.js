import {Raster,flood,mapColors,transform} from './raster.js';
self.onmessage=({data:{id,operation,document,args}})=>{
  try{
    const d=Raster.from(document);let result=d,stats={};const start=performance.now();
    if(operation==='fill')stats.pixels=flood(d,args.x,args.y,args.color);
    else if(operation==='invert'||operation==='mono')mapColors(d,operation);
    else if(operation==='transform')result=transform(d,args);
    else throw new Error('Unknown raster worker operation.');
    const output=result.serialize();stats.ms=performance.now()-start;
    self.postMessage({id,document:output,stats},output.tiles.map(t=>t.data.buffer));
  }catch(error){self.postMessage({id,error:error.message});}
};
