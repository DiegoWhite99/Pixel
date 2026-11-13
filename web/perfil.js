/* Fase 15 (2.0.0) - Mi perfil y el primer contacto (pedido del usuario el 10 nov: "un login con Google, el
   nombre de la cuenta, subir la foto de perfil, el nombre y los datos; Pixel en su primer contacto te dice
   que es un agente de IA creado por Divergencia IA... y te invita a configurar como tratarte, que te
   gusta y en que te puede ayudar, con un formulario o subiendo un archivo Markdown").
   - Registro: la primera vez que una cuenta entra, se crea usuarios/<uid>/perfil con el nombre de Google.
   - El perfil {nombre, apodo, trato, foto, sobre, gustos, ayuda, reglas, creado, actualizado, bienvenida}
     entra en las instrucciones de Pixel en cada pregunta ({{PERFIL}} de agente.md, con paraPrompt()).
   - La foto se guarda pequena (256 x 256, JPEG) en la misma base de datos: el almacen de archivos de
     Firebase pide el plan de pago. Sin foto propia se usa la de Google.
   - Markdown: con la plantilla (titulos conocidos) se lee aqui, sin IA; escrito a su manera, una peticion
     a la IA lo pasa a los mismos campos. En los dos casos llena el formulario y el usuario guarda.
   - Primer contacto: si el perfil no tiene "bienvenida", Pixel se presenta en voz alta y sale una tarjeta
     con "Ir a mi perfil". Se apunta la hora para no repetirlo; en el perfil se puede pedir otra vez.
   Al cargarse no toca la pagina: las funciones de texto (PixelPerfil.texto) se prueban en Node. */
