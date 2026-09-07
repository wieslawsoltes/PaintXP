# Validation record

Recorded for this delivered build on **2026-09-07**. These are observed test results, not a claim of perfect historical compatibility or universal browser support.

## Executed checks

| Suite | Observed result | What ran |
| --- | --- | --- |
| `npm test` | **61 passed, 0 failed** | Node.js v22.16.0: sparse raster, 60 randomized flood-fill reference comparisons inside one test, tile history, transforms, alpha/masks, codecs, header guards, standalone syntax, schema validation, HTTP/MCP security and stdio |
| `python tests/browser_test.py` | **55 checks passed** | Chromium with the self-contained HTML injected into about:blank; actual mouse and emulated touch input, Canvas 2D fallback, real Blob worker |
| Browser error capture | **No uncaught desktop or emulated-mobile JavaScript errors observed** | `pageerror` listeners during the browser checks |
| File export interoperability | **All nine UI save-format choices decoded by Pillow** | PNG, JPEG, WebP, BMP monochrome/16-color/256-color/24-bit, GIF, TIFF |
| CPU raster benchmark | Executed, recorded | Single-run Node timings, not browser/GPU/mobile timings |

Machine-readable records are in [unit-test-results.json](unit-test-results.json), [browser-test-results.json](browser-test-results.json), and [benchmark-results.json](benchmark-results.json). Tests include specific assertions rather than only loading the start page.

The browser checks cover the 16 tool entries; pencil endpoint pixels and undo/redo; filled rectangles/ellipses/rounded rectangles; worker fill boundaries; selection copy/move/resize/rotate; invert/undo; text API and interactive text box; exported image decoding; PNG import; pointer drawing tools; multi-stage curve/polygon; free-form selection cancel; Attributes and RGB color dialogs; view/dialog opening; View Bitmap; sparse 268-million-pixel document allocation; viewport-only canvas size; bounded preview export; custom scrollbar arrow and keyboard operation; oversized fill guards; busy-operation protection; touch strokes and pinch zoom; and mobile page overflow.

The server checks use real local HTTP requests and an **emulated browser-side SSE peer**. They cover bearer authentication, Host/Origin checks, static path restrictions, CSP headers, protocol negotiation, tool definitions, invalid arguments, no-tab behavior, tool-task/result flow, pairing conflict, image content blocks, resources, disconnect behavior, and JSON-only stdio. The unchanged `AgentBridge` class was additionally exercised under Node with a minimal app peer against real local HTTP, covering pairing, dispatch, error results, stop, and rapid re-pairing. They are not an end-to-end certification with an installed production agent product.

## Environment limitation: WebGPU not executed here

The installed Chromium is subject to a managed policy that blocks navigation, including normal localhost page navigation. That policy was **not modified**. The browser fixture uses `set_content` in about:blank so the editor can still be exercised. In that context `navigator.gpu` was unavailable and the app reported **Canvas 2D**.

Consequently, WebGPU shader compilation, actual render submission, physical GPU compute, device loss, driver behavior, and GPU throughput were **not verified by this run**. The implementation includes real WebGPU pipelines and shader error handling, but this record does not pass off the fallback test as a GPU test. Actual module/worker/CSP loading over a normally navigated localhost page also needs a normal browser run; HTTP static serving and headers were tested separately.

Physical Android/iOS devices, Safari/Firefox interoperability, browser system clipboard permissions, printing to a real printer, camera permissions, and Windows XP pixel/behavior comparison were not executed. Native OS integrations are intentionally adapted, as described in [COMPATIBILITY.md](COMPATIBILITY.md).

## Reproduce the Node checks

```sh
npm run build
npm test
npm run benchmark
```

No npm dependencies are needed for these commands. The standalone syntax test reads the generated `paint-xp.html`, so rebuild after changing source modules.

## Reproduce browser checks

Test-only requirements: Python, Playwright, Pillow, and an installed Chromium. The application itself has no Python dependency.

```sh
python -m pip install playwright pillow
python -m playwright install chromium
```

Set `CHROMIUM_PATH` to the actual executable path, then run:

```sh
python tests/browser_test.py
```

The default fixture injects the standalone HTML. For normal source-module and secure-context testing, start `npm start` separately and set:

```sh
PAINT_TEST_URL=http://127.0.0.1:5173/ python tests/browser_test.py
```

The script's launch arguments currently request a software ANGLE path for portable headless UI tests. Change those test launch arguments appropriately when testing physical GPU presentation; do not label software rendering as a hardware performance measurement. The report records the renderer actually selected.

On PowerShell, environment variables use `$env:NAME = 'value'` rather than the shell-prefix syntax above. The script defaults to `/usr/bin/chromium`; select the installed browser explicitly on other systems. It writes actual screenshots under `docs/screenshots/`.

## Live WebGPU and MCP smoke check

Run the app normally in a WebGPU-capable browser, pair it through **Help → AI Agent Control**, and check **Help → Rendering Diagnostics** for `WebGPU`. Then use the included verification script. **It intentionally replaces the current picture. Save your work first.**

```sh
export PAINT_MCP_TOKEN='TOKEN_FROM_THE_SERVER'
npm run check:gpu -- --allow-replace
```

On PowerShell:

```powershell
$env:PAINT_MCP_TOKEN = 'TOKEN_FROM_THE_SERVER'
npm run check:gpu -- --allow-replace
```

`PAINT_MCP_URL` selects a nondefault local port. The script checks the real MCP/browser connection, active WebGPU mode, exact GPU invert/monochrome pixel results, increasing compute counters, and undo. It fails rather than claiming GPU success when the fallback was used. **This script is provided, but was not executed successfully in the restricted delivery environment.**

For presentation acceptance, additionally inspect small pixel-grid drawings at 100%, 200%, 800%, and zoomed-out LOD; pan through tile boundaries; compare Canvas 2D and WebGPU screenshots; test window resizing/high DPI; inspect browser validation errors; and simulate device loss. GPU frame completion timing needs GPU-aware measurement rather than this app's CPU submission counter.

## Recorded CPU benchmark

One measured run in the container, Node.js v22.16.0, Linux x64:

| Operation | Milliseconds |
| --- | ---: |
| Create 16,384 × 16,384 sparse document | 0.07 |
| One 100-pixel stroke on that sparse canvas | 0.86 |
| 4,096 × 4,096 rectangle boundary | 14.01 |
| Fill a 16,760,836-pixel interior | 305.02 |
| Extract 2,048 × 2,048 selection | 94.09 |
| Paste 2,048 × 2,048 selection | 91.85 |
| CPU invert 4,096 × 4,096 tiled image | 45.92 |
| Rotate 2,048 × 2,048 selection by 90° | 118.29 |

These are single-run development measurements, not medians, not a controlled comparison to Microsoft Paint, not end-to-end browser latency, and not GPU or mobile benchmarks. Sparse versus dense content, image size, JIT warm-up, memory pressure, worker transfer, encoding, display hardware and browser implementation all affect actual behavior. Re-running the benchmark overwrites the JSON report with that environment's results.
