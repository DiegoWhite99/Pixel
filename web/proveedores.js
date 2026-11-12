// Fase 14 - El proveedor de IA de Pixel (pedido del usuario el 10 nov: "un espacio en Ajustes donde se ponga
// la API key según el proveedor... que acepten GPT, Kimi, etc. solo con la API key", y que en el panel se vea
// como se gasta). 11 nov: ya no hay IA incluida ("cada persona paga Gemini o el proveedor que quiera"):
// sin clave, Pixel no piensa. Antes existia "pixel", el Gemini del proyecto por Firebase AI Logic.
//   gemini     Google Gemini con la clave del usuario (aistudio.google.com), por su API REST.
//   claude     Anthropic Claude con la clave del usuario: proveedor_claude.js, con la libreria oficial.
//   openai     GPT de OpenAI.              deepseek   DeepSeek.
//   groq       Groq (12 nov, pedido: "agrega un cliente mas en API como Groq"): Llama, GPT-OSS, Qwen... muy rapido.
//              Deja que una pagina web llame a su API (CORS comprobado el 12 nov). El programa del PC tambien lo usa.
//   openrouter Una sola clave para cientos de modelos: GPT, Kimi, DeepSeek, Llama, Mistral, Claude...
//   otro       Cualquier servicio compatible con la API de OpenAI (su direccion https).
// Kimi (Moonshot) no deja que una pagina web llame a su API directamente (sin CORS, comprobado el 10 nov):
// se usa por OpenRouter. Los modelos de OpenAI, DeepSeek, OpenRouter y "otro" no se inventan: se piden al
// servicio con la clave (GET /models) o los escribe el usuario.
// La clave se guarda SOLO en este aparato y por cuenta (localStorage "pixel.ia:<uid>"): no va a la nube ni a
// GitHub, y dos cuentas en el mismo navegador no comparten clave.
// motor() da el mismo "modelo" que agente.js usa con Firebase: generateContentStream({contents}) -> {stream}
// con trozos al estilo Gemini (candidates[0].content.parts, usageMetadata), y generateContent(prompt).
// Asi el bucle de agente.js (voz, herramientas, confirmaciones) es igual con cualquier proveedor.
"use strict";
const Proveedores = (function () {
  const GUARDADO = "pixel.ia";
  const MAX_SALIDA = 4000;                     // respuestas de voz cortas: tope para que nada se dispare
  // Precios oficiales en US$ por millon de tokens (entrada / salida, la salida con lo de "pensar"). Gemini:
  // ai.google.dev/gemini-api/docs/pricing (10 nov 2026). Claude: tabla de modelos de Anthropic (6 oct 2026).
  // Los demas los da OpenRouter con su lista de modelos, o los pone el usuario.
  const LISTA = {
    gemini: {nombre: "Google Gemini", clave: true,
      ayuda: "Tu clave de Google AI Studio (aistudio.google.com → «Get API key»). El gasto va a tu cuenta de Google.",
      modelos: [{id: "gemini-3.5-flash-lite", nombre: "Gemini 3.5 Flash-Lite", e: 0.30, s: 2.50},
        {id: "gemini-3.1-flash-lite", nombre: "Gemini 3.1 Flash-Lite", e: 0.25, s: 1.50}]},
    claude: {nombre: "Anthropic Claude", clave: true,
      ayuda: "Tu clave de la consola de Anthropic (console.anthropic.com → «API keys»). El gasto va a tu cuenta de Anthropic.",
      modelos: [{id: "claude-opus-5-5", nombre: "Claude Opus 5.5", e: 4.00, s: 20.00},
        {id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5", e: 2.00, s: 10.00},
        {id: "claude-haiku-5-5", nombre: "Claude Haiku 5.5", e: 0.10, s: 0.50}]},
    openai: {nombre: "OpenAI (GPT)", clave: true, compatible: true, base: "https://api.openai.com/v1", maxCampo: "max_completion_tokens", uso: true,
      ayuda: "Tu clave de OpenAI (platform.openai.com → «API keys»). Toca «Buscar modelos» para elegir uno."},
    openrouter: {nombre: "OpenRouter (GPT, Kimi, DeepSeek, Llama…)", clave: true, compatible: true, base: "https://openrouter.ai/api/v1", uso: true, precios: true,
      ayuda: "Una sola clave para cientos de modelos, también Kimi (openrouter.ai → «Keys»). Los precios salen solos."},
    deepseek: {nombre: "DeepSeek", clave: true, compatible: true, base: "https://api.deepseek.com", uso: true,
      ayuda: "Tu clave de DeepSeek (platform.deepseek.com → «API keys»)."},
    groq: {nombre: "Groq (Llama, GPT-OSS, Qwen…)", clave: true, compatible: true, base: "https://api.groq.com/openai/v1", uso: true,
      ayuda: "Tu clave de Groq (console.groq.com → «API Keys»). Responde muy rápido. Toca «Buscar modelos» para elegir uno."},
    otro: {nombre: "Otro compatible con OpenAI", clave: true, compatible: true, base: "",
      ayuda: "Cualquier servicio con la misma API que OpenAI. Escribe su dirección (https://…/v1). Tiene que dejar que una página web lo llame."},
  };
  const motores = {};                          // los que viven en otro archivo (claude: proveedor_claude.js)
  const registrar = (id, f) => { motores[id] = f; };

  // ------------------------------------------------------------------ lo guardado (solo en este aparato, por cuenta)
  // Sin sesion no hay donde guardar: cada cuenta tiene lo suyo
  const llave = () => (typeof nube !== "undefined" && nube && nube.uid ? GUARDADO + ":" + nube.uid : "");
  function leer() {
    let v = null;
    const k = llave();
    try { v = k ? JSON.parse(localStorage.getItem(k) || "null") : null; } catch (e) { v = null; }
    v = v && typeof v === "object" ? v : {};
    return {proveedor: LISTA[v.proveedor] ? v.proveedor : "gemini", modelos: v.modelos || {}, claves: v.claves || {}, bases: v.bases || {}, precios: v.precios || {}};
  }
  function guardar(cfg) {
    const k = llave();
    if (!k) return false;
    try {
      localStorage.setItem(k, JSON.stringify({proveedor: cfg.proveedor, modelos: cfg.modelos || {}, claves: cfg.claves || {}, bases: cfg.bases || {}, precios: cfg.precios || {}}));
      return true;
    } catch (e) { return false; }
  }
  const baseDe = (cfg, p) => String((p === "otro" ? cfg.bases.otro : LISTA[p].base) || "").replace(/\/+$/, "");
  function modeloDe(cfg, p) {
    const fijos = LISTA[p].modelos;
    if (fijos) return fijos.some((m) => m.id === cfg.modelos[p]) ? cfg.modelos[p] : fijos[0].id;
    return String(cfg.modelos[p] || "").trim();
  }
  // El que se usa ahora: {proveedor, modelo, clave, base, propio}. Sin clave o sin modelo, ninguno
  // (propio: false): Pixel no puede pensar hasta que el usuario ponga su clave en Ajustes.
  function actual() {
    const cfg = leer(), p = cfg.proveedor, ninguno = {proveedor: "", modelo: "", clave: "", base: "", propio: false};
    if (!LISTA[p] || !cfg.claves[p] || !modeloDe(cfg, p)) return ninguno;
    if (LISTA[p].compatible && !/^https:\/\//.test(baseDe(cfg, p))) return ninguno;
    return {proveedor: p, modelo: modeloDe(cfg, p), clave: cfg.claves[p], base: baseDe(cfg, p), propio: true};
  }
  // 12 nov (el usuario: "dice que la clave empieza por AIza, entonces no deja"): antes cada proveedor exigia su
  // comienzo de siempre (AIza..., sk-ant-..., gsk_...) y una clave de otro formato no se podia ni guardar. Ahora
  // solo se mira que este entera (sin espacios, de un largo razonable): si vale o no lo dice el servicio al probarla.
  const claveValida = (p, clave) => !!LISTA[p] && (!LISTA[p].clave || /^[\x21-\x7e]{16,400}$/.test(String(clave || "").trim()));
  const tapada = (clave) => { const c = String(clave || ""); return c.length > 10 ? c.slice(0, 6) + "…" + c.slice(-4) : c ? "…" : ""; };   // "sk-ant-…a9F2"

  // El uso se apunta en la nube por modelo: los de clave propia con "propia:". Las claves de la base de datos
  // no admiten . # $ / [ ] (lo mismo hace contarUso en agente.js)
  const sanear = (s) => String(s || "otro").replace(/[.#$/[\]]/g, "_");
  const claveUso = (a) => (a && a.propio ? "propia:" + a.modelo : "");
  function nombreModelo(k) {                  // de la clave saneada al nombre ("propia:claude-opus-5-5" -> "Claude Opus 5.5 · tu clave")
    const propia = String(k).startsWith("propia:"), base = propia ? k.slice(7) : k;
    for (const p of Object.values(LISTA)) for (const m of p.modelos || []) if (sanear(m.id) === base) return m.nombre + (propia ? " · tu clave" : "");
    const cfg = leer();
    const id = Object.keys(cfg.precios).find((x) => sanear(x) === base) || base.replace(/_/g, "/");
    return id + (propia ? " · tu clave" : "");
  }
  function precioDe(k) {                       // {e, s} en US$ por millon, o null si no se sabe
    const base = String(k).startsWith("propia:") ? k.slice(7) : k;
    for (const p of Object.values(LISTA)) for (const m of p.modelos || []) if (sanear(m.id) === base) return {e: m.e, s: m.s};
    const cfg = leer(), id = Object.keys(cfg.precios).find((x) => sanear(x) === base);
    const pr = id && cfg.precios[id];
    return pr && isFinite(pr.e) && isFinite(pr.s) ? {e: Number(pr.e), s: Number(pr.s)} : null;
  }

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // El JSON de una respuesta de texto (por si viene con algo alrededor)
  function extraerJSON(t) {
    const s = String(t || ""), a = s.search(/[[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    return a >= 0 && b > a ? s.slice(a, b + 1) : s;
  }
  const declaraciones = (hs) => (hs || []).flatMap((h) => h.functionDeclarations || []);
  const esquema = (f) => (f.parameters && f.parameters.type === "object" ? f.parameters : {type: "object", properties: {}});
  // Con las herramientas: la entrada tiene que ser un objeto con los campos requeridos
  function entradaValida(nombre, args, decl) {
    const f = decl.find((x) => x.name === nombre);
    if (!f || !args || typeof args !== "object" || Array.isArray(args)) return false;
    return (esquema(f).required || []).every((k) => args[k] !== undefined);
  }
  // Del formato de Gemini (contents) al de OpenAI (messages)
  function aMensajesOpenAI(contents, sistema) {
    const out = sistema ? [{role: "system", content: sistema}] : [];
    for (const c of contents || []) {
      const partes = c.parts || [];
      const texto = partes.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
      if (c.role === "model") {
        const llamadas = partes.filter((p) => p.functionCall).map((p) => ({id: p.functionCall.id, type: "function",
          function: {name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {})}}));
        if (texto || llamadas.length) out.push(Object.assign({role: "assistant", content: texto || null}, llamadas.length ? {tool_calls: llamadas} : {}));
      } else {
        for (const p of partes.filter((x) => x.functionResponse)) out.push({role: "tool", tool_call_id: p.functionResponse.id, content: JSON.stringify(p.functionResponse.response || {})});
        if (texto) out.push({role: "user", content: texto});
      }
    }
    return out;
  }
  const aHerramientasOpenAI = (hs) => declaraciones(hs).map((f) => ({type: "function", function: {name: f.name, description: f.description || "", parameters: esquema(f)}}));

  // ------------------------------------------------------------------ red
  async function errorDe(r, quien) {
    let m = "";
    try { const j = await r.json(); m = (j.error && (j.error.message || j.error.type)) || j.message || ""; } catch (e) { m = ""; }
    const e = new Error(`${quien} ${r.status}: ${m}`.trim());
    e.status = r.status;
    e.propio = quien;
    return e;
  }
  // Las lineas "data: {...}" de una respuesta SSE, como objetos
  async function* leerSSE(r) {
    const lector = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const {value, done} = await lector.read();
      buf += done ? dec.decode() : dec.decode(value, {stream: true});
      const bloques = buf.split(/\r?\n\r?\n/);
      buf = done ? "" : bloques.pop();
      for (const b of bloques) {
        const datos = b.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (datos && datos !== "[DONE]") { try { yield JSON.parse(datos); } catch (e) { /* trozo roto: se salta */ } }
      }
      if (done) break;
    }
  }

  // ------------------------------------------------------------------ Gemini con la clave del usuario (REST)
  const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/";
  function motorGemini(a, o) {
    const cuerpo = (contents) => JSON.stringify(Object.assign({contents}, o.sistema ? {systemInstruction: {parts: [{text: o.sistema}]}} : {},
      declaraciones(o.herramientas).length ? {tools: o.herramientas} : {}, {generationConfig: o.generationConfig || {}}));
    const pedir = (accion, body) => fetch(GEMINI_API + encodeURIComponent(a.modelo) + ":" + accion,
      {method: "POST", headers: {"Content-Type": "application/json", "x-goog-api-key": a.clave}, body});
    return {
      async generateContentStream({contents}) {
        const r = await pedir("streamGenerateContent?alt=sse", cuerpo(contents));
        if (!r.ok) throw await errorDe(r, "Gemini");
        return {stream: leerSSE(r)};
      },
      async generateContent(prompt) {
        const r = await pedir("generateContent", cuerpo([{role: "user", parts: [{text: String(prompt)}]}]));
        if (!r.ok) throw await errorDe(r, "Gemini");
        const j = await r.json(), c = ((j.candidates || [])[0] || {}).content || {};
        return {response: {text: () => (c.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join(""), usageMetadata: j.usageMetadata}};
      },
    };
  }

  // ------------------------------------------------------------------ OpenAI y compatibles (GPT, OpenRouter, DeepSeek, otro)
  function cabecerasOpenAI(a) {
    const h = {"Content-Type": "application/json", Authorization: "Bearer " + a.clave};
    if (a.proveedor === "openrouter") h["X-Title"] = "Píxel";
    return h;
  }
  // La respuesta en vivo como trozos al estilo Gemini: el texto segun llega; al final las herramientas
  // (enteras y validas, y no si se corto por el tope) y lo gastado
  async function* trozosOpenAI(r, decl) {
    const llamadas = [];
    let uso = null, cortado = false;
    for await (const ev of leerSSE(r)) {
      if (ev.usage) uso = ev.usage;
      const ch = (ev.choices || [])[0];
      if (!ch) continue;
      const d = ch.delta || {};
      if (typeof d.content === "string" && d.content) yield {candidates: [{content: {parts: [{text: d.content}]}}]};
      for (const tc of d.tool_calls || []) {
        const i = typeof tc.index === "number" ? tc.index : llamadas.length;
        const x = llamadas[i] || (llamadas[i] = {id: "", nombre: "", args: ""});
        if (tc.id) x.id = tc.id;
        if (tc.function && tc.function.name) x.nombre += tc.function.name;
        if (tc.function && typeof tc.function.arguments === "string") x.args += tc.function.arguments;
      }
      if (ch.finish_reason === "length") cortado = true;
    }
    const partes = [];
    if (!cortado) llamadas.forEach((x, i) => {
      if (!x) return;
      let args;
      try { args = x.args.trim() ? JSON.parse(x.args) : {}; } catch (e) { return; }
      if (entradaValida(x.nombre, args, decl)) partes.push({functionCall: {name: x.nombre, args, id: x.id || "llamada_" + i}});
    });
    yield {candidates: [{content: {parts: partes}}], usageMetadata: uso ? {promptTokenCount: uso.prompt_tokens || 0, candidatesTokenCount: uso.completion_tokens || 0} : null};
  }
  function motorOpenAI(a, o) {
    const L = LISTA[a.proveedor] || {}, decl = declaraciones(o.herramientas), tools = aHerramientasOpenAI(o.herramientas);
    const cuerpo = (messages, stream, conHerramientas) => JSON.stringify(Object.assign({model: a.modelo, messages, stream},
      {[L.maxCampo || "max_tokens"]: MAX_SALIDA}, conHerramientas && tools.length ? {tools} : {}, stream && L.uso ? {stream_options: {include_usage: true}} : {}));
    const pedir = (body) => fetch(a.base + "/chat/completions", {method: "POST", headers: cabecerasOpenAI(a), body});
    return {
      async generateContentStream({contents}) {
        const r = await pedir(cuerpo(aMensajesOpenAI(contents, o.sistema), true, true));
        if (!r.ok) throw await errorDe(r, L.nombre || "El servicio");
        return {stream: trozosOpenAI(r, decl)};
      },
      async generateContent(prompt) {
        const r = await pedir(cuerpo(aMensajesOpenAI([{role: "user", parts: [{text: String(prompt)}]}], o.sistema), false, false));
        if (!r.ok) throw await errorDe(r, L.nombre || "El servicio");
        const j = await r.json(), m = ((j.choices || [])[0] || {}).message || {}, u = j.usage || {};
        return {response: {text: () => extraerJSON(m.content || ""), usageMetadata: {promptTokenCount: u.prompt_tokens || 0, candidatesTokenCount: u.completion_tokens || 0}}};
      },
    };
  }
  // Los modelos del servicio (GET /models), sin los que no son de conversacion (voz, imagenes, embeddings...).
  // OpenRouter trae el precio por token: se pasa a US$ por millon.
  async function buscarModelos(a) {
    const r = await fetch(a.base + "/models", {headers: cabecerasOpenAI(a)});
    if (!r.ok) throw await errorDe(r, (LISTA[a.proveedor] || {}).nombre || "El servicio");
    const j = await r.json(), lista = Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : [];
    return lista.filter((m) => m && typeof m.id === "string" && !/embed|whisper|tts|dall-e|image|moderation|audio|realtime|transcribe|davinci|babbage|search|guard|playai|orpheus/i.test(m.id))
      .map((m) => {
        const p = m.pricing || {}, e = Number(p.prompt) * 1e6, s = Number(p.completion) * 1e6;
        return Object.assign({id: m.id, nombre: m.name || m.id}, isFinite(e) && isFinite(s) && (e > 0 || s > 0) ? {e: Math.round(e * 1000) / 1000, s: Math.round(s * 1000) / 1000} : {});
      }).sort((x, y) => x.id.localeCompare(y.id));
  }

  // El "modelo" del proveedor elegido. a: actual(); o: {sistema, herramientas ([{functionDeclarations}]), generationConfig}
  function motor(a, o) {
    if (a.proveedor === "gemini") return motorGemini(a, o);
    if (motores[a.proveedor]) return motores[a.proveedor](a, o);
    if ((LISTA[a.proveedor] || {}).compatible) return motorOpenAI(a, o);
    throw new Error("Proveedor sin motor: " + a.proveedor);
  }

  // Una pregunta corta para saber si la clave funciona: {ok, texto, ms, uso}
  async function probar(a) {
    const t0 = Date.now();
    try {
      const r = await motor(a, {sistema: "Contesta en español con una sola palabra.", generationConfig: {maxOutputTokens: 200}}).generateContent("Di solo: listo");
      return {ok: true, texto: String(r.response.text() || "").trim().slice(0, 80), ms: Date.now() - t0, uso: r.response.usageMetadata};
    } catch (e) {
      return {ok: false, texto: String((e && e.message) || e).slice(0, 220), ms: Date.now() - t0, status: e && e.status};
    }
  }

  return {LISTA, leer, guardar, actual, modeloDe, baseDe, claveValida, tapada, motor, probar, buscarModelos, registrar,
    sanear, claveUso, nombreModelo, precioDe,
    texto: {extraerJSON, entradaValida, aMensajesOpenAI, aHerramientasOpenAI, leerSSE, trozosOpenAI}};
})();
if (typeof module !== "undefined") module.exports = Proveedores;
