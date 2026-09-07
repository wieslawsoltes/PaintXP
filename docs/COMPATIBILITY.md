# Compatibility and implementation boundaries

## What “XP-style” means here

The desktop layout recreates the XP-era Luna window, menu organization, compact toolbox, tool options, color box, status bar, and classic dialogs. Mouse and touch control the same raster editor. Touch-sized controls are an optional departure from the original metrics rather than a replacement interface.

**No binary, pixel-diff, or exhaustive behavioral comparison against a particular final Windows XP Paint executable has been performed.** Do not label this release “100% identical,” “fully certified,” or a port of a specific Microsoft build. All 16 original tool categories are implemented, but that is not proof of complete historical parity.

## Editing and visual differences

| Component | Behavior in this release | Difference or boundary |
| --- | --- | --- |
| Window and menus | CSS Luna-style chrome, hand-drawn tool icons, XP-style custom scrollbars, working menus and dialogs | Browser-hosted window, not the original Windows theme engine; metrics and icons are approximations |
| Typography | Tahoma preferred for UI, installed font families for picture text | No fonts distributed; fallback metrics, antialiasing and browser text shaping differ from XP GDI |
| Pencil/brush/line/shapes | Integer pixel raster tools and preview overlays | Shape edge pixels, brush footprints, curve interaction and degeneracies are not verified against GDI |
| Airbrush | Time-based spray with deterministic seeded agent strokes | Random distribution is independent, not the original algorithm |
| Color eraser | Right-button eraser replaces exact foreground pixels with background | Touch has no right mouse button; swap colors or use the agent API for replacement behavior |
| Selection | Rectangle/free-form mask; move/resize; opaque/key-transparent; copy/cut/paste; stamp/trail/crop | Raster-based floating selection; hidden historical modifier-key quirks are not exhaustively reproduced |
| Text | Editable textarea then raster commit; font/size/bold/italic/underline/wrap | No native GDI text box, font chooser, script selector, vertical text, or font embedding |
| Undo | Changed-tile journal with a memory budget | Intentionally more history than historical limited undo; not exact original stack semantics |
| Black and white | Luminance-threshold conversion | Does not put the entire editor into a persistent 1-bit-only document mode; subsequent colored drawing is possible |
| Zoom | Classic entries plus 3.125%–1600% programmatic/custom zoom, pinch | Additional zoom range and touch behavior; nearest preview sampling can hide tiny marks at low zoom |
| Thumbnail and bitmap view | Floating miniature and fullscreen picture view | Browser overlays, not native secondary windows |
| Attributes | Pixels/inches/cm at 96 dpi; crop/extend canvas | Resolution is fixed at 96 dpi in this UI; original file-specific metadata is not maintained |
| Recent files | Four image copies in IndexedDB, subject to storage availability | Not Windows recent-file paths; files larger than 16 MiB are not stored as recent copies |
| Defaults/settings | Palette and custom colors are local-storage backed | Not every tool/window preference persists across reloads; no registry |
| Mobile | Pointer Events, one-finger drawing, two-finger pan/zoom; optional larger controls | Tested with emulated Chromium touch, not a physical iPhone/Android matrix; very narrow screens below 300 CSS pixels are outside the layout target |

## File formats

| Format | Read | Write | Boundaries |
| --- | --- | --- | --- |
| PNG | Browser decoder | Browser encoder | Full picture export; imported alpha is flattened over white |
| JPEG | Browser decoder | Browser encoder with quality control | Lossy; original EXIF/ICC metadata is not round-tripped |
| WebP | Browser decoder | Browser encoder when available | Extra beyond XP; unsupported encoding produces a clear error rather than a mislabeled PNG |
| GIF | Browser decoder, first frame | Original single-frame 256-color writer | No animation timeline; fixed 3-3-2 palette, simple valid LZW stream, no optimization promise |
| BMP | Uncompressed 1/4/8/16/24/32-bit, common bitfields, RLE4/RLE8 | 1/4/8/24-bit from UI; codec also supports 32-bit | No OS/2 core-header guarantee or embedded JPEG/PNG BMP; `.dib` name alone does not make a headerless DIB supported |
| TIFF | First baseline chunky RGB/grayscale/palette image; supported 1/8-bit samples; uncompressed/LZW/PackBits strips | Uncompressed 8-bit RGB | No CMYK, tiled TIFF, multipage editing, CCITT fax, arbitrary predictors, associated-alpha fidelity, orientation/metadata fidelity, or universal TIFF compatibility |

