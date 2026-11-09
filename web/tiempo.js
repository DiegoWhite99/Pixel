/* Fase 13 - Enfoque: la tecnica Pomodoro y la matriz de Eisenhower. El usuario elige cual usa
   (o las dos) en la pagina Enfoque; segun eso Gemini tiene unas herramientas u otras.
   - Pomodoro: usuarios/<uid>/pomodoro = {fase, ciclo, total, inicio, fin, queda, tarea, tareaId}.
     Cada fase acaba a una hora fija (fin); al llegar, una transaccion pasa a la siguiente y solo el
     aparato que la gana lo dice en voz alta (como los recordatorios). Pausado: fin = 0 y queda = ms.
   - Eisenhower: usuarios/<uid>/tareas/<id> = {texto, urgente, importante, hecha, creada, vence, pomodoros}.
     Cuadrantes: hacer (urgente e importante), planificar (importante), delegar (urgente), eliminar.
   - Preferencias: usuarios/<uid>/preferencias/enfoque = {metodo, trabajo, descanso, largo, ciclos}.
   Al cargarse no toca la pagina: las funciones de texto (PixelTiempo.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo, T = A.texto;

  const DEFECTO = {metodo: "ambos", trabajo: 25, descanso: 5, largo: 15, ciclos: 4};
  const CUADRANTES = {
    hacer: {nombre: "Hacer ya", sub: "urgente e importante"},
    planificar: {nombre: "Planificar", sub: "importante, no urgente"},
    delegar: {nombre: "Delegar", sub: "urgente, no importante"},
    eliminar: {nombre: "Eliminar", sub: "ni urgente ni importante"},
  };
  const ORDEN = ["hacer", "planificar", "delegar", "eliminar"];
  const TARDE_MS = 5 * 60000;                  // una fase que acabo hace mas que esto (app cerrada) ya no se anuncia

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

  // ------------------------------------------------------------------ estado y nube
  const t = {cfg: Object.assign({}, DEFECTO), pomo: null, tareas: null, quitar: [], pasando: false, pintado: "", pintadoP: "", aviso: ""};
  const ref = (sub) => nube.d.ref(nube.db, `usuarios/${nube.uid}/${sub}`);
  const usaPomodoro = () => t.cfg.metodo !== "eisenhower";
  const usaMatriz = () => t.cfg.metodo !== "pomodoro";
  const pendientes = () => ordenTareas(t.tareas || []);

  function alUsuario(u) {
    t.quitar.forEach((f) => f());
    Object.assign(t, {quitar: [], pomo: null, tareas: null, cfg: Object.assign({}, DEFECTO), pintado: "", pintadoP: ""});
    if (!u) { pintar(); return; }
    t.quitar.push(nube.d.onValue(ref("preferencias/enfoque"), (s) => {
      const v = s.val() || {};
      t.cfg = {metodo: ["pomodoro", "eisenhower", "ambos"].includes(v.metodo) ? v.metodo : DEFECTO.metodo,
        trabajo: limite(v.trabajo, 1, 120, DEFECTO.trabajo), descanso: limite(v.descanso, 1, 60, DEFECTO.descanso),
        largo: limite(v.largo, 1, 90, DEFECTO.largo), ciclos: limite(v.ciclos, 1, 12, DEFECTO.ciclos)};
      t.pintado = "";
      pintar();
    }, () => {}));
    t.quitar.push(nube.d.onValue(ref("pomodoro"), (s) => { const v = s.val(); t.pomo = v && v.fase ? v : null; pintar(); }, () => {}));
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

  // ------------------------------------------------------------------ pomodoro
  async function empezar(tarea, mins, descanso) {
    const cfg = Object.assign({}, t.cfg);
    if (Number(mins) > 0) cfg.trabajo = Math.min(120, Math.round(Number(mins)));
    if (Number(descanso) > 0) cfg.descanso = Math.min(60, Math.round(Number(descanso)));
    const ligada = tarea ? buscarTarea(pendientes(), tarea) : null;
    const p = nuevoPomodoro(ligada ? ligada.texto : tarea, cfg, Date.now(), ligada ? ligada.id : "");
    p.trabajo = cfg.trabajo;                  // la duracion pedida vale para toda la ronda
    p.descanso = cfg.descanso;
    await ponerPomo(p);
    return `Empieza el pomodoro: ${cfg.trabajo} minutos${p.tarea ? " para " + p.tarea : ""}. Te aviso al terminar.`;
  }

  // La configuracion de la ronda en marcha (si se pidio "un pomodoro de 50 minutos", vale para todos)
  const cfgDe = (p) => Object.assign({}, t.cfg, p && p.trabajo ? {trabajo: p.trabajo} : {}, p && p.descanso ? {descanso: p.descanso} : {});

  function fraseFin(p, sig) {
    const de = p.tarea ? ` de ${p.tarea}` : "";
    if (p.fase === "trabajo" && sig && sig.fase === "largo") return `¡Muy bien! Terminaste los ${p.total} pomodoros${de}. Tómate un descanso largo de ${cfgDe(p).largo} minutos.`;
    if (p.fase === "trabajo") return `¡Tiempo! Terminaste el pomodoro ${p.ciclo} de ${p.total}${de}. Descansa ${cfgDe(p).descanso} minutos.`;
    if (p.fase === "descanso") return `Se acabó el descanso. Empieza el pomodoro ${p.ciclo + 1} de ${p.total}${p.tarea ? ": " + p.tarea : ""}.`;
    return "Se acabó el descanso largo. Cuando quieras, empezamos otra ronda.";
  }

  // Cada segundo: si la fase acabo, se pasa a la siguiente con una transaccion. La gana un solo
  // aparato (el que la ve primero) y ese la dice.
  async function revisar() {
    const p = t.pomo;
    if (!p || !p.fin || t.pasando || !nube.uid || Date.now() < p.fin) return;
    t.pasando = true;
    const ahora = Date.now(), tarde = ahora - p.fin > TARDE_MS;
    let sig = null, ganada = false;
    try {
      const r = await N.conTiempo(nube.d.runTransaction(ref("pomodoro"), (actual) => {
        if (!actual || actual.fin !== p.fin || actual.fase !== p.fase) return undefined;   // otro aparato ya la paso
        sig = tarde ? null : siguienteFase(actual, cfgDe(actual), actual.fin);
        if (sig) { sig.trabajo = actual.trabajo || 0; sig.descanso = actual.descanso || 0; }
        return sig;
      }, {applyLocally: false}), 10000);
      ganada = r.committed;
    } catch (e) { console.warn("tiempo: no pude pasar de fase", e); }
    if (ganada && p.fase === "trabajo" && p.tareaId) {
      nube.d.runTransaction(ref(`tareas/${p.tareaId}/pomodoros`), (n) => (typeof n === "number" ? n + 1 : 1)).catch(() => {});
    }
    t.pasando = false;
    if (!ganada) return;
    if (tarde) N.anunciar(`Tu pomodoro${p.tarea ? " de " + p.tarea : ""} terminó mientras la app estaba cerrada. Cuando quieras, empezamos otro.`);
    else N.anunciar(fraseFin(p, sig));
  }

  // ------------------------------------------------------------------ herramientas para Gemini
  const H_POMO = [
    {name: "iniciar_pomodoro", description: "Empieza un pomodoro (por defecto 25 minutos de trabajo y descansos según la configuración del usuario). Si ya hay uno en marcha, lo reemplaza.",
      parameters: {type: "object", properties: {
        tarea: {type: "string", description: "En qué va a trabajar, si lo dice (si coincide con una tarea de la matriz, se cuenta en ella)."},
        minutos: {type: "number", description: "Solo si pide otra duración de trabajo."}, descanso: {type: "number", description: "Solo si pide otra duración de descanso."}}}},
    {name: "pausar_pomodoro", description: "Pausa el pomodoro en marcha."},
    {name: "reanudar_pomodoro", description: "Sigue con el pomodoro pausado."},
    {name: "parar_pomodoro", description: "Termina el pomodoro (o la ronda) del todo."},
    {name: "estado_pomodoro", description: "Dice cuánto queda del pomodoro o del descanso y en qué ciclo va."},
  ];
  const H_MATRIZ = [
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
          if (!ts.length) return "No tienes tareas pendientes. ¿Quieres agregar alguna?";
          const x = ts[0], c = CUADRANTES[cuadrante(x)];
          let s = `Lo primero: ${x.texto}`;
          s += x.vence ? `, que vence ${T.cuandoDicho(x.vence)}.` : `, que está en ${c.nombre}.`;
          if (ts[1]) s += ` Después, ${ts[1].texto}.`;
          if (usaPomodoro() && !t.pomo) s += " ¿Empezamos un pomodoro con ella?";
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

  // ------------------------------------------------------------------ pantalla (Enfoque e Inicio)
  const FASES = {trabajo: "Trabajando", descanso: "Descanso", largo: "Descanso largo"};

  function pintarPomo() {
    const p = t.pomo, ahora = Date.now();
    // Inicio: una linea con el pomodoro en marcha
    const ini = $("#ag-pomodoro");
    if (ini) {
      ini.hidden = !p || !usaPomodoro() || !nube.usuario;
      if (p) ini.innerHTML = `<span class="tomate ${p.fase}"></span><b>${reloj(quedaMs(p, ahora))}</b><span>${esc(FASES[p.fase])}${p.fase === "trabajo" ? ` ${p.ciclo}/${p.total}` : ""}${p.tarea ? " · " + esc(p.tarea) : ""}${p.fin ? "" : " · en pausa"}</span><a href="#enfoque">Ver</a>`;
    }
    if (!document.getElementById("v-enfoque")) return;
    $("#pm-reloj").textContent = p ? reloj(quedaMs(p, ahora)) : reloj(t.cfg.trabajo * 60000);
    const total = p ? (p.fase === "trabajo" ? cfgDe(p).trabajo : p.fase === "largo" ? cfgDe(p).largo : cfgDe(p).descanso) * 60000 : 1;
    const avance = p ? 1 - quedaMs(p, ahora) / total : 0;
    $("#pm-anillo").style.setProperty("--avance", Math.max(0, Math.min(1, avance)).toFixed(4));
    $("#pm-anillo").className = "anillo " + (p ? p.fase : "");
    const firma = JSON.stringify([p && [p.fase, p.ciclo, p.total, p.tarea, !!p.fin], t.cfg]);
    if (firma === t.pintadoP) return;
    t.pintadoP = firma;
    $("#pm-fase").textContent = p ? FASES[p.fase] + (p.fin ? "" : " · en pausa") : "Listo para empezar";
    $("#pm-tarea").textContent = p ? (p.tarea || "Sin tarea") : `${t.cfg.trabajo} min de trabajo, ${t.cfg.descanso} de descanso`;
    const n = p ? p.total : t.cfg.ciclos;
    $("#pm-ciclos").innerHTML = Array.from({length: n}, (_, i) => `<i class="${p && (i < p.ciclo - 1 || (i === p.ciclo - 1 && p.fase !== "trabajo")) ? "hecho" : p && i === p.ciclo - 1 ? "ahora" : ""}"></i>`).join("");
    $("#pm-empezar").hidden = !!p;
    $("#pm-pausar").hidden = !p || !p.fin;
    $("#pm-seguir").hidden = !p || !!p.fin;
    $("#pm-parar").hidden = !p;
    ["trabajo", "descanso", "largo", "ciclos"].forEach((k) => { const i = $("#pm-" + k); if (document.activeElement !== i) i.value = t.cfg[k]; });
  }

  function pintar() {
    if (!document.getElementById("v-enfoque")) return;
    $("#tab-enfoque").hidden = !nube.usuario;
    pintarPomo();
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
      if (p) { const x = (t.tareas || []).find((y) => y.id === p.dataset.tareaPomo); if (x) empezar(x.texto).then(() => { location.hash = "#enfoque"; }).catch(err); }
      if (e.target.id === "mx-limpiar") (t.tareas || []).filter((x) => x.hecha).forEach((x) => nube.d.remove(ref("tareas/" + x.id)).catch(err));
    });
  }

  A.modulo({
    nombre: "tiempo", montar, alUsuario, pintar, ejecutar,
    alSegundo: () => { revisar(); pintarPomo(); },
    herramientas: () => (nube.uid ? (usaPomodoro() ? H_POMO : []).concat(usaMatriz() ? H_MATRIZ : [], [H_CFG]) : []),
    capacidad: () => (usaPomodoro() ? "- Llevar pomodoros: empezar, pausar, seguir, parar y decir cuánto queda (iniciar_pomodoro…).\n" : "")
      + (usaMatriz() ? "- Organizar sus tareas con la matriz de Eisenhower: agregar, ver, qué hacer primero, completar, mover y borrar.\n" : "")
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

  window.PixelTiempo = {texto: {nuevoPomodoro, siguienteFase, pausar, reanudar, quedaMs, cuadrante, ordenTareas, buscarTarea, reloj}, CUADRANTES};
})();
