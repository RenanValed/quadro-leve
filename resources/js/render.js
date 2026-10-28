/* ===========================================================================
   Quadro Leve - render.js
   Dois canvases (#static e #live), visão (pan/zoom), desenho dos itens,
   quebra de texto, plano de fundo e exportação.
   =========================================================================== */
(function (root) {
  'use strict';
  const QL = root.QL;
  const { clamp, LINE_H, arrowLen } = QL;

  /* ------------------------------ texto ----------------------------------- */
  let mctx = null;
  function measureCtx() {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    return mctx;
  }
  // string de fonte do canvas a partir do item (única montagem: desenho e medição do wrapText)
  function fontFor(it) {
    const f = QL.fontParts(it);
    return f.style + ' ' + f.weight + ' ' + it.fs + 'px ' + f.family;
  }

  // Quebra por palavra; palavra maior que a largura é quebrada por caractere.
  function wrapText(ctx, text, maxW, font) {
    ctx.font = font;
    const out = [];
    const paras = String(text || '').split('\n');
    for (const para of paras) {
      if (para === '') {
        out.push('');
        continue;
      }
      const words = para.split(/(\s+)/); // mantém os espaços
      let line = '';
      for (let w of words) {
        if (w === '') continue;
        const test = line + w;
        if (ctx.measureText(test).width <= maxW || line === '') {
          if (line === '' && ctx.measureText(w).width > maxW) {
            // palavra gigante
            let chunk = '';
            for (const ch of w) {
              if (ctx.measureText(chunk + ch).width > maxW && chunk) {
                out.push(chunk);
                chunk = ch;
              } else chunk += ch;
            }
            line = chunk;
          } else line = test;
        } else {
          out.push(line.replace(/\s+$/, ''));
          w = w.replace(/^\s+/, '');
          if (ctx.measureText(w).width > maxW) {
            let chunk = '';
            for (const ch of w) {
              if (ctx.measureText(chunk + ch).width > maxW && chunk) {
                out.push(chunk);
                chunk = ch;
              } else chunk += ch;
            }
            line = chunk;
          } else line = w;
        }
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out;
  }

  const NOTE_PAD = 12;
  // Calcula (e guarda em cache) as linhas do item de texto/nota.
  function layoutText(it) {
    const key = [it.text, it.w, it.fs, it.font, it.weight, it.italic].join('|');
    if (it._lk === key && it._lines) return it._lines;
    const inner = it.type === 'note' ? Math.max(10, Math.abs(it.w) - NOTE_PAD * 2) : Math.max(10, Math.abs(it.w));
    it._lines = wrapText(measureCtx(), it.text, inner, fontFor(it));
    it._lk = key;
    it._h = it._lines.length * it.fs * LINE_H + (it.type === 'text' ? 4 : 0);
    if (it.type === 'text') it._bb = null;
    return it._lines;
  }
  QL.layoutText = layoutText;
  QL.NOTE_PAD = NOTE_PAD;

  /* ------------------------------ imagens --------------------------------- */
  const imgCache = new Map(); // assetId -> { img, ok, p }
  // Carrega (uma vez) a imagem do item; `ok` só vira true no onload e `p` resolve ao terminar (bem ou mal).
  function loadImage(it, doc) {
    let e = imgCache.get(it.assetId);
    if (e) return e;
    const src = doc.assets && doc.assets[it.assetId];
    if (!src) return null;
    const img = new Image();
    e = { img, ok: false, p: null };
    e.p = new Promise((res) => {
      img.onload = () => {
        e.ok = true;
        res(e);
      };
      img.onerror = () => res(e);
    });
    imgCache.set(it.assetId, e);
    img.src = src;
    return e;
  }
  function getImage(it, doc, onload) {
    const fresh = !imgCache.has(it.assetId),
      e = loadImage(it, doc);
    if (!e) return null;
    if (fresh && onload) e.p.then(() => e.ok && onload());
    return e.ok ? e.img : null;
  }

  /* ------------------------------ itens ----------------------------------- */
  // caminho suave (quadráticas pelos pontos médios do contorno); usado pelo traço final e pela prévia ao vivo
  function strokePath(pts, n, size, kind) {
    const poly = QL.outline(pts, n, size, kind);
    const p = new Path2D(),
      m = poly.length / 2;
    if (m < 3) {
      if (m > 0) p.arc(poly[0], poly[1], 0.5, 0, 6.2832);
      return p;
    }
    p.moveTo((poly[0] + poly[2]) / 2, (poly[1] + poly[3]) / 2);
    for (let i = 1; i <= m; i++) {
      const a = i % m,
        b = (i + 1) % m;
      p.quadraticCurveTo(
        poly[a * 2],
        poly[a * 2 + 1],
        (poly[a * 2] + poly[b * 2]) / 2,
        (poly[a * 2 + 1] + poly[b * 2 + 1]) / 2
      );
    }
    p.closePath();
    return p;
  }

  function shapePath(ctx, it, route) {
    const x0 = it.x,
      y0 = it.y,
      x1 = it.x + it.w,
      y1 = it.y + it.h;
    ctx.beginPath();
    switch (it.shape) {
      case 'rect': {
        const r = QL.normRect(it);
        ctx.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
        break;
      }
      case 'ellipse':
        ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(it.w) / 2, Math.abs(it.h) / 2, 0, 0, Math.PI * 2);
        break;
      case 'diamond': {
        const cx = (x0 + x1) / 2,
          cy = (y0 + y1) / 2;
        ctx.moveTo(cx, y0);
        ctx.lineTo(x1, cy);
        ctx.lineTo(cx, y1);
        ctx.lineTo(x0, cy);
        ctx.closePath();
        break;
      }
      case 'triangle': {
        const cx = (x0 + x1) / 2;
        ctx.moveTo(cx, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x0, y1);
        ctx.closePath();
        break;
      }
      default:
        tracePath(ctx, route); // line / arrow: trajeto reto, curvo ou em cotovelo
    }
  }

  // traça a polilinha [x,y,...]
  function tracePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }
  // cabeça de seta em (x1,y1), vinda de (x0,y0); usa o strokeStyle do chamador
  function arrowHead(ctx, x0, y0, x1, y1, sw) {
    const a = Math.atan2(y1 - y0, x1 - x0),
      hl = arrowLen(sw);
    ctx.beginPath();
    ctx.moveTo(x1 - hl * Math.cos(a - 0.5), y1 - hl * Math.sin(a - 0.5));
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - hl * Math.cos(a + 0.5), y1 - hl * Math.sin(a + 0.5));
    ctx.stroke();
  }
  // cabeças na tangente do primeiro/último segmento da polilinha: head = 'end' | 'both' | 'none'
  function drawHeads(ctx, pts, sw, head) {
    if (head === 'none') return;
    const n = pts.length;
    let j = n - 4; // último ponto anterior diferente do final (curvas amostradas podem repetir)
    while (j > 0 && pts[j] === pts[n - 2] && pts[j + 1] === pts[n - 1]) j -= 2;
    arrowHead(ctx, pts[j], pts[j + 1], pts[n - 2], pts[n - 1], sw);
    if (head === 'both') {
      let k = 2;
      while (k < n - 2 && pts[k] === pts[0] && pts[k + 1] === pts[1]) k += 2;
      arrowHead(ctx, pts[k], pts[k + 1], pts[0], pts[1], sw);
    }
  }
  // conector pelo trajeto `path` (polilinha de QL.itemPath), com cabeça no fim, nas duas pontas ou nenhuma
  function drawLink(ctx, l, path) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.sw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePath(ctx, path);
    ctx.stroke();
    drawHeads(ctx, path, l.sw, l.head || 'end');
  }
  // passada própria, depois dos itens; vis = retângulo visível (ou null = todos)
  function drawLinks(ctx, doc, vis, skip) {
    for (const l of doc.links()) {
      if (skip && skip.has(l)) continue;
      const path = QL.itemPath(l);
      if (!path) continue;
      if (vis) {
        const b = QL.linkBox(l, path);
        if (b[2] < vis[0] || b[0] > vis[2] || b[3] < vis[1] || b[1] > vis[3]) continue;
      }
      drawLink(ctx, l, path);
    }
  }
  QL.drawLink = drawLink;

  function drawItem(ctx, it, doc, onImgLoad) {
    switch (it.type) {
      case 'stroke': {
        if (!it._path) it._path = strokePath(it.pts, it.n, it.size, it.kind);
        ctx.fillStyle = it.color;
        if (it.kind === 'hl') {
          ctx.globalAlpha = 0.35;
          ctx.fill(it._path);
          ctx.globalAlpha = 1;
        } else ctx.fill(it._path);
        break;
      }
      case 'note': {
        const [x, y, x1, y1] = QL.normRect(it),
          w = x1 - x,
          h = y1 - y;
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x + 3, y + 5, w, h);
        ctx.fillStyle = it.color;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.14)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        if (it.text) {
          const lines = layoutText(it),
            lh = it.fs * LINE_H;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          ctx.font = fontFor(it);
          ctx.fillStyle = '#2b2b2b';
          ctx.textBaseline = 'top';
          for (let i = 0; i < lines.length; i++) {
            const ly = y + NOTE_PAD + i * lh;
            if (ly > y + h) break;
            ctx.fillText(lines[i], x + NOTE_PAD, ly + (lh - it.fs) / 2);
          }
          ctx.restore();
        }
        break;
      }
      case 'text': {
        if (!it.text) break;
        const lines = layoutText(it),
          lh = it.fs * LINE_H;
        ctx.font = fontFor(it);
        ctx.fillStyle = it.color;
        ctx.textBaseline = 'top';
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], it.x, it.y + i * lh + (lh - it.fs) / 2);
        break;
      }
      case 'shape': {
        const route = QL.isRoutable(it) ? QL.itemPath(it) : null;
        shapePath(ctx, it, route);
        if (it.fill && it.shape !== 'line' && it.shape !== 'arrow') {
          ctx.fillStyle = it.fill;
          ctx.fill();
        }
        ctx.strokeStyle = it.stroke;
        ctx.lineWidth = it.sw;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        if (it.shape === 'arrow') drawHeads(ctx, route, it.sw, 'end');
        break;
      }
      case 'link': {
        const path = QL.itemPath(it);
        if (path) drawLink(ctx, it, path);
        break;
      }
      case 'image': {
        const img = getImage(it, doc, onImgLoad);
        const [x, y, x1, y1] = QL.normRect(it),
          w = x1 - x,
          h = y1 - y;
        if (img) ctx.drawImage(img, x, y, w, h);
        else {
          ctx.fillStyle = '#eceff3';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = '#c9ced6';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
        }
        break;
      }
    }
  }
  QL.drawItem = drawItem;
  QL.strokePath = strokePath;

  /* ------------------------------ fundo ----------------------------------- */
  function drawBackground(ctx, bg, view, W, H) {
    // W,H em px CSS; ctx já com escala do DPR
    const dark = R.dark;
    ctx.fillStyle = dark ? '#111111' : '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (bg !== 'grid' && bg !== 'dots') return;
    let step = 32;
    while (step * view.scale < 12) step *= 4;
    const px = step * view.scale;
    const ox = ((view.tx % px) + px) % px,
      oy = ((view.ty % px) + px) % px;
    if (bg === 'grid') {
      ctx.lineWidth = 1;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? (dark ? '#2a2a2a' : '#d5d9df') : dark ? '#1c1c1c' : '#eceef2';
        ctx.beginPath();
        for (let x = ox; x < W; x += px) {
          const major = Math.round((x - view.tx) / px) % 5 === 0;
          if ((pass === 1) !== major) continue;
          const xx = Math.round(x) + 0.5;
          ctx.moveTo(xx, 0);
          ctx.lineTo(xx, H);
        }
        for (let y = oy; y < H; y += px) {
          const major = Math.round((y - view.ty) / px) % 5 === 0;
          if ((pass === 1) !== major) continue;
          const yy = Math.round(y) + 0.5;
          ctx.moveTo(0, yy);
          ctx.lineTo(W, yy);
        }
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = dark ? '#2a2a2a' : '#bfc5cd';
      for (let x = ox; x < W; x += px)
        for (let y = oy; y < H; y += px) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
  }

  /* ------------------------------ renderer -------------------------------- */
  const R = {
    view: { scale: 1, tx: 0, ty: 0 },
    baked: null,
    gest: false,
    settleT: 0,
    dark: false, // tema escuro (definido pelo app)
    need: false,
    needOverlay: false,
    skip: new Set(),
    doc: null,
    dpr: 1,
    W: 0,
    H: 0,
    overlayFn: null,
    onView: null,
    liveActive: false,
    rect: { left: 0, top: 0 },
  };
  QL.R = R;

  R.init = function (stage, stat, live) {
    R.stage = stage;
    R.stat = stat;
    R.live = live;
    R.sctx = stat.getContext('2d', { alpha: false });
    R.lctx = live.getContext('2d', { desynchronized: true });
    R.resize();
  };
  R.setDoc = function (doc) {
    R.doc = doc;
    R.skip.clear();
    imgCache.clear(); // libera as imagens do quadro anterior
  };

  R.resize = function () {
    const r = R.stage.getBoundingClientRect();
    R.rect = r;
    R.dpr = Math.min(root.devicePixelRatio || 1, 2);
    R.W = Math.max(1, Math.round(r.width));
    R.H = Math.max(1, Math.round(r.height));
    for (const c of [R.stat, R.live]) {
      c.width = Math.round(R.W * R.dpr);
      c.height = Math.round(R.H * R.dpr);
      c.style.width = R.W + 'px';
      c.style.height = R.H + 'px';
    }
    R.redrawNow();
    R.drawOverlay();
  };

  R.toWorld = function (cx, cy) {
    return [(cx - R.rect.left - R.view.tx) / R.view.scale, (cy - R.rect.top - R.view.ty) / R.view.scale];
  };
  R.toScreen = function (x, y) {
    return [x * R.view.scale + R.view.tx, y * R.view.scale + R.view.ty];
  };
  // centro da vista em coordenadas de mundo (de `v`, padrão a vista atual)
  R.viewCenter = function (v) {
    v = v || R.view;
    return [(R.W / 2 - v.tx) / v.scale, (R.H / 2 - v.ty) / v.scale];
  };
  R.visible = function (pad) {
    const v = R.view,
      p = pad || 0;
    return [(-v.tx - p) / v.scale, (-v.ty - p) / v.scale, (R.W - v.tx + p) / v.scale, (R.H - v.ty + p) / v.scale];
  };

  function cssTransform() {
    if (!R.gest || !R.baked) {
      R.stat.style.transform = '';
      return;
    }
    const k = R.view.scale / R.baked.scale;
    R.stat.style.transform =
      'translate(' + (R.view.tx - R.baked.tx * k) + 'px,' + (R.view.ty - R.baked.ty * k) + 'px) scale(' + k + ')';
  }

  // Muda só a matriz; o bitmap estático é transformado por CSS durante o gesto.
  R.setView = function (scale, tx, ty) {
    scale = clamp(scale, QL.MIN_SCALE, QL.MAX_SCALE);
    const [cx, cy] = R.viewCenter({ scale, tx, ty }); // centro do mundo
    if (Math.abs(cx) > QL.WORLD) tx = R.W / 2 - clamp(cx, -QL.WORLD, QL.WORLD) * scale;
    if (Math.abs(cy) > QL.WORLD) ty = R.H / 2 - clamp(cy, -QL.WORLD, QL.WORLD) * scale;
    if (!R.gest) {
      R.gest = true;
      R.baked = { scale: R.view.scale, tx: R.view.tx, ty: R.view.ty };
    }
    R.view.scale = scale;
    R.view.tx = tx;
    R.view.ty = ty;
    cssTransform();
    clearTimeout(R.settleT);
    R.settleT = setTimeout(R.settle, 120);
    R.requestOverlay();
    if (R.onView) R.onView();
  };
  R.settle = function () {
    R.settleT = 0;
    R.redrawNow();
  };
  R.zoomAt = function (factor, cx, cy) {
    // cx, cy: px relativos ao palco
    const v = R.view,
      ns = clamp(v.scale * factor, QL.MIN_SCALE, QL.MAX_SCALE),
      k = ns / v.scale;
    R.setView(ns, cx - (cx - v.tx) * k, cy - (cy - v.ty) * k);
  };
  R.panBy = function (dx, dy) {
    R.setView(R.view.scale, R.view.tx + dx, R.view.ty + dy);
  };

  R.redrawNow = function () {
    R.need = false;
    if (R.settleT) {
      clearTimeout(R.settleT);
      R.settleT = 0;
    }
    R.gest = false;
    R.baked = null;
    R.stat.style.transform = '';
    const c = R.sctx,
      d = R.dpr,
      v = R.view,
      doc = R.doc;
    c.setTransform(d, 0, 0, d, 0, 0);
    drawBackground(c, doc ? doc.background : 'grid', v, R.W, R.H);
    if (!doc) return;
    c.setTransform(d * v.scale, 0, 0, d * v.scale, d * v.tx, d * v.ty);
    const vis = R.visible(8);
    const list = doc.grid.query(vis[0], vis[1], vis[2], vis[3]);
    const onImg = R.requestRedraw;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!R.skip.has(it)) drawItem(c, it, doc, onImg);
    }
    drawLinks(c, doc, vis, R.skip);
  };
  R.requestRedraw = function () {
    if (R.need) return;
    R.need = true;
    requestAnimationFrame(R.frame);
  };
  R.requestOverlay = function () {
    if (R.needOverlay) return;
    R.needOverlay = true;
    requestAnimationFrame(R.frame);
  };
  R.frame = function () {
    if (R.need) R.redrawNow();
    if (R.needOverlay) {
      R.needOverlay = false;
      R.drawOverlay();
    }
  };
  // desenha um item novo direto no estático (sem redesenhar tudo)
  R.drawItemStatic = function (it) {
    if (R.gest) {
      R.redrawNow();
      return;
    }
    const c = R.sctx,
      d = R.dpr,
      v = R.view;
    c.setTransform(d * v.scale, 0, 0, d * v.scale, d * v.tx, d * v.ty);
    drawItem(c, it, R.doc, R.requestRedraw);
    if (it.type !== 'link' && R.doc.links().length) drawLinks(c, R.doc, QL.bbox(it), R.skip); // conectores seguem por cima
  };
  R.clearLive = function () {
    R.lctx.setTransform(1, 0, 0, 1, 0, 0);
    R.lctx.clearRect(0, 0, R.live.width, R.live.height);
  };
  R.drawOverlay = function () {
    R.needOverlay = false;
    if (R.liveActive) return;
    R.clearLive();
    if (R.overlayFn) {
      const c = R.lctx,
        d = R.dpr;
      c.setTransform(d, 0, 0, d, 0, 0);
      R.overlayFn(c, R.view);
    }
  };

  /* ------------------------------ exportação ------------------------------ */
  // Fundo branco, todos os itens; lado máximo 8192 px e teto de área p/ poupar RAM.
  R.exportPNG = async function (doc) {
    const b = doc.bounds();
    if (!b) return null;
    const pad = 40,
      w = b[2] - b[0] + pad * 2,
      h = b[3] - b[1] + pad * 2;
    const MAXSIDE = 8192,
      MAXAREA = 16e6;
    let s = Math.min(2, Math.max(1, 1600 / Math.max(w, h)));
    let reduced = false;
    if (Math.max(w, h) * s > MAXSIDE) {
      s = MAXSIDE / Math.max(w, h);
      reduced = true;
    }
    if (w * s * h * s > MAXAREA) {
      s = Math.sqrt(MAXAREA / (w * h));
      reduced = true;
    }
    // garante que as imagens terminaram de carregar antes de desenhar
    await Promise.all(doc.items.filter((it) => it.type === 'image').map((it) => loadImage(it, doc)?.p));
    const cw = Math.max(1, Math.round(w * s)),
      ch = Math.max(1, Math.round(h * s));
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const c = cv.getContext('2d');
    c.fillStyle = R.dark ? '#111111' : '#fff'; // o fundo da exportação segue o tema
    c.fillRect(0, 0, cw, ch);
    c.setTransform(s, 0, 0, s, (-b[0] + pad) * s, (-b[1] + pad) * s);
    for (const it of doc.items) if (it.type !== 'link') drawItem(c, it, doc, null);
    drawLinks(c, doc, null, null);
    return new Promise((resolve, reject) => {
      cv.toBlob((blob) => {
        cv.width = cv.height = 1;
        blob ? resolve({ blob, w: cw, h: ch, reduced }) : reject(new Error('toBlob falhou'));
      }, 'image/png');
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
