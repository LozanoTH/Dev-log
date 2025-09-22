// ==UserScript==
// @name         Smart Resilient Loader - Full Pack
// @namespace    https://github.com/lozanoTH
// @version      2.2
// @description  Barra, retry queue, IDB cache, snapshots offline, rescue responsive y protector de páginas WebGL pesadas. Todo en un script. (Tampermonkey/Greasemonkey)
// @match        http://*/*
// @match        https://*/*
// @grant        LozanoTH
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ================= CONFIG ================= */
  const CONFIG = {
    BAR_HEIGHT_PX: 3,
    BAR_COLOR: 'linear-gradient(90deg,#4caf50,#8bc34a)',
    TIMEBOX_BG: 'rgba(0,0,0,0.7)',
    MAX_IMG_RETRIES: 3,
    RETRY_BASE_DELAY_MS: 700,
    MUTATION_DEBOUNCE_MS: 180,
    HIDE_AFTER_MS: 1200,
    SCROLL_THROTTLE_RAF: true,
    RESCUE_BODY_WIDTH_FACTOR: 1.25,
    RESCUE_CHECK_INTERVAL_MS: 900,
    RESCUE_APPLY_COOLDOWN_MS: 30_000,
    IDB_DB_NAME: 'resilient_loader_db_v1',
    IDB_STORE_NAME: 'resources',
    SNAPSHOT_KEY: 'resilient_snapshot_v1',
    SERIAL_RETRY_GAP_MS: 120,
    // Protector whitelist (if empty => protector available on any domain; otherwise only for listed hosts)
    WHITELIST_PROTECTOR: ['cznull.github.io', 'volumeshader_bm', 'antutu-html5-test'], // ajusta nombres/hosts
    // protector tuning
    PROTECTOR_FPS_THRESH: 20,
    PROTECTOR_LIMIT_FPS: 30,
    PROTECTOR_CRITICAL_FPS: 12,
  };

  /* ================= HELPERS ================= */
  const now = () => (performance && performance.now ? performance.now() : Date.now());
  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
  function tryCreateURL(u) { try { return new URL(u, location.href); } catch (e) { return null; } }
  function isLikelyImage(ct, url) {
    if (!ct) return !!url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
    return ct.includes('image') || url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  }

  /* ================= IndexedDB minimal wrapper ================= */
  const IDB = {
    db: null,
    async open() {
      if (this.db) return this.db;
      return new Promise((resolve, reject) => {
        const r = indexedDB.open(CONFIG.IDB_DB_NAME, 1);
        r.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(CONFIG.IDB_STORE_NAME)) {
            db.createObjectStore(CONFIG.IDB_STORE_NAME, { keyPath: 'key' });
          }
        };
        r.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
        r.onerror = e => reject(e.target.error);
      });
    },
    async put(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.IDB_STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = e => reject(e.target.error);
        tx.objectStore(CONFIG.IDB_STORE_NAME).put({ key, value, ts: Date.now() });
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.IDB_STORE_NAME, 'readonly');
        const req = tx.objectStore(CONFIG.IDB_STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
        req.onerror = e => reject(e.target.error);
      });
    },
    async del(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.IDB_STORE_NAME, 'readwrite');
        tx.objectStore(CONFIG.IDB_STORE_NAME).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = e => reject(e.target.error);
      });
    }
  };

  /* ================ UI (barra, timebox, banner, protector button) ================ */
  function ensureHeadBody(cb) {
    if (document.head && document.body) return cb();
    document.addEventListener('DOMContentLoaded', function once() {
      document.removeEventListener('DOMContentLoaded', once);
      cb();
    });
  }

  ensureHeadBody(() => {
    const style = document.createElement('style');
    style.id = 'smb-resilient-style';
    style.textContent = `
      #smb-resilient-bar{position:fixed;top:0;left:0;height:${CONFIG.BAR_HEIGHT_PX}px;width:0%;background:${CONFIG.BAR_COLOR};z-index:2147483647;transition:width 260ms cubic-bezier(.2,.8,.2,1),opacity 400ms;pointer-events:none}
      #smb-resilient-time{position:fixed;top:calc(${CONFIG.BAR_HEIGHT_PX}px + 6px);right:10px;font-family:monospace;font-size:12px;color:#bdf7b6;background:${CONFIG.TIMEBOX_BG};padding:3px 6px;border-radius:4px;display:none;z-index:2147483647;pointer-events:none}
      #smb-offline-banner{position:fixed;top:0;left:0;width:100%;background:#d32f2f;color:#fff;font-family:sans-serif;font-size:13px;text-align:center;padding:6px;z-index:2147483647;display:none}
      html.smb-rescue-mode *{box-sizing:border-box!important}
      html.smb-rescue-mode body{max-width:100vw!important;overflow-x:hidden!important;padding-left:8px!important;padding-right:8px!important}
      html.smb-rescue-mode img{max-width:100%!important;height:auto!important;display:block!important}
      html.smb-rescue-mode .smb-rescue-centered{max-width:100%!important;margin-left:auto!important;margin-right:auto!important}
      .smb-offline-placeholder{display:inline-block;width:100%;max-width:320px;height:150px;background:#444;color:#fff;font-size:12px;text-align:center;line-height:150px;margin:6px 0;border-radius:6px}
      #smb-protector-ui{position:fixed;right:10px;bottom:10px;z-index:2147483647;background:#ff5722;color:#fff;border:none;padding:8px;border-radius:8px;font-weight:bold;cursor:pointer;opacity:0.9}
      #smb-protector-info{position:fixed;right:10px;bottom:56px;z-index:2147483647;background:rgba(0,0,0,0.7);color:#fff;padding:8px;border-radius:6px;font-size:12px;display:none;max-width:260px}
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div'); bar.id = 'smb-resilient-bar'; document.documentElement.appendChild(bar);
    const timebox = document.createElement('div'); timebox.id = 'smb-resilient-time'; document.documentElement.appendChild(timebox);
    const banner = document.createElement('div'); banner.id = 'smb-offline-banner'; banner.textContent = '⚠️ Sin conexión — mostrando copia guardada/local'; document.documentElement.appendChild(banner);
    // const btn = document.createElement('button'); btn.id = 'smb-protector-ui'; btn.textContent = '🚨 Protector'; document.documentElement.appendChild(btn);
    const info = document.createElement('div'); info.id = 'smb-protector-info'; info.textContent = 'Protector: limita rAF, pausa animaciones, fuerza WebGL low-power.'; document.documentElement.appendChild(info);

  });

  const barEl = () => document.getElementById('smb-resilient-bar');
  const timeBox = () => document.getElementById('smb-resilient-time');
  const offlineBanner = () => document.getElementById('smb-offline-banner');

  function setProgress(p) { const b = barEl(); if (!b) return; b.style.opacity = ''; b.style.width = Math.min(100, Math.max(0, Math.round(p))) + '%'; }
  function showTime(text) { const t = timeBox(); if (!t) return; t.textContent = text; t.style.display = 'block'; }
  function hideSoon() { setTimeout(()=>{ const b = barEl(); if (b){ b.style.opacity='0'; setTimeout(()=>{b.style.width='0%'; b.style.opacity='';},450);} const t=timeBox(); if(t) t.style.display='none'; }, CONFIG.HIDE_AFTER_MS); }

  /* ================ PROGRESS CALC ================ */
  let startTs = now();
  function computeProgress() {
    const rs = document.readyState;
    let base = rs === 'loading' ? 10 : rs === 'interactive' ? 45 : 80;
    try {
      const imgs = Array.from(document.images || []);
      if (imgs.length) {
        const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0).length;
        const ratio = loaded / imgs.length;
        base += Math.round(ratio * 20);
      }
    } catch (e) {}
    return Math.min(99, base);
  }
  const tickInterval = setInterval(()=> setProgress(computeProgress()), 350);
  window.addEventListener('load', ()=> {
    setProgress(100);
    const total = ((now() - startTs)/1000).toFixed(2);
    showTime(`⏱ ${total}s`);
    clearInterval(tickInterval);
    hideSoon();
    saveSnapshotToIDB().catch(()=>{});
  });

  /* ================ CONNECTION AUTOTUNE ================ */
  function detectSlowConnection() {
    try {
      const nav = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (nav) {
        const down = nav.downlink || 0; const eff = nav.effectiveType || '';
        if (down > 0 && down < 0.05) return 'very-slow';
        if (eff && (eff === '2g' || eff === 'slow-2g')) return 'very-slow';
        if (down > 0 && down < 0.25) return 'slow';
        if (eff && eff === '3g') return 'slow';
        return 'normal';
      }
    } catch(e){}
    return 'unknown';
  }
  (function autotune(){ const tier = detectSlowConnection(); console.info('SMB autotune tier', tier);
    if (tier === 'very-slow') { CONFIG.MAX_IMG_RETRIES = 1; CONFIG.RETRY_BASE_DELAY_MS = 3000; CONFIG.MUTATION_DEBOUNCE_MS = 700; CONFIG.HIDE_AFTER_MS = 2600; showTime('⚠️ red muy lenta'); setTimeout(()=>{ const t=timeBox(); if(t) t.style.display='none';},2500); }
    else if (tier === 'slow') { CONFIG.MAX_IMG_RETRIES = 2; CONFIG.RETRY_BASE_DELAY_MS = 1400; CONFIG.MUTATION_DEBOUNCE_MS = 350; CONFIG.HIDE_AFTER_MS = 1800; showTime('⚠️ red lenta'); setTimeout(()=>{ const t=timeBox(); if(t) t.style.display='none';},1800); }
  })();

  /* ================ IDB SNAPSHOT & RESOURCE CACHE ================ */
  async function saveSnapshotToIDB() {
    try {
      const snapRoot = document.querySelector('main') || document.querySelector('article') || document.body;
      if (!snapRoot) return;
      const html = snapRoot.innerHTML;
      await IDB.put(CONFIG.SNAPSHOT_KEY, { url: location.href, time: new Date().toISOString(), html });
      console.info('Snapshot saved to IDB');
    } catch (e) { console.warn('Snapshot save failed', e); }
  }
  async function loadSnapshotFromIDB() {
    try {
      const d = await IDB.get(CONFIG.SNAPSHOT_KEY);
      return d;
    } catch (e) { return null; }
  }

  /* ================ RESILIENT FETCH + CACHE ================= */
  async function resilientFetchAndCache(url, retries = 5) {
    try {
      const cached = await IDB.get(url);
      if (cached) return cached;
    } catch(e){}
    for (let i=0;i<retries;i++) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const ct = res.headers.get('content-type') || '';
        if (isLikelyImage(ct, url)) {
          const blob = await res.blob();
          const dataUrl = await blobToDataURL(blob);
          await IDB.put(url, { type: 'img', data: dataUrl });
          return { type: 'img', data: dataUrl };
        } else if (ct.includes('application/json')) {
          const json = await res.json();
          await IDB.put(url, { type: 'json', data: json });
          return { type: 'json', data: json };
        } else {
          const text = await res.text();
          await IDB.put(url, { type: 'text', data: text });
          return { type: 'text', data: text };
        }
      } catch (e) {
        console.warn('Fetch failed', url, 'attempt', i+1, e);
        const wait = Math.round(CONFIG.RETRY_BASE_DELAY_MS * Math.pow(1.7, i) + Math.random()*200);
        await sleep(wait);
      }
    }
    const fallback = await IDB.get(url).catch(()=>undefined);
    if (fallback) return fallback;
    throw new Error('No se pudo recuperar ' + url);
  }
  function blobToDataURL(blob) {
    return new Promise((resolve,reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(r.result);
      r.onerror = e => reject(e);
      r.readAsDataURL(blob);
    });
  }

  /* ================ IMAGE HANDLING (init, queue, retries) ================ */
  function initImage(img) {
    if (!img || img.dataset.smbInited) return;
    img.dataset.smbInited = '1';
    if (!img.dataset.smbOrig) img.dataset.smbOrig = img.currentSrc || img.src || '';
    img.addEventListener('load', () => setProgress(computeProgress()));
    img.addEventListener('error', () => handleImgError(img));
  }
  async function handleImgError(img) {
    if (!img || !img.dataset) return;
    let retries = parseInt(img.dataset.smbRetries || '0', 10);
    if (retries >= CONFIG.MAX_IMG_RETRIES) { img.dataset.smbDead = '1'; return; }
    retries++; img.dataset.smbRetries = String(retries);
    const delay = Math.round(CONFIG.RETRY_BASE_DELAY_MS * Math.pow(1.7, retries) + Math.random()*200);
    queueImgRetry(img, delay);
  }
  const imgRetryQueue = [];
  let imgRetryProcessing = false;
  function queueImgRetry(img, delay) {
    imgRetryQueue.push({ img, delay });
    if (!imgRetryProcessing) processImgQueue();
  }
  async function processImgQueue() {
    imgRetryProcessing = true;
    while (imgRetryQueue.length) {
      const item = imgRetryQueue.shift();
      const img = item.img;
      const delay = item.delay;
      if (!img || img.dataset.smbDead === '1' || img.naturalWidth > 0) continue;
      await sleep(delay);
      const original = img.dataset.smbOrig || img.src || '';
      try {
        const res = await resilientFetchAndCache(original, CONFIG.MAX_IMG_RETRIES);
        if (res && res.type === 'img' && res.data) {
          img.src = res.data;
          img.dataset.smbRecovered = '1';
        } else if (res && res.type === 'text' && original.endsWith('.svg')) {
          img.src = 'data:image/svg+xml;base64,' + btoa(res.data);
        } else {
          if (!img.dataset.smbHasRetry) {
            const urlObj = tryCreateURL(original);
            if (urlObj) {
              urlObj.searchParams.set('smb_retry', String(Date.now()));
              img.dataset.smbHasRetry = '1';
              img.src = urlObj.toString();
            } else {
              img.src = original;
            }
          }
        }
        await sleep(CONFIG.SERIAL_RETRY_GAP_MS);
      } catch (e) {
        console.warn('processImgQueue unable to recover', original, e);
      }
    }
    imgRetryProcessing = false;
  }
  function fixBrokenImages(root = document) {
    try {
      const imgs = (root.querySelectorAll && root.querySelectorAll('img')) || [];
      imgs.forEach(initImage);
    } catch (e) {}
  }

  /* ================ MUTATION OBSERVER (debounced) ================ */
  (function setupMO(){
    let debounce = null;
    const mo = new MutationObserver(muts => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        muts.forEach(m => {
          m.addedNodes && m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'IMG') initImage(n);
            if (n.querySelectorAll) fixBrokenImages(n);
          });
        });
      }, CONFIG.MUTATION_DEBOUNCE_MS);
    });
    ensureHeadBody(()=> {
      try { mo.observe(document.body, { childList: true, subtree: true }); }
      catch(e) { console.warn('MO failed', e); }
    });
  })();

  /* ================ RESCUE RESPONSIVE ================ */
  let lastRescueAt = 0;
  function ensureViewportMeta() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport'; meta.content = 'width=device-width,initial-scale=1';
      document.head.appendChild(meta);
      return true;
    } else {
      if (!/width\s*=\s*device-width/i.test(meta.content)) {
        meta.content = 'width=device-width,initial-scale=1';
        return true;
      }
    }
    return false;
  }
  function applyRescueCSS() {
    if (!document.documentElement.classList.contains('smb-rescue-mode')) {
      document.documentElement.classList.add('smb-rescue-mode');
    }
    try {
      const candidates = Array.from(document.querySelectorAll('div, main, section, article')).slice(0,60);
      candidates.forEach(el => {
        const w = el.getBoundingClientRect().width;
        if (w > window.innerWidth * 0.95) el.classList.add('smb-rescue-centered');
      });
    } catch(e){}
  }
  function checkAndRescue() {
    try {
      const bodyRect = document.body ? document.body.getBoundingClientRect() : null;
      if (!bodyRect) return;
      const bodyW = bodyRect.width;
      if (bodyW > window.innerWidth * CONFIG.RESCUE_BODY_WIDTH_FACTOR) {
        const nowTs = Date.now();
        if (nowTs - lastRescueAt < CONFIG.RESCUE_APPLY_COOLDOWN_MS) return;
        lastRescueAt = nowTs;
        const added = ensureViewportMeta();
        applyRescueCSS();
        showTime('📱 Rescue aplicado (modo móvil)');
        setTimeout(()=>{ const t=timeBox(); if(t) t.style.display='none'; }, 2200);
        console.info('SMB Rescue applied. addedViewportMeta=', added);
      }
    } catch(e){ console.warn('rescue check error', e); }
  }
  const rescueInterval = setInterval(checkAndRescue, CONFIG.RESCUE_CHECK_INTERVAL_MS);
  window.addEventListener('beforeunload', ()=> clearInterval(rescueInterval));

  /* ================ NETWORK MONITOR & OFFLINE MODE ================ */
  function showSnapshotIfAvailable() {
    loadSnapshotFromIDB().then(snap => {
      if (snap && snap.html) {
        if (snap.url === location.href) {
          document.body.innerHTML = `<div id="smb-snapshot-banner" style="background:#222;color:#fff;padding:8px;text-align:center">⚠️ Mostrando copia guardada (offline)</div>` + snap.html;
        } else {
          const b = offlineBanner(); if (b) {
            b.textContent = '⚠️ Offline — copia local disponible para otra URL';
            b.style.display = 'block';
            setTimeout(()=>{ b.textContent='⚠️ Sin conexión — mostrando copia guardada/local'; }, 3500);
          }
        }
      }
    }).catch(()=>{});
  }
  function updateNetworkUI() {
    if (!navigator.onLine) {
      const b = offlineBanner(); if (b) b.style.display = 'block';
      showSnapshotIfAvailable();
    } else {
      const b = offlineBanner(); if (b) b.style.display = 'none';
      if (imgRetryQueue.length && !imgRetryProcessing) processImgQueue();
    }
    const t = timeBox();
    if (t) t.textContent = navigator.onLine ? `📶 ${(navigator.connection && navigator.connection.effectiveType) || 'online'}` : '⚠️ offline';
    if (!navigator.onLine) t.style.display = 'block'; else setTimeout(()=>{ if(t) t.style.display = 'none'; }, 1800);
  }
  window.addEventListener('online', updateNetworkUI);
  window.addEventListener('offline', updateNetworkUI);
  updateNetworkUI();

  /* ================ INIT: process existing images & prefetch small resources ================ */
  ensureHeadBody(()=> {
    fixBrokenImages(document);
    setTimeout(checkAndRescue, 600);
    try {
      const imgs = Array.from(document.images || []);
      imgs.forEach(img => {
        if (!img.dataset.smbInited) initImage(img);
        if (!img.complete || img.naturalWidth === 0) {
          queueImgRetry(img, Math.round(Math.random()*800 + 600));
        }
      });
    } catch(e){}
  });

  /* ================ DEBUG API ================ */
  Object.defineProperty(window, '__SMB_RESILIENT', {
    value: {
      setProgress, computeProgress, resilientFetchAndCache, IDB, CONFIG, saveSnapshotToIDB, loadSnapshotFromIDB
    },
    writable: false, configurable: true
  });

  /* =================== HEAVY PAGE PROTECTOR (WebGL / Shaders) =================== */
  const PROTECTOR = (function(){
    const self = {
      enabled: false,
      autoEnabled: false,
      rAFSamples: [],
      originalRAF: window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null,
      originalCancelRAF: window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : null,
      originalSetInterval: window.setInterval.bind(window),
      originalSetTimeout: window.setTimeout.bind(window),
      patchedRAF: null,
      patchedTimers: false,
      patchedGetContext: false
    };

    function hostAllowed() {
      if (!CONFIG.WHITELIST_PROTECTOR || CONFIG.WHITELIST_PROTECTOR.length === 0) return true;
      const host = location.hostname || '';
      return CONFIG.WHITELIST_PROTECTOR.some(h => host.includes(h));
    }

    function createThrottledRAF(limitFps) {
      const frameMs = 1000 / limitFps;
      let last = performance.now();
      return function(cb) {
        const nowTs = performance.now();
        const wait = Math.max(0, frameMs - (nowTs - last));
        const id = setTimeout(()=>{ last = performance.now(); try{ cb(last); }catch(e){} }, wait);
        return id;
      };
    }

    function patchRAF(limit) {
      if (!window.requestAnimationFrame || self.patchedRAF) return;
      self.patchedRAF = createThrottledRAF(limit);
      window.requestAnimationFrame = function(cb){ return self.patchedRAF(cb); };
      window.cancelAnimationFrame = function(id){ clearTimeout(id); };
    }
    function restoreRAF() {
      if (!self.patchedRAF) return;
      try { if (self.originalRAF) window.requestAnimationFrame = self.originalRAF; } catch(e){}
      try { if (self.originalCancelRAF) window.cancelAnimationFrame = self.originalCancelRAF; } catch(e){}
      self.patchedRAF = null;
    }

    function patchTimers() {
      if (self.patchedTimers) return;
      window.setInterval = function(fn, t, ...args){ const min = Math.max(250, t||250); return self.originalSetInterval(fn, min, ...args); };
      window.setTimeout = function(fn, t, ...args){ const min = Math.max(8, t||8); return self.originalSetTimeout(fn, min, ...args); };
      self.patchedTimers = true;
    }
    function restoreTimers() {
      if (!self.patchedTimers) return;
      try { window.setInterval = self.originalSetInterval; window.setTimeout = self.originalSetTimeout; } catch(e){}
      self.patchedTimers = false;
    }

    function patchCanvasGetContext() {
      if (self.patchedGetContext) return;
      const proto = HTMLCanvasElement && HTMLCanvasElement.prototype;
      if (!proto) return;
      const orig = proto.getContext;
      proto.getContext = function(type, attrs) {
        try {
          if (type && (type.includes('webgl')||type.includes('experimental'))) {
            attrs = Object.assign({}, attrs || {}, { antialias: false, preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
          }
        } catch(e){}
        return orig.call(this, type, attrs);
      };
      self.patchedGetContext = true;
    }

    function throttleAudio() {
      try {
        document.querySelectorAll('audio,video').forEach(el => {
          try{ if (!el.paused) el.pause(); el.muted = true; el.preload = 'none'; } catch(e){}
        });
      } catch(e){}
    }

    let protCSS = null;
    function insertProtectorCSS() {
      if (protCSS) return;
      protCSS = document.createElement('style');
      protCSS.id = 'smb-protector-css';
      protCSS.textContent = `.smb-protector-active *{animation-play-state:paused!important;transition:none!important}.smb-protector-active canvas{image-rendering:pixelated!important;max-width:100%!important}`;
      document.head && document.head.appendChild(protCSS);
    }
    function removeProtectorCSS(){ if (protCSS){ try{ protCSS.remove(); }catch(e){} protCSS=null; } }

    function apply(on) {
      if (on) {
        if (!hostAllowed()) { console.info('Protector: host not whitelisted, skipping auto patch'); }
        patchRAF(CONFIG.PROTECTOR_LIMIT_FPS);
        patchTimers();
        patchCanvasGetContext();
        throttleAudio();
        document.documentElement.classList.add('smb-protector-active');
        insertProtectorCSS();
        self.enabled = true;
      } else {
        restoreRAF(); restoreTimers(); removeProtectorCSS();
        document.documentElement.classList.remove('smb-protector-active');
        self.enabled = false;
        // note: restoring original canvas.getContext isn't trivial; recommend reload if issues.
      }
    }

    function startFPSMonitor() {
      if (!self.originalRAF) return;
      let lastTs = performance.now();
      function tick(ts) {
        const delta = ts - lastTs; lastTs = ts;
        const fps = 1000 / Math.max(1, delta);
        self.rAFSamples.push({ts, fps});
        const cutoff = performance.now() - 3000;
        while (self.rAFSamples.length && self.rAFSamples[0].ts < cutoff) self.rAFSamples.shift();
        const avg = self.rAFSamples.reduce((s,i)=>s+i.fps,0) / (self.rAFSamples.length||1);
        if (!self.autoEnabled && avg < CONFIG.PROTECTOR_FPS_THRESH && hostAllowed()) {
          self.autoEnabled = true; apply(true);
          console.warn('SMB Protector: rendimiento bajo detectado — activando protección automática (avg fps ~', Math.round(avg), ')');
        }
        self.originalRAF(tick);
      }
      self.originalRAF(tick);
    }

    function watchWebGLContexts() {
      const orig = HTMLCanvasElement && HTMLCanvasElement.prototype.getContext;
      if (!orig) return;
      let events = [];
      const windowMs = 5000;
      const limit = 6;
      HTMLCanvasElement.prototype.getContext = function(type) {
        const res = orig.apply(this, arguments);
        try {
          if (type && type.includes && (type.includes('webgl') || type.includes('experimental'))) {
            const ts = Date.now();
            events.push(ts);
            events = events.filter(t=>t>ts-windowMs);
            if (events.length > limit && hostAllowed()) {
              self.autoEnabled = true; apply(true);
              console.warn('SMB Protector: demasiados contextos WebGL detectados, protección activada.');
            }
          }
        } catch(e){}
        return res;
      };
    }

    function observeLargeCanvas() {
      const obs = new MutationObserver(muts => {
        muts.forEach(m => {
          m.addedNodes && m.addedNodes.forEach(n => {
            try {
              if (n.tagName === 'CANVAS' && n.width * n.height > (window.innerWidth * window.innerHeight * 2) && hostAllowed()) {
                self.autoEnabled = true; apply(true); console.warn('SMB Protector: canvas muy grande detectado, activando protección.');
              }
            } catch(e){}
          });
        });
      });
      ensureHeadBody(()=>{ try{ obs.observe(document.body, { childList: true, subtree: true }); }catch(e){} });
    }

    return {
      enabled: self.enabled,
      autoEnabled: self.autoEnabled,
      start() { startFPSMonitor(); watchWebGLContexts(); observeLargeCanvas(); },
      apply(on){ apply(on); },
      toggleManual() { apply(!self.enabled); },
      status(){ return { enabled: self.enabled, auto: self.autoEnabled }; }
    };
  })();

  PROTECTOR.start();

  /* ================ PROTECTOR DEBUG API ================ */
  window.__SMB_HEAVY_PROTECTOR = {
    enable: ()=> PROTECTOR.apply(true),
    disable: ()=> PROTECTOR.apply(false),
    status: ()=> PROTECTOR.status()
  };

  /* ================ END OF SCRIPT ================ */
})();
