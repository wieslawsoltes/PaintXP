import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {imageDimensions} from '../src/codecs.js';

test('standalone bundle parses, embeds the worker, and has no external dependencies',async()=>{
  const html=await readFile(new URL('../paint-xp.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);assert.doesNotThrow(()=>new vm.Script(scripts[0][1]));
  assert.ok(html.includes('URL.createObjectURL(new Blob('));assert.ok(html.includes('class XPScrollbars'));
  assert.ok(!/<script[^>]+src=/.test(html));assert.ok(!/<link[^>]+href="(?!data:)/.test(html));
  assert.ok(!/^import .+from /m.test(scripts[0][1]));
});
test('image preflight recognizes PNG and GIF dimensions',()=>{
  const png=new Uint8Array(24);png.set([137,80,78,71]);const view=new DataView(png.buffer);view.setUint32(16,12000);view.setUint32(20,9000);
  assert.deepEqual(imageDimensions(png),[12000,9000]);
  const gif=new Uint8Array(10);gif.set([71,73,70]);const gv=new DataView(gif.buffer);gv.setUint16(6,320,true);gv.setUint16(8,240,true);
  assert.deepEqual(imageDimensions(gif),[320,240]);assert.equal(imageDimensions(new Uint8Array(0)),null);
});
test('image preflight recognizes JPEG frame dimensions',()=>{
  const jpeg=new Uint8Array([255,216,255,192,0,8,8,1,224,2,128,3]);
  assert.deepEqual(imageDimensions(jpeg),[640,480]);
});
test('image preflight recognizes extended WebP dimensions',()=>{
  const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'),0);webp.set(new TextEncoder().encode('WEBPVP8X'),8);
  webp[24]=255;webp[25]=3;webp[27]=255;webp[28]=1;assert.deepEqual(imageDimensions(webp),[1024,512]);
});
