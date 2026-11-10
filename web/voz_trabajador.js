/* 2.0.0 - La voz de alta calidad de Pixel dentro del navegador: Supertonic 3 (Supertone; modelo OpenRAIL-M,
   codigo de ejemplo MIT), en un hilo aparte que voz.js arranca. Sigue el algoritmo de su ejemplo oficial
   (web/helper.js de github.com/supertone-inc/supertonic):
     texto -> numeros de letras (unicode_indexer) -> duracion (duration_predictor) y texto (text_encoder)
     -> ruido que se limpia en N pasos (vector_estimator) -> sonido a 44,1 kHz (vocoder).
   Lee letras, no fonemas: no necesita espeak. voz.js ya le pasa los numeros escritos en palabras.
   Con WebGPU (la tarjeta grafica: Chrome en muchos Android) va mucho mas rapido; si no hay o falla,
   WebAssembly de un hilo (varios hilos piden "aislar" la pagina, y eso rompe YouTube y el acceso con Google).
   Va en un hilo aparte para que la cara no se congele mientras genera.
   Todo se baja una sola vez (unos 400 MB) y queda en la cache del navegador (CACHE).
   Mensajes: {tipo: "preparar", base} -> "progreso" {hecho, total}... y "lista" {ep} (o "error");
             {tipo: "decir", n, base, texto, voz, pasos, velocidad} -> {tipo: "audio", n, pcm, sr, ms, ep} (o "error");
             {tipo: "callar", desde}; {tipo: "borrar"} -> "borrada". */
"use strict";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.mjs";
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const CACHE = "pixel-voces-2";
const PARTES = [["duration_predictor", 3700147], ["text_encoder", 36416150], ["vector_estimator", 256534781], ["vocoder", 101424195]];
const TOTAL = PARTES.reduce((s, p) => s + p[1], 0);

let ort = null, cfg = null, indice = null, ep = "", preparando = null, cola = Promise.resolve();
const S = {};                                   // las cuatro redes
const estilos = new Map();                      // voz -> {ttl, dp}
const avisar = (m, transferir) => self.postMessage(m, transferir || []);

// Un archivo desde la cache; si no esta, se baja (contando lo que va) y se guarda
async function archivo(url, alAvanzar) {
  let c = null;
  try { c = await caches.open(CACHE); } catch (e) { c = null; }   // sin cache (modo privado): se baja cada vez
  const guardado = c && await c.match(url);
  if (guardado) { const b = await guardado.arrayBuffer(); if (alAvanzar) alAvanzar(b.byteLength); return b; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`no pude bajar ${url.split("/").pop()} (HTTP ${r.status})`);
  let buf;
  if (alAvanzar && r.body) {
    const lector = r.body.getReader(), trozos = [];
    let hecho = 0;
    for (;;) {
      const {done, value} = await lector.read();
      if (done) break;
      trozos.push(value);
      hecho += value.length;
      alAvanzar(value.length);
    }
    const todo = new Uint8Array(hecho);
    let i = 0;
    for (const t of trozos) { todo.set(t, i); i += t.length; }
    buf = todo.buffer;
  } else buf = await r.arrayBuffer();
  if (c) {
    try { await c.put(url, new Response(buf.slice(0), {headers: {"content-type": "application/octet-stream"}})); }
    catch (e) { /* sin espacio: se usa igual esta vez */ }
  }
  return buf;
}
const json = async (url) => JSON.parse(new TextDecoder().decode(await archivo(url)));

// Solo una tarjeta grafica de verdad: la de software (SwiftShader) es mas lenta que WebAssembly
async function tarjetaDeVerdad() {
  if (typeof navigator === "undefined" || !navigator.gpu) return false;
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return false;
    const i = a.info || {};
    return !(a.isFallbackAdapter || i.isFallbackAdapter || /swiftshader/i.test((i.architecture || "") + " " + (i.description || "")));
  } catch (e) { return false; }
}

async function crearRedes(bufs, eps) {
  for (const [n] of PARTES) S[n] = await ort.InferenceSession.create(bufs[n], {executionProviders: eps, graphOptimizationLevel: "all"});
}
async function soltarRedes() {
  for (const k of Object.keys(S)) { try { await S[k].release(); } catch (e) { /* ya estaba libre */ } delete S[k]; }
}

