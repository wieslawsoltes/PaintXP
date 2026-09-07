/** Stage only public client assets for GitHub Pages. No runtime dependencies. */
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const bundle = await readFile(path.join(root, 'paint-xp.html'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});
for (const entry of ['index.html', 'paint-xp.html', 'src', 'assets', 'docs', 'LICENSE', 'README.md']) {
  await cp(path.join(root, entry), path.join(out, entry), {recursive: true});
}
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'deployment.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  sourceCommit: process.env.GITHUB_SHA || 'local',
  standaloneBytes: bundle.length,
  standaloneSHA256: createHash('sha256').update(bundle).digest('hex'),
  mcp: 'Local companion only; no public MCP endpoint is deployed.'
}, null, 2) + '\n');
console.log('Staged GitHub Pages client in _site/ (server, tokens, and tests excluded).');
