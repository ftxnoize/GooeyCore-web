'use strict';
// ============================================================
//  GooeyCore — JavaScript port
//  All data lives in plain JS objects mirroring the PureBasic
//  structures.  Canvas rendering uses the 2D Context API.
// ============================================================

// ---- Constants ----
const VERSION = '1.0';
const CANVAS_W_DEFAULT = 4000;
const CANVAS_H_DEFAULT = 3000;
const PIN_R = 5;
const GRID = 20;
const FONT_DEFAULT = 12;
const NET_COLOR = '#00c8a0';
const SELECT_COLOR = '#e09040';

// ---- Application state ----
let prefs = {
  expertMode: false,
  gridSize: GRID,
  canvasW: CANVAS_W_DEFAULT,
  canvasH: CANVAS_H_DEFAULT,
  fontSize: FONT_DEFAULT,
  outputPath: '',
  version: '1.0',
};

let design = makeEmptyDesign();
let libBlocks = [];   // all loaded libblock definitions
let allLibs = [];     // LibInfo records (colour, name, desc)
let changed = false;
let designFile = '';  // filename hint for save

// selection & interaction
let dragging = null;    // { block, offX, offY }
let netDrag = null;     // { startBlock, startPin, curX, curY }
let groupSel = null;    // { x1,y1,x2,y2 } rubber-band selection
let dragGroup = false;
let textDrag = null;
let oldMouseX = 0, oldMouseY = 0;
let scrollX = 0, scrollY = 0;
let zoom = 1.0;         // current zoom level (1.0 = 100%)
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.1;
let panning = false;
let panStartX = 0, panStartY = 0;

// undo stack
let undoStack = [];
let undoId = 0;

// right-click editing
let ctxBlock = null;   // block under right-click
let ctxNets  = [];     // nets at right-clicked pin

// text editing
let editingText = null; // textblock being edited (null = new)

// ui flags
let showGrid = true;
let showIds  = false;

// ============================================================
//  Data factories
// ============================================================
function makeEmptyDesign() {
  return {
    blocks: [],      // fxblock instances
    nets: [],        // net instances
    texts: [],       // textblock instances
    devId: 1,
    netId: 1,
    textId: 1,
  };
}

function makeBlock(lib, sub, x, y, libDef) {
  const id = design.devId++;
  const b = {
    id, lib, sub, selected: false, x, y,
    width: 0, height: 0,
    pins: libDef.pins.map(p => ({ ...p })),
    params: libDef.params.map(p => ({ ...p })),
  };
  measureBlock(b);
  calcPinPos(b);
  return b;
}

function makeNet(id1, pin1, id2, pin2) {
  const id = design.netId++;
  return {
    netId: id, color: NET_COLOR, selected: false,
    id1, pinName1: pin1.pin_name, pinNum1: pin1.pin_num,
    x1: pin1.px, y1: pin1.py,
    id2, pinName2: pin2.pin_name, pinNum2: pin2.pin_num,
    x2: pin2.px, y2: pin2.py,
  };
}

function makeText(text, x, y) {
  const id = design.textId++;
  const t = { id, selected: false, text_str: text, x, y, width: 0, height: 0 };
  measureText(t);
  return t;
}

// ============================================================
//  Built-in library generation  (mirrors registers.pb)
// ============================================================
function pinR(name, type, desc, num) {
  return { pin_name: name, pin_type: type, pin_desc: desc, pin_side: 'R', pin_num: num ?? 0 };
}
function pinL(name, type, desc, num) {
  return { pin_name: name, pin_type: type, pin_desc: desc, pin_side: 'L', pin_num: num ?? 0 };
}
function preset(val) {
  return { param_num: 1, param_name: 'Preset', param_type: 'Number', param_desc: 'Preset value for register', param_value: String(val) };
}

