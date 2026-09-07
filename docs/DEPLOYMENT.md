# GitHub Pages deployment

Live editor: https://wieslawsoltes.github.io/PaintXP/

Standalone build: https://wieslawsoltes.github.io/PaintXP/paint-xp.html

## What is published

The public site contains the HTML/CSS/JavaScript editor, raster worker, original SVG icon, documentation, screenshots, and the generated standalone HTML. Assets use relative URLs, so the app runs under the `/PaintXP/` project path. The `.nojekyll` marker disables Jekyll processing for branch-based static hosting.

The Node.js MCP companion, tests, environment files, and development configuration are **not** part of the Pages artifact. Pages is a static host, not an MCP server. Run `npm start` from a local clone and use the locally served tab for agent control; do not enter a local pairing token into the public site. The app never automatically enables agent control.

## Build and deployment

The `Build and deploy PaintXP` workflow builds the standalone edition, runs the Node tests, runs the browser suite with real pointer and emulated touch input, stages `_site/`, and publishes it with the official GitHub Pages actions. Pull requests are tested but do not deploy. A deployment is performed after tests succeed on `main`, or when explicitly dispatched on `main`.

```sh
npm run build:pages
```

This generates `_site/` locally without installing runtime packages. The `deployment.json` file records the source commit, standalone byte count, and SHA-256. It distinguishes the committed source from the Pages artifact being served.

Node tests include a project-subdirectory asset check and verify that server/development files are excluded. Browser checks exercise the standalone build's Canvas 2D fallback in CI; they do **not** certify WebGPU hardware execution. Use the existing live GPU verification command on a supporting browser for that separate check.

The initial import validates a checksummed source snapshot and checks in the full source, generated standalone distribution, and screenshots with a temporary import workflow. It uses a normal fast-forward push, never a force push. That temporary workflow is removed after import. Regular CI only publishes artifacts and has no repository-content write permission.

GitHub Pages must remain enabled for this repository. The workflow uses the `github-pages` environment and `pages: write` / `id-token: write` deployment permissions. To redeploy, use the workflow's **Run workflow** action on `main`.
