/* ===========================================================================
   Quadro Leve - app.js
   Interface (menus, barra de contexto, modais), ciclo de vida do documento,
   salvamento/autosave, atalhos, blindagens do Neutralino e teste de estresse.
   =========================================================================== */
(function (root) {
  'use strict';
  const QL = root.QL,
    R = QL.R,
    S = QL.S,
    T = QL.T;
  const $ = (id) => document.getElementById(id);
  const { PALETTE, FILLS, NOTE_COLORS, HL_COLORS, UNTITLED, EXT, INK_LIGHT, INK_DARK, FONTS } = QL;
  const prefs = QL.storage.prefs;
  const ZOOM_STEP = 1.25;
  const FS_SIZES = [18, 24, 32, 48, 72];
  const TEXT_COLORS = PALETTE.slice(0, 8);

  let storage = null,
    mirror = null,
    isNL = false;
  let doc = null,
    hist = null,
    path = null;
  let dirty = false,
    editSeq = 0,
    firstDirty = 0,
    lastMainSave = 0,
    savedAt = null,
    autoT = 0,
    lastText = '';
  let nativeFailed = false;

  /* ------------------------------ avisos ---------------------------------- */
  let toastT = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function showBanner() {
    $('banner').classList.add('show');
  }
  function hideBanner() {
    $('banner').classList.remove('show');
  }

  // Modal próprio (nada de alert/confirm nativos). Devolve {value, text}.
  function modal(o) {
    return new Promise((resolve) => {
      const m = $('modal'),
        inp = $('mInput'),
        btns = $('mBtns');
      $('mTitle').textContent = o.title || '';
      $('mText').textContent = o.text || '';
      inp.hidden = !o.input;
      if (o.input) inp.value = o.value || '';
      btns.textContent = '';
      const done = (v) => {
        m.classList.remove('show');
        document.removeEventListener('keydown', onKey, true);
        resolve({ value: v, text: inp.value });
      };
      let primary = null,
        cancel = null;
      for (const b of o.buttons || [{ label: 'OK', value: 'ok', primary: true }]) {
        const el = document.createElement('button');
        el.className = 'btn' + (b.primary ? ' primary' : '');
        el.textContent = b.label;
        el.onclick = () => done(b.value);
        btns.appendChild(el);
        if (b.primary) primary = b;
        if (b.cancel) cancel = b;
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done(cancel ? cancel.value : null);
        } else if (e.key === 'Enter' && primary) {
          e.preventDefault();
          e.stopPropagation();
          done(primary.value);
        } else if (e.key !== 'Tab') e.stopPropagation();
      }
      document.addEventListener('keydown', onKey, true);
      m.classList.add('show');
      setTimeout(() => {
        if (o.input) {
          inp.focus();
          inp.select();
        } else (btns.querySelector('.primary') || btns.firstChild).focus();
      }, 0);
    });
  }
  const askName = (title, value) =>
    modal({
      title,
      input: true,
      value,
      buttons: [
        { label: 'Cancelar', value: 'no', cancel: true },
        { label: 'OK', value: 'ok', primary: true },
      ],
    });

  /* ------------------------------ status ---------------------------------- */
  const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  // no máximo uma escrita no DOM por quadro (pointermove e sliders chamam isso o tempo todo)
  let statusQueued = false;
  function updateStatus() {
    if (statusQueued) return;
    statusQueued = true;
    requestAnimationFrame(renderStatus);
  }
  function renderStatus() {
    statusQueued = false;
    if (!doc) return;
    $('stName').textContent = doc.name;
    $('projName').textContent = doc.name;
    $('stSave').textContent = dirty ? 'Não salvo' : savedAt ? 'Salvo às ' + hhmm(savedAt) : 'Novo quadro';
    $('stZoom').textContent = Math.round(R.view.scale * 100) + '%';
    $('zv').textContent = Math.round(R.view.scale * 100) + '%';
    $('stCount').textContent = doc.items.length + (doc.items.length === 1 ? ' item' : ' itens');
    $('hint').textContent = S.penMouseMode ? 'Ligue o Windows Ink no driver da mesa para ter pressão' : '';
    $('stRuntime').textContent = isNL
      ? 'Neutralino ' + (root.NL_VERSION || '') + ' · app ' + (root.NL_APPVERSION || QL.APP_VERSION)
      : 'Modo navegador · app ' + QL.APP_VERSION;
    $('bUndo').disabled = !hist || !hist.undoS.length;
    $('bRedo').disabled = !hist || !hist.redoS.length;
    document.title = doc.name + ' — Quadro Leve';
  }
  S.cb.status = updateStatus;

  /* ------------------------------ dirty / autosave ------------------------ */
  function markDirty() {
    editSeq++;
    const n = Date.now();
    if (!dirty) {
      dirty = true;
      firstDirty = n;
    }
    scheduleAuto();
    updateStatus();
  }
  S.cb.dirty = markDirty;
  const idle = (f) => (root.requestIdleCallback ? root.requestIdleCallback(f, { timeout: 2500 }) : setTimeout(f, 50));

  function scheduleAuto(delay) {
    clearTimeout(autoT);
    const d = delay != null ? delay : Math.max(0, Math.min(3000, firstDirty + 30000 - Date.now()));
    autoT = setTimeout(runAuto, d);
  }
  function runAuto() {
    if (S.strokeActive) {
      scheduleAuto(500);
      return;
    } // nunca durante um traço
    idle(doAuto);
  }
  async function doAuto() {
    if (!dirty || !doc) return;
    if (S.strokeActive) {
      scheduleAuto(500);
      return;
    }
    T.commitEdit();
    const text = serialize();
    try {
      await storage.writeRecovery(doc.id, text);
    } catch (e) {
      onSaveFail(e, text);
    }
    if (nativeFailed) {
      try {
        await mirror.writeRecovery(doc.id, text);
      } catch (e) {
        /* ok */
      }
    }
    const since = Date.now() - lastMainSave;
    if (since >= 30000) await saveMain();
    else if (dirty) scheduleAuto(30000 - since + 50);
  }

  function serialize() {
    T.commitEdit(); // o texto que está sendo digitado entra no arquivo
    doc.updatedAt = QL.nowIso();
    const [cx, cy] = R.viewCenter();
    doc.viewport = { x: Math.round(cx), y: Math.round(cy), scale: +R.view.scale.toFixed(4) };
    lastText = QL.serializeDoc(doc);
    return lastText;
  }
  function onSaveFail(e, text) {
    console.error('Falha ao salvar', e);
    nativeFailed = true;
    showBanner();
    if (mirror && text) mirror.writeRecovery(doc.id, text).catch(() => {});
  }

  async function ensurePath() {
    if (!path) path = await storage.defaultPathFor(doc.name, doc.id);
    return path;
  }
  // fechamento comum de um salvamento que deu certo (principal ou "salvar como")
  function afterSaved(p, seq) {
    path = p;
    lastMainSave = Date.now();
    savedAt = new Date();
    if (seq === editSeq) dirty = false;
    else scheduleAuto();
    storage.addRecent({ path, name: doc.name, updatedAt: doc.updatedAt }).catch(() => {});
    storage.clearRecovery(doc.id);
    nativeFailed = false;
    hideBanner();
    updateStatus();
  }
  async function saveMain(manual) {
    if (!doc) return false;
    clearTimeout(autoT);
    T.commitEdit();
    const seq = editSeq;
    const text = serialize();
    try {
      await ensurePath();
      await storage.save(path, text, { name: doc.name, updatedAt: doc.updatedAt });
      afterSaved(path, seq);
      if (manual) toast(isNL ? 'Salvo em ' + storage.describe() : 'Salvo neste navegador');
      return true;
    } catch (e) {
      onSaveFail(e, text);
      updateStatus();
      if (manual) toast('Não consegui salvar no disco');
      return false;
    }
  }
  async function saveAs() {
    const text = serialize(),
      seq = editSeq;
    try {
      const p = await storage.saveAs(doc.name, text);
      if (isNL && p) {
        afterSaved(p, seq);
        toast('Salvo como ' + p.split(/[\\/]/).pop());
      } else if (!isNL) toast('Cópia baixada');
    } catch (e) {
      onSaveFail(e, text);
      toast('Não consegui salvar');
    }
  }

  /* ------------------------------ documento ------------------------------- */
  function setDocument(data, p) {
    if (hist) T.commitEdit();
    doc = new QL.Doc(data);
    hist = new QL.History(doc);
    path = p || null;
    doc.onChange = () => {
      if (!S.quiet) {
        R.requestRedraw();
        R.requestOverlay();
      }
      updateStatus();
    };
    T.setDoc(doc, hist);
    dirty = false;
    savedAt = null;
    lastMainSave = 0;
    clearTimeout(autoT);
    const vp = doc.viewport,
      sc = QL.clamp(vp.scale || 1, QL.MIN_SCALE, QL.MAX_SCALE);
    jumpView(sc, R.W / 2 - (vp.x || 0) * sc, R.H / 2 - (vp.y || 0) * sc);
    updateViewMenu();
    updateStatus();
    if (isNL) {
      try {
        Neutralino.window.setTitle(doc.name + ' — Quadro Leve');
      } catch (e) {
        /* ok */
      }
    }
  }
  function jumpView(s, tx, ty) {
    R.view.scale = s;
    R.view.tx = tx;
    R.view.ty = ty;
    R.redrawNow();
    R.drawOverlay();
    updateStatus();
  }
  async function newBoard(name) {
    if (dirty) await saveMain();
    const d = QL.newDoc(name || UNTITLED);
    setDocument(d, null);
    try {
      await ensurePath();
    } catch (e) {
      onSaveFail(e, null);
    }
    markDirty();
  }
  async function openText(text, p, fromFile) {
    let data;
    try {
      data = QL.parseDoc(text);
    } catch (e) {
      await modal({ title: 'Não consegui abrir', text: e.message || 'O arquivo não é um quadro válido.' });
      return false;
    }
    // trabalho não salvo?
    let recText = null;
    try {
      recText = await storage.readRecovery(data.id);
    } catch (e) {
      /* ok */
    }
    if (!recText && mirror) {
      try {
        recText = await mirror.readRecovery(data.id);
      } catch (e) {
        /* ok */
      }
    }
    if (recText) {
      try {
        const rec = QL.parseDoc(recText);
        if (rec.updatedAt > data.updatedAt) {
          const r = await modal({
            title: 'Recuperar trabalho não salvo?',
            text:
              'Encontrei uma versão mais nova deste quadro (' +
              new Date(rec.updatedAt).toLocaleString('pt-BR') +
              ') que não chegou a ser salva.',
            buttons: [
              { label: 'Descartar', value: 'no' },
              { label: 'Recuperar', value: 'yes', primary: true },
            ],
          });
          if (r.value === 'yes') data = rec;
          else {
            storage.clearRecovery(data.id);
            if (mirror) mirror.clearRecovery(data.id);
            recText = null;
          }
        }
      } catch (e) {
        /* recuperação corrompida: ignora */
      }
    }
    if (dirty) await saveMain();
    if (!p && !isNL) p = await storage.defaultPathFor(data.name, data.id);
    setDocument(data, p);
    if (data.newer) toast('Este quadro veio de uma versão mais nova do app; os campos extras foram preservados.');
    if ((recText && data.updatedAt) || fromFile) markDirty();
    storage.addRecent({ path: p, name: data.name, updatedAt: data.updatedAt }).catch(() => {});
    return true;
  }
  async function openPath(p, silent) {
    try {
      const t = await storage.load(p);
      return await openText(t, p, false);
    } catch (e) {
      const msg = 'O arquivo não pôde ser lido: ' + (e.message || e.code || e);
      if (silent) toast(msg);
      else await modal({ title: 'Não consegui abrir', text: msg });
      return false;
    }
  }
  async function openDialog() {
    try {
      const r = await storage.pickOpen();
      if (!r) return;
      if (await openText(r.text, r.path, !isNL)) hideStart();
    } catch (e) {
      await modal({ title: 'Não consegui abrir', text: String(e.message || e.code || e) });
    }
  }
  async function renameDoc() {
    const r = await askName('Nome do quadro', doc.name);
    if (r.value === 'ok' && r.text.trim()) {
      doc.name = r.text.trim().slice(0, 120);
      markDirty();
    }
  }
  async function exportPng() {
    T.commitEdit();
    try {
      const r = await R.exportPNG(doc);
      if (!r) {
        toast('O quadro está vazio');
        return;
      }
      const p = await storage.exportBlob(doc.name + '.png', r.blob);
      if (p)
        toast(
          (r.reduced ? 'Imagem reduzida para caber no limite (' + r.w + '×' + r.h + ' px). ' : 'Exportado. ') +
            (p === 'download' ? '' : p)
        );
    } catch (e) {
      toast('Não consegui exportar: ' + (e.message || e));
    }
  }

  /* ------------------------------ zoom / ajuste --------------------------- */
  function fit() {
    const b = doc.bounds();
    if (!b) {
      jumpView(1, R.W / 2, R.H / 2);
      return;
    }
    const w = Math.max(b[2] - b[0], 10),
      h = Math.max(b[3] - b[1], 10),
      m = 60;
    const s = QL.clamp(Math.min((R.W - m * 2) / w, (R.H - m * 2) / h, 2), QL.MIN_SCALE, QL.MAX_SCALE);
    jumpView(s, R.W / 2 - ((b[0] + b[2]) / 2) * s, R.H / 2 - ((b[1] + b[3]) / 2) * s);
  }
  function zoom100() {
    const [wx, wy] = R.viewCenter();
    jumpView(1, R.W / 2 - wx, R.H / 2 - wy);
  }
  function zoomBy(f) {
    R.zoomAt(f, R.W / 2, R.H / 2);
  }

  /* ------------------------------ barra de contexto ----------------------- */
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function swatches(parent, list, cur, pick, withNone) {
    if (withNone) {
      const b = el('button', 'sw none' + (!cur ? ' on' : ''));
      b.title = 'Sem preenchimento';
      b.onclick = () => pick(null);
      parent.appendChild(b);
    }
    for (const c of list) {
      const b = el('button', 'sw' + (cur === c ? ' on' : ''));
      b.style.background = c;
      b.title = c;
      b.onclick = () => pick(c);
      parent.appendChild(b);
    }
  }
  function colorIn(parent, val, pick) {
    const i = document.createElement('input');
    i.type = 'color';
    i.value = /^#[0-9a-f]{6}$/i.test(val || '') ? val : '#000000';
    i.title = 'Outra cor';
    i.onchange = () => pick(i.value);
    parent.appendChild(i);
  }
  function range(parent, min, max, val, pick, commit) {
    const i = document.createElement('input');
    i.type = 'range';
    i.min = min;
    i.max = max;
    i.value = val;
    const l = el('span', 'lab num', val + ' px');
    i.oninput = () => {
      l.textContent = i.value + ' px';
      pick(+i.value);
    };
    if (commit) i.onchange = () => commit(+i.value);
    parent.appendChild(i);
    parent.appendChild(l);
  }
  // Slider que edita uma propriedade de itens já existentes: prévia a cada `input` (sem comando)
  // e UM comando no `change`, sem reconstruir a barra.
  function propRange(parent, items, prop, min, max) {
    let before = null;
    range(
      parent,
      min,
      max,
      items[0][prop],
      (v) => {
        if (!before) before = items.map((it) => it[prop]);
        for (const it of items) S.doc.assign(it, { [prop]: v });
      },
      (v) => {
        if (!before) return;
        const cmds = items.map((it, i) => QL.cmdUpd(it, { [prop]: before[i] }, { [prop]: v }));
        before = null;
        S.hist.push(cmds.length === 1 ? cmds[0] : { t: 'batch', cmds });
      }
    );
  }
  const HEADS = [
    ['none', 'Sem seta'],
    ['end', 'Seta'],
    ['both', 'Dupla'],
  ];
  const ROUTES = [
    ['straight', 'Reto'],
    ['curve', 'Curva'],
    ['elbow', 'Cotovelo'],
  ];
  const SHAPES = [
    ['rect', '▭ Retângulo'],
    ['ellipse', '◯ Elipse'],
    ['triangle', '△ Triângulo'],
    ['diamond', '◇ Losango'],
    ['line', '╱ Linha'],
    ['arrow', '➝ Seta'],
  ];
  // fileira de chips de escolha única; `cur` marca o ativo (null = valores diferentes na seleção)
  function chipRow(parent, list, cur, pick) {
    list.forEach(([k, n]) => {
      const b = el('button', 'chip' + (cur === k ? ' on' : ''), n);
      b.onclick = () => pick(k);
      parent.appendChild(b);
    });
  }
  const headChips = (parent, cur, pick) => chipRow(parent, HEADS, cur, pick);
  const shapeChips = (parent, cur, pick) => chipRow(parent, SHAPES, cur, pick);
  const routeChips = (parent, cur, pick) => chipRow(parent, ROUTES, cur, pick);
  const fsChips = (parent, cur, pick) =>
    chipRow(
      parent,
      FS_SIZES.map((n) => [n, String(n)]),
      cur,
      pick
    );
  const FONT_LIST = Object.entries(FONTS).map(([k, f]) => [k, f.label]);
  // fonte (chips) + N (negrito) + I (itálico); `cur` = { font, weight, italic } (null = valores diferentes)
  function fontControls(parent, cur, pick) {
    chipRow(parent, FONT_LIST, cur.font, (k) => pick({ font: k === 'system' ? undefined : k }));
    const toggle = (cls, label, on, props) => {
      const b = el('button', 'chip ' + cls + (on ? ' on' : ''), label);
      b.onclick = () => pick(props);
      parent.appendChild(b);
    };
    toggle('b', 'N', cur.weight === 'bold', { weight: cur.weight === 'bold' ? undefined : 'bold' });
    toggle('i', 'I', cur.italic === true, { italic: cur.italic === true ? undefined : true });
  }
  const fontState = (items) => ({
    font: common(items, (x) => x.font || 'system'),
    weight: common(items, (x) => (x.weight === 'bold' ? 'bold' : 'normal')),
    italic: common(items, (x) => !!x.italic),
  });
  // amostras de cor + seletor livre; `after` roda só após clicar numa amostra (ex.: reconstruir a barra)
  function colorRow(parent, list, cur, pick, withNone, after) {
    swatches(
      parent,
      list,
      cur,
      (c) => {
        pick(c);
        if (after) after();
      },
      withNone
    );
    colorIn(parent, cur, pick);
  }
  const addLab = (parent, t) => parent.appendChild(el('span', 'lab', t));
  // valor comum a todos os itens (ou null se diferem)
  const common = (items, f) => (items.every((x) => f(x) === f(items[0])) ? f(items[0]) : null);

  function closePop() {
    $('pop').classList.remove('open');
  }
  function openSlotPop(i, anchor) {
    const p = $('pop'),
      s = S.slots[i];
    p.textContent = '';
    addLab(p, 'Caneta ' + (i + 1) + ' · cor e espessura');
    const r1 = el('div', 'row');
    colorRow(
      r1,
      PALETTE,
      s.color,
      (c) => {
        s.color = c;
        refreshSlots();
      },
      false,
      () => {
        buildCtx();
        openSlotPop(i, anchor);
      }
    );
    p.appendChild(r1);
    const r2 = el('div', 'row');
    range(r2, 1, 24, s.size, (v) => {
      s.size = v;
      refreshSlots();
    });
    p.appendChild(r2);
    const st = $('stage').getBoundingClientRect(),
      a = anchor.getBoundingClientRect();
    p.style.left = Math.max(6, Math.min(a.left - st.left, st.width - 240)) + 'px';
    p.style.top = '8px'; // a barra fica fora do palco
    p.classList.add('open');
  }
  function refreshSlots() {
    document.querySelectorAll('#ctxbar .slot').forEach((b, i) => {
      const d = b.querySelector('.dot'),
        s = S.slots[i];
      d.style.background = s.color;
      d.style.width = d.style.height = Math.min(22, s.size + 6) + 'px';
    });
  }
  // Aplica propriedades aos itens selecionados como um comando (entra no desfazer)
  function applyProps(items, props) {
    const cmds = [];
    for (const it of items) {
      const before = {};
      for (const k in props) before[k] = it[k];
      cmds.push(QL.cmdUpd(it, before, Object.assign({}, props)));
    }
    if (!cmds.length) return;
    S.hist.exec(cmds.length === 1 ? cmds[0] : { t: 'batch', cmds });
    buildCtx();
  }
  function buildSelCtx(bar) {
    const sel = S.sel,
      of = (ty) => sel.filter((i) => i.type === ty);
    const shapes = of('shape'),
      strokes = of('stroke'),
      notes = of('note'),
      texts = of('text'),
      links = of('link');
    addLab(bar, sel.length + (sel.length > 1 ? ' itens' : ' item'));
    if (shapes.length) {
      shapeChips(
        bar,
        common(shapes, (x) => x.shape),
        (k) => applyProps(shapes, { shape: k })
      );
      addLab(bar, 'Contorno');
      colorRow(bar, PALETTE, shapes[0].stroke, (c) => applyProps(shapes, { stroke: c }));
      addLab(bar, 'Preenchimento');
      colorRow(bar, FILLS, shapes[0].fill, (c) => applyProps(shapes, { fill: c }), true);
      propRange(bar, shapes, 'sw', 1, 24);
    }
    if (strokes.length) {
      addLab(bar, 'Traço');
      colorRow(bar, PALETTE, strokes[0].color, (c) => applyProps(strokes, { color: c }));
    }
    if (notes.length) {
      addLab(bar, 'Nota');
      swatches(bar, NOTE_COLORS, notes[0].color, (c) => applyProps(notes, { color: c }));
    }
    if (texts.length) {
      addLab(bar, 'Texto');
      colorRow(bar, TEXT_COLORS, texts[0].color, (c) => applyProps(texts, { color: c }));
      fsChips(
        bar,
        common(texts, (x) => x.fs),
        (n) => applyProps(texts, { fs: n })
      );
    }
    const typo = notes.concat(texts);
    if (typo.length) fontControls(bar, fontState(typo), (props) => applyProps(typo, props));
    if (links.length) {
      addLab(bar, 'Conector');
      colorRow(bar, PALETTE, links[0].color, (c) => applyProps(links, { color: c }));
      headChips(
        bar,
        common(links, (x) => x.head),
        (k) => applyProps(links, { head: k })
      );
      propRange(bar, links, 'sw', 1, 12);
    }
    const routable = links.concat(shapes.filter(QL.isRoutable)); // conector, linha e seta
    if (routable.length) {
      addLab(bar, 'Trajeto');
      routeChips(
        bar,
        common(routable, (x) => x.route || 'straight'),
        // mudar de modo apaga o ponto de controle; reto = campo ausente
        (k) => applyProps(routable, { route: k === 'straight' ? undefined : k, cp: undefined })
      );
    }
  }
  function buildCtx() {
    const bar = $('ctxbar');
    bar.textContent = '';
    closePop();
    const t = S.tool;
    if (t === 'pen') {
      S.slots.forEach((s, i) => {
        const b = el('button', 'slot' + (S.slot === i ? ' active' : ''));
        b.title = 'Caneta ' + (i + 1) + ' (tecla ' + (i + 1) + '). Clique duplo para editar.';
        const box = el('span', 'dotbox');
        box.appendChild(el('span', 'dot'));
        b.appendChild(box);
        b.appendChild(el('span', 'lab', String(i + 1)));
        b.onclick = () => {
          S.slot = i;
          buildCtx();
        };
        b.ondblclick = () => {
          S.slot = i;
          buildCtx();
          openSlotPop(i, bar.querySelectorAll('.slot')[i]);
        };
        bar.appendChild(b);
      });
      refreshSlots();
      const cur = S.slots[S.slot];
      addLab(bar, 'Cor');
      colorRow(
        bar,
        PALETTE,
        cur.color,
        (c) => {
          cur.color = c;
          refreshSlots();
        },
        false,
        buildCtx
      );
      addLab(bar, 'Espessura');
      range(bar, 1, 24, cur.size, (v) => {
        cur.size = v;
        refreshSlots();
      });
    } else if (t === 'hl') {
      colorRow(bar, HL_COLORS, S.hl.color, (c) => (S.hl.color = c), false, buildCtx);
      range(bar, 6, 40, S.hl.size, (v) => (S.hl.size = v));
    } else if (t === 'shape') {
      shapeChips(bar, S.shape.type, (k) => {
        S.shape.type = k;
        buildCtx();
      });
      addLab(bar, 'Contorno');
      colorRow(bar, PALETTE, S.shape.stroke, (c) => (S.shape.stroke = c), false, buildCtx);
      if (S.shape.type !== 'line' && S.shape.type !== 'arrow') {
        addLab(bar, 'Preenchimento');
        colorRow(bar, FILLS, S.shape.fill, (c) => (S.shape.fill = c), true, buildCtx);
      }
      range(bar, 1, 24, S.shape.sw, (v) => (S.shape.sw = v));
    } else if (t === 'link') {
      colorRow(bar, PALETTE, S.link.color, (c) => (S.link.color = c), false, buildCtx);
      headChips(bar, S.link.head, (k) => {
        S.link.head = k;
        buildCtx();
      });
      routeChips(bar, S.link.route, (k) => {
        S.link.route = k;
        buildCtx();
      });
      range(bar, 1, 12, S.link.sw, (v) => (S.link.sw = v));
    } else if (t === 'note') {
      addLab(bar, 'Cor da nota');
      swatches(bar, NOTE_COLORS, S.noteColor, (c) => {
        S.noteColor = c;
        buildCtx();
      });
    } else if (t === 'text') {
      colorRow(bar, TEXT_COLORS, S.text.color, (c) => (S.text.color = c), false, buildCtx);
      fsChips(bar, S.text.fs, (n) => {
        S.text.fs = n;
        buildCtx();
      });
      fontControls(bar, fontState([S.text]), (props) => {
        Object.assign(S.text, props);
        buildCtx();
      });
    } else if (t === 'eraser') addLab(bar, 'Passe sobre um traço ou forma para apagar');
    else if (t === 'select') {
      if (S.sel.length) buildSelCtx(bar);
      else
        addLab(
          bar,
          'Clique num item para mudar cor e forma · arraste para selecionar · Del apaga · Ctrl+D duplica · duplo clique edita texto'
        );
    } else if (t === 'hand') addLab(bar, 'Arraste para mover a tela');
  }
  S.cb.tool = (t) => {
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
    buildCtx();
  };
  S.cb.sel = () => {
    if (S.tool === 'select') buildCtx();
  };
  S.cb.toast = toast;

  /* ------------------------------ menus / início -------------------------- */
  // marca (classe .on) o item ativo de um grupo do menu: itens com data-act = prefixo + valor
  function markGroup(prefix, active) {
    document
      .querySelectorAll('[data-act^="' + prefix + '"]')
      .forEach((b) => b.classList.toggle('on', b.dataset.act === prefix + active));
  }
  function updateViewMenu() {
    markGroup('theme-', R.dark ? 'dark' : 'light');
    markGroup('bg-', doc && (doc.background === 'grid' || doc.background === 'dots') ? doc.background : 'white');
    markGroup('st-', S.straighten);
  }
  // Correção do traço é preferência do usuário (nível aplicado na hora)
  function applyStraighten(level, persist) {
    T.setStraighten(level);
    updateViewMenu();
    if (persist) prefs.set('straighten', S.straighten);
  }
  // Tema é preferência do usuário (não do quadro). Itens existentes não mudam: só a tinta padrão das ferramentas.
  function applyTheme(t, persist) {
    const dark = t === 'dark';
    document.body.classList.toggle('theme-dark', dark); // classe no body: o host da prévia pode escrever no <html>
    if (R.dark !== dark) {
      const from = dark ? INK_LIGHT : INK_DARK,
        to = dark ? INK_DARK : INK_LIGHT;
      for (const [o, k] of [
        [S.slots[0], 'color'],
        [S.text, 'color'],
        [S.shape, 'stroke'],
        [S.link, 'color'],
      ])
        if (o[k] === from) o[k] = to;
    }
    R.dark = dark;
    updateViewMenu();
    if (doc) {
      R.redrawNow();
      R.drawOverlay();
      buildCtx();
    }
    if (persist) prefs.set('theme', dark ? 'dark' : 'light');
  }
  function setBg(v) {
    doc.background = v;
    updateViewMenu();
    markDirty();
    R.redrawNow();
  }
  function closeMenus() {
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  }
  async function act(a) {
    closeMenus();
    switch (a) {
      case 'new':
        showStart();
        break;
      case 'open':
        openDialog();
        break;
      case 'recents':
        showStart();
        break;
      case 'save':
        saveMain(true);
        break;
      case 'saveas':
        saveAs();
        break;
      case 'export':
        exportPng();
        break;
      case 'image': {
        const i = document.createElement('input');
        i.type = 'file';
        i.accept = 'image/*';
        i.multiple = true;
        i.onchange = () => T.insertImages(i.files);
        i.click();
        break;
      }
      case 'st-off':
      case 'st-low':
      case 'st-mid':
      case 'st-high':
        applyStraighten(a.slice(3), true);
        break;
      case 'theme-light':
        applyTheme('light', true);
        break;
      case 'theme-dark':
        applyTheme('dark', true);
        break;
      case 'bg-white':
        setBg('white');
        break;
      case 'bg-grid':
        setBg('grid');
        break;
      case 'bg-dots':
        setBg('dots');
        break;
      case 'zin':
        zoomBy(ZOOM_STEP);
        break;
      case 'zout':
        zoomBy(1 / ZOOM_STEP);
        break;
      case 'z100':
        zoom100();
        break;
      case 'fit':
        fit();
        break;
    }
  }
  async function showStart() {
    T.commitEdit();
    $('start').classList.add('show');
    $('newName').value = UNTITLED;
    const box = $('recents');
    box.textContent = '';
    let list = [];
    try {
      list = await storage.listRecents();
    } catch (e) {
      /* ok */
    }
    if (!list.length) box.appendChild(el('div', 'empty', 'Nenhum quadro recente ainda.'));
    for (const r of list) {
      const b = el('button', 'rec');
      b.appendChild(el('span', null, r.name || 'Quadro'));
      b.appendChild(el('small', null, r.updatedAt ? new Date(r.updatedAt).toLocaleString('pt-BR') : ''));
      b.onclick = async () => {
        if (await openPath(r.path)) hideStart();
      };
      box.appendChild(b);
    }
    setTimeout(() => {
      $('newName').focus();
      $('newName').select();
    }, 0);
  }
  function hideStart() {
    $('start').classList.remove('show');
  }

  /* ------------------------------ eventos --------------------------------- */
  function isTyping(e) {
    const t = e.target && e.target.tagName;
    return t === 'TEXTAREA' || t === 'INPUT';
  }
  function onKey(e) {
    const k = e.key,
      mod = e.ctrlKey || e.metaKey;
    if (isNL) {
      // recarregar invalidaria o token nativo
      if (
        k === 'F5' ||
        k === 'F12' ||
        (mod && (k === 'r' || k === 'R')) ||
        (mod && e.shiftKey && (k === 'I' || k === 'i' || k === 'J' || k === 'j'))
      ) {
        e.preventDefault();
        return;
      }
    }
    if (mod && (k === '=' || k === '+' || k === '-' || k === '0' || k === '_')) {
      e.preventDefault();
      if (isTyping(e)) return;
    }
    if ($('modal').classList.contains('show')) return;
    if ($('start').classList.contains('show')) {
      if (k === 'Escape') hideStart();
      else if (k === 'Enter' && e.target.id === 'newName') {
        $('startNew').click();
      }
      return;
    }
    if (isTyping(e)) return;
    const low = k.length === 1 ? k.toLowerCase() : k;
    if (k === ' ') {
      e.preventDefault();
      if (!S.space) T.setSpace(true);
      return;
    }
    if (mod) {
      if (e.code === 'BracketRight' && e.shiftKey) {
        e.preventDefault();
        T.reorder(true);
        return;
      }
      if (e.code === 'BracketLeft' && e.shiftKey) {
        e.preventDefault();
        T.reorder(false);
        return;
      }
      switch (low) {
        case 'z':
          e.preventDefault();
          e.shiftKey ? T.redo() : T.undo();
          return;
        case 'y':
          e.preventDefault();
          T.redo();
          return;
        case 's':
          e.preventDefault();
          e.shiftKey ? saveAs() : saveMain(true);
          return;
        case 'o':
          e.preventDefault();
          openDialog();
          return;
        case 'n':
          e.preventDefault();
          showStart();
          return;
        case 'e':
          e.preventDefault();
          exportPng();
          return;
        case 'a':
          e.preventDefault();
          T.selectAll();
          return;
        case 'd':
          e.preventDefault();
          T.duplicate();
          return;
        case '0':
          e.preventDefault();
          fit();
          return;
        case '1':
          e.preventDefault();
          zoom100();
          return;
        case '=':
        case '+':
          e.preventDefault();
          zoomBy(ZOOM_STEP);
          return;
        case '-':
          e.preventDefault();
          zoomBy(1 / ZOOM_STEP);
          return;
      }
      return;
    }
    const tools = { v: 'select', p: 'pen', h: 'hl', e: 'eraser', n: 'note', t: 'text', s: 'shape', l: 'link' };
    if (tools[low] && !e.altKey) {
      e.preventDefault();
      T.setTool(tools[low]);
      return;
    }
    if (low === '1' || low === '2' || low === '3') {
      e.preventDefault();
      T.slotSelect(+low - 1);
      buildCtx();
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      T.deleteSel();
      return;
    }
    if (k === 'Escape') {
      T.cancel();
      return;
    }
    const st = e.shiftKey ? 10 : 1;
    if (k === 'ArrowLeft') {
      e.preventDefault();
      T.nudge(-st, 0);
    } else if (k === 'ArrowRight') {
      e.preventDefault();
      T.nudge(st, 0);
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      T.nudge(0, -st);
    } else if (k === 'ArrowDown') {
      e.preventDefault();
      T.nudge(0, st);
    }
  }
  function onKeyUp(e) {
    if (e.key === ' ' && S.space) T.setSpace(false);
  }
  const MARK = '​QL-ITENS';
  function onCopy(e, cut) {
    if (isTyping(e) || !S.sel.length) return;
    if (T.copy()) {
      e.clipboardData.setData('text/plain', MARK);
      e.preventDefault();
      if (cut) T.deleteSel();
    }
  }
  function onPaste(e) {
    if (isTyping(e) || !doc) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [];
    for (const it of cd.items || [])
      if (it.kind === 'file' && /^image\//.test(it.type)) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    if (files.length) {
      e.preventDefault();
      T.insertImages(files);
      return;
    }
    const txt = cd.getData('text/plain');
    e.preventDefault();
    if (!txt || txt === MARK) T.paste();
    else T.pasteText(txt);
  }

  function bindUI() {
    document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => T.setTool(b.dataset.tool)));
    document.querySelectorAll('.menu').forEach((m) => {
      m.firstElementChild.addEventListener('click', (e) => {
        e.stopPropagation();
        const o = m.classList.contains('open');
        closeMenus();
        if (!o) {
          m.classList.add('open');
          updateViewMenu();
        }
      });
    });
    document.querySelectorAll('.mi').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.menu')) closeMenus();
      if (!e.target.closest('#pop') && !e.target.closest('.slot')) closePop();
    });
    $('bUndo').onclick = () => T.undo();
    $('bRedo').onclick = () => T.redo();
    $('projName').onclick = renameDoc;
    $('stName').onclick = renameDoc;
    $('zIn').onclick = () => zoomBy(ZOOM_STEP);
    $('zOut').onclick = () => zoomBy(1 / ZOOM_STEP);
    $('zv').onclick = zoom100;
    $('zFit').onclick = fit;
    $('startNew').onclick = async () => {
      hideStart();
      await newBoard($('newName').value.trim() || UNTITLED);
    };
    $('startOpen').onclick = () => openDialog();
    $('startClose').onclick = hideStart;
    $('bannerBtn').onclick = () => {
      if (doc) QL.storage.downloadText(QL.storage.safeName(doc.name) + EXT, lastText || serialize());
    };
    // Ctrl+roda não pode dar zoom na página (WebView2), dentro ou fora do canvas
    document.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
      },
      { passive: false }
    );
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('copy', (e) => onCopy(e, false));
    document.addEventListener('cut', (e) => onCopy(e, true));
    document.addEventListener('paste', onPaste);
    if (isNL) document.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => R.resize()).observe($('stage')); // janela e altura da barra de contexto
    root.addEventListener('beforeunload', (e) => {
      if (dirty && doc) {
        try {
          mirror && mirror.writeRecovery(doc.id, serialize());
        } catch (x) {
          /* ok */
        }
        if (!isNL) {
          e.preventDefault();
          e.returnValue = '';
        }
      }
    });
    const pe = R.onView;
    R.onView = () => {
      if (pe) pe();
      updateStatus();
    };
  }

  /* ------------------------------ estresse -------------------------------- */
  // window.__stress(5000, 200): cria traços e notas sintéticos para medir desempenho.
  root.__stress = function (nStrokes, nNotes) {
    nStrokes = nStrokes == null ? 5000 : nStrokes;
    nNotes = nNotes == null ? 200 : nNotes;
    const t0 = performance.now();
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const items = [];
    for (let i = 0; i < nStrokes; i++) {
      const buf = new QL.PointBuf(64);
      let x = (rnd() - 0.5) * 12000,
        y = (rnd() - 0.5) * 8000,
        a = rnd() * 6.28;
      const n = 30 + Math.floor(rnd() * 60);
      for (let k = 0; k < n; k++) {
        a += (rnd() - 0.5) * 0.5;
        x += Math.cos(a) * 4;
        y += Math.sin(a) * 4;
        buf.push(x, y, 0.3 + rnd() * 0.6);
      }
      const pts = QL.rdp(buf.a, buf.n, 0.35, 3);
      items.push({
        id: QL.uuid(),
        type: 'stroke',
        kind: 'pen',
        color: PALETTE[i % 5],
        size: 3,
        pts,
        n: pts.length / 3,
      });
    }
    for (let i = 0; i < nNotes; i++)
      items.push({
        id: QL.uuid(),
        type: 'note',
        x: (rnd() - 0.5) * 12000,
        y: (rnd() - 0.5) * 8000,
        w: 220,
        h: 220,
        color: NOTE_COLORS[i % 8],
        text: 'Nota de teste ' + i + '\nTexto um pouco mais comprido para quebrar linha na nota.',
        fs: 22,
      });
    const tGen = performance.now() - t0;
    T.quietly(() => doc.insert(items));
    markDirty();
    fit();
    const r = root.__bench(10);
    return { itens: doc.items.length, geracaoMs: Math.round(tGen), redesenhoMedioMs: r };
  };
  root.__bench = function (reps) {
    reps = reps || 10;
    const t = performance.now();
    for (let i = 0; i < reps; i++) R.redrawNow();
    return +((performance.now() - t) / reps).toFixed(1);
  };

  function forceExit() {
    try {
      const r = Neutralino.app.exit();
      if (r && r.catch) r.catch(() => root.close());
    } catch (e) {
      root.close();
    }
  }

  /* ------------------------------ boot ------------------------------------ */
  (async function boot() {
    applyTheme(prefs.get('theme') || 'light'); // antes do primeiro desenho, para não piscar
    R.init($('stage'), $('static'), $('live'));
    T.attach($('stage'), $('editor'));
    storage = await QL.storage.createStorage();
    isNL = storage.kind === 'neutralino';
    if (isNL) {
      mirror = new QL.storage.BrowserStorage();
      try {
        await mirror.init();
      } catch (e) {
        mirror = null;
      }
    } else mirror = storage;
    const savedTheme = await prefs.load('theme');
    if (savedTheme && savedTheme !== (R.dark ? 'dark' : 'light')) applyTheme(savedTheme);
    applyStraighten((await prefs.load('straighten')) || S.straighten);
    bindUI();
    S.cb.tool(S.tool);
    setDocument(QL.newDoc(UNTITLED), null);
    if (isNL) {
      if (storage.degraded) {
        nativeFailed = true;
        showBanner();
      }
      // Com exitProcessOnClose:false o X só fecha se este listener existir (mesmo em modo degradado).
      root.__onWindowClose = async () => {
        const kill = setTimeout(forceExit, 5000);
        try {
          T.commitEdit();
          if (dirty) await saveMain();
        } catch (e) {
          /* recuperação já gravada */
        }
        clearTimeout(kill);
        forceExit();
      };
      try {
        Neutralino.events.on('windowClose', root.__onWindowClose);
      } catch (e) {
        console.error(e);
      }
    }
    // duplo clique num arquivo no Explorer: o Windows passa o caminho como argumento
    const arg = isNL ? QL.fileArgFrom(root.NL_ARGS) : null;
    if (!(arg && (await openPath(arg.replace(/\\/g, '/'), true)))) showStart();
    root.__ql = {
      get doc() {
        return doc;
      },
      get hist() {
        return hist;
      },
      storage,
      markDirty,
      saveMain,
      newBoard,
      openText,
      fit,
      serialize,
      get dirty() {
        return dirty;
      },
    };
  })().catch((e) => {
    console.error(e);
    const t = document.getElementById('toast');
    t.textContent = 'Erro ao iniciar: ' + e.message;
    t.classList.add('show');
  });
})(typeof window !== 'undefined' ? window : globalThis);