function buildBuiltins() {
  const cregs = [];
  // R0-R15
  for (let i = 0; i <= 15; i++) {
    cregs.push({ lib:'CREG', sub:`R${i}`, desc:'', pins:[pinR('OUT','CREG','Output pin',0)], params:[preset(0)] });
  }
  cregs.push({ lib:'CREG', sub:'ACC32', desc:'', pins:[pinR('OUT','CREG','Output pin',0)], params:[preset(0)] });
  cregs.push({ lib:'CREG', sub:'FLAGS', desc:'', pins:[pinR('OUT','CREG','Output pin',0)], params:[] });

  const mregs = [];
  for (let i = 0; i <= 127; i++) {
    mregs.push({ lib:'MREG', sub:`MR${i}`, desc:'', pins:[pinR('OUT','MREG','Output pin',0)], params:[preset(0)] });
  }

  const sfrs = [];
  for (let i = 0; i <= 3; i++) sfrs.push({ lib:'SFR', sub:`IN${i}`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  for (let i = 0; i <= 3; i++) sfrs.push({ lib:'SFR', sub:`OUT${i}`, desc:'', pins:[pinL('IN','SFR','Input pin',0)], params:[] });
  sfrs.push({ lib:'SFR', sub:'PIN', desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  sfrs.push({ lib:'SFR', sub:'SWITCH', desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  for (let i = 0; i <= 5; i++) sfrs.push({ lib:'SFR', sub:`POT${i}_K`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[preset('0x0000000A')] });
  for (let i = 0; i <= 5; i++) sfrs.push({ lib:'SFR', sub:`POT${i}`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  for (let i = 0; i <= 5; i++) sfrs.push({ lib:'SFR', sub:`POT${i}_SMTH`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  for (let i = 0; i <= 3; i++) sfrs.push({ lib:'SFR', sub:`LFO${i}_F`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[preset(0)] });
  for (let i = 0; i <= 1; i++) sfrs.push({ lib:'SFR', sub:`RAMP${i}_F`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[preset(0)] });
  for (let i = 0; i <= 3; i++) {
    sfrs.push({ lib:'SFR', sub:`LFO${i}_S`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
    sfrs.push({ lib:'SFR', sub:`LFO${i}_C`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  }
  for (let i = 0; i <= 1; i++) sfrs.push({ lib:'SFR', sub:`RAMP${i}_R`, desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  sfrs.push({ lib:'SFR', sub:'MAXTEMPO',  desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[preset('0x00007FFF')] });
  sfrs.push({ lib:'SFR', sub:'TAPTEMPO',  desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  sfrs.push({ lib:'SFR', sub:'SAMPLECNT', desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  sfrs.push({ lib:'SFR', sub:'NOISE',     desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  sfrs.push({ lib:'SFR', sub:'BOOTSTAT',  desc:'', pins:[pinR('OUT','SFR','Output pin',0)], params:[] });
  for (const [sub,val] of [['TAPSTKRLD','0x00008CA0'],['TAPDBRLD','0x000001E0'],['SWDBRLD','0x000001E0'],['PRGDBRLD','0x00000960'],['OFLRLD','0x000003C0']]) {
    sfrs.push({ lib:'SFR', sub, desc:'', pins:[], params:[preset(val)] });
  }

  const consts = [];
  for (let i=0;i<=3;i++) consts.push({lib:'CONST',sub:`LFO${i}`,desc:`Value: 0x${(i*2).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (const [sub,desc] of [['SIN','Value: 0x00'],['COS','Value: 0x01'],['POS','Value: 0x00'],['NEG','Value: 0x08'],['RMP0','Value: 0x00'],['RMP1','Value: 0x01'],['L512','Value: 0x00'],['L1024','Value: 0x04'],['L2048','Value: 0x08'],['L4096','Value: 0x0C']]) {
    consts.push({lib:'CONST',sub,desc,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  }
  for (let i=0;i<=3;i++) consts.push({lib:'CONST',sub:`XF${i}`,desc:`Value: 0x${(i*16).toString(16).padStart(2,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  consts.push({lib:'CONST',sub:'USER0',desc:'Value: 0x00',pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  consts.push({lib:'CONST',sub:'USER1',desc:'Value: 0x20',pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (let i=0;i<=3;i++) consts.push({lib:'CONST',sub:`OUT${i}OFLO`,desc:`Value: 0x${(Math.pow(2,i+12)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (let i=0;i<=3;i++) consts.push({lib:'CONST',sub:`IN${i}OFLO`,desc:`Value: 0x${(Math.pow(2,i+8)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (const [sub,desc] of [['TAP','Value: 0x0040'],['TB2NTB1','Value: 0x0020'],['TAPSTKY','Value: 0x0010'],['NEWTT','Value: 0x0008'],['TAPRE','Value: 0x0004'],['TAPPE','Value: 0x0002']]) {
    consts.push({lib:'CONST',sub,desc,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  }
  for (let i=0;i<=4;i++) consts.push({lib:'CONST',sub:`SW${i}`,desc:`Value: 0x${(Math.pow(2,i)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (let i=0;i<=4;i++) consts.push({lib:'CONST',sub:`SW${i}RE`,desc:`Value: 0x${(Math.pow(2,i+5)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (let i=0;i<=4;i++) consts.push({lib:'CONST',sub:`SW${i}PE`,desc:`Value: 0x${(Math.pow(2,i+10)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (const [sub,desc] of [['PLLRANGE0','Value: 0x0001'],['PLLRANGE1','Value: 0x0002'],['MNS','Value: 0x0004']]) {
    consts.push({lib:'CONST',sub,desc,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  }
  for (let i=0;i<=6;i++) consts.push({lib:'CONST',sub:`I2CA${i}`,desc:`Value: 0x${(Math.pow(2,i+3)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});
  for (let i=0;i<=15;i++) consts.push({lib:'CONST',sub:`PR${i}`,desc:`Value: 0x${(Math.pow(2,i)|0).toString(16).padStart(4,'0')}`,pins:[pinR('OUT','CONST','Output pin',0)],params:[]});

  const xtra = [];
  xtra.push({
    lib:'XTRA', sub:'MEM_BLOCK', desc:'',
    pins:[pinL('MEM_IO','MEM','Memory I/O pin',0)],
    params:[
      { param_num:1, param_name:'MEM_NAME', param_type:'String', param_desc:'Name of memory block', param_value:'Mem_name' },
      { param_num:2, param_name:'MEM_SIZE', param_type:'Integer', param_desc:'Size of the memory block', param_value:'0' },
    ],
  });

  return { cregs, mregs, sfrs, consts, xtra };
}

// ============================================================
//  Library colour map
// ============================================================
const LIB_COLORS = {
  CREG:  { r:255,g:255,b:255, tr:0,tg:0,tb:0, desc:'Core registers' },
  MREG:  { r:153,g:204,b:255, tr:0,tg:0,tb:0, desc:'Memory registers MR0–MR127' },
  SFR:   { r:102,g:210,b:51,  tr:0,tg:0,tb:0, desc:'Special function registers' },
  CONST: { r:255,g:153,b:51,  tr:0,tg:0,tb:0, desc:'Constants and masks' },
  XTRA:  { r:153,g:255,b:51,  tr:0,tg:0,tb:0, desc:'Extra/utility blocks' },
};

function libColor(lib) {
  return LIB_COLORS[lib] ?? { r:80,g:130,b:200, tr:255,tg:255,tb:255, desc:'' };
}

// ============================================================
//  Canvas & rendering
// ============================================================
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const dpr = window.devicePixelRatio || 1;
  // CSS size (what the layout occupies)
  const cssW = wrap.clientWidth;
  const cssH = wrap.clientHeight;
  // Physical pixel size of the drawing buffer
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  // Keep the canvas element filling the container in CSS pixels
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  // Scale all drawing calls so world-space units remain in CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resizeCanvas);

function clampScroll() {
  const { w, h } = canvasCSS();
  const maxX = Math.max(0, prefs.canvasW * zoom - w + 40);
  const maxY = Math.max(0, prefs.canvasH * zoom - h + 40);
  scrollX = Math.max(0, Math.min(scrollX, maxX));
  scrollY = Math.max(0, Math.min(scrollY, maxY));
}

// Convert a canvas CSS-pixel position to a world coordinate
function canvasToWorld(cx, cy) {
  return { x: cx / zoom + scrollX, y: cy / zoom + scrollY };
}
// Convert a world coordinate to a canvas CSS-pixel position
function worldToCanvas(wx, wy) {
  return { x: (wx - scrollX) * zoom, y: (wy - scrollY) * zoom };
}

// ---- Block sizing ----
function measureBlock(b) {
  const fs = prefs.fontSize;
  ctx.font = `${fs}px JetBrains Mono, monospace`;
  const tw = ctx.measureText(b.sub).width;
  const leftPins   = b.pins.filter(p => p.pin_side === 'L');
  const rightPins  = b.pins.filter(p => p.pin_side === 'R');
  const topPins    = b.pins.filter(p => p.pin_side === 'T');
  const bottomPins = b.pins.filter(p => p.pin_side === 'B');
  const sideRows = Math.max(leftPins.length, rightPins.length, 1);
  const sidePinLabelW = b.pins
    .filter(p => p.pin_side === 'L' || p.pin_side === 'R')
    .reduce((m, p) => Math.max(m, ctx.measureText(p.pin_name).width), 0);
  // Width: wide enough for the sub name, side pin labels, and top/bottom pins
  const tbPins = Math.max(topPins.length, bottomPins.length);
  const minWforTB = tbPins > 0 ? tbPins * 30 + 20 : 0;
  b.width  = Math.max(80, minWforTB, tw + sidePinLabelW * 2 + 28);
  // Height: enough rows for side pins, plus extra if there are T/B pins
  const tbExtra = (topPins.length > 0 || bottomPins.length > 0) ? 12 : 0;
  b.height = Math.max(36, sideRows * (fs + 8) + 20 + tbExtra);
}

function measureText(t) {
  const fs = prefs.fontSize;
  ctx.font = `${fs}px JetBrains Mono, monospace`;
  const lines = t.text_str.split('\n');
  t.width  = Math.max(...lines.map(l => ctx.measureText(l).width)) + 10;
  t.height = lines.length * (fs + 4) + 8;
}

// ---- Pin position calculation ----
// Supports all four sides: L (left), R (right), T (top), B (bottom).
// px/py are set to the canvas position of the pin's centre dot.
function calcPinPos(b) {
  const leftPins   = b.pins.filter(p => p.pin_side === 'L');
  const rightPins  = b.pins.filter(p => p.pin_side === 'R');
  const topPins    = b.pins.filter(p => p.pin_side === 'T');
  const bottomPins = b.pins.filter(p => p.pin_side === 'B');

  const sideRows = Math.max(leftPins.length, rightPins.length, 1);
  const rowH = (b.height - 20) / sideRows;

  leftPins.forEach((p, i) => {
    p.px = b.x;
    p.py = b.y + 20 + rowH * i + rowH / 2;
  });
  rightPins.forEach((p, i) => {
    p.px = b.x + b.width;
    p.py = b.y + 20 + rowH * i + rowH / 2;
  });

  // Top pins spread evenly across the top edge
  const topCols = topPins.length || 1;
  topPins.forEach((p, i) => {
    p.px = b.x + b.width * (i + 1) / (topCols + 1);
    p.py = b.y;
  });

  // Bottom pins spread evenly across the bottom edge
  const botCols = bottomPins.length || 1;
  bottomPins.forEach((p, i) => {
    p.px = b.x + b.width * (i + 1) / (botCols + 1);
    p.py = b.y + b.height;
  });
}

function updateBlockPins(b) { calcPinPos(b); }

function updateNets(block) {
  for (const n of design.nets) {
    if (n.id1 === block.id) {
      const p = block.pins.find(p => p.pin_name === n.pinName1);
      if (p) { n.x1 = p.px; n.y1 = p.py; }
    }
    if (n.id2 === block.id) {
      const p = block.pins.find(p => p.pin_name === n.pinName2);
      if (p) { n.x2 = p.px; n.y2 = p.py; }
    }
  }
}

// ---- Main draw ----
function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // background
  ctx.fillStyle = '#13171d';
  ctx.fillRect(0, 0, W, H);

  // grid
  if (showGrid) drawGrid(W, H);

  ctx.save();
  // Apply zoom then scroll so world units stay in design-space pixels
  ctx.scale(zoom, zoom);
  ctx.translate(-scrollX, -scrollY);

  // canvas boundary
  ctx.strokeStyle = '#2a3040';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, prefs.canvasW, prefs.canvasH);

  // nets
  for (const n of design.nets) drawNet(n);

  // live net drag
  if (netDrag) {
    ctx.strokeStyle = NET_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(netDrag.x1, netDrag.y1);
    const mid = (netDrag.x2 - netDrag.x1) / 2;
    ctx.bezierCurveTo(netDrag.x1 + mid, netDrag.y1, netDrag.x2 - mid, netDrag.y2, netDrag.x2, netDrag.y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // text blocks
  for (const t of design.texts) drawTextBlock(t);

  // blocks
  for (const b of design.blocks) drawBlock(b);

  // rubber-band selection
  if (groupSel) {
    const {x1,y1,x2,y2} = groupSel;
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4,3]);
    ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(224,144,64,0.07)';
    ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
  }

  ctx.restore();
}

function drawGrid(W, H) {
  const g = prefs.gridSize * zoom;
  if (g < 4) return;  // grid too dense to be useful at very low zoom
  ctx.strokeStyle = '#1a1f28';
  ctx.lineWidth = 0.5;
  const ox = (scrollX * zoom) % g;
  const oy = (scrollY * zoom) % g;
  ctx.beginPath();
  for (let x = -ox; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -oy; y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

function drawBlock(b) {
  const { r, g: cg, b: cb, tr, tg, tb } = libColor(b.lib);
  const sel = b.selected;
  const fs = prefs.fontSize;

  // shadow when selected
  if (sel) {
    ctx.shadowColor = SELECT_COLOR;
    ctx.shadowBlur = 8;
  }

  // body
  ctx.fillStyle = `rgb(${r},${cg},${cb})`;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.width, b.height, 3);
  ctx.fill();

  // border
  ctx.strokeStyle = sel ? SELECT_COLOR : 'rgba(0,0,0,0.4)';
  ctx.lineWidth = sel ? 2 : 1;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // header stripe
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.width, 16, [3, 3, 0, 0]);
  ctx.fill();

  // label
  ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
  ctx.font = `bold ${fs}px JetBrains Mono, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.sub, b.x + b.width/2, b.y + 8);

  // ID
  if (showIds) {
    ctx.font = `9px JetBrains Mono, monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(`#${b.id}`, b.x + b.width - 3, b.y + 8);
  }

  // pins
  ctx.font = `${fs-2}px JetBrains Mono, monospace`;
  for (const p of b.pins) {
    if (!p.pin_side) continue;  // skip unresolved pins (unknown library)
    // pin dot
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(p.px, p.py, PIN_R, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // pin label — placed inside the block body, away from the dot
    ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
    ctx.textBaseline = 'middle';
    if (p.pin_side === 'L') {
      ctx.textAlign = 'left';
      ctx.fillText(p.pin_name, b.x + PIN_R + 3, p.py);
    } else if (p.pin_side === 'R') {
      ctx.textAlign = 'right';
      ctx.fillText(p.pin_name, b.x + b.width - PIN_R - 3, p.py);
    } else if (p.pin_side === 'T') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(p.pin_name, p.px, b.y + PIN_R + 2);
    } else if (p.pin_side === 'B') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.pin_name, p.px, b.y + b.height - PIN_R - 2);
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawNet(n) {
  const sel = n.selected;
  ctx.strokeStyle = sel ? SELECT_COLOR : n.color;
  ctx.lineWidth = sel ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(n.x1, n.y1);
  const midX = (n.x1 + n.x2) / 2;
  ctx.bezierCurveTo(midX, n.y1, midX, n.y2, n.x2, n.y2);
  ctx.stroke();

  // endpoints
  ctx.fillStyle = sel ? SELECT_COLOR : n.color;
  for (const [x,y] of [[n.x1,n.y1],[n.x2,n.y2]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawTextBlock(t) {
  const fs = prefs.fontSize;
  const sel = t.selected;
  ctx.strokeStyle = sel ? SELECT_COLOR : '#3a4458';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(t.x, t.y, t.width, t.height);
  ctx.setLineDash([]);
  ctx.font = `${fs}px JetBrains Mono, monospace`;
  ctx.fillStyle = '#d4dce8';
  ctx.textBaseline = 'top';
  const lines = t.text_str.split('\n');
  lines.forEach((l, i) => ctx.fillText(l, t.x + 5, t.y + 4 + i * (fs + 4)));
  ctx.textBaseline = 'alphabetic';
}

// ============================================================
//  Hit testing
// ============================================================
function hitBlock(wx, wy) {
  // reverse order so topmost (last drawn) is found first
  for (let i = design.blocks.length - 1; i >= 0; i--) {
    const b = design.blocks[i];
    if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height) return b;
  }
  return null;
}

function hitPin(wx, wy) {
  for (const b of design.blocks) {
    for (const p of b.pins) {
      const dx = wx - p.px, dy = wy - p.py;
      if (Math.sqrt(dx*dx + dy*dy) <= PIN_R + 3) return { block: b, pin: p };
    }
  }
  return null;
}

function hitText(wx, wy) {
  for (let i = design.texts.length - 1; i >= 0; i--) {
    const t = design.texts[i];
    if (wx >= t.x && wx <= t.x + t.width && wy >= t.y && wy <= t.y + t.height) return t;
  }
  return null;
}

// ============================================================
//  Mouse events
// ============================================================
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('dblclick', onDblClick);

function canvasCSS() {
  // Returns the canvas size in CSS pixels (not physical pixels).
  // Use this instead of canvas.width/canvas.height for coordinate math.
  return {
    w: parseFloat(canvas.style.width)  || canvas.width,
    h: parseFloat(canvas.style.height) || canvas.height,
  };
}

function mouseWorld(e) {
  const r = canvas.getBoundingClientRect();
  // e.clientX/Y are already in CSS pixels; r.left/top are too.
  return canvasToWorld(e.clientX - r.left, e.clientY - r.top);
}



function onMouseDown(e) {
  if (e.button === 1) { // middle button pan
    panning = true;
    // Store world-space pan anchor so zoom changes mid-pan don't affect it
    panStartX = e.clientX / zoom + scrollX;
    panStartY = e.clientY / zoom + scrollY;
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  const {x, y} = mouseWorld(e);

  // check pin first (start net drag)
  const pinHit = hitPin(x, y);
  if (pinHit) {
    pushState('start-net');
    netDrag = { startBlock: pinHit.block, startPin: pinHit.pin, x1: pinHit.pin.px, y1: pinHit.pin.py, x2: x, y2: y };
    return;
  }

  const blk = hitBlock(x, y);
  if (blk) {
    if (e.shiftKey) {
      blk.selected = !blk.selected;
    } else if (!blk.selected) {
      clearSelection();
      blk.selected = true;
    }
    // check if any selected → group drag
    const sel = design.blocks.filter(b => b.selected);
    if (sel.length > 0) {
      pushState('drag');
      dragGroup = true;
      oldMouseX = x; oldMouseY = y;
    }
    draw();
    return;
  }

  const txt = hitText(x, y);
  if (txt) {
    if (!e.shiftKey) clearSelection();
    txt.selected = true;
    oldMouseX = x; oldMouseY = y;
    textDrag = txt;
    pushState('drag-text');
    draw();
    return;
  }

  // rubber-band
  if (!e.shiftKey) clearSelection();
  groupSel = { x1: x, y1: y, x2: x, y2: y };
  draw();
}

function onMouseMove(e) {
  if (panning) {
    scrollX = panStartX - e.clientX / zoom;
    scrollY = panStartY - e.clientY / zoom;
    clampScroll();
    draw();
    return;
  }

  const {x, y} = mouseWorld(e);

  // update status XY
  document.getElementById('status-xy').textContent = `X: ${Math.round(x)}  Y: ${Math.round(y)}`;

  // net drag
  if (netDrag) {
    netDrag.x2 = x; netDrag.y2 = y;
    // pin tooltip
    const ph = hitPin(x, y);
    if (ph && ph.pin !== netDrag.startPin) {
      showPinTip(e.clientX, e.clientY, ph.pin);
    } else { hidePinTip(); }
    setStatus('ROUTING');
    draw();
    return;
  }

  // group drag
  if (dragGroup) {
    const dx = x - oldMouseX, dy = y - oldMouseY;
    for (const b of design.blocks.filter(b => b.selected)) {
      b.x = Math.round(b.x + dx); b.y = Math.round(b.y + dy);
      updateBlockPins(b); updateNets(b);
    }
    for (const t of design.texts.filter(t => t.selected)) {
      t.x = Math.round(t.x + dx); t.y = Math.round(t.y + dy);
    }
    oldMouseX = x; oldMouseY = y;
    setStatus('MOVING');
    setChanged();
    draw();
    return;
  }

  if (textDrag) {
    textDrag.x = Math.round(textDrag.x + (x - oldMouseX));
    textDrag.y = Math.round(textDrag.y + (y - oldMouseY));
    oldMouseX = x; oldMouseY = y;
    setChanged();
    draw();
    return;
  }

  // rubber-band update
  if (groupSel) {
    groupSel.x2 = x; groupSel.y2 = y;
    draw();
    return;
  }

  // hover: show pin tooltip
  const ph = hitPin(x, y);
  if (ph) {
    showPinTip(e.clientX, e.clientY, ph.pin);
    document.getElementById('status-pin').textContent = ph.pin.pin_name;
    document.getElementById('status-info').textContent = ph.pin.pin_desc;
    canvas.style.cursor = 'crosshair';
  } else {
    hidePinTip();
    document.getElementById('status-pin').textContent = '';
    document.getElementById('status-info').textContent = '';
    canvas.style.cursor = hitBlock(x,y) || hitText(x,y) ? 'move' : 'default';
  }
}

function onMouseUp(e) {
  if (e.button === 1) { panning = false; canvas.style.cursor = 'default'; return; }
  if (e.button !== 0) return;

  const {x, y} = mouseWorld(e);

  // complete net
  if (netDrag) {
    const ph = hitPin(x, y);
    if (ph && ph.block !== netDrag.startBlock) {
      // type compatibility check
      const t1 = netDrag.startPin.pin_type, t2 = ph.pin.pin_type;
      if (t1 === t2 || t1 === 'ANY' || t2 === 'ANY') {
        const p1 = { ...netDrag.startPin, px: netDrag.x1, py: netDrag.y1 };
        const p2 = { ...ph.pin, px: ph.pin.px, py: ph.pin.py };
        const n = makeNet(netDrag.startBlock.id, p1, ph.block.id, p2);
        design.nets.push(n);
        setChanged();
        setStatus('READY');
      } else {
        setStatus(`READY  — pin type mismatch: ${t1} ≠ ${t2}`);
      }
    }
    netDrag = null;
    draw();
    return;
  }

  dragGroup = false;
  textDrag = null;

  // rubber-band selection complete
  if (groupSel) {
    const { x1,y1,x2,y2 } = groupSel;
    const minX = Math.min(x1,x2), maxX = Math.max(x1,x2);
    const minY = Math.min(y1,y2), maxY = Math.max(y1,y2);
    for (const b of design.blocks) {
      if (b.x >= minX && b.x + b.width <= maxX && b.y >= minY && b.y + b.height <= maxY) b.selected = true;
    }
    for (const t of design.texts) {
      if (t.x >= minX && t.x + t.width <= maxX && t.y >= minY && t.y + t.height <= maxY) t.selected = true;
    }
    groupSel = null;
    draw();
  }

  setStatus('READY');
}

function onContextMenu(e) {
  e.preventDefault();
  const {x, y} = mouseWorld(e);

  const ph = hitPin(x, y);
  if (ph) {
    // show nets at this pin
    ctxNets = design.nets.filter(n =>
      (n.id1 === ph.block.id && n.pinName1 === ph.pin.pin_name) ||
      (n.id2 === ph.block.id && n.pinName2 === ph.pin.pin_name)
    );
    openNetProps(ph.block, ph.pin);
    return;
  }

  const blk = hitBlock(x, y);
  if (blk) {
    ctxBlock = blk;
    openBlockProps(blk);
    return;
  }

  const txt = hitText(x, y);
  if (txt) {
    editingText = txt;
    document.getElementById('at-title').textContent = 'Edit Text Label';
    document.getElementById('at-text').value = txt.text_str;
    openModal('modal-addtext');
  }
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Zoom to cursor position
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    // World position under cursor before zoom change
    const wx = cx / zoom + scrollX;
    const wy = cy / zoom + scrollY;
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
    // Adjust scroll so the world point under the cursor stays fixed
    scrollX = wx - cx / zoom;
    scrollY = wy - cy / zoom;
    clampScroll();
    updateZoomDisplay();
  } else {
    // Pan
    scrollX = Math.max(0, scrollX + e.deltaX / zoom);
    scrollY = Math.max(0, scrollY + e.deltaY / zoom);
    clampScroll();
  }
  draw();
}

function updateZoomDisplay() {
  document.getElementById('status-mode').textContent =
    Math.round(zoom * 100) + '%';
}

function zoomTo(level, cx, cy) {
  // cx/cy in CSS canvas pixels (centre of canvas if omitted)
  const { w, h } = canvasCSS();
  cx = cx ?? w / 2;
  cy = cy ?? h / 2;
  const wx = cx / zoom + scrollX;
  const wy = cy / zoom + scrollY;
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
  scrollX = wx - cx / zoom;
  scrollY = wy - cy / zoom;
  clampScroll();
  updateZoomDisplay();
  draw();
}

// Fit the entire design into the viewport
function fitDesign() {
  if (!design.blocks.length && !design.texts.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of design.blocks) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  }
  for (const t of design.texts) {
    minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.width); maxY = Math.max(maxY, t.y + t.height);
  }
  const pad = 40;
  const { w, h } = canvasCSS();
  const zx = w  / (maxX - minX + pad * 2);
  const zy = h / (maxY - minY + pad * 2);
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(zx, zy)));
  scrollX = minX - pad;
  scrollY = minY - pad;
  clampScroll();
  updateZoomDisplay();
  draw();
}

function onDblClick(e) {
  const {x, y} = mouseWorld(e);
  const txt = hitText(x, y);
  if (txt) {
    editingText = txt;
    document.getElementById('at-title').textContent = 'Edit Text Label';
    document.getElementById('at-text').value = txt.text_str;
    openModal('modal-addtext');
  }
}

// ============================================================
//  Keyboard shortcuts
// ============================================================
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'z') { e.preventDefault(); cmd('undo'); }
  if (ctrl && e.key === 'a') { e.preventDefault(); cmd('selectall'); }
  if (ctrl && e.key === 's') { e.preventDefault(); cmd('save'); }
  if (ctrl && e.key === 'n') { e.preventDefault(); cmd('new'); }
  if (e.key === 'Delete' || e.key === 'Backspace') { cmd('deletesel'); }
  const d = 20;
  if (e.key === 'ArrowLeft')  moveSelection(-d, 0);
  if (e.key === 'ArrowRight') moveSelection(d, 0);
  if (e.key === 'ArrowUp')    moveSelection(0, -d);
  if (e.key === 'ArrowDown')  moveSelection(0, d);
});

function moveSelection(dx, dy) {
  const sel = design.blocks.filter(b => b.selected);
  if (!sel.length) return;
  pushState('arrow-move');
  for (const b of sel) { b.x += dx; b.y += dy; updateBlockPins(b); updateNets(b); }
  for (const t of design.texts.filter(t => t.selected)) { t.x += dx; t.y += dy; }
  setChanged();
  draw();
}

// ============================================================
//  Sidebar & library UI
// ============================================================
let sidebarData = {};  // { libName: [libblock, ...] }

function buildSidebar() {
  const container = document.getElementById('lib-container');
  container.innerHTML = '';

  const builtins = buildBuiltins();
  const libDefs = {
    SFR:   { blocks: builtins.sfrs,   ...libColor('SFR')   },
    MREG:  { blocks: builtins.mregs,  ...libColor('MREG')  },
    CONST: { blocks: builtins.consts, ...libColor('CONST') },
    XTRA:  { blocks: builtins.xtra,   ...libColor('XTRA')  },
  };
  if (prefs.expertMode) {
    libDefs.CREG = { blocks: builtins.cregs, ...libColor('CREG') };
  }

  // merge loaded user libraries
  for (const lb of libBlocks) {
    if (!libDefs[lb.lib]) {
      libDefs[lb.lib] = { blocks: [], ...libColor(lb.lib) };
    }
    if (!libDefs[lb.lib].blocks.find(x => x.sub === lb.sub)) {
      libDefs[lb.lib].blocks.push(lb);
    }
  }

  sidebarData = {};
  for (const [libName, def] of Object.entries(libDefs)) {
    sidebarData[libName] = def.blocks;
  }

  renderSidebarGroups(sidebarData);
}

function renderSidebarGroups(data, filter) {
  const container = document.getElementById('lib-container');
  container.innerHTML = '';
  for (const [libName, blocks] of Object.entries(data)) {
    const filtered = filter
      ? blocks.filter(b => b.sub.toLowerCase().includes(filter) || (b.desc||'').toLowerCase().includes(filter))
      : blocks;
    if (!filtered.length) continue;
    const col = libColor(libName);
    const rgb = `rgb(${col.r},${col.g},${col.b})`;
    const grp = document.createElement('div');
    grp.className = 'lib-group';

    const hdr = document.createElement('div');
    hdr.className = 'lib-group-header';
    hdr.innerHTML = `<span class="dot" style="background:${rgb}"></span><span>${libName}</span><span style="font-size:10px;color:var(--text-dim)">${filtered.length}</span>`;

    // Start collapsed. When a search filter is active, expand so results are visible.
    let open = !!filter;
    const list = document.createElement('div');
    list.style.display = open ? '' : 'none';

    hdr.onclick = () => {
      open = !open;
      list.style.display = open ? '' : 'none';
    };

    filtered.forEach(b => {
      const item = document.createElement('div');
      item.className = 'block-item';
      item.textContent = b.sub;
      item.title = b.desc || b.sub;
      item.ondblclick = () => addBlockAtCenter(libName, b);
      item.onclick = () => addBlockAtCenter(libName, b);
      list.appendChild(item);
    });

    grp.appendChild(hdr);
    grp.appendChild(list);
    container.appendChild(grp);
  }
}

function filterBlocks(q) {
  const f = q.toLowerCase().trim();
  renderSidebarGroups(sidebarData, f || null);
}

function addBlockAtCenter(lib, libDef) {
  const { w, h } = canvasCSS();
  const wx = Math.round(scrollX + w / 2 - 40);
  const wy = Math.round(scrollY + h / 2 - 20);
  pushState('add-block');
  const b = makeBlock(lib, libDef.sub, wx, wy, libDef);
  design.blocks.push(b);
  clearSelection();
  b.selected = true;
  setChanged();
  draw();
}

// ============================================================
//  Undo
// ============================================================
function pushState(label) {
  // Simple full-state snapshot undo
  undoStack.push({ label, snapshot: JSON.stringify(design) });
  if (undoStack.length > 50) undoStack.shift();
  document.getElementById('btn-undo').disabled = false;
}

function undo() {
  if (!undoStack.length) return;
  const { snapshot } = undoStack.pop();
  design = JSON.parse(snapshot);
  // recalc pin positions (not stored redundantly)
  for (const b of design.blocks) { measureBlock(b); calcPinPos(b); }
  for (const t of design.texts) measureText(t);
  for (const n of design.nets) {
    const b1 = design.blocks.find(b => b.id === n.id1);
    const b2 = design.blocks.find(b => b.id === n.id2);
    if (b1) { const p = b1.pins.find(p => p.pin_name === n.pinName1); if (p) { n.x1=p.px; n.y1=p.py; } }
    if (b2) { const p = b2.pins.find(p => p.pin_name === n.pinName2); if (p) { n.x2=p.px; n.y2=p.py; } }
  }
  document.getElementById('btn-undo').disabled = undoStack.length === 0;
  draw();
}

// ============================================================
//  Commands
// ============================================================
function cmd(action) {
  switch (action) {
    case 'new':    newDesign(); break;
    case 'open':   document.getElementById('fi-design').click(); break;
    case 'save':   saveDesign(); break;
    case 'saveas': saveDesignAs(); break;
    case 'undo':   undo(); break;
    case 'loadlib':    document.getElementById('fi-lib').click(); break;
    case 'loadlibdir': document.getElementById('fi-libdir').click(); break;
    case 'addtext':
      editingText = null;
      document.getElementById('at-title').textContent = 'Add Text Label';
      document.getElementById('at-text').value = '';
      openModal('modal-addtext');
      break;
    case 'selectall':
      design.blocks.forEach(b => b.selected = true);
      design.texts.forEach(t => t.selected = true);
      draw(); break;
    case 'deletesel': deleteSelected(); break;
    case 'generate': generate(); break;
    case 'prefs':   openPrefs(); break;
    case 'about':   openModal('modal-about'); break;
  }
}

function clearSelection() {
  design.blocks.forEach(b => b.selected = false);
  design.texts.forEach(t => t.selected = false);
  design.nets.forEach(n => n.selected = false);
}

function deleteSelected() {
  const selIds = new Set(design.blocks.filter(b => b.selected).map(b => b.id));
  if (!selIds.size && !design.texts.some(t => t.selected)) return;
  pushState('delete');
  design.blocks = design.blocks.filter(b => !b.selected);
  design.nets = design.nets.filter(n => !selIds.has(n.id1) && !selIds.has(n.id2));
  design.texts = design.texts.filter(t => !t.selected);
  setChanged();
  draw();
}

// ============================================================
//  File I/O  (browser: download link / File API)
// ============================================================
function newDesign() {
  if (changed && !confirm('You have unsaved changes. Start a new design?')) return;
  design = makeEmptyDesign();
  undoStack = [];
  changed = false;
  designFile = 'untitled.gcf';
  updateTitle();
  draw();
}

// Holds a parsed design that is waiting for missing libraries to be loaded.
// Cleared once all libraries are satisfied or the user discards it.
let pendingDesign = null;
let pendingFile   = null;

function loadDesignFile(input) {
  const f = input.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const d = parseDesignXml(e.target.result);
      input.value = '';
      tryApplyDesign(d, f.name);
    } catch(ex) {
      input.value = '';
      alert('Could not load "' + f.name + '".\n\n' +
            'Make sure it is a GooeyCore design file (.gcf).\n\nDetail: ' + ex.message);
    }
  };
  reader.onerror = () => { input.value = ''; alert('Could not read: ' + f.name); };
  reader.readAsText(f);
}

// Try to apply a parsed design object. If any required libraries are missing,
// store it as pending and tell the user what to load. Otherwise apply immediately.
function tryApplyDesign(d, filename) {
  const missing = getMissingLibs(d.blocks);
  if (missing.size > 0) {
    pendingDesign = d;
    pendingFile   = filename;
    alert(
      'Cannot display design — the following libraries are not loaded:\n\n' +
      [...missing].join('\n') +
      '\n\nLoad the required .fxl files using "+ Library" or "Load Library Folder",\n' +
      'then the design will be applied automatically.'
    );
    return;
  }
  applyDesign(d, filename);
}

// Apply a fully-satisfied design (all libraries present).
function applyDesign(d, filename) {
  design     = d;
  designFile = filename;
  pendingDesign = null;
  pendingFile   = null;
  resolveAndLayout();
  undoStack = [];
  changed   = false;
  updateTitle();
  fitDesign();
  draw();
}

// Return the set of lib names used by blocks that have no loaded definition.
function getMissingLibs(blocks) {
  const knownLibs = new Set([
    'SFR', 'MREG', 'CREG', 'CONST', 'XTRA',
    ...libBlocks.map(b => b.lib),
  ]);
  const missing = new Set();
  for (const b of blocks) {
    if (!knownLibs.has(b.lib)) missing.add(b.lib);
  }
  return missing;
}

// Resolve pin metadata from libraries then recalculate all block/net geometry.
// Called after loading a design OR after loading new libraries.
function resolveAndLayout() {
  resolveBlockPinsFromLibs(design.blocks);
  for (const b of design.blocks) { measureBlock(b); calcPinPos(b); }
  for (const t of design.texts)  measureText(t);
  for (const n of design.nets)   recalcNetEndpoints(n);
}

// ---- XML parser for .gcf design files ----
function parseDesignXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('XML parse error: ' + parseErr.textContent.slice(0, 200));

  // Helper: get trimmed text of first matching child element, or fallback
  function txt(parent, tag, fallback = '') {
    const el = parent.querySelector(tag);
    return el ? el.textContent.trim() : fallback;
  }
  function num(parent, tag, fallback = 0) {
    return parseInt(txt(parent, tag, String(fallback))) || fallback;
  }

  const blocks = [];
  let maxDevId = 0;
  for (const fb of doc.querySelectorAll('blocks > fxblock')) {
    const id = num(fb, 'id', 0);
    if (id > maxDevId) maxDevId = id;
    const pins = [];
    for (const p of fb.querySelectorAll('pins > pin')) {
      pins.push({
        pin_name: txt(p, 'name'),      // design file uses <name> not <n>
        pin_num:  num(p, 'number', 0),
        pin_type: '',
        pin_side: '',
        pin_desc: '',
        px: 0, py: 0,
      });
    }
    const params = [];
    for (const p of fb.querySelectorAll('params > param')) {
      params.push({
        param_name:  txt(p, 'name'),   // design file uses <name> not <n>
        param_num:   num(p, 'number', 0),
        param_value: txt(p, 'value'),
        param_type:  '',
        param_desc:  '',
      });
    }
    blocks.push({
      id, lib: txt(fb, 'lib'), sub: txt(fb, 'sub'),
      selected: false,
      x: num(fb, 'x', 0), y: num(fb, 'y', 0),
      width: 0, height: 0,
      pins, params,
    });
  }

  const nets = [];
  let maxNetId = 0;
  for (const n of doc.querySelectorAll('nets > net')) {
    const netId = num(n, 'net_id', 0);
    if (netId > maxNetId) maxNetId = netId;
    nets.push({
      netId,
      color: NET_COLOR, selected: false,
      id1:      num(n, 'id_1', 0),
      pinName1: txt(n, 'pin_1_name'),
      pinNum1:  num(n, 'pin_1_num', 0),
      x1: 0, y1: 0,
      id2:      num(n, 'id_2', 0),
      pinName2: txt(n, 'pin_2_name'),
      pinNum2:  num(n, 'pin_2_num', 0),
      x2: 0, y2: 0,
    });
  }

  const texts = [];
  let maxTextId = 0;
  for (const t of doc.querySelectorAll('text > text_item')) {
    const id = num(t, 'text_id', 0);
    if (id > maxTextId) maxTextId = id;
    texts.push({
      id,
      selected: false,
      text_str: txt(t, 'text_str'),
      x: num(t, 'x', 0), y: num(t, 'y', 0),
      width: 0, height: 0,
    });
  }

  return {
    blocks, nets, texts,
    devId:  maxDevId  + 1,
    netId:  maxNetId  + 1,
    textId: maxTextId + 1,
  };
}

// Fill in pin_side, pin_type, pin_desc for each loaded block by matching
// against the built-in and user-loaded library definitions.
// Must be called after pins are parsed but before calcPinPos.
function resolveBlockPinsFromLibs(blocks) {
  const lookup = new Map();
  const builtins = buildBuiltins();
  const allBuiltins = [
    ...builtins.sfrs, ...builtins.mregs, ...builtins.cregs,
    ...builtins.consts, ...builtins.xtra,
  ];
  for (const lb of allBuiltins) lookup.set(lb.lib + '::' + lb.sub, lb);
  for (const lb of libBlocks)   lookup.set(lb.lib + '::' + lb.sub, lb);

  let resolved = 0, unresolved = 0;
  for (const b of blocks) {
    const key = b.lib + '::' + b.sub;
    const def = lookup.get(key);
    if (!def) {
      unresolved++;
      console.log('  no def for', key);
      continue;
    }
    resolved++;
    for (const bp of b.pins) {
      const defPin = def.pins.find(p => p.pin_name === bp.pin_name);
      if (defPin) {
        bp.pin_side = defPin.pin_side;
        bp.pin_type = defPin.pin_type;
        bp.pin_desc = defPin.pin_desc;
      } else {
        console.log('  unresolved pin', bp.pin_name, 'in', key,
          '| def has:', def.pins.map(p => p.pin_name));
      }
    }
    for (const bpar of b.params) {
      const defPar = def.params.find(p => p.param_name === bpar.param_name);
      if (defPar) {
        bpar.param_type = defPar.param_type;
        bpar.param_desc = defPar.param_desc;
      }
    }
  }
  console.log('resolveBlockPinsFromLibs: resolved', resolved,
              'unresolved', unresolved, 'lookup size', lookup.size);
  if (blocks.length > 0) {
    const b = blocks[0];
    console.log('  first block:', b.lib, b.sub,
      'pins:', b.pins.map(p => p.pin_name + '/' + p.pin_side));
  }
}

function recalcNetEndpoints(n) {
  const b1 = design.blocks.find(b => b.id === n.id1);
  const b2 = design.blocks.find(b => b.id === n.id2);
  if (b1) { const p = b1.pins.find(p => p.pin_name === n.pinName1); if (p) { n.x1=p.px; n.y1=p.py; } }
  if (b2) { const p = b2.pins.find(p => p.pin_name === n.pinName2); if (p) { n.x2=p.px; n.y2=p.py; } }
}

function saveDesign() {
  if (!designFile || designFile === 'untitled.gcf') { saveDesignAs(); return; }
  doDownload(designFile);
}

function saveDesignAs() {
  const name = prompt('Save as:', designFile || 'untitled.gcf');
  if (!name) return;
  designFile = name.endsWith('.gcf') ? name : name + '.gcf';
  doDownload(designFile);
}

function doDownload(filename) {
  const xml = designToXml(design);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.getElementById('dl-anchor');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  changed = false;
  updateTitle();
}

// ---- XML serialiser for .gcf design files ----
function designToXml(d) {
  const lines = ['<GooeyCoreDesign>'];

  lines.push('    <blocks>');
  for (const b of d.blocks) {
    lines.push('        <fxblock>');
    lines.push(`            <id>${b.id}</id>`);
    lines.push(`            <lib>${esc(b.lib)}</lib>`);
    lines.push(`            <sub>${esc(b.sub)}</sub>`);
    lines.push(`            <x>${b.x}</x>`);
    lines.push(`            <y>${b.y}</y>`);
    lines.push('            <pins>');
    for (const p of b.pins) {
      lines.push('                <pin>');
      lines.push(`                    <name>${esc(p.pin_name)}</name>`);
      lines.push(`                    <number>${p.pin_num}</number>`);
      lines.push('                </pin>');
    }
    lines.push('            </pins>');
    lines.push('            <params>');
    for (const p of b.params) {
      lines.push('                <param>');
      lines.push(`                    <name>${esc(p.param_name)}</name>`);
      lines.push(`                    <number>${p.param_num}</number>`);
      lines.push(`                    <value>${esc(p.param_value)}</value>`);
      lines.push('                </param>');
    }
    lines.push('            </params>');
    lines.push('        </fxblock>');
  }
  lines.push('    </blocks>');

  lines.push('    <nets>');
  for (const n of d.nets) {
    lines.push('        <net>');
    lines.push(`            <net_id>${n.netId}</net_id>`);
    lines.push(`            <id_1>${n.id1}</id_1>`);
    lines.push(`            <pin_1_name>${esc(n.pinName1)}</pin_1_name>`);
    lines.push(`            <pin_1_num>${n.pinNum1}</pin_1_num>`);
    lines.push(`            <id_2>${n.id2}</id_2>`);
    lines.push(`            <pin_2_name>${esc(n.pinName2)}</pin_2_name>`);
    lines.push(`            <pin_2_num>${n.pinNum2}</pin_2_num>`);
    lines.push('        </net>');
  }
  lines.push('    </nets>');

  lines.push('    <text>');
  for (const t of d.texts) {
    lines.push('        <text_item>');
    lines.push(`            <text_id>${t.id}</text_id>`);
    lines.push(`            <x>${t.x}</x>`);
    lines.push(`            <y>${t.y}</y>`);
    lines.push(`            <text_str>${esc(t.text_str)}</text_str>`);
    lines.push('        </text_item>');
  }
  lines.push('    </text>');

  lines.push('</GooeyCoreDesign>');
  return lines.join('\r\n');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Load .fxl files selected individually via the file picker.
function loadLibFiles(input) {
  const files = Array.from(input.files);
  if (!files.length) { input.value = ''; return; }
  readLibFileList(files, input);
}

// Load all .fxl files from a directory selected via the folder picker.
// We filter for .fxl BEFORE resetting the input, but pass the input
// to readLibFileList so it is reset only after all reads complete.
function loadLibDirFiles(input) {
  const files = Array.from(input.files).filter(f => /\.fxl$/i.test(f.name));
  if (!files.length) {
    input.value = '';
    alert('No .fxl library files found in the selected folder.');
    return;
  }
  // Do NOT reset input.value here — the File objects are still live and
  // resetting the input before FileReader finishes invalidates them.
  readLibFileList(files, input);
}

// Read an array of File objects as text and parse each as a .fxl library.
// inputEl is the file input element to reset when done (may be null).
function readLibFileList(files, inputEl) {
  let pending = files.length;
  let loaded  = 0;
  let errors  = 0;
  setStatus(`Loading ${pending} library file(s)…`);

  for (const f of files) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      if (!text || !text.trim()) {
        errors++;
      } else {
        parseFxlFile(text, f.name);
        loaded++;
      }
      pending--;
      if (pending === 0) {
        if (inputEl) inputEl.value = '';
        buildSidebar();
        if (errors > 0) {
          alert(`Warning: ${errors} file(s) could not be read or were empty.`);
        }
        if (pendingDesign) {
          const stillMissing = getMissingLibs(pendingDesign.blocks);
          if (stillMissing.size === 0) {
            applyDesign(pendingDesign, pendingFile);
          } else {
            setStatus('Still need: ' + [...stillMissing].join(', '));
          }
        } else if (design.blocks.length > 0) {
          resolveAndLayout();
          setStatus(`Loaded ${loaded} library file(s). READY`);
          draw();
        } else {
          setStatus(`Loaded ${loaded} library file(s). READY`);
          draw();
        }
      }
    };
    reader.onerror = () => {
      errors++;
      pending--;
      if (pending === 0) {
        if (inputEl) inputEl.value = '';
        buildSidebar();
        alert(`${errors} file(s) could not be read.`);
      }
    };
    reader.readAsText(f);
  }
}

// ---- .fxl XML parser ----
// The .fxl format uses <n> (not <name>) for all name fields.
// <param> elements serve double duty:
//   - presence of a <side> child → it is a pin connection
//   - no <side> child → it is a plain configurable parameter
function parseFxlFile(xmlText, filename) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    const detail = doc.querySelector('parsererror').textContent.slice(0, 200);
    console.error('parseFxlFile: XML error in', filename, ':', detail);
    alert('Could not parse library file: ' + filename + '\n\n' + detail);
    return;
  }

  // Get the text of the first direct child element with the given tag name.
  function childText(parent, tag, fallback) {
    if (fallback === undefined) fallback = '';
    for (const ch of parent.children) {
      if (ch.tagName === tag) return ch.textContent.trim();
    }
    return fallback;
  }

  // Library-level metadata — name is in <name> tag
  const libName = childText(doc.documentElement, 'name') || filename.replace(/\.fxl$/i, '');
  const libDesc  = childText(doc.documentElement, 'desc');
  console.log('parseFxlFile: parsing', filename, '→ lib =', libName);

  // ---- Bridge to FXCoreAssembler library set ----
  // Feed the raw XML text to the assembler's FXLibrarySet so the preprocessor
  // can expand @lib.sub() calls during the assemble step.  We do this once
  // per file regardless of whether the GooeyCore palette already has the lib.
  if (typeof FXCoreAssembler !== 'undefined' && typeof FXLibrarySet !== 'undefined') {
    try {
      const asmLibs = FXCoreAssembler.getLibraries();
      if (asmLibs && !asmLibs.get(libName)) {
        asmLibs.addFile(xmlText, filename);
      }
    } catch(e) {
      console.warn('parseFxlFile: could not add to FXCoreAssembler libraries:', e.message);
    }
  }

  function parseColor(str, defR, defG, defB) {
    if (!str) return { r: defR, g: defG, b: defB };
    const parts = str.split(',').map(s => parseInt(s.trim()) || 0);
    return {
      r: parts[0] !== undefined ? parts[0] : defR,
      g: parts[1] !== undefined ? parts[1] : defG,
      b: parts[2] !== undefined ? parts[2] : defB,
    };
  }
  const fillCol = parseColor(childText(doc.documentElement, 'lib_color'),     80, 130, 200);
  const textCol = parseColor(childText(doc.documentElement, 'lib_text_color'), 255, 255, 255);

  if (!LIB_COLORS[libName]) {
    LIB_COLORS[libName] = {
      r: fillCol.r, g: fillCol.g, b: fillCol.b,
      tr: textCol.r, tg: textCol.g, tb: textCol.b,
      desc: libDesc,
    };
  }

  // Each <sub> element is one block type
  for (const sub of doc.documentElement.children) {
    if (sub.tagName !== 'sub') continue;

    // Sub block name is in <name> tag
    const subName = childText(sub, 'name');
    const subDesc = childText(sub, 'desc');
    if (!subName) continue;

    const pins   = [];
    const params = [];
    let paramNum = 1;
    let pinNum   = 0;

    for (const p of sub.children) {
      if (p.tagName !== 'param') continue;

      // All name tags inside <param> are also <name>
      const pName = childText(p, 'name');
      const pType = childText(p, 'type');
      const pDesc = childText(p, 'desc');
      const pDef  = childText(p, 'default', '0');

      // <side> present and non-empty → this entry is a pin, not a plain param
      const sideVal = childText(p, 'side', '').toUpperCase();
      if (sideVal) {
        pins.push({
          pin_name: pName,
          pin_num:  pinNum++,
          pin_type: pType || 'MREG',
          pin_side: sideVal,
          pin_desc: pDesc,
          px: 0, py: 0,
        });
      } else {
        params.push({
          param_num:   paramNum++,
          param_name:  pName,
          param_type:  pType || 'DEC',
          param_desc:  pDesc,
          param_value: pDef,
        });
      }
    }

    // Skip duplicates (same lib+sub) in case the same file is loaded twice
    if (!libBlocks.find(b => b.lib === libName && b.sub === subName)) {
      libBlocks.push({ lib: libName, sub: subName, desc: subDesc, pins, params });
      console.log('  added block:', libName + '.' + subName,
                  'pins:', pins.length, 'params:', params.length);
    }
  }
  console.log('parseFxlFile: done. libBlocks total:', libBlocks.length);
}
// ============================================================
//  Code generation  (mirrors utilities.pb make_fxcfile)
// ============================================================
// ============================================================
//  Full build pipeline  (GooeyCore Studio)
//
//  Step 1: Generate .fxc text (same as standalone GooeyCore).
//          Download the .fxc file immediately.
//  Step 2: Run the preprocessor to expand @lib.sub() calls → .fxo text.
//          Download the .fxo file.
//  Step 3: Assemble the .fxo text → Intel HEX + listing.
//          Download the .hex and .lst files.
//  Step 4: Load the assembled image into the simulator.
//
//  On any step failure we stop, report clearly, and still keep whatever
//  files were successfully produced so far (they were already downloaded).
// ============================================================
function generate() {
  // ---- Validate design ----
  for (const b of design.blocks) {
    for (const p of b.params) {
      if (!p.param_value || p.param_value === '') {
        pipelineLog(`ERROR: Parameter not set on block ${b.id} (${b.sub}), parameter: ${p.param_name}`, 'errors');
        return;
      }
    }
    for (const p of b.pins) {
      if (!pinUsed(b.id, p.pin_name)) {
        pipelineLog(`ERROR: Unconnected pin on block ${b.id} (${b.sub}), pin: ${p.pin_name}`, 'errors');
        return;
      }
    }
  }

  // ---- Clear previous messages ----
  const msgArea = document.getElementById('build-messages');
  if (msgArea) msgArea.innerHTML = '';
  pipelineLog('Starting build pipeline…', 'info');

  // ---- Base filename (without extension) ----
  const baseName = (designFile || 'design').replace(/\.gcf$/i, '');

  // ================================================================
  // Step 1 — Generate .fxc
  // ================================================================
  const nodes = buildNodes();
  const fxcLines = [];
  const now = new Date();
  fxcLines.push(`; Generated by GooeyCore Studio ${VERSION}`);
  fxcLines.push(`; ${now.toDateString()} ${now.toTimeString().slice(0,8)}`);
  fxcLines.push('');

  const sorted = [...design.blocks].sort((a,b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const mregListed = new Set(), sregListed = new Set();

  for (const b of sorted) {
    if (b.lib === 'MREG') {
      const preset = b.params.find(p => p.param_name === 'Preset');
      if (preset && !mregListed.has(b.sub)) {
        fxcLines.push(`.MREG ${b.sub} ${preset.param_value}`);
        mregListed.add(b.sub);
      }
    }
  }
  if (prefs.expertMode) {
    for (const b of sorted) {
      if (b.lib === 'CREG') {
        const preset = b.params.find(p => p.param_name === 'Preset');
        if (preset) fxcLines.push(`.CREG ${b.sub} ${preset.param_value}`);
      }
    }
  }
  for (const b of sorted) {
    if (b.lib === 'SFR') {
      const preset = b.params.find(p => p.param_name === 'Preset');
      if (preset && !sregListed.has(b.sub)) {
        fxcLines.push(`.SREG ${b.sub} ${preset.param_value}`);
        sregListed.add(b.sub);
      }
    }
  }
  for (const b of sorted) {
    if (b.lib === 'XTRA' && b.sub === 'MEM_BLOCK') {
      const mn = b.params.find(p => p.param_name === 'MEM_NAME');
      const ms = b.params.find(p => p.param_name === 'MEM_SIZE');
      fxcLines.push(`.MEM ${mn?.param_value || 'mem'} ${ms?.param_value || '0'}`);
    }
  }
  fxcLines.push('');

  const skipLibs = new Set(['MREG','SFR','CREG','CONST']);
  for (const b of sorted) {
    if (skipLibs.has(b.lib)) continue;
    if (b.lib === 'XTRA' && b.sub === 'MEM_BLOCK') continue;

    const all = [
      ...b.params.map(p => ({ num: p.param_num, name: p.param_name, type: p.param_type, value: p.param_value, isPin: false })),
      ...b.pins.map(p =>   ({ num: p.pin_num,   name: p.pin_name,   type: p.pin_type,   value: '',            isPin: true  })),
    ].sort((a,b) => a.num - b.num);

    const args = [];
    for (const a of all) {
      if (a.isPin) {
        const node = nodes.find(n => n.nets.some(net =>
          (net.id1 === b.id && net.pinName1 === a.name) ||
          (net.id2 === b.id && net.pinName2 === a.name)
        ));
        args.push(node?.mr || `?${a.name}`);
      } else {
        if (!a.value) {
          pipelineLog(`ERROR: Missing parameter ${a.name} on block ${b.sub}`, 'errors');
          return;
        }
        args.push(a.value);
      }
    }
    fxcLines.push(`@${b.lib}.${b.sub}(${args.join(',')})`);
  }

  const fxcText = fxcLines.join('\n');
  pipelineSave(fxcText, baseName + '.fxc', 'text/plain');
  pipelineLog(`✓ Step 1: ${baseName}.fxc saved (${fxcLines.length} lines)`, 'success');

  // ================================================================
  // Step 2 — Preprocess .fxc → .fxo
  // ================================================================
  if (typeof Program === 'undefined' || typeof FXCoreAssembler === 'undefined') {
    pipelineLog('ERROR: Assembler not loaded — cannot proceed beyond .fxc generation.', 'errors');
    pipelineLog('Make sure all assembler JS files are included.', 'errors');
    return;
  }

  FXCoreAssembler.sourceCode = fxcText;
  Program.filename = baseName + '.fxc';

  const fxoText = Program.Preprocess(fxcText);
  if (fxoText === null) {
    pipelineLog('✗ Step 2: Preprocessor failed — see errors above.', 'errors');
    pipelineLog('The .fxc file was saved. Check your library calls and parameter counts.', 'info');
    return;
  }

  // If the preprocessor made no expansions, fxoText === fxcText.
  // We still save the .fxo so the user always gets it.
  const fxoSaved = baseName + '.fxo';
  pipelineSave(fxoText, fxoSaved, 'text/plain');
  if (FXCoreAssembler.expandedSource) {
    pipelineLog(`✓ Step 2: Library calls expanded → ${fxoSaved} saved.`, 'success');
  } else {
    pipelineLog(`✓ Step 2: No library calls found, ${fxoSaved} saved (same as .fxc).`, 'info');
  }

  // ================================================================
  // Step 3 — Assemble .fxo → HEX + listing
  // ================================================================
  // Redirect debugLog output to our build-messages panel during assembly.
  FXCoreAssembler.sourceCode = fxoText;
  FXCoreAssembler.assembledHex = null;
  FXCoreAssembler.lastAsm   = null;
  FXCoreAssembler.lastTable = null;

  const assembleOk = Program.Asm_it();

  if (!assembleOk || !FXCoreAssembler.assembledHex) {
    pipelineLog('✗ Step 3: Assembly failed — see errors above.', 'errors');
    pipelineLog('The .fxc and .fxo files were saved. Review the errors, fix the source, and try again.', 'info');
    return;
  }

  // Save .hex
  const hexName = baseName + '.hex';
  pipelineSave(FXCoreAssembler.assembledHex, hexName, 'text/plain');
  pipelineLog(`✓ Step 3a: ${hexName} saved.`, 'success');

  // Generate and save .lst from the assembled program
  const lstText = generateListing(FXCoreAssembler.lastAsm, baseName);
  const lstName = baseName + '.lst';
  pipelineSave(lstText, lstName, 'text/plain');
  pipelineLog(`✓ Step 3b: ${lstName} saved (${FXCoreAssembler.lastAsm.program.length} instructions).`, 'success');

  // ================================================================
  // Step 4 — Load into simulator
  // ================================================================
  if (typeof simLoadProgram === 'function' && typeof simCaptureImage === 'function') {
    // simCaptureImage calls FXCoreAssembler.buildSimImage() internally.
    if (simCaptureImage()) {
      simLoadProgram();
      pipelineLog('✓ Step 4: Program loaded into simulator — press Play in the TEST DRIVE panel.', 'success');
    } else {
      pipelineLog('✗ Step 4: Simulator image could not be built (assembled data may be empty).', 'errors');
    }
  } else {
    pipelineLog('Step 4: Simulator not available on this page.', 'info');
  }

  pipelineLog('Build complete.', 'success');

  // Enable hardware programming buttons now that we have a valid hex.
  if (typeof hwUpdateUI === 'function') hwUpdateUI();

  // Store the expanded source for control-name parsing and the source panel.
  if (typeof window !== 'undefined') window.simFxoSource = fxoText;

  // Reset register display state for the new program — done once per
  // build, not on every Play press, so the "seen" MREG set doesn't get
  // wiped out just by pausing and resuming the same program.
  if (typeof dbgResetRegState === 'function') dbgResetRegState();

  // Build the source panel from the new .fxo text.
  if (typeof dbgBuildSourcePanel === 'function') dbgBuildSourcePanel();
}

// ---- Pipeline helpers ----

/** Log a message to the build-messages panel and the browser console. */
function pipelineLog(msg, level) {
  const area = document.getElementById('build-messages');
  if (area) {
    const div = document.createElement('div');
    div.className = 'msg-' + (level || 'info');
    div.textContent = msg;
    area.appendChild(div);
    // Defer the scroll so we don't force a synchronous reflow on every message.
    requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
  }
  if (level === 'errors') console.error('[GooeyCore]', msg);
  else console.log('[GooeyCore]', msg);
}

/** Trigger a browser download for a text file. */
function pipelineSave(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate a plain-text listing from an assembled Assembler instance.
 * Mirrors what Assembler.printResults() writes to the debug log but
 * returns it as a string so we can save it as a .lst file.
 */
function generateListing(asm, baseName) {
  if (!asm || !asm.program) return '; No assembly data\n';
  const lines = [];
  lines.push(`; Listing: ${baseName}.fxo`);
  lines.push(`; Generated by GooeyCore Studio ${VERSION}`);
  lines.push('');
  lines.push('; Label table');
  for (const lbl of asm.labels) {
    lines.push(`; ${lbl.name.padEnd(24)} PC: ${String(lbl.pc).padStart(4, '0')}`);
  }
  lines.push('');
  lines.push('; Line   PC     Machine   Source');

  const asmtable = asm.asmtable;
  for (const inst of asm.program) {
    const lineStr = String(inst.linenum).padStart(5, ' ');
    const pcStr   = String(inst.pc).padStart(4, '0');
    const hexStr  = inst.machine.toString(16).toUpperCase().padStart(8, '0');
    const label   = asm.getLabel(inst.pc) || '';

    // Reconstruct a readable source form with resolved hex values
    const instInfo = asmtable ? asmtable.value(inst.mnemonic) : null;
    const params = [];
    if (instInfo) {
      for (let i = 0; i < 8; i++) {
        if (instInfo.theparams && instInfo.theparams[i] !== 'none' && inst.paramnames && inst.paramnames[i]) {
          const hexVal = '0x' + inst.paramint[i].toString(16).toUpperCase().padStart(4, '0');
          params.push(`${inst.paramnames[i]}(${hexVal})`);
        }
      }
    }
    const src = `${label}${inst.mnemonic}${params.length ? '   ' + params.join(' ') : ''}`;
    lines.push(`${lineStr} : ${pcStr} : ${hexStr} : ${src}`);
  }
  lines.push('');
  lines.push(`; Total instructions: ${asm.program.length}`);
  lines.push(`; Program clocks: ${asm.prgclks || 0}`);
  return lines.join('\n') + '\n';
}

function pinUsed(blockId, pinName) {
  return design.nets.some(n =>
    (n.id1 === blockId && n.pinName1 === pinName) ||
    (n.id2 === blockId && n.pinName2 === pinName)
  );
}

// ---- Node builder (mirrors nodes.pb MakeNodes) ----
function buildNodes() {
  const nodes = [];
  let nid = 0;
  const mregFree = [];
  for (let i = 0; i <= 127; i++) mregFree.push({ mr: `MR${i}`, free: true });

  for (const net of design.nets) {
    let found = false;
    for (const node of nodes) {
      if (node.nets.some(n => netOverlap(n, net))) {
        node.nets.push(net);
        found = true; break;
      }
    }
    if (!found) {
      const type = pinTypeFromNet(net);
      nodes.push({ id: nid++, type, mr: '', nets: [net] });
    }
  }

  // collapse pass
  let again = true;
  while (again) {
    again = false;
    outer: for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        if (nodes[i].nets.some(n1 => nodes[j].nets.some(n2 => netOverlap(n1,n2)))) {
          nodes[i].nets.push(...nodes[j].nets);
          nodes.splice(j, 1);
          again = true; break outer;
        }
      }
    }
  }

  // assign MREGs/SFRs etc.
  for (const b of design.blocks) {
    for (const node of nodes) {
      if (node.nets.some(n => n.id1 === b.id || n.id2 === b.id)) {
        if (['MREG','SFR','CREG','CONST'].includes(b.lib)) {
          node.mr = b.sub;
          if (b.lib === 'MREG') {
            const m = mregFree.find(m => m.mr === b.sub);
            if (m) m.free = false;
          }
        } else if (b.lib === 'XTRA' && b.sub === 'MEM_BLOCK') {
          const mn = b.params.find(p => p.param_name === 'MEM_NAME');
          if (mn) node.mr = mn.param_value;
        }
      }
    }
  }

  // auto-assign free MREGs to unresolved MREG-type nodes
  for (const node of nodes) {
    if (!node.mr && node.type === 'MREG') {
      const free = mregFree.find(m => m.free);
      if (free) { node.mr = free.mr; free.free = false; }
    }
  }

  return nodes;
}

function netOverlap(n1, n2) {
  return (n1.id1 === n2.id1 && n1.pinName1 === n2.pinName1) ||
         (n1.id1 === n2.id2 && n1.pinName1 === n2.pinName2) ||
         (n1.id2 === n2.id1 && n1.pinName2 === n2.pinName1) ||
         (n1.id2 === n2.id2 && n1.pinName2 === n2.pinName2);
}

function pinTypeFromNet(net) {
  const b = design.blocks.find(b => b.id === net.id1);
  if (b) { const p = b.pins.find(p => p.pin_name === net.pinName1); if (p) return p.pin_type; }
  return 'MREG';
}

// ============================================================
//  Block properties modal
// ============================================================
function openBlockProps(b) {
  document.getElementById('bp-title').textContent = `${b.lib}.${b.sub}  #${b.id}`;
  const table = document.getElementById('bp-params');
  table.innerHTML = '';
  for (const p of b.params) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.param_name}<br><small class="param-desc">${p.param_desc}</small></td>
      <td><input class="form-input" data-pname="${p.param_name}" value="${p.param_value}" style="font-size:12px"></td>`;
    table.appendChild(tr);
  }
  if (!b.params.length) {
    table.innerHTML = '<tr><td colspan="2" style="color:var(--text-dim);padding:8px 0">No configurable parameters.</td></tr>';
  }
  openModal('modal-blockprops');
}

function saveBlockProps() {
  if (!ctxBlock) return;
  pushState('edit-params');
  const inputs = document.querySelectorAll('#bp-params input[data-pname]');
  for (const inp of inputs) {
    const p = ctxBlock.params.find(p => p.param_name === inp.dataset.pname);
    if (p) p.param_value = inp.value;
  }
  setChanged();
  closeModal('modal-blockprops');
  draw();
}

function deleteCurrentBlock() {
  if (!ctxBlock) return;
  pushState('delete-block');
  const id = ctxBlock.id;
  design.blocks = design.blocks.filter(b => b.id !== id);
  design.nets = design.nets.filter(n => n.id1 !== id && n.id2 !== id);
  ctxBlock = null;
  closeModal('modal-blockprops');
  setChanged();
  draw();
}

// ============================================================
//  Net properties modal
// ============================================================
function openNetProps(block, pin) {
  const list = document.getElementById('net-list');
  list.innerHTML = '';
  if (!ctxNets.length) {
    list.textContent = 'No connections at this pin.';
  }
  for (const n of ctxNets) {
    const div = document.createElement('div');
    div.className = 'net-list-item';
    const b1 = design.blocks.find(b => b.id === n.id1);
    const b2 = design.blocks.find(b => b.id === n.id2);
    div.innerHTML = `<input type="checkbox" data-netid="${n.netId}">
      <span>${b1?.sub||'?'}:${n.pinName1} → ${b2?.sub||'?'}:${n.pinName2}</span>`;
    list.appendChild(div);
  }
  openModal('modal-netprops');
}

function deleteCheckedNets() {
  const checks = document.querySelectorAll('#net-list input[type=checkbox]:checked');
  if (!checks.length) { closeModal('modal-netprops'); return; }
  pushState('delete-nets');
  const ids = new Set([...checks].map(c => parseInt(c.dataset.netid)));
  design.nets = design.nets.filter(n => !ids.has(n.netId));
  closeModal('modal-netprops');
  setChanged();
  draw();
}

// ============================================================
//  Text modal
// ============================================================
function commitText() {
  const txt = document.getElementById('at-text').value.trim();
  if (!txt) { closeModal('modal-addtext'); return; }
  pushState('text');
  if (editingText) {
    editingText.text_str = txt;
    measureText(editingText);
  } else {
    const { w, h } = canvasCSS();
    const t = makeText(txt, Math.round(scrollX + w/2 - 40), Math.round(scrollY + h/2 - 20));
    design.texts.push(t);
  }
  closeModal('modal-addtext');
  setChanged();
  draw();
}

// ============================================================
//  Settings modal
// ============================================================
function openPrefs() {
  document.getElementById('pref-outpath').value  = prefs.outputPath;
  document.getElementById('pref-ver').value      = prefs.version;
  document.getElementById('pref-cw').value       = prefs.canvasW;
  document.getElementById('pref-ch').value       = prefs.canvasH;
  document.getElementById('pref-grid').value     = prefs.gridSize;
  document.getElementById('pref-expert').checked = prefs.expertMode;
  document.getElementById('pref-fontsize').value = prefs.fontSize;
  openModal('modal-prefs');
}

function savePrefs() {
  prefs.outputPath  = document.getElementById('pref-outpath').value;
  prefs.version     = document.getElementById('pref-ver').value || '1.0';
  prefs.canvasW     = parseInt(document.getElementById('pref-cw').value)  || CANVAS_W_DEFAULT;
  prefs.canvasH     = parseInt(document.getElementById('pref-ch').value)  || CANVAS_H_DEFAULT;
  prefs.gridSize    = parseInt(document.getElementById('pref-grid').value)|| GRID;
  prefs.expertMode  = document.getElementById('pref-expert').checked;
  prefs.fontSize    = parseInt(document.getElementById('pref-fontsize').value) || FONT_DEFAULT;

  // persist to localStorage
  try { localStorage.setItem('gooeycore-prefs', JSON.stringify(prefs)); } catch(e) {}

  closeModal('modal-prefs');
  buildSidebar();

  // re-measure all blocks after font size change
  for (const b of design.blocks) { measureBlock(b); calcPinPos(b); updateNets(b); }
  for (const t of design.texts) measureText(t);
  draw();
}

function browseOutputFolder() {
  // Browser can't pick a folder path, so just inform the user
  alert('In the browser version the output path is used as a filename suggestion only. The file will always download to your browser\'s default download folder.');
}

function loadPrefs() {
  try {
    const stored = localStorage.getItem('gooeycore-prefs');
    if (stored) {
      const p = JSON.parse(stored);
      Object.assign(prefs, p);
    }
  } catch(e) {}
}

// ============================================================
//  Modal helpers
// ============================================================
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById(id).querySelector('input, textarea, button.primary')?.focus();
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Close on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('mousedown', e => {
    if (e.target === el) closeModal(el.id);
  });
});

// ============================================================
//  UI helpers
// ============================================================
function toggleGrid() {
  showGrid = !showGrid;
  document.getElementById('btn-grid').style.color = showGrid ? 'var(--accent)' : '';
  draw();
}

function toggleIds() {
  showIds = !showIds;
  document.getElementById('btn-id').style.color = showIds ? 'var(--accent)' : '';
  draw();
}

function setChanged() { changed = true; updateTitle(); }
function updateTitle() {
  document.getElementById('title-display').textContent = (changed ? '● ' : '') + (designFile || 'untitled.gcf');
}

function setStatus(msg) {
  // Status-mode field shows zoom%; use status-info for transient action messages
  document.getElementById('status-info').textContent = msg === 'READY' ? '' : msg;
}

function showPinTip(cx, cy, pin) {
  const tip = document.getElementById('pin-tip');
  tip.textContent = `${pin.pin_name}  [${pin.pin_type}]  ${pin.pin_desc}`;
  tip.style.left = (cx + 14) + 'px';
  tip.style.top  = (cy - 24) + 'px';
  tip.style.display = 'block';
}
function hidePinTip() {
  document.getElementById('pin-tip').style.display = 'none';
}

// ============================================================
//  Boot
// ============================================================
loadPrefs();
buildSidebar();
resizeCanvas();
setStatus('READY');
updateTitle();
