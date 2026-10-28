/* ===========================================================================
   Quadro Leve - tools.js
   Entrada de caneta/mouse (Pointer Events), ferramentas, seleção, edição de
   texto (um <textarea> flutuante), área de transferência e imagens.
   =========================================================================== */
(function (root) {
  'use strict';
  const QL = root.QL,
    R = QL.R;
  const { clamp, NOTE_COLORS, HL_COLORS } = QL;

  const CURSORS = {
    select: 'default',
    pen: 'crosshair',
    hl: 'crosshair',
    eraser: 'cell',
    note: 'copy',
    text: 'text',
    shape: 'crosshair',
    link: 'crosshair',
    hand: 'grab',
  };
  const ACCENT = '#2f7df6';

  const S = (QL.S = {
    doc: null,
    hist: null,
    tool: 'pen',
    slot: 0,
    slots: [
      { color: '#1a1a1a', size: 3 },
      { color: '#e03131', size: 3 },
      { color: '#1971c2', size: 6 },
    ],
    hl: { color: HL_COLORS[0], size: 18 },
    shape: { type: 'rect', stroke: '#1a1a1a', fill: null, sw: 3 },
    link: { color: '#1a1a1a', sw: 2, head: 'end', route: 'straight' },
    noteColor: NOTE_COLORS[0],
    text: { color: '#1a1a1a', fs: 24 },
    sel: [],
    clip: [],
    pasteN: 0,
    space: false,
    penSeen: 0,
    penMouseMode: false,
    straighten: 'mid', // nível de correção do traço (menu Exibir)
    quiet: false,
    cb: {}, // cb: dirty, tool, sel, toast, status
  });
  let lastCreate = null;
  let G = null; // gesto em andamento
  let E = null; // edição de texto em andamento
  let stage, ta;
  const T = (QL.T = {});

  /* ------------------------------ helpers --------------------------------- */
  const penActive = () => S.penSeen && performance.now() - S.penSeen < 2500;
  const cb = (n, a) => {
    if (S.cb[n]) S.cb[n](a);
  };

  T.setDoc = function (d, hist) {
    commitEdit();
    S.doc = d;
    S.hist = hist;
    S.sel = [];
    G = null;
    R.liveActive = false;
    hist.onChange = () => cb('dirty');
    R.setDoc(d);
  };
  T.setTool = function (t) {
    if (t === S.tool) return;
    commitEdit();
    S.tool = t;
    if (t !== 'select') setSel([]);
    T.refreshCursor();
    R.requestOverlay();
    cb('tool', t);
  };
  T.setSpace = function (on) {
    S.space = on;
    if (on) stage.style.cursor = 'grab';
    else T.refreshCursor();
  };
  T.slotSelect = function (i) {
    S.slot = i;
    if (S.tool !== 'pen') T.setTool('pen');
    cb('tool', 'pen');
  };

  function setSel(arr) {
    S.sel = arr;
    R.requestOverlay();
    cb('sel', arr);
  }
  T.setSel = setSel;
  T.selectAll = function () {
    if (!S.doc) return;
    T.setTool('select');
    setSel(S.doc.items.slice());
  };

  function addItems(items) {
    S.quiet = true;
    S.hist.exec(QL.cmdAdd(items));
    S.quiet = false;
    for (const it of items) R.drawItemStatic(it);
    R.requestOverlay();
  }
  T.addItems = addItems;
  T.quietly = function (fn) {
    S.quiet = true;
    try {
      fn();
    } finally {
      S.quiet = false;
    }
  };

  /* ------------------------------ seleção --------------------------------- */
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  // caixa dos itens selecionados (conectores não têm alças: a geometria sai das pontas)
  function selBox() {
    const mv = S.sel.filter((i) => i.type !== 'link');
    return mv.length ? S.doc.bounds(mv) : null;
  }
  function handlePos(b, h) {
    const x = h.includes('w') ? b[0] : h.includes('e') ? b[2] : (b[0] + b[2]) / 2;
    const y = h.includes('n') ? b[1] : h.includes('s') ? b[3] : (b[1] + b[3]) / 2;
    return [x, y];
  }
  function hitHandle(cx, cy) {
    const b = selBox();
    if (!b) return null;
    const px = cx - R.rect.left,
      py = cy - R.rect.top;
    for (const h of HANDLES) {
      const [wx, wy] = handlePos(b, h),
        [sx, sy] = R.toScreen(wx, wy);
      if (Math.abs(px - sx) <= 8 && Math.abs(py - sy) <= 8) return h;
    }
    return null;
  }
  const HCURSOR = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
  };

  // alça de trajeto do único item roteável selecionado (pv = versão em prévia durante o arrasto)
  function routeHandle(pv) {
    if (S.sel.length !== 1 || !QL.isRoutable(S.sel[0])) return null;
    const it = S.sel[0],
      e = QL.itemEnds(it);
    if (!e) return null;
    const p0 = [e[0], e[1]],
      p1 = [e[2], e[3]],
      sides = [e[4], e[5]];
    return { it, p0, p1, pos: QL.routeMid(p0, p1, pv || it, sides) };
  }
  function hitRouteHandle(cx, cy) {
    const rh = routeHandle();
    if (!rh) return null;
    const [sx, sy] = R.toScreen(rh.pos[0], rh.pos[1]);
    return Math.hypot(cx - R.rect.left - sx, cy - R.rect.top - sy) <= 9 ? rh : null;
  }

  function overlay(c, v) {
    const d = S.doc;
    if (!d) return;
    const dragging = G && G.mode === 'move' && G.moved,
      ox = dragging ? G.mx * v.scale : 0,
      oy = dragging ? G.my * v.scale : 0;
    if (dragging) {
      const vis = R.visible(8);
      c.save();
      c.translate(v.tx + ox, v.ty + oy);
      c.scale(v.scale, v.scale);
      for (const it of G.drag) {
        const b = QL.bbox(it);
        if (b[2] + G.mx >= vis[0] && b[0] + G.mx <= vis[2] && b[3] + G.my >= vis[1] && b[1] + G.my <= vis[3])
          QL.drawItem(c, it, d);
      }
      c.restore();
      c.save();
      c.translate(v.tx, v.ty);
      c.scale(v.scale, v.scale); // conectores ligados: ponta deslocada
      for (const l of G.dragLinks) {
        const path = QL.itemPath(l, G.dragSet, G.mx, G.my);
        if (path) QL.drawLink(c, l, path);
      }
      c.restore();
    }
    if (S.sel.length) {
      c.lineWidth = 1;
      c.strokeStyle = ACCENT;
      const lim = Math.min(S.sel.length, 300);
      for (let i = 0; i < lim; i++) {
        const it = S.sel[i];
        if (it.type === 'link') {
          // destaca a própria linha
          const p = QL.itemPath(it, dragging && G.dragSet, dragging ? G.mx : 0, dragging ? G.my : 0);
          if (!p) continue;
          c.save();
          c.lineWidth = it.sw * v.scale + 6;
          c.globalAlpha = 0.3;
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.beginPath();
          for (let k = 0; k < p.length; k += 2)
            c[k ? 'lineTo' : 'moveTo'](p[k] * v.scale + v.tx, p[k + 1] * v.scale + v.ty);
          c.stroke();
          c.restore();
          continue;
        }
        const b = QL.bbox(it);
        c.strokeRect(
          b[0] * v.scale + v.tx + ox + 0.5,
          b[1] * v.scale + v.ty + oy + 0.5,
          (b[2] - b[0]) * v.scale,
          (b[3] - b[1]) * v.scale
        );
      }
      const b = S.tool === 'select' && selBox();
      if (b) {
        const x0 = b[0] * v.scale + v.tx + ox,
          y0 = b[1] * v.scale + v.ty + oy,
          x1 = b[2] * v.scale + v.tx + ox,
          y1 = b[3] * v.scale + v.ty + oy;
        c.setLineDash([5, 4]);
        c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
        c.setLineDash([]);
        c.fillStyle = '#fff';
        for (const h of HANDLES) {
          const p = handlePos(b, h),
            sx = p[0] * v.scale + v.tx + ox,
            sy = p[1] * v.scale + v.ty + oy;
          c.fillRect(sx - 4, sy - 4, 8, 8);
          c.strokeRect(sx - 3.5, sy - 3.5, 7, 7);
        }
      }
    }
    if (G && G.mode === 'link' && G.from) {
      // prévia do conector: âncora do item de origem até o cursor/destino
      c.save();
      c.translate(v.tx, v.ty);
      c.scale(v.scale, v.scale);
      c.strokeStyle = ACCENT;
      c.lineWidth = 2 / v.scale;
      const fb = QL.bbox(G.from),
        tb = G.target && QL.bbox(G.target);
      for (const b of [fb, tb]) if (b) c.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      let e;
      if (tb) e = QL.linkEnds(fb, tb);
      else {
        const a = QL.anchorOnBox(fb, G.x1, G.y1);
        e = [a[0], a[1], G.x1, G.y1, a[2]];
      }
      QL.drawLink(c, S.link, QL.routePoints([e[0], e[1]], [e[2], e[3]], S.link, [e[4], e[5]]));
      c.restore();
    }
    if (G && G.mode === 'cp') {
      // prévia do trajeto enquanto a alça é arrastada
      c.save();
      c.translate(v.tx, v.ty);
      c.scale(v.scale, v.scale);
      QL.drawItem(c, G.pv, d);
      c.restore();
    }
    const rh = S.tool === 'select' && routeHandle(G && G.mode === 'cp' ? G.pv : null);
    if (rh) {
      // alça redonda no meio do trajeto de linha / seta / conector selecionado
      const [hx, hy] = R.toScreen(rh.pos[0], rh.pos[1]);
      c.beginPath();
      c.arc(hx, hy, 6, 0, Math.PI * 2);
      c.fillStyle = '#fff';
      c.fill();
      c.strokeStyle = ACCENT;
      c.lineWidth = 2;
      c.stroke();
    }
    if (G && G.mode === 'marquee') {
      const x0 = Math.min(G.x0, G.x1) * v.scale + v.tx,
        y0 = Math.min(G.y0, G.y1) * v.scale + v.ty;
      const w = Math.abs(G.x1 - G.x0) * v.scale,
        h = Math.abs(G.y1 - G.y0) * v.scale;
      c.fillStyle = 'rgba(47,125,246,0.08)';
      c.fillRect(x0, y0, w, h);
      c.strokeStyle = ACCENT;
      c.strokeRect(x0 + 0.5, y0 + 0.5, w, h);
    }
    if (G && G.preview) {
      c.save();
      c.translate(v.tx, v.ty);
      c.scale(v.scale, v.scale);
      QL.drawItem(c, G.preview, d);
      c.restore();
    }
  }
  R.overlayFn = overlay;

  /* ------------------------------ ponteiro -------------------------------- */
  function attach(stageEl, editorEl) {
    stage = stageEl;
    ta = editorEl;
    stage.style.touchAction = 'none';
    T.refreshCursor();
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'pen') S.penSeen = performance.now() - 2000;
    });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('dblclick', onDbl);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dragover', (e) => e.preventDefault());
    stage.addEventListener('drop', onDrop);
    ta.addEventListener('blur', () => commitEdit());
    ta.addEventListener('input', () => {
      if (E && E.it.type === 'text') growEditor();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        commitEdit();
      }
      e.stopPropagation();
    });
    R.onView = positionEditor;
  }
  T.attach = attach;
  T.refreshCursor = function () {
    stage.style.cursor = CURSORS[S.tool] || 'default';
  };

  // trava a direção de (ox,oy) até (x,y) em passos de 15° (relativos ao ângulo `base`)
  const ANGLE_STEP = Math.PI / 12;
  function snapAngle(ox, oy, x, y, base = 0) {
    const l = Math.hypot(x - ox, y - oy),
      a = base + Math.round((Math.atan2(y - oy, x - ox) - base) / ANGLE_STEP) * ANGLE_STEP;
    return [ox + Math.cos(a) * l, oy + Math.sin(a) * l];
  }
  // lembra que a caneta está por perto (rejeição de palma) e que o navegador entrega 'pen' (Windows Ink)
  function notePen(e) {
    if (e.pointerType !== 'pen') return;
    S.penSeen = performance.now();
    S.sawPen = true;
  }
  const onCanvas = (e) => e.target === stage || (e.target && e.target.tagName === 'CANVAS');
  function onDown(e) {
    if (!S.doc) return;
    if (!onCanvas(e)) return; // clique em botão/barra: deixa o DOM tratar
    notePen(e);
    if (e.pointerType === 'touch' && penActive()) return; // palma
    if (
      (S.tool === 'note' || S.tool === 'text') &&
      lastCreate &&
      performance.now() - lastCreate.t < 300 &&
      Math.hypot(e.clientX - lastCreate.x, e.clientY - lastCreate.y) < 8
    )
      return; // clique duplo não cria duas
    if (G) return; // um gesto por vez
    if (E) commitEdit();
    R.rect = stage.getBoundingClientRect();
    const isPen = e.pointerType === 'pen';
    let mode;
    if (
      e.button === 1 ||
      S.space ||
      S.tool === 'hand' ||
      (isPen && (e.button === 2 || e.buttons & 2)) ||
      (!isPen && e.button === 2)
    )
      mode = 'pan';
    else if (e.buttons & 32 || e.button === 5) mode = 'eraser';
    else if (e.button !== 0) return;
    else mode = S.tool;
    e.preventDefault();
    try {
      stage.setPointerCapture(e.pointerId);
    } catch (x) {
      /* ok */
    }
    const [wx, wy] = R.toWorld(e.clientX, e.clientY);
    const sc = R.view.scale;
    G = {
      mode,
      id: e.pointerId,
      ptype: e.pointerType,
      sx: e.clientX,
      sy: e.clientY,
      x0: wx,
      y0: wy,
      x1: wx,
      y1: wy,
      tx: R.view.tx,
      ty: R.view.ty,
      moved: false,
    };
    switch (mode) {
      case 'pan':
        stage.style.cursor = 'grabbing';
        break;
      case 'pen':
      case 'hl':
        startStroke(e, mode);
        break;
      case 'eraser':
        G.erased = new Set();
        G.lx = wx;
        G.ly = wy;
        eraseAt(wx, wy, wx, wy);
        break;
      case 'select': {
        const rh = hitRouteHandle(e.clientX, e.clientY);
        if (rh) {
          G.mode = 'cp';
          G.rh = rh;
          G.pv = rh.it;
          R.skip.add(rh.it); // o item sai do estático; a prévia é desenhada no overlay
          R.requestRedraw();
          break;
        }
        const h = hitHandle(e.clientX, e.clientY);
        if (h) {
          G.mode = 'resize';
          G.fsb = S.sel.map((i) => i.fs);
          G.h = h;
          G.b0 = selBox();
          G.cur = G.b0.slice();
          G.ts = [1, 1, 0, 0];
          G.lw = wx;
          break;
        }
        // Ctrl: percorre a pilha de itens sob o cursor (a seleção só muda ao arrastar ou ao soltar)
        const stack = (e.ctrlKey || e.metaKey) && !e.shiftKey ? S.doc.hitStack(wx, wy, 6 / sc) : null;
        const hit = stack ? stack[0] : S.doc.topHit(wx, wy, 6 / sc);
        if (hit) {
          if (stack) G.ctrl = stack;
          else if (e.shiftKey) {
            if (S.sel.includes(hit)) {
              G.toggleOff = hit;
            } else setSel(S.sel.concat(hit));
          } else if (!S.sel.includes(hit)) setSel([hit]);
          G.mode = 'move';
          G.alt = e.altKey;
          G.mx = 0;
          G.my = 0;
        } else {
          if (!e.shiftKey) setSel([]);
          G.mode = 'marquee';
          G.add = e.shiftKey ? S.sel.slice() : [];
        }
        break;
      }
      case 'shape':
        G.preview = null;
        break;
      case 'link':
        G.from = S.doc.topHit(wx, wy, 6 / sc, QL.canLink);
        G.target = null;
        break;
      case 'note':
      case 'text':
        break;
    }
  }

  function onMove(e) {
    notePen(e);
    if (!G || e.pointerId !== G.id) {
      if (!G && S.tool === 'select' && S.sel.length && e.buttons === 0) {
        // cursor das alças
        const h = hitHandle(e.clientX, e.clientY);
        stage.style.cursor = hitRouteHandle(e.clientX, e.clientY) ? 'pointer' : h ? HCURSOR[h] : CURSORS.select;
      }
      return; // sem gesto: só o cursor das alças; hover de caneta (buttons === 0) não desenha
    }
    if (e.buttons === 0 && G.mode !== 'pan') return;
    if (G.mode === 'pen' || G.mode === 'hl') {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (evs && evs.length) for (let i = 0; i < evs.length; i++) strokePoint(evs[i]);
      else strokePoint(e);
      return;
    }
    const [wx, wy] = R.toWorld(e.clientX, e.clientY);
    switch (G.mode) {
      case 'pan':
        R.setView(R.view.scale, G.tx + (e.clientX - G.sx), G.ty + (e.clientY - G.sy));
        break;
      case 'eraser':
        eraseAt(G.lx, G.ly, wx, wy);
        G.lx = wx;
        G.ly = wy;
        break;
      case 'cp': {
        const { it, p0, p1 } = G.rh;
        let M = [wx, wy];
        if (e.shiftKey && it.route !== 'elbow') {
          // trava em passos de 15° em relação ao segmento reto
          const m0 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          M = snapAngle(m0[0], m0[1], wx, wy, Math.atan2(p1[1] - p0[1], p1[0] - p0[0]));
        }
        G.pv = Object.assign({}, it, { cp: QL.cpForMid(it, p0, p1, M) });
        R.requestOverlay();
        break;
      }
      case 'move': {
        if (!G.moved && Math.hypot(e.clientX - G.sx, e.clientY - G.sy) < 3) return;
        if (!G.moved) {
          if (G.ctrl) setSel([G.ctrl[0]]); // Ctrl+arrastar: só o item sob o cursor, ignorando o grupo
          if (G.alt) {
            // Alt+arrastar: a cópia nasce no lugar e é ela que se move (um comando add+xf ao soltar)
            G.dup = QL.cloneItems(
              S.sel.slice().sort((a, b) => a._z - b._z),
              0,
              0
            );
            T.quietly(() => S.doc.insert(G.dup));
            setSel(G.dup);
          }
          // prévia: itens (e conectores ligados) saem do estático e são desenhados deslocados no overlay
          const mv = S.sel.filter((i) => i.type !== 'link');
          if (!mv.length) return; // só conectores selecionados: nada a mover
          G.moved = true;
          G.drag = mv;
          G.dragSet = new Set(mv);
          G.dragLinks = QL.linksOf(S.doc, G.dragSet);
          for (const it of G.drag.concat(G.dragLinks)) R.skip.add(it);
          R.requestRedraw();
        }
        G.mx = wx - G.x0;
        G.my = wy - G.y0;
        if (e.shiftKey) {
          // Shift: trava no eixo dominante
          if (Math.abs(G.mx) >= Math.abs(G.my)) G.my = 0;
          else G.mx = 0;
        }
        R.requestOverlay();
        break;
      }
      case 'resize':
        doResize(wx, wy, e.shiftKey, e.altKey);
        break;
      case 'marquee':
        G.x1 = wx;
        G.y1 = wy;
        R.requestOverlay();
        break;
      case 'shape': {
        G.x1 = wx;
        G.y1 = wy;
        let w = wx - G.x0,
          h = wy - G.y0;
        const t = S.shape.type;
        if (e.shiftKey) {
          // linha / seta: ângulo em passos de 15°; formas: quadrado / círculo
          if (t === 'line' || t === 'arrow') [w, h] = snapAngle(0, 0, w, h);
          else {
            const m = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * m;
            h = Math.sign(h || 1) * m;
          }
        }
        // Alt: a partir do centro (o ponto inicial é o centro)
        const c = e.altKey ? { x: G.x0 - w, y: G.y0 - h, w: 2 * w, h: 2 * h } : { x: G.x0, y: G.y0, w, h };
        G.preview = {
          type: 'shape',
          shape: t,
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          stroke: S.shape.stroke,
          fill: S.shape.fill,
          sw: S.shape.sw,
        };
        R.requestOverlay();
        break;
      }
      case 'note':
      case 'text':
        G.x1 = wx;
        G.y1 = wy;
        break;
      case 'link':
        G.x1 = wx;
        G.y1 = wy;
        G.target = G.from && S.doc.topHit(wx, wy, 6 / R.view.scale, linkTarget(G.from));
        if (e.shiftKey && G.from && !G.target) {
          // ponta livre: ângulo travado em passos de 15° a partir do centro do item de origem
          const c = QL.centerOf(QL.bbox(G.from));
          [G.x1, G.y1] = snapAngle(c[0], c[1], wx, wy);
        }
        R.requestOverlay();
        break;
    }
  }
  const linkTarget = (from) => (it) => it !== from && QL.canLink(it);

  function onUp(e) {
    if (!G || e.pointerId !== G.id) return;
    const g = G;
    G = null;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch (x) {
      /* ok */
    }
    const [wx, wy] = R.toWorld(e.clientX, e.clientY);
    switch (g.mode) {
      case 'pan':
        T.refreshCursor();
        break;
      case 'pen':
      case 'hl':
        endStroke(g);
        break;
      case 'eraser':
        endErase(g);
        break;
      case 'move':
        if (g.moved) {
          for (const it of g.drag.concat(g.dragLinks)) R.skip.delete(it);
          S.doc.xform(g.drag, 1, 1, g.mx, g.my);
          const xf = { t: 'xf', items: g.drag, sx: 1, sy: 1, tx: g.mx, ty: g.my };
          S.hist.push(g.dup ? { t: 'batch', cmds: [{ t: 'add', items: g.dup }, xf] } : xf);
          R.requestRedraw();
          R.requestOverlay();
        } else if (g.ctrl) {
          // Ctrl+clique: seleciona o próximo item da pilha (o que está abaixo do selecionado)
          const i = S.sel.length === 1 ? g.ctrl.indexOf(S.sel[0]) : -1;
          setSel([g.ctrl[(i + 1) % g.ctrl.length]]);
        } else if (g.toggleOff) setSel(S.sel.filter((i) => i !== g.toggleOff));
        break;
      case 'resize': {
        const [sx, sy, tx, ty] = g.ts;
        if (sx !== 1 || sy !== 1 || tx !== 0 || ty !== 0)
          S.hist.push({
            t: 'xf',
            items: S.sel.slice(),
            sx: g.tsx,
            sy: g.tsy,
            tx: g.ttx,
            ty: g.tty,
            fsb: g.fsb,
            fsa: S.sel.map((i) => i.fs),
          });
        break;
      }
      case 'marquee': {
        const x0 = Math.min(g.x0, wx),
          x1 = Math.max(g.x0, wx),
          y0 = Math.min(g.y0, wy),
          y1 = Math.max(g.y0, wy);
        if ((x1 - x0) * R.view.scale > 3 || (y1 - y0) * R.view.scale > 3) {
          const hits = S.doc.grid.query(x0, y0, x1, y1);
          const set = new Set(g.add);
          for (const it of hits) set.add(it);
          for (const l of S.doc.links())
            if (set.has(S.doc.byId.get(l.from)) && set.has(S.doc.byId.get(l.to))) set.add(l);
          setSel(S.doc.items.filter((it) => set.has(it)));
        }
        R.requestOverlay();
        break;
      }
      case 'shape': {
        const p = g.preview;
        R.requestOverlay();
        if (p && Math.hypot(p.w, p.h) * R.view.scale >= 4) {
          const it = Object.assign({ id: QL.uuid() }, p);
          addItems([it]);
        }
        break;
      }
      case 'cp': {
        R.skip.delete(g.rh.it);
        if (g.pv !== g.rh.it) S.hist.exec(QL.cmdUpd(g.rh.it, { cp: g.rh.it.cp }, { cp: g.pv.cp }));
        R.requestRedraw();
        R.requestOverlay();
        break;
      }
      case 'link': {
        // cria o conector se soltou sobre outro item e o par ainda não existe
        R.requestOverlay();
        const tgt = g.from && S.doc.topHit(wx, wy, 6 / R.view.scale, linkTarget(g.from));
        if (tgt && !S.doc.links().some((l) => l.from === g.from.id && l.to === tgt.id)) {
          addItems([
            {
              id: QL.uuid(),
              type: 'link',
              from: g.from.id,
              to: tgt.id,
              color: S.link.color,
              sw: S.link.sw,
              head: S.link.head,
              ...(S.link.route !== 'straight' && { route: S.link.route }),
            },
          ]);
        }
        break;
      }
      case 'note':
      case 'text': {
        lastCreate = { t: performance.now(), x: e.clientX, y: e.clientY }; // para ignorar o 2º clique de um duplo clique
        const it =
          g.mode === 'note'
            ? {
                id: QL.uuid(),
                type: 'note',
                x: wx - 110,
                y: wy - 110,
                w: 220,
                h: 220,
                color: S.noteColor,
                text: '',
                fs: 22,
              }
            : newText(
                Math.min(g.x0, wx),
                g.y0,
                Math.abs(wx - g.x0) * R.view.scale > 24 ? Math.abs(wx - g.x0) : 360,
                ''
              );
        startEdit(it, true);
        break;
      }
    }
  }

  // item de texto livre com o estilo atual da barra
  // (fonte, negrito e itálico só entram no item quando diferem do padrão)
  const newText = (x, y, w, text) =>
    Object.assign(
      { id: QL.uuid(), type: 'text', x, y, w, text, color: S.text.color, fs: S.text.fs },
      ...['font', 'weight', 'italic'].map((k) => S.text[k] && { [k]: S.text[k] })
    );

  function doResize(wx, wy, shift, alt) {
    const b0 = G.b0,
      c = G.cur,
      h = G.h,
      MIN = 4;
    let x0 = c[0],
      y0 = c[1],
      x1 = c[2],
      y1 = c[3];
    if (h.includes('w')) x0 = Math.min(wx, c[2] - MIN);
    if (h.includes('e')) x1 = Math.max(wx, c[0] + MIN);
    if (h.includes('n')) y0 = Math.min(wy, c[3] - MIN);
    if (h.includes('s')) y1 = Math.max(wy, c[1] + MIN);
    const ow = b0[2] - b0[0],
      oh = b0[3] - b0[1],
      cx = (b0[0] + b0[2]) / 2,
      cy = (b0[1] + b0[3]) / 2;
    if (alt) {
      // Alt: a partir do centro, a caixa cresce para os dois lados
      if (h.includes('e') || h.includes('w')) {
        const hw = Math.max(MIN / 2, Math.abs(wx - cx));
        x0 = cx - hw;
        x1 = cx + hw;
      }
      if (h.includes('n') || h.includes('s')) {
        const hh = Math.max(MIN / 2, Math.abs(wy - cy));
        y0 = cy - hh;
        y1 = cy + hh;
      }
    }
    if (shift && h.length === 2) {
      // proporção da caixa original (a partir do canto oposto, ou do centro com Alt)
      const fw = (alt ? x1 - x0 : h.includes('e') ? x1 - b0[0] : b0[2] - x0) / ow,
        fh = (alt ? y1 - y0 : h.includes('s') ? y1 - b0[1] : b0[3] - y0) / oh;
      const f = Math.max(fw, fh, MIN / Math.min(ow, oh));
      if (alt) {
        x0 = cx - (ow * f) / 2;
        x1 = cx + (ow * f) / 2;
        y0 = cy - (oh * f) / 2;
        y1 = cy + (oh * f) / 2;
      } else {
        if (h.includes('e')) x1 = b0[0] + ow * f;
        else x0 = b0[2] - ow * f;
        if (h.includes('s')) y1 = b0[1] + oh * f;
        else y0 = b0[3] - oh * f;
      }
    }
    const sx = (x1 - x0) / (c[2] - c[0]),
      sy = (y1 - y0) / (c[3] - c[1]);
    const tx = x0 - c[0] * sx,
      ty = y0 - c[1] * sy;
    if (sx === 1 && sy === 1 && tx === 0 && ty === 0) return;
    S.doc.xform(S.sel, sx, sy, tx, ty);
    // acumula a composição das transformações
    G.tsx = (G.tsx || 1) * sx;
    G.tsy = (G.tsy || 1) * sy;
    G.ttx = (G.ttx || 0) * sx + tx;
    G.tty = (G.tty || 0) * sy + ty;
    G.ts = [G.tsx, G.tsy, G.ttx, G.tty];
    G.cur = [x0, y0, x1, y1];
  }

  function onWheel(e) {
    if (!onCanvas(e)) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    R.rect = r;
    const k = e.deltaMode === 1 ? 16 : 1,
      dy = e.deltaY * k,
      dx = e.deltaX * k;
    if (e.ctrlKey || e.metaKey || e.altKey)
      R.zoomAt(Math.exp(-dy * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    else if (e.shiftKey) R.panBy(-(dy || dx), 0);
    else R.panBy(-dx, -dy);
  }

  function onDbl(e) {
    if (!S.doc || !onCanvas(e)) return;
    R.rect = stage.getBoundingClientRect();
    const rh = S.tool === 'select' && hitRouteHandle(e.clientX, e.clientY);
    if (rh) {
      // clique duplo na alça: volta ao trajeto automático
      if (rh.it.cp) S.hist.exec(QL.cmdUpd(rh.it, { cp: rh.it.cp }, { cp: undefined }));
      return;
    }
    const [wx, wy] = R.toWorld(e.clientX, e.clientY);
    const hit = S.doc.topHit(wx, wy, 4 / R.view.scale, (i) => i.type === 'note' || i.type === 'text');
    if (hit && (S.tool === 'select' || e.pointerType === 'mouse' || e.pointerType === undefined)) {
      setSel([hit]);
      startEdit(hit, false);
    }
  }

  /* ------------------------------ traço ----------------------------------- */
  // Correção do traço (menu Exibir): UMA tabela concentra os efeitos
  //  holdMs  - parado por esse tempo, o traço em andamento vira reta (null = nunca)
  //  snapTol - ao soltar, desvio máximo / corda abaixo disso vira reta de 2 pontos (null = nunca)
  //  alpha   - filtro exponencial da entrada, antes de ir para o buffer (1 = sem filtro)
  const STRAIGHTEN = {
    off: { holdMs: null, snapTol: null, alpha: 1 },
    low: { holdMs: 1500, snapTol: 0.02, alpha: 0.75 },
    mid: { holdMs: 1000, snapTol: 0.04, alpha: 0.6 },
    high: { holdMs: 600, snapTol: 0.07, alpha: 0.45 },
  };
  T.setStraighten = (level) => {
    if (level in STRAIGHTEN) S.straighten = level;
  };
  const strokeCfg = () => STRAIGHTEN[S.straighten];

  function startStroke(e, mode) {
    const slot = S.slots[S.slot];
    G.kind = mode;
    G.color = mode === 'hl' ? S.hl.color : slot.color;
    G.size = mode === 'hl' ? S.hl.size : slot.size;
    G.buf = new QL.PointBuf(256);
    G.fx = G.fy = NaN; // posição filtrada (px de tela)
    G.fp = 0.5; // pressão filtrada
    G.px = G.py = NaN; // último ponto guardado
    G.sp = 0.5; // largura por velocidade (pressão constante)
    G.const = true; // pressão sempre 0,5 (mouse ou caneta sem Windows Ink)
    G.timer = 0;
    G.straight = false;
    G.bb = null; // caixa do traço no canvas vivo (px de tela)
    R.liveActive = true;
    R.clearLive();
    R.live.style.opacity = mode === 'hl' ? '0.35' : '';
    S.strokeActive = true;
    strokePoint(e, true);
  }
  // Entra um ponto: filtra, guarda no buffer (o que está na tela é o que será salvo) e redesenha o traço ao vivo.
  function strokePoint(e, first) {
    const g = G;
    if (!g || !g.buf) return;
    g.shift = e.shiftKey;
    if (g.straight) {
      followStraight(g, e);
      return;
    }
    const rx = e.clientX - R.rect.left,
      ry = e.clientY - R.rect.top;
    let p = e.pressure;
    if (!(p > 0)) p = 0.5;
    const k = first ? 1 : strokeCfg().alpha, // o ponto inicial entra sem filtro
      x = first ? rx : g.fx + (rx - g.fx) * k,
      y = first ? ry : g.fy + (ry - g.fy) * k,
      fp = first ? p : g.fp + (p - g.fp) * k;
    g.fx = x;
    g.fy = y;
    g.fp = fp;
    if (!first) {
      const dd = Math.hypot(x - g.px, y - g.py);
      if (dd < 0.7) return;
    }
    if (Math.abs(p - 0.5) > 0.0005) g.const = false;
    let lp = fp;
    if (g.kind === 'pen' && g.const) {
      // pressão constante: largura por velocidade (mais rápido = mais fino), já gravada no buffer
      const sp = first ? 0 : Math.hypot(x - g.px, y - g.py);
      g.sp += (clamp(0.85 - sp / 40, 0.18, 0.85) - g.sp) * 0.35;
      lp = g.sp;
    }
    const v = R.view,
      wx = (x - v.tx) / v.scale,
      wy = (y - v.ty) / v.scale;
    g.buf.push(wx, wy, lp);
    g.px = x;
    g.py = y;
    g.lw = [wx, wy];
    armStraight(g, wx, wy);
    drawLive(g, x, y);
  }
  // Traço ao vivo com a MESMA geometria do traço final (outline + curvas), limpando só a caixa do traço.
  // Acima de ~2000 pontos desenha só o trecho final (24 pontos) por cima.
  function drawLive(g, x, y) {
    const v = R.view,
      c = R.lctx,
      d = R.dpr,
      n = g.buf.n,
      pad = (QL.widthAt(g.kind, g.size, 1) * v.scale) / 2 + 2,
      big = n > 2000,
      from = big ? n - 24 : 0;
    g.bb = g.bb
      ? [Math.min(g.bb[0], x - pad), Math.min(g.bb[1], y - pad), Math.max(g.bb[2], x + pad), Math.max(g.bb[3], y + pad)]
      : [x - pad, y - pad, x + pad, y + pad];
    if (!big) {
      c.setTransform(d, 0, 0, d, 0, 0);
      c.clearRect(g.bb[0], g.bb[1], g.bb[2] - g.bb[0], g.bb[3] - g.bb[1]);
    }
    c.setTransform(d * v.scale, 0, 0, d * v.scale, d * v.tx, d * v.ty);
    c.fillStyle = g.color;
    c.fill(QL.strokePath(g.buf.a.subarray(from * 3, n * 3), n - from, g.size, g.kind));
  }
  // Traço que vira reta: parado pelo tempo do nível, o traço em andamento passa a ser uma reta do início até o ponteiro
  function armStraight(g, wx, wy) {
    const hold = strokeCfg().holdMs;
    if (hold == null) return;
    if (g.timer && Math.hypot(wx - g.hx, wy - g.hy) < 3) return; // tremor (< 3 px de mundo): o relógio segue correndo
    clearTimeout(g.timer);
    g.hx = wx;
    g.hy = wy;
    g.timer = setTimeout(() => toStraight(g), hold);
  }
  const avgPressure = (a, n) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += a[i * 3 + 2];
    return sum / n;
  };
  const linePts = (a, b, p) => Float32Array.from([a[0], a[1], p, b[0], b[1], p]);
  function toStraight(g) {
    g.timer = 0;
    if (G !== g) return;
    g.avgP = avgPressure(g.buf.a, g.buf.n);
    g.start = [g.buf.a[0], g.buf.a[1]];
    g.straight = true;
    g.end = g.shift ? snapAngle(g.start[0], g.start[1], g.lw[0], g.lw[1]) : g.lw;
    drawStraight(g, true);
    setTimeout(() => G === g && g.straight && drawStraight(g, false), 300); // o realce some em 300 ms
  }
  function followStraight(g, e) {
    const [wx, wy] = R.toWorld(e.clientX, e.clientY);
    g.end = e.shiftKey ? snapAngle(g.start[0], g.start[1], wx, wy) : [wx, wy];
    drawStraight(g, false);
  }
  // reta de início a fim no canvas vivo; `hi` põe um realce de 1 px na cor do acento (instante da conversão)
  function drawStraight(g, hi) {
    const c = R.lctx,
      d = R.dpr,
      [x0, y0] = R.toScreen(g.start[0], g.start[1]),
      [x1, y1] = R.toScreen(g.end[0], g.end[1]);
    R.clearLive();
    c.setTransform(d, 0, 0, d, 0, 0);
    c.lineCap = 'round';
    c.strokeStyle = g.color;
    c.lineWidth = Math.max(0.6, QL.widthAt(g.kind, g.size, g.avgP) * R.view.scale);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    if (hi) {
      c.strokeStyle = ACCENT;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  // ao soltar: desvio máximo dos pontos até a corda (início→fim) menor que snapTol × corda (corda ≥ 40 px de mundo)
  function nearlyStraight(a, n, tol) {
    const sx = a[0],
      sy = a[1],
      ex = a[(n - 1) * 3],
      ey = a[(n - 1) * 3 + 1],
      len = Math.hypot(ex - sx, ey - sy);
    if (n < 2 || len < 40) return false;
    let dev = 0;
    for (let i = 1; i < n - 1; i++) dev = Math.max(dev, QL.distSeg(a[i * 3], a[i * 3 + 1], sx, sy, ex, ey));
    return dev < tol * len;
  }
  // única limpeza ao fechar o traço: tira pontos consecutivos repetidos (< 0,05 de mundo)
  function dedupePts(a, n) {
    const out = [a[0], a[1], a[2]];
    for (let i = 1; i < n; i++) {
      const j = out.length - 3;
      if (Math.hypot(a[i * 3] - out[j], a[i * 3 + 1] - out[j + 1]) >= 0.05)
        out.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
    }
    return Float32Array.from(out);
  }
  function endStroke(g) {
    clearTimeout(g.timer);
    S.strokeActive = false;
    const n = g.buf ? g.buf.n : 0;
    R.live.style.opacity = '';
    if (n > 0) {
      const a = g.buf.a,
        cfg = strokeCfg(),
        hl = g.kind === 'hl';
      if (hl) for (let i = 0; i < n; i++) a[i * 3 + 2] = 0.5;
      else if (g.const && n >= 4) {
        // Wacom/XP-Pen sem Windows Ink chegam como 'mouse': 3 traços assim, sem nunca ter visto 'pen'
        if (g.ptype !== 'pen') S.mouseConst = (S.mouseConst || 0) + 1;
        if ((g.ptype === 'pen' || (S.mouseConst >= 3 && !S.sawPen)) && !S.penMouseMode) {
          S.penMouseMode = true;
          cb('status');
        }
      }
      let pts;
      if (g.straight) pts = linePts(g.start, g.end, hl ? 0.5 : g.avgP);
      else if (cfg.snapTol != null && nearlyStraight(a, n, cfg.snapTol))
        pts = linePts([a[0], a[1]], [a[(n - 1) * 3], a[(n - 1) * 3 + 1]], hl ? 0.5 : avgPressure(a, n));
      else pts = dedupePts(a, n); // sem RDP: o item é exatamente o buffer desenhado ao vivo
      S.lastStroke = { buffered: n, kept: pts.length / 3 };
      const it = { id: QL.uuid(), type: 'stroke', kind: g.kind, color: g.color, size: g.size, pts, n: pts.length / 3 };
      R.liveActive = false;
      addItems([it]);
      R.clearLive();
    } else R.liveActive = false;
    R.clearLive();
    R.requestOverlay();
  }

  /* ------------------------------ borracha -------------------------------- */
  function eraseAt(ax, ay, bx, by) {
    const tol = 7 / R.view.scale,
      len = Math.hypot(bx - ax, by - ay),
      steps = Math.max(1, Math.ceil(len / tol));
    let changed = false;
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps,
        y = ay + ((by - ay) * s) / steps;
      const c = S.doc.grid.query(x - tol, y - tol, x + tol, y + tol);
      for (const it of c) {
        if (G.erased.has(it) || (it.type !== 'stroke' && it.type !== 'shape')) continue;
        if (QL.hitItem(it, x, y, tol)) {
          for (const q of QL.withLinks(S.doc, [it])) {
            G.erased.add(q);
            R.skip.add(q);
          }
          changed = true;
        }
      }
    }
    if (changed) R.requestRedraw();
  }
  function endErase(g) {
    if (g.erased.size) {
      const items = Array.from(g.erased);
      R.skip.clear();
      S.hist.exec(QL.cmdDel(S.doc, items));
      S.sel = S.sel.filter((i) => !g.erased.has(i));
    }
    R.skip.clear();
    R.requestRedraw();
  }

  /* ------------------------------ edição de texto ------------------------- */
  function startEdit(it, isNew) {
    commitEdit();
    E = { it, isNew };
    R.skip.add(it);
    R.requestRedraw();
    ta.value = it.text || '';
    ta.hidden = false;
    styleEditor();
    positionEditor();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function styleEditor() {
    // o visual fixo vem das classes ed-note / ed-text; aqui só o que depende do item e do zoom
    const it = E.it,
      sc = R.view.scale,
      note = it.type === 'note';
    ta.className = 'ed-' + it.type;
    const f = QL.fontParts(it);
    ta.style.fontSize = it.fs * sc + 'px';
    ta.style.fontFamily = f.family;
    ta.style.fontWeight = f.weight;
    ta.style.fontStyle = f.style;
    ta.style.background = note ? it.color : '';
    ta.style.color = note ? '' : it.color;
    ta.style.padding = note ? QL.NOTE_PAD * sc + 'px' : '';
  }
  function positionEditor() {
    if (!E) return;
    const it = E.it,
      sc = R.view.scale;
    const [sx, sy] = R.toScreen(Math.min(it.x, it.x + it.w), Math.min(it.y, it.y + (it.h || 0)));
    styleEditor();
    ta.style.left = sx + 'px';
    ta.style.top = sy + 'px';
    ta.style.width = Math.abs(it.w) * sc + 'px';
    if (it.type === 'note') ta.style.height = Math.abs(it.h) * sc + 'px';
    else growEditor();
  }
  function growEditor() {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, E.it.fs * QL.LINE_H * R.view.scale) + 'px';
  }
  function commitEdit() {
    if (!E) return;
    const { it, isNew } = E,
      val = ta.value;
    E = null;
    ta.hidden = true;
    ta.value = '';
    R.skip.delete(it);
    if (isNew) {
      if (!(it.type === 'text' && !val.trim())) {
        it.text = val;
        QL.touch(it);
        addItems([it]);
        setSel([it]);
      }
    } else if (val !== it.text) {
      if (it.type === 'text' && !val.trim()) {
        S.hist.exec(QL.cmdDel(S.doc, [it]));
        S.sel = S.sel.filter((i) => i !== it);
      } else S.hist.exec(QL.cmdUpd(it, { text: it.text }, { text: val }));
    }
    R.requestRedraw();
    R.requestOverlay();
    if (stage) stage.focus && stage.focus({ preventScroll: true });
  }
  T.commitEdit = commitEdit;

  /* ------------------------- ações sobre a seleção ------------------------ */
  T.deleteSel = function () {
    if (!S.sel.length) return;
    const items = S.sel.slice();
    setSel([]);
    S.hist.exec(QL.cmdDel(S.doc, items));
  };
  T.duplicate = function () {
    if (!S.sel.length) return;
    const cl = QL.cloneItems(
      S.sel.slice().sort((a, b) => a._z - b._z),
      24,
      24
    );
    addItems(cl);
    setSel(cl);
  };
  T.copy = function () {
    if (!S.sel.length) return false;
    S.clip = QL.cloneItems(
      S.sel.slice().sort((a, b) => a._z - b._z),
      0,
      0
    );
    S.pasteN = 0; // (cloneItems já deixa só os conectores com as duas pontas)
    return true;
  };
  T.paste = function () {
    if (!S.clip.length) return;
    S.pasteN++;
    const off = 24 * S.pasteN;
    const items = QL.cloneItems(S.clip, off, off);
    T.setTool('select');
    addItems(items);
    setSel(items);
  };
  T.reorder = function (toFront) {
    if (!S.sel.length) return;
    const set = new Set(S.sel),
      keep = S.doc.items.filter((i) => !set.has(i)),
      mv = S.doc.items.filter((i) => set.has(i));
    const a = (toFront ? keep.concat(mv) : mv.concat(keep)).map((i) => i.id),
      b = S.doc.items.map((i) => i.id);
    if (a.join() === b.join()) return;
    S.hist.exec({ t: 'ord', b, a });
  };
  function stepHistory(dir) {
    commitEdit();
    if (!S.hist[dir]()) return;
    S.sel = S.sel.filter((i) => S.doc.byId.has(i.id));
    R.requestOverlay();
    cb('sel', S.sel);
  }
  T.undo = () => stepHistory('undo');
  T.redo = () => stepHistory('redo');
  T.cancel = function () {
    if (E) {
      // Esc na edição: mantém o que foi digitado (commit)
      commitEdit();
      return;
    }
    if (G && (G.mode === 'marquee' || G.mode === 'shape' || G.mode === 'link' || G.mode === 'cp')) {
      if (G.mode === 'cp') R.skip.delete(G.rh.it);
      G = null;
      R.requestOverlay();
      return;
    }
    setSel([]);
  };
  T.nudge = function (dx, dy) {
    if (!S.sel.length) return;
    S.doc.xform(S.sel, 1, 1, dx, dy);
    S.hist.push({ t: 'xf', items: S.sel.slice(), sx: 1, sy: 1, tx: dx, ty: dy });
  };

  /* ------------------------------ imagens --------------------------------- */
  async function fileToImageItem(file, cx, cy) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch (e) {
      bmp = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = URL.createObjectURL(file);
      });
    }
    const w0 = bmp.width,
      h0 = bmp.height,
      k = Math.min(1, 2048 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)),
      h = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    let alpha = false;
    if (/png|webp|gif|svg/.test(file.type)) {
      // procura transparência numa amostra
      const sw = Math.min(w, 128),
        sh = Math.min(h, 128),
        sc = document.createElement('canvas');
      sc.width = sw;
      sc.height = sh;
      const sx = sc.getContext('2d', { willReadFrequently: true });
      sx.drawImage(cv, 0, 0, sw, sh);
      const d = sx.getImageData(0, 0, sw, sh).data;
      for (let i = 3; i < d.length; i += 4)
        if (d[i] < 250) {
          alpha = true;
          break;
        }
    }
    const url = alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.85);
    cv.width = cv.height = 1;
    const id = QL.hashStr(url);
    S.doc.assets[id] = url;
    const dk = Math.min(1, 640 / Math.max(w, h)),
      dw = w * dk,
      dh = h * dk;
    return { id: QL.uuid(), type: 'image', x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, assetId: id };
  }
  T.insertImages = async function (files, cx, cy) {
    const list = Array.from(files).filter((f) => /^image\//.test(f.type));
    if (!list.length) return 0;
    if (cx == null) [cx, cy] = R.viewCenter();
    const items = [];
    for (let i = 0; i < list.length; i++) {
      try {
        items.push(await fileToImageItem(list[i], cx + i * 30, cy + i * 30));
      } catch (e) {
        cb('toast', 'Não consegui abrir a imagem ' + (list[i].name || ''));
      }
    }
    if (items.length) {
      T.setTool('select');
      addItems(items);
      setSel(items);
    }
    return items.length;
  };
  function onDrop(e) {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    R.rect = stage.getBoundingClientRect();
    const [wx, wy] = R.toWorld(e.clientX, e.clientY);
    T.insertImages(e.dataTransfer.files, wx, wy);
  }
  T.pasteText = function (txt) {
    const [cx, cy] = R.viewCenter();
    const it = newText(cx - 180, cy - 20, 360, txt);
    T.setTool('select');
    addItems([it]);
    setSel([it]);
  };
})(typeof window !== 'undefined' ? window : globalThis);
