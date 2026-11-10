/* Fase 14 - Ajustes (pedidos del usuario el 10 nov: "una pestaña Ajustes con todos los modos de Píxel, un
   switch de on y off y una descripción: esto gasta la licencia de Gemini, esto no"; "un visual del costo de
   Gemini" y "dejar el consumo en bajo").
   - Cada modo tiene su interruptor: usuarios/<uid>/preferencias/modos/<id> (true/false); "Aprender solo"
     usa preferencias/aprender (cerebro.js). agente.js (nucleo.activo) apaga los modulos que esten en false
     y trae los valores por defecto (MODOS_DEFECTO: consumo bajo).
   - El consumo: agente.js apunta cada peticion en usuarios/<uid>/uso/<dia del cupo de Google>; aqui se
     dibuja: hoy, los ultimos 7 dias, en que se gasta y lo que costaria con el plan de pago.
   Al cargarse no toca la pagina: las funciones de texto (PixelAjustes.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo;

  // Precios oficiales del plan de pago, en US$ por millon de tokens; la salida incluye los tokens de
  // "pensar". Fuente: ai.google.dev/gemini-api/docs/pricing (revisado el 10 nov 2026). El plan gratis
  // (el que usa Pixel) no cobra: tiene un cupo de peticiones por dia y por modelo.
  const PRECIOS = {"gemini-3.5-flash-lite": {e: 0.30, s: 2.50}, "gemini-3.1-flash-lite": {e: 0.25, s: 1.50}};
  const NOMBRE_MODELO = {"gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite", "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite"};
  const MOTIVOS = {charla: "Conversación", herramienta: "Consultas (segunda vuelta)", aprender: "Aprender solo",
    clasificar: "Asunto de las notas", analizar: "Analizar notas", otro: "Otras"};
  const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const RETENER_DIAS = 30;

  // gasto: "si" (gasta Gemini), "aveces" (solo cuando...), "no" (sin Gemini), "ahorra"
  const MODOS = [
    {id: "gemini", nombre: "Conversación con Gemini", que: "Contesta lo que le preguntes y entiende órdenes nuevas. Apagado, solo hace lo que no lo necesita.", gasto: "si", cuanto: "1 petición por pregunta; 2 si consulta algo (tus correos, tus tareas)."},
    {id: "ahorro", nombre: "Consumo bajo", que: "Recuerda las 2 últimas preguntas (en vez de 4) y mete menos notas del cerebro en cada una.", gasto: "ahorra", cuanto: "Cada petición lleva menos tokens."},
    {id: "cerebro", nombre: "Cerebro y memoria", que: "Lo que sabe de ti entra en cada pregunta: «Píxel, recuerda que…».", gasto: "aveces", cuanto: "No suma peticiones: hace cada pregunta un poco más grande."},
    {id: "aprender", nombre: "Aprender solo", que: "Al acabar cada conversación, saca datos nuevos sobre ti y los guarda en el cerebro.", gasto: "si", cuanto: "1 petición por conversación.", de: "cerebro"},
    {id: "google", nombre: "Google Calendar y Gmail", que: "Tu calendario y tu correo, por voz.", gasto: "aveces", cuanto: "Va en la misma pregunta; leer correos o eventos suma una vuelta."},
    {id: "whatsapp", nombre: "WhatsApp", que: "Escribir a tus contactos. Enviar siempre lo confirmas tú.", gasto: "aveces", cuanto: "Va en la misma pregunta."},
    {id: "musica", nombre: "Música, baile y escenarios", que: "YouTube por voz; baila y cambia el fondo según el género.", gasto: "aveces", cuanto: "Pedir una canción: 1 petición. Pausa, sigue, cambia y el volumen: sin Gemini."},
    {id: "aparatos", nombre: "Aparatos de la casa", que: "El PC, el TV y el ESP32 por voz.", gasto: "aveces", cuanto: "La orden pasa por Gemini; «Píxel, prueba el ESP32» no."},
    {id: "tiempo", nombre: "Modo enfoque", que: "Pomodoro y la matriz de Eisenhower, con guía.", gasto: "no", cuanto: "La guía, los pomodoros y sus atajos son locales."},
    {id: "apuntes", nombre: "Notas dictadas", que: "«Píxel, toma nota» y la pestaña Notas.", gasto: "no", cuanto: "Dictar no usa Gemini."},
    {id: "clasificar", nombre: "Asunto automático de las notas", que: "Al guardar una nota, Gemini le pone asunto y lo más importante.", gasto: "si", cuanto: "1 petición por nota. Apagado, lo saca del título.", de: "apuntes"},
    {id: "analizar", nombre: "Ofrecer analizar cada nota", que: "Al terminar una nota, pregunta si la analiza (resumen, ideas, lo destacado).", gasto: "aveces", cuanto: "1 petición, solo si dices que sí.", de: "apuntes"},
    {id: "humor", nombre: "Personalidad juguetona", que: "Se ríe si lo tocas, hace cosas al azar y avisa antes de dormirse.", gasto: "no", cuanto: "Sin Gemini."},
  ];
  const ETIQUETA = {si: "Gasta Gemini", aveces: "Gemini a veces", no: "Sin Gemini", ahorra: "Ahorra Gemini"};

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // Lo que costaria un dia con el plan de pago (US$): por modelo, tokens de entrada y de salida
  function costoDia(d) {
    let c = 0;
    for (const [k, m] of Object.entries((d && d.m) || {})) {
      const p = PRECIOS[k.replace(/_/g, ".")];
      if (p && m) c += ((m.e || 0) * p.e + (m.s || 0) * p.s) / 1e6;
    }
    return c;
  }
  // "US$ 0,0031" / "US$ 1,25"
  const dolares = (x) => "US$ " + (x > 0 && x < 0.01 ? x.toLocaleString("es-CO", {minimumFractionDigits: 4, maximumFractionDigits: 4})
    : x.toLocaleString("es-CO", {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  // 1.284 / 12,9 mil / 1,2 M
  const compacto = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString("es-CO", {maximumFractionDigits: 1}) + " M"
    : n >= 10000 ? (n / 1000).toLocaleString("es-CO", {maximumFractionDigits: 1}) + " mil" : Math.round(n).toLocaleString("es-CO"));
  // Los ultimos n dias (claves AAAA-MM-DD) que terminan en "hoy"
  function ultimosDias(hoy, n) {
    const [y, m, d] = hoy.split("-").map(Number), out = [];
    for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
    return out;
  }
  const diaCorto = (k) => { const f = new Date(k + "T12:00:00Z"); return `${DIAS[f.getUTCDay()]} ${f.getUTCDate()}`; };
  // Suma de los motivos de varios dias, de mayor a menor: [[motivo, n]]
  function porMotivo(uso, dias) {
    const t = {};
    for (const k of dias) for (const [m, n] of Object.entries((uso[k] && uso[k].por) || {})) t[m] = (t[m] || 0) + n;
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }

  // ------------------------------------------------------------------ estado y nube
  const aj = {uso: {}, aprender: false, quitar: [], pintadoM: "", pintadoU: "", limpiado: false};
  const ref = (sub) => nube.d.ref(nube.db, `usuarios/${nube.uid}/${sub}`);
  const valor = (id) => (id === "aprender" ? aj.aprender : N.activo(id));

  function alUsuario(u) {
    aj.quitar.forEach((f) => f());
    Object.assign(aj, {quitar: [], uso: {}, aprender: false, pintadoM: "", pintadoU: ""});
    N.modos({});
    if (!u) { pintar(); return; }
    aj.quitar.push(nube.d.onValue(ref("preferencias/modos"), (s) => { N.modos(s.val() || {}); pintar(); }, () => {}));
    aj.quitar.push(nube.d.onValue(ref("preferencias/aprender"), (s) => { aj.aprender = s.val() === true; pintar(); }, () => {}));
    const q = nube.d.query(ref("uso"), nube.d.orderByKey(), nube.d.limitToLast(8));
    aj.quitar.push(nube.d.onValue(q, (s) => { aj.uso = s.val() || {}; pintar(); }, (e) => console.warn("ajustes: uso", e)));
    if (!aj.limpiado) {                                        // lo de hace mas de un mes se borra (una vez por sesion)
      aj.limpiado = true;
      const limite = ultimosDias(N.diaDelCupo(), RETENER_DIAS)[0];
      nube.d.get(nube.d.query(ref("uso"), nube.d.orderByKey(), nube.d.endBefore(limite))).then((s) => {
        Object.keys(s.val() || {}).forEach((k) => nube.d.remove(ref("uso/" + k)).catch(() => {}));
      }).catch(() => {});
    }
  }

  async function cambiar(id, encendido) {
    if (!nube.uid) return;
    try {
      if (id === "aprender") { aj.aprender = encendido; await N.conTiempo(nube.d.set(ref("preferencias/aprender"), encendido), 8000); }
      else await N.conTiempo(nube.d.set(ref("preferencias/modos/" + id), encendido), 8000);
    } catch (e) { toast("No pude guardarlo: " + (e.code || e.message), true); }
  }

  // ------------------------------------------------------------------ pantalla
  function pintarModos() {
    const h = MODOS.map((m) => {
      const on = valor(m.id), padreApagado = m.de && !valor(m.de);
      return `<div class="modo${m.de ? " sub" : ""}${padreApagado ? " inactivo" : ""}">
        <div class="txt"><b>${esc(m.nombre)}</b><small>${esc(m.que)}</small>
          <span class="gasto ${m.gasto}">${ETIQUETA[m.gasto]}</span><small class="cuanto">${esc(m.cuanto)}</small></div>
        <label class="interruptor"><input type="checkbox" role="switch" data-modo="${m.id}"${on ? " checked" : ""}${padreApagado ? " disabled" : ""}
          aria-label="${esc(m.nombre)}"><span aria-hidden="true"></span></label></div>`;
    }).join("");
    if (h !== aj.pintadoM) { $("#aj-modos").innerHTML = h; aj.pintadoM = h; }
  }

  function pintarUso() {
    const hoy = N.diaDelCupo(), dias = ultimosDias(hoy, 7), u = aj.uso[hoy] || {};
    const modelo = N.modeloDeHoy(), respaldo = N.MODELOS.indexOf(modelo) > 0;
    const costoHoy = costoDia(u), costo7 = dias.reduce((t, k) => t + costoDia(aj.uso[k]), 0);
    // a que hora se renueva el cupo (medianoche del Pacifico, en la hora de aqui)
    const [y, mo, d] = hoy.split("-").map(Number);
    const renueva = new Date(Date.UTC(y, mo - 1, d + 1, 8)).toLocaleTimeString("es-CO", {hour: "numeric", minute: "2-digit"});
    const tiles = `<div class="uso-tiles">
      <div class="tile"><small>Peticiones hoy</small><b>${compacto(u.peticiones || 0)}</b></div>
      <div class="tile"><small>Tokens hoy</small><b>${compacto((u.entrada || 0) + (u.salida || 0))}</b><span>${compacto(u.entrada || 0)} de entrada · ${compacto(u.salida || 0)} de salida</span></div>
      <div class="tile"><small>Costo hoy</small><b>US$ 0</b><span>Plan gratis. Pagando serían ${dolares(costoHoy)}</span></div>
      <div class="tile"><small>Modelo ahora</small><b class="modelo">${esc(NOMBRE_MODELO[modelo] || modelo)}</b><span>${respaldo ? "El 3.5 gastó su cupo de hoy" : "El principal"}</span></div></div>`;
    const ns = dias.map((k) => (aj.uso[k] && aj.uso[k].peticiones) || 0), max = Math.max(1, ...ns), imax = ns.indexOf(Math.max(...ns));
    const columnas = dias.map((k, i) => {
      const n = ns[i], etiqueta = i === dias.length - 1 || (i === imax && n > 0);       // solo hoy y el maximo llevan numero
      return `<button type="button" class="col${i === dias.length - 1 ? " hoy" : ""}" data-dia="${k}" aria-label="${diaCorto(k)}: ${n} peticiones">
        <span class="valor">${etiqueta ? n : ""}</span><span class="area"><i style="height:${n ? Math.max(3, (n / max) * 100) : 0}%"></i></span><small>${i === dias.length - 1 ? "hoy" : diaCorto(k)}</small></button>`;
    }).join("");
    const motivos = porMotivo(aj.uso, dias), mmax = Math.max(1, ...motivos.map(([, n]) => n));
    const lineasMotivo = motivos.length ? motivos.map(([m, n]) => `<div class="motivo"><span class="nombre">${esc(MOTIVOS[m] || m)}</span>
        <span class="barra"><i style="width:${(n / mmax) * 100}%"></i></span><span class="n">${n}</span></div>`).join("")
      : '<p class="vacio">Todavía no hay consumo apuntado. Se cuenta desde la versión 1.3.0.</p>';
    const tabla = `<details class="uso-tabla"><summary>Ver en tabla</summary><table><thead><tr><th>Día</th><th>Peticiones</th><th>Tokens</th><th>Pagando</th></tr></thead><tbody>
      ${dias.map((k) => { const x = aj.uso[k] || {}; return `<tr><td>${diaCorto(k)}</td><td>${x.peticiones || 0}</td><td>${compacto((x.entrada || 0) + (x.salida || 0))}</td><td>${dolares(costoDia(x))}</td></tr>`; }).join("")}
      </tbody></table></details>`;
    const h = `${tiles}
      <h3>Peticiones por día</h3>
      <div class="uso-grafica" role="group" aria-label="Peticiones a Gemini por día, últimos 7 días">${columnas}</div>
      <div class="uso-tip" id="aj-tip" hidden></div>
      <h3>En qué se gastan · 7 días</h3>
      <div class="motivos">${lineasMotivo}</div>
      ${tabla}
      <p class="nota">El plan gratis de Gemini no cobra: tiene un cupo de peticiones por día para cada modelo (se renueva a las ${esc(renueva)}). Si se acaba, Píxel pasa solo al modelo de respaldo.
        En 7 días, con el plan de pago habrían sido ${dolares(costo7)} (3.5 Flash-Lite: US$ 0,30 por millón de tokens de entrada y US$ 2,50 de salida;
        3.1 Flash-Lite: US$ 0,25 y US$ 1,50). <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noopener">Precios de Google</a></p>`;
    if (h !== aj.pintadoU) { $("#aj-uso").innerHTML = h; aj.pintadoU = h; }
  }

  function pintar() {
    if (!document.getElementById("v-ajustes")) return;
    $("#tab-ajustes").hidden = !nube.usuario;
    if (!nube.usuario) return;
    pintarModos();
    pintarUso();
  }

  // el globo de cada columna (raton, foco o toque)
  function mostrarTip(col) {
    const tip = $("#aj-tip");
    if (!col) { tip.hidden = true; return; }
    const k = col.dataset.dia, x = aj.uso[k] || {};
    tip.innerHTML = `<b>${diaCorto(k)}</b> · ${x.peticiones || 0} peticiones · ${compacto((x.entrada || 0) + (x.salida || 0))} tokens · pagando ${dolares(costoDia(x))}`;
    const g = col.parentElement.getBoundingClientRect(), c = col.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(g.width - 220, c.left - g.left + c.width / 2 - 110)) + "px";
    tip.hidden = false;
  }

  function montar() {
    if (!document.getElementById("v-ajustes")) return;
    $("#aj-modos").addEventListener("change", (e) => {
      const i = e.target.closest("[data-modo]");
      if (i) cambiar(i.dataset.modo, i.checked);
    });
    const uso = $("#aj-uso");
    uso.addEventListener("pointerover", (e) => mostrarTip(e.target.closest(".col")));
    uso.addEventListener("pointerleave", () => mostrarTip(null));
    uso.addEventListener("focusin", (e) => mostrarTip(e.target.closest(".col")));
    uso.addEventListener("focusout", () => mostrarTip(null));
    uso.addEventListener("click", (e) => mostrarTip(e.target.closest(".col")));
  }

  A.modulo({nombre: "ajustes", montar, alUsuario, pintar});
  window.PixelAjustes = {texto: {costoDia, dolares, compacto, ultimosDias, diaCorto, porMotivo}, MODOS, PRECIOS};
})();
