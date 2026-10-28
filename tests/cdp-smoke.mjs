// Teste de fumaça no Chrome headless via DevTools Protocol (sem dependências).
// Uso: node tests/cdp-smoke.mjs [caminho-do-chrome] [pasta-de-saída]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const chromePath = process.argv[2] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = process.argv[3] || '/tmp';
const url = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../resources/index.html');
const port = 9333;
const prof = fs.mkdtempSync(path.join(out, 'qlprof-'));
const ch = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + prof,
    '--window-size=1280,800',
    '--no-first-run',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (targets.length) break;
  } catch (e) {
    /* espera */
  }
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) {
    pend.get(d.id)(d);
    pend.delete(d.id);
  } else if (d.method === 'Page.javascriptDialogOpening') {
    send('Page.handleJavaScriptDialog', { accept: true }); // beforeunload com quadro sujo
  } else if (d.method === 'Runtime.exceptionThrown')
    errors.push('EXCEÇÃO: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
    errors.push('console.error: ' + d.params.args.map((a) => a.value || a.description).join(' '));
  else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error')
    errors.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails)
    throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  return r.result.result.value;
};
const mouse = (type, x, y, extra = {}) =>
  send(
    'Input.dispatchMouseEvent',
    Object.assign({ type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, extra)
  );
async function drag(pts, extra) {
  await mouse('mouseMoved', pts[0][0], pts[0][1], { buttons: 0 });
  await mouse('mousePressed', pts[0][0], pts[0][1], extra);
  for (const p of pts.slice(1)) await mouse('mouseMoved', p[0], p[1], extra);
  const l = pts[pts.length - 1];
  await mouse('mouseReleased', l[0], l[1], extra);
  await sleep(60);
}
const key = async (k, mods = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k,
    modifiers: mods,
    windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0,
  });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, modifiers: mods });
  await sleep(40);
};
const results = [];
const check = (name, ok, extra) => {
  results.push([name, ok]);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(1500);
check('boot sem erros', errors.length === 0, errors);
check('tela inicial visível', await ev("document.getElementById('start').classList.contains('show')"));
await ev("document.getElementById('startClose').click()");
await sleep(100);
check('modo navegador (BrowserStorage)', (await ev('__ql.storage.kind')) === 'browser');
const off = await ev(
  "(()=>{const r=document.getElementById('stage').getBoundingClientRect();return [r.left,r.top]})()"
);
const P = (x, y) => [off[0] + x, off[1] + y];

// caneta
await ev("document.querySelector('[data-tool=pen]').click()");
const pts = [];
for (let i = 0; i < 60; i++) pts.push(P(200 + i * 6, 200 + Math.sin(i / 6) * 40));
await drag(pts);
check(
  'traço criado',
  (await ev('__ql.doc.items.length')) === 1 && (await ev('__ql.doc.items[0].type')) === 'stroke',
  await ev('__ql.doc.items[0].n')
);
// forma: retângulo
await key('s');
await drag([P(500, 150), P(700, 280)]);
check('forma criada', (await ev('__ql.doc.items.map(i=>i.type).join()')) === 'stroke,shape');
// nota
await key('n');
await drag([P(300, 400), P(300, 400)]);
await sleep(100);
await send('Input.insertText', { text: 'Olá, nota com acentuação' });
await key('Escape');
await sleep(100);
check(
  'nota com texto',
  (await ev("__ql.doc.items.filter(i=>i.type==='note')[0]?.text")) === 'Olá, nota com acentuação'
);
// texto
await key('t');
await drag([P(650, 450), P(650, 450)]);
await sleep(100);
await send('Input.insertText', { text: 'Texto livre no quadro, com quebra de linha automática por palavra' });
await key('Escape');
await sleep(100);
check('texto criado', (await ev("__ql.doc.items.filter(i=>i.type==='text').length")) === 1);
// seleção e movimento
await key('v');
await drag([P(520, 200), P(580, 230)]); // clica na forma e arrasta
const before = await ev("__ql.doc.items.find(i=>i.type==='shape').x");
await drag([P(600, 150), P(640, 190)]); // borda superior da forma
check('mover item selecionado', Math.abs((await ev("__ql.doc.items.find(i=>i.type==='shape').x")) - before) > 0.1);
// undo / redo
const n0 = await ev('__ql.doc.items.length');
await key('z', 2);
check('desfazer (Ctrl+Z)', (await ev('__ql.doc.items.length')) <= n0);
await key('y', 2);
// borracha
await key('e');
const nBefore = await ev('__ql.doc.items.length');
await drag([P(260, 190), P(260, 260)]);
check('borracha apaga traço', (await ev('__ql.doc.items.length')) < nBefore);
await key('z', 2);
// slider de espessura em item selecionado: prévia no input, UM comando no change, barra intacta
await ev("QL.T.setTool('select'); QL.T.setSel([__ql.doc.items.find(i=>i.type==='shape')])");
await sleep(100);
const u0 = await ev('__ql.hist.undoS.length');
const sw =
  await ev(`(()=>{const r=document.querySelector('#ctxbar input[type=range]'); window.__sl=r; if(!r) return null;
  for (const v of [6,9,12]) { r.value=v; r.dispatchEvent(new Event('input',{bubbles:true})); }
  const mid = __ql.doc.items.find(i=>i.type==='shape').sw; r.dispatchEvent(new Event('change',{bubbles:true}));
  return {mid, inDom: document.body.contains(r), fim: __ql.doc.items.find(i=>i.type==='shape').sw}; })()`);
check('slider de espessura: prévia, DOM mantido', sw && sw.mid === 12 && sw.inDom && sw.fim === 12, sw);
check(
  'slider de espessura: 1 comando no undo',
  (await ev('__ql.hist.undoS.length')) === u0 + 1,
  (await ev('__ql.hist.undoS.length')) - u0
);
await key('z', 2);
check('undo do slider volta a espessura', (await ev("__ql.doc.items.find(i=>i.type==='shape').sw")) === 3);
await ev('QL.T.setSel([])');
// commitEdit ao fechar: digita numa nota SEM sair da edição e serializa (o que o windowClose faz)
await key('n');
await drag([P(900, 600), P(900, 600)]);
await sleep(100);
await send('Input.insertText', { text: 'texto no fechamento' });
const closed = await ev("(()=>{ const t=__ql.serialize(); return t.includes('texto no fechamento'); })()");
check('commitEdit antes de serializar (fechar com texto em edição)', closed === true);
// largura/altura da barra de contexto não mudam ao mexer na espessura
await key('p');
await sleep(100);
const bar0 = await ev(
  "(()=>{const r=document.getElementById('ctxbar').getBoundingClientRect();return [r.width,r.height]})()"
);
await ev(
  `(()=>{const r=document.querySelector('#ctxbar input[type=range]'); for (const v of [1,9,24,2]) { r.value=v; r.dispatchEvent(new Event('input',{bubbles:true})); } })()`
);
const bar1 = await ev(
  "(()=>{const r=document.getElementById('ctxbar').getBoundingClientRect();return [r.width,r.height]})()"
);
check('ctxbar mantém tamanho ao mudar a espessura', bar0[0] === bar1[0] && bar0[1] === bar1[1] && bar0[1] > 0, [
  bar0,
  bar1,
]);
check(
  'ctxbar fora do palco',
  await ev("!document.getElementById('stage').contains(document.getElementById('ctxbar'))")
);
// conectores: ferramenta L entre duas notas
await ev(
  `(()=>{ const mk=(x)=>({id:QL.uuid(),type:'note',x,y:100,w:100,h:100,color:'#fff3a3',text:'',fs:22}); window.__A=mk(250); window.__B=mk(450); QL.T.addItems([__A,__B]); })()`
);
const sc = async (id) => {
  const c = await ev(
    `(()=>{const it=__ql.doc.byId.get(${JSON.stringify(id)}); return QL.R.toScreen(it.x+it.w/2, it.y+it.h/2)})()`
  );
  return P(c[0], c[1]);
};
const aId = await ev('__A.id'),
  bId = await ev('__B.id');
await key('l');
await drag([await sc(aId), await sc(bId)]);
const lk = await ev(
  "(()=>{const l=__ql.doc.items.filter(i=>i.type==='link'); return l.length===1?{from:l[0].from,to:l[0].to,x:l[0].x,y:l[0].y,head:l[0].head}:l.length})()"
);
check(
  'ferramenta L cria um link entre as notas',
  lk && lk.from === aId && lk.to === bId && lk.x === undefined && lk.y === undefined,
  lk
);
await key('l');
await drag([await sc(aId), await sc(bId)]);
check('não duplica o mesmo par', (await ev("__ql.doc.items.filter(i=>i.type==='link').length")) === 1);
const ay0 = await ev('__A.y');
const b0 = await ev('QL.bbox(__ql.doc.links()[0]).join()');
await key('v');
const ac = await sc(aId);
await drag([ac, [ac[0], ac[1] + 60]]);
const mv = await ev(
  '(()=>{const l=__ql.doc.links()[0]; return {dy:__A.y-' +
    ay0 +
    ', x:l.x, from:l.from, to:l.to, box:QL.bbox(l).join()}})()'
);
check(
  'mover nota: link sem x/y, mesmas pontas, geometria acompanha',
  Math.abs(mv.dy - 60) < 1 && mv.x === undefined && mv.from === aId && mv.to === bId && mv.box !== b0,
  mv
);
await ev('QL.T.setSel([__A])');
const nItems = await ev('__ql.doc.items.length');
await key('Delete');
check(
  'apagar a nota leva o link',
  (await ev("__ql.doc.items.filter(i=>i.type==='link').length")) === 0 &&
    (await ev('__ql.doc.items.length')) === nItems - 2
);
await key('z', 2);
check(
  'Ctrl+Z traz nota e link de volta',
  (await ev("__ql.doc.items.filter(i=>i.type==='link').length")) === 1 && (await ev('__ql.doc.items.length')) === nItems
);
await ev('QL.T.setSel([])');
// trajetos: curva pelo chip, hit-test na curva, alça de controle (cp) e duplo clique na alça
await ev(`(()=>{ const mk=(x,y)=>({id:QL.uuid(),type:'note',x,y,w:100,h:100,color:'#a5d8ff',text:'',fs:22}); const C=mk(0,600), D=mk(200,800);
  QL.T.addItems([C,D]); QL.T.addItems([{id:QL.uuid(),type:'link',from:C.id,to:D.id,color:'#1a1a1a',sw:2,head:'end'}]); __ql.fit(); window.__L=__ql.doc.links().at(-1); QL.T.setTool('select'); QL.T.setSel([__L]); })()`);
await sleep(150);
await ev("[...document.querySelectorAll('#ctxbar .chip')].find(b=>b.textContent==='Curva').click()");
await sleep(100);
check('chip Curva aplica route sem cp', await ev("__L.route==='curve' && __L.cp===undefined"));
const hit =
  await ev(`(()=>{ const P=QL.itemPath(__L), e=QL.itemEnds(__L), k=Math.floor(P.length/8)*2, qx=P[k], qy=P[k+1];
  const dx=e[2]-e[0], dy=e[3]-e[1], t=((qx-e[0])*dx+(qy-e[1])*dy)/(dx*dx+dy*dy), fx=e[0]+t*dx, fy=e[1]+t*dy;
  return { dev:+Math.hypot(qx-fx,qy-fy).toFixed(1), naCurva:QL.hitItem(__L,qx,qy,3), naRetaAntiga:QL.hitItem(__L,fx,fy,3) }; })()`);
check('hit-test acerta na curva e erra na reta antiga', hit.dev > 8 && hit.naCurva && !hit.naRetaAntiga, hit);
const handle = async () => {
  const c = await ev(
    `(()=>{ const e=QL.itemEnds(__L); const m=QL.routeMid([e[0],e[1]],[e[2],e[3]],__L,[e[4],e[5]]); return QL.R.toScreen(m[0],m[1]); })()`
  );
  return P(c[0], c[1]);
};
const u1 = await ev('__ql.hist.undoS.length');
const h0 = await handle();
await drag([h0, [h0[0] + 30, h0[1] + 10], [h0[0] + 60, h0[1] + 20]]);
const cpv = await ev('__L.cp');
check(
  'arrastar a alça define cp (1 comando no undo)',
  Array.isArray(cpv) && cpv.length === 2 && (await ev('__ql.hist.undoS.length')) === u1 + 1,
  cpv
);
const h1 = await handle();
for (const n of [1, 2]) {
  await mouse('mousePressed', h1[0], h1[1], { clickCount: n });
  await mouse('mouseReleased', h1[0], h1[1], { clickCount: n });
}
await sleep(100);
check('duplo clique na alça remove o cp', await ev('__L.cp===undefined'));
await key('z', 2);
await key('z', 2); // desfaz remoção e arrasto
await key('z', 2); // desfaz a troca para curva
check('desfazer volta o link a reto', await ev('__L.route===undefined && __L.cp===undefined'));
await ev("__L.route='elbow'; QL.T.setSel([]); QL.T.setSel([__L])");
await sleep(50);
const ex = await ev('QL.R.exportPNG(__ql.doc).then(r=>({ok:!!r&&r.blob.size>500}))');
check('exportar PNG com curva/cotovelo', ex.ok);
await ev('QL.T.setSel([])');
await key('1', 2);
await sleep(100);

// ---- modificadores (Shift / Alt / Ctrl) ----
const SHIFT = 8,
  ALT = 1,
  CTRL = 2;
const lastItem = () =>
  ev('(()=>{const it=__ql.doc.items.at(-1); return {type:it.type,x:it.x,y:it.y,w:it.w,h:it.h,n:it.n}})()');
await key('s');
await drag([P(150, 560), P(250, 610)], { modifiers: SHIFT });
const sq = await lastItem();
check(
  'Shift ao desenhar retângulo: w == h',
  sq.type === 'shape' && Math.abs(Math.abs(sq.w) - Math.abs(sq.h)) < 0.01,
  sq
);
const a0 = P(400, 560);
await drag([a0, P(450, 600)], { modifiers: ALT });
const al = await ev(
  `(()=>{const it=__ql.doc.items.at(-1), s=QL.R.toWorld(${a0[0]},${a0[1]}); return {cx:it.x+it.w/2-s[0], cy:it.y+it.h/2-s[1]}})()`
);
check('Alt ao desenhar forma: centro no ponto inicial', Math.abs(al.cx) < 0.01 && Math.abs(al.cy) < 0.01, al);
await ev(`(()=>{ const c=QL.R.viewCenter(), mk=(col)=>({id:QL.uuid(),type:'note',x:c[0]-50,y:c[1]-50,w:100,h:100,color:col,text:'',fs:22}); window.__N=mk('#ffc078'); window.__M=mk('#b2f2bb');
  QL.T.addItems([__N]); QL.T.setTool('select'); QL.T.setSel([__N]); })()`);
const nId = await ev('__N.id');
const nc = await sc(nId);
const cnt0 = await ev('__ql.doc.items.length'),
  uDup = await ev('__ql.hist.undoS.length'),
  nx0 = await ev('__N.x');
await drag([nc, [nc[0] + 70, nc[1] + 30]], { modifiers: ALT });
const dup = await ev(
  `(()=>{const sel=QL.S.sel[0]; return {items:__ql.doc.items.length, undo:__ql.hist.undoS.length, origX:__N.x, copyDx: sel.x-__N.x, isCopy: sel!==__N}})()`
);
check(
  'Alt+arrastar duplica e move a cópia (1 comando)',
  dup.items === cnt0 + 1 && dup.undo === uDup + 1 && dup.origX === nx0 && dup.isCopy && Math.abs(dup.copyDx - 70) < 1,
  dup
);
await key('z', 2);
check(
  'desfazer remove a cópia de uma vez',
  (await ev('__ql.doc.items.length')) === cnt0 && (await ev('__N.x')) === nx0
);
const ny0 = await ev('__N.y');
await ev('QL.T.setSel([__N])');
await drag([nc, [nc[0] + 80, nc[1] + 20]], { modifiers: SHIFT });
const lock = await ev(`({dx:__N.x-${nx0}, dy:__N.y-${ny0}})`);
check('Shift ao mover trava o eixo dominante', Math.abs(lock.dx - 80) < 1 && Math.abs(lock.dy) < 0.01, lock);
await ev('__M.x=__N.x; __M.y=__N.y; QL.T.addItems([__M]); QL.T.setSel([__M])'); // M por cima de N
const mc = await sc(await ev('__M.id'));
await drag([mc, mc], { modifiers: CTRL });
check('Ctrl+clique seleciona o item abaixo na pilha', await ev('QL.S.sel.length===1 && QL.S.sel[0]===__N'));
await ev('QL.T.setSel([])');

// ---- fonte e estilo do texto ----
await ev('QL.T.setSel([__N])');
await sleep(80);
for (const label of ['Serifa', 'N', 'I'])
  await ev(`[...document.querySelectorAll('#ctxbar .chip')].find(b=>b.textContent==='${label}').click()`);
check(
  'chips de fonte / negrito / itálico aplicam no item',
  await ev("__N.font==='serif' && __N.weight==='bold' && __N.italic===true")
);
await ev('QL.T.setSel([])');

// ---- traço que vira reta e correção do traço (níveis) ----
const strokeN = () => ev('__ql.doc.items.at(-1).n');
const setLevel = (l) => ev(`document.querySelector('[data-act=st-${l}]').click()`);
await ev("__ql.doc.background='white'; QL.R.view.tx += 20000; QL.R.redrawNow()"); // área vazia, sem outros itens sob o traço
await key('p');
// H: a prévia ao vivo usa a mesma geometria (outline) do traço final
const arc = [];
for (let i = 0; i < 30; i++) {
  const t = i / 29;
  arc.push(P(300 + t * 360, 520 - Math.sin(t * Math.PI) * 90));
}
await ev('window.__outl=0; window.__o0=QL.outline; QL.outline=(...a)=>{ window.__outl++; return window.__o0(...a); }');
await mouse('mouseMoved', arc[0][0], arc[0][1], { buttons: 0 });
await mouse('mousePressed', arc[0][0], arc[0][1]);
for (const q of arc.slice(1)) await mouse('mouseMoved', q[0], q[1]);
const spy = await ev(
  `(()=>{ const d=QL.R.live.getContext('2d').getImageData(280,400,420,150).data; window.__liveA=Uint8Array.from({length:420*150},(_,i)=>d[i*4+3]); return window.__outl; })()`
);
await mouse('mouseReleased', arc.at(-1)[0], arc.at(-1)[1]);
await sleep(80);
const cmp = await ev(
  `(()=>{ QL.outline=window.__o0; const s=QL.R.sctx.getImageData(280,400,420,150).data; let bad=0, ink=0; for (let i=0;i<420*150;i++){ const li=255-window.__liveA[i]*(255-26)/255; if (Math.abs(li-s[i*4])>40) bad++; if (s[i*4]<200) ink++; } return {bad, ratio:+(bad/63000).toFixed(4), ink}; })()`
);
check('prévia ao vivo usa outline a cada movimento (spy)', spy >= 29, spy);
check('traço ao vivo = traço consolidado (< 2% dos pixels diferem)', cmp.ink > 300 && cmp.ratio < 0.02, cmp);
// D: parado por 1 s vira reta (nível médio, o padrão)
const bent = [P(300, 300), P(350, 350), P(400, 300)];
await mouse('mouseMoved', bent[0][0], bent[0][1], { buttons: 0 });
await mouse('mousePressed', bent[0][0], bent[0][1]);
for (const q of bent.slice(1)) await mouse('mouseMoved', q[0], q[1]);
await sleep(1150);
await mouse('mouseMoved', P(500, 320)[0], P(500, 320)[1]);
await mouse('mouseReleased', P(500, 320)[0], P(500, 320)[1]);
await sleep(80);
const held = await ev(
  `(()=>{const it=__ql.doc.items.at(-1), e=QL.R.toWorld(${P(500, 320)[0]},${P(500, 320)[1]}); return {n:it.n, ex:it.pts[3]-e[0], ey:it.pts[4]-e[1]}})()`
);
check(
  'traço parado 1 s vira reta e a ponta segue o ponteiro',
  held.n === 2 && Math.abs(held.ex) < 1 && Math.abs(held.ey) < 1,
  held
);
// G: níveis de correção
const zig = [];
for (let i = 0; i <= 30; i++) zig.push(P(300 + i * 10, 600 + (i % 2 ? 2 : -2)));
await setLevel('high');
await drag(zig);
await sleep(60);
check('nível alto: traço quase reto vira 2 pontos ao soltar', (await strokeN()) === 2, await strokeN());
await setLevel('off');
await drag(zig);
await sleep(60);
const nOff = await strokeN();
check('nível desativado: o mesmo traço mantém mais de 2 pontos', nOff > 2, nOff);
await mouse('mouseMoved', bent[0][0], bent[0][1], { buttons: 0 });
await mouse('mousePressed', bent[0][0], bent[0][1]);
for (const q of bent.slice(1)) await mouse('mouseMoved', q[0], q[1]);
await sleep(1250);
await mouse('mouseMoved', P(450, 350)[0], P(450, 350)[1]);
await mouse('mouseReleased', P(450, 350)[0], P(450, 350)[1]);
await sleep(80);
const nHeldOff = await strokeN();
check('desativado: segurar parado não vira reta', nHeldOff > 2, nHeldOff);
await setLevel('high');
await ev("__ql.doc.background='grid'; QL.R.view.tx -= 20000; QL.R.redrawNow()");
check('nível gravado em localStorage (ql.straighten)', (await ev("localStorage.getItem('ql.straighten')")) === 'high');

// ---- tema escuro ----
const exportCorner = () =>
  ev(
    `QL.R.exportPNG(__ql.doc).then(async r=>{ const b=await createImageBitmap(r.blob), c=document.createElement('canvas'); c.width=b.width; c.height=b.height; const x=c.getContext('2d'); x.drawImage(b,0,0); return Array.from(x.getImageData(2,2,1,1).data.slice(0,3)); })`
  );
await ev("document.querySelector('[data-act=theme-dark]').click()");
await sleep(150);
const dk = await ev(
  "({t:document.documentElement.dataset.theme, pen:QL.S.slots[0].color, txt:QL.S.text.color, ls:localStorage.getItem('ql.theme')})"
);
check(
  'tema escuro: data-theme, tinta padrão e preferência gravada',
  dk.t === 'dark' && dk.pen === '#f2f2f2' && dk.txt === '#f2f2f2' && dk.ls === 'dark',
  dk
);
const cd = await exportCorner();
check(
  'exportação PNG segue o tema (fundo escuro)',
  cd.every((v) => v <= 20),
  cd
);
await ev("document.querySelector('[data-act=theme-light]').click()");
await sleep(150);
const cl = await exportCorner();
check(
  'tema claro de volta: tinta e fundo da exportação',
  (await ev('QL.S.slots[0].color')) === '#1a1a1a' && cl.every((v) => v >= 250),
  cl
);

// ---- arquivo por argumento (função pura) ----
const argP = 'C:\\\\Users\\\\João\\\\Documents\\\\Quadro Leve\\\\Reunião.quadro';
check(
  'fileArgFrom extrai o caminho de NL_ARGS',
  (await ev(`QL.fileArgFrom(['QuadroLeve.exe','--load-dir-res',${JSON.stringify(argP)}])`)) === argP
);
// zoom por roda (Ctrl) e pan
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel',
  x: off[0] + 400,
  y: off[1] + 300,
  deltaX: 0,
  deltaY: -300,
  modifiers: 2,
});
await sleep(300);
check('zoom com Ctrl+roda', (await ev('QL.R.view.scale')) > 1.2, await ev('QL.R.view.scale'));
await key('1', 2);
await sleep(100);
check('Ctrl+1 volta a 100%', Math.abs((await ev('QL.R.view.scale')) - 1) < 1e-6);
// salvar (IndexedDB) e reabrir
await ev('__ql.saveMain(true)');
await sleep(400);
check(
  'salvo no IndexedDB',
  (await ev('__ql.storage.listRecents().then(r=>r.length)')) >= 1 && (await ev('!__ql.dirty'))
);
const txt = await ev('__ql.serialize()');
const cnt = await ev('__ql.doc.items.length');
await ev(`__ql.openText(${JSON.stringify(txt)}, 'idb:x', false).then(()=>1)`);
await sleep(300);
check(
  'reabrir quadro igual',
  (await ev('__ql.doc.items.length')) === cnt &&
    (await ev('__ql.serialize()').then((t) => JSON.parse(t).items.length)) === cnt
);
// exportar PNG
const exp = await ev('QL.R.exportPNG(__ql.doc).then(r=>r?({w:r.w,h:r.h,size:r.blob.size,reduced:r.reduced}):null)');
check('exportar PNG', exp && exp.size > 500, exp);

