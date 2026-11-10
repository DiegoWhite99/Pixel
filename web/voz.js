/* 2.0.0 - La voz de Pixel: Supertonic 3, de Supertone (pedido del usuario el 10 nov: "las voces están del
   asco, busca cosas de calidad"; de las muestras eligio la F4). Las voces de Piper que habia antes se quitaron.
   - voz_trabajador.js la genera en un hilo aparte (WebGPU si hay, si no WebAssembly). Todas las voces usan
     el mismo modelo (unos 400 MB, se baja una sola vez); cada voz es solo su "estilo" (un JSON pequeno).
   - Lee letras: leer() escribe antes en palabras los numeros, las horas, los porcentajes, los grados y los
     precios ("21 °C" -> "veintiún grados"), que Supertonic leia mal.
   - Ajusta solo cuantos pasos de calculo usa (ajustarPasos): mas pasos suenan mejor y tardan mas. Si el
     aparato es tan lento que la voz no alcanza a seguir el ritmo (lenta()), agente.js usa la del celular.
   - agente.js la hace sonar con reproducir() (Web Audio) y mueve la boca con su volumen (envolvente).
   Las funciones de texto (leer, envolvente, agudo, ajustarPasos) se prueban en Node. */
"use strict";
const VozPixel = (function () {
  // el modelo oficial (huggingface.co/Supertone/supertonic-3), en una version fija
  const BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/";
  const MB = 398;
  const VOCES = [
    ...[1, 2, 3, 4, 5].map((i) => ({id: "st-F" + i, estilo: "F" + i, nombre: "Mujer " + i, tipo: "mujer"})),
    ...[1, 2, 3, 4, 5].map((i) => ({id: "st-M" + i, estilo: "M" + i, nombre: "Hombre " + i, tipo: "hombre"})),
  ];
  VOCES[3].nombre = "Mujer 4 (la elegida)";
  const DEFECTO = "st-F4";
  const ALIAS = {"mx-mujer": "st-F4", "mx-hombre": "st-M1"};   // las de Piper de antes (ajustes ya guardados)
  const VELOCIDAD = 1.05;                       // la del ejemplo oficial y la de las muestras
  // Tipo de voz, como panel.TONOS en el PC: mas aguda sin hablar mas rapido (se alarga y luego se acelera)
  const AGUDO = {normal: 1, infantil: 1.32, muy_infantil: 1.55};
  const PASO_BOCA = 0.04;                       // s por cada nivel de la boca
  const PASOS = {inicio: 5, min: 4, max: 8};

  const normal = (id) => ALIAS[id] || id;
  const de = (id) => VOCES.find((v) => v.id === normal(id)) || null;
  const agudo = (tono) => AGUDO[tono] || 1;

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  const UNIDADES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
    "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
    "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
  const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  const apocope = (t) => t.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
  function menosDeMil(n) {
    if (n === 100) return "cien";
    if (n < 30) return UNIDADES[n];
    if (n < 100) return DECENAS[Math.floor(n / 10)] + (n % 10 ? " y " + UNIDADES[n % 10] : "");
    return CENTENAS[Math.floor(n / 100)] + (n % 100 ? " " + menosDeMil(n % 100) : "");
  }
  function enLetras(n) {
    if (n < 1000) return menosDeMil(n);
    if (n < 1e6) { const m = Math.floor(n / 1000), r = n % 1000; return (m === 1 ? "mil" : apocope(menosDeMil(m)) + " mil") + (r ? " " + menosDeMil(r) : ""); }
    if (n < 1e12) { const m = Math.floor(n / 1e6), r = n % 1e6; return (m === 1 ? "un millón" : apocope(enLetras(m)) + " millones") + (r ? " " + enLetras(r) : ""); }
    return String(n).split("").map((c) => UNIDADES[+c]).join(" ");
  }
  const cifras = (s) => s.split("").map((c) => UNIDADES[+c]).join(" ");
  const decimales = (s) => (s.length <= 2 && s[0] !== "0" ? enLetras(+s) : cifras(s));
  // "45.000" mil (puntos de a tres), "3,5" tres coma cinco, "3.5" tres punto cinco, "0057" cero cero cinco siete
  function numeroDicho(m) {
    if (/^\d{1,3}(\.\d{3})+$/.test(m)) return enLetras(+m.replace(/\./g, ""));
    let x = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(m);
    if (x) return enLetras(+x[1].replace(/\./g, "")) + " coma " + decimales(x[2]);
    x = /^(\d+)([.,])(\d+)$/.exec(m);
    if (x) return numeroDicho(x[1]) + (x[2] === "," ? " coma " : " punto ") + decimales(x[3]);
    if (/^\d+$/.test(m)) return m.length > 1 && m[0] === "0" ? cifras(m) : enLetras(+m);
    return m.split(/[.,]/).map(numeroDicho).join(" ");
  }
  const FEMENINO = /^\s+(personas?|horas?|semanas?|veces|vez|tareas?|cosas?|notas?|canci[oó]n(es)?|llamadas?|citas?|reuniones|reuni[oó]n|alarmas?|páginas?|paginas?|preguntas?)\b/i;
  // Lo que se lee raro, en palabras. Las horas "15:30" -> "quince y treinta".
  function leer(texto) {
    let s = String(texto || "");
    s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m, h, mm) => enLetras(+h) + (+mm ? " y " + enLetras(+mm) : ""));
    s = s.replace(/US\$\s?(\d[\d.,]*)/g, "$1 dólares").replace(/€\s?(\d[\d.,]*)/g, "$1 euros");
    s = s.replace(/\$\s?(\d[\d.,]*\d|\d)(\s*(?:pesos|d[oó]lares|euros))?/g, (m, n, moneda) => n + (moneda || " pesos"));
    s = s.replace(/(\d)\s?%/g, "$1 por ciento").replace(/(\d)\s?°\s?[CF]\b/g, "$1 grados").replace(/(\d)\s?°/g, "$1 grados");
    s = s.replace(/\d+(?:[.,]\d+)*/g, (m, i, todo) => {
      let t = numeroDicho(m);
      const sigue = todo.slice(i + m.length);
      if (/uno$/.test(t) && /^\s+[a-záéíóúñ]/i.test(sigue)) t = FEMENINO.test(sigue) ? t.replace(/uno$/, "una") : apocope(t);
      return t;
    });
    return s.replace(/\s{2,}/g, " ");
  }

  // El volumen de la voz cada PASO_BOCA segundos (0 a 1), para mover la boca y los ojos
  function envolvente(pcm, sr, paso) {
    const n = Math.max(1, Math.round(sr * (paso || PASO_BOCA))), out = [];
    let max = 1e-6;
    for (let i = 0; i < pcm.length; i += n) {
      let s = 0;
      const fin = Math.min(pcm.length, i + n);
      for (let j = i; j < fin; j++) s += pcm[j] * pcm[j];
      const r = Math.sqrt(s / (fin - i));
      out.push(r);
      if (r > max) max = r;
    }
    return out.map((r) => Math.min(1, r / max));
  }

  // Cuantos pasos para la siguiente frase. r = lo que tardo / lo que dura el audio (1 = justo a tiempo).
  // Con tiempo de sobra, mas pasos (mejor sonido); si va justa, menos. lentas cuenta las frases seguidas que
  // ni con el minimo alcanzaron: con 3, el aparato no da para esta voz.
  function ajustarPasos(estado, r) {
    let {pasos, lentas} = estado;
    if (r < 0.25 && pasos < PASOS.max) pasos++;
    else if (r > 0.6 && pasos > PASOS.min) pasos--;
    lentas = r > 1.3 && estado.pasos === PASOS.min ? lentas + 1 : 0;
    return {pasos, lentas, lenta: lentas >= 3};
  }

  // ------------------------------------------------------------------ el hilo de la voz
  const est = {lista: false, progreso: null, error: "", bajando: false, ep: "", pasos: PASOS.inicio, lentas: 0, lenta: false};
  const info = () => est;
  const oyentes = [];
  const cambio = () => oyentes.forEach((f) => { try { f(); } catch (e) { console.warn("voz:", e); } });
  let hilo = null, n = 0, lista = null;
  const esperas = new Map();                    // n -> {ok, mal}

  const soportada = () => typeof Worker !== "undefined" && typeof WebAssembly !== "undefined" && typeof fetch !== "undefined"
    && typeof BigInt64Array !== "undefined";

  function trabajador() {
    if (hilo) return hilo;
    hilo = new Worker("voz_trabajador.js", {type: "module"});
    hilo.onmessage = (e) => {
      const m = e.data || {};
      if (m.tipo === "progreso") { est.progreso = m.total ? m.hecho / m.total : null; cambio(); }
      else if (m.tipo === "lista") { Object.assign(est, {lista: true, bajando: false, progreso: 1, error: "", ep: m.ep}); cambio(); }
      else if (m.tipo === "error" && m.n === undefined) { Object.assign(est, {lista: false, bajando: false, error: m.mensaje}); cambio(); }
      else if (m.tipo === "borrada") { Object.assign(est, {lista: false, progreso: null}); cambio(); }
      else if (m.n !== undefined && esperas.has(m.n)) {
        const w = esperas.get(m.n);
        esperas.delete(m.n);
        if (m.tipo === "audio") w.ok({pcm: m.pcm, sr: m.sr, ms: m.ms}); else w.mal(new Error(m.mensaje || "sin voz"));
      }
    };
    hilo.onerror = (e) => {
      console.warn("voz: el hilo fallo", e.message || e);
      if (est.bajando) Object.assign(est, {bajando: false, error: "no pude arrancar la voz"});
      for (const [, w] of esperas) w.mal(new Error("hilo de voz caido"));
      esperas.clear();
      lista = null;
      hilo = null;
      cambio();
    };
    return hilo;
  }

  // Baja el modelo (si hace falta) y lo deja listo. Se puede llamar muchas veces.
  function preparar() {
    if (!soportada()) return Promise.reject(new Error("este navegador no puede"));
    if (est.lista) return Promise.resolve();
    if (lista) return lista;
    Object.assign(est, {bajando: true, error: ""});
    cambio();
    lista = new Promise((ok, mal) => {
      const quitar = () => { const i = oyentes.indexOf(mirar); if (i >= 0) oyentes.splice(i, 1); };
      const mirar = () => {
        if (est.lista) { quitar(); ok(); } else if (est.error) { quitar(); lista = null; mal(new Error(est.error)); }
      };
      oyentes.push(mirar);
      trabajador().postMessage({tipo: "preparar", base: BASE});
    });
    return lista;
  }

  // La frase como sonido: {pcm, sr, factor}. Las frases van en orden; la siguiente se genera mientras suena
  // esta. factor: cuanto mas aguda suena (se genera factor veces mas lenta y luego se acelera igual).
  function sintetizar(id, texto, tono) {
    const v = de(id);
    if (!v || !est.lista) return Promise.reject(new Error("la voz no esta lista"));
    const k = ++n, factor = agudo(tono), pasos = est.pasos;
    return new Promise((ok, mal) => {
      esperas.set(k, {mal, ok: (r) => {
        if (r && r.pcm.length) {
          Object.assign(est, ajustarPasos(est, r.ms / 1000 / (r.pcm.length / r.sr / factor)));
          if (est.lenta) cambio();
        }
        ok(r && Object.assign(r, {factor}));
      }});
      trabajador().postMessage({tipo: "decir", n: k, base: BASE, texto: leer(texto), voz: v.estilo, pasos, velocidad: VELOCIDAD / factor});
    });
  }

  // Lo que estaba en cola ya no se dice
  function callar() {
    if (!hilo) return;
    hilo.postMessage({tipo: "callar", desde: n + 1});
    for (const [, w] of esperas) w.ok(null);
    esperas.clear();
  }

  // Si ya esta bajada en este aparato (sin cargarla)
  async function guardada() {
    if (typeof caches === "undefined") return false;
    try { return !!(await (await caches.open("pixel-voces-2")).match(BASE + "onnx/vector_estimator.onnx")); } catch (e) { return false; }
  }

  function borrar() {
    lista = null;
    Object.assign(est, {lista: false, progreso: null, error: ""});
    trabajador().postMessage({tipo: "borrar"});
    cambio();
  }

  // Si el aparato resulto lento, otra oportunidad (Ajustes -> "Intentar otra vez")
  function reintentar() { Object.assign(est, {pasos: PASOS.min, lentas: 0, lenta: false}); cambio(); }

  // Suena por Web Audio. Devuelve {dura (s), nivel() para la boca, parar()} y llama a alAcabar al terminar.
  function reproducir(ctx, sonido, alAcabar) {
    const a = sonido.factor || 1;
    const buf = ctx.createBuffer(1, sonido.pcm.length, sonido.sr);
    buf.copyToChannel(sonido.pcm, 0);
    const fuente = ctx.createBufferSource();
    fuente.buffer = buf;
    fuente.playbackRate.value = a;
    const vol = ctx.createGain();
    vol.gain.value = 0.95;
    fuente.connect(vol);
    vol.connect(ctx.destination);
    const env = envolvente(sonido.pcm, sonido.sr), inicio = ctx.currentTime + 0.02, dura = buf.duration / a;
    let acabo = false;
    const fin = () => { if (acabo) return; acabo = true; try { vol.disconnect(); } catch (e) { /* ya estaba */ } if (alAcabar) alAcabar(); };
    fuente.onended = fin;
    fuente.start(inicio);
    return {
      dura,
      nivel() {
        const t = (ctx.currentTime - inicio) * a;
        if (t < 0) return 0;
        const i = Math.floor(t / PASO_BOCA);
        return i < env.length ? env[i] : 0;
      },
      parar() { try { fuente.stop(); } catch (e) { /* no habia empezado */ } fin(); },
    };
  }

  // las voces de Piper de la version anterior ya no se usan: se libera su espacio (unos 126 MB)
  if (typeof caches !== "undefined") caches.delete("pixel-voces-1").catch(() => {});

  return {VOCES, DEFECTO, MB, de, normal, soportada, preparar, sintetizar, callar, guardada, borrar, reproducir, info, reintentar,
    lenta: () => est.lenta, alCambiar: (f) => oyentes.push(f), texto: {leer, enLetras, envolvente, agudo, ajustarPasos, AGUDO, PASOS}};
})();
if (typeof module !== "undefined") module.exports = VozPixel;
