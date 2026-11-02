/* HAE LMS browser runtime: runs the real Node.js/Express server code inside the page.
   Provides tiny stand-ins for express, cookie-parser, jsonwebtoken, crypto, path, fs and the SQLite driver,
   then answers the app's fetch("/api/...") and EventSource("/api/events") calls locally. */
(function () {
  "use strict";
  const STORE_KEY = "hae_lms_demo_db_v1", COOKIE_KEY = "hae_lms_demo_cookie_v1";
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }, del(k) { try { sessionStorage.removeItem(k); } catch (e) {} } };

  /* ---------------- process / timers ---------------- */
  const process = { env: { TZ: "Asia/Kolkata", JWT_SECRET: "browser-demo", SHOW_DEMO_LOGINS: "true", SEED_DEMO: "true", PLATFORM_ADMIN_EMAILS: "superadmin@hae.demo", DB_FILE: "/data/hae-lms.db" },
    argv: ["node", "script"], version: "v22.13.0", exit(code) { const e = new Error("process.exit(" + code + ")"); e.isExit = true; throw e; } };
  const setIntervalShim = (fn, ms) => { const id = setInterval(fn, ms); return { unref() {}, id }; };

  /* ---------------- base64 helpers ---------------- */
  const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));

  /* ---------------- SQLite (sql.js, pure JS build) ---------------- */
  let SQL = null, raw = null, persistTimer = null, storageOk = true;
  function pragmas() { raw.exec("PRAGMA foreign_keys = ON;"); }
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { const bytes = raw.export(); pragmas(); storageOk = ls.set(STORE_KEY, toB64(bytes)); } catch (e) { storageOk = false; }
    }, 300);
  }
  const clean = v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
  const bindArgs = a => {
    if (a.length === 1 && a[0] && typeof a[0] === "object" && !Array.isArray(a[0])) { const o = {}; for (const [k, v] of Object.entries(a[0])) o["@" + k] = clean(v); return o; }
    return a.map(clean);
  };
  let depth = 0;
  const dbShim = {
    driver: "sql.js (in your browser)",
    exec(sql) { raw.exec(sql); },
    prepare(sql) {
      return {
        get(...a) { const st = raw.prepare(sql); try { st.bind(bindArgs(a)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); } },
        all(...a) { const st = raw.prepare(sql); const out = []; try { st.bind(bindArgs(a)); while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); } },
        run(...a) { const st = raw.prepare(sql); try { st.run(bindArgs(a)); return { changes: raw.getRowsModified() }; } finally { st.free(); } },
      };
    },
    transaction(fn) {
      return (...a) => {
        const sp = "sp" + depth; raw.exec(depth ? "SAVEPOINT " + sp : "BEGIN"); depth++;
        try { const out = fn(...a); depth--; raw.exec(depth ? "RELEASE " + sp : "COMMIT"); return out; }
        catch (e) { depth--; raw.exec(depth ? "ROLLBACK TO " + sp + "; RELEASE " + sp : "ROLLBACK"); throw e; }
      };
    },
  };

  /* ---------------- crypto / jwt / path / fs ---------------- */
  const hex = n => Array.from(window.crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");
  const cryptoShim = {
    randomUUID: () => (window.crypto.randomUUID ? window.crypto.randomUUID() : hex(16).replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-")),
    randomBytes: n => ({ toString: () => hex(n) }),
    createHmac() { throw Object.assign(new Error("Online payments aren't available in the demo."), { status: 503 }); },
    timingSafeEqual: () => false,
  };
  const sessions = new Map();
  const jwtShim = {
    sign(payload, secret, opts) { const t = hex(24); sessions.set(t, { ...payload, exp: Date.now() + (/30d/.test(opts?.expiresIn) ? 30 * 864e5 : 12 * 36e5) }); return t; },
    verify(tok) { let p = sessions.get(tok); if (!p) { const saved = parseCookie(); if (saved && saved.v === tok) { p = saved.p; sessions.set(tok, p); } } if (!p || p.exp < Date.now()) throw new Error("bad token"); return p; },
  };
  const pathShim = { join: (...p) => p.join("/").replace(/\/+/g, "/"), dirname: p => String(p).replace(/\/[^/]*$/, "") || "/" };
  const fsShim = { mkdirSync() {}, existsSync: () => true, readFileSync: () => "demo", writeFileSync() {} };

  /* ---------------- cookies (session) ---------------- */
  const jar = {};
  function parseCookie() { try { return JSON.parse(ls.get(COOKIE_KEY) || ss.get(COOKIE_KEY) || "null"); } catch (e) { return null; } }
  (function loadCookie() { const c = parseCookie(); if (c && c.p && c.p.exp > Date.now()) { jar[c.name] = c.v; sessions.set(c.v, c.p); } })();

  /* ---------------- express stand-in ---------------- */
  function compile(path) {
    if (path === "/{*splat}") return /^\/.*$/;
    return new RegExp("^" + path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([A-Za-z_]+)/g, "(?<$1>[^/]+)") + "/?$");
  }
  function expressShim() {
    const stack = [];
    const add = (method, path, fns) => fns.flat().forEach(fn => stack.push({ method, path, re: path && method ? compile(path) : null, fn }));
    const app = {
      set() {}, disable() {}, listen(port, cb) { cb && cb(); },
      use(path, ...fns) { if (typeof path === "function") { fns.unshift(path); path = null; } add(null, path, fns); },
      get: (p, ...f) => add("GET", p, f), post: (p, ...f) => add("POST", p, f), put: (p, ...f) => add("PUT", p, f), delete: (p, ...f) => add("DELETE", p, f),
      handle(req, res) {
        let i = 0;
        const next = err => {
          while (i < stack.length) {
            const L = stack[i++];
            if (L.method) { if (L.method !== req.method) continue; const m = req.path.match(L.re); if (!m) continue; req.params = { ...(m.groups || {}) }; }
            else if (L.path && !(req.path === L.path || req.path.startsWith(L.path + "/"))) continue;
            const isErr = L.fn.length === 4;
            if (err ? !isErr : isErr) continue;
            try { return err ? L.fn(err, req, res, next) : L.fn(req, res, next); } catch (e) { return next(e); }
          }
          if (err) { console.error(err); res.status(500).json({ error: "Something went wrong." }); } else res.status(404).json({ error: "Not found." });
        };
        next();
      },
    };
    return app;
  }
  const express = Object.assign(expressShim, {
    json: () => (req, res, next) => { if (typeof req.rawBody !== "string" || !req.rawBody) { req.body = req.body || {}; return next(); } try { req.body = JSON.parse(req.rawBody); next(); } catch (e) { next({ type: "entity.parse.failed" }); } },
    raw: () => (req, res, next) => { req.body = req.rawBody || ""; next(); },
    static: () => (req, res, next) => next(),
  });
  const cookieParser = () => (req, res, next) => { req.cookies = { ...jar }; next(); };

  /* ---------------- module loader for the real server files ---------------- */
  const factories = window.__HAE_MODULES__ || {}, cache = {};
  function req(name) {
    const builtin = { express, "cookie-parser": cookieParser, jsonwebtoken: jwtShim, bcryptjs: window.__bcrypt, crypto: cryptoShim, path: pathShim, fs: fsShim, "./db": dbShim, "./env": {} }[name];
    if (builtin) return builtin;
    const key = name.replace(/^\.\//, "").replace(/\.js$/, "");
    if (cache[key]) return cache[key].exports;
    const f = factories[key]; if (!f) throw new Error("Module not found: " + name);
    const module = { exports: {} }; cache[key] = module;
    f(module, module.exports, req, process, setIntervalShim, "/app/src");
    return module.exports;
  }

  /* ---------------- boot: open DB, seed if empty, start server ---------------- */
  let app = null, bootError = null;
  const ready = (async () => {
    try {
      SQL = await window.initSqlJs({});
      const saved = ls.get(STORE_KEY);
      raw = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
      pragmas();
      raw.exec(window.__HAE_SCHEMA__);
      const fresh = !dbShim.prepare("SELECT 1 FROM orgs").get();
      // capture the Express app the server file creates
      const realExpress = express; let captured = null;
      const wrapped = Object.assign((...a) => (captured = realExpress(...a)), realExpress);
      const origReq = req;
      if (fresh) { req("seed"); persist(); }
      const f = factories["server"]; const module = { exports: {} };
      f(module, module.exports, n => n === "express" ? wrapped : origReq(n), process, setIntervalShim, "/app/src");
      app = captured;
    } catch (e) { bootError = e; console.error("HAE LMS demo failed to start", e); }
  })();

  /* ---------------- request runner ---------------- */
  function run(method, url, bodyText, headers = {}, sse) {
    const u = new URL(url, location.href);
    const req = { method, path: u.pathname, url: u.pathname + u.search, query: Object.fromEntries(u.searchParams), headers, ip: "127.0.0.1", rawBody: bodyText, body: undefined,
      params: {}, _close: [], get(h) { return headers[String(h).toLowerCase()]; }, on(ev, fn) { if (ev === "close") this._close.push(fn); } };
    return new Promise(resolve => {
      let status = 200; const hdr = {};
      const res = {
        status(c) { status = c; return res; }, set(k, v) { if (typeof k === "object") Object.assign(hdr, k); else hdr[k] = v; return res; },
        json(obj) { resolve({ status, body: JSON.stringify(obj === undefined ? null : obj) }); return res; },
        end(b) { resolve({ status, body: b || "" }); return res; },
        sendFile() { resolve({ status: 404, body: JSON.stringify({ error: "Not found." }) }); },
        cookie(name, val, opts = {}) {
          jar[name] = val; const rec = JSON.stringify({ name, v: val, p: sessions.get(val) });
          if (opts.maxAge) { ls.set(COOKIE_KEY, rec); ss.del(COOKIE_KEY); } else { ss.set(COOKIE_KEY, rec); ls.del(COOKIE_KEY); }
          return res;
        },
        clearCookie(name) { const v = jar[name]; delete jar[name]; if (v) sessions.delete(v); ls.del(COOKIE_KEY); ss.del(COOKIE_KEY); return res; },
        flushHeaders() { if (sse) sse.open(); }, write(chunk) { if (sse) sse.chunk(String(chunk)); return true; },
      };
      if (sse) sse.req = req;
      app.handle(req, res);
    });
  }

  /* ---------------- fetch + EventSource interception ---------------- */
  const realFetch = window.fetch.bind(window);
  const isApi = url => { try { return new URL(url, location.href).pathname.startsWith("/api/"); } catch (e) { return false; } };
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    if (!isApi(url)) return realFetch(input, init);
    await ready;
    if (!app) return new Response(JSON.stringify({ error: "The demo couldn't start in this browser." }), { status: 503, headers: { "Content-Type": "application/json" } });
    const method = (init.method || "GET").toUpperCase();
    const headers = {}; new Headers(init.headers || {}).forEach((v, k) => headers[k] = v);
    const out = await run(method, url, typeof init.body === "string" ? init.body : "", headers);
    if (method !== "GET") persist();
    return new Response(out.body, { status: out.status, headers: { "Content-Type": "application/json" } });
  };
  class DemoEventSource {
    constructor(url) {
      this.url = url; this.listeners = {}; this.onerror = null; this.readyState = 0; this.closed = false;
      const self = this;
      ready.then(() => {
        if (!app || self.closed) return;
        const sse = { open() { self.readyState = 1; }, chunk(text) { const m = text.match(/^event: (\w+)/m); if (m) (self.listeners[m[1]] || []).forEach(fn => fn({ data: "{}" })); } };
        self.sse = sse;
        run("GET", url, "", {}, sse).then(r => { if (r.status !== 200 && !self.closed) { self.readyState = 2; self.onerror && self.onerror({}); } });
      });
    }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    close() { this.closed = true; this.readyState = 2; (this.sse?.req?._close || []).forEach(fn => fn()); }
  }
  window.EventSource = DemoEventSource;

  /* ---------------- demo controls ---------------- */
  window.__HAE_DEMO__ = {
    ready, get storageOk() { return storageOk; },
    reset() { ls.del(STORE_KEY); ls.del(COOKIE_KEY); ss.del(COOKIE_KEY); location.reload(); },
  };
})();
