const drawings={
 'free-select':'<path d="M4 1 6 6 3 8 6 10 2 16 8 14 12 17 14 12 18 11 13 7 14 3 9 5Z" fill="none" stroke="#333" stroke-dasharray="2 2"/><path d="m9 10 0 8 2-3 3 1Z" fill="white" stroke="black"/>',
 select:'<path d="M2 3h16v14H2Z" fill="none" stroke="#333" stroke-dasharray="2 2"/>',
 eraser:'<path d="m2 12 8-8h7l1 3-8 8H4Z" fill="#eee89c" stroke="#333"/><path d="m2 12 3 3h5l-4-3Z" fill="white" stroke="#333"/>',
 fill:'<path d="m3 10 6-7 8 8-6 6Z" fill="#00b7ae" stroke="#222"/><path d="m3 10 5 5 6-6-5-6Z" fill="#ece9d8" stroke="#222"/><path d="m6 6 0-4 2-1 3 3" fill="none" stroke="black"/><path d="m16 10 3 6-1 2-3-1Z" fill="#153c90" stroke="#222"/>',
 picker:'<path d="m4 13 7-7 3 3-7 7-4 1Z" fill="#77c8cd" stroke="#222"/><path d="m9 5 2-2 2 1 3-3 3 3-3 3 1 2-2 2Z" fill="#333"/><path d="m2 18 4-1-3-2Z" fill="#333"/>',
 magnifier:'<circle cx="8" cy="7" r="5.5" fill="#bfbed7" stroke="#242132"/><path d="m12 12 6 6" stroke="#333" stroke-width="3"/><path d="m4 5 2-2h3" stroke="white" fill="none"/>',
 pencil:'<path d="m4 17 2-6 7-10 4 3-7 11Z" fill="#f4d655" stroke="#222"/><path d="m6 11 4 3-6 3Z" fill="#e2cab1"/><path d="m4 17 2-3 1 2Z" fill="black"/><path d="m12 3 3 3" stroke="#f27761" stroke-width="3"/>',
 brush:'<path d="M9 1h3v10H9Z" fill="#e5bc60" stroke="#333"/><path d="M6 12h9v6H5Z" fill="#e3d444" stroke="#222"/><path d="M7 10h7v3H7Z" fill="#aaa" stroke="#333"/><path d="M7 14v4m3-4v4m3-4v4" stroke="#655e1d"/>',
 airbrush:'<path d="m10 4 3-2 6 6-3 3Z" fill="#152b7a" stroke="#222"/><path d="m9 5 4 5-3 2-5-5Z" fill="#7f80c4" stroke="#222"/><path d="M7 4H5M5 7H2M7 11H4M5 14H2M7 16H5M3 4H1M3 10H1M3 17H1" stroke="#303caf"/>',
 text:'<text x="2" y="17" font-family="Times New Roman,serif" font-size="22" font-weight="bold">A</text>',
 line:'<path d="m2 2 16 16" stroke="#333" stroke-width="1.5"/>',
 curve:'<path d="M11 1c9 5-12 9-3 17" fill="none" stroke="#333" stroke-width="1.5"/>',
 rect:'<path d="M2 4h16v12H2Z" fill="#ece9d8" stroke="#333" stroke-width="1.4"/>',
 polygon:'<path d="m2 16 6-12h7l-5 9h8v4Z" fill="#ece9d8" stroke="#333" stroke-width="1.4"/>',
 ellipse:'<ellipse cx="10" cy="10" rx="8" ry="6" fill="#ece9d8" stroke="#333" stroke-width="1.4"/>',
 roundrect:'<rect x="2" y="4" width="16" height="12" rx="4" fill="#ece9d8" stroke="#333" stroke-width="1.4"/>'
};
export const icon=name=>`<svg viewBox="0 0 20 20" aria-hidden="true">${drawings[name]||''}</svg>`;
export const opacityIcon=opaque=>`<svg viewBox="0 0 32 23" aria-hidden="true"><rect x="1" y="1" width="29" height="21" fill="#164496"/><rect x="3" y="4" width="10" height="14" fill="#e8ee00" stroke="black"/><ellipse cx="16" cy="12" rx="8" ry="8" fill="white" stroke="black"/><rect x="18" y="3" width="10" height="15" fill="#11be24" stroke="black"/>${opaque?'<rect x="10" y="7" width="12" height="12" fill="white"/>':''}<rect x="12" y="9" width="8" height="8" fill="#f10000" stroke="black"/></svg>`;
export const TOOL_NAMES={'free-select':'Free-Form Select',select:'Select',eraser:'Eraser/Color Eraser',fill:'Fill With Color',picker:'Pick Color',magnifier:'Magnifier',pencil:'Pencil',brush:'Brush',airbrush:'Airbrush',text:'Text',line:'Line',curve:'Curve',rect:'Rectangle',polygon:'Polygon',ellipse:'Ellipse',roundrect:'Rounded Rectangle'};
export const TOOL_HELP={'free-select':'Selects a free-form part of the picture to move, copy, or edit.',select:'Selects a rectangular part of the picture to move, copy, or edit.',eraser:'Erases using the background color. Right-drag replaces foreground with background.',fill:'Fills an area with the selected drawing color.',picker:'Picks a color from the picture for drawing.',magnifier:'Changes the magnification. Right-click returns to normal size.',pencil:'Draws a free-form line one pixel wide.',brush:'Draws using a brush with the selected shape and size.',airbrush:'Draws using an airbrush with the selected size.',text:'Inserts text into the picture.',line:'Draws a straight line with the selected line width.',curve:'Draw a line, then drag twice to bend the curve.',rect:'Draws a rectangle with the selected fill style.',polygon:'Click to add vertices; double-click or press Enter to finish.',ellipse:'Draws an ellipse with the selected fill style.',roundrect:'Draws a rounded rectangle with the selected fill style.'};