// ---- responsividade vertical ----
for (const [w, h] of [
  [700, 900],
  [1000, 480],
]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const m = await ev(
    `(()=>{ const d=document.documentElement, st=document.getElementById('status').getBoundingClientRect(), sg=document.getElementById('stage').getBoundingClientRect(), cv=document.getElementById('static'); return {sw:d.scrollWidth, sh:d.scrollHeight, iw:innerWidth, ih:innerHeight, stBottom:st.bottom, stTop:st.top, stageH:sg.height, stageW:sg.width, cw:cv.clientWidth, ch:cv.clientHeight, R:[QL.R.W,QL.R.H]}; })()`
  );
  check(
    `janela ${w}x${h}: sem rolagem, status visível, palco > 200, canvas = palco`,
    m.sw <= m.iw &&
      m.sh <= m.ih &&
      m.stBottom <= m.ih + 0.5 &&
      m.stTop >= 0 &&
      m.stageH > 200 &&
      Math.abs(m.cw - m.stageW) < 1.5 &&
      Math.abs(m.ch - m.stageH) < 1.5 &&
      Math.abs(m.R[1] - m.stageH) < 1.5,
    m
  );
}
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await key('p');
await sleep(200);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(out, 'ql-smoke.png'), Buffer.from(shot.result.data, 'base64'));
// estresse
const st = await ev('__stress(5000, 200)');
console.log('ESTRESSE', JSON.stringify(st));
check('estresse 5000+200', st.itens >= 5200 && st.redesenhoMedioMs < 400, st);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(out, 'ql-stress.png'), Buffer.from(shot2.result.data, 'base64'));
const mem = await ev('Math.round(performance.memory ? performance.memory.usedJSHeapSize/1048576 : -1)');
console.log('heap JS (MB) após estresse:', mem);

// ---- a correção do traço persiste após recarregar ----
await send('Page.reload');
await sleep(1800);
check('nível de correção persiste após recarregar', (await ev('QL.S.straighten')) === 'high');
check('sem erros no console durante o teste', errors.length === 0, errors);
ws.close();
ch.kill();
const fail = results.filter((r) => !r[1]).length;
console.log(fail ? fail + ' falha(s)' : 'TUDO OK');
process.exit(fail ? 1 : 0);
