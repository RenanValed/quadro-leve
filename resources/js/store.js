/* ===========================================================================
   Quadro Leve - store.js
   Modelo de dados, serialização, grade espacial, documento e histórico.
   Sem DOM: funciona no navegador e no Node (tests/roundtrip.mjs).
   =========================================================================== */
(function (root) {
  'use strict';

  const QL = root.QL || {};
  const APP_VERSION = '1.2.0';
  const SCHEMA = 1;
  const FORMAT = 'quadro-leve';
  const WORLD = 1000000; // limite do mundo (±)
  const CELL = 512; // célula da grade espacial
  const MIN_SCALE = 0.1,
    MAX_SCALE = 8;
  // Cores da interface (definição única)
  const PALETTE = ['#1a1a1a', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#868e96', '#ffffff'];
  const FILLS = ['#fff3bf', '#ffd8a8', '#ffc9c9', '#d0ebff', '#c3fae8', '#e5dbff', '#e9ecef'];
  const NOTE_COLORS = ['#fff3a3', '#ffc078', '#ffadc8', '#d0bfff', '#a5d8ff', '#b2f2bb', '#ced4da', '#ffffff'];
  const HL_COLORS = ['#ffe14d', '#7ee27e', '#ff8fb8', '#7ec8ff', '#ffb36b'];
  const UNTITLED = 'Quadro sem título';
  // tinta padrão por tema (itens já criados não mudam; só os padrões das ferramentas)
  const INK_LIGHT = '#1a1a1a';
  const INK_DARK = '#f2f2f2';
  // fontes do texto e das notas: só pilhas do sistema (nada é baixado)
  const FONTS = {
    system: { label: 'Sistema', family: "system-ui, 'Segoe UI', Roboto, Arial, sans-serif" },
    serif: { label: 'Serifa', family: "Georgia, 'Times New Roman', serif" },
    mono: { label: 'Mono', family: "Consolas, 'Courier New', monospace" },
    rounded: { label: 'Arredondada', family: "'Segoe UI', 'Arial Rounded MT Bold', sans-serif" },
    condensed: { label: 'Estreita', family: "'Arial Narrow', 'Segoe UI', sans-serif" },
  };
  // estilo tipográfico do item (campos opcionais font / weight / italic; ausentes = padrão)
  function fontParts(it) {
    return {
      family: (FONTS[it.font] || FONTS.system).family,
      weight: it.weight === 'bold' ? 'bold' : 'normal',
      style: it.italic ? 'italic' : 'normal',
    };
  }
  const EXT = '.quadro'; // extensão nova (o Windows só lê a última extensão, então '.board.json' não associava); o formato é o mesmo JSON
  // arquivos de quadro reconhecidos: o novo e o antigo (que continua abrindo e salva no mesmo caminho)
  const isBoardFile = (path) => /\.(quadro|board\.json)$/i.test(String(path || ''));
  // caminho do arquivo passado na linha de comando (NL_ARGS = [exe, ...argumentos]) ou null
  function fileArgFrom(args) {
    if (!Array.isArray(args)) return null;
    for (const a of args.slice(1)) {
      const p = String(a)
        .trim()
        .replace(/^"+|"+$/g, '');
      if (p && !p.startsWith('--') && /\.(quadro|board\.json|json)$/i.test(p)) return p;
    }
    return null;
  }
  const LINE_H = 1.3; // altura de linha do texto (relativa ao corpo)
  const arrowLen = (sw) => 10 + sw * 3; // comprimento da cabeça de seta
  const strokeHalfW = (it) => (it.kind === 'hl' ? it.size : it.size * 1.7) / 2; // meia largura máxima do traço

  /* ------------------------------ utilidades ------------------------------ */
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else s += h[(Math.random() * 16) | 0];
    }
    return s;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const nowIso = () => new Date().toISOString();

  function hashStr(s) {
    // hash simples (djb2 + comprimento) para dedupe de imagens
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '-' + s.length.toString(36);
  }

  /* ----------------------- traço: pontos, RDP, contorno ------------------- */
  // Buffer de pontos (x, y, pressão) que cresce dobrando.
  class PointBuf {
    constructor(cap) {
      this.a = new Float32Array((cap || 256) * 3);
      this.n = 0;
    }
    push(x, y, p) {
      if ((this.n + 1) * 3 > this.a.length) {
        const b = new Float32Array(this.a.length * 2);
        b.set(this.a);
        this.a = b;
      }
      const i = this.n * 3;
      this.a[i] = x;
      this.a[i + 1] = y;
      this.a[i + 2] = p;
      this.n++;
    }
  }

  // Ramer-Douglas-Peucker iterativo; considera também a variação de pressão.
  function rdp(src, n, eps, size) {
    if (n < 3) return src.slice(0, n * 3);
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const stack = [0, n - 1];
    while (stack.length) {
      const b = stack.pop(),
        a = stack.pop();
      if (b <= a + 1) continue;
      const ax = src[a * 3],
        ay = src[a * 3 + 1],
        ap = src[a * 3 + 2];
      const bx = src[b * 3],
        by = src[b * 3 + 1],
        bp = src[b * 3 + 2];
      const dx = bx - ax,
        dy = by - ay,
        len2 = dx * dx + dy * dy;
      let md = -1,
        mi = -1;
      for (let i = a + 1; i < b; i++) {
        const px = src[i * 3],
          py = src[i * 3 + 1];
        let d;
        if (len2 === 0) d = Math.hypot(px - ax, py - ay);
        else {
          let t = ((px - ax) * dx + (py - ay) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        }
        const pd = Math.abs(src[i * 3 + 2] - (ap + (bp - ap) * ((i - a) / (b - a)))) * size * 0.5;
        if (pd > d) d = pd;
        if (d > md) {
          md = d;
          mi = i;
        }
      }
      if (md > eps) {
        keep[mi] = 1;
        stack.push(a, mi, mi, b);
      }
    }
    let c = 0;
    for (let i = 0; i < n; i++) if (keep[i]) c++;
    const out = new Float32Array(c * 3);
    let j = 0;
    for (let i = 0; i < n; i++)
      if (keep[i]) {
        out[j++] = src[i * 3];
        out[j++] = src[i * 3 + 1];
        out[j++] = src[i * 3 + 2];
      }
    return out;
  }

  // Largura do traço em função da pressão (0..1). Pressão 0,5 = tamanho nominal.
  function widthAt(kind, size, p) {
    if (kind === 'hl') return size;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    return size * (0.3 + 1.4 * p);
  }

  // Gera o polígono (x,y,x,y...) do contorno com largura variável.
  function outline(pts, n, size, kind) {
    const hl = kind === 'hl';
    if (n < 1) return new Float32Array(0);
    if (n === 1) {
      const r = widthAt(kind, size, pts[2]) / 2,
        k = 14,
        o = new Float32Array(k * 2);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        o[i * 2] = pts[0] + Math.cos(a) * r;
        o[i * 2 + 1] = pts[1] + Math.sin(a) * r;
      }
      return o;
    }
    const L = new Float32Array(n * 2),
      R = new Float32Array(n * 2);
    let nx = 0,
      ny = 1,
      fx = 1,
      fy = 0,
      lastFx = 1,
      lastFy = 0,
      lastNx = 0,
      lastNy = 1;
    let firstNx = 0,
      firstNy = 1,
      firstFx = 1,
      firstFy = 0;
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : 0,
        i1 = i < n - 1 ? i + 1 : n - 1;
      let dx = pts[i1 * 3] - pts[i0 * 3],
        dy = pts[i1 * 3 + 1] - pts[i0 * 3 + 1];
      const l = Math.hypot(dx, dy);
      if (l > 1e-6) {
        fx = dx / l;
        fy = dy / l;
      } else {
        fx = lastFx;
        fy = lastFy;
      }
      nx = -fy;
      ny = fx;
      const hw = widthAt(kind, size, pts[i * 3 + 2]) / 2;
      const x = pts[i * 3],
        y = pts[i * 3 + 1];
      L[i * 2] = x + nx * hw;
      L[i * 2 + 1] = y + ny * hw;
      R[i * 2] = x - nx * hw;
      R[i * 2 + 1] = y - ny * hw;
      if (i === 0) {
        firstNx = nx;
        firstNy = ny;
        firstFx = fx;
        firstFy = fy;
      }
      lastFx = fx;
      lastFy = fy;
      lastNx = nx;
      lastNy = ny;
    }
    const CAP = 6;
    const out = []; // polígono em lista simples; roda no fechamento do traço, após xform e ao carregar
    for (let i = 0; i < n; i++) out.push(L[i * 2], L[i * 2 + 1]);
    const ex = pts[(n - 1) * 3],
      ey = pts[(n - 1) * 3 + 1],
      ehw = widthAt(kind, size, pts[(n - 1) * 3 + 2]) / 2;
    if (hl) {
      out.push(
        L[(n - 1) * 2] + lastFx * ehw,
        L[(n - 1) * 2 + 1] + lastFy * ehw,
        R[(n - 1) * 2] + lastFx * ehw,
        R[(n - 1) * 2 + 1] + lastFy * ehw
      );
    } else {
      for (let k = 1; k < CAP; k++) {
        const a = (k * Math.PI) / CAP,
          c = Math.cos(a),
          s = Math.sin(a);
        out.push(ex + ehw * (lastNx * c + lastFx * s), ey + ehw * (lastNy * c + lastFy * s));
      }
    }
    for (let i = n - 1; i >= 0; i--) out.push(R[i * 2], R[i * 2 + 1]);
    const sx = pts[0],
      sy = pts[1],
      shw = widthAt(kind, size, pts[2]) / 2;
    if (hl) {
      out.push(R[0] - firstFx * shw, R[1] - firstFy * shw, L[0] - firstFx * shw, L[1] - firstFy * shw);
    } else {
      for (let k = 1; k < CAP; k++) {
        const a = (k * Math.PI) / CAP,
          c = Math.cos(a),
          s = Math.sin(a);
        out.push(sx + shw * (-firstNx * c - firstFx * s), sy + shw * (-firstNy * c - firstFy * s));
      }
    }
    return Float32Array.from(out);
  }

  /* ---------------------------- serialização ------------------------------ */
  // Pontos como array plano de inteiros: x e y em décimos, com delta; pressão 0..255.
  function encodePts(pts, n) {
    const o = new Array(n * 3);
    let px = 0,
      py = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(pts[i * 3] * 10),
        y = Math.round(pts[i * 3 + 1] * 10);
      o[i * 3] = x - px;
      o[i * 3 + 1] = y - py;
      o[i * 3 + 2] = clamp(Math.round(pts[i * 3 + 2] * 255), 0, 255);
      px = x;
      py = y;
    }
    return o;
  }
  function decodePts(arr) {
    const n = Math.floor(arr.length / 3),
      pts = new Float32Array(n * 3);
    let x = 0,
      y = 0;
    for (let i = 0; i < n; i++) {
      x += arr[i * 3];
      y += arr[i * 3 + 1];
      pts[i * 3] = x / 10;
      pts[i * 3 + 1] = y / 10;
      pts[i * 3 + 2] = arr[i * 3 + 2] / 255;
    }
    return { pts, n };
  }

  function touch(it) {
    it._s = null;
    it._bb = null;
    it._path = null;
    it._lk = null;
  }

  function serializeItem(it) {
    if (it._s) return it._s;
    const o = {};
    for (const k in it) {
      if (k.charCodeAt(0) === 95 || k === 'pts' || k === 'n') continue;
      o[k] = it[k];
    }
    if (it.type === 'stroke') o.p = encodePts(it.pts, it.n);
    return (it._s = JSON.stringify(o));
  }
  function parseItem(raw) {
    const it = {};
    for (const k in raw) it[k] = raw[k];
    if (!it.id) it.id = uuid();
    if (it.type === 'stroke') {
      const d = decodePts(Array.isArray(it.p) ? it.p : []);
      it.pts = d.pts;
      it.n = d.n;
      delete it.p;
    }
    return it;
  }
  function cloneItem(it, dx, dy) {
    const c = parseItem(JSON.parse(serializeItem(it)));
    c.id = uuid();
    if (dx || dy) xformItem(c, 1, 1, dx, dy);
    return c;
  }

  // Clona um conjunto: conector só entra se as duas pontas estão no conjunto (ids remapeados)
  function cloneItems(items, dx, dy) {
    const map = new Map(),
      out = [];
    for (const it of items)
      if (it.type !== 'link') {
        const c = cloneItem(it, dx, dy);
        map.set(it.id, c.id);
        out.push(c);
      }
    for (const it of items) {
      if (it.type === 'link' && map.has(it.from) && map.has(it.to)) {
        const c = cloneItem(it);
        c.from = map.get(it.from);
        c.to = map.get(it.to);
        out.push(c);
      }
    }
    return out;
  }

  const DOC_KEYS = [
    'format',
    'schemaVersion',
    'appVersion',
    'id',
    'name',
    'createdAt',
    'updatedAt',
    'background',
    'viewport',
    'assets',
    'items',
  ];

  function newDoc(name) {
    const t = nowIso();
    return {
      format: FORMAT,
      schemaVersion: SCHEMA,
      appVersion: APP_VERSION,
      id: uuid(),
      name: name || UNTITLED,
      createdAt: t,
      updatedAt: t,
      background: 'grid',
      viewport: { x: 0, y: 0, scale: 1 },
      items: [],
      assets: {},
      extra: {},
    };
  }

  function serializeDoc(doc) {
    const head = {
      format: FORMAT,
      schemaVersion: SCHEMA,
      appVersion: APP_VERSION,
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      background: doc.background,
      viewport: doc.viewport,
    };
    if (doc.extra) for (const k in doc.extra) if (!(k in head)) head[k] = doc.extra[k];
    // assets: só as referenciadas; string em cache
    const used = {};
    for (const it of doc.items) if (it.type === 'image' && it.assetId && doc.assets[it.assetId]) used[it.assetId] = 1;
    const key = Object.keys(used).sort().join('|');
    if (doc._assetsKey !== key) {
      const a = {};
      for (const k of Object.keys(used).sort()) a[k] = doc.assets[k];
      doc._assetsS = JSON.stringify(a);
      doc._assetsKey = key;
    }
    const hs = JSON.stringify(head);
    const parts = new Array(doc.items.length);
    for (let i = 0; i < doc.items.length; i++) parts[i] = serializeItem(doc.items[i]);
    return hs.slice(0, -1) + ',"assets":' + doc._assetsS + ',"items":[' + parts.join(',') + ']}';
  }

  // Cadeia de migração por schemaVersion. Hoje só existe a v1.
  const MIGRATIONS = {
    // 1: (d) => { d.schemaVersion = 2; /* ... */ return d; },
  };
  function migrate(d) {
    if (!d || typeof d !== 'object' || d.format !== FORMAT)
      throw new Error('Este arquivo não é um quadro do Quadro Leve.');
    let v = d.schemaVersion | 0;
    if (v < 1) v = 1;
    d.schemaVersion = v;
    while (v < SCHEMA) {
      const f = MIGRATIONS[v];
      if (!f) throw new Error('Não sei migrar o quadro da versão ' + v + '.');
      d = f(d);
      v = d.schemaVersion | 0;
    }
    if ((d.schemaVersion | 0) > SCHEMA) d._newer = true; // versão mais nova: abre, preservando campos
    return d;
  }

  function parseDoc(text) {
    const raw = migrate(JSON.parse(text));
    const doc = newDoc(raw.name);
    doc.id = raw.id || doc.id;
    doc.createdAt = raw.createdAt || doc.createdAt;
    doc.updatedAt = raw.updatedAt || doc.updatedAt;
    doc.background = raw.background || 'grid';
    doc.viewport = Object.assign({ x: 0, y: 0, scale: 1 }, raw.viewport || {});
    doc.assets = raw.assets && typeof raw.assets === 'object' ? raw.assets : {};
    doc.newer = !!raw._newer;
    doc.items = (Array.isArray(raw.items) ? raw.items : []).map(parseItem);
    const ids = new Set(doc.items.filter((i) => i.type !== 'link').map((i) => i.id));
    doc.items = doc.items.filter((i) => i.type !== 'link' || (ids.has(i.from) && ids.has(i.to))); // conector sem ponta é descartado
    doc.extra = {};
    for (const k in raw) if (DOC_KEYS.indexOf(k) < 0 && k !== '_newer') doc.extra[k] = raw[k];
    return doc;
  }

  /* ------------------------------ geometria ------------------------------- */
  function xformItem(it, sx, sy, tx, ty) {
    if (it.type === 'link') {
      touch(it);
      return;
    } // a geometria sai das pontas
    if (it.type === 'stroke') {
      const p = it.pts;
      for (let i = 0; i < it.n; i++) {
        p[i * 3] = p[i * 3] * sx + tx;
        p[i * 3 + 1] = p[i * 3 + 1] * sy + ty;
      }
    } else {
      it.x = it.x * sx + tx;
      it.y = it.y * sy + ty;
      if (it.cp) it.cp = [it.cp[0] * sx + tx, it.cp[1] * sy + ty]; // ponto de controle de linha/seta
      if (it.w != null) it.w *= sx;
      if (it.h != null) it.h *= sy;
      if ((it.type === 'note' || it.type === 'text') && sx !== 1 && sy !== 1) {
        it.fs = Math.max(6, it.fs * Math.sqrt(Math.abs(sx * sy)));
      }
    }
    touch(it);
  }

  // caixa [x0,y0,x1,y1] de item com x,y,w,h (w/h podem ser negativos)
  function normRect(it) {
    return [
      Math.min(it.x, it.x + it.w),
      Math.min(it.y, it.y + it.h),
      Math.max(it.x, it.x + it.w),
      Math.max(it.y, it.y + it.h),
    ];
  }
  const centerOf = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const SIDE_DIR = { e: [1, 0], w: [-1, 0], n: [0, -1], s: [0, 1] };
  // ponto onde a reta do centro da caixa até (tx,ty) cruza a borda; devolve [x, y, lado] (n/s/e/w)
  function anchorOnBox(b, tx, ty) {
    const c = centerOf(b),
      dx = tx - c[0],
      dy = ty - c[1];
    if (!dx && !dy) return [c[0], c[1], 'e'];
    const hw = (b[2] - b[0]) / 2 || 1e-6,
      hh = (b[3] - b[1]) / 2 || 1e-6;
    const tH = hw / (Math.abs(dx) || 1e-9),
      tV = hh / (Math.abs(dy) || 1e-9),
      t = Math.min(tH, tV);
    return [c[0] + dx * t, c[1] + dy * t, tH <= tV ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n'];
  }
  // pontas do conector entre duas caixas: [x0, y0, x1, y1, lado0, lado1]
  function linkEnds(ba, bb) {
    const ca = centerOf(ba),
      cb = centerOf(bb),
      a = anchorOnBox(ba, cb[0], cb[1]),
      b = anchorOnBox(bb, ca[0], ca[1]);
    return [a[0], a[1], b[0], b[1], a[2], b[2]];
  }
  // itens que podem ser ligados por conector (nota, forma fechada, texto, imagem)
  const canLink = (it) =>
    it.type !== 'stroke' &&
    it.type !== 'link' &&
    !(it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow'));
  // pontos [x0,y0,x1,y1] do conector; `moved` (Set) + dx,dy deslocam as pontas em arrasto
  function linkPoints(doc, l, moved, dx, dy) {
    const a = doc.byId.get(l.from),
      b = doc.byId.get(l.to);
    if (!a || !b) return null;
    const box = (it) => {
      const r = bbox(it);
      return moved && moved.has(it) ? [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy] : r;
    };
    return linkEnds(box(a), box(b));
  }
  const linksOf = (doc, set) => doc.links().filter((l) => set.has(doc.byId.get(l.from)) || set.has(doc.byId.get(l.to)));
  // os itens mais os conectores ligados a eles (sem repetir)
  function withLinks(doc, items) {
    const set = new Set(items);
    return items.concat(linksOf(doc, set).filter((l) => !set.has(l)));
  }

  /* --------- trajeto de linhas, setas e conectores (único lugar que cria curvas) --------- */
  const isRoutable = (it) =>
    it.type === 'link' || (it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow'));
  const ELBOW_R = 12; // raio dos cantos do cotovelo
  // amostra uma Bézier cúbica (c2) ou quadrática (c2 nulo) em n passos; devolve [x,y,x,y,...]
  function bezier(p0, c1, c2, p1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        u = 1 - t;
      if (c2) {
        const a = u * u * u,
          b = 3 * u * u * t,
          c = 3 * u * t * t,
          d = t * t * t;
        out.push(a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]);
      } else {
        const a = u * u,
          b = 2 * u * t,
          c = t * t;
        out.push(a * p0[0] + b * c1[0] + c * p1[0], a * p0[1] + b * c1[1] + c * p1[1]);
      }
    }
    return out;
  }
  // cantos do cotovelo: H-V-H (saída lateral) ou V-H-V; `cp` fixa a coordenada do segmento do meio
  function elbowCorners(p0, p1, cp, side) {
    const horiz = side ? side === 'e' || side === 'w' : Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]);
    const m = horiz ? (cp ? cp[0] : (p0[0] + p1[0]) / 2) : cp ? cp[1] : (p0[1] + p1[1]) / 2;
    const raw = horiz ? [p0, [m, p0[1]], [m, p1[1]], p1] : [p0, [p0[0], m], [p1[0], m], p1];
    const out = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const q = out[out.length - 1];
      if (Math.hypot(raw[i][0] - q[0], raw[i][1] - q[1]) > 0.01) out.push(raw[i]);
    }
    return out;
  }
  function roundCorners(pts, r) {
    const out = [pts[0][0], pts[0][1]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1],
        c = pts[i],
        b = pts[i + 1];
      const li = Math.hypot(a[0] - c[0], a[1] - c[1]),
        lo = Math.hypot(b[0] - c[0], b[1] - c[1]),
        rr = Math.min(r, li / 2, lo / 2);
      const pin = [c[0] + ((a[0] - c[0]) / li) * rr, c[1] + ((a[1] - c[1]) / li) * rr],
        pout = [c[0] + ((b[0] - c[0]) / lo) * rr, c[1] + ((b[1] - c[1]) / lo) * rr];
      out.push(...bezier(pin, c, null, pout, 6));
    }
    const l = pts[pts.length - 1];
    out.push(l[0], l[1]);
    return out;
  }
  // Polilinha [x,y,...] de p0 a p1 conforme `it.route` ('curve' | 'elbow' | reto) e `it.cp` (controle livre).
  // `sides` = lados das caixas onde o conector ancora ([lado0, lado1]) para a curva sair perpendicular.
  function routePoints(p0, p1, it, sides) {
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (it.route === 'elbow') return roundCorners(elbowCorners(p0, p1, it.cp, sides && sides[0]), ELBOW_R);
    if (it.cp) return bezier(p0, it.cp, null, p1, 20);
    if (it.route === 'curve' && dist > 0) {
      const dx = (p1[0] - p0[0]) / dist,
        dy = (p1[1] - p0[1]) / dist;
      let c1, c2;
      if (sides && sides[0]) {
        const len = clamp(0.4 * dist, 30, 160),
          n0 = SIDE_DIR[sides[0]],
          n1 = sides[1] ? SIDE_DIR[sides[1]] : [-dx, -dy];
        c1 = [p0[0] + n0[0] * len, p0[1] + n0[1] * len];
        c2 = [p1[0] + n1[0] * len, p1[1] + n1[1] * len];
      } else {
        const off = 0.25 * dist; // sem caixas: S suave em torno do segmento
        c1 = [p0[0] + (dx * dist) / 3 - dy * off, p0[1] + (dy * dist) / 3 + dx * off];
        c2 = [p1[0] - (dx * dist) / 3 + dy * off, p1[1] - (dy * dist) / 3 - dx * off];
      }
      return bezier(p0, c1, c2, p1, 24);
    }
    return [p0[0], p0[1], p1[0], p1[1]];
  }
  function polyMid(pts) {
    let total = 0;
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    let walk = total / 2;
    for (let i = 2; i < pts.length; i += 2) {
      const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      if (l >= walk && l > 0) {
        const t = walk / l;
        return [pts[i - 2] + (pts[i] - pts[i - 2]) * t, pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t];
      }
      walk -= l;
    }
    return [pts[0], pts[1]];
  }
  // posição da alça de edição: meio da polilinha (no cotovelo, meio do segmento do meio)
  function routeMid(p0, p1, it, sides) {
    if (it.route === 'elbow') {
      const c = elbowCorners(p0, p1, it.cp, sides && sides[0]);
      if (c.length >= 4) return [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2];
    }
    return polyMid(routePoints(p0, p1, it, sides));
  }
  // `cp` que faz o trajeto passar por M (alça arrastada): quadrática pelo meio, ou coordenada do cotovelo
  function cpForMid(it, p0, p1, M) {
    return it.route === 'elbow' ? [M[0], M[1]] : [2 * M[0] - (p0[0] + p1[0]) / 2, 2 * M[1] - (p0[1] + p1[1]) / 2];
  }
  // pontas [x0,y0,x1,y1,(lado0,lado1)] do item roteável; `moved` (Set) + dx,dy deslocam as caixas em arrasto
  function itemEnds(it, moved, dx, dy) {
    if (it.type === 'link') return it._doc ? linkPoints(it._doc, it, moved, dx, dy) : null;
    return [it.x, it.y, it.x + it.w, it.y + it.h];
  }
  function itemPath(it, moved, dx, dy) {
    const e = itemEnds(it, moved, dx, dy);
    if (!e) return null;
    // em arrasto, o controle acompanha o conector quando as duas pontas se movem
    if (moved && it.cp && moved.has(it._doc.byId.get(it.from)) && moved.has(it._doc.byId.get(it.to)))
      it = Object.assign({}, it, { cp: [it.cp[0] + dx, it.cp[1] + dy] });
    return routePoints([e[0], e[1]], [e[2], e[3]], it, [e[4], e[5]]);
  }
  // caixa da polilinha (e do ponto de controle) com folga `r`
  function pathBox(pts, cp, r) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const add = (x, y) => {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    };
    for (let i = 0; i < pts.length; i += 2) add(pts[i], pts[i + 1]);
    if (cp) add(cp[0], cp[1]);
    return [x0 - r, y0 - r, x1 + r, y1 + r];
  }
  // caixa do conector a partir do trajeto já calculado (com folga da cabeça de seta)
  const linkBox = (l, path) => pathBox(path, l.cp, l.sw / 2 + (l.head === 'none' ? 1 : arrowLen(l.sw)));
  function hitPolyline(pts, x, y, t) {
    for (let i = 2; i < pts.length; i += 2)
      if (distSeg(x, y, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]) <= t) return true;
    return false;
  }

  function bbox(it) {
    if (it.type === 'link') {
      // sem cache: depende das duas pontas
      const p = itemPath(it);
      return p ? linkBox(it, p) : [0, 0, 0, 0];
    }
    if (it._bb) return it._bb;
    let b;
    switch (it.type) {
      case 'stroke': {
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        const p = it.pts;
        for (let i = 0; i < it.n; i++) {
          const x = p[i * 3],
            y = p[i * 3 + 1];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        const r = strokeHalfW(it) + 1;
        b = [x0 - r, y0 - r, x1 + r, y1 + r];
        break;
      }
      case 'shape': {
        const r = it.sw / 2 + (it.shape === 'arrow' ? 8 + it.sw * 2 : 1);
        if (isRoutable(it)) b = pathBox(itemPath(it), it.cp, r);
        else {
          const [x0, y0, x1, y1] = normRect(it);
          b = [x0 - r, y0 - r, x1 + r, y1 + r];
        }
        break;
      }
      case 'text': {
        if (QL.layoutText) QL.layoutText(it);
        const h = it._h || it.fs * LINE_H * Math.max(1, String(it.text || '').split('\n').length);
        b = [it.x, it.y, it.x + it.w, it.y + h];
        break;
      }
      default: // note, image
        b = normRect(it);
    }
    return (it._bb = b);
  }

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax,
      dy = by - ay,
      l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // tol em unidades de mundo
  function hitItem(it, x, y, tol) {
    const b = bbox(it);
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) return false;
    switch (it.type) {
      case 'stroke': {
        const p = it.pts,
          hw = strokeHalfW(it) + tol;
        if (it.n === 1) return Math.hypot(x - p[0], y - p[1]) <= hw;
        for (let i = 1; i < it.n; i++)
          if (distSeg(x, y, p[(i - 1) * 3], p[(i - 1) * 3 + 1], p[i * 3], p[i * 3 + 1]) <= hw) return true;
        return false;
      }
      case 'shape': {
        const x0 = it.x,
          y0 = it.y,
          x1 = it.x + it.w,
          y1 = it.y + it.h,
          t = tol + it.sw / 2;
        if (isRoutable(it)) return hitPolyline(itemPath(it), x, y, t);
        let edges;
        if (it.shape === 'rect')
          edges = [
            [x0, y0, x1, y0],
            [x1, y0, x1, y1],
            [x1, y1, x0, y1],
            [x0, y1, x0, y0],
          ];
        else if (it.shape === 'diamond') {
          const cx = (x0 + x1) / 2,
            cy = (y0 + y1) / 2;
          edges = [
            [cx, y0, x1, cy],
            [x1, cy, cx, y1],
            [cx, y1, x0, cy],
            [x0, cy, cx, y0],
          ];
        } else if (it.shape === 'triangle') {
          const cx = (x0 + x1) / 2;
          edges = [
            [cx, y0, x1, y1],
            [x1, y1, x0, y1],
            [x0, y1, cx, y0],
          ];
          if (it.fill) {
            // dentro do triângulo (meio-planos)
            const sgn = (ax, ay, bx, by) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
            const d1 = sgn(cx, y0, x1, y1),
              d2 = sgn(x1, y1, x0, y1),
              d3 = sgn(x0, y1, cx, y0);
            if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
          }
        } else {
          // elipse
          const cx = (x0 + x1) / 2,
            cy = (y0 + y1) / 2,
            rx = Math.abs(it.w) / 2 || 1,
            ry = Math.abs(it.h) / 2 || 1;
          const nx = (x - cx) / rx,
            ny = (y - cy) / ry,
            d = Math.hypot(nx, ny);
          if (it.fill && d <= 1) return true;
          return Math.abs(d - 1) * Math.min(rx, ry) <= t;
        }
        if (it.fill) {
          // dentro do retângulo/losango
          if (it.shape === 'rect') return true;
          const cx = (x0 + x1) / 2,
            cy = (y0 + y1) / 2;
          if (Math.abs(x - cx) / (Math.abs(it.w) / 2 || 1) + Math.abs(y - cy) / (Math.abs(it.h) / 2 || 1) <= 1)
            return true;
        }
        for (const e of edges) if (distSeg(x, y, e[0], e[1], e[2], e[3]) <= t) return true;
        return false;
      }
      case 'link': {
        const p = itemPath(it);
        return !!p && hitPolyline(p, x, y, tol + it.sw / 2 + 2);
      }
      default:
        return true; // note, text, image: caixa
    }
  }

  /* ------------------------- grade espacial simples ----------------------- */
  function cellKey(cx, cy) {
    return (cx + 2100) * 4400 + (cy + 2100);
  }
  class Grid {
    constructor() {
      this.m = new Map();
      this.big = new Set();
    }
    _rng(bb) {
      const f = (v) => clamp(Math.floor(v / CELL), -2050, 2050);
      return [f(bb[0]), f(bb[1]), f(bb[2]), f(bb[3])];
    }
    add(it) {
      if (it.type === 'link') return; // conectores não entram na grade
      const r = this._rng(bbox(it));
      if ((r[2] - r[0] + 1) * (r[3] - r[1] + 1) > 300) {
        this.big.add(it);
        it._cells = null;
        return;
      }
      const keys = [];
      for (let y = r[1]; y <= r[3]; y++)
        for (let x = r[0]; x <= r[2]; x++) {
          const k = cellKey(x, y);
          keys.push(k);
          let a = this.m.get(k);
          if (!a) {
            a = [];
            this.m.set(k, a);
          }
          a.push(it);
        }
      it._cells = keys;
    }
    remove(it) {
      if (this.big.delete(it)) return;
      const ks = it._cells;
      if (!ks) return;
      for (const k of ks) {
        const a = this.m.get(k);
        if (!a) continue;
        const i = a.indexOf(it);
        if (i >= 0) {
          a[i] = a[a.length - 1];
          a.pop();
        }
        if (!a.length) this.m.delete(k);
      }
      it._cells = null;
    }
    update(it) {
      this.remove(it);
      this.add(it);
    }
    // itens cuja caixa toca o retângulo [x0,y0,x1,y1], ordenados por z
    query(x0, y0, x1, y1) {
      const r = this._rng([x0, y0, x1, y1]),
        seen = new Set(),
        out = [];
      for (let y = r[1]; y <= r[3]; y++)
        for (let x = r[0]; x <= r[2]; x++) {
          const a = this.m.get(cellKey(x, y));
          if (!a) continue;
          for (let i = 0; i < a.length; i++) {
            const it = a[i];
            if (!seen.has(it)) {
              seen.add(it);
              out.push(it);
            }
          }
        }
      for (const it of this.big) out.push(it);
      const res = [];
      for (const it of out) {
        const b = bbox(it);
        if (b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1) res.push(it);
      }
      res.sort((a, b) => a._z - b._z);
      return res;
    }
  }

  /* -------------------------------- documento ----------------------------- */
  class Doc {
    constructor(data) {
      Object.assign(this, data);
      this.grid = new Grid();
      this.byId = new Map();
      this.onChange = null; // (kind) => void
      this.reindex();
      this._lk = null;
      for (const it of this.items) this._reg(it);
    }
    _reg(it) {
      this.grid.add(it);
      this.byId.set(it.id, it);
      if (it.type === 'link') it._doc = this;
    }
    // conectores, em ordem de z (lista em cache)
    links() {
      return this._lk || (this._lk = this.items.filter((i) => i.type === 'link'));
    }
    reindex() {
      for (let i = 0; i < this.items.length; i++) this.items[i]._z = i;
    }
    _ch(k) {
      if (this.onChange) this.onChange(k);
    }
    insert(items, indices) {
      if (indices) {
        for (let i = 0; i < items.length; i++) this.items.splice(indices[i], 0, items[i]);
        this.reindex();
      } else {
        for (const it of items) {
          it._z = this.items.length;
          this.items.push(it);
        }
      }
      for (const it of items) this._reg(it);
      this._lk = null;
      this._ch('insert');
    }
    removeItems(items) {
      const s = new Set(items);
      this.items = this.items.filter((it) => !s.has(it));
      for (const it of items) {
        this.grid.remove(it);
        this.byId.delete(it.id);
      }
      this.reindex();
      this._lk = null;
      this._ch('remove');
    }
    xform(items, sx, sy, tx, ty) {
      for (const it of items) {
        this.grid.remove(it);
        xformItem(it, sx, sy, tx, ty);
        this.grid.add(it);
      }
      const set = new Set(items);
      for (const l of this.links()) {
        // conector com as duas pontas transformadas leva o ponto de controle junto
        if (l.cp && set.has(this.byId.get(l.from)) && set.has(this.byId.get(l.to)))
          l.cp = [l.cp[0] * sx + tx, l.cp[1] * sy + ty];
      }
      this._ch('xform');
    }
    assign(it, props) {
      this.grid.remove(it);
      Object.assign(it, props);
      touch(it);
      this.grid.add(it);
      this._ch('update');
    }
    setOrder(ids) {
      const out = [];
      for (const id of ids) {
        const it = this.byId.get(id);
        if (it) out.push(it);
      }
      this.items = out;
      this.reindex();
      this._lk = null;
      this._ch('order');
    }
    bounds(items) {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const it of items || this.items) {
        const b = bbox(it);
        if (b[0] < x0) x0 = b[0];
        if (b[1] < y0) y0 = b[1];
        if (b[2] > x1) x1 = b[2];
        if (b[3] > y1) y1 = b[3];
      }
      return x0 === Infinity ? null : [x0, y0, x1, y1];
    }
    // itens sob o ponto, de cima para baixo (conectores são desenhados por cima de tudo)
    *hits(x, y, tol, filter) {
      const L = this.links();
      for (let i = L.length - 1; i >= 0; i--) if ((!filter || filter(L[i])) && hitItem(L[i], x, y, tol)) yield L[i];
      const c = this.grid.query(x - tol, y - tol, x + tol, y + tol);
      for (let i = c.length - 1; i >= 0; i--) if ((!filter || filter(c[i])) && hitItem(c[i], x, y, tol)) yield c[i];
    }
    topHit(x, y, tol, filter) {
      return this.hits(x, y, tol, filter).next().value || null;
    }
    hitStack(x, y, tol, filter) {
      return Array.from(this.hits(x, y, tol, filter));
    }
  }

  /* --------------------- histórico: pilha de comandos --------------------- */
  // Comandos: add, del, upd, xf, ord, batch (com antes/depois, nunca snapshot).
  class History {
    constructor(doc) {
      this.doc = doc;
      this.undoS = [];
      this.redoS = [];
      this.onChange = null;
      this.LIMIT = 500;
    }
    _do(c) {
      const d = this.doc;
      switch (c.t) {
        case 'add':
          d.insert(c.items);
          break;
        case 'del':
          d.removeItems(c.items);
          break;
        case 'upd':
          d.assign(c.item, c.a);
          break;
        case 'xf':
          d.xform(c.items, c.sx, c.sy, c.tx, c.ty);
          if (c.fsa) this._fs(c.items, c.fsa);
          break;
        case 'ord':
          d.setOrder(c.a);
          break;
        case 'batch':
          for (const x of c.cmds) this._do(x);
          break;
      }
    }
    _undo(c) {
      const d = this.doc;
      switch (c.t) {
        case 'add':
          d.removeItems(c.items);
          break;
        case 'del':
          d.insert(c.items, c.idx);
          break;
        case 'upd':
          d.assign(c.item, c.b);
          break;
        case 'xf':
          d.xform(c.items, 1 / c.sx, 1 / c.sy, -c.tx / c.sx, -c.ty / c.sy);
          if (c.fsb) this._fs(c.items, c.fsb);
          break;
        case 'ord':
          d.setOrder(c.b);
          break;
        case 'batch':
          for (let i = c.cmds.length - 1; i >= 0; i--) this._undo(c.cmds[i]);
          break;
      }
    }
    // restaura o tamanho de fonte exato (o max(6, …) do redimensionamento não é invertível)
    _fs(items, arr) {
      for (let i = 0; i < items.length; i++)
        if (arr[i] != null) {
          this.doc.grid.remove(items[i]);
          items[i].fs = arr[i];
          touch(items[i]);
          this.doc.grid.add(items[i]);
        }
      this.doc._ch('xform');
    }
    // registra um comando cujo efeito já foi aplicado
    push(c) {
      this.undoS.push(c);
      if (this.undoS.length > this.LIMIT) this.undoS.shift();
      this.redoS.length = 0;
      this._n();
    }
    exec(c) {
      this._do(c);
      this.push(c);
    }
    undo() {
      const c = this.undoS.pop();
      if (!c) return false;
      this._undo(c);
      this.redoS.push(c);
      this._n();
      return true;
    }
    redo() {
      const c = this.redoS.pop();
      if (!c) return false;
      this._do(c);
      this.undoS.push(c);
      this._n();
      return true;
    }
    _n() {
      if (this.onChange) this.onChange();
    }
  }

  // Ações de alto nível que montam o comando certo
  function cmdAdd(items) {
    return { t: 'add', items };
  }
  function cmdDel(doc, items) {
    // apagar um item leva junto os conectores ligados a ele
    const sorted = withLinks(doc, items).sort((a, b) => a._z - b._z);
    return { t: 'del', items: sorted, idx: sorted.map((i) => i._z) };
  }
  function cmdUpd(item, before, after) {
    return { t: 'upd', item, b: before, a: after };
  }

  Object.assign(QL, {
    APP_VERSION,
    WORLD,
    INK_LIGHT,
    INK_DARK,
    FONTS,
    fontParts,
    UNTITLED,
    EXT,
    isBoardFile,
    fileArgFrom,
    LINE_H,
    arrowLen,
    linkBox,
    MIN_SCALE,
    MAX_SCALE,
    PALETTE,
    FILLS,
    NOTE_COLORS,
    HL_COLORS,
    normRect,
    centerOf,
    anchorOnBox,
    linkEnds,
    isRoutable,
    routePoints,
    routeMid,
    cpForMid,
    itemEnds,
    itemPath,
    linksOf,
    withLinks,
    canLink,
    cloneItems,
    uuid,
    clamp,
    nowIso,
    hashStr,
    PointBuf,
    rdp,
    widthAt,
    outline,
    encodePts,
    decodePts,
    touch,
    serializeItem,
    parseItem,
    newDoc,
    serializeDoc,
    parseDoc,
    xformItem,
    bbox,
    distSeg,
    hitItem,
    Doc,
    History,
    cmdAdd,
    cmdDel,
    cmdUpd,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = QL;
  else root.QL = QL;
})(typeof window !== 'undefined' ? window : globalThis);
