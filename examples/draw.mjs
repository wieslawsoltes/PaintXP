/** Paste this into the browser developer console after opening Paint. It replaces the picture. */
await window.paintXP.ready;
await window.paintXP.execute('paint_batch', {
  operations: [
    {tool: 'paint_new', arguments: {width: 800, height: 600, name: 'Hello from an agent'}},
    {tool: 'paint_shape', arguments: {kind: 'rect', x: 60, y: 60, width: 680, height: 480, color: '#000080', background: '#c0c0c0', fillStyle: 'filled', size: 3}},
    {tool: 'paint_shape', arguments: {kind: 'ellipse', x: 300, y: 140, width: 200, height: 200, color: '#ff0000', fillStyle: 'solid'}},
    {tool: 'paint_text', arguments: {x: 110, y: 395, width: 590, height: 80, text: 'Hello, Paint!', size: 44, bold: true, color: '#000080', opaque: false}}
  ]
});
const preview = await window.paintXP.execute('paint_export', {format: 'png', maxDimension: 1024});
console.log(preview.width, preview.height, preview.mimeType);
