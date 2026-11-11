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
  // "pensar". Fuente: ai.google.dev/gemini-api/docs/pricing (revisado el 10 nov 2026). Sirven para el uso
  // de antes del 11 nov, cuando Pixel traia Gemini incluido (gratis); desde entonces cada cuenta pone su clave.
  const PRECIOS = {"gemini-3.5-flash-lite": {e: 0.30, s: 2.50}, "gemini-3.1-flash-lite": {e: 0.25, s: 1.50}};
  const NOMBRE_MODELO = {"gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite", "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite"};
  const MOTIVOS = {charla: "Conversación", herramienta: "Consultas (segunda vuelta)", aprender: "Aprender solo",
    clasificar: "Asunto de las notas", analizar: "Analizar notas", prueba: "Pruebas de clave", perfil: "Leer tu perfil (.md)", otro: "Otras"};
  const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const RETENER_DIAS = 30;

  // gasto: "si" (gasta IA), "aveces" (solo cuando...), "no" (sin IA), "ahorra". El id "gemini" se queda
  // por los interruptores ya guardados en preferencias/modos
  const MODOS = [
    {id: "gemini", nombre: "Conversación con la IA", que: "Contesta lo que le preguntes y entiende órdenes nuevas, con el proveedor y la clave que pusiste arriba. Apagado, solo hace lo que no lo necesita.", gasto: "si", cuanto: "1 petición por pregunta; 2 si consulta algo (tus correos, tus tareas)."},
    {id: "ahorro", nombre: "Consumo bajo", que: "Recuerda las 2 últimas preguntas (en vez de 4) y mete menos notas del cerebro en cada una.", gasto: "ahorra", cuanto: "Cada petición lleva menos tokens."},
    {id: "cerebro", nombre: "Cerebro y memoria", que: "Lo que sabe de ti entra en cada pregunta: «Píxel, recuerda que…».", gasto: "aveces", cuanto: "No suma peticiones: hace cada pregunta un poco más grande."},
    {id: "aprender", nombre: "Aprender solo", que: "Al acabar cada conversación, saca datos nuevos sobre ti y los guarda en el cerebro.", gasto: "si", cuanto: "1 petición por conversación.", de: "cerebro"},
    {id: "google", nombre: "Google Calendar y Gmail", que: "Tu calendario y tu correo, por voz.", gasto: "aveces", cuanto: "Va en la misma pregunta; leer correos o eventos suma una vuelta."},
    {id: "whatsapp", nombre: "WhatsApp", que: "Escribir a tus contactos. Enviar siempre lo confirmas tú.", gasto: "aveces", cuanto: "Va en la misma pregunta."},
    {id: "musica", nombre: "Música, baile y escenarios", que: "YouTube por voz; baila y cambia el fondo según el género.", gasto: "aveces", cuanto: "Pedir una canción: 1 petición. Pausa, sigue, cambia y el volumen: sin IA."},
    {id: "aparatos", nombre: "Aparatos de la casa", que: "El PC, el TV y el ESP32 por voz.", gasto: "aveces", cuanto: "La orden pasa por la IA; «Píxel, prueba el ESP32» no."},
    {id: "tiempo", nombre: "Modo enfoque", que: "Pomodoro y la matriz de Eisenhower, con guía.", gasto: "no", cuanto: "La guía, los pomodoros y sus atajos son locales."},
    {id: "apuntes", nombre: "Notas dictadas", que: "«Píxel, toma nota» y la pestaña Notas.", gasto: "no", cuanto: "Dictar no usa la IA."},
    {id: "clasificar", nombre: "Asunto automático de las notas", que: "Al guardar una nota, la IA le pone asunto y lo más importante.", gasto: "si", cuanto: "1 petición por nota. Apagado, lo saca del título.", de: "apuntes"},
    {id: "analizar", nombre: "Ofrecer analizar cada nota", que: "Al terminar una nota, pregunta si la analiza (resumen, ideas, lo destacado).", gasto: "aveces", cuanto: "1 petición, solo si dices que sí.", de: "apuntes"},
    {id: "sonidos", nombre: "Sonidos", que: "Una campanita al llamarlo, una melodía suave mientras piensa y otra al terminar.", gasto: "no", cuanto: "Sin IA."},
    {id: "humor", nombre: "Personalidad juguetona", que: "Se ríe si lo tocas, hace cosas al azar y avisa antes de dormirse.", gasto: "no", cuanto: "Sin IA."},
  ];
  const ETIQUETA = {si: "Gasta IA", aveces: "IA a veces", no: "Sin IA", ahorra: "Ahorra IA"};

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // El precio de un modelo (clave del uso, saneada): de proveedores.js, que conoce tambien los de clave propia
  const precio = (k) => (typeof Proveedores !== "undefined" && Proveedores.precioDe(k)) || PRECIOS[String(k).replace(/^propia:/, "").replace(/_/g, ".")] || null;
  const esPropia = (k) => String(k).startsWith("propia:");
  // Lo que cuesta un dia (US$), por modelo, tokens de entrada y de salida. que: "propia" (lo que cobra el
  // proveedor de la clave del usuario), "gratis" (lo que costaria lo gratis si se pagara) o todo
  function costoDia(d, que) {
    let c = 0;
    for (const [k, m] of Object.entries((d && d.m) || {})) {
      if ((que === "propia" && !esPropia(k)) || (que === "gratis" && esPropia(k))) continue;
      const p = precio(k);
      if (p && m) c += ((m.e || 0) * p.e + (m.s || 0) * p.s) / 1e6;
    }
    return c;
  }
  // Por modelo en varios dias: [[clave, {n, e, s}]] de mas a menos peticiones
  function porModelo(uso, dias) {
    const t = {};
    for (const k of dias) for (const [mk, m] of Object.entries((uso[k] && uso[k].m) || {})) {
      const x = t[mk] || (t[mk] = {n: 0, e: 0, s: 0});
      x.n += m.n || 0; x.e += m.e || 0; x.s += m.s || 0;
    }
    return Object.entries(t).sort((a, b) => b[1].n - a[1].n);
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
  const aj = {uso: {}, aprender: false, quitar: [], pintadoM: "", pintadoU: "", pintadoV: "", guardada: false, eligiendo: false, limpiado: false};
  const ref = (sub) => nube.d.ref(nube.db, `usuarios/${nube.uid}/${sub}`);
  const valor = (id) => (id === "aprender" ? aj.aprender : N.activo(id));

  function alUsuario(u) {
    aj.quitar.forEach((f) => f());
    Object.assign(aj, {quitar: [], uso: {}, aprender: false, pintadoM: "", pintadoU: ""});
    N.modos({});
    // la clave de IA es de cada cuenta: el formulario muestra la de la cuenta que entro
    if (typeof Proveedores !== "undefined" && document.getElementById("f-ia")) formularioIA(Proveedores.leer().proveedor);
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
    const prov = typeof Proveedores !== "undefined" ? Proveedores.actual() : {propio: false};
    const realHoy = costoDia(u, "propia");
    const real7 = dias.reduce((t, k) => t + costoDia(aj.uso[k], "propia"), 0);
    const tiles = `<div class="uso-tiles">
      <div class="tile"><small>Peticiones hoy</small><b>${compacto(u.peticiones || 0)}</b></div>
      <div class="tile"><small>Tokens hoy</small><b>${compacto((u.entrada || 0) + (u.salida || 0))}</b><span>${compacto(u.entrada || 0)} de entrada · ${compacto(u.salida || 0)} de salida</span></div>
      <div class="tile"><small>Costo hoy</small><b>${dolares(realHoy)}</b><span>Lo cobra tu proveedor, con tu clave</span></div>
      <div class="tile"><small>Modelo ahora</small>${prov.propio
        ? `<b class="modelo">${esc(Proveedores.nombreModelo(Proveedores.sanear(prov.modelo)))}</b><span>Con tu clave de ${esc(Proveedores.LISTA[prov.proveedor].nombre)}</span>`
        : `<b class="modelo">Sin clave</b><span>Ponla arriba, en «Proveedor de IA»: sin ella Píxel no puede pensar</span>`}</div></div>`;
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
    const modelos = porModelo(aj.uso, dias);
    const lineasModelo = modelos.length ? modelos.map(([k, x]) => {
      const p = precio(k), c = p ? (x.e * p.e + x.s * p.s) / 1e6 : null;
      const costo = esPropia(k) ? (c === null ? "sin precio" : dolares(c)) : (c === null ? "gratis" : `gratis (serían ${dolares(c)})`);
      const nombre = typeof Proveedores !== "undefined" ? Proveedores.nombreModelo(k) : (NOMBRE_MODELO[k.replace(/_/g, ".")] || k);
      return `<div class="fila-modelo"><span class="nombre">${esc(nombre)}</span><span class="n">${x.n} pet. · ${compacto(x.e + x.s)} tokens</span><span class="costo${esPropia(k) ? " real" : ""}">${esc(costo)}</span></div>`;
    }).join("") : "";
    const tabla = `<details class="uso-tabla"><summary>Ver en tabla</summary><table><thead><tr><th>Día</th><th>Peticiones</th><th>Tokens</th><th>Pagando</th></tr></thead><tbody>
      ${dias.map((k) => { const x = aj.uso[k] || {}; return `<tr><td>${diaCorto(k)}</td><td>${x.peticiones || 0}</td><td>${compacto((x.entrada || 0) + (x.salida || 0))}</td><td>${dolares(costoDia(x, "propia") + costoDia(x, "gratis"))}</td></tr>`; }).join("")}
      </tbody></table></details>`;
    const h = `${tiles}
      <h3>Peticiones por día</h3>
      <div class="uso-grafica" role="group" aria-label="Peticiones a la IA por día, últimos 7 días">${columnas}</div>
      <div class="uso-tip" id="aj-tip" hidden></div>
      <h3>En qué se gastan · 7 días</h3>
      <div class="motivos">${lineasMotivo}</div>
      ${lineasModelo ? `<h3>Por modelo · 7 días</h3><div class="por-modelo">${lineasModelo}</div>` : ""}
      ${tabla}
      <p class="nota">Cada cuenta usa su propia clave de IA: lo que gastas lo cobra tu proveedor, según su plan. Con tu clave, en 7 días: ${dolares(real7)}.
        Los días de antes del 11 de noviembre pueden traer uso del Gemini que Píxel tenía incluido: sale como «gratis».</p>`;
    if (h !== aj.pintadoU) { $("#aj-uso").innerHTML = h; aj.pintadoU = h; }
  }

  // ------------------------------------------------------------------ la voz (voz.js, 2.0.0)
  // Dos caminos: la voz de alta calidad (Supertonic, 10 voces con el mismo modelo) o la del celular
  const VP = typeof VozPixel !== "undefined" ? VozPixel : null;
  function estadoVoz() {
    const e = VP.info();
    if (!VP.soportada()) return {t: "Este navegador no puede usarla", c: "mal"};
    if (e.lista) return {t: "Lista en este aparato" + (e.ep === "webgpu" ? " · con la tarjeta gráfica" : ""), c: "ok"};
    if (e.bajando) return {t: e.progreso ? `Bajando… ${Math.round(e.progreso * 100)} % de ${VP.MB} MB` : "Preparando…", c: "info", p: e.progreso || 0};
    if (e.error) return {t: "No se pudo bajar: " + e.error, c: "mal", bajar: true};
    return {t: aj.guardada ? "Bajada; se prepara al usarla" : `Sin bajar · ${VP.MB} MB, una sola vez (mejor con WiFi)`, c: "", bajar: !aj.guardada};
  }
  function pintarVoz() {
    if (!VP || !document.getElementById("aj-voces")) return;
    const a = N.ajustes(), actual = N.voz.actual(), alta = !!VP.de(actual) || (VP.de(VP.normal(a.voz || VP.DEFECTO)) && VP.lenta());
    const elegida = VP.de(VP.normal(a.voz || VP.DEFECTO)) || VP.de(VP.DEFECTO), celular = N.voz.celular(), e = estadoVoz();
    const opciones = ["mujer", "hombre"].map((tipo) => `<optgroup label="${tipo === "mujer" ? "Mujer" : "Hombre"}">${VP.VOCES.filter((v) => v.tipo === tipo)
      .map((v) => `<option value="${v.id}"${v.id === elegida.id ? " selected" : ""}>${esc(v.nombre)}</option>`).join("")}</optgroup>`).join("");
    const lenta = VP.lenta() ? `<small class="estado mal">Este aparato es lento para esta voz: por ahora hablo con la del celular.</small>
        <button class="btn" type="button" data-voz-reintentar>Intentar otra vez</button>` : "";
    let h = `<label class="voz-px${alta ? " elegida" : ""}">
        <input type="radio" name="aj-voz" value="alta"${alta ? " checked" : ""}${VP.soportada() ? "" : " disabled"}>
        <span class="txt"><b>Voz de alta calidad</b><small>Supertonic 3: natural y clara. Funciona sin internet una vez bajada.</small>
          <select id="aj-voz-alta" aria-label="Voz de alta calidad">${opciones}</select>
          <small class="estado ${e.c}">${esc(e.t)}</small>${e.p !== undefined ? `<span class="barra"><i style="width:${Math.round(e.p * 100)}%"></i></span>` : ""}
          ${e.bajar && VP.soportada() ? '<button class="btn suave" type="button" data-voz-bajar>Bajar ahora</button>' : ""}${lenta}</span>
        <button class="btn" type="button" data-escuchar="alta">Escuchar</button></label>`;
    const sel = celular.length ? `<select id="aj-voz-celular" aria-label="Voz del celular"><option value="celular">La mejor que tenga</option>${celular.map((v) =>
      `<option value="${esc(v.id)}"${a.voz === v.id ? " selected" : ""}>${esc(v.nombre)} · ${esc(v.lang)}</option>`).join("")}</select>` : "";
    h += `<label class="voz-px${!alta ? " elegida" : ""}">
        <input type="radio" name="aj-voz" value="celular"${!alta ? " checked" : ""}>
        <span class="txt"><b>La voz del celular</b><small>${celular.length ? "Sin bajar nada. Suena distinto en cada celular." : "Este navegador no tiene voces en español."}</small>${sel}</span>
        <button class="btn" type="button" data-escuchar="celular">Escuchar</button></label>`;
    if (h !== aj.pintadoV && !aj.eligiendo) { $("#aj-voces").innerHTML = h; aj.pintadoV = h; }
    document.querySelectorAll("input[name=aj-tono]").forEach((r) => { r.checked = r.value === (a.tono || "normal"); });
    const chip = $("#voz-chip"), t = alta && !VP.lenta() ? `${elegida.nombre.replace(/ \(.*\)| · .*/, "")} · alta calidad` + (VP.info().lista ? "" : " · bajando") : "Voz del celular";
    if (chip.textContent !== t) { chip.textContent = t; chip.className = "chip" + (alta && VP.info().lista ? " ok" : " info"); }
  }
  async function revisarGuardada() {
    if (!VP) return;
    aj.guardada = await VP.guardada();
    pintarVoz();
  }
  function elegirVoz(voz) {
    const a = N.ajustes(), deCelular = !VP || !VP.de(VP.normal(a.voz || VP.DEFECTO));
    // la voz de alta calidad se pidio "suave y elocuente": al pasar a ella desde la del celular, tono normal
    A.guardarAjustes({voz, tono: VP && VP.de(voz) && deCelular ? "normal" : a.tono});
  }
  function montarVoz() {
    if (!VP || !document.getElementById("aj-voces")) return;
    VP.alCambiar(pintarVoz);
    revisarGuardada();
    const caja = $("#aj-voces");
    caja.addEventListener("focusin", (e) => { if (e.target.tagName === "SELECT") aj.eligiendo = true; });   // que no se repinte mientras elige
    caja.addEventListener("focusout", () => { aj.eligiendo = false; });
    caja.addEventListener("change", (e) => {
      const alta = document.getElementById("aj-voz-alta"), cel = document.getElementById("aj-voz-celular");
      if (e.target.name === "aj-voz") elegirVoz(e.target.value === "alta" ? alta.value : (cel ? cel.value : "celular"));
      else if (e.target.id === "aj-voz-alta") elegirVoz(e.target.value);
      else if (e.target.id === "aj-voz-celular") elegirVoz(e.target.value);
      aj.eligiendo = false;
    });
    caja.addEventListener("click", (e) => {
      const b = e.target.closest("[data-escuchar], [data-voz-bajar], [data-voz-reintentar]");
      if (!b) return;
      e.preventDefault();
      if (b.dataset.vozBajar !== undefined) { N.voz.preparar(true); return; }
      if (b.dataset.vozReintentar !== undefined) { VP.reintentar(); return; }
      const alta = document.getElementById("aj-voz-alta"), cel = document.getElementById("aj-voz-celular");
      N.voz.escuchar(b.dataset.escuchar === "alta" ? alta.value : (cel ? cel.value : "celular"), N.ajustes().tono);
    });
    $("#aj-tono").addEventListener("change", (e) => { if (e.target.name === "aj-tono") A.guardarAjustes({tono: e.target.value}); });
  }

  function pintar() {
    if (!document.getElementById("v-ajustes")) return;
    $("#tab-ajustes").hidden = !nube.usuario;
    if (!nube.usuario) return;
    pintarVoz();
    pintarChipIA();
    pintarModos();
    pintarUso();
  }

  // ------------------------------------------------------------------ el proveedor de IA (proveedores.js)
  // El formulario se rellena al cambiar de proveedor (no a cada segundo: se perderia lo que se escribe).
  const modelosVistos = {};                    // proveedor -> [{id, nombre, e, s}] de "Buscar modelos"
  function pintarChipIA() {
    if (typeof Proveedores === "undefined") return;
    const a = Proveedores.actual(), chip = $("#ia-chip");
    const t = a.propio ? `En uso: ${Proveedores.nombreModelo(Proveedores.sanear(a.modelo))}` : "Sin clave: Píxel no puede pensar";
    if (chip.textContent !== t) { chip.textContent = t; chip.className = "chip" + (a.propio ? " ok" : " warn"); }
  }
  function formularioIA(p) {
    const P = Proveedores, L = P.LISTA[p], cfg = P.leer();
    $("#ia-proveedor").value = p;
    $("#ia-ayuda").textContent = L.ayuda + (p === "openrouter" ? " Kimi no deja que una página web llame a su servicio directamente: úsalo desde aquí." : "");
    $("#ia-propio").hidden = !L.clave;
    $("#ia-borrar").hidden = !L.clave;
    $("#ia-base-campo").hidden = p !== "otro";
    $("#ia-base").value = cfg.bases.otro || "";
    const clave = $("#ia-clave");
    clave.value = "";
    clave.placeholder = cfg.claves[p] ? `Guardada: ${P.tapada(cfg.claves[p])} (escribe otra para cambiarla)` : (L.ejemplo || "");
    const fijo = !!L.modelos;
    $("#ia-modelo-fijo").hidden = !fijo;
    $("#ia-modelo").hidden = fijo;
    $("#ia-buscar").hidden = fijo;
    $("#ia-precios").hidden = fijo;
    if (fijo) {
      $("#ia-modelo-fijo").innerHTML = L.modelos.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)} · US$ ${m.e} / ${m.s} por millón</option>`).join("");
      $("#ia-modelo-fijo").value = P.modeloDe(cfg, p);
    } else {
      $("#ia-modelo").value = cfg.modelos[p] || "";
      $("#ia-modelos").innerHTML = (modelosVistos[p] || []).map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join("");
      preciosIA();
    }
    $("#ia-prueba").hidden = true;
  }
  // Los precios del modelo escrito: los guardados, o los que dio OpenRouter al buscar modelos
  function preciosIA() {
    const p = $("#ia-proveedor").value, id = $("#ia-modelo").value.trim(), cfg = Proveedores.leer();
    const visto = (modelosVistos[p] || []).find((m) => m.id === id), guardado = cfg.precios[id];
    const pr = guardado || (visto && visto.e !== undefined ? visto : null);
    $("#ia-pe").value = pr ? pr.e : "";
    $("#ia-ps").value = pr ? pr.s : "";
  }
  // Lo que hay en el formulario, como lo que usa proveedores.js (sin guardar)
  function delFormulario() {
    const P = Proveedores, p = $("#ia-proveedor").value, L = P.LISTA[p], cfg = P.leer();
    const clave = $("#ia-clave").value.trim() || cfg.claves[p] || "";
    const modelo = L.modelos ? $("#ia-modelo-fijo").value : $("#ia-modelo").value.trim();
    const base = p === "otro" ? $("#ia-base").value.trim().replace(/\/+$/, "") : P.baseDe(cfg, p);
    return {p, L, cfg, a: {proveedor: p, modelo, clave, base, propio: true}};
  }
  function resultadoIA(ok, texto) {
    const caja = $("#ia-prueba");
    caja.hidden = false;
    caja.innerHTML = `<ul><li class="${ok ? "ok" : "mal"}">${esc(texto)}</li></ul>`;
  }
  function montarIA() {
    if (typeof Proveedores === "undefined" || !document.getElementById("f-ia")) return;
    const P = Proveedores;
    $("#ia-proveedor").innerHTML = Object.entries(P.LISTA).map(([k, L]) => `<option value="${k}">${esc(L.nombre)}</option>`).join("");
    formularioIA(P.leer().proveedor);
    $("#ia-proveedor").addEventListener("change", (e) => formularioIA(e.target.value));
    $("#ia-modelo").addEventListener("change", preciosIA);
    $("#ia-buscar").addEventListener("click", async (e) => {
      const {p, a} = delFormulario(), b = e.currentTarget;
      if (!a.clave) { resultadoIA(false, "Primero escribe tu clave."); return; }
      if (!/^https:\/\//.test(a.base)) { resultadoIA(false, "Escribe la dirección del servicio (https://…)."); return; }
      b.disabled = true;
      try {
        modelosVistos[p] = await P.buscarModelos(a);
        $("#ia-modelos").innerHTML = modelosVistos[p].map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join("");
        resultadoIA(true, `${modelosVistos[p].length} modelos. Toca la caja «Modelo» para elegir uno, o escribe parte de su nombre.`);
        $("#ia-modelo").focus();
      } catch (er) { resultadoIA(false, "No pude traer los modelos: " + (er.message || er)); } finally { b.disabled = false; }
    });
    $("#ia-probar").addEventListener("click", async (e) => {
      const {a, L} = delFormulario(), b = e.currentTarget;
      if (!a.clave) { resultadoIA(false, "Escribe tu clave."); return; }
      if (!a.modelo) { resultadoIA(false, "Elige un modelo."); return; }
      b.disabled = true;
      resultadoIA(true, `Probando ${a.modelo}…`);
      const r = await P.probar(a);
      b.disabled = false;
      if (r.ok && r.uso) N.contarUso("prueba", P.claveUso(a), r.uso);
      resultadoIA(r.ok, r.ok ? `Funciona: ${L.nombre} contestó «${r.texto}» en ${(r.ms / 1000).toFixed(1).replace(".", ",")} s.` : `No funcionó: ${r.texto}`);
    });
    $("#ia-borrar").addEventListener("click", () => {
      const p = $("#ia-proveedor").value, cfg = P.leer();
      delete cfg.claves[p];
      P.guardar(cfg);
      formularioIA(p);
      N.pintar();
      pintar();
      if (window.pintarPasos) window.pintarPasos();
      toast(P.actual().propio ? "Borré esa clave de esta cuenta en este aparato." : "Borré la clave de esta cuenta en este aparato. Sin clave, Píxel no puede pensar.");
    });
    $("#f-ia").addEventListener("submit", (e) => {
      e.preventDefault();
      const {p, L, cfg, a} = delFormulario();
      const nueva = $("#ia-clave").value.trim();
      if (!nube.uid) { resultadoIA(false, "Entra con tu cuenta para guardar la clave: cada cuenta tiene la suya."); return; }
      if (nueva && !P.claveValida(p, nueva)) { resultadoIA(false, `Esa clave no parece de ${L.nombre}${L.ejemplo ? ` (empieza por ${L.ejemplo.replace("…", "")})` : ""}.`); return; }
      if (!a.clave) { resultadoIA(false, "Escribe tu clave."); return; }
      if (!a.modelo) { resultadoIA(false, "Elige un modelo."); return; }
      if (p === "otro" && !/^https:\/\//.test(a.base)) { resultadoIA(false, "La dirección tiene que empezar por https://"); return; }
      if (nueva) cfg.claves[p] = nueva;
      cfg.modelos[p] = a.modelo;
      if (p === "otro") cfg.bases.otro = a.base;
      if (!L.modelos) {
        const pe = parseFloat($("#ia-pe").value), ps = parseFloat($("#ia-ps").value);
        if (isFinite(pe) && isFinite(ps) && pe >= 0 && ps >= 0) cfg.precios[a.modelo] = {e: pe, s: ps};
      }
      cfg.proveedor = p;
      if (!P.guardar(cfg)) { resultadoIA(false, "Este navegador no deja guardar la clave (modo privado)."); return; }
      formularioIA(p);
      N.pintar();
      pintar();
      if (window.pintarPasos) window.pintarPasos();
      resultadoIA(true, `Listo: Píxel piensa con ${P.nombreModelo(P.sanear(a.modelo))}, con tu clave. Toca «Probar» para comprobarla.`);
    });
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
    montarVoz();
    montarIA();
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
  window.PixelAjustes = {texto: {costoDia, dolares, compacto, ultimosDias, diaCorto, porMotivo, porModelo}, MODOS, PRECIOS};
})();
