// Fase 14 - Anthropic Claude como proveedor de IA de Pixel, con la clave del usuario (ver proveedores.js).
// Usa la libreria oficial @anthropic-ai/sdk en el navegador (dangerouslyAllowBrowser: la clave es del propio
// usuario y solo vive en su aparato). Se carga la primera vez que hace falta, con la version fija.
//   - Respuesta en vivo con messages.stream(): el texto se va diciendo con stream.on("text"); finalMessage()
//     da los tool_use, el stop_reason y lo gastado. Nada se ejecuta si se corto (max_tokens) o si Claude se
//     nego (refusal).
//   - eager_input_streaming en cada herramienta; como la API ya no valida esas entradas, se validan aqui.
//   - En las vueltas con herramientas, el contenido de Claude (con sus bloques de "pensar") se devuelve tal
//     cual: Claude lo exige. El historial de turnos anteriores va solo con el texto.
//   - Opus y Sonnet: "fallbacks: default" (beta server-side-fallback-2026-07-01): si un filtro de seguridad
//     rechaza la peticion, el servidor la repite con otro modelo. Haiku no tiene ese respaldo.
//   - Esfuerzo "low": es charla de voz, corta.
"use strict";
const ProveedorClaude = (function () {
  const SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm";
  const MAX_SALIDA = 4000;

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  const crudos = new Map();                    // id del primer tool_use -> content del asistente (con lo de "pensar")
  // Del formato de Gemini (contents) al de Claude (messages)
  function aMensajes(contents) {
    const out = [];
    for (const c of contents || []) {
      const role = c.role === "model" ? "assistant" : "user", partes = c.parts || [];
      const llamada = partes.find((p) => p.functionCall);
      if (role === "assistant" && llamada && crudos.has(llamada.functionCall.id)) { out.push({role, content: crudos.get(llamada.functionCall.id)}); continue; }
      const content = [];
      for (const p of partes) {
        if (typeof p.text === "string" && p.text.trim() && !p.thought) content.push({type: "text", text: p.text});
        else if (p.functionCall) content.push({type: "tool_use", id: p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args || {}});
        else if (p.functionResponse) content.push({type: "tool_result", tool_use_id: p.functionResponse.id, content: JSON.stringify(p.functionResponse.response || {})});
      }
      if (content.length) out.push({role, content});
    }
    return out;
  }
  // Las herramientas de Gemini ([{functionDeclarations}]) como las de Claude
  function aHerramientas(hs) {
    return (hs || []).flatMap((h) => h.functionDeclarations || []).map((f) => ({
      name: f.name, description: f.description || "",
      input_schema: f.parameters && f.parameters.type === "object" ? f.parameters : {type: "object", properties: {}},
      eager_input_streaming: true,
    }));
  }
  // La entrada de un tool_use: objeto, de una herramienta que existe y con los campos requeridos
  function entradaValida(bloque, herramientas) {
    const h = herramientas.find((x) => x.name === bloque.name);
    if (!h || !bloque.input || typeof bloque.input !== "object" || Array.isArray(bloque.input)) return false;
    return (h.input_schema.required || []).every((k) => bloque.input[k] !== undefined);
  }
  const uso = (u) => ({promptTokenCount: ((u && u.input_tokens) || 0) + ((u && u.cache_read_input_tokens) || 0) + ((u && u.cache_creation_input_tokens) || 0),
    candidatesTokenCount: (u && u.output_tokens) || 0});
  const conRespaldo = (modelo) => /^claude-(opus|sonnet)-/.test(modelo);
  function pedido(a, o, messages, conHerramientas) {
    const tools = conHerramientas ? aHerramientas(o.herramientas) : [];
    return Object.assign({model: a.modelo, max_tokens: MAX_SALIDA, messages, output_config: {effort: "low"}},
      o.sistema ? {system: o.sistema} : {}, tools.length ? {tools} : {},
      conRespaldo(a.modelo) ? {betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"} : {});
  }

  // ------------------------------------------------------------------ red
  let mod = null;
  async function cliente(clave) {
    if (!mod) mod = await import(SDK);
    const Anthropic = mod.default || mod.Anthropic;
    return new Anthropic({apiKey: clave, dangerouslyAllowBrowser: true, maxRetries: 1});
  }
  // Los errores del SDK, con lo que agente.js necesita (status y de quien es)
  function error(e) {
    const x = e instanceof Error ? e : new Error(String(e));
    if (e && e.status) x.status = e.status;
    x.propio = "Claude";
    return x;
  }

  // La respuesta en vivo como trozos al estilo Gemini (lo que espera agente.js)
  async function* trozos(s, herramientas) {
    const cola = [];
    let despertar = null, fin = false, fallo = null, hubo = false;
    const avisar = () => { if (despertar) { const f = despertar; despertar = null; f(); } };
    s.on("text", (t) => { cola.push(t); avisar(); });
    const final = s.finalMessage().then((m) => { fin = true; avisar(); return m; }, (e) => { fallo = e; fin = true; avisar(); return null; });
    for (;;) {
      while (cola.length) { hubo = true; yield {candidates: [{content: {parts: [{text: cola.shift()}]}}]}; }
      if (fin) break;
      await new Promise((ok) => { despertar = ok; });
    }
    while (cola.length) { hubo = true; yield {candidates: [{content: {parts: [{text: cola.shift()}]}}]}; }
    if (fallo) throw error(fallo);
    const m = await final, partes = [];
    if (m.stop_reason === "refusal" && !hubo) partes.push({text: "Eso no te lo puedo responder."});
    if (m.stop_reason !== "max_tokens" && m.stop_reason !== "refusal") {
      const usos = (m.content || []).filter((b) => b.type === "tool_use" && entradaValida(b, herramientas));
      if (usos.length) {
        crudos.set(usos[0].id, m.content);
        if (crudos.size > 50) crudos.delete(crudos.keys().next().value);
        for (const b of usos) partes.push({functionCall: {name: b.name, args: b.input, id: b.id}});
      }
    }
    yield {candidates: [{content: {parts: partes}}], usageMetadata: uso(m.usage)};
  }

  function motor(a, o) {
    const herramientas = aHerramientas(o.herramientas);
    return {
      async generateContentStream({contents}) {
        let c;
        try { c = await cliente(a.clave); } catch (e) { throw error(e); }
        const p = pedido(a, o, aMensajes(contents), true);
        const s = conRespaldo(a.modelo) ? c.beta.messages.stream(p) : c.messages.stream(p);
        return {stream: trozos(s, herramientas)};
      },
      async generateContent(prompt) {
        try {
          const c = await cliente(a.clave), p = pedido(a, o, [{role: "user", content: String(prompt)}], false);
          const m = await (conRespaldo(a.modelo) ? c.beta.messages.create(p) : c.messages.create(p));
          const texto = (m.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
          return {response: {text: () => Proveedores.texto.extraerJSON(texto), usageMetadata: uso(m.usage)}};
        } catch (e) { throw error(e); }
      },
    };
  }

  if (typeof Proveedores !== "undefined") Proveedores.registrar("claude", motor);
  return {motor, texto: {aMensajes, aHerramientas, entradaValida, uso}};
})();
if (typeof module !== "undefined") module.exports = ProveedorClaude;