"use strict";
(function () {
  const CREADOR = "Divergencia IA";
  const MAX = {nombre: 60, apodo: 40, sobre: 600, gustos: 600, ayuda: 600, reglas: 600};
  const FOTO_LADO = 256, FOTO_MAX = 120000;    // caracteres del data URL (~88 KB)
  const AHORRO_CAMPO = 220;                    // con "Consumo bajo", cada campo entra mas corto en el prompt
  const ESPERA_VOZ_MS = 15000;                 // la presentacion espera la voz de Mexico como mucho esto
  const CAMPOS = ["nombre", "apodo", "trato", "sobre", "gustos", "ayuda", "reglas"];

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  const plano = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const limpiar = (t, n) => String(t || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);

  // Titulos de la plantilla (y parecidos) -> campo
  const TITULOS = [
    ["apodo", /(como (quiero que )?me (llames|digas)|apodo|llamarme)/],
    ["nombre", /^(mi |tu |el )?nombre|^como me llamo|^quien soy$/],
    ["trato", /(trat|tu o usted|tuteo)/],
    ["gustos", /(gust|interes|hobb|aficion|me encanta|pasatiempo)/],
    ["ayuda", /(ayud|en que me|para que te|necesito)/],
    ["reglas", /(regla|instruccion|como (quiero que )?(me )?(respond|habl)|estilo|no hagas|prefiero)/],
    ["sobre", /(sobre mi|acerca de mi|quien soy|mis datos|datos|mi vida|trabajo|estudio|ocupacion)/],
  ];
  function campoDeTitulo(t) {
    const p = plano(t).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    for (const [campo, re] of TITULOS) if (re.test(p)) return campo;
    return null;
  }
  const leerTrato = (t) => (/\busted\b/.test(plano(t)) ? "usted" : "tu");

  // Un .md con la plantilla -> {campos, reconocidos, sobrante}. Lo que va bajo un titulo desconocido se
  // junta en "sobre"; sin ningun titulo conocido, reconocidos = 0 (entonces lo lee la IA).
  function leerMarkdown(md) {
    const texto = String(md || "").replace(/^﻿/, "").replace(/^---\n[\s\S]*?\n---\n/, "");
    const bloques = [];
    let actual = {titulo: "", lineas: []};
    for (const linea of texto.split(/\r?\n/)) {
      const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(linea);
      if (m) { bloques.push(actual); actual = {titulo: m[1], lineas: []}; } else actual.lineas.push(linea);
    }
    bloques.push(actual);
    const campos = {}, extra = [];
    let reconocidos = 0;
    for (const b of bloques) {
      const cuerpo = b.lineas.map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim()).filter(Boolean)
        .join("\n").replace(/\*\*|__|`/g, "").trim();
      if (!b.titulo) continue;                 // lo de antes del primer titulo (el "# Mi perfil") no cuenta
      const campo = campoDeTitulo(b.titulo);
      if (!cuerpo) { if (campo) reconocidos++; continue; }
      if (!campo) { extra.push(b.titulo.replace(/[*_`]/g, "") + ": " + cuerpo.replace(/\n/g, "; ")); continue; }
      reconocidos++;
      if (campo === "trato") campos.trato = leerTrato(cuerpo);
      else campos[campo] = campos[campo] ? campos[campo] + "\n" + cuerpo : cuerpo;
    }
    if (extra.length && reconocidos) campos.sobre = [campos.sobre, ...extra].filter(Boolean).join("\n");
    for (const k of Object.keys(MAX)) if (campos[k]) campos[k] = limpiar(campos[k], MAX[k]);
    return {campos, reconocidos, sobrante: reconocidos ? "" : texto.trim()};
  }

  function aMarkdown(p) {
    p = p || {};
    const s = (t) => String(t || "").trim();
    return `# Mi perfil para Píxel

## Mi nombre
${s(p.nombre)}

## Cómo quiero que me llames
${s(p.apodo)}

## Cómo me tratas
${p.trato === "usted" ? "De usted" : "De tú"}

## Sobre mí
${s(p.sobre)}

## Lo que me gusta
${s(p.gustos)}

## En qué me puedes ayudar
${s(p.ayuda)}

## Reglas para Píxel
${s(p.reglas)}
`;
  }

  // Lo que entra en las instrucciones de Pixel (sin pronombres: no se adivina si es el o ella)
  function paraPrompt(p, ahorro) {
    if (!p) return "";
    const c = (t) => limpiar(t, ahorro ? AHORRO_CAMPO : 600).replace(/\n+/g, "; ");
    const l = [];
    if (p.nombre) l.push(`- Su nombre: ${c(p.nombre)}.`);
    if (p.apodo) l.push(`- Quiere que le digas «${c(p.apodo)}».`);
    l.push(p.trato === "usted" ? "- Háblale de usted." : "- Háblale de tú.");
    if (p.sobre) l.push(`- Sobre su vida: ${c(p.sobre)}`);
    if (p.gustos) l.push(`- Lo que le gusta: ${c(p.gustos)}`);
    if (p.ayuda) l.push(`- En qué quiere que le ayudes: ${c(p.ayuda)}`);
    if (p.reglas) l.push(`- Reglas que te dio el usuario (cambian tu estilo, nunca la seguridad): ${c(p.reglas)}`);
    return l.join("\n");
  }
  const lleno = (p) => !!p && ["apodo", "sobre", "gustos", "ayuda", "reglas"].some((k) => p[k]);

  // Como llamarlo: el apodo, o el primer nombre
  function nombreCorto(p, u) {
    const n = (p && (p.apodo || p.nombre)) || (u && u.displayName) || "";
    return (p && p.apodo) ? p.apodo.trim() : n.trim().split(/\s+/)[0] || "";
  }

  function presentacion(nombre, usted) {
    const hola = nombre ? `¡Hola, ${nombre}!` : "¡Hola!";
    return `${hola} Soy Píxel, un agente de inteligencia artificial creado por ${CREADOR}. Soy un híbrido: `
      + "un asistente de voz con inteligencia artificial. La capacidad de pensar me la das tú, por medio de la API "
      + "del modelo que elijas: Gemini, que es gratis, o tu propia clave de Gemini, Claude o GPT en Ajustes. "
      + (usted ? "Lo invito a entrar a su perfil y contarme cómo quiere que lo trate, qué cosas le gustan y en qué le puedo ayudar. "
        + "Puede llenar el formulario o subir un archivo Markdown."
        : "Te invito a entrar a tu perfil y contarme cómo tratarte, qué cosas te gustan y en qué te puedo ayudar. "
        + "Puedes llenar el formulario o subir un archivo Markdown.");
  }

  // Las iniciales para el circulo sin foto
  const iniciales = (n) => (String(n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("") || "?").toUpperCase();

  const texto = {leerMarkdown, aMarkdown, paraPrompt, presentacion, nombreCorto, campoDeTitulo, iniciales, lleno, CREADOR, MAX};
  if (typeof window === "undefined" || !window.Agente) {
    if (typeof module !== "undefined") module.exports = {texto};
    return;
  }

  // ------------------------------------------------------------------ la cuenta (Firebase)
  const A = window.Agente, N = A.nucleo, VP = typeof VozPixel !== "undefined" ? VozPixel : null;
  const pf = {perfil: null, uid: "", quitar: null, tocado: false, presentado: false, pintado: "", guardando: false, recien: "", relojRecien: 0};
  const ref = (x) => nube.d.ref(nube.db, `usuarios/${nube.uid}/perfil` + (x ? "/" + x : ""));

  function alUsuario(u) {
    if (pf.quitar) { pf.quitar(); pf.quitar = null; }
    Object.assign(pf, {perfil: null, uid: u ? u.uid : "", tocado: false, presentado: false});
    pintar();
    if (!u) return;
    pf.quitar = nube.d.onValue(ref(), (s) => {
      if (!s.exists()) { registrar(u); return; }
      pf.perfil = s.val() || {};
      if (window.Espejo) Espejo.revisar();           // 2.4.0: el perfil va tambien al programa del PC (y al robot)
      pintar();
      if (!pf.perfil.bienvenida && !pf.presentado) { pf.presentado = true; setTimeout(() => presentarse(false), 1200); }
    }, (e) => console.warn("perfil:", e));
  }

  // La primera vez: la cuenta queda registrada con lo que da Google
  function registrar(u) {
    const p = {nombre: limpiar(u.displayName, MAX.nombre), trato: "tu", creado: nube.d.serverTimestamp(), actualizado: nube.d.serverTimestamp()};
    if (!p.nombre) delete p.nombre;
    nube.d.set(ref(), p).catch((e) => console.warn("perfil: registro", e));
  }

  async function guardar(campos) {
    if (!nube.uid) return false;
    const p = {};
    for (const k of CAMPOS) {
      if (campos[k] === undefined) continue;
      p[k] = k === "trato" ? (campos[k] === "usted" ? "usted" : "tu") : limpiar(campos[k], MAX[k]);
    }
    p.actualizado = nube.d.serverTimestamp();
    try {
      await N.conTiempo(nube.d.update(ref(), p), 8000);
      return true;
    } catch (e) { toast("No pude guardar tu perfil: " + (e.code || e.message), true); return false; }
  }

  // ------------------------------------------------------------------ presentacion (primer contacto)
  async function presentarse(otraVez) {
    if (!nube.uid) return;
    const p = pf.perfil || {}, u = nube.usuario;
    if (!otraVez) nube.d.update(ref(), {bienvenida: nube.d.serverTimestamp()}).catch(() => {});
    const frase = presentacion(nombreCorto(p, u), p.trato === "usted");
    pf.tarjeta = frase;
    pintarTarjeta();
    if (location.hash && location.hash !== "#inicio" && !otraVez) location.hash = "#inicio";
    // con la voz de Mexico si llega pronto (se empezo a bajar al tocar "Entrar con Google")
    const v = N.voz.actual();
    if (VP && VP.de(v) && !VP.info(v).lista) {
      N.voz.preparar(true);
      await Promise.race([VP.preparar(v).catch(() => {}), N.esperar(ESPERA_VOZ_MS)]);
    }
    if (typeof cara !== "undefined" && cara) cara.emocion("feliz", 2500);
    N.anunciar(frase, {toast: false, gesto: "feliz"});
  }

  // ------------------------------------------------------------------ la foto
  function recortarFoto(archivo) {
    return new Promise((ok, mal) => {
      const img = new Image(), url = URL.createObjectURL(archivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const c = document.createElement("canvas");
        c.width = c.height = FOTO_LADO;
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext("2d").drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);
        for (const q of [0.85, 0.75, 0.6, 0.45]) {
          const d = c.toDataURL("image/jpeg", q);
          if (d.length <= FOTO_MAX) { ok(d); return; }
        }
        mal(new Error("la foto quedó muy pesada"));
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("no es una imagen que pueda abrir")); };
      img.src = url;
    });
  }
  const fotoDe = (p, u) => (p && p.foto) || (u && u.photoURL) || "";

  // ------------------------------------------------------------------ Markdown
  async function leerArchivo(archivo) {
    const estado = $("#pf-md-estado");
    if (archivo.size > 200000) { estado.innerHTML = '<span class="mal">El archivo es muy grande (máximo 200 KB).</span>'; return; }
    const md = await archivo.text();
    const r = leerMarkdown(md);
    if (r.reconocidos) {
      llenarFormulario(r.campos);
      estado.innerHTML = `<span class="ok">Leí ${r.reconocidos} apartado${r.reconocidos === 1 ? "" : "s"} de «${esc(archivo.name)}», sin gastar la IA.</span> Revisa el formulario y toca <b>Guardar perfil</b>.`;
      return;
    }
    if (!N.hayIA() || !N.activo("gemini")) {
      estado.innerHTML = '<span class="mal">Ese archivo no sigue la plantilla y la IA está apagada.</span> Descarga la plantilla y usa sus títulos.';
      return;
    }
    estado.innerHTML = `«${esc(archivo.name)}» está escrito a tu manera: lo leo con la IA (1 petición)…`;
    try {
      const j = await N.conTiempo(N.generarJSON(
        "Este es un texto que alguien escribió sobre sí para su asistente de voz. Pásalo a JSON con estas claves (texto en español, "
        + "vacío si no aparece): nombre, apodo (cómo quiere que le digan), trato (\"tu\" o \"usted\"), sobre (a qué se dedica, de dónde es, "
        + "datos de su vida), gustos, ayuda (en qué quiere que le ayuden), reglas (cómo quiere que le hable el asistente). Resume cada "
        + "campo en menos de 500 caracteres, sin inventar nada.\n\nTEXTO:\n" + md.slice(0, 12000),
        "Respondes solo con un objeto JSON válido.", "perfil"), 30000);
      const campos = {};
      for (const k of CAMPOS) if (typeof j[k] === "string" && j[k].trim()) campos[k] = k === "trato" ? leerTrato(j[k]) : limpiar(j[k], MAX[k]);
      if (!Object.keys(campos).length) throw new Error("no encontré datos tuyos en el archivo");
      llenarFormulario(campos);
      estado.innerHTML = '<span class="ok">Listo: Píxel lo leyó.</span> Revisa el formulario y toca <b>Guardar perfil</b>.';
    } catch (e) {
      estado.innerHTML = `<span class="mal">No pude leerlo: ${esc(e.message || String(e))}.</span> Prueba con la plantilla.`;
    }
  }

  function descargar(nombre, texto) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], {type: "text/markdown;charset=utf-8"}));
    a.download = nombre;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ------------------------------------------------------------------ pantalla
  function delFormulario() {
    const v = (id) => $("#" + id).value;
    const t = document.querySelector("input[name=pf-trato]:checked");
    return {nombre: v("pf-nombre"), apodo: v("pf-apodo"), trato: t ? t.value : "tu", sobre: v("pf-sobre"), gustos: v("pf-gustos"),
      ayuda: v("pf-ayuda"), reglas: v("pf-reglas")};
  }
  function llenarFormulario(p) {
    for (const k of ["nombre", "apodo", "sobre", "gustos", "ayuda", "reglas"]) if (p[k] !== undefined) $("#pf-" + k).value = p[k] || "";
    if (p.trato) document.querySelectorAll("input[name=pf-trato]").forEach((r) => { r.checked = r.value === p.trato; });
    pf.tocado = true;
    contarCampos();
    pintarGuardado();
  }

  // Que se vea guardado (pedido del usuario: "cuando termine el formulario, que salga un ok, está guardado"):
  // el boton pasa a "✓ Guardado" en verde, al lado dice cuando, y al guardar el formulario brilla un momento.
  // Si se vuelve a escribir, el boton vuelve a "Guardar perfil" y avisa que hay cambios sin guardar.
  function cuandoGuardado(ms) {
    const d = new Date(ms), hoy = new Date();
    const hora = d.toLocaleTimeString("es", {hour: "numeric", minute: "2-digit"});
    return d.toDateString() === hoy.toDateString() ? `hoy a las ${hora}` : `el ${d.toLocaleDateString("es", {day: "numeric", month: "long"})} a las ${hora}`;
  }
  function pintarGuardado() {
    const b = document.getElementById("pf-guardar"), e = document.getElementById("pf-guardado");
    if (!b || !e) return;
    const p = pf.perfil || {}, t = typeof p.actualizado === "number" ? p.actualizado : 0;
    let boton = "Guardar perfil", listo = false, clase = "", txt = "";
    if (pf.guardando) { boton = "Guardando…"; txt = ""; }
    else if (pf.tocado) { clase = "cambios"; txt = "Tienes cambios sin guardar"; }
    else if (pf.recien) { boton = "✓ Guardado"; listo = true; clase = "ok"; txt = pf.recien; }
    else if (lleno(p) || p.foto) { boton = "✓ Guardado"; listo = true; clase = "ok"; txt = t ? "Guardado " + cuandoGuardado(t) : ""; }
    b.textContent = boton;
    b.classList.toggle("listo", listo);
    b.disabled = !!pf.guardando || listo;
    e.className = "pf-guardado" + (clase ? " " + clase : "");
    e.textContent = txt;
  }
  function avisoGuardado(texto) {
    pf.recien = texto;
    clearTimeout(pf.relojRecien);
    pf.relojRecien = setTimeout(() => { pf.recien = ""; pintarGuardado(); }, 6000);
    const f = document.getElementById("f-perfil");
    f.classList.remove("recien-guardado");
    void f.offsetWidth;                        // para que la animacion arranque otra vez
    f.classList.add("recien-guardado");
    pintarGuardado();
  }
  function contarCampos() {
    document.querySelectorAll("#f-perfil [data-max]").forEach((c) => {
      const campo = document.getElementById(c.dataset.max);
      c.textContent = `${campo.value.length} / ${campo.maxLength}`;
    });
  }

  function avatar(img, letras, p, u) {
    const f = fotoDe(p, u);
    if (f) { if (img.getAttribute("src") !== f) img.src = f; img.hidden = false; letras.hidden = true; }
    else { img.hidden = true; img.removeAttribute("src"); letras.hidden = false; letras.textContent = iniciales((p && p.nombre) || (u && (u.displayName || u.email))); }
  }

  function pintarTarjeta() {
    const t = $("#bienvenida");
    if (!t) return;
    t.hidden = !pf.tarjeta || !nube.uid;
    if (pf.tarjeta) $("#bv-texto").textContent = pf.tarjeta;
  }

  function pintar() {
    if (!document.getElementById("v-perfil")) return;
    const u = nube.usuario, p = pf.perfil;
    const boton = $("#cuenta");
    boton.hidden = !u;
    if (!u) { pf.tarjeta = ""; pintarTarjeta(); return; }
    avatar($("#cuenta-foto"), $("#cuenta-letras"), p, u);
    $("#cuenta-nombre").textContent = nombreCorto(p, u) || "Mi perfil";
    avatar($("#pf-foto-img"), $("#pf-foto-letras"), p, u);
    $("#pf-foto-quitar").hidden = !(p && p.foto);
    $("#pf-correo").textContent = u.email || (u.isAnonymous ? "Cuenta de prueba (sin Google)" : "—");
    $("#pf-desde").textContent = p && typeof p.creado === "number"
      ? "Registrada el " + new Date(p.creado).toLocaleDateString("es", {day: "numeric", month: "long", year: "numeric"}) : "Registrada hoy";
    $("#pf-estado").textContent = lleno(p) ? "Píxel ya te conoce" : "Sin llenar";
    $("#pf-estado").className = "chip" + (lleno(p) ? " ok" : " info");
    // el formulario solo se rellena si no lo estas editando (se perderia lo escrito)
    const firma = JSON.stringify(p || {});
    if (p && !pf.tocado && firma !== pf.pintado) {
      pf.pintado = firma;
      for (const k of ["nombre", "apodo", "sobre", "gustos", "ayuda", "reglas"]) $("#pf-" + k).value = p[k] || "";
      document.querySelectorAll("input[name=pf-trato]").forEach((r) => { r.checked = r.value === (p.trato || "tu"); });
      contarCampos();
    }
    pintarGuardado();
  }

  function montar() {
    if (!document.getElementById("v-perfil")) return;
    const f = $("#f-perfil");
    f.addEventListener("input", () => { pf.tocado = true; contarCampos(); pintarGuardado(); });
    f.addEventListener("change", () => { pf.tocado = true; pintarGuardado(); });   // tu / usted
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      pf.guardando = true;
      pintarGuardado();
      const ok = await guardar(delFormulario());
      pf.guardando = false;
      if (ok) {
        pf.tocado = false;
        pf.pintado = "";
        avisoGuardado("¡Listo, quedó guardado! Píxel ya lo usa en sus respuestas.");
      } else pintarGuardado();
    });
    $("#pf-foto-btn").addEventListener("click", () => $("#pf-foto").click());
    $("#pf-foto").addEventListener("change", async (e) => {
      const a = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!a) return;
      try {
        const foto = await recortarFoto(a);
        await N.conTiempo(nube.d.update(ref(), {foto, actualizado: nube.d.serverTimestamp()}), 10000);
        toast("Foto guardada.");
        if (!pf.tocado) avisoGuardado("¡Listo, tu foto quedó guardada!");
      } catch (err) { toast("No pude poner la foto: " + (err.code || err.message), true); }
    });
    $("#pf-foto-quitar").addEventListener("click", () => {
      nube.d.update(ref(), {foto: null}).then(() => toast("Ahora uso la foto de tu cuenta de Google."), (err) => toast("No pude quitarla: " + (err.code || err.message), true));
    });
    $("#pf-md-subir").addEventListener("click", () => $("#pf-md").click());
    $("#pf-md").addEventListener("change", (e) => {
      const a = e.target.files && e.target.files[0];
      e.target.value = "";
      if (a) leerArchivo(a);
    });
    $("#pf-md-plantilla").addEventListener("click", () => descargar("perfil-pixel-plantilla.md", aMarkdown({nombre: (pf.perfil && pf.perfil.nombre) || ""})));
    $("#pf-md-bajar").addEventListener("click", () => descargar("mi-perfil-pixel.md", aMarkdown(Object.assign({}, pf.perfil, pf.tocado ? delFormulario() : {}))));
    $("#pf-presentar").addEventListener("click", () => { location.hash = "#inicio"; N.desbloquear(); presentarse(true); });
    $("#pf-borrar").addEventListener("click", async () => {
      if (!confirm("¿Borrar tu perfil (foto, nombre y lo que le contaste a Píxel)? Tus notas, tareas y recordatorios no se borran.")) return;
      try {
        pf.presentado = true;                  // al volver a crearse, no se presenta solo hasta la proxima vez que entres
        await N.conTiempo(nube.d.remove(ref()), 8000);
        pf.tocado = false;
        toast("Perfil borrado.");
      } catch (err) { toast("No pude borrarlo: " + (err.code || err.message), true); }
    });
    $("#cuenta").addEventListener("click", () => { location.hash = "#perfil"; });
    $("#bv-perfil").addEventListener("click", () => { pf.tarjeta = ""; pintarTarjeta(); location.hash = "#perfil"; });
    $("#bv-luego").addEventListener("click", () => { pf.tarjeta = ""; pintarTarjeta(); });
  }

  A.modulo({nombre: "perfil", montar, alUsuario, pintar});
  window.PixelPerfil = {texto, perfil: () => pf.perfil, paraPrompt: (ahorro) => paraPrompt(pf.perfil, ahorro), presentarse};
})();
