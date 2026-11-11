/* 2.1.0 - Registro de acciones (pedido del usuario el 11 nov, tras un correo que salio a quien no era:
   "que la app muestre que envio, creo o encendio Pixel, con hora").
   - Lo que hace la app (agente.js, N.registrar): usuarios/<uid>/registro/<id> = {t, tipo, texto, detalle, aparato}.
     Se anota DESPUES de hacerlo (correo enviado, evento creado/movido/borrado, WhatsApp, orden a un
     aparato, recordatorio, contactos de Google), nunca antes.
   - Lo que hace el Pixel del PC por voz (nube.registrar): pixeles/<pid>/registro/<id>, lo leen sus duenos.
   - Aqui se juntan las dos listas (las ultimas MAX de cada una), por dia y con filtros.
   El de la cuenta se puede borrar; el del PC lo guarda el PC (las ultimas 300).
   Al cargarse no toca la pagina: las funciones de texto (PixelRegistro.texto) se prueban en Node. */
"use strict";
(function () {
  const MAX = 200;

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // tipo -> grupo del filtro (los del PC: crear_evento, borrar_recordatorio...)
  const GRUPO = {correo: "correo", evento: "evento", crear_evento: "evento", whatsapp: "whatsapp", aparato: "aparato",
    recordatorio: "recordatorio", borrar_recordatorio: "recordatorio"};
  const FILTROS = [["todo", "Todo"], ["correo", "Correo"], ["evento", "Calendario"], ["whatsapp", "WhatsApp"],
    ["aparato", "Aparatos"], ["recordatorio", "Recordatorios"], ["otro", "Otros"]];
  const ETIQUETA = {correo: "Correo", evento: "Calendario", whatsapp: "WhatsApp", aparato: "Aparato", recordatorio: "Recordatorio", otro: "Otro"};
  const grupo = (tipo) => GRUPO[tipo] || "otro";
  const DESDE = {Celular: "Desde el celular", Computador: "Desde el computador", PC: "Píxel del PC"};

  // Las dos listas ({id: entrada}) en una, de la mas nueva a la mas vieja
  function juntar(cuenta, pc) {
    const out = [];
    for (const [origen, v] of [["cuenta", cuenta], ["pc", pc]]) {
      for (const [id, e] of Object.entries(v || {})) {
        if (!e || typeof e.texto !== "string" || typeof e.t !== "number") continue;
        out.push({id, origen, t: e.t, tipo: String(e.tipo || ""), grupo: grupo(e.tipo), texto: e.texto,
          detalle: typeof e.detalle === "string" ? e.detalle : "", aparato: String(e.aparato || "")});
      }
    }
    return out.sort((a, b) => b.t - a.t);
  }

  // "Hoy", "Ayer" o "martes 4 de noviembre" (a la hora de quien mira)
  function dia(t, ahora) {
    const d = new Date(t), h = new Date(ahora === undefined ? Date.now() : ahora);
    const base = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dif = Math.round((base(h) - base(d)) / 86400000);
    if (dif === 0) return "Hoy";
    if (dif === 1) return "Ayer";
    const s = d.toLocaleDateString("es", {weekday: "long", day: "numeric", month: "long"});
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const hora = (t) => new Date(t).toLocaleTimeString("es", {hour: "numeric", minute: "2-digit"});

  const texto = {juntar, dia, grupo};
  if (typeof window === "undefined" || !window.Agente) {
    if (typeof module !== "undefined") module.exports = {texto};
    return;
  }

  // ------------------------------------------------------------------ la cuenta y el PC (Firebase)
  const A = window.Agente;
  const rg = {cuenta: null, pc: {}, pid: "", quitar: null, quitarPc: null, filtro: "todo", pintado: "", podado: false, aviso: "", reloj: null};
  const refCuenta = () => nube.d.ref(nube.db, `usuarios/${nube.uid}/registro`);

  function alUsuario(u) {
    if (rg.quitar) { rg.quitar(); rg.quitar = null; }
    Object.assign(rg, {cuenta: null, podado: false, aviso: ""});
    seguirPc(true);
    pintar();
    if (!u) return;
    const d = nube.d;
    rg.quitar = d.onValue(d.query(refCuenta(), d.limitToLast(MAX)), (s) => {
      rg.cuenta = s.val() || {};
      pintar();
      podar();
    }, (e) => { console.warn("registro:", e); rg.cuenta = {}; pintar(); });
  }

  // El del Pixel del PC enlazado (nube.pid lo elige app.js; si cambia, se vuelve a escuchar)
  function seguirPc(forzar) {
    const pid = nube.usuario ? nube.pid || "" : "";
    if (pid === rg.pid && !forzar) return;
    if (rg.quitarPc) { rg.quitarPc(); rg.quitarPc = null; }
    rg.pid = pid;
    rg.pc = {};
    if (!pid) return;
    const d = nube.d;
    rg.quitarPc = d.onValue(d.query(d.ref(nube.db, `pixeles/${pid}/registro`), d.limitToLast(MAX)), (s) => { rg.pc = s.val() || {}; pintar(); },
      (e) => { console.warn("registro del PC:", e); rg.pc = {}; pintar(); });     // un PC sin la regla nueva: solo el de la cuenta
  }

  // Se guardan las ultimas MAX: lo de antes se borra (una vez por sesion)
  async function podar() {
    if (rg.podado || !rg.cuenta) return;
    const ids = Object.keys(rg.cuenta).sort();
    if (ids.length < MAX) return;
    rg.podado = true;
    try {
      const d = nube.d, viejas = await d.get(d.query(refCuenta(), d.orderByKey(), d.endBefore(ids[0]), d.limitToFirst(500)));
      const borrar = {};
      viejas.forEach((s) => { borrar[s.key] = null; });
      if (Object.keys(borrar).length) await d.update(refCuenta(), borrar);
    } catch (e) { console.warn("registro: podar", e); }
  }

  // ------------------------------------------------------------------ pantalla
  function pintar() {
    if (!document.getElementById("v-registro")) return;
    $("#tab-registro").hidden = !nube.usuario;
    if (!nube.usuario) return;
    seguirPc(false);
    const todo = rg.cuenta === null ? null : juntar(rg.cuenta, rg.pc);
    $("#rg-cuantos").textContent = todo ? (todo.length === 1 ? "1 acción" : `${todo.length} acciones`) : "…";
    const cuenta = (g) => (todo || []).filter((x) => g === "todo" || x.grupo === g).length;
    const filtros = FILTROS.map(([g, n]) => `<button type="button" data-rg-filtro="${g}" class="${rg.filtro === g ? "activo" : ""}" aria-pressed="${rg.filtro === g}">${n}<small>${cuenta(g)}</small></button>`).join("");
    const vis = (todo || []).filter((x) => rg.filtro === "todo" || x.grupo === rg.filtro);
    let h;
    if (todo === null) h = '<div class="vacio">Cargando…</div>';
    else if (!todo.length) h = '<div class="vacio">Todavía no hay nada. Aquí verás cada correo que Píxel envíe, cada evento que cree o borre, los WhatsApp, las órdenes a tus aparatos y los recordatorios, con su hora.</div>';
    else if (!vis.length) h = '<div class="vacio">Nada de este tipo.</div>';
    else {
      let anterior = "";
      h = vis.map((x) => {
        const d = dia(x.t), cab = d !== anterior ? `<h3 class="rg-dia">${esc(d)}</h3>` : "";
        anterior = d;
        return cab + `<div class="rg-fila g-${esc(x.grupo)}">
          <span class="rg-hora">${esc(hora(x.t))}</span>
          <div class="txt"><b>${esc(x.texto)}</b>
            <small><span class="rg-tipo">${esc(ETIQUETA[x.grupo])}</span> · ${esc(DESDE[x.aparato] || (x.origen === "pc" ? DESDE.PC : x.aparato || "Esta cuenta"))}</small>
            ${x.detalle ? `<details><summary>Ver detalle</summary><pre>${esc(x.detalle)}</pre></details>` : ""}</div></div>`;
      }).join("");
    }
    if (filtros + h !== rg.pintado) { $("#rg-filtros").innerHTML = filtros; $("#rg-lista").innerHTML = h; rg.pintado = filtros + h; }
    $("#rg-borrar").hidden = !rg.cuenta || !Object.keys(rg.cuenta).length;
    const e = $("#rg-estado");
    e.textContent = rg.aviso;
  }

  function montar() {
    if (!document.getElementById("v-registro")) return;
    $("#rg-filtros").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rg-filtro]");
      if (b) { rg.filtro = b.dataset.rgFiltro; pintar(); }
    });
    $("#rg-borrar").addEventListener("click", async () => {
      if (!confirm("¿Borrar el registro de esta cuenta? Lo que anotó el PC se queda en el PC.")) return;
      try { await A.nucleo.conTiempo(nube.d.remove(refCuenta()), 8000); rg.aviso = "Borré el registro de esta cuenta."; }
      catch (err) { rg.aviso = "No pude borrarlo: " + (err.code || err.message); }
      clearTimeout(rg.reloj);
      rg.reloj = setTimeout(() => { rg.aviso = ""; pintar(); }, 6000);
      pintar();
    });
    setInterval(() => { if (nube.usuario && nube.pid !== rg.pid) pintar(); }, 2000);   // otro Pixel del PC elegido
  }

  A.modulo({nombre: "registro", montar, alUsuario, pintar});
  window.PixelRegistro = {texto};
})();
