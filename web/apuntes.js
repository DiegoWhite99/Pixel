/* Fase 13 - Notas por voz y su block de notas (pedidos del usuario, 9 nov).
   - "Píxel, toma nota" (o "toma nota de la clase de física"): Pixel dice "Tomando notas para el
     lunes 9 de noviembre a las 2:45 de la tarde" y desde ahi todo lo que se oye va a la nota, sin
     decir "Píxel" (el nucleo llama a dictar() antes de buscar la palabra de activacion). Una pausa
     larga empieza un parrafo nuevo.
   - "Píxel, termina la nota" (o "deja de tomar notas", "Píxel, listo") la guarda y pregunta si la
     analiza. Tras 5 min de silencio se cierra sola.
   - Al guardarla, Gemini le pone un asunto (reusando los que ya hay) y saca lo mas importante en una
     frase (clasificar: una peticion). "Analizar con Píxel" saca resumen, ideas generales, ideas
     especificas, lo mas destacado y pendientes (otra peticion).
   - La pestana Notas no ocupa toda la pantalla: una fila por nota (hora, titulo, lo mas importante y
     asunto), agrupadas por dia y filtrables por fecha, asunto y palabras. Al tocar una fila se abre
     su hoja de libreta completa (solo una a la vez).
   - Las notas de mas de 30 dias se borran solas al abrir la app (no hay servidor que lo haga).
   - Datos: usuarios/<uid>/apuntes/<id> = {titulo, contexto, creado, actualizado, texto, asunto,
     importante, analisis (texto JSON), analizado}. (En el cerebro, las "notas" son otra cosa.)
   Al cargarse no toca la pagina: las funciones de texto (PixelApuntes.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo, T = A.texto, plano = T.plano;

  const PAUSA_PARRAFO_MS = 6000;               // una pausa asi entre frases: parrafo nuevo
  const SILENCIO_MS = 5 * 60000;               // sin oir nada este rato, la nota se cierra sola
  const VIDA_MS = 30 * 86400000;               // a los 30 dias, la nota se borra
  const MAX_TEXTO = 30000;
  const DIA_MS = 86400000;
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // "toma nota de la clase de física" -> {contexto: "la clase de física"}; null si no es eso
  const RE_TOMAR = /^[\s¡¿,.]*(?:por favor[\s,]+)?(?:toma|tomar|tomame|empieza a tomar|comienza a tomar|apunta|anota|apuntame|anotame|abre)(?:\s+(?:una|unas|las|un))?\s+(?:nota|notas|apuntes|apunte|esto)\b[\s,:.]*(?:(?:de|sobre|para|acerca de|del)\s+)?/;
  function pedidoDeNota(texto) {
    const t = String(texto || "");
    const m = RE_TOMAR.exec(plano(t));
    if (!m) return null;
    let contexto = t.slice(m[0].length).trim().replace(/[.!?¡¿]+$/, "");
    if (/^(la|el)$/i.test(contexto)) contexto = "";
    return {contexto: contexto.slice(0, 300)};
  }

  // ¿quiere terminar la nota? ("termina la nota", "deja de tomar notas", "Píxel, listo")
  const RE_FIN = /\b(termina|terminar|termino|acaba|acabar|cierra|cerrar|finaliza|finalizar|guarda|guardar|deten|para de tomar|deja de tomar|ya no tomes|fin de)\s+(?:(?:la|las|el|los|de|tomar)\s+)*(nota|notas|apunte|apuntes|dictado)\b/;
  const RE_FIN_PIXEL = /^[\s,.¡]*(?:oye\s+)?(?:pixel|bixel)[\s,.]+(?:listo|ya esta|eso es todo|ya termine|terminamos|termine)\b/;
  const esFin = (texto) => RE_FIN.test(plano(texto)) || RE_FIN_PIXEL.test(plano(texto));

  // Una frase dictada: sin "Píxel" delante, con mayuscula y su punto
  function fraseDictada(texto) {
    const [ok, resto] = A.texto.activacion(texto);
    let f = (ok ? resto : texto).trim();
    if (!f) return "";
    f = f.charAt(0).toUpperCase() + f.slice(1);
    if (!/[.!?…:;]$/.test(f)) f += ".";
    return f;
  }

  // "lunes 9 de noviembre a las 2:45 de la tarde"
  function cuandoNota(ms) {
    const d = new Date(ms);
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} ${T.horaDicha(d)}`;
  }

  const contarPalabras = (t) => (String(t || "").match(/[\p{L}\p{N}]+/gu) || []).length;
  const inicioDia = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diaIso = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  // El grupo de una nota en la lista: "Hoy", "Ayer" o "lunes 3 de noviembre"
  function grupoFecha(ms, ahora) {
    const dd = Math.round((inicioDia(ahora) - inicioDia(ms)) / DIA_MS);
    if (dd === 0) return "Hoy";
    if (dd === 1) return "Ayer";
    const d = new Date(ms);
    return `${DIAS[d.getDay()].charAt(0).toUpperCase() + DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  }

  // Las notas que pasan el filtro {fecha: todas|hoy|ayer|semana|AAAA-MM-DD, asunto, texto}
  function filtrarNotas(notas, f, ahora) {
    const hoy = inicioDia(ahora);
    const enFecha = (n) => {
      const dia = inicioDia(n.creado);
      if (!f.fecha || f.fecha === "todas") return true;
      if (f.fecha === "hoy") return dia === hoy;
      if (f.fecha === "ayer") return dia === inicioDia(hoy - DIA_MS / 2);     // el inicio de ayer (vale con cambio de hora)
      if (f.fecha === "semana") return dia > hoy - 7 * DIA_MS;
      return diaIso(n.creado) === f.fecha;
    };
    const q = plano(String(f.texto || "")).trim();
    return notas.filter((n) => enFecha(n) && (!f.asunto || n.asunto === f.asunto)
      && (!q || plano(`${n.titulo} ${n.contexto} ${n.asunto} ${n.importante} ${n.texto}`).includes(q)));
  }

  // Los asuntos que hay, con cuantas notas tiene cada uno (de mas a menos)
  function asuntos(notas) {
    const c = new Map();
    for (const n of notas) if (n.asunto) c.set(n.asunto, (c.get(n.asunto) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  // Las que ya cumplieron 30 dias
  const viejas = (notas, ahora) => notas.filter((n) => ahora - n.creado > VIDA_MS).map((n) => n.id);
  const diasQuedan = (n, ahora) => Math.max(0, Math.ceil((n.creado + VIDA_MS - ahora) / DIA_MS));

  // Sin Gemini (o si falla): el asunto sale del titulo y lo importante, de la primera frase
  function clasificacionLocal(n) {
    const asunto = String(n.titulo || "Nota").replace(/^nota del .*/i, "General").slice(0, 40);
    const primera = (String(n.texto || "").split(/(?<=[.!?…])\s+/)[0] || "").slice(0, 200);
    return {asunto, importante: primera};
  }

  const limpiarAsunto = (s) => { const t = String(s || "").trim().replace(/[.!?¡¿"']+/g, "").slice(0, 40); return t.charAt(0).toUpperCase() + t.slice(1); };

  // Lo que devuelve Gemini al analizar, limpio y acotado
  function limpiarAnalisis(r) {
    const lista = (x, n) => (Array.isArray(x) ? x : []).map((v) => String(v || "").trim()).filter(Boolean).slice(0, n).map((v) => v.slice(0, 400));
    return {resumen: String((r && r.resumen) || "").trim().slice(0, 1500),
      ideas_generales: lista(r && r.ideas_generales, 8), ideas_especificas: lista(r && r.ideas_especificas, 12),
      destacado: lista(r && r.destacado, 6), pendientes: lista(r && r.pendientes, 10),
      asunto: limpiarAsunto(r && r.asunto), importante: String((r && r.importante) || "").trim().slice(0, 300)};
  }

  // ------------------------------------------------------------------ estado
  const ap = {activa: null, lista: null, quitar: [], analizando: "", pintado: "", pintadoVivo: "", pintadoFiltros: "",
    filtro: {fecha: "todas", asunto: "", texto: ""}, abierta: "", limpiado: false};
  const ref = (sub) => nube.d.ref(nube.db, `usuarios/${nube.uid}/${sub}`);
  const laCara = () => (typeof cara !== "undefined" ? cara : null);
  const lista = () => ap.lista || [];

  function alUsuario(u) {
    ap.quitar.forEach((f) => f());
    Object.assign(ap, {quitar: [], lista: null, activa: null, pintado: "", pintadoVivo: "", pintadoFiltros: "", abierta: "", limpiado: false});
    if (!u) { pintar(); return; }
    ap.quitar.push(nube.d.onValue(ref("apuntes"), (s) => {
      const v = s.val() || {};
      ap.lista = Object.entries(v).filter(([, n]) => n && typeof n.creado === "number").map(([id, n]) => {
        let analisis = null;
        try { analisis = n.analisis ? JSON.parse(n.analisis) : null; } catch (e) { analisis = null; }
        return {id, titulo: n.titulo || "Nota", contexto: n.contexto || "", creado: n.creado, texto: n.texto || "", analisis,
          analizado: n.analizado || 0, asunto: n.asunto || "", importante: n.importante || ""};
      }).sort((a, b) => b.creado - a.creado);
      limpiarViejas();
      pintar();
    }, (e) => { console.warn("apuntes:", e); ap.lista = []; pintar(); }));
  }

  // A los 30 dias se borran (al abrir la app: en el plan gratis no hay servidor que lo haga)
  function limpiarViejas() {
    if (ap.limpiado || !nube.uid) return;
    ap.limpiado = true;
    const ids = viejas(lista(), Date.now()).filter((id) => !(ap.activa && ap.activa.id === id));
    if (!ids.length) return;
    Promise.all(ids.map((id) => nube.d.remove(ref("apuntes/" + id))))
      .then(() => toast(`Borré ${ids.length === 1 ? "una nota" : ids.length + " notas"} de hace más de 30 días.`))
      .catch((e) => console.warn("apuntes: no pude borrar las viejas", e));
  }

  // ------------------------------------------------------------------ tomar notas
  async function empezar(contexto) {
    if (!nube.uid) return "Primero entra con tu cuenta.";
    if (ap.activa) return `Ya estoy tomando notas de ${ap.activa.titulo}. Cuando termines, di «Píxel, termina la nota».`;
    const ahora = Date.now();
    const d = new Date(ahora);
    const tema = String(contexto || "").replace(/^(la|el|los|las|un|una|mi|mis)\s+/i, "");      // "la clase de física" -> "Clase de física"
    const titulo = tema ? (tema.charAt(0).toUpperCase() + tema.slice(1)).slice(0, 120) : `Nota del ${d.getDate()} de ${MESES[d.getMonth()]}`;
    const r = nube.d.push(ref("apuntes"));
    try {
      await N.conTiempo(nube.d.set(r, {titulo, contexto: contexto || "", creado: ahora, actualizado: ahora, texto: ""}), 8000);
    } catch (e) { return "No pude abrir la nota. Revisa la conexión."; }
    ap.activa = {id: r.key, titulo, contexto: contexto || "", creado: ahora, texto: "", ultimaT: ahora};
    ap.abierta = r.key;
    const c = laCara();
    if (c) c.emocion("escribiendo", 24 * 3600 * 1000);
    pintar();
    return `Tomando notas para el ${cuandoNota(ahora)}. Te escucho; cuando termines, di «Píxel, termina la nota».`;
  }

  // Lo que se oye con una nota abierta: a la nota (o la cierra)
  function dictar(texto) {
    const a = ap.activa;
    if (!a) return false;
    if (esFin(texto)) { terminar(); return true; }
    const f = fraseDictada(texto);
    if (!f) return true;
    const ahora = Date.now();
    a.texto = (a.texto + (a.texto ? (ahora - a.ultimaT > PAUSA_PARRAFO_MS ? "\n\n" : " ") : "") + f).slice(0, MAX_TEXTO);
    a.ultimaT = ahora;
    nube.d.update(ref("apuntes/" + a.id), {texto: a.texto, actualizado: ahora}).catch((e) => console.warn("apuntes: no guarde", e));
    pintar();
    return true;
  }

  async function terminar(porSilencio) {
    const a = ap.activa;
    if (!a) return "No estaba tomando notas.";
    ap.activa = null;
    const c = laCara();
    if (c) c.emocion("normal", 0);
    pintar();
    const palabras = contarPalabras(a.texto);
    if (!palabras) {
      nube.d.remove(ref("apuntes/" + a.id)).catch(() => {});
      await N.anunciar("No anoté nada, así que no guardé la nota.", {toast: false, gesto: false});
      return "";
    }
    try { await N.conTiempo(nube.d.update(ref("apuntes/" + a.id), {texto: a.texto, actualizado: Date.now()}), 8000); } catch (e) { /* ya se guardo frase a frase */ }
    clasificar(a.id, a);                                       // asunto y lo mas importante, sin esperar
    const guardada = `${porSilencio ? "Cerré la nota porque no oí nada en un rato. " : "Listo, "}guardé tu nota de ${palabras} palabra${palabras === 1 ? "" : "s"}.`;
    if (!N.activo("analizar")) {                               // Ajustes: sin ofrecer el analisis (gasta Gemini)
      await N.anunciar(guardada, {toast: false, gesto: "feliz"});
      return "";
    }
    N.confirmar({pregunta: "¿Quieres que la analice?", titulo: `Analizar «${a.titulo}»`, boton: "Analizar con Píxel",
      si: /^(si|sip|dale|claro|hazlo|analizala|analiza|ok|okay|por favor|de una|bueno)\b/, dura: 120000,
      hacer: () => analizar(a.id, true), cancelar: () => "Vale, queda guardada en Notas."});
    await N.anunciar(`${guardada} ¿Quieres que la analice?`, {toast: false, gesto: "feliz"});
    N.oye.ventanaHasta = Date.now() + 15000;                 // el "sí" sin decir "Píxel"
    return "";
  }

  // ------------------------------------------------------------------ asunto, lo importante y analisis
  // Una peticion corta a Gemini: el asunto (reusando los que ya hay) y lo mas importante en una frase.
  // Con "Asunto automático" apagado en Ajustes (lo normal: consumo bajo), salen del titulo y de la
  // primera frase, sin Gemini.
  async function clasificar(id, a) {
    const n = Object.assign({titulo: a.titulo, contexto: a.contexto, texto: a.texto}, lista().find((x) => x.id === id) || {});
    let r = null;
    if (N.activo("clasificar")) try {
      const ya = asuntos(lista()).map(([s]) => s).slice(0, 30);
      const prompt = `Notas dictadas (transcripción automática). Título: ${n.titulo}. Contexto: ${n.contexto || "(ninguno)"}.\n\n${String(n.texto).slice(0, 8000)}\n\n`
        + "Devuelve JSON {\"asunto\": \"…\", \"importante\": \"…\"}. asunto: 1 a 3 palabras para agrupar la nota (materia, proyecto, tema: «Biología», «Trabajo», «Feria»)"
        + (ya.length ? `; si encaja, usa exactamente uno de estos que ya existen: ${ya.join(", ")}` : "")
        + ". importante: lo más importante de la nota en una sola frase corta (máximo 20 palabras), sin inventar.";
      r = await N.generarJSON(prompt, "Clasificas apuntes. Solo devuelves el JSON pedido, en español.", "clasificar");
    } catch (e) { console.warn("apuntes: no pude clasificar", e); r = null; }
    const local = clasificacionLocal(n);
    const asunto = limpiarAsunto(r && r.asunto) || local.asunto;
    const importante = String((r && r.importante) || "").trim().slice(0, 300) || local.importante;
    try { await nube.d.update(ref("apuntes/" + id), {asunto, importante}); } catch (e) { console.warn("apuntes:", e); }
  }

  async function analizar(id, porVoz) {
    const n = lista().find((x) => x.id === id);
    if (!n) return "No encontré esa nota.";
    if (!n.texto.trim()) return "Esa nota está vacía.";
    ap.analizando = id;
    pintar();
    try {
      const ya = asuntos(lista()).map(([s]) => s).slice(0, 30);
      const prompt = `Notas tomadas por voz (transcripción automática: puede traer palabras mal oídas; corrige lo obvio).\n`
        + `Título: ${n.titulo}\nContexto: ${n.contexto || "(sin contexto)"}\nFecha: ${cuandoNota(n.creado)}\n\nNOTAS:\n${n.texto.slice(0, 20000)}\n\n`
        + "Devuelve JSON con estas claves, en español:\n"
        + "\"resumen\": 3 a 5 frases con lo esencial;\n\"ideas_generales\": 3 a 6 ideas generales (los temas);\n"
        + "\"ideas_especificas\": 3 a 10 ideas específicas (datos concretos: cifras, nombres, fechas, definiciones);\n"
        + "\"destacado\": 2 a 5 cosas más importantes o para recordar;\n\"pendientes\": tareas o acciones que se mencionan (puede ser una lista vacía);\n"
        + `"asunto": 1 a 3 palabras para agrupar la nota${ya.length ? ` (si encaja, uno de estos: ${ya.join(", ")})` : ""};\n`
        + "\"importante\": lo más importante en una sola frase corta.\nSolo lo que está en las notas: no inventes.";
      const r = limpiarAnalisis(await N.generarJSON(prompt, "Eres Píxel, un asistente que ordena y resume apuntes. Solo devuelves el JSON pedido.", "analizar"));
      if (!r.resumen) throw new Error("análisis vacío");
      const cambio = {analisis: JSON.stringify(r), analizado: Date.now()};
      if (r.asunto) cambio.asunto = r.asunto;
      if (r.importante) cambio.importante = r.importante;
      await N.conTiempo(nube.d.update(ref("apuntes/" + id), cambio), 8000);
      ap.analizando = "";
      pintar();
      if (!porVoz) { toast("Análisis listo."); return ""; }
      const destacado = r.destacado.slice(0, 2).map((x) => x.replace(/[\s.;:]+$/, "")).join("; ");
      return `Listo. ${r.resumen}${destacado ? " Lo más destacado: " + destacado + "." : ""} Lo tienes completo en Notas.`;
    } catch (e) {
      console.warn("apuntes: analisis", e);
      ap.analizando = "";
      pintar();
      if (!porVoz) toast("No pude analizarla: " + (e.message || e), true);
      return "No pude analizar la nota ahora. Inténtalo otra vez en un momento.";
    }
  }

  // la nota de la que habla el usuario: por parecido con el titulo, el contexto o el asunto; si no, la ultima
  function notaDe(cual) {
    const ns = lista();
    if (!ns.length) return null;
    if (!cual) return ns[0];
    let mejor = null, nota = 0;
    for (const n of ns) { const p = T.parecido(cual, `${n.titulo} ${n.contexto} ${n.asunto}`); if (p > nota) { mejor = n; nota = p; } }
    return nota >= 0.5 ? mejor : ns[0];
  }

  // ------------------------------------------------------------------ herramientas para Gemini
  const HERRAMIENTAS = [
    {name: "tomar_nota", description: "Empieza a tomar notas: desde ahí todo lo que diga el usuario se escribe en una nota, hasta que diga «termina la nota».",
      parameters: {type: "object", properties: {contexto: {type: "string", description: "De qué es la nota, si lo dice: 'la clase de física', 'la reunión con Ana'."}}}},
    {name: "ver_notas", description: "Lista las notas guardadas (título, asunto, cuándo, lo más importante, si están analizadas). Se borran solas a los 30 días."},
    {name: "leer_nota", description: "Devuelve el texto de una nota para leérsela o responder sobre ella.",
      parameters: {type: "object", properties: {cual: {type: "string", description: "Cuál: por su título, tema o asunto; vacío = la última."}}}},
    {name: "analizar_nota", description: "Analiza una nota con IA: resumen, ideas generales y específicas, lo más destacado y pendientes.",
      parameters: {type: "object", properties: {cual: {type: "string", description: "Cuál: por su título, tema o asunto; vacío = la última."}}}},
  ];

  async function ejecutar(nombre, a) {
    if (!HERRAMIENTAS.some((h) => h.name === nombre)) return undefined;
    if (nombre === "tomar_nota") return empezar(String(a.contexto || "").trim().slice(0, 300));
    if (nombre === "ver_notas") {
      return {respuesta: {notas: lista().slice(0, 15).map((n) => ({titulo: n.titulo, asunto: n.asunto || undefined, cuando: cuandoNota(n.creado),
        importante: n.importante || undefined, palabras: contarPalabras(n.texto), analizada: !!n.analisis})),
        nota: lista().length ? "" : "No hay notas: se toman diciendo «Píxel, toma nota»."}};
    }
    const n = notaDe(String(a.cual || "").trim());
    if (!n) return "No tienes notas todavía. Di «Píxel, toma nota» para empezar una.";
    if (nombre === "leer_nota") return {respuesta: {titulo: n.titulo, asunto: n.asunto || undefined, cuando: cuandoNota(n.creado), texto: n.texto.slice(0, 3000) || "(vacía)"}};
    return analizar(n.id, true);
  }

  // ------------------------------------------------------------------ pantalla
  const hora = (ms) => new Date(ms).toLocaleTimeString("es", {hour: "numeric", minute: "2-digit"});
  const fechaCorta = (ms) => { const d = new Date(ms); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()} · ${hora(ms)}`; };
  const parrafos = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p}</p>`).join("");

  function htmlAnalisis(an) {
    const sec = (titulo, items) => (items && items.length ? `<h4>${titulo}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    return `<div class="analisis"><h4>Resumen</h4><p>${esc(an.resumen)}</p>${sec("Ideas generales", an.ideas_generales)}${sec("Ideas específicas", an.ideas_especificas)}`
      + `${sec("Lo más destacado", an.destacado)}${sec("Pendientes", an.pendientes)}</div>`;
  }

  // La hoja de libreta completa de una nota (la que esta abierta)
  function htmlHoja(n, enVivo) {
    const texto = enVivo ? ap.activa.texto : n.texto;
    return `<article class="nota-hoja${enVivo ? " en-vivo" : ""}">
      <header><h3>${esc(n.titulo)}</h3><small>${esc(fechaCorta(n.creado))}${enVivo ? ' · <span class="grabando"></span>tomando notas'
        : ` · se borra en ${diasQuedan(n, Date.now())} día${diasQuedan(n, Date.now()) === 1 ? "" : "s"}`}</small>
        ${n.asunto ? `<span class="contexto">${esc(n.asunto)}</span>` : ""}${n.contexto && n.contexto !== n.asunto ? ` <span class="contexto suave">${esc(n.contexto)}</span>` : ""}</header>
      <div class="renglones">${texto ? parrafos(texto) : '<p class="sub">Todavía vacía.</p>'}</div>
      ${n.analisis ? htmlAnalisis(n.analisis) : ""}
      <div class="acciones">${enVivo ? '<button class="btn primario" type="button" data-nota-fin>Terminar nota</button>'
        : `<button class="btn primario" type="button" data-nota-analizar="${esc(n.id)}" ${ap.analizando === n.id || !n.texto ? "disabled" : ""}>${ap.analizando === n.id ? "Analizando…" : n.analisis ? "Volver a analizar" : "Analizar con Píxel"}</button>`}
        <button class="btn" type="button" data-nota-cerrar>Cerrar</button>
        <button class="btn peligro" type="button" data-nota-borrar="${esc(n.id)}">Borrar</button></div>
    </article>`;
  }

  // Una fila compacta: hora, titulo, lo mas importante y el asunto
  function htmlFila(n) {
    const enVivo = ap.activa && ap.activa.id === n.id;
    const importante = enVivo ? "Tomando notas…" : n.importante || (n.texto ? n.texto.slice(0, 120) : "Vacía");
    return `<button class="nota-fila${ap.abierta === n.id ? " abierta" : ""}" type="button" data-nota-abrir="${esc(n.id)}" aria-expanded="${ap.abierta === n.id}">
      <span class="nf-hora">${enVivo ? '<span class="grabando"></span>' : ""}${esc(hora(n.creado))}</span>
      <span class="nf-txt"><b>${esc(n.titulo)}</b><small>${n.importante && !enVivo ? "★ " : ""}${esc(importante)}</small></span>
      ${n.asunto ? `<span class="nf-asunto">${esc(n.asunto)}</span>` : ""}${n.analisis ? '<span class="nf-ok" title="Analizada">✓</span>' : ""}
    </button>`;
  }

  function pintar() {
    if (!document.getElementById("v-notas")) return;
    $("#tab-notas").hidden = !nube.usuario || !N.activo("apuntes");
    // en Inicio, mientras se dicta: la nota en vivo
    const a = ap.activa, vivo = $("#ag-nota");
    const hv = a ? `<div class="txt"><b><span class="grabando"></span>Tomando notas · ${esc(a.titulo)}</b><small>${esc(a.texto ? "…" + a.texto.slice(-220) : "Te escucho. Cuando termines, di «Píxel, termina la nota».")}</small></div>
      <button class="btn" type="button" data-nota-fin>Terminar nota</button>` : "";
    if (hv !== ap.pintadoVivo) { vivo.innerHTML = hv; vivo.hidden = !a; ap.pintadoVivo = hv; }
    $("#nt-dictar").textContent = a ? "Terminar nota" : "Dictar una nota";
    const ns = ap.lista, f = ap.filtro, ahora = Date.now();
    // los botones de asunto salen de las notas que hay
    const hf = (ns || []).length ? `<button type="button" class="${f.asunto ? "" : "activo"}" data-nota-asunto="">Todos los asuntos</button>`
      + asuntos(ns).map(([s, k]) => `<button type="button" class="${f.asunto === s ? "activo" : ""}" data-nota-asunto="${esc(s)}">${esc(s)} <small>${k}</small></button>`).join("") : "";
    if (hf !== ap.pintadoFiltros) { $("#nt-asuntos").innerHTML = hf; ap.pintadoFiltros = hf; }
    document.querySelectorAll("[data-nota-fecha]").forEach((b) => b.classList.toggle("activo", b.dataset.notaFecha === f.fecha));
    $("#nt-filtros").hidden = !(ns || []).length;
    let h;
    if (ns === null) h = '<div class="vacio">Cargando…</div>';
    else if (!ns.length) h = '<div class="vacio">Aún no hay notas. Di «Píxel, toma nota» y dicta, o toca «Dictar una nota».</div>';
    else {
      const vistas = filtrarNotas(ns, f, ahora);
      if (a && !vistas.some((n) => n.id === a.id)) { const enCurso = ns.find((n) => n.id === a.id); if (enCurso) vistas.unshift(enCurso); }   // la que se dicta, siempre
      h = vistas.length ? "" : '<div class="vacio">Ninguna nota con ese filtro.</div>';
      let grupo = "";
      for (const n of vistas) {
        const g = grupoFecha(n.creado, ahora);
        if (g !== grupo) { h += `<h3 class="nt-dia">${esc(g)}</h3>`; grupo = g; }
        h += htmlFila(n);
        if (ap.abierta === n.id) h += htmlHoja(n, a && a.id === n.id);
      }
    }
    if (h !== ap.pintado) { $("#nt-lista").innerHTML = h; ap.pintado = h; }
    $("#nt-cuenta").textContent = ns && ns.length ? `${ns.length} nota${ns.length === 1 ? "" : "s"} · se borran solas a los 30 días` : "";
  }

  function montar() {
    if (!document.getElementById("v-notas")) return;
    const fin = async () => { if (ap.activa) await terminar(); };
    $("#ag-nota").addEventListener("click", (e) => { if (e.target.closest("[data-nota-fin]")) fin(); });
    $("#nt-dictar").addEventListener("click", async () => {
      N.desbloquear();
      if (ap.activa) { fin(); return; }
      if (!N.oye.quiere) N.escuchar();                       // sin el microfono puesto, se pone
      const t = await empezar("");
      N.anunciar(t, {toast: false, gesto: false, beep: false});
    });
    $("#nt-filtros").addEventListener("click", (e) => {
      const b = e.target.closest("[data-nota-fecha], [data-nota-asunto]");
      if (!b) return;
      if (b.dataset.notaFecha !== undefined) { ap.filtro.fecha = b.dataset.notaFecha; $("#nt-dia").value = ""; }
      if (b.dataset.notaAsunto !== undefined) ap.filtro.asunto = b.dataset.notaAsunto;
      pintar();
    });
    $("#nt-dia").addEventListener("change", (e) => { ap.filtro.fecha = e.target.value || "todas"; pintar(); });
    $("#nt-buscar").addEventListener("input", (e) => { ap.filtro.texto = e.target.value; pintar(); });
    $("#nt-lista").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.notaAbrir) { ap.abierta = ap.abierta === b.dataset.notaAbrir ? "" : b.dataset.notaAbrir; pintar(); return; }
      if (b.dataset.notaCerrar !== undefined) { ap.abierta = ""; pintar(); return; }
      if (b.dataset.notaFin !== undefined) fin();
      if (b.dataset.notaAnalizar) analizar(b.dataset.notaAnalizar, false);
      if (b.dataset.notaBorrar && confirm("¿Borrar esta nota?")) {
        if (ap.activa && ap.activa.id === b.dataset.notaBorrar) { ap.activa = null; const c = laCara(); if (c) c.emocion("normal", 0); }
        nube.d.remove(ref("apuntes/" + b.dataset.notaBorrar)).catch((er) => toast("No pude borrarla: " + (er.code || er.message), true));
      }
    });
  }

  A.modulo({
    nombre: "apuntes", montar, alUsuario, pintar, ejecutar, dictar,
    herramientas: () => (nube.uid ? HERRAMIENTAS : []),
    capacidad: () => "- Tomar notas dictadas («toma nota»), guardarlas con fecha y asunto, y analizarlas: resumen, ideas y pendientes. Se borran solas a los 30 días (tomar_nota, ver_notas, leer_nota, analizar_nota).",
    contexto: () => (ap.activa ? `## Notas\nHay una nota abierta: ${ap.activa.titulo}.` : ""),
    // "toma nota de…": se abre sin esperar a Gemini
    atajo: (texto) => { const p = pedidoDeNota(texto); return p ? empezar(p.contexto) : undefined; },
    alSegundo: () => { if (ap.activa && Date.now() - ap.activa.ultimaT > SILENCIO_MS && !N.ocupado()) terminar(true); },
  });

  window.PixelApuntes = {texto: {pedidoDeNota, esFin, fraseDictada, cuandoNota, contarPalabras, limpiarAnalisis, grupoFecha, filtrarNotas, asuntos, viejas,
    diasQuedan, clasificacionLocal, limpiarAsunto},
    dictando: () => !!ap.activa, estado: () => ({activa: ap.activa ? Object.assign({}, ap.activa) : null, notas: lista().length, filtro: Object.assign({}, ap.filtro)})};
})();
