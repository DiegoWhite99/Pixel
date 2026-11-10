/* Fase 13 - Enfoque: la tecnica Pomodoro y la matriz de Eisenhower. El usuario elige cual usa
   (o las dos) en la pagina Enfoque; segun eso Gemini tiene unas herramientas u otras.
   - Pomodoro: usuarios/<uid>/pomodoro = {fase, ciclo, total, inicio, fin, queda, tarea, tareaId}.
     Cada fase acaba a una hora fija (fin); al llegar, una transaccion pasa a la siguiente y solo el
     aparato que la gana lo dice en voz alta (como los recordatorios). Pausado: fin = 0 y queda = ms.
   - Eisenhower: usuarios/<uid>/tareas/<id> = {texto, urgente, importante, hecha, creada, vence, pomodoros}.
     Cuadrantes: hacer (urgente e importante), planificar (importante), delegar (urgente), eliminar.
   - Preferencias: usuarios/<uid>/preferencias/enfoque = {metodo, trabajo, descanso, largo, ciclos}.
   Fase 14 (10 nov, pedido del usuario: "cuando invoque esta funcion, que cambie la pantalla principal"):
   - Con un pomodoro en marcha, Inicio pasa a modo Pomodoro: un anillo con el tiempo alrededor de Pixel,
     el reloj grande, la fase, la tarea y botones (pausar, seguir, ya termine, parar). Mientras trabajas,
     Pixel no se duerme ni hace payasadas (humor.js mira PixelTiempo.enfocado()).
   - "Píxel, organiza mis tareas" (o "la matriz de Eisenhower") abre la guia en Inicio: Pixel pide las
     tareas una a una, pregunta si son urgentes y si son importantes, las pone en la matriz y al final dice
     por donde empezar y ofrece un pomodoro con esa. La guia no usa Gemini (no gasta cupo): oye lo que se
     dice sin "Píxel" (gancho dictar), como las notas. Tambien se contesta con botones o escribiendo.
   - Atajos sin Gemini: "empieza un pomodoro (de 50 minutos) (para la tarea X)", "pausa / sigue / para
     el pomodoro", "¿cuánto queda?" y "¿qué hago primero?".
   - "Píxel, modo enfoque" (pedido del usuario el 10 nov): Inicio muestra las dos herramientas, Pixel
     propone empezar por la matriz y guia; al acabar ofrece un plan: un pomodoro para cada tarea importante,
     en orden (pomodoro.plan = texto JSON [{id, texto}], paso = la de ahora). Al acabar cada pomodoro
     pregunta "¿La terminaste?": "sí" la tacha; "aún no" repite esa tarea en el siguiente; sin respuesta,
     sigue con la siguiente (la otra queda pendiente en la matriz).
   Al cargarse no toca la pagina: las funciones de texto (PixelTiempo.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo, T = A.texto;

  const DEFECTO = {metodo: "ambos", trabajo: 25, descanso: 5, largo: 15, ciclos: 4};
  const CUADRANTES = {
    hacer: {nombre: "Hacer ya", sub: "urgente e importante", consejo: "hazla pronto"},
    planificar: {nombre: "Planificar", sub: "importante, no urgente", consejo: "búscale un momento en tu semana"},
    delegar: {nombre: "Delegar", sub: "urgente, no importante", consejo: "mira si alguien te puede ayudar"},
    eliminar: {nombre: "Eliminar", sub: "ni urgente ni importante", consejo: "quizá ni haga falta"},
  };
  const ORDEN = ["hacer", "planificar", "delegar", "eliminar"];
  const TARDE_MS = 5 * 60000;                  // una fase que acabo hace mas que esto (app cerrada) ya no se anuncia
  const GUIA_SILENCIO_MS = 2 * 60000;          // la guia se cierra sola si nadie contesta en este rato
  const RESUMEN_MS = 3 * 60000;                // y el resumen final se queda en Inicio este rato

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  function nuevoPomodoro(tarea, cfg, ahora, tareaId) {
    return {fase: "trabajo", ciclo: 1, total: cfg.ciclos, inicio: ahora, fin: ahora + cfg.trabajo * 60000, queda: 0,
      tarea: String(tarea || "").slice(0, 120), tareaId: tareaId || ""};
  }

  // La fase que sigue a p, empezando en "ahora" (el fin de la anterior: sin ir acumulando retraso).
  // null cuando acaba el descanso largo.
  function siguienteFase(p, cfg, ahora) {
    const base = {total: p.total || cfg.ciclos, tarea: p.tarea || "", tareaId: p.tareaId || "", inicio: ahora, queda: 0};
    if (p.fase === "trabajo") {
      if (p.ciclo >= (p.total || cfg.ciclos)) return Object.assign(base, {fase: "largo", ciclo: p.ciclo, fin: ahora + cfg.largo * 60000});
      return Object.assign(base, {fase: "descanso", ciclo: p.ciclo, fin: ahora + cfg.descanso * 60000});
    }
    if (p.fase === "descanso") return Object.assign(base, {fase: "trabajo", ciclo: p.ciclo + 1, fin: ahora + cfg.trabajo * 60000});
    return null;
  }

  const pausar = (p, ahora) => Object.assign({}, p, {queda: Math.max(0, p.fin - ahora), fin: 0});
  const reanudar = (p, ahora) => Object.assign({}, p, {fin: ahora + p.queda, queda: 0});
  const quedaMs = (p, ahora) => (p.fin ? Math.max(0, p.fin - ahora) : p.queda || 0);

  function cuadrante(t) {
    return t.urgente && t.importante ? "hacer" : t.importante ? "planificar" : t.urgente ? "delegar" : "eliminar";
  }

  // Pendientes por cuadrante y, dentro, lo que vence antes y lo mas viejo
  function ordenTareas(ts) {
    return ts.filter((t) => !t.hecha).sort((a, b) => ORDEN.indexOf(cuadrante(a)) - ORDEN.indexOf(cuadrante(b))
      || (a.vence || Infinity) - (b.vence || Infinity) || (a.creada || 0) - (b.creada || 0));
  }

  function buscarTarea(ts, q) {
    let mejor = null, nota = 0;
    for (const t of ts) {
      const n = T.parecido(q, t.texto);
      if (n > nota) { mejor = t; nota = n; }
    }
    return nota >= 0.5 ? mejor : null;
  }

  const minutos = (ms) => { const m = Math.round(ms / 60000); return m <= 1 ? (ms < 45000 ? "menos de un minuto" : "un minuto") : `${m} minutos`; };
  const reloj = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const lista = (xs) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1]);

  // --- la guia de Eisenhower y los atajos: lo que se entiende de una frase (texto plano, sin tildes)
  // Urgente / importante dichos en la frase. El "no" se mira antes ("no es urgente" lleva "urgente").
  const RE_URG_NO = /\b(?:no es urgente|no urgente|no son urgentes|ni urgente|nada urgente|sin prisa|no corre prisa|no hay prisa|no tiene prisa|no es para ya|puede esperar)\b/;
  const RE_URG_SI = /\b(?:urgente|urgentes|urge|para hoy|hoy mismo|para manana|para pasado manana|cuanto antes|ya mismo|lo antes posible|para esta semana|para el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/;
  const RE_IMP_NO = /\b(?:no es importante|no importante|no son importantes|ni importante|nada importante|no importa|da igual|no tan importante|poco importante|no es prioridad)\b/;
  const RE_IMP_SI = /\b(?:importante|importantes|importa|prioridad|prioritario|prioritaria|clave|fundamental)\b/;
  function banderas(p) {
    const b = {};
    if (RE_URG_NO.test(p)) b.urgente = false; else if (RE_URG_SI.test(p)) b.urgente = true;
    if (RE_IMP_NO.test(p)) b.importante = false; else if (RE_IMP_SI.test(p)) b.importante = true;
    return b;
  }

  // "tengo que entregar el informe de física, es urgente" -> {texto: "entregar el informe de física", urgente: true}
  // (urgente/importante: undefined si no se dijo)
  const RE_RELLENO = /^(?:(?:y|tambien|ademas|bueno|pues|entonces|otra|otra tarea|otra es|la otra es|una tarea es|una tarea|la tarea es|la tarea de|tarea|agrega|anade|anota|apunta|pon|tengo que|necesito|debo|hay que|me toca|quiero)\b[\s,:;.-]*)+/;
  const RE_COLA = /(?:[\s,;:.-]+(?:y|que|pero|e|es|esta|son|muy|super|bastante|algo|tambien|ademas|creo|como|y es|eso es))*[\s,;:.!?-]*$/;
  function leerTarea(texto) {
    const t = String(texto || "").trim(), p = T.plano(t);
    const b = banderas(p);
    let corte = t.length;                         // la tarea es lo que va antes de la primera bandera
    for (const re of [RE_URG_NO, RE_URG_SI, RE_IMP_NO, RE_IMP_SI]) { const m = re.exec(p); if (m && m.index < corte) corte = m.index; }
    let cabeza = t.slice(0, corte);
    const cola = RE_COLA.exec(T.plano(cabeza));
    if (cola) cabeza = cabeza.slice(0, cola.index);
    const relleno = RE_RELLENO.exec(T.plano(cabeza));
    if (relleno) cabeza = cabeza.slice(relleno[0].length);
    cabeza = cabeza.replace(/^[¡¿,.:;\s-]+|[\s,.:;!?¡¿-]+$/g, "");
    return Object.assign({texto: cabeza.slice(0, 200)}, b);
  }

  const RE_SI = /^(?:si|sip|sii|claro|obvio|por supuesto|de una|correcto|asi es|exacto|sin duda|seguro|mucho|bastante|muy|totalmente|dale|ok|okay|afirmativo|creo que si|yo creo que si)\b/;
  const RE_NO = /^(?:no|nop|nel|nada|para nada|tampoco|negativo|ni|creo que no|no mucho|no tanto)\b/;
  // muletillas delante de la respuesta: "mmm, creo que sí", "la verdad no mucho"
  const RE_MULETILLA = /^(?:m+|mm+h*|e+h*|a+h*|pues|bueno|la verdad|yo diria que|diria que|creo que|pienso que|yo creo que)[\s,.]+/;
  function siNo(p) {
    p = String(p || "").replace(/^[\s¡¿,.]+/, "");
    for (let i = 0; i < 3 && RE_MULETILLA.test(p); i++) p = p.replace(RE_MULETILLA, "");
    if (RE_NO.test(p)) return false;
    if (RE_SI.test(p)) return true;
    return null;
  }

  // La respuesta a "¿es urgente?" o "¿es importante?" (paso), y lo que se diga de paso del otro
  function respuestaPaso(texto, paso) {
    const p = T.plano(String(texto || "")).replace(/^[\s¡¿,.]+/, "").trim();
    const b = banderas(p);
    if (b[paso] === undefined) { const r = siNo(p); if (r !== null) b[paso] = r; }
    return b;
  }

  const RE_LISTO = /^(?:listo|lista|ya|ya esta|ya estan|eso es todo|es todo|eso seria todo|nada mas|ninguna|ninguna mas|no tengo mas|no hay mas|no mas|termine|terminamos|ya termine|ya no|ya no hay|son todas|esas son todas|por ahora no|no,? (?:ya|eso es todo|nada mas|ninguna|gracias))\b/;
  const RE_SALIR = /\b(?:cancela|cancelar|cancelalo|sal de la guia|salir de la guia|salte|sal de aqui|olvidalo|deja la guia|para la guia|termina la guia|cierra la guia|ya no quiero|no quiero seguir)\b/;
  const esListo = (p) => RE_LISTO.test(p) || /^(?:no|nop|nel)[\s,.!]*$/.test(p);
  const esSalir = (p) => RE_SALIR.test(p);

  // ¿Pide la guia de la matriz? ("organiza mis tareas", "usa la matriz de Eisenhower")
  const RE_EISEN = /\b[ae]i?[sz]en\s?j?h?(?:ow|au|ou)u?er\b/;
  const RE_ORGANIZAR = /\b(?:organiza|organizar|organicemos|organizame|ordena|ordenar|ordenemos|ordename|prioriza|priorizar|prioricemos|priorizame|clasifica|clasificar|clasifiquemos)\b(?:\s+\S+){0,3}?\s+(?:mis\s+|las\s+|todas\s+mis\s+)?(?:tareas|pendientes|prioridades|deberes)\b/;
  function pedidoGuia(texto) {
    const p = T.plano(String(texto || "")).replace(/^[\s¡¿,.]+/, "").replace(/[.!?]+$/, "").trim();
    if (RE_ORGANIZAR.test(p)) return true;
    if (RE_EISEN.test(p)) return !/\b(?:agrega|anade|anota|apunta|pon|mete|borra|quita|marca|mueve|cambia|completa|tacha)\b/.test(p);
    return /^(?:abre\s+|muestrame\s+)?(?:la\s+)?matriz$/.test(p) || /\b(?:guiame|ayudame)\b.*\b(?:tareas|matriz|prioridades)\b/.test(p);
  }

  // ¿Que hago primero? (se contesta con la matriz, sin Gemini)
  // ("¿qué hago hoy?" no: puede ser el calendario, eso lo decide Gemini)
  const RE_QUE_HAGO = /^(?:y\s+)?(?:(?:que|con que|por cual)\s+(?:hago|empiezo|comienzo|sigo|deberia hacer|debo hacer|me toca hacer)\s+(?:primero|ahora|ya)|por donde (?:empiezo|comienzo|arranco)(?:\s+(?:primero|ahora|ya))?)$/;
  const pideQueHago = (texto) => RE_QUE_HAGO.test(T.plano(String(texto || "")).replace(/^[\s¡¿,.]+/, "").replace(/[.!?¿¡]+/g, "").trim());

  // Ordenes del pomodoro: {accion: empezar|pausar|seguir|parar|estado, minutos?, descanso?, tarea?}; null si no es eso.
  // tarea "@sugerida": "con esa" (la que Pixel acaba de proponer). siHay: solo vale con un pomodoro en marcha.
  const PRONOMBRE = /^(?:esa|ese|eso|esta|este|esto|ella|la primera|lo primero|la misma|eso mismo|esa tarea|esta tarea|la que dijiste)$/;
  function pedidoPomodoro(texto) {
    const t = String(texto || "").trim(), pt = T.plano(t);
    const p = pt.replace(/^(?:si|sip|dale|ok|okay|claro|bueno|vale|perfecto)[\s,.!]+/, "").replace(/[.!?¿¡]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^(?:que|como|cual|cuando|para que|por que|cuantos? pomodoros? (?:hice|llevo|van))\b/.test(p) && !/^(?:cuanto|como va)/.test(p)) return null;   // una pregunta: Gemini
    if (!/\bpomodoros?\b/.test(p)) {
      if (/^(?:y\s+)?(?:cuanto|cuantos minutos)\s+(?:tiempo\s+)?(?:me\s+|nos\s+|le\s+)?(?:queda|quedan|falta|faltan)(?:\s+(?:del?|para el)\s+(?:descanso|tiempo))?$/.test(p)) return {accion: "estado", siHay: true};
      return null;
    }
    if (/\b(?:sigue|seguir|continua|continuar|reanuda|reanudar|retoma|retomar|quita la pausa)\b/.test(p)) return {accion: "seguir"};
    if (/\b(?:pausa|pausar|pausalo|pon en pausa)\b/.test(p)) return {accion: "pausar"};
    if (/\b(?:para|parar|paralo|termina|terminar|acaba|acabar|cancela|cancelar|quita|quitar|deten|detener|apaga|apagar|stop)\s+(?:ya\s+)?(?:el\s+|los\s+|este\s+)?pomodoros?\b/.test(p)) return {accion: "parar"};
    if (/\b(?:cuanto|cuantos|como va|como vamos)\b/.test(p)) return {accion: "estado"};
    if (!/\b(?:empieza|empezar|empecemos|empiezame|inicia|iniciar|iniciemos|comienza|comenzar|comencemos|arranca|arrancar|arranquemos|pon|ponme|activa|activar|hagamos|haz|hazme|quiero|vamos con|dame)\b/.test(p)
      && !/^(?:otro|un|nuevo)\s+pomodoro/.test(p)) return null;
    const r = {accion: "empezar"};
    let resto = p.slice(p.search(/\bpomodoros?\b/)).replace(/^pomodoros?/, "");
    const md = /\s*(?:y\s+|con\s+)?(?:un\s+|el\s+)?descansos?\s+de\s+(\d{1,2})(?:\s*(?:min|mins|minutos))?/.exec(resto);
    if (md) { r.descanso = Number(md[1]); resto = resto.replace(md[0], " "); }
    const mm = /\s*(?:de|por|durante)?\s*(\d{1,3})\s*(?:min|mins|minutos)\b/.exec(resto);
    if (mm) { r.minutos = Number(mm[1]); resto = resto.replace(mm[0], " "); }
    else if (/\bmedia hora\b/.test(resto)) { r.minutos = 30; resto = resto.replace(/\s*(?:de\s+)?media hora/, " "); }
    else if (/\buna hora\b/.test(resto)) { r.minutos = 60; resto = resto.replace(/\s*(?:de\s+)?una hora/, " "); }
    const mt = /^\s*(?:,\s*)?(?:para|con|de|sobre|en|y)\s+(?:(?:la|mi)\s+tarea\s+(?:de\s+)?|el\s+tema\s+(?:de\s+)?)?(.+?)\s*$/.exec(resto);
    if (mt) {
      const q = mt[1].trim().replace(/^(?:el|la|los|las|mi|mis)\s+/, "");
      if (PRONOMBRE.test(q)) r.tarea = "@sugerida";
      else if (q.length >= 3) { const i = pt.lastIndexOf(q); r.tarea = i >= 0 ? t.slice(i, i + q.length) : q; }
    }
    return r;
  }

  // "Píxel, modo enfoque"
  const pidoEnfoque = (texto) => /^(?:(?:activa|activar|pon|ponme|entra en|entrar en|abre|abrir|empieza|empezar|inicia|vamos al?|quiero(?: el)?)\s+)?(?:el\s+)?(?:modo|momento|rato)\s+(?:de\s+)?en\s?foque$|^(?:vamos a |quiero |necesito )?enfocarme$|^(?:vamos a )?enfocarnos$/
    .test(T.plano(String(texto || "")).replace(/^[\s¡¿,.]+/, "").replace(/[.!?¡¿]+/g, "").trim());

  // En la pantalla del modo enfoque: "matriz" | "pomodoro" | "si" | "no" | null
  function eleccionEnfoque(p) {
    p = String(p || "").replace(/^[\s¡¿,.]+/, "");
    if (/\b(?:pomodoro|pomodoros|directo|trabajar ya|a trabajar)\b/.test(p)) return "pomodoro";
    if (/\b(?:matriz|eisenhower|aisenhauer|eisenhauer|ordenar|organizar|ordenarlas|organizarlas|tareas)\b/.test(p)) return "matriz";
    const r = siNo(p);
    return r === true ? "si" : r === false ? "no" : null;
  }

  // "¿La terminaste?" tras un pomodoro del plan: true | false | null
  function respuestaHecha(texto) {
    const p = T.plano(String(texto || "")).replace(/^[\s¡¿,.]+/, "").replace(/[.!?¡¿]+/g, " ").trim();
    if (/^(?:aun|todavia|ya casi|casi)\b|^no\b|^me falta|^nop\b|^nel\b/.test(p)) return false;
    if (/^(?:ya\s+)?(?:la\s+)?(?:termine|acabe|hice)\b|^(?:ya|lista|listo|hecha|hecho|terminada)\b/.test(p)) return true;
    return siNo(p);
  }

  // Las tareas del plan: las importantes (Hacer ya y Planificar) en orden; si no hay, las pendientes
  // menos las de Eliminar. Como mucho 12 (un pomodoro para cada una).
  function planDeTareas(ts) {
    const orden = ordenTareas(ts);
    let plan = orden.filter((x) => cuadrante(x) === "hacer" || cuadrante(x) === "planificar");
    if (!plan.length) plan = orden.filter((x) => cuadrante(x) !== "eliminar");
    return plan.slice(0, 12).map((x) => ({id: x.id, texto: String(x.texto).slice(0, 120)}));
  }
  function leerPlan(texto) {
    try { const v = JSON.parse(texto || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.texto === "string") : []; } catch (e) { return []; }
  }
  // La tarea del siguiente pomodoro del plan (null: ya no quedan). seguir: repetir la de ahora.
  function avanzarPlan(p, hechas) {
    const plan = leerPlan(p.plan);
    let i = p.seguir ? p.paso || 0 : (p.paso || 0) + 1;
    while (i < plan.length && hechas.has(plan[i].id)) i++;
    if (i >= plan.length) return null;
    return {paso: i, tarea: plan[i].texto, tareaId: plan[i].id || "", seguir: false, total: p.seguir ? (p.total || 0) + 1 : p.total};
  }

  // ------------------------------------------------------------------ estado y nube
  const t = {cfg: Object.assign({}, DEFECTO), pomo: null, tareas: null, quitar: [], pasando: false, pintado: "", pintadoP: "", pintadoM: "",
    guia: null, sugerida: "", pregunta: null};   // pregunta: {tareaId, texto, hasta} ("¿La terminaste?")
  const ref = (sub) => nube.d.ref(nube.db, `usuarios/${nube.uid}/${sub}`);
  const usaPomodoro = () => t.cfg.metodo !== "eisenhower";
  const usaMatriz = () => t.cfg.metodo !== "pomodoro";
  const pendientes = () => ordenTareas(t.tareas || []);

  function alUsuario(u) {
    t.quitar.forEach((f) => f());
    Object.assign(t, {quitar: [], pomo: null, tareas: null, cfg: Object.assign({}, DEFECTO), pintado: "", pintadoP: "", pintadoM: "", guia: null, sugerida: "", pregunta: null});
    if (!u) { pintar(); return; }
    t.quitar.push(nube.d.onValue(ref("preferencias/enfoque"), (s) => {
      const v = s.val() || {};
      t.cfg = {metodo: ["pomodoro", "eisenhower", "ambos"].includes(v.metodo) ? v.metodo : DEFECTO.metodo,
        trabajo: limite(v.trabajo, 1, 120, DEFECTO.trabajo), descanso: limite(v.descanso, 1, 60, DEFECTO.descanso),
        largo: limite(v.largo, 1, 90, DEFECTO.largo), ciclos: limite(v.ciclos, 1, 12, DEFECTO.ciclos)};
      t.pintado = "";
      pintar();
    }, () => {}));
    t.quitar.push(nube.d.onValue(ref("pomodoro"), (s) => {
      const v = s.val(), antes = !!t.pomo;
      t.pomo = v && v.fase ? v : null;
      pintar();
      if (antes !== !!t.pomo) N.pintar();       // Inicio cambia de modo (tambien si lo empezo otro aparato)
    }, () => {}));
    t.quitar.push(nube.d.onValue(ref("tareas"), (s) => {
      const v = s.val() || {};
      t.tareas = Object.entries(v).filter(([, x]) => x && typeof x.texto === "string").map(([id, x]) => ({id, texto: x.texto, urgente: !!x.urgente,
        importante: !!x.importante, hecha: !!x.hecha, creada: x.creada || 0, vence: x.vence || 0, pomodoros: x.pomodoros || 0}));
      pintar();
    }, (e) => { console.warn("tiempo:", e); t.tareas = []; pintar(); }));
  }

  function limite(v, min, max, defecto) {
    const n = Math.round(Number(v));
    return isFinite(n) && n >= min && n <= max ? n : defecto;
  }

  const ponerPomo = (p) => N.conTiempo(nube.d.set(ref("pomodoro"), p), 8000);

  // Al empezar un pomodoro o la guia, la pantalla principal cambia: se va a Inicio
  function irAInicio() {
    if ((location.hash || "#inicio") !== "#inicio") location.hash = "#inicio";
  }

  // ------------------------------------------------------------------ pomodoro
  async function empezar(tarea, mins, descanso) {
    const cfg = Object.assign({}, t.cfg);
    if (Number(mins) > 0) cfg.trabajo = Math.min(120, Math.round(Number(mins)));
    if (Number(descanso) > 0) cfg.descanso = Math.min(60, Math.round(Number(descanso)));
    if (tarea === "@sugerida") tarea = t.sugerida;
    const ligada = tarea ? buscarTarea(pendientes(), tarea) : null;
    const p = nuevoPomodoro(ligada ? ligada.texto : tarea, cfg, Date.now(), ligada ? ligada.id : "");
    p.trabajo = cfg.trabajo;                  // la duracion pedida vale para toda la ronda
    p.descanso = cfg.descanso;
    await ponerPomo(p);
    t.pomo = p;                               // sin esperar a la nube: Inicio cambia ya
    if (t.guia) t.guia = null;                // el resumen de la guia deja paso al pomodoro
    irAInicio();
    pintar();
    N.pintar();
    return `Empieza el pomodoro: ${cfg.trabajo} minutos${p.tarea ? " para " + p.tarea : ""}. Te aviso al terminar.`;
  }

  // Un pomodoro para cada tarea del plan, en orden (lo ofrece la guia al acabar, o "pomodoro" en el modo enfoque)
  async function empezarPlan() {
    const plan = planDeTareas(t.tareas || []);
    if (!plan.length) return empezar("");
    const cfg = Object.assign({}, t.cfg);
    const p = Object.assign(nuevoPomodoro(plan[0].texto, cfg, Date.now(), plan[0].id),
      {total: plan.length, trabajo: cfg.trabajo, descanso: cfg.descanso, plan: JSON.stringify(plan), paso: 0});
    await ponerPomo(p);
    t.pomo = p;
    t.guia = null;
    t.pregunta = null;
    irAInicio();
    pintar();
    N.pintar();
    return `Empieza tu plan: ${plan.length === 1 ? "una tarea" : plan.length + " tareas"}, un pomodoro para cada una. Primero, ${plan[0].texto}: ${cfg.trabajo} minutos. Te aviso al terminar.`;
  }

  // La configuracion de la ronda en marcha (si se pidio "un pomodoro de 50 minutos", vale para todos)
  const cfgDe = (p) => Object.assign({}, t.cfg, p && p.trabajo ? {trabajo: p.trabajo} : {}, p && p.descanso ? {descanso: p.descanso} : {});
  const duracionFase = (p) => (p.fase === "trabajo" ? cfgDe(p).trabajo : p.fase === "largo" ? cfgDe(p).largo : cfgDe(p).descanso) * 60000;

  function fraseFin(p, sig) {
    const de = p.tarea ? ` de ${p.tarea}` : "";
    if (p.plan) {                                 // el plan del modo enfoque: una tarea por pomodoro
      const plan = leerPlan(p.plan), sigue = plan[(p.paso || 0) + 1];
      if (p.fase === "trabajo" && sig && sig.fase === "largo") return `¡Terminaste tu plan de enfoque! ¿Acabaste ${p.tarea}? Tómate un descanso largo de ${cfgDe(p).largo} minutos.`;
      if (p.fase === "trabajo") return `¡Tiempo! Hiciste un pomodoro de ${p.tarea}. ¿La terminaste? Descansa ${cfgDe(p).descanso} minutos${sigue ? `; después vamos con ${sigue.texto}` : ""}.`;
      if (p.fase === "descanso" && sig && sig.fase === "largo") return "Ya no quedan tareas en tu plan: ¡lo terminaste! Tómate un descanso largo.";
      if (p.fase === "descanso") return `Se acabó el descanso. Pomodoro ${sig.ciclo} de ${sig.total}: ${sig.tarea}.`;
      return "Se acabó el descanso largo. Cuando quieras, me dices «Píxel, modo enfoque» y seguimos.";
    }
    if (p.fase === "trabajo" && sig && sig.fase === "largo") return `¡Muy bien! Terminaste los ${p.total} pomodoros${de}. Tómate un descanso largo de ${cfgDe(p).largo} minutos.`;
    if (p.fase === "trabajo") return `¡Tiempo! Terminaste el pomodoro ${p.ciclo} de ${p.total}${de}. Descansa ${cfgDe(p).descanso} minutos.`;
    if (p.fase === "descanso") return `Se acabó el descanso. Empieza el pomodoro ${sig ? sig.ciclo : p.ciclo + 1} de ${sig ? sig.total : p.total}${sig && sig.tarea ? ": " + sig.tarea : ""}.`;
    return "Se acabó el descanso largo. Cuando quieras, empezamos otra ronda.";
  }

  // Cada segundo: si la fase acabo, se pasa a la siguiente con una transaccion. La gana un solo
  // aparato (el que la ve primero) y ese la dice.
  async function revisar() {
    const p = t.pomo;
    if (!p || !p.fin || t.pasando || !nube.uid || Date.now() < p.fin) return;
    t.pasando = true;
    const ahora = Date.now(), tarde = ahora - p.fin > TARDE_MS;
    const hechas = new Set((t.tareas || []).filter((x) => x.hecha).map((x) => x.id));
    let sig = null, ganada = false;
    try {
      const r = await N.conTiempo(nube.d.runTransaction(ref("pomodoro"), (actual) => {
        if (!actual || actual.fin !== p.fin || actual.fase !== p.fase) return undefined;   // otro aparato ya la paso
        sig = tarde ? null : siguienteFase(actual, cfgDe(actual), actual.fin);
        if (sig) { sig.trabajo = actual.trabajo || 0; sig.descanso = actual.descanso || 0; }
        if (sig && actual.plan) {                 // el plan: la siguiente tarea (o se acabo: descanso largo)
          Object.assign(sig, {plan: actual.plan, paso: actual.paso || 0, seguir: !!actual.seguir});
          if (actual.fase === "descanso") {
            const a = avanzarPlan(actual, hechas);
            if (a) Object.assign(sig, a);
            else Object.assign(sig, {fase: "largo", ciclo: actual.ciclo, fin: actual.fin + cfgDe(actual).largo * 60000, seguir: false});
          }
        }
        return sig;
      }, {applyLocally: false}), 10000);
      ganada = r.committed;
    } catch (e) { console.warn("tiempo: no pude pasar de fase", e); }
    if (ganada && p.fase === "trabajo" && p.tareaId) {
      nube.d.runTransaction(ref(`tareas/${p.tareaId}/pomodoros`), (n) => (typeof n === "number" ? n + 1 : 1)).catch(() => {});
    }
    t.pasando = false;
    if (!ganada) return;
    if (tarde) { N.anunciar(`Tu pomodoro${p.tarea ? " de " + p.tarea : ""} terminó mientras la app estaba cerrada. Cuando quieras, empezamos otro.`); return; }
    // en el plan, al acabar un pomodoro se pregunta si la tarea quedo hecha (se contesta en el descanso)
    t.pregunta = p.plan && p.fase === "trabajo" && p.tareaId ? {tareaId: p.tareaId, texto: p.tarea, hasta: Date.now() + Math.max(60000, cfgDe(p).descanso * 60000)} : null;
    pintar();
    await N.anunciar(fraseFin(p, sig), {gesto: p.fase === "trabajo" ? "feliz" : "sorpresa"});
    if (t.pregunta) N.oye.ventanaHasta = Date.now() + 15000;      // el "sí" o el "aún no", sin decir "Píxel"
  }

  // La respuesta a "¿La terminaste?": si, se tacha; no, el siguiente pomodoro repite esa tarea
  async function contestarHecha(si) {
    const q = t.pregunta;
    t.pregunta = null;
    pintar();
    if (!q) return "";
    if (si) {
      await N.conTiempo(nube.d.update(ref("tareas/" + q.tareaId), {hecha: true}), 8000).catch(() => {});
      const p = t.pomo, sigue = p && p.plan ? leerPlan(p.plan)[(p.paso || 0) + 1] : null;
      return `¡Bien! Taché ${q.texto}.${sigue && p.fase !== "largo" ? ` Después del descanso vamos con ${sigue.texto}.` : ""}`;
    }
    if (t.pomo && t.pomo.plan && t.pomo.fase === "descanso") await N.conTiempo(nube.d.update(ref("pomodoro"), {seguir: true}), 8000).catch(() => {});
    return t.pomo && t.pomo.fase === "descanso" ? `Vale. Después del descanso seguimos con ${q.texto}.` : `Vale, ${q.texto} queda pendiente en la matriz.`;
  }

  // "Ya terminé" / "Saltar descanso": la fase acaba ahora y revisar() pasa a la siguiente (y lo dice)
  const saltarFase = (p) => ponerPomo(Object.assign({}, p, {fin: Date.now(), queda: 0}));

  // ------------------------------------------------------------------ guia de Eisenhower (en Inicio)
  // t.guia = {paso: tarea|urgente|importante|resumen, actual: {texto, urgente, importante}, nuevas: [ids],
  //           dudas, ultimaT, pregunta, hasta}
  // "Píxel, modo enfoque": Inicio muestra las dos herramientas y Pixel propone empezar por la matriz
  function modoEnfoque() {
    irAInicio();
    const ya = planDeTareas(t.tareas || []).length;
    t.guia = {paso: "inicio", actual: null, nuevas: [], dudas: 0, ultimaT: Date.now(), enfoque: true,
      pregunta: "¿Empezamos con la matriz? Di «sí», «pomodoro» o «salir»."};
    pintar();
    N.pintar();
    return "Modo enfoque. Tengo dos herramientas: la matriz de Eisenhower, para ordenar tus tareas según lo urgentes e importantes que son, "
      + "y el Pomodoro, para trabajar en ellas sin distraerte, con descansos. Te propongo empezar por la matriz y después te doy un pomodoro para cada tarea. "
      + (ya ? `Ya tienes ${ya === 1 ? "una tarea importante anotada" : ya + " tareas importantes anotadas"}: si prefieres, vamos directo a los pomodoros. ` : "")
      + "¿Empezamos con la matriz?";
  }

  function guiaEmpezar() {
    irAInicio();
    const ya = pendientes().length;
    t.guia = {paso: "tarea", actual: null, nuevas: [], dudas: 0, ultimaT: Date.now(), pregunta: "Dime una tarea pendiente, o di «listo»."};
    if (t.cfg.metodo === "pomodoro") guardarCfg({metodo: "ambos"});      // pidio la matriz: que se vea tambien en Enfoque
    pintar();
    N.pintar();
    return `Vamos a ordenar tus tareas con la matriz de Eisenhower. ${ya ? `Ya tienes ${ya} pendiente${ya === 1 ? "" : "s"}. ` : ""}`
      + "Dime una tarea que tengas que hacer, y yo te pregunto lo demás. Cuando acabes, di «listo».";
  }

  function cerrarGuia() {
    t.guia = null;
    pintar();
    N.pintar();
  }

  // Lo que se oye con la guia abierta (sin "Píxel"), o un boton / lo escrito en su caja
  function dictar(texto) {
    const g = t.guia;
    if (!g || g.paso === "resumen") return false;
    const [ok, resto] = T.activacion(texto);
    if (ok && resto && pedidoPomodoro(resto)) return false;     // "Píxel, empieza un pomodoro": eso no es para la guia
    responderGuia(ok ? resto : texto);
    return true;
  }

  async function responderGuia(dicho, deBoton) {
    const g = t.guia;
    dicho = String(dicho || "").trim();
    if (!g || !dicho) return;
    g.ultimaT = Date.now();
    if (!deBoton) N.conversar("tu", dicho);
    let frase;
    try { frase = await pasoGuia(dicho); } catch (e) { console.warn("tiempo: guia", e); frase = "No pude guardarla. Revisa la conexión y dímela otra vez."; }
    pintar();
    N.pintar();
    if (!frase) return;
    await N.anunciar(frase, {toast: false, gesto: false, beep: false});
    if (t.guia) t.guia.ultimaT = Date.now();
    if (t.guia && t.guia.paso === "resumen") N.oye.ventanaHasta = Date.now() + 15000;   // el "sí" al pomodoro, sin "Píxel"
  }

  async function pasoGuia(dicho) {
    const g = t.guia, p = T.plano(dicho).replace(/^[\s¡¿,.]+/, "").replace(/[.!¡]+$/, "").trim();
    if (esSalir(p)) { cerrarGuia(); return g.paso === "inicio" ? "Vale, salimos del modo enfoque." : "Listo, dejamos la guía. Tus tareas quedan guardadas en Enfoque."; }
    if (g.paso === "inicio") {                    // el modo enfoque: ¿matriz o pomodoro?
      const e = eleccionEnfoque(p);
      if (e === "pomodoro") return empezarPlan();
      if (e === "matriz" || e === "si") {
        g.paso = "tarea";
        g.pregunta = "Dime una tarea pendiente, o di «listo».";
        return "Perfecto. Dime una tarea que tengas que hacer, y yo te pregunto lo demás. Cuando acabes, di «listo».";
      }
      if (e === "no" && ++g.dudas < 2) return "Vale. ¿Prefieres ir directo a un pomodoro? Di «pomodoro», o «salir».";
      if (e === "no") { cerrarGuia(); return "Vale, salimos del modo enfoque. Cuando quieras, me lo dices."; }
      return "No te entendí. Di «matriz» para ordenar tus tareas o «pomodoro» para empezar a trabajar.";
    }
    if (g.paso === "tarea") {
      if (esListo(p)) return resumenGuia();
      const x = leerTarea(dicho);
      if (x.texto.length < 3) return "No te entendí la tarea. Dímela otra vez, o di «listo».";
      g.actual = x;
      g.dudas = 0;
      return siguientePregunta();
    }
    // paso urgente o importante
    const r = respuestaPaso(dicho, g.paso);
    for (const k of ["urgente", "importante"]) if (g.actual[k] === undefined && r[k] !== undefined) g.actual[k] = r[k];
    if (g.actual[g.paso] === undefined) {
      if (++g.dudas < 2) return `No te entendí. ${g.paso === "urgente" ? "¿Es urgente" : "¿Es importante"}, sí o no?`;
      g.actual[g.paso] = false;                 // a la segunda, se toma como no
      g.dudas = 0;
    }
    return siguientePregunta();
  }

  function siguientePregunta() {
    const g = t.guia, x = g.actual;
    if (x.urgente === undefined) {
      g.paso = "urgente";
      g.pregunta = `¿«${x.texto}» es urgente? ¿Tiene que estar hoy o en estos días?`;
      return g.pregunta;
    }
    if (x.importante === undefined) {
      g.paso = "importante";
      g.pregunta = "¿Y es importante para ti? Para tus estudios, tu trabajo o tus metas.";
      return g.pregunta;
    }
    return guardarDeGuia();
  }

  async function guardarDeGuia() {
    const g = t.guia, x = g.actual;
    const r = nube.d.push(ref("tareas"));
    await N.conTiempo(nube.d.set(r, {texto: x.texto, urgente: !!x.urgente, importante: !!x.importante, hecha: false, creada: nube.d.serverTimestamp()}), 8000);
    g.nuevas.push(r.key);
    g.actual = null;
    g.paso = "tarea";
    g.dudas = 0;
    g.pregunta = "¿Otra tarea? Si no hay más, di «listo».";
    const c = CUADRANTES[cuadrante(x)];
    return `Anotada en «${c.nombre}»: ${c.consejo}. ¿Qué otra tarea tienes? Si no hay más, di «listo».`;
  }

  function resumenGuia() {
    const g = t.guia, ts = pendientes();
    if (!ts.length) { cerrarGuia(); return "No quedó ninguna tarea anotada. Cuando quieras, me dices «Píxel, organiza mis tareas»."; }
    g.paso = "resumen";
    g.hasta = Date.now() + RESUMEN_MS;
    const partes = ORDEN.map((q) => [q, ts.filter((x) => cuadrante(x) === q).length]).filter(([, n]) => n)
      .map(([q, n]) => `${n} en «${CUADRANTES[q].nombre}»`);
    const x = ts[0], plan = planDeTareas(ts);
    t.sugerida = x.texto;
    g.pregunta = `Empieza por «${x.texto}».`;
    let s = `Listo. Tienes ${lista(partes)}. Empieza por ${x.texto}.`;
    if (t.pomo) return s;
    if (plan.length >= 2) {                       // un pomodoro para cada tarea importante, en orden
      g.pregunta = `Plan: ${plan.map((y) => y.texto).join(" → ")}.`;
      s += ` ¿Empezamos? Te doy un pomodoro para cada una: ${lista(plan.slice(0, 4).map((y) => y.texto))}${plan.length > 4 ? " y las demás" : ""}.`;
      N.confirmar({pregunta: "¿Empezamos los pomodoros?", titulo: `Un pomodoro para cada tarea (${plan.length})`, detalle: plan.map((y, i) => `${i + 1}. ${y.texto}`).join("\n"),
        boton: "Empezar los pomodoros", si: RE_SI_POMO, dura: 120000, hacer: () => empezarPlan(), cancelar: () => "Vale. Cuando quieras, me dices «Píxel, modo enfoque»."});
    } else {
      s += " ¿Empezamos un pomodoro con ella?";
      ofrecerPomodoro(x.texto);
    }
    return s;
  }

  // Un "sí" (por voz o con el boton) empieza el pomodoro con esa tarea
  const RE_SI_POMO = /^(?:si|sip|dale|claro|ok|okay|de una|hagamoslo|empieza|empecemos|empiezalo|vamos|bueno|por favor|va)\b/;
  function ofrecerPomodoro(tarea) {
    N.confirmar({pregunta: "¿Empezamos un pomodoro con ella?", titulo: `Pomodoro con «${tarea}»`, detalle: `${t.cfg.trabajo} minutos de trabajo`,
      boton: "Empezar pomodoro", si: RE_SI_POMO, dura: 120000, hacer: () => empezar(tarea), cancelar: () => "Vale. Cuando quieras, me dices «Píxel, empieza un pomodoro»."});
  }

  // ------------------------------------------------------------------ herramientas para Gemini
  const H_POMO = [
    {name: "iniciar_pomodoro", description: "Empieza un pomodoro (por defecto 25 minutos de trabajo y descansos según la configuración del usuario). Si ya hay uno en marcha, lo reemplaza. La pantalla principal pasa a modo Pomodoro.",
      parameters: {type: "object", properties: {
        tarea: {type: "string", description: "En qué va a trabajar, si lo dice (si coincide con una tarea de la matriz, se cuenta en ella)."},
        minutos: {type: "number", description: "Solo si pide otra duración de trabajo."}, descanso: {type: "number", description: "Solo si pide otra duración de descanso."}}}},
    {name: "pausar_pomodoro", description: "Pausa el pomodoro en marcha."},
    {name: "reanudar_pomodoro", description: "Sigue con el pomodoro pausado."},
    {name: "parar_pomodoro", description: "Termina el pomodoro (o la ronda) del todo."},
    {name: "estado_pomodoro", description: "Dice cuánto queda del pomodoro o del descanso y en qué ciclo va."},
  ];
  const H_MATRIZ = [
    {name: "modo_enfoque", description: "Abre el modo enfoque en la pantalla principal: muestra la matriz de Eisenhower y el Pomodoro, propone empezar por la matriz y después da un pomodoro para cada tarea. Úsala cuando diga «modo enfoque», «quiero concentrarme» o «ayúdame a ser productivo»."},
    {name: "guiar_matriz", description: "Abre la guía de la matriz de Eisenhower en la pantalla principal: Píxel le pide sus tareas una a una y le pregunta si son urgentes e importantes. Úsala cuando quiera organizar o priorizar sus tareas sin decirlas todas ya."},
    {name: "agregar_tarea", description: "Añade una tarea a la matriz de Eisenhower. Si el usuario no dice si es urgente o importante, dedúcelo (fecha cercana = urgente; estudios, trabajo, salud, metas = importante).",
      parameters: {type: "object", properties: {
        texto: {type: "string", description: "La tarea, corta: 'entregar el informe de física'."},
        urgente: {type: "boolean"}, importante: {type: "boolean"},
        vence: {type: "string", description: "Opcional: fecha límite, AAAA-MM-DDTHH:MM:SS en hora local."}},
      required: ["texto", "urgente", "importante"]}},
    {name: "ver_tareas", description: "Devuelve las tareas pendientes ordenadas por cuadrante de Eisenhower, para contarlas o aconsejar.",
      parameters: {type: "object", properties: {cuadrante: {type: "string", enum: ORDEN, description: "Opcional: solo uno."}}}},
    {name: "que_hago_ahora", description: "Dice cuál es la tarea que toca hacer primero según la matriz (y propone un pomodoro si el usuario los usa)."},
    {name: "completar_tarea", description: "Marca una tarea como hecha.",
      parameters: {type: "object", properties: {texto: {type: "string", description: "Cuál, con sus palabras."}}, required: ["texto"]}},
    {name: "mover_tarea", description: "Cambia si una tarea es urgente o importante (la mueve de cuadrante) o su fecha límite.",
      parameters: {type: "object", properties: {texto: {type: "string"}, urgente: {type: "boolean"}, importante: {type: "boolean"}, vence: {type: "string"}}, required: ["texto"]}},
    {name: "borrar_tarea", description: "Borra una tarea, o todas las ya hechas si dice 'las hechas'.",
      parameters: {type: "object", properties: {texto: {type: "string"}}, required: ["texto"]}},
  ];
  const H_CFG = {name: "configurar_enfoque", description: "Cambia el método de enfoque del usuario (pomodoro, eisenhower o ambos) o los minutos del pomodoro.",
    parameters: {type: "object", properties: {metodo: {type: "string", enum: ["pomodoro", "eisenhower", "ambos"]},
      trabajo: {type: "number"}, descanso: {type: "number"}, largo: {type: "number"}, ciclos: {type: "number"}}}};

  async function ejecutar(nombre, a) {
    const todas = H_POMO.concat(H_MATRIZ, [H_CFG]);
    if (!todas.some((h) => h.name === nombre)) return undefined;
    if (!nube.uid) return "Primero entra con tu cuenta.";
    a = a || {};
    try {
      const p = t.pomo, ahora = Date.now();
      switch (nombre) {
        case "iniciar_pomodoro": return await empezar(a.tarea, a.minutos, a.descanso);
        case "pausar_pomodoro":
          if (!p) return "No hay ningún pomodoro en marcha.";
          if (!p.fin) return "Ya estaba en pausa.";
          await ponerPomo(pausar(p, ahora));
          return `Pausado. Te quedan ${minutos(p.fin - ahora)}.`;
        case "reanudar_pomodoro":
          if (!p) return "No hay ningún pomodoro. ¿Empiezo uno?";
          if (p.fin) return "Ya está en marcha.";
          await ponerPomo(reanudar(p, ahora));
          return `Seguimos. Quedan ${minutos(p.queda)}.`;
        case "parar_pomodoro":
          if (!p) return "No había ningún pomodoro.";
          await N.conTiempo(nube.d.remove(ref("pomodoro")), 8000);
          return `Listo, paré el pomodoro${p.fase === "trabajo" ? ` cuando ibas en el ${p.ciclo} de ${p.total}` : ""}.`;
        case "estado_pomodoro": {
          if (!p) return "No hay ningún pomodoro en marcha.";
          const q = minutos(quedaMs(p, ahora)), pausa = p.fin ? "" : " Está en pausa.";
          if (p.fase === "trabajo") return `Vas en el pomodoro ${p.ciclo} de ${p.total}${p.tarea ? ", " + p.tarea : ""}. Quedan ${q}.${pausa}`;
          return `Estás en el descanso${p.fase === "largo" ? " largo" : ""}. Quedan ${q}.${pausa}`;
        }
        case "configurar_enfoque": {
          const nuevo = Object.assign({}, t.cfg);
          if (["pomodoro", "eisenhower", "ambos"].includes(a.metodo)) nuevo.metodo = a.metodo;
          nuevo.trabajo = limite(a.trabajo, 1, 120, nuevo.trabajo);
          nuevo.descanso = limite(a.descanso, 1, 60, nuevo.descanso);
          nuevo.largo = limite(a.largo, 1, 90, nuevo.largo);
          nuevo.ciclos = limite(a.ciclos, 1, 12, nuevo.ciclos);
          await N.conTiempo(nube.d.set(ref("preferencias/enfoque"), nuevo), 8000);
          const m = {pomodoro: "la técnica Pomodoro", eisenhower: "la matriz de Eisenhower", ambos: "Pomodoro y la matriz de Eisenhower"}[nuevo.metodo];
          return `Listo: usas ${m}${nuevo.metodo !== "eisenhower" ? `, con pomodoros de ${nuevo.trabajo} minutos y descansos de ${nuevo.descanso}` : ""}.`;
        }
        case "guiar_matriz": return guiaEmpezar();
        case "modo_enfoque": return modoEnfoque();
        case "agregar_tarea": {
          const texto = String(a.texto || "").trim().replace(/[.\s]+$/, "").slice(0, 200);
          if (!texto) return "¿Qué tarea?";
          const vence = a.vence ? T.leerCuando(a.vence) : 0;
          const nueva = {texto, urgente: !!a.urgente, importante: !!a.importante, hecha: false, creada: nube.d.serverTimestamp()};
          if (isFinite(vence) && vence > 0) nueva.vence = vence;
          await N.conTiempo(nube.d.set(nube.d.push(ref("tareas")), nueva), 8000);
          const c = CUADRANTES[cuadrante(nueva)];
          return `Anotada: ${texto}, en ${c.nombre} (${c.sub}).`;
        }
        case "ver_tareas": {
          const ts = pendientes().filter((x) => !a.cuadrante || cuadrante(x) === a.cuadrante);
          return {respuesta: {tareas: ts.slice(0, 20).map((x) => ({texto: x.texto, cuadrante: CUADRANTES[cuadrante(x)].nombre,
            vence: x.vence ? T.cuandoDicho(x.vence) : undefined, pomodoros: x.pomodoros || undefined})),
            hechas: (t.tareas || []).filter((x) => x.hecha).length,
            nota: ts.length ? "Cuéntalas por cuadrante, empezando por Hacer ya." : "No hay tareas pendientes."}};
        }
        case "que_hago_ahora": {
          const ts = pendientes();
          if (!ts.length) return "No tienes tareas pendientes. Si quieres, las organizamos: di «Píxel, organiza mis tareas».";
          const x = ts[0], c = CUADRANTES[cuadrante(x)];
          t.sugerida = x.texto;
          let s = `Lo primero: ${x.texto}`;
          s += x.vence ? `, que vence ${T.cuandoDicho(x.vence)}.` : `, que está en ${c.nombre}.`;
          if (ts[1]) s += ` Después, ${ts[1].texto}.`;
          if (usaPomodoro() && !t.pomo) { s += " ¿Empezamos un pomodoro con ella?"; ofrecerPomodoro(x.texto); }
          return s;
        }
        case "completar_tarea": case "mover_tarea": case "borrar_tarea": {
          const todasT = t.tareas || [];
          if (nombre === "borrar_tarea" && /\b(hechas|terminadas|completadas)\b/.test(T.plano(a.texto || ""))) {
            const hechas = todasT.filter((x) => x.hecha);
            await Promise.all(hechas.map((x) => nube.d.remove(ref("tareas/" + x.id))));
            return hechas.length ? `Borré ${hechas.length} tarea${hechas.length === 1 ? "" : "s"} hecha${hechas.length === 1 ? "" : "s"}.` : "No había tareas hechas.";
          }
          const x = buscarTarea(nombre === "completar_tarea" ? pendientes() : todasT, a.texto);
          if (!x) return "No encontré esa tarea.";
          if (nombre === "completar_tarea") {
            await N.conTiempo(nube.d.update(ref("tareas/" + x.id), {hecha: true}), 8000);
            const sig = pendientes().find((y) => y.id !== x.id);
            return `¡Bien! Taché ${x.texto}.${sig ? ` Lo siguiente: ${sig.texto}.` : " No te queda nada pendiente."}`;
          }
          if (nombre === "borrar_tarea") {
            await N.conTiempo(nube.d.remove(ref("tareas/" + x.id)), 8000);
            return `Borré ${x.texto}.`;
          }
          const cambio = {};
          if (typeof a.urgente === "boolean") cambio.urgente = a.urgente;
          if (typeof a.importante === "boolean") cambio.importante = a.importante;
          if (a.vence) { const v = T.leerCuando(a.vence); if (isFinite(v)) cambio.vence = v; }
          await N.conTiempo(nube.d.update(ref("tareas/" + x.id), cambio), 8000);
          const c = CUADRANTES[cuadrante(Object.assign({}, x, cambio))];
          return `Listo, ${x.texto} queda en ${c.nombre}.`;
        }
      }
    } catch (e) {
      console.warn("tiempo:", e);
      return "No pude guardarlo. Revisa la conexión.";
    }
    return undefined;
  }

  // Atajos: se contestan sin Gemini (al instante y sin gastar cupo)
  function atajo(texto) {
    if (!nube.uid) return undefined;
    if (t.pregunta && Date.now() < t.pregunta.hasta) {          // "¿La terminaste?" (sin decir "Píxel")
      const r = respuestaHecha(texto);
      if (r !== null) return contestarHecha(r);
    }
    if (pidoEnfoque(texto)) return Promise.resolve(modoEnfoque());
    if (pedidoGuia(texto)) return Promise.resolve(guiaEmpezar());
    if (pideQueHago(texto) && t.tareas) return ejecutar("que_hago_ahora", {});
    const o = pedidoPomodoro(texto);
    if (!o || (o.siHay && !t.pomo)) return undefined;
    if (o.accion === "empezar") return empezar(o.tarea, o.minutos, o.descanso).catch(() => "No pude empezarlo. Revisa la conexión.");
    return ejecutar({pausar: "pausar_pomodoro", seguir: "reanudar_pomodoro", parar: "parar_pomodoro", estado: "estado_pomodoro"}[o.accion], {});
  }

  // ------------------------------------------------------------------ pantalla principal (Inicio)
  const FASES = {trabajo: "Trabajando", descanso: "Descanso", largo: "Descanso largo"};
  const ciclosHtml = (p, n) => Array.from({length: n}, (_, i) => `<i class="${p && (i < p.ciclo - 1 || (i === p.ciclo - 1 && p.fase !== "trabajo")) ? "hecho" : p && i === p.ciclo - 1 ? "ahora" : ""}"></i>`).join("");

  // Lo que dice el recuadro de Inicio (agente.js lo pide con hero()); null: Inicio normal
  function hero() {
    if (!nube.usuario) return null;
    const g = t.guia, p = t.pomo;
    if (g && g.paso === "inicio") return {modo: "enfoque", pill: "Modo enfoque", titulo: "Modo enfoque", sub: g.pregunta};
    if (g) return {modo: "matriz", pill: "Organizando tareas", titulo: g.paso === "resumen" ? "Tus tareas, ordenadas" : "Organizando tus tareas", sub: g.pregunta};
    if (!p) return null;
    const q = reloj(quedaMs(p, Date.now()));
    const plan = p.plan ? leerPlan(p.plan) : null;
    if (plan && t.pregunta && p.fase !== "trabajo") return {modo: "descanso", pill: "Descanso", titulo: `${p.fase === "largo" ? "Descanso largo" : "Descanso"} · ${q}`, sub: `¿Terminaste «${t.pregunta.texto}»? Di «sí» o «aún no».`};
    if (plan && p.fin && p.fase === "trabajo") return {modo: "pomodoro", pill: "Modo Pomodoro", titulo: `Enfoque · ${q}`,
      sub: `Tarea ${(p.paso || 0) + 1} de ${plan.length}: «${p.tarea}». Te aviso al terminar; mientras, no te interrumpo.`};
    if (!p.fin) return {modo: p.fase === "trabajo" ? "pomodoro" : "descanso", pill: "Pomodoro en pausa", titulo: `Pomodoro en pausa · ${q}`, sub: "Di «Píxel, sigue con el pomodoro» o toca Seguir."};
    if (p.fase === "trabajo") return {modo: "pomodoro", pill: "Modo Pomodoro", titulo: `Enfoque · ${q}`,
      sub: `${p.tarea ? "«" + p.tarea + "» · " : ""}pomodoro ${p.ciclo} de ${p.total}. Te aviso al terminar; mientras, no te interrumpo.`};
    return {modo: "descanso", pill: "Descanso", titulo: `${p.fase === "largo" ? "Descanso largo" : "Descanso"} · ${q}`, sub: "Levántate, estira y toma agua. Te aviso cuando toque volver."};
  }

  function htmlPomodoro(p) {
    const plan = p.plan ? leerPlan(p.plan) : null, hechas = new Set((t.tareas || []).filter((x) => x.hecha).map((x) => x.id));
    const lineaPlan = plan ? `<ol class="me-plan">${plan.map((x, i) => `<li class="${hechas.has(x.id) ? "hecha" : i === (p.paso || 0) ? "ahora" : ""}">${esc(x.texto)}</li>`).join("")}</ol>` : "";
    const pregunta = t.pregunta ? `<div class="me-pregunta-hecha"><b>¿Terminaste «${esc(t.pregunta.texto)}»?</b>
      <div class="acciones"><button class="btn primario" type="button" data-me="hecha">Sí, la terminé</button><button class="btn" type="button" data-me="aun">Aún no</button></div></div>` : "";
    return (plan ? pasosEnfoque(2) : "") + htmlPomodoroBase(p) + pregunta + lineaPlan;
  }
  function htmlPomodoroBase(p) {
    const fase = p.fase === "trabajo" ? (p.plan ? `Tarea ${(p.paso || 0) + 1} de ${leerPlan(p.plan).length}` : `Pomodoro ${p.ciclo} de ${p.total}`) : FASES[p.fase];
    const que = p.fase === "trabajo" ? (p.tarea ? esc(p.tarea) : "Sin tarea") : "Levántate, estira y toma agua.";
    return `<div class="me-cabeza"><span class="tomate grande ${p.fase}"></span><div class="txt"><b>${fase}${p.fin ? "" : " · en pausa"}</b><small>${que}</small></div><b class="me-reloj" id="me-reloj"></b></div>
      <div class="ciclos">${ciclosHtml(p, p.total)}</div>
      <div class="acciones">${p.fin ? '<button class="btn" type="button" data-me="pausar">Pausar</button>' : '<button class="btn primario" type="button" data-me="seguir">Seguir</button>'}
        <button class="btn" type="button" data-me="saltar">${p.fase === "trabajo" ? "Ya terminé" : "Saltar el descanso"}</button>
        <button class="btn peligro" type="button" data-me="parar">Parar</button></div>
      <p class="me-ayuda">Por voz: «Píxel, pausa el pomodoro», «Píxel, ¿cuánto queda?» o «Píxel, para el pomodoro».</p>`;
  }

  // La tira de pasos del modo enfoque: 1 ordenar (la matriz) -> 2 un pomodoro por tarea
  const pasosEnfoque = (n) => `<div class="me-pasos" aria-label="Paso ${n} de 2"><span class="${n === 1 ? "activo" : n > 1 ? "hecho" : ""}"><i>1</i><em>Ordenar tareas</em></span>`
    + `<span class="flecha" aria-hidden="true"></span><span class="${n === 2 ? "activo" : ""}"><i>2</i><em>Pomodoro por tarea</em></span></div>`;

  function htmlEnfoque(g) {
    const ya = planDeTareas(t.tareas || []).length;
    return `<div class="me-cabeza"><span class="ico-enfoque" aria-hidden="true"></span><div class="txt"><b>Modo enfoque</b><small>Primero ordenamos tus tareas; después trabajas en ellas, una por pomodoro.</small></div></div>
      ${pasosEnfoque(0)}
      <div class="me-opciones">
        <button class="opcion recomendada" type="button" data-guia="matriz"><span class="ico-matriz" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span class="op-txt"><b>Matriz de Eisenhower</b><small>Ordena tus tareas por urgentes e importantes. Te voy preguntando.</small></span>
          <em>Empezar aquí</em></button>
        <button class="opcion" type="button" data-guia="pomodoro"><span class="tomate grande trabajo" aria-hidden="true"></span>
          <span class="op-txt"><b>Pomodoro</b><small>${t.cfg.trabajo} min de trabajo y ${t.cfg.descanso} de descanso${ya ? `, uno para cada una de tus ${ya} tareas importantes` : ""}.</small></span></button>
      </div>
      <div class="me-pie"><p class="me-ayuda">Di «sí» para la matriz, «pomodoro» o «salir».</p><button class="btn suave" type="button" data-guia="salir">Salir</button></div>`;
  }

  function htmlGuia(g) {
    if (g.paso === "inicio") return htmlEnfoque(g);
    const ts = t.tareas || [], nuevas = new Set(g.nuevas);
    const cuadros = ORDEN.map((q) => {
      const suyas = ts.filter((x) => !x.hecha && cuadrante(x) === q);
      return `<div class="cuadro ${q}"><h4>${CUADRANTES[q].nombre}</h4>${suyas.length ? suyas.slice(0, 6).map((x) => `<span class="${nuevas.has(x.id) ? "nueva" : ""}">${esc(x.texto)}</span>`).join("")
        + (suyas.length > 6 ? `<small>y ${suyas.length - 6} más</small>` : "") : "<small>—</small>"}</div>`;
    }).join("");
    const x = g.actual;
    const actual = x ? `<p class="me-actual">«${esc(x.texto)}»${x.urgente === true ? " <i>urgente</i>" : x.urgente === false ? ' <i class="no">no urgente</i>' : ""}</p>` : "";
    let acciones;
    if (g.paso === "tarea") {
      acciones = `<form class="form-linea" id="me-tarea" autocomplete="off"><input type="text" maxlength="200" placeholder="O escribe una tarea" aria-label="Escribe una tarea"><button class="btn" type="submit">Añadir</button></form>
        <div class="acciones"><button class="btn primario" type="button" data-guia="listo">Listo, ya están</button><button class="btn suave" type="button" data-guia="salir">Salir</button></div>`;
    } else if (g.paso === "resumen") {
      const n = planDeTareas(ts).length;
      acciones = `<div class="acciones">${!t.pomo && n >= 2 ? `<button class="btn primario" type="button" data-guia="plan">Un pomodoro para cada una (${n})</button>`
        : t.sugerida && !t.pomo ? `<button class="btn primario" type="button" data-guia="pomo">Pomodoro con esta</button>` : ""}<button class="btn" type="button" data-guia="cerrar">Cerrar</button></div>`;
    } else {
      acciones = `<div class="acciones"><button class="btn primario" type="button" data-guia="si">Sí</button><button class="btn" type="button" data-guia="no">No</button><button class="btn suave" type="button" data-guia="salir">Salir</button></div>`;
    }
    return `${g.enfoque ? pasosEnfoque(1) : ""}<div class="me-cabeza"><span class="ico-matriz" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div class="txt"><b>${g.paso === "resumen" ? "Tus tareas, ordenadas" : "Organizando tus tareas"}</b><small>Matriz de Eisenhower · Píxel te guía${g.nuevas.length ? ` · ${g.nuevas.length} nueva${g.nuevas.length === 1 ? "" : "s"}` : ""}</small></div></div>
      <p class="me-pregunta">${esc(g.pregunta)}</p>${actual}${acciones}<div class="matriz mini">${cuadros}</div>`;
  }

  // El modo de Inicio: la tarjeta (con firma, para no rehacerla cada segundo) y el anillo de la escena
  function pintarModo() {
    const caja = document.getElementById("modo-enfoque");
    if (!caja) return;
    const p = t.pomo, g = t.guia, ahora = Date.now();
    const modo = !nube.usuario ? "" : g ? "guia" : p ? "pomodoro" : "";
    const html = modo === "guia" ? htmlGuia(g) : modo === "pomodoro" ? htmlPomodoro(p) : "";
    if (html !== t.pintadoM) {
      t.pintadoM = html;
      caja.innerHTML = html;
      caja.hidden = !modo;
      // (no "enfoque": esa clase es la rejilla de la pagina Enfoque y partia la tarjeta en dos columnas)
      caja.className = "card modo-enfoque " + (modo === "pomodoro" ? (p.fase === "trabajo" ? "pomodoro" : "descanso") : g && g.paso === "inicio" ? "elegir" : modo);
    }
    const anillo = document.getElementById("escena-pomo"), escena = document.getElementById("escena");
    if (escena) escena.classList.toggle("con-pomo", modo === "pomodoro");
    if (!anillo) return;
    anillo.hidden = modo !== "pomodoro";
    if (modo !== "pomodoro") return;
    const q = quedaMs(p, ahora), texto = reloj(q);
    anillo.className = "escena-pomo " + p.fase + (p.fin ? "" : " pausa");
    anillo.style.setProperty("--queda", (Math.max(0, Math.min(1, q / duracionFase(p))) * 100).toFixed(2));
    $("#ep-reloj").textContent = texto;
    const mr = document.getElementById("me-reloj");
    if (mr) mr.textContent = texto;
    // el reloj del recuadro de Inicio, sin repintar todo (agente.js lo pinta cuando cambia algo)
    const h = $("#hero-estado"), hv = hero();
    if (h && hv && /·\s*\d+:\d\d$/.test(h.textContent) && h.textContent !== hv.titulo) h.textContent = hv.titulo;
  }

  // ------------------------------------------------------------------ pantalla (Enfoque)
  function pintarPomo() {
    pintarModo();
    if (!document.getElementById("v-enfoque")) return;
    const p = t.pomo, ahora = Date.now();
    $("#pm-reloj").textContent = p ? reloj(quedaMs(p, ahora)) : reloj(t.cfg.trabajo * 60000);
    const avance = p ? 1 - quedaMs(p, ahora) / duracionFase(p) : 0;
    $("#pm-anillo").style.setProperty("--avance", Math.max(0, Math.min(1, avance)).toFixed(4));
    $("#pm-anillo").className = "anillo " + (p ? p.fase : "");
    const firma = JSON.stringify([p && [p.fase, p.ciclo, p.total, p.tarea, !!p.fin], t.cfg]);
    if (firma === t.pintadoP) return;
    t.pintadoP = firma;
    $("#pm-fase").textContent = p ? FASES[p.fase] + (p.fin ? "" : " · en pausa") : "Listo para empezar";
    $("#pm-tarea").textContent = p ? (p.tarea || "Sin tarea") : `${t.cfg.trabajo} min de trabajo, ${t.cfg.descanso} de descanso`;
    $("#pm-ciclos").innerHTML = ciclosHtml(p, p ? p.total : t.cfg.ciclos);
    $("#pm-empezar").hidden = !!p;
    $("#pm-pausar").hidden = !p || !p.fin;
    $("#pm-seguir").hidden = !p || !!p.fin;
    $("#pm-parar").hidden = !p;
    ["trabajo", "descanso", "largo", "ciclos"].forEach((k) => { const i = $("#pm-" + k); if (document.activeElement !== i) i.value = t.cfg[k]; });
  }

  function pintar() {
    pintarPomo();
    if (!document.getElementById("v-enfoque")) return;
    $("#tab-enfoque").hidden = !nube.usuario;
    const firma = JSON.stringify([t.tareas, t.cfg.metodo, !!t.pomo]);
    if (firma === t.pintado) return;
    t.pintado = firma;
    document.querySelectorAll("input[name=metodo]").forEach((r) => { r.checked = r.value === t.cfg.metodo; });
    $("#card-pomodoro").hidden = !usaPomodoro();
    $("#card-matriz").hidden = !usaMatriz();
    const ts = t.tareas;
    for (const q of ORDEN) {
      const caja = $("#mx-" + q), suyas = (ts || []).filter((x) => !x.hecha && cuadrante(x) === q).sort((a, b) => (a.vence || Infinity) - (b.vence || Infinity));
      caja.innerHTML = ts === null ? '<div class="vacio">…</div>' : suyas.length ? suyas.map((x) => `<div class="tarea">
          <button class="marca" type="button" data-tarea-hecha="${esc(x.id)}" aria-label="Marcar como hecha"></button>
          <span class="txt">${esc(x.texto)}${x.vence ? `<small>${esc(T.cuandoDicho(x.vence))}</small>` : ""}${x.pomodoros ? `<small>${x.pomodoros} pomodoro${x.pomodoros === 1 ? "" : "s"}</small>` : ""}</span>
          ${usaPomodoro() && !t.pomo ? `<button class="mini-btn" type="button" data-tarea-pomo="${esc(x.id)}" aria-label="Empezar un pomodoro con esta">▶</button>` : ""}
          <button class="mini-btn" type="button" data-tarea-borrar="${esc(x.id)}" aria-label="Borrar">✕</button></div>`).join("")
        : '<div class="vacio">Nada aquí.</div>';
    }
    const hechas = (ts || []).filter((x) => x.hecha);
    $("#mx-hechas").innerHTML = hechas.length ? `${hechas.length} hecha${hechas.length === 1 ? "" : "s"}: ${hechas.slice(0, 5).map((x) => `<s>${esc(x.texto)}</s>`).join(", ")}${hechas.length > 5 ? "…" : ""}
      <button class="btn suave" type="button" id="mx-limpiar">Borrar hechas</button>` : "";
  }

  async function guardarCfg(cambio) {
    if (!nube.uid) return;
    const nuevo = Object.assign({}, t.cfg, cambio);
    try { await N.conTiempo(nube.d.set(ref("preferencias/enfoque"), nuevo), 8000); } catch (e) { toast("No pude guardarlo: " + (e.code || e.message), true); }
  }

  // Cada segundo: el fin de fase, el reloj y que la guia no se quede abierta si nadie contesta
  function alSegundo() {
    revisar();
    pintarPomo();
    const g = t.guia;
    if (!g) return;
    if (g.paso === "resumen" ? Date.now() > g.hasta : Date.now() - g.ultimaT > GUIA_SILENCIO_MS && !N.ocupado()) {
      const resumen = g.paso === "resumen";
      cerrarGuia();
      if (!resumen) N.anunciar("Dejo la guía por ahora; tus tareas quedan guardadas. Cuando quieras seguimos: di «Píxel, organiza mis tareas».", {toast: false, gesto: false});
    }
  }

  function montar() {
    if (!document.getElementById("v-enfoque")) return;
    const accion = (f) => async () => { N.desbloquear(); try { await f(); } catch (e) { toast("No pude: " + (e.code || e.message), true); } };
    $("#pm-empezar").addEventListener("click", accion(() => empezar($("#pm-que").value.trim())));
    $("#pm-pausar").addEventListener("click", accion(() => ponerPomo(pausar(t.pomo, Date.now()))));
    $("#pm-seguir").addEventListener("click", accion(() => ponerPomo(reanudar(t.pomo, Date.now()))));
    $("#pm-parar").addEventListener("click", accion(() => nube.d.remove(ref("pomodoro"))));
    $("#f-metodo").addEventListener("change", (e) => { if (e.target.name === "metodo") guardarCfg({metodo: e.target.value}); });
    $("#f-pomo-cfg").addEventListener("submit", (e) => {
      e.preventDefault();
      guardarCfg({trabajo: limite($("#pm-trabajo").value, 1, 120, 25), descanso: limite($("#pm-descanso").value, 1, 60, 5),
        largo: limite($("#pm-largo").value, 1, 90, 15), ciclos: limite($("#pm-ciclos-n").value, 1, 12, 4)}).then(() => toast("Guardado."));
    });
    $("#f-tarea").addEventListener("submit", accion(async () => {
      const texto = $("#mx-texto").value.trim();
      if (!texto || !nube.uid) return;
      await nube.d.set(nube.d.push(ref("tareas")), {texto: texto.slice(0, 200), urgente: $("#mx-urgente").checked, importante: $("#mx-importante").checked,
        hecha: false, creada: nube.d.serverTimestamp()});
      $("#mx-texto").value = "";
    }));
    $("#card-matriz").addEventListener("click", (e) => {
      const h = e.target.closest("[data-tarea-hecha]"), b = e.target.closest("[data-tarea-borrar]"), p = e.target.closest("[data-tarea-pomo]");
      const err = (er) => toast("No pude: " + (er.code || er.message), true);
      if (h) nube.d.update(ref("tareas/" + h.dataset.tareaHecha), {hecha: true}).catch(err);
      if (b) nube.d.remove(ref("tareas/" + b.dataset.tareaBorrar)).catch(err);
      if (p) { const x = (t.tareas || []).find((y) => y.id === p.dataset.tareaPomo); if (x) empezar(x.texto).catch(err); }
      if (e.target.id === "mx-limpiar") (t.tareas || []).filter((x) => x.hecha).forEach((x) => nube.d.remove(ref("tareas/" + x.id)).catch(err));
      if (e.target.closest("#mx-guia")) { N.desbloquear(); N.anunciar(guiaEmpezar(), {toast: false, gesto: "curioso", beep: false}); }
    });
    // la tarjeta del modo en Inicio: botones del pomodoro y de la guia
    const caja = document.getElementById("modo-enfoque");
    if (!caja) return;
    caja.addEventListener("click", async (e) => {
      const me = e.target.closest("[data-me]"), gu = e.target.closest("[data-guia]");
      if (!me && !gu) return;
      N.desbloquear();
      try {
        if (me) {
          const p = t.pomo;
          if (!p) return;
          const que = me.dataset.me;
          if (que === "pausar") await ponerPomo(pausar(p, Date.now()));
          if (que === "seguir") await ponerPomo(reanudar(p, Date.now()));
          if (que === "saltar") await saltarFase(p);
          if (que === "parar") await nube.d.remove(ref("pomodoro"));
          if (que === "hecha" || que === "aun") N.anunciar(await contestarHecha(que === "hecha"), {toast: false, gesto: que === "hecha" ? "feliz" : false, beep: false});
          return;
        }
        const que = gu.dataset.guia;
        if (que === "cerrar") { cerrarGuia(); return; }
        if (que === "pomo") { const f = await empezar(t.sugerida); N.anunciar(f, {toast: false, gesto: "feliz", beep: false}); return; }
        if (que === "plan" || que === "pomodoro") { const f = await empezarPlan(); N.anunciar(f, {toast: false, gesto: "feliz", beep: false}); return; }
        if (que === "matriz") { responderGuia("matriz", true); return; }
        responderGuia({si: "sí", no: "no", listo: "listo", salir: "cancela"}[que], true);
      } catch (er) { toast("No pude: " + (er.code || er.message), true); }
    });
    caja.addEventListener("submit", (e) => {
      if (e.target.id !== "me-tarea") return;
      e.preventDefault();
      const i = e.target.querySelector("input"), v = i.value.trim();
      if (!v) return;
      i.value = "";
      N.desbloquear();
      responderGuia(v, true);
    });
  }

  A.modulo({
    nombre: "tiempo", montar, alUsuario, pintar, ejecutar, atajo, dictar, hero, alSegundo,
    herramientas: () => (nube.uid ? (usaPomodoro() ? H_POMO : []).concat(usaMatriz() ? H_MATRIZ : [], [H_CFG]) : []),
    capacidad: () => (usaPomodoro() ? "- Llevar pomodoros: empezar, pausar, seguir, parar y decir cuánto queda (iniciar_pomodoro…). Con uno en marcha, la pantalla principal muestra el tiempo.\n" : "")
      + (usaMatriz() ? "- Organizar sus tareas con la matriz de Eisenhower: guiarle paso a paso en la pantalla principal (guiar_matriz), agregar, ver, qué hacer primero, completar, mover y borrar.\n" : "")
      + "- Cambiar su método de enfoque (configurar_enfoque).",
    contexto: () => {
      const s = [];
      const p = t.pomo;
      if (p) s.push(`Pomodoro en marcha: ${FASES[p.fase].toLowerCase()} ${p.fase === "trabajo" ? p.ciclo + " de " + p.total : ""}, quedan ${minutos(quedaMs(p, Date.now()))}${p.fin ? "" : " (en pausa)"}${p.tarea ? ", tarea: " + p.tarea : ""}.`);
      const ts = pendientes();
      if (usaMatriz() && ts.length) s.push(`Tareas pendientes (${ts.length}); la primera: ${ts[0].texto} (${CUADRANTES[cuadrante(ts[0])].nombre}).`);
      s.push(`Método de enfoque elegido: ${t.cfg.metodo}.`);
      return "## Enfoque\n" + s.join("\n");
    },
  });

  window.PixelTiempo = {
    texto: {nuevoPomodoro, siguienteFase, pausar, reanudar, quedaMs, cuadrante, ordenTareas, buscarTarea, reloj,
      banderas, leerTarea, siNo, respuestaPaso, esListo, esSalir, pedidoGuia, pideQueHago, pedidoPomodoro,
      pidoEnfoque, eleccionEnfoque, respuestaHecha, planDeTareas, leerPlan, avanzarPlan},
    CUADRANTES,
    // para humor.js: trabajando en un pomodoro o en la guia, Pixel no se duerme ni hace payasadas
    enfocado: () => !!t.guia || !!(t.pomo && t.pomo.fin && t.pomo.fase === "trabajo"),
    guia: () => (t.guia ? Object.assign({}, t.guia) : null),
  };
})();
