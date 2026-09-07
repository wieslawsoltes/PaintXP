# AI-agent control and local MCP server

## Architecture

```text
MCP client ── HTTP JSON-RPC / stdio adapter ── loopback Node server
                                                   │
                                       authenticated browser SSE
                                                   │
                                    explicitly authorized Paint tab
                                                   │
                                      shared validated editing API
                                                   │
                                     raster / worker / WebGPU
```

The browser is the editor and source of image state. The Node process supplies networking, protocol framing, authentication, and static assets. It does not execute drawing commands without a connected tab and does not contain a second, divergent image model.

The server implements the tool/resource portions needed by this application using protocol revisions **2025-11-25** and **2025-06-18**. This is not a promise of draft/future protocol support or universal client certification. Primary references: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources).

## Pairing

Run `npm start`. Open its printed App URL in a browser and select **Help → AI Agent Control (MCP) → Enable**. The server uses a cryptographically random token on each start unless a token of at least 24 characters is explicitly provided in `PAINT_MCP_TOKEN`. Reconnect the client with the new token after restarting the server.

For an existing app session, prefer `server/mcp-client.mjs` as the stdio adapter. It forwards the client's JSON-RPC messages to the selected local HTTP endpoint. `server/server.mjs --stdio` is an alternative that starts a **different server instance** on an ephemeral port; pair the tab at that instance's printed URL instead. Do not confuse the two processes.

Use `PAINT_MCP_URL` to configure the adapter or verification script, for example when the server uses a different port. The adapter accepts only loopback HTTP endpoints. `PORT` or `--port` configures the server. The hostname/bind address is not configurable: it is intentionally `127.0.0.1`.

**Stop Access** disconnects the tab. Closing it or stopping the server rejects pending requests. Only one live tab can be paired at a time; another tab receives a conflict until the first disconnects. Reloading the page does not automatically re-enable agent control.

## Protocol surface

| JSON-RPC method | Behavior |
| --- | --- |
| `initialize` | Negotiates one of the two supported revisions; declares tools and resources |
| `ping` | Empty successful result |
| `tools/list` | Returns the 17 shared definitions with JSON input schemas |
| `tools/call` | Validates and queues a task to the paired browser; returns text/structured content or an image content block |
| `resources/list` | `paint://state` and `paint://guide` |
| `resources/read` | Live state through the browser, or the local agent guide |
| `resources/templates/list` | Empty list |
| Notifications | Accepted without a response; running edit rollback is not guaranteed |

The HTTP MCP endpoint uses POST with JSON responses; GET/DELETE return 405. Notifications receive HTTP 202. JSON-RPC batching is not offered. `paint_batch` is a separate application tool for ordered edits, not transport-level JSON-RPC batching. There are no prompts, subscriptions, resumable event replay, sampling, roots, task extensions, or public authorization endpoints.

## Editing tools

All coordinates describe **document pixels**. Colors are `#RRGGBB`. The schema file `src/commands.js` is the authoritative machine-readable reference; `tools/list` returns these same definitions.

| Tool | Main arguments and semantics |
| --- | --- |
| `paint_get_state` | No arguments. Returns document, tool/options, selection bounds, view, history, renderer, operation/busy and agent status |
| `paint_new` | Required `width`, `height`; optional `background`, `name`. Replaces the image and clears history without a second confirmation |
| `paint_set_tool` | Required `tool`; optional `size`, `brush`, `fillStyle`, `opaque`. All 16 tool IDs are supported |
| `paint_set_colors` | `foreground`, `background`, or `swap` |
| `paint_stroke` | Required `points: [{x,y}, ...]`; optional pencil/brush/eraser/airbrush, color, size, brush shape, replacement mode, random seed |
| `paint_shape` | Required `kind`; rectangle-like shapes use `x`,`y`,`width`,`height`; lines/polygons/curves use points. Four points define a cubic curve |
| `paint_text` | Required `x`,`y`,`text`; optional font, pixel size, bounds, colors, bold/italic/underline/opaque. Installed fonts only |
| `paint_fill` | Required `x`,`y`; optional color. Connected same-color fill through the raster worker |
| `paint_selection` | Required action: create/freeform/all/move/resize/copy/cut/paste/stamp/delete/crop/commit/cancel. Bounds/points and opaque flag as appropriate |
| `paint_transform` | Required type: flipH/flipV/rotate/stretch/scale/resizeCanvas. Rotation `angle` is a **string**: `"90"`, `"180"`, or `"270"`. Stretch uses percentages; skew uses degrees |
| `paint_edit` | Required action: undo/redo/clear/invert/mono |
| `paint_view` | Zoom, scrollX/Y, grid, toolbox, palette, statusbar, thumbnail, touch |
| `paint_import` | Required base64 and MIME; optional name and open/paste mode. No URL/path imports |
| `paint_export` | Optional format, quality, maxDimension. PNG/JPEG/WebP become MCP image content; BMP/GIF/TIFF are base64 in text content |
| `paint_get_pixels` | Required points. Returns exact document/selection-composited pixel RGBA values, not a screen screenshot |
| `paint_ui` | Menu, command, set, click, close; targets app command IDs, exact field names and button labels/IDs |
| `paint_batch` | One to 100 ordered operations, each `{tool, arguments}`. Stops at first error; earlier successes remain in the picture |

