export const TOOL_IDS=['free-select','select','eraser','fill','picker','magnifier','pencil','brush','airbrush','text','line','curve','rect','polygon','ellipse','roundrect'];
const integer=(min=-32768,max=32768)=>({type:'integer',minimum:min,maximum:max});
const number=(min=-32768,max=32768)=>({type:'number',minimum:min,maximum:max});
const str=(max=512)=>({type:'string',maxLength:max});
const enumeration=values=>({type:'string',enum:values});
const boolean={type:'boolean'};
const col={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
const point={type:'object',properties:{x:number(),y:number()},required:['x','y'],additionalProperties:false};
const points={type:'array',items:point,minItems:1,maxItems:10000};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const definitions=[
 ['paint_get_state','Inspect document dimensions, colors, tool options, selection, undo/redo, renderer, and open dialog.',{},[],true],
 ['paint_new','Create a blank document. Destructive: replaces the current image and clears undo history.',{width:integer(1,32768),height:integer(1,32768),background:col,name:str(128)},['width','height']],
 ['paint_set_tool','Select any of the 16 XP tools and set brush, line, fill, and selection options.',{tool:enumeration(TOOL_IDS),size:integer(1,128),brush:enumeration(['square','round','slash','backslash']),fillStyle:enumeration(['outline','filled','solid']),opaque:boolean},['tool']],
 ['paint_set_colors','Set foreground and background colors. Use swap to exchange them.',{foreground:col,background:col,swap:boolean}],
 ['paint_stroke','Draw a connected raster stroke. Eraser uses background; replacement eraser only replaces foreground pixels.',{points,tool:enumeration(['pencil','brush','eraser','airbrush']),color:col,size:integer(1,128),brush:enumeration(['square','round','slash','backslash']),replace:boolean,seed:integer(0,2147483647)},['points']],
 ['paint_shape','Draw a line, rectangle, ellipse, rounded rectangle, polygon, or four-point cubic Bézier curve. Coordinates are document pixels.',{kind:enumeration(['line','rect','ellipse','roundrect','polygon','curve']),x:number(),y:number(),width:integer(1,32768),height:integer(1,32768),points,color:col,background:col,fillStyle:enumeration(['outline','filled','solid']),size:integer(1,128)},['kind']],
 ['paint_text','Rasterize multiline/wrapped text. Font size is in document pixels; fonts must be installed on the host.',{x:integer(),y:integer(),text:str(100000),font:str(128),size:integer(1,512),width:integer(1,32768),height:integer(1,32768),color:col,background:col,bold:boolean,italic:boolean,underline:boolean,opaque:boolean},['x','y','text']],
 ['paint_fill','Flood-fill a connected same-color region. Runs in a raster worker for nontrivial documents.',{x:integer(0),y:integer(0),color:col},['x','y']],
 ['paint_selection','Create, move, resize, copy, cut, paste, stamp, delete, crop, or commit a floating selection. Free-form selection uses polygon points.',{action:enumeration(['create','freeform','all','move','resize','copy','cut','paste','stamp','delete','crop','commit','cancel']),x:integer(),y:integer(),width:integer(1,32768),height:integer(1,32768),points,opaque:boolean},['action']],
 ['paint_transform','Flip, rotate, stretch/skew, scale, or resize canvas. Transforms the floating selection when present, except resizeCanvas.',{type:enumeration(['flipH','flipV','rotate','stretch','scale','resizeCanvas']),width:integer(1,32768),height:integer(1,32768),angle:enumeration(['90','180','270']),horizontal:number(.1,10000),vertical:number(.1,10000),skewX:number(-80,80),skewY:number(-80,80)},['type']],
 ['paint_edit','Undo, redo, clear, invert, or convert to black-and-white. Undo history is memory-bounded.',{action:enumeration(['undo','redo','clear','invert','mono'])},['action']],
 ['paint_view','Set zoom/pan, pixel grid, toolbox, palette, status bar, thumbnail, or mobile touch-size controls.',{zoom:number(.03125,16),scrollX:number(0,1048576),scrollY:number(0,1048576),grid:boolean,toolbox:boolean,palette:boolean,statusbar:boolean,touch:boolean,thumbnail:boolean}],
 ['paint_import','Import a base64 image as a replacement document or as a floating selection. No external URLs or arbitrary filesystem access.',{base64:str(24000000),mime:enumeration(['image/png','image/jpeg','image/bmp','image/gif','image/tiff','image/webp']),name:str(128),mode:enumeration(['open','paste'])},['base64','mime']],
 ['paint_export','Read the document as an image. Returns an image content block for PNG/JPEG/WebP and base64 data for BMP/GIF/TIFF. maxDimension creates a small preview without changing the document.',{format:enumeration(['png','jpeg','webp','bmp','bmp24','bmp256','bmp16','bmpmono','gif','tiff']),maxDimension:integer(1,4096),quality:number(0,1)},[],true],
 ['paint_get_pixels','Read exact document pixels at up to 10,000 coordinates.',{points},['points'],true],
 ['paint_ui','Control visible menus and dialogs without JavaScript evaluation. Set dialog fields by name; click buttons by id or exact label. OS permission prompts still require the user.',{action:enumeration(['menu','command','set','click','close']),target:str(128),value:{type:['string','number','boolean']}},['action']],
 ['paint_batch','Execute up to 100 ordered editing tool calls. Stops on first error. Not atomic: earlier successful calls remain undoable. Nested batches are forbidden.',{operations:{type:'array',minItems:1,maxItems:100,items:schema({tool:str(64),arguments:{type:'object'}},['tool'])}},['operations']]
];
export const MCP_TOOLS=definitions.map(([name,description,properties,required=[],readOnly=false])=>({name,description,inputSchema:schema(properties,required),annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}}));
export function validateTool(name,args={}){const def=MCP_TOOLS.find(t=>t.name===name);if(!def)throw new Error(`Unknown tool: ${name}`);validate(args,def.inputSchema,'arguments');return def;}
function validate(value,s,path){
  if(s.type){const types=Array.isArray(s.type)?s.type:[s.type];const matches=types.some(t=>t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='array'?Array.isArray(value):t==='integer'?Number.isInteger(value):t==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===t);if(!matches)throw new Error(`${path}: expected ${types.join(' or ')}.`);}
  if(s.enum&&!s.enum.includes(value))throw new Error(`${path}: invalid value.`);
  if(typeof value==='number'&&((s.minimum!==undefined&&value<s.minimum)||(s.maximum!==undefined&&value>s.maximum)))throw new Error(`${path}: out of range.`);
  if(typeof value==='string'){if(s.maxLength&&value.length>s.maxLength)throw new Error(`${path}: too long.`);if(s.pattern&&!new RegExp(s.pattern).test(value))throw new Error(`${path}: invalid format.`);}
  if(Array.isArray(value)){if((s.minItems&&value.length<s.minItems)||(s.maxItems&&value.length>s.maxItems))throw new Error(`${path}: invalid array length.`);if(s.items)value.forEach((v,i)=>validate(v,s.items,`${path}[${i}]`));}
  else if(value&&typeof value==='object'){for(const key of s.required||[])if(!(key in value))throw new Error(`${path}.${key} is required.`);for(const [k,v] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))throw new Error('Unsafe property.');if(s.additionalProperties===false&&!(k in (s.properties||{})))throw new Error(`${path}.${k}: unknown field.`);if(s.properties?.[k])validate(v,s.properties[k],`${path}.${k}`);}}
}
