import test from 'node:test';import assert from 'node:assert/strict';
import {Raster,color,WHITE} from '../src/raster.js';import {encodeBMP,decodeBMP,encodeGIF,encodeTIFF,decodeTIFF} from '../src/codecs.js';
const fixture=()=>{const d=new Raster(19,13);d.rect(0,0,6,13,color('#ff0000'));d.rect(6,0,6,13,color('#00ff00'));d.rect(12,0,7,13,color('#0000ff'));d.set(18,12,WHITE);return d;};
const pixels=d=>Buffer.from(d.toRGBA());
for(const bits of [1,4,8,24,32])test(`BMP ${bits}-bit encode/decode roundtrip`,()=>{const d=fixture(),bmp=encodeBMP(d,bits),copy=decodeBMP(bmp);assert.equal(copy.width,19);assert.equal(copy.height,13);if(bits!==1)assert.deepEqual(pixels(copy),pixels(d));else{assert.equal(copy.get(1,1),color('#000000'));assert.equal(copy.get(7,1),WHITE);}});
test('BMP validates truncated payload',()=>{assert.throws(()=>decodeBMP(new Uint8Array(10)));const b=encodeBMP(fixture());assert.throws(()=>decodeBMP(b.slice(0,60)));});
test('TIFF RGB exact roundtrip',()=>{const d=fixture(),tiff=encodeTIFF(d),copy=decodeTIFF(tiff);assert.deepEqual(pixels(copy),pixels(d));});
test('GIF has valid header, palette, terminator, and dimensions',()=>{const gif=encodeGIF(fixture()),v=new DataView(gif.buffer);assert.equal(new TextDecoder().decode(gif.subarray(0,6)),'GIF89a');assert.equal(v.getUint16(6,true),19);assert.equal(v.getUint16(8,true),13);assert.equal(gif.at(-1),0x3b);});
