import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = new URL('../', import.meta.url);

test('Pages staging preserves source assets and supports a project subdirectory', async () => {
  execFileSync(process.execPath, ['scripts/pages.mjs'], {cwd: root});
  const html = await readFile(new URL('_site/index.html', root), 'utf8');
  assert.equal(html, await readFile(new URL('index.html', root), 'utf8'));
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const relative = match[1];
    assert.ok(!relative.startsWith('/'), `Root-relative asset breaks /PaintXP/: ${relative}`);
    if (!/^[a-z]+:/i.test(relative)) await access(new URL(`_site/${relative}`, root));
  }
  await access(new URL('_site/src/worker.js', root));
  await access(new URL('_site/.nojekyll', root));
});

test('Pages staging does not expose the local MCP server or development files', async () => {
  for (const file of ['server/server.mjs', 'server/mcp-client.mjs', '.env', 'tests/server.test.mjs', 'package.json']) {
    await assert.rejects(access(new URL(`_site/${file}`, root)));
  }
});

test('Pages deployment manifest identifies the exact standalone bundle', async () => {
  const bundle = await readFile(new URL('_site/paint-xp.html', root));
  const manifest = JSON.parse(await readFile(new URL('_site/deployment.json', root), 'utf8'));
  assert.equal(manifest.standaloneBytes, bundle.length);
  assert.equal(manifest.standaloneSHA256, createHash('sha256').update(bundle).digest('hex'));
  assert.match(manifest.mcp, /Local companion only/);
});