Shape fill modes are `outline` (foreground outline), `filled` (foreground outline and background interior), and `solid` (foreground interior). Transforms apply to the floating selection when one exists, otherwise to the image. `resizeCanvas` changes canvas bounds, not scale, and applies to the document. `paint_selection` copy/paste uses the app's internal clipboard rather than silently reading the OS clipboard.

Read state before destructive changes. `paint_export` includes a floating selection in its snapshot and commits active text before encoding. A raw `paint_get_pixels` response is exact raster state, not proof that GPU presentation displayed the same pixels; render diagnostics and visual inspection address that separately.

## Example: selection, transform and preview

Call the tools in this order:

```json
{"name":"paint_selection","arguments":{"action":"create","x":20,"y":20,"width":120,"height":80}}
{"name":"paint_transform","arguments":{"type":"rotate","angle":"90"}}
{"name":"paint_selection","arguments":{"action":"move","x":200,"y":100}}
{"name":"paint_selection","arguments":{"action":"commit"}}
{"name":"paint_export","arguments":{"format":"png","maxDimension":1024}}
```

For a single batch, put the editing calls in `operations` with `tool` instead of `name`. Nested batches are prohibited. Keep image export outside a batch when the client should receive a top-level MCP image block.

## Example: control a dialog

```json
{"name":"paint_ui","arguments":{"action":"command","target":"attributes"}}
{"name":"paint_ui","arguments":{"action":"set","target":"width","value":800}}
{"name":"paint_ui","arguments":{"action":"set","target":"height","value":600}}
{"name":"paint_ui","arguments":{"action":"click","target":"OK"}}
```

UI responses describe the current dialog fields/buttons, with password fields redacted. Radio fields are selected by matching their `value`. App command/button actions can initiate asynchronous work; inspect subsequent state and wait until `busy` is false and the expected dialog closes before making dependent edits. Direct semantic tools such as `paint_transform` are preferable for operations that need an awaited completion result.

App menus and dialogs are controllable; browser file pickers, system permission prompts, email software, and OS settings are not.

## Queues, failures and limits

The server caps pending tasks at 32 and times each task out after 120 seconds. The browser executes agent calls in sequence and checks expiry before beginning a queued task. Direct editing is rejected while an image worker operation or pointer gesture is active, rather than racing that operation.

A running command may complete after its client disconnects or times out. Cancellation is best-effort at the request/queue boundary; it is not a transaction rollback. **Inspect state before retrying**, particularly after `paint_new`, import, move, paste, or other non-idempotent operations. A batch is not atomic; use undo deliberately rather than assuming an error erased its earlier calls.

Input schemas reject unknown fields, dangerous property names, malformed colors, nonfinite coordinates, and excessive arrays/strings. The HTTP request-body ceiling is 32 MiB; image import base64 is limited to 24 million characters; exported agent images are limited to 16 MiB; points arrays are limited to 10,000; batches to 100. Dense raster limits are enforced separately. Very large requests and expensive edits can still consume substantial local resources.

## Security model

This is a local, single-user, explicit-opt-in bridge. It uses a random bearer token, loopback binding, strict Host/Origin checks, no permissive CORS, a static-path allowlist, a restrictive script policy, and a shared command allowlist. The token is kept in tab session storage; it is not embedded in saved images or public static assets. Startup logs intentionally display the token for pairing: do not publish those logs.

Agents can read the full open picture and can destructively edit it once access is enabled. An agent's exported image may be sent to that agent's model/service under the user's separate client configuration. Do not authorize access to sensitive pictures with an untrusted client.

There is no arbitrary JavaScript evaluation, shell execution, generic file read/write, remote-image URL loading, or network proxy tool. Do not expose the server on the internet, modify its Origin checks to `*`, or treat it as a hardened multitenant service. No independent security audit or production MCP client certification was performed.
