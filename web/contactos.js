/* 2.0.0 - Contactos (pedido del usuario el 10 nov: "estoy viendo que se guarda un registro: crea una opción
   que se llame Contactos con el nombre de la persona, el celular y el correo").
   - usuarios/<uid>/contactos/<id> = {nombre, telefono (solo cifras, con indicativo), correo, actualizado}.
   - La primera vez se pasan solas las personas de la memoria (notas tipo persona) que tienen numero o correo
     (preferencias/contactos_importados queda en true para no volver a hacerlo).
   - WhatsApp (whatsapp.js) y Gmail (google.js) buscan aqui primero; un numero nuevo dicho por voz se guarda
     aqui. Herramientas para Gemini: guardar_contacto y ver_contactos.
   Al cargarse no toca la pagina: las funciones de texto (PixelContactos.texto) se prueban en Node. */
"use strict";
(function () {
  const MAX = {nombre: 60, correo: 120};

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  const plano = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const RE_CORREO = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
  const correoDe = (t) => { const m = RE_CORREO.exec(String(t || "")); return m ? m[0].toLowerCase() : ""; };
  const W = () => (typeof window !== "undefined" && window.PixelWhatsapp) || null;
  // el numero con indicativo, solo cifras (lo mismo que whatsapp.js)
  function telefono(t, pais) {
    if (W()) return W().texto.normalizar(t, pais || W().PAIS);
    let s = String(t || "").trim();
    const mas = s.startsWith("+");
    s = s.replace(/\D/g, "");
    if (!s) return "";
    if (s.startsWith("00")) return s.length >= 10 && s.length <= 17 ? s.slice(2) : "";
    if (mas) return s.length >= 8 && s.length <= 15 ? s : "";
    if (s.length === 10) return (pais || "57") + s;
    return s.length >= 11 && s.length <= 15 ? s : "";
  }
  function formato(n) {
    const s = String(n || "");
    if (/^57\d{10}$/.test(s)) return `+57 ${s.slice(2, 5)} ${s.slice(5, 8)} ${s.slice(8)}`;
    return s ? "+" + s : "";
  }
  const numeroDeTexto = (t) => (W() ? W().texto.numeroDe(t) : ((/(\+?\d[\d\s().-]{6,18}\d)/.exec(String(t || "")) || [])[1] || ""));
  const iniciales = (n) => (String(n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("") || "?").toUpperCase();

  // Que tanto se parece lo que se dijo a un nombre (0 a 1): palabras completas, sin tildes
  function parecido(q, nombre) {
    const a = plano(q).replace(/^(a|al|la|el|mi|mis)\s+/, "").split(/\s+/).filter(Boolean), b = plano(nombre).split(/\s+/);
    if (!a.length) return 0;
    if (plano(q) === plano(nombre)) return 1;
    const hay = a.filter((w) => b.some((x) => x === w || (w.length >= 4 && x.startsWith(w)))).length;
    return hay / Math.max(a.length, 1) * (hay === b.length ? 1 : 0.9);
  }
  function buscar(lista, q, campo) {
    let mejor = null, nota = 0;
    for (const c of lista || []) {
      if (campo && !c[campo]) continue;
      const p = parecido(q, c.nombre);
      if (p > nota) { mejor = c; nota = p; }
    }
    return nota >= 0.6 ? mejor : null;
  }
  // Todos los contactos que encajan con el nombre dicho, del mejor al peor (google.js y whatsapp.js
  // miran si los dos primeros empatan, para preguntar a cual en vez de adivinar)
  function candidatosDe(lista, q, campo) {
    return (lista || []).filter((c) => !campo || c[campo])
      .map((c) => ({nombre: c.nombre, correo: c.correo, telefono: c.telefono, score: parecido(q, c.nombre)}))
      .filter((c) => c.score >= 0.6).sort((a, b) => b.score - a.score);
  }
  // Las personas de la memoria con numero o correo -> contactos que faltan (por nombre)
  function desdeNotas(notas, contactos) {
    const ya = new Set((contactos || []).map((c) => plano(c.nombre)));
    const out = [];
    for (const n of notas || []) {
      if (n.tipo !== "persona" || !n.titulo) continue;
      const nombre = String(n.titulo).replace(/^(contacto|correo|numero|número)( de)?\s+/i, "").trim().slice(0, MAX.nombre);
      const tel = telefono(numeroDeTexto(n.texto)), correo = correoDe(n.texto);
      if (!nombre || (!tel && !correo) || ya.has(plano(nombre))) continue;
      ya.add(plano(nombre));
      out.push({nombre, telefono: tel, correo});
    }
    return out;
  }
  function limpio(c) {
    const nombre = String(c.nombre || "").replace(/\s+/g, " ").trim().slice(0, MAX.nombre);
    const tel = c.telefono ? telefono(c.telefono) : "", correo = c.correo ? correoDe(c.correo) : "";
    return {nombre, telefono: tel, correo};
  }

  const texto = {telefono, formato, parecido, buscar, candidatosDe, desdeNotas, limpio, correoDe, iniciales};
  if (typeof window === "undefined" || !window.Agente) {
    if (typeof module !== "undefined") module.exports = {texto};
    return;
  }

  // ------------------------------------------------------------------ la cuenta (Firebase)
  const A = window.Agente, N = A.nucleo;
  const ct = {lista: null, quitar: null, editando: "", filtro: "", pintado: "", importando: false, aviso: ""};
  const ref = (x) => nube.d.ref(nube.db, `usuarios/${nube.uid}/` + x);

  function alUsuario(u) {
    if (ct.quitar) { ct.quitar(); ct.quitar = null; }
    Object.assign(ct, {lista: null, editando: "", aviso: ""});
    pintar();
    if (!u) return;
    ct.quitar = nube.d.onValue(ref("contactos"), (s) => {
      const v = s.val() || {};
      ct.lista = Object.entries(v).filter(([, c]) => c && typeof c.nombre === "string")
        .map(([id, c]) => ({id, nombre: c.nombre, telefono: c.telefono || "", correo: c.correo || ""}))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      pintar();
      importar();
    }, (e) => { console.warn("contactos:", e); ct.lista = []; pintar(); });
  }

  // Una sola vez por cuenta: las personas de la memoria con numero o correo
  async function importar() {
    if (ct.importando || !ct.lista || !window.Cerebro || !window.Cerebro.notas) return;
    ct.importando = true;
    try {
      const hecho = await nube.d.get(ref("preferencias/contactos_importados"));
      if (hecho.val() === true) return;
      const notas = window.Cerebro.notas() || [];
      if (!notas.length) {                     // el cerebro aun no cargo (o no tiene notas): se mira unas veces
        ct.importando = false;
        if ((ct.intentos = (ct.intentos || 0) + 1) < 5) setTimeout(importar, 4000);
        return;
      }
      for (const c of desdeNotas(notas, ct.lista)) await guardar(c);
      await nube.d.set(ref("preferencias/contactos_importados"), true);
    } catch (e) { console.warn("contactos: importar", e); }
    ct.importando = false;
  }

  // Crea o cambia (si hay id, o si ya existe alguien con ese nombre). Devuelve el contacto guardado.
  async function guardar(c, id) {
    const x = limpio(c);
    if (!x.nombre) throw new Error("Falta el nombre.");
    if (!x.telefono && !x.correo) throw new Error("Pon al menos el celular o el correo.");
    if (c.telefono && !x.telefono) throw new Error("Ese celular no parece válido.");
    if (c.correo && !x.correo) throw new Error("Ese correo no parece válido.");
    if (!id) { const ya = (ct.lista || []).find((y) => plano(y.nombre) === plano(x.nombre)); if (ya) { id = ya.id; x.telefono = x.telefono || ya.telefono; x.correo = x.correo || ya.correo; } }
    const r = id ? ref("contactos/" + id) : nube.d.push(ref("contactos"));
    await N.conTiempo(nube.d.set(r, Object.assign({}, x, {actualizado: nube.d.serverTimestamp()})), 8000);
    return Object.assign({id: r.key}, x);
  }

  // Para whatsapp.js y google.js
  const conTelefono = (q) => buscar(ct.lista, q, "telefono");
  const conCorreo = (q) => buscar(ct.lista, q, "correo");
  // Espera a que llegue la lista de Firebase (al entrar tarda); a los 6 s sigue sin ella
  const esperar = () => new Promise((ok) => {
    const t0 = Date.now();
    const mira = () => (ct.lista || Date.now() - t0 > 6000) ? ok() : setTimeout(mira, 100);
    mira();
  });
  const candidatos = (q, campo) => candidatosDe(ct.lista, q, campo);

  // ------------------------------------------------------------------ herramientas (Gemini)
  const herramientas = () => [
    {name: "guardar_contacto", description: "Guarda o cambia un contacto del usuario: nombre con su celular (WhatsApp) y/o su correo. Úsala cuando diga el número o el correo de alguien.",
      parameters: {type: "object", properties: {
        nombre: {type: "string", description: "El nombre de la persona."},
        telefono: {type: "string", description: "Su celular, como lo dijo (con o sin indicativo)."},
        correo: {type: "string", description: "Su correo."}},
      required: ["nombre"]}},
    {name: "ver_contactos", description: "Lista los contactos guardados del usuario (nombre, celular y correo), o busca uno.",
      parameters: {type: "object", properties: {nombre: {type: "string", description: "Solo si pregunta por una persona."}}}},
  ];
  async function ejecutar(nombre, a) {
    if (nombre === "guardar_contacto") {
      try {
        const c = await guardar({nombre: a.nombre, telefono: a.telefono || "", correo: a.correo || ""});
        return `Listo, guardé a ${c.nombre} en tus contactos${c.telefono ? " con el " + formato(c.telefono) : ""}${c.correo ? (c.telefono ? " y" : " con") + " el correo " + c.correo : ""}.`;
      } catch (e) { return "No pude guardarlo: " + e.message; }
    }
    if (nombre === "ver_contactos") {
      const l = ct.lista || [];
      const sel = a.nombre ? l.filter((c) => parecido(a.nombre, c.nombre) >= 0.6) : l;
      return {respuesta: {contactos: sel.slice(0, 30).map((c) => ({nombre: c.nombre, celular: formato(c.telefono), correo: c.correo})), total: l.length}};
    }
    return undefined;
  }
  const capacidad = () => "- Guardar y consultar los contactos del usuario (nombre, celular y correo).";

  // ------------------------------------------------------------------ pantalla
  function pintar() {
    if (!document.getElementById("v-contactos")) return;
    $("#tab-contactos").hidden = !nube.usuario;
    if (!nube.usuario) return;
    const l = ct.lista;
    $("#ct-cuantos").textContent = l ? `${l.length} contacto${l.length === 1 ? "" : "s"}` : "…";
    const q = plano(ct.filtro), qd = ct.filtro.replace(/\D/g, "");
    const vis = (l || []).filter((c) => !q || plano(c.nombre).includes(q) || plano(c.correo).includes(q) || (qd.length >= 3 && c.telefono.includes(qd)));
    const h = l === null ? '<div class="vacio">Cargando…</div>'
      : !l.length ? '<div class="vacio">Todavía no tienes contactos. Agrega uno aquí o dile a Píxel: «guarda el número de Ana: 300 123 4567».</div>'
      : !vis.length ? '<div class="vacio">Nadie coincide con esa búsqueda.</div>'
      : vis.map((c) => `<div class="contacto${ct.editando === c.id ? " editando" : ""}">
          <span class="avatar">${esc(iniciales(c.nombre))}</span>
          <div class="txt"><b>${esc(c.nombre)}</b>
            ${c.telefono ? `<a href="https://wa.me/${esc(c.telefono)}" target="_blank" rel="noopener">${esc(formato(c.telefono))}</a>` : '<small class="falta">Sin celular</small>'}
            ${c.correo ? `<a href="mailto:${esc(c.correo)}">${esc(c.correo)}</a>` : '<small class="falta">Sin correo</small>'}</div>
          <div class="botones"><button class="btn" type="button" data-editar="${esc(c.id)}">Editar</button>
            <button class="btn peligro" type="button" data-borrar="${esc(c.id)}" aria-label="Borrar a ${esc(c.nombre)}">Borrar</button></div></div>`).join("");
    if (h !== ct.pintado) { $("#ct-lista").innerHTML = h; ct.pintado = h; }
    const e = $("#ct-estado");
    e.textContent = ct.aviso;
    e.className = "nota" + (ct.aviso ? (ct.avisoMal ? " mal" : " ok") : "");
  }

  function avisar(t, mal) {
    ct.aviso = t;
    ct.avisoMal = !!mal;
    clearTimeout(ct.reloj);
    if (!mal) ct.reloj = setTimeout(() => { ct.aviso = ""; pintar(); }, 6000);
    pintar();
  }

  function editar(id) {
    const c = (ct.lista || []).find((x) => x.id === id);
    ct.editando = c ? id : "";
    $("#ct-nombre").value = c ? c.nombre : "";
    $("#ct-telefono").value = c ? formato(c.telefono) : "";
    $("#ct-correo").value = c ? c.correo : "";
    $("#ct-titulo").textContent = c ? `Editar a ${c.nombre}` : "Agregar contacto";
    $("#ct-cancelar").hidden = !c;
    ct.aviso = "";
    pintar();
    if (c) { $("#f-contacto-app").scrollIntoView({behavior: "smooth", block: "start"}); $("#ct-nombre").focus(); }
  }

  function montar() {
    if (!document.getElementById("v-contactos")) return;
    $("#ct-google").addEventListener("click", async () => {
      const b = $("#ct-google"), est = $("#ct-google-estado");
      b.disabled = true; est.textContent = "Trayendo tus contactos de Google…";
      try {
        const r = await window.PixelGoogle.traerContactos();
        est.textContent = `✓ Listo: guardé ${r.guardados} de ${r.total} contactos de Google.`;
      } catch (e) { est.textContent = "No pude traerlos: " + ((e && e.message) || e); }
      finally { b.disabled = false; }
    });
    $("#f-contacto-app").addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = $("#ct-guardar");
      b.disabled = true;
      try {
        const c = await guardar({nombre: $("#ct-nombre").value, telefono: $("#ct-telefono").value, correo: $("#ct-correo").value}, ct.editando || undefined);
        const era = ct.editando;
        editar("");
        avisar(era ? `✓ Listo, guardé los cambios de ${c.nombre}.` : `✓ Listo, guardé a ${c.nombre}.`);
      } catch (err) { avisar(err.message || String(err), true); }
      b.disabled = false;
    });
    $("#ct-cancelar").addEventListener("click", () => editar(""));
    $("#ct-buscar").addEventListener("input", (e) => { ct.filtro = e.target.value; pintar(); });
    $("#ct-lista").addEventListener("click", async (e) => {
      const ed = e.target.closest("[data-editar]"), bo = e.target.closest("[data-borrar]");
      if (ed) editar(ed.dataset.editar);
      if (bo) {
        const c = (ct.lista || []).find((x) => x.id === bo.dataset.borrar);
        if (!c || !confirm(`¿Borrar a ${c.nombre} de tus contactos?`)) return;
        try { await N.conTiempo(nube.d.remove(ref("contactos/" + c.id)), 8000); if (ct.editando === c.id) editar(""); avisar(`Borré a ${c.nombre}.`); }
        catch (err) { avisar("No pude borrarlo: " + (err.code || err.message), true); }
      }
    });
  }

  A.modulo({nombre: "contactos", montar, alUsuario, pintar, herramientas, ejecutar, capacidad});
  window.PixelContactos = {texto, lista: () => ct.lista || [], conTelefono, conCorreo, guardar, esperar, candidatos};
})();
