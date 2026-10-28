/* ===========================================================================
   Quadro Leve - storage.js
   Camada de persistência com a mesma interface em duas implementações:
   NeutralinoStorage (disco, gravação atômica) e BrowserStorage (IndexedDB).
   Storage { listRecents, load(path), save(path, text, meta), saveAs(nome, text),
             pickOpen(), getRecoveryPath(id), writeRecovery(id, text),
             readRecovery(id), clearRecovery(id), addRecent(entry), exportBlob(nome, blob) }
   =========================================================================== */
(function (root) {
  'use strict';
  const QL = root.QL;

  function safeName(n) {
    return (
      String(n || 'Quadro')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Quadro'
    );
  }
  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }
  function downloadText(name, text) {
    downloadBlob(name, new Blob([text], { type: 'application/json' }));
  }
  const EXT = QL.EXT;
  const FILTERS = [{ name: 'Quadro Leve', extensions: [EXT.slice(1), 'board.json', 'json'] }];

  /* ------------------------------ Neutralino ------------------------------ */
  class NeutralinoStorage {
    constructor() {
      this.kind = 'neutralino';
      this.dir = null;
      this._running = false;
      this._pending = new Map(); // path -> {text, waiters[]}
    }
    async init() {
      const docs = await Neutralino.os.getPath('documents');
      this.dir = String(docs).replace(/\\/g, '/').replace(/\/$/, '') + '/Quadro Leve';
      await this._mkdir(this.dir);
      await this._mkdir(this.dir + '/_recuperacao');
    }
    _fs() {
      return Neutralino.filesystem;
    }
    async _exists(p) {
      try {
        await this._fs().getStats(p);
        return true;
      } catch (e) {
        return false;
      }
    }
    async _mkdir(p) {
      if (!(await this._exists(p))) await this._fs().createDirectory(p);
    }
    _native(p) {
      return root.NL_OS === 'Windows' ? p.replace(/\//g, '\\') : p;
    }

    async defaultPathFor(name, id) {
      const base = this.dir + '/' + safeName(name);
      let p = base + EXT;
      if (await this._exists(p)) p = base + ' ' + String(id || QL.uuid()).slice(0, 6) + EXT;
      return p;
    }
    async _tryRead(p) {
      try {
        const t = await this._fs().readFile(p);
        JSON.parse(t);
        return t;
      } catch (e) {
        return null;
      }
    }
    async _mtime(p) {
      try {
        const st = await this._fs().getStats(p);
        return st.modifiedAt || 0;
      } catch (e) {
        return 0;
      }
    }
    // Lê o principal; se um .tmp válido for mais novo (queda no meio do save atômico), usa o .tmp;
    // se o principal faltar ou estiver quebrado, tenta .tmp e depois .bak.
    async load(path) {
      const [main, tmp] = await Promise.all([this._tryRead(path), this._tryRead(path + '.tmp')]);
      if (main && tmp) return (await this._mtime(path + '.tmp')) > (await this._mtime(path)) ? tmp : main;
      if (main || tmp) return main || tmp;
      const bak = await this._tryRead(path + '.bak');
      if (bak) return bak;
      throw new Error('Não consegui ler o quadro (arquivo ausente ou corrompido).');
    }
    // Fila serial: um save por vez; os que chegam enquanto roda viram um só pendente (o mais novo).
    save(path, text) {
      return new Promise((res, rej) => {
        const cur = this._pending.get(path);
        if (cur) {
          cur.text = text;
          cur.waiters.push({ res, rej });
        } else this._pending.set(path, { text, waiters: [{ res, rej }] });
        if (!this._running) this._drain();
      });
    }
    async _drain() {
      this._running = true;
      while (this._pending.size) {
        const [path, job] = this._pending.entries().next().value;
        this._pending.delete(path);
        let err = null;
        try {
          await this._atomic(path, job.text);
        } catch (e) {
          err = e;
        }
        for (const w of job.waiters) err ? w.rej(err) : w.res();
      }
      this._running = false;
    }
    // .tmp -> (principal vira .bak) -> .tmp vira principal
    async _atomic(path, text) {
      const fs = this._fs(),
        tmp = path + '.tmp',
        bak = path + '.bak';
      // Defender/OneDrive podem segurar o arquivo por alguns ms: cada passo tenta até 3 vezes.
      const retry = async (fn) => {
        let err;
        for (let i = 0; i < 3; i++) {
          try {
            return await fn();
          } catch (e) {
            err = e;
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        throw err;
      };
      await retry(() => fs.writeFile(tmp, text));
      const had = await this._exists(path);
      if (had) {
        if (await this._exists(bak)) await retry(() => fs.remove(bak));
        await retry(() => fs.move(path, bak));
      }
      try {
        await retry(() => fs.move(tmp, path));
      } catch (e) {
        if (had) {
          try {
            await retry(() => fs.move(bak, path));
          } catch (e2) {
            /* nada */
          }
        }
        throw e;
      }
    }
    async saveAs(suggested, text) {
      const def = this._native(this.dir + '/' + safeName(suggested) + EXT);
      let p = await Neutralino.os.showSaveDialog('Salvar quadro como', { defaultPath: def, filters: FILTERS });
      if (!p) return null;
      if (!/\.(quadro|json)$/i.test(p)) p += EXT;
      await this.save(p, text);
      return p;
    }
    async pickOpen() {
      const r = await Neutralino.os.showOpenDialog('Abrir quadro', {
        defaultPath: this._native(this.dir),
        filters: FILTERS,
        multiSelections: false,
      });
      if (!r || !r.length) return null;
      return { path: r[0], text: await this.load(r[0]) };
    }
    getRecoveryPath(id) {
      return this.dir + '/_recuperacao/' + id + '.json';
    }
    async writeRecovery(id, text) {
      await this._fs().writeFile(this.getRecoveryPath(id), text);
    }
    async readRecovery(id) {
      try {
        return await this._fs().readFile(this.getRecoveryPath(id));
      } catch (e) {
        return null;
      }
    }
    async clearRecovery(id) {
      try {
        await this._fs().remove(this.getRecoveryPath(id));
      } catch (e) {
        /* ok */
      }
    }
    async _readRecents() {
      try {
        const a = JSON.parse(await this._fs().readFile(this.dir + '/recentes.json'));
        return Array.isArray(a) ? a.map((r) => Object.assign({}, r, { path: String(r.path).replace(/\\/g, '/') })) : [];
      } catch (e) {
        return [];
      }
    }
    async listRecents() {
      const a = await this._readRecents();
      const ok = await Promise.all(
        a.map(
          async (r) =>
            (await this._exists(r.path)) ||
            (await this._exists(r.path + '.tmp')) ||
            (await this._exists(r.path + '.bak'))
        )
      );
      return a.filter((r, i) => ok[i]);
    }
    async addRecent(entry) {
      const np = String(entry.path).replace(/\\/g, '/');
      const a = (await this._readRecents()).filter((r) => r.path !== np);
      a.unshift({ path: np, name: entry.name, updatedAt: entry.updatedAt });
      await this._fs().writeFile(this.dir + '/recentes.json', JSON.stringify(a.slice(0, 20)));
    }
    async exportBlob(name, blob) {
      const def = this._native(this.dir + '/' + safeName(name));
      let p = await Neutralino.os.showSaveDialog('Exportar imagem', {
        defaultPath: def,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (!p) return null;
      if (!/\.png$/i.test(p)) p += '.png';
      await this._fs().writeBinaryFile(p, await blob.arrayBuffer());
      return p;
    }
    describe() {
      return 'Documentos/Quadro Leve';
    }
  }

  /* ------------------------------ Navegador ------------------------------- */
  // Em Neutralino a recuperação de verdade é em disco (_recuperacao); o IndexedDB é só espelho de melhor esforço
  // (a origem do navegador pode mudar entre execuções, já que a porta é aleatória).
  class BrowserStorage {
    constructor() {
      this.kind = 'browser';
      this._db = null;
    }
    init() {
      return new Promise((res, rej) => {
        if (!root.indexedDB) {
          rej(new Error('IndexedDB indisponível'));
          return;
        }
        const rq = indexedDB.open('quadro-leve', 1);
        rq.onupgradeneeded = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'path' });
          if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'id' });
        };
        rq.onsuccess = () => {
          this._db = rq.result;
          res();
        };
        rq.onerror = () => rej(rq.error);
      });
    }
    _tx(store, mode, fn) {
      return new Promise((res, rej) => {
        if (!this._db) {
          rej(new Error('Banco indisponível'));
          return;
        }
        const tx = this._db.transaction(store, mode),
          st = tx.objectStore(store);
        let out;
        const rq = fn(st);
        if (rq)
          rq.onsuccess = () => {
            out = rq.result;
          };
        tx.oncomplete = () => res(out);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
    }
    async defaultPathFor(name, id) {
      return 'idb:' + id;
    }
    async load(path) {
      const r = await this._tx('boards', 'readonly', (s) => s.get(path));
      if (!r) throw new Error('Quadro não encontrado');
      return r.text;
    }
    save(path, text, meta) {
      meta = meta || {};
      return this._tx('boards', 'readwrite', (s) =>
        s.put({ path, text, name: meta.name || 'Quadro', updatedAt: meta.updatedAt || QL.nowIso() })
      );
    }
    async saveAs(suggested, text) {
      downloadText(safeName(suggested) + EXT, text);
      return null;
    }
    pickOpen() {
      return new Promise((res) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = EXT + ',.json,application/json';
        inp.onchange = async () => {
          const f = inp.files && inp.files[0];
          res(f ? { path: null, text: await f.text(), name: f.name } : null);
        };
        inp.oncancel = () => res(null);
        inp.click();
      });
    }
    getRecoveryPath(id) {
      return 'idb-recovery:' + id;
    }
    writeRecovery(id, text) {
      return this._tx('recovery', 'readwrite', (s) => s.put({ id, text, at: Date.now() }));
    }
    async readRecovery(id) {
      const r = await this._tx('recovery', 'readonly', (s) => s.get(id));
      return r ? r.text : null;
    }
    clearRecovery(id) {
      return this._tx('recovery', 'readwrite', (s) => s.delete(id)).catch(() => {});
    }
    async listRecents() {
      const all = await this._tx('boards', 'readonly', (s) => s.getAll());
      return (all || [])
        .map((r) => ({ path: r.path, name: r.name, updatedAt: r.updatedAt }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 20);
    }
    async addRecent() {
      /* a própria lista de quadros já é o histórico */
    }
    async exportBlob(name, blob) {
      downloadBlob(safeName(name), blob);
      return 'download';
    }
    describe() {
      return 'neste navegador (IndexedDB)';
    }
  }

  // Preferências do usuário (não do documento): localStorage, espelhado no Neutralino.storage quando existe.
  // Com porta aleatória a origem muda entre execuções: por isso o Neutralino.storage é a fonte nas execuções seguintes.
  const nativeStorage = () => (root.NL_PORT && root.Neutralino && root.Neutralino.storage) || null;
  const prefs = {
    get(k) {
      try {
        return localStorage.getItem('ql.' + k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('ql.' + k, v);
      } catch (e) {
        /* sem localStorage: segue só com o nativo */
      }
      const ns = nativeStorage();
      if (ns) ns.setData('ql.' + k, String(v)).catch(() => {});
    },
    // valor salvo; se o localStorage estiver vazio (primeira execução do app nativo), busca no nativo
    async load(k) {
      let v = this.get(k);
      const ns = nativeStorage();
      if (v == null && ns) {
        try {
          v = await ns.getData('ql.' + k);
          this.set(k, v);
        } catch (e) {
          v = null;
        }
      }
      return v;
    },
  };

  // Cria o Storage certo. Neutralino só se o runtime estiver mesmo presente e iniciar.
  async function createStorage() {
    if (root.NL_PORT) {
      // Dentro do Neutralino nunca cai em silêncio para o navegador: se o runtime não responder,
      // segue "degradado" (faixa vermelha + download de cópia) e o app avisa.
      const s = new NeutralinoStorage();
      try {
        if (!root.Neutralino) throw new Error('neutralino.js ausente');
        root.Neutralino.init();
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('Neutralino não respondeu em 15 s')), 15000);
          root.Neutralino.events.on('ready', () => {
            clearTimeout(t);
            res();
          });
        });
        await s.init();
      } catch (e) {
        console.error('Neutralino degradado:', e);
        s.degraded = true;
      }
      return s;
    }
    const b = new BrowserStorage();
    try {
      await b.init();
    } catch (e) {
      console.warn('IndexedDB indisponível', e);
      b._db = null;
    }
    return b;
  }

  QL.storage = { BrowserStorage, createStorage, safeName, downloadText, prefs };
})(typeof window !== 'undefined' ? window : globalThis);