function preparar(base) {
  if (S.vocoder) return Promise.resolve();
  if (preparando) return preparando;
  preparando = (async () => {
    if (!ort) {
      ort = await import(ORT);
      ort.env.wasm.wasmPaths = ORT_WASM;
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = "error";
    }
    [cfg, indice] = await Promise.all([json(base + "onnx/tts.json"), json(base + "onnx/unicode_indexer.json")]);
    let hecho = 0, ultimo = 0;
    const avance = (n) => { hecho += n; if (hecho - ultimo > TOTAL / 100 || hecho >= TOTAL) { ultimo = hecho; avisar({tipo: "progreso", hecho, total: TOTAL}); } };
    const bufs = {};
    for (const [n] of PARTES) bufs[n] = await archivo(base + `onnx/${n}.onnx`, avance);
    ep = "wasm";
    if (await tarjetaDeVerdad()) {
      try { await crearRedes(bufs, ["webgpu", "wasm"]); ep = "webgpu"; }
      catch (e) { console.warn("voz: sin tarjeta grafica,", e && e.message); await soltarRedes(); }
    }
    if (ep === "wasm") await crearRedes(bufs, ["wasm"]);
  })();
  preparando.then(() => { preparando = null; }, () => { preparando = null; });
  return preparando;
}

async function estilo(base, voz) {
  if (estilos.has(voz)) return estilos.get(voz);
  const v = await json(base + `voice_styles/${voz}.json`);
  const t = (x) => new ort.Tensor("float32", Float32Array.from(x.data.flat(Infinity)), [1, ...x.dims.slice(1)]);
  const e = {ttl: t(v.style_ttl), dp: t(v.style_dp)};
  estilos.set(voz, e);
  return e;
}

const mascara = (largo) => new ort.Tensor("float32", new Float32Array(largo).fill(1), [1, 1, largo]);
function ruido(n) {                              // normal (0, 1), de a dos con Box-Muller
  const d = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.random() || 1e-9, v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
    d[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) d[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return d;
}
const primera = (o, s) => o[s.outputNames[0]];

// El texto (ya preparado por voz.js) como sonido
async function decir(base, texto, voz, pasos, velocidad) {
  const st = await estilo(base, voz);
  let t = texto.normalize("NFKD").replace(/\s+/g, " ").trim();
  if (!/[.!?;:,'")\]}…]$/.test(t)) t += ".";
  t = `<es>${t}</es>`;
  const ids = [];
  for (const ch of t) { const c = ch.codePointAt(0); ids.push(c < indice.length ? indice[c] : -1); }
  const tIds = new ort.Tensor("int64", BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]), tM = mascara(ids.length);
  const sr = cfg.ae.sample_rate, trozo = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const durT = primera(await S.duration_predictor.run({text_ids: tIds, style_dp: st.dp, text_mask: tM}), S.duration_predictor);
  const dur = (await (durT.getData ? durT.getData() : durT.data))[0] / velocidad;
  const emb = primera(await S.text_encoder.run({text_ids: tIds, style_ttl: st.ttl, text_mask: tM}), S.text_encoder);
  const largo = Math.max(1, Math.floor(dur * sr)), lat = Math.ceil(largo / trozo), dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const mLat = mascara(lat), total = new ort.Tensor("float32", new Float32Array([pasos]), [1]);
  let x = new ort.Tensor("float32", ruido(dim * lat), [1, dim, lat]);
  for (let k = 0; k < pasos; k++) {
    x = primera(await S.vector_estimator.run({noisy_latent: x, text_emb: emb, style_ttl: st.ttl, text_mask: tM, latent_mask: mLat,
      current_step: new ort.Tensor("float32", new Float32Array([k]), [1]), total_step: total}), S.vector_estimator);
  }
  const wav = primera(await S.vocoder.run({latent: x}), S.vocoder);
  const datos = await (wav.getData ? wav.getData() : wav.data);   // con WebGPU el resultado puede quedar en la tarjeta
  return {pcm: Float32Array.from(datos.subarray(0, largo)), sr};
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.tipo === "preparar") {
    preparar(m.base).then(() => avisar({tipo: "lista", ep}), (err) => avisar({tipo: "error", mensaje: String(err && err.message || err)}));
  } else if (m.tipo === "decir") {
    cola = cola.then(async () => {
      if (m.n < (self.desde || 0)) return;       // la mandaron callar mientras esperaba su turno
      try {
        await preparar(m.base);
        const t = performance.now();
        const r = await decir(m.base, m.texto, m.voz, m.pasos || 5, m.velocidad || 1.05);
        avisar({tipo: "audio", n: m.n, pcm: r.pcm, sr: r.sr, ms: Math.round(performance.now() - t), ep}, [r.pcm.buffer]);
      } catch (err) { avisar({tipo: "error", n: m.n, mensaje: String(err && err.message || err)}); }
    });
  } else if (m.tipo === "callar") {
    self.desde = m.desde;
  } else if (m.tipo === "borrar") {
    caches.delete(CACHE).then(() => avisar({tipo: "borrada"}), () => {});
  }
};