Malformed/unsupported files are rejected. Common browser-decoded formats have header dimension preflight, followed by a second dimension check after decode. Browser codec internals are outside the application's control; do not treat this as a hardened image-processing sandbox for hostile files.

## File/OS/browser adaptations

**Open / Save As:** opens use the browser's device picker; saves download a copy. “Save” does not overwrite an existing disk file in place. The app cannot reproduce Windows XP shell file dialogs or bypass browser download prompts.

**Clipboard:** image data always has an internal app clipboard. System clipboard read/write is attempted only where the browser exposes it and permissions allow it. OS security prompts require user action. Text paste creates an editable text box.

**From Scanner or Camera:** the menu invokes a capture-capable image picker. On mobile it may offer the camera; elsewhere it normally offers files. Native WIA/TWAIN scanner-driver integration is not implemented.

**Print/Page Setup:** browser printing works, with portrait/landscape A4, a common margin value, scaling/fit and centering preferences. The application's preview is a picture preview, not a pagination engine. Arbitrary paper sizes, separate per-side margins, fit-to-N-by-M pages, printer selection, and final pagination belong to the browser/OS and are not XP-identical.

**Send:** uses file sharing where supported, otherwise downloads the picture and asks the user to attach it. It does not silently send email or attach files through a Windows shell integration.

**Set As Background, tiled/centered:** downloads a bitmap and explains the corresponding OS setting. It does not change desktop wallpaper. This limitation is explicitly shown in the dialog rather than hidden behind a nonfunctional button.

**Minimize/maximize/close:** minimize hides the app behind an in-page restore button; maximize requests browser fullscreen; close prompts about unsaved changes and hides the app. These do not control arbitrary native windows.

**Shortcuts:** menu alternatives remain available when a browser reserves Ctrl+N, Ctrl+W, Ctrl+T, or another key combination. OS-level shortcut interception is not guaranteed.

## Graphics and memory limits

The document is sparse, not an infinite canvas. Maximum width/height is 32,768, maximum sparse area is 268,435,456 pixels, and dense operations are limited to 67,108,864 pixels. These checks prevent some giant allocations; they are not a global hard memory budget. Dense document data, undo entries, selection copies, serialization, worker results, canvas decoding, and GPU staging can coexist. Use smaller dimensions on memory-constrained devices.

A completely blank flood changes the implicit background without allocating pixel tiles. A nonblank flood is limited by the whole document's area, even when the target region might be small; this conservative check avoids materializing a giant connected background. Filled huge shapes can also allocate many tiles. The application is optimized for sparse editing and visible-tile presentation, not every worst-case full-canvas workload.

WebGPU texture presentation and invert/monochrome compute are implemented, with Canvas 2D/worker fallbacks. CPU rasterization is still authoritative. Font rendering, codecs and some previews use browser Canvas 2D. A device loss switches presentation to the fallback rather than claiming GPU acceleration remains active.

## MCP boundaries

Agent control covers the app's exposed editing operations, state, image import/export, menus, and named fields/buttons of app dialogs. It does **not** grant operating-system control, arbitrary JavaScript execution, terminal commands, filesystem access, native permission-prompt control, or remote URLs. It cannot force an unsaved export through a blocked browser permission prompt.

The companion serves one explicitly paired local tab at a time, and that tab must remain open. Mobile browser support for the editor is separate from network-accessible MCP deployment. The included server is not configured for remote access, TLS termination, OAuth, multiple users, or background/headless rendering without a tab.

Batches are ordered, not atomic. Timeout, disconnect, and cancellation cannot reliably undo a command already executing in the browser. Inspect the current state before retrying a destructive command.

## Verification status

See [TESTING.md](TESTING.md). Core/editor/protocol checks were run, but real WebGPU hardware, physical mobile devices, native XP parity, universal codec compatibility, and production agent-client interoperability were not certified.
