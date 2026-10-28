// Teste de ida e volta da serialização (Node puro): node tests/roundtrip.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const QL = require('../resources/js/store.js');

function rnd(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const r = rnd(42);
const doc = QL.newDoc('Teste de ida e volta');
doc.background = 'dots';
doc.extra = { campoDesconhecido: { a: 1 } };

for (let i = 0; i < 50; i++) {
  const buf = new QL.PointBuf(8);
  let x = r() * 4000 - 2000,
    y = r() * 4000 - 2000;
  const n = 5 + Math.floor(r() * 400);
  for (let k = 0; k < n; k++) {
    x += r() * 6 - 3;
    y += r() * 6 - 3;
    buf.push(x, y, r());
  }
  const pts = QL.rdp(buf.a, buf.n, 0.35, 4);
  doc.items.push({
    id: QL.uuid(),
    type: 'stroke',
    kind: i % 5 === 0 ? 'hl' : 'pen',
    color: '#1a1a1a',
    size: 4,
    pts,
    n: pts.length / 3,
    futuro: i,
  });
}
for (let i = 0; i < 10; i++)
  doc.items.push({
    id: QL.uuid(),
    type: 'note',
    x: i * 230,
    y: -300,
    w: 220,
    h: 220,
    color: '#ffe066',
    text: 'Nota ' + i + '\ncom acentuação: ação, ç',
    fs: 22,
  });
const shapes = ['rect', 'ellipse', 'diamond', 'line', 'arrow'];
for (let i = 0; i < 5; i++)
  doc.items.push({
    id: QL.uuid(),
    type: 'shape',
    shape: shapes[i],
    x: i * 100,
    y: 50,
    w: 80,
    h: -60,
    stroke: '#e03131',
    fill: i % 2 ? '#fff3bf' : null,
    sw: 3,
  });
doc.items.push({ id: QL.uuid(), type: 'text', x: 5, y: 5, w: 300, text: 'Texto livre', color: '#000', fs: 24 });
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const aid = QL.hashStr(png);
doc.assets[aid] = png;
doc.items.push({ id: QL.uuid(), type: 'image', x: 0, y: 400, w: 100, h: 100, assetId: aid });

// conectores: dois válidos (um deles com seta dupla)
doc.items.push({
  id: QL.uuid(),
  type: 'link',
  from: doc.items[50].id,
  to: doc.items[51].id,
  color: '#1a1a1a',
  sw: 2,
  head: 'end',
});
doc.items.push({
  id: QL.uuid(),
  type: 'link',
  from: doc.items[51].id,
  to: doc.items[60].id,
  color: '#e03131',
  sw: 3,
  head: 'both',
});
// trajetos: link em curva, link em cotovelo com cp e seta reta com cp
doc.items.push({
  id: QL.uuid(),
  type: 'link',
  from: doc.items[52].id,
  to: doc.items[53].id,
  color: '#1a1a1a',
  sw: 2,
  head: 'end',
  route: 'curve',
});
doc.items.push({
  id: QL.uuid(),
  type: 'link',
  from: doc.items[53].id,
  to: doc.items[54].id,
  color: '#1a1a1a',
  sw: 2,
  head: 'none',
  route: 'elbow',
  cp: [1800, 700],
});
doc.items[64].cp = [9999, 8888]; // seta (shape arrow) reta com ponto de controle
// texto personalizado: fonte, negrito e itálico opcionais
Object.assign(doc.items[50], { font: 'serif', weight: 'bold', italic: true });
Object.assign(doc.items[65], { font: 'mono', italic: true });
const s1 = QL.serializeDoc(doc);
const d2 = QL.parseDoc(s1);
const s2 = QL.serializeDoc(d2);
const d3 = QL.parseDoc(s2);
const s3 = QL.serializeDoc(d3);
assert.equal(s2, s1, 'ida e volta 1');
assert.equal(s3, s2, 'ida e volta 2');
assert.equal(d2.items.length, 71);
assert.equal(d2.items.filter((i) => i.type === 'link').length, 4);
assert.equal(d2.items[0].futuro, 0, 'campo desconhecido do item preservado');
assert.deepEqual(d2.extra, { campoDesconhecido: { a: 1 } }, 'campo desconhecido do doc preservado');
assert.equal(d2.assets[aid], png);
// comparação numérica dos pontos (tolerância de quantização 0,05)
let maxErr = 0;
for (let i = 0; i < 50; i++) {
  const a = doc.items[i],
    b = d2.items[i];
  assert.equal(a.n, b.n);
  for (let k = 0; k < a.n * 2; k++)
    maxErr = Math.max(maxErr, Math.abs(a.pts[((k / 2) | 0) * 3 + (k % 2)] - b.pts[((k / 2) | 0) * 3 + (k % 2)]));
}
assert.ok(maxErr <= 0.0501, 'erro de quantização ' + maxErr);
// conector com ponta inexistente é descartado ao carregar
const raw = JSON.parse(s1);
raw.items.push({
  id: 'orf',
  type: 'link',
  from: raw.items[50].id,
  to: 'nao-existe',
  color: '#000',
  sw: 2,
  head: 'end',
});
const dO = QL.parseDoc(JSON.stringify(raw));
assert.equal(dO.items.length, 71);
assert.ok(!dO.items.some((i) => i.id === 'orf'), 'órfão sumiu');
// geometria: âncora na borda e conector sem x/y
assert.deepEqual(QL.anchorOnBox([0, 0, 100, 50], 300, 25), [100, 25, 'e']);
assert.deepEqual(QL.anchorOnBox([0, 0, 100, 50], 50, -300), [50, 0, 'n']);
// migrate: arquivo sem schemaVersion e de versão futura
assert.throws(() => QL.parseDoc('{"format":"outro"}'));
const fut = JSON.parse(s1);
fut.schemaVersion = 9;
fut.campoNovo = 7;
const dF = QL.parseDoc(JSON.stringify(fut));
assert.equal(dF.newer, true);
assert.equal(dF.extra.campoNovo, 7);
// histórico: desfazer/refazer devolve exatamente o mesmo texto
const D = new QL.Doc(QL.parseDoc(s1));
const H = new QL.History(D);
const before = QL.serializeDoc(D);
const victims = [D.items[3], D.items[10], D.items[60]];
H.exec(QL.cmdDel(D, victims));
H.exec({ t: 'xf', items: [D.items[0], D.items[1]], sx: 1.5, sy: 0.5, tx: 30, ty: -12 });
const afterTx = QL.serializeDoc(D);
H.undo();
H.undo();
assert.equal(QL.serializeDoc(D), before, 'undo restaura');
H.redo();
H.redo();
assert.equal(QL.serializeDoc(D), afterTx, 'redo reaplica');
// apagar nota leva os conectores; desfazer traz tudo; clonar remapeia ids
const D2 = new QL.Doc(QL.parseDoc(s1));
const H2 = new QL.History(D2);
const n51 = D2.items[51],
  nLinks = D2.links().length;
H2.exec(QL.cmdDel(D2, [n51]));
assert.equal(D2.links().length, nLinks - 2, 'conectores da nota 51 saíram junto');
assert.equal(D2.items.length, 71 - 1 - 2);
H2.undo();
assert.equal(D2.links().length, nLinks);
assert.equal(D2.items.length, 71);
const sel = [D2.items[50], D2.items[51], D2.links()[0]],
  cl = QL.cloneItems(sel, 10, 10);
assert.equal(cl.length, 3);
assert.ok(cl[2].from === cl[0].id && cl[2].to === cl[1].id && cl[2].id !== sel[2].id);
assert.equal(QL.cloneItems([D2.items[50], D2.links()[0]], 0, 0).length, 1, 'conector sem as duas pontas não entra');
assert.ok(!('x' in D2.links()[0]), 'link sem x/y');
// trajetos: campos preservados, bbox inclui o cp, curva/cotovelo amostrados
const Dr = new QL.Doc(QL.parseDoc(s1));
const lc = Dr.links().find((l) => l.route === 'curve'),
  le = Dr.links().find((l) => l.route === 'elbow'),
  ar = Dr.items[64];
assert.deepEqual(le.cp, [1800, 700]);
assert.deepEqual(ar.cp, [9999, 8888]);
assert.ok(!('route' in ar), 'seta reta sem route no JSON');
const bl = QL.bbox(le),
  ba = QL.bbox(ar);
assert.ok(bl[2] >= 1800 && bl[3] >= 700, 'bbox do link em cotovelo inclui o cp');
assert.ok(ba[2] >= 9999 && ba[3] >= 8888, 'bbox da seta inclui o cp');
assert.ok(QL.itemPath(lc).length >= 40, 'curva amostrada');
assert.ok(QL.itemPath(le).length >= 8, 'cotovelo com cantos');
assert.ok(
  QL.hitItem(ar, ...QL.routeMid([ar.x, ar.y], [ar.x + ar.w, ar.y + ar.h], ar, []), 3),
  'hit no meio da curva da seta'
);
assert.equal(QL.serializeDoc(Dr).includes('"cp":[9999,8888]'), true);
// fonte / negrito / itálico sobrevivem à ida e volta; item sem os campos fica como antes
const n50 = d2.items[50],
  t65 = d2.items[65];
assert.deepEqual([n50.font, n50.weight, n50.italic], ['serif', 'bold', true]);
assert.deepEqual([t65.font, t65.weight, t65.italic], ['mono', undefined, true]);
assert.ok(!('font' in d2.items[51]), 'nota sem fonte continua sem campo');
assert.deepEqual(QL.fontParts(n50), { family: QL.FONTS.serif.family, weight: 'bold', style: 'italic' });
assert.deepEqual(QL.fontParts(d2.items[51]), { family: QL.FONTS.system.family, weight: 'normal', style: 'normal' });
// arquivos de quadro: extensão nova e antiga; argumento de linha de comando
assert.equal(QL.EXT, '.quadro');
for (const f of ['Reunião.quadro', 'C:\\Users\\João\\Quadro Leve\\a.board.json', 'X.QUADRO'])
  assert.ok(QL.isBoardFile(f), f);
for (const f of ['a.json', 'a.png', '', null]) assert.ok(!QL.isBoardFile(f), String(f));
const argPath = 'C:\\Users\\João\\Documents\\Quadro Leve\\Reunião.quadro';
assert.equal(QL.fileArgFrom(['QuadroLeve.exe', '--load-dir-res', argPath]), argPath);
assert.equal(QL.fileArgFrom(['QuadroLeve.exe', '"' + argPath + '"']), argPath, 'aspas removidas');
assert.equal(QL.fileArgFrom(['QuadroLeve.exe', 'x.board.json']), 'x.board.json');
assert.equal(QL.fileArgFrom(['QuadroLeve.exe', '--flag']), null);
assert.equal(QL.fileArgFrom(undefined), null);
console.log(
  'OK  itens=' +
    d2.items.length +
    '  bytes=' +
    s1.length +
    '  erro máx de quantização=' +
    maxErr.toFixed(4) +
    '  ida-e-volta idêntica=' +
    (s1 === s2 && s2 === s3)
);
