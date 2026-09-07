/** Reproducible single-file build. Inputs are our own modules, with one-line imports. */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const load=name=>readFile(path.join(root,name),'utf8');
const strip=code=>code.replace(/^import[^\n]*\n/gm,'').replace(/^export (?=(?:const|let|var|function|async function|class)\b)/gm,'');
const worker=strip(await load('src/raster.js'))+'\n'+strip(await load('src/worker.js'));
const files=['raster','codecs','renderer','scrollbars','icons','commands','ui','bridge','dialogs','app'];
let js=(await Promise.all(files.map(async name=>`\n/* ${name}.js */\n`+strip(await load(`src/${name}.js`))))).join('\n');
js=js.replace("new URL('./worker.js',import.meta.url)",()=>`URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}))`);
if(js.includes('import.meta'))throw new Error('Unbundled import.meta remains.');
const svg='data:image/svg+xml;base64,'+Buffer.from(await load('assets/paint.svg')).toString('base64');
js=js.replaceAll('assets/paint.svg',svg);
let html=await load('index.html');html=html.replace('<link rel="stylesheet" href="src/style.css">',`<style>${await load('src/style.css')}</style>`).replaceAll('assets/paint.svg',svg);
html=html.replace('<script type="module" src="src/app.js"></script>',()=>`<script>\n'use strict';\n(()=>{\n${js.replace(/<\/script/gi,'<\\/script')}\n})();\n</script>`);
await writeFile(path.join(root,'paint-xp.html'),html);
console.log(`Built paint-xp.html (${Buffer.byteLength(html).toLocaleString()} bytes), including raster worker. No build dependency.`);
