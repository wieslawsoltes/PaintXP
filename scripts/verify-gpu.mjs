#!/usr/bin/env node
/** Optional live WebGPU check. Requires the server and an explicitly paired browser tab. */
import assert from 'node:assert/strict';
const endpoint = new URL(process.env.PAINT_MCP_URL || 'http://127.0.0.1:5173/mcp');
const token = process.env.PAINT_MCP_TOKEN;
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Use a loopback HTTP Paint endpoint.');
if (!token || token.length < 24) throw new Error('Set PAINT_MCP_TOKEN to the token from npm start.');
if (!process.argv.includes('--allow-replace')) throw new Error('This check REPLACES the open picture. Save it first, then pass --allow-replace.');
let id = 0;
async function call(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}}),
    signal: AbortSignal.timeout(130000)
  });
  const data = await response.json();
  if (!response.ok || data.error || data.result?.isError) throw new Error(JSON.stringify(data));
  return data.result.structuredContent;
}
try {
  const initial = await call('paint_get_state');
  assert.equal(initial.renderer.mode, 'WebGPU', `WebGPU is not active: ${initial.renderer.reason}`);
  await call('paint_new', {width: 512, height: 384, name: 'WebGPU verification'});
  await call('paint_shape', {kind: 'rect', x: 10, y: 10, width: 40, height: 40, color: '#ff0000', fillStyle: 'solid'});
  const before = await call('paint_get_state');
  await call('paint_edit', {action: 'invert'});
  const inverted = await call('paint_get_pixels', {points: [{x: 20, y: 20}, {x: 100, y: 100}]});
  assert.deepEqual(inverted.pixels.map(p => p.color), ['#00ffff', '#000000']);
  const after = await call('paint_get_state');
  assert.ok(after.renderer.gpuComputePixels > before.renderer.gpuComputePixels, 'The operation fell back to CPU compute.');
  await call('paint_edit', {action: 'undo'});
  await call('paint_edit', {action: 'mono'});
  const mono = await call('paint_get_pixels', {points: [{x: 20, y: 20}, {x: 100, y: 100}]});
  assert.deepEqual(mono.pixels.map(p => p.color), ['#000000', '#ffffff']);
  const final = await call('paint_get_state');
  assert.ok(final.renderer.gpuComputePixels > after.renderer.gpuComputePixels);
  assert.equal(final.renderer.mode, 'WebGPU');
  console.log(JSON.stringify({passed: true, checks: ['actual live MCP bridge', 'WebGPU adapter active', 'GPU invert pixel values', 'undo', 'GPU monochrome pixel values', 'GPU compute counters increased'], renderer: final.renderer, note: 'The open picture has been replaced by the test pattern. This checks compute and protocol behavior; inspect presentation visually too.'}, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
