// Fase 15 (12 nov) - La ventana de Pixel en el PC (escritorio.html): la bienvenida (Pixel llega desde el fondo,
// "de atras para adelante", y saluda) y el panel de control todo azul. Pedido del usuario: "no desplegar un
// servidor web, necesito una ventana donde se vea Pixel" y que la visual no sea la de la app de internet.
// Habla solo con el panel local de este PC: GET /api/estado (503 mientras el lanzador prepara a Pixel; el avance
// en /progreso) y POST a las rutas de panel.py. En la ventana de pixel_ventana.py hay ademas window.pywebview.api
// (encender, cerrar); en el navegador no, y esos botones no salen.
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const URL_APP = "https://pixelassitance.web.app";
  const ventana = () => (window.pywebview && window.pywebview.api) || null;
  const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  // El saludo, palabra por palabra como lo pidio el usuario
  const FRASES = [
    [{t: "Hola, soy Píxel,"}],
    [{t: "un agente creado por "}, {t: "Divergency IA", c: "marca-ia"}, {t: "."}],
    [{t: "Bienvenido al panel de control."}],
    [{t: "Aquí puedes vincular tus dispositivos y guardar tus APIs."}],
  ];
  const TITULOS = {inicio: "Inicio", dispositivos: "Dispositivos", apis: "Tus APIs", voz: "Voz"};
  const TIPOS = {luz: "Luz", enchufe: "Enchufe", tv: "Televisor", altavoz: "Altavoz", camara: "Cámara", impresora: "Impresora",
    movil: "Celular", ordenador: "Computador", router: "Router", pixel: "Píxel", otro: "Otro"};
  const ICONOS = {
    movil: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
    robot: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
    luz: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>',
    enchufe: '<svg viewBox="0 0 24 24"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/></svg>',
    tv: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg>',
    altavoz: '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="3"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/></svg>',
    ordenador: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    router: '<svg viewBox="0 0 24 24"><rect x="2" y="13" width="20" height="7" rx="2"/><path d="M6 17h.01M10 17h.01M8 9a6 6 0 0 1 8 0M5 6a10 10 0 0 1 14 0"/></svg>',
    otro: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
  };
  const icono = (tipo) => ICONOS[tipo] || ICONOS.otro;

  // ------------------------------------------------------------------ la figura de Pixel (SVG; p = prefijo de ids)
  function pixelSVG(p) {
    return `<svg viewBox="0 0 200 220" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="${p}c" cx="36%" cy="28%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#dcebff"/><stop offset="1" stop-color="#7fa8e6"/></radialGradient>
    <linearGradient id="${p}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2257"/><stop offset="1" stop-color="#030a1f"/></linearGradient>
    <radialGradient id="${p}o" cx="42%" cy="38%" r="62%"><stop offset="0" stop-color="#f2ffff"/><stop offset=".42" stop-color="#5ee7ff"/><stop offset="1" stop-color="#1479ff"/></radialGradient>
    <radialGradient id="${p}h"><stop offset="0" stop-color="#38bdf8" stop-opacity=".85"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
    <linearGradient id="${p}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient>
  </defs>
  <line x1="100" y1="42" x2="100" y2="18" stroke="#a9c8f5" stroke-width="5" stroke-linecap="round"/>
  <circle class="antena" cx="100" cy="14" r="8.5" fill="url(#${p}o)"/>
  <rect x="12" y="100" width="22" height="46" rx="11" fill="url(#${p}e)"/>
  <rect x="166" y="100" width="22" height="46" rx="11" fill="url(#${p}e)"/>
  <circle cx="100" cy="123" r="82" fill="url(#${p}c)"/>
  <rect x="36" y="90" width="128" height="64" rx="32" fill="url(#${p}v)"/>
  <rect x="50" y="97" width="66" height="7" rx="3.5" fill="#ffffff" opacity=".09"/>
  <circle class="halo" cx="76" cy="122" r="27" fill="url(#${p}h)"/>
  <circle class="halo" cx="124" cy="122" r="27" fill="url(#${p}h)"/>
  <g class="ojo"><circle cx="76" cy="122" r="13.5" fill="url(#${p}o)"/><circle cx="71" cy="117" r="3.6" fill="#fff" opacity=".92"/></g>
  <g class="ojo"><circle cx="124" cy="122" r="13.5" fill="url(#${p}o)"/><circle cx="119" cy="117" r="3.6" fill="#fff" opacity=".92"/></g>
  <rect class="boca" x="84" y="172" width="32" height="6" rx="3" fill="#3b82f6" opacity=".8"/>
</svg>`;
  }
  $("#intro-pixel").innerHTML = pixelSVG("pi");
  $("#avatar").innerHTML = pixelSVG("pa");
  $("#pixel-dormido").innerHTML = pixelSVG("pd");

  // ------------------------------------------------------------------ bienvenida
  function estrellas(lienzo) {
    const ctx = lienzo.getContext("2d");
    const COLORES = ["148,197,255", "94,231,255", "255,255,255", "96,165,250"];
    const lista = [];
    let w = 0, h = 0, vel = 42, meta = 42, vivo = true;
    function tam() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = lienzo.clientWidth; h = lienzo.clientHeight;
      lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function nueva(e, lejos) {
      e.x = (Math.random() - 0.5) * w * 2.2; e.y = (Math.random() - 0.5) * h * 2.2;
      e.z = lejos ? 1000 : 40 + Math.random() * 960; e.pz = e.z;
      e.c = COLORES[(Math.random() * COLORES.length) | 0];
      return e;
    }
    tam();
    addEventListener("resize", tam);
    for (let i = 0; i < 340; i++) lista.push(nueva({}, false));
    function cuadro() {
      if (!vivo) return;
      vel += (meta - vel) * 0.025;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.42, k = 280;
      for (const e of lista) {
        e.pz = e.z; e.z -= vel;
        if (e.z < 2) { nueva(e, true); continue; }
        const x = cx + (e.x / e.z) * k, y = cy + (e.y / e.z) * k;
        const px = cx + (e.x / e.pz) * k, py = cy + (e.y / e.pz) * k;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) { nueva(e, true); continue; }
        const a = Math.min(1, 1.15 - e.z / 1000);
        ctx.strokeStyle = `rgba(${e.c},${a.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.6, a * 2.6);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
      }
      requestAnimationFrame(cuadro);
    }
    requestAnimationFrame(cuadro);
    return {frenar() { meta = 1.6; }, parar() { vivo = false; removeEventListener("resize", tam); }};
  }

  let introAcabada = false, introCielo = null;

  async function escribir(destino, figura) {
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    figura.classList.add("hablando");
    for (const linea of FRASES) {
      if (introAcabada) return;
      const l = document.createElement("span");
      l.className = "linea";
      destino.appendChild(l);
      for (const parte of linea) {
        const s = document.createElement("span");
        if (parte.c) s.className = parte.c;
        l.appendChild(s);
        for (const letra of parte.t) {
          if (introAcabada) return;
          s.textContent += letra;
          l.appendChild(cursor);
          await esperar(letra === "," ? 140 : 24);
        }
      }
      await esperar(260);
    }
    cursor.remove();
    figura.classList.remove("hablando");
  }

  async function intro() {
    const capa = $("#intro"), figura = $("#intro-pixel"), texto = $("#intro-texto"), entrar = $("#intro-entrar");
    $("#intro-saltar").addEventListener("click", terminarIntro);
    entrar.addEventListener("click", terminarIntro);
    addEventListener("keydown", (e) => { if (!introAcabada && (e.key === "Escape" || e.key === "Enter")) { e.preventDefault(); terminarIntro(); } });
    if (reducir) {
      texto.innerHTML = FRASES.map((l) => `<span class="linea">${l.map((p) => p.c ? `<span class="${p.c}">${esc(p.t)}</span>` : esc(p.t)).join("")}</span>`).join("");
      figura.style.cssText = "opacity:1;transform:none;filter:none";
      entrar.classList.add("ver");
      entrar.focus();
      return;
    }
    introCielo = estrellas($("#estrellas"));
    await esperar(150);
    figura.classList.add("llega");                       // de atras para adelante (CSS: zoom-arriba, 2,5 s)
    await esperar(1750);
    if (introAcabada) return;
    capa.classList.add("llego");
    introCielo.frenar();
    await esperar(800);
    if (introAcabada) return;
    figura.classList.add("listo");
    capa.classList.add("calma");
    await escribir(texto, figura);
    if (introAcabada) return;
    entrar.classList.add("ver");
    entrar.focus({preventScroll: true});
    await esperar(4200);
    terminarIntro();
  }

  function terminarIntro() {
    if (introAcabada) return;
    introAcabada = true;
    const capa = $("#intro"), figura = $("#intro-pixel"), avatar = $("#avatar"), app = $("#app");
    document.body.classList.remove("con-intro");
    app.classList.add("entra");
    // Pixel vuela a su sitio en la barra lateral (si se ve)
    const de = figura.getBoundingClientRect(), a = avatar.getBoundingClientRect();
    if (!reducir && de.width > 0 && a.width > 0 && getComputedStyle(figura).opacity > 0.5) {
      const vuela = document.createElement("div");
      vuela.className = "pixel-figura volando";
      vuela.innerHTML = pixelSVG("pv");
      Object.assign(vuela.style, {left: de.left + "px", top: de.top + "px", width: de.width + "px", height: de.height + "px"});
      document.body.appendChild(vuela);
      figura.style.visibility = "hidden";
      avatar.classList.add("oculto");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        Object.assign(vuela.style, {left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px"});
      }));
      setTimeout(() => { vuela.remove(); avatar.classList.remove("oculto"); }, 850);
    }
    capa.classList.add("sale");
    setTimeout(() => { capa.hidden = true; if (introCielo) introCielo.parar(); }, 700);
  }

  // ------------------------------------------------------------------ hablar con el panel local
  async function pedir(ruta, opciones = {}) {
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), opciones.espera || 8000);
    try {
      return await fetch(ruta, Object.assign({cache: "no-store", signal: control.signal}, opciones));
    } finally { clearTimeout(t); }
  }

  let tostada = null;
  function toast(texto, mal = false) {
    const t = $("#toast");
    t.textContent = texto;
    t.classList.toggle("mal", mal);
    t.hidden = false;
    clearTimeout(tostada);
    tostada = setTimeout(() => { t.hidden = true; }, Math.min(9000, 2600 + texto.length * 45));
  }

  async function enviar(ruta, datos = {}, opciones = {}) {
    try {
      const r = await pedir(ruta, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(datos), espera: 60000});
      let d = {};
      try { d = await r.json(); } catch (e) { d = {}; }
      if (!r.ok) {
        toast(d.error || (r.status === 404 ? "Eso no está disponible ahora mismo." : "Algo falló en Píxel."), true);
        return null;
      }
      if (d.mensaje && !opciones.silencio) toast(d.mensaje);
      mirarYa();
      return d;
    } catch (e) {
      toast("Píxel no respondió. ¿Está encendido?", true);
      return null;
    }
  }

  let E = null, modo = "conectando", fallos = 0, reloj = null, apagadoAqui = false;

  async function mirar() {
    clearTimeout(reloj);
    try {
      const r = await pedir("/api/estado", {espera: 6000});
      if (r.status === 503) {
        fallos = 0;
        let p = null;
        try { p = await (await pedir("/progreso", {espera: 4000})).json(); } catch (e) { p = null; }
        modo = "preparando";
        pintarPreparando(p);
      } else if (r.ok) {
        fallos = 0;
        E = await r.json();
        modo = "listo";
        apagadoAqui = false;
        pintar();
      } else {
        throw new Error("HTTP " + r.status);
      }
    } catch (e) {
      fallos += 1;
      if (fallos >= 3 || apagadoAqui) { modo = "apagado"; pintarApagado(); }
    }
    reloj = setTimeout(mirar, modo === "listo" ? 2000 : 1500);
  }
  const mirarYa = () => { clearTimeout(reloj); reloj = setTimeout(mirar, 250); };

  // ------------------------------------------------------------------ pintar
  function ponDato(id, nivel, fuerte, pequeno) {
    const d = $("#" + id);
    d.className = "dato" + (nivel ? " " + nivel : "");
    $("strong", d).textContent = fuerte;
    $("small", d).textContent = pequeno || "";
  }

  function nombreIA() {
    const c = (E && E.cuentas) || {};
    const g = c.gemini || {}, q = c.groq || {};
    const lista = c.ia === "groq" ? [["Groq", q], ["Gemini", g]] : [["Gemini", g], ["Groq", q]];
    const lista2 = lista.filter(([, v]) => v.configurada && (v.modelo || v.configurada));
    if (lista2.length) return {nivel: "bien", texto: lista2[0][0], detalle: lista2[0][1].modelo || ""};
    if (E && E.servidor && E.servidor.ollama) return {nivel: "bien", texto: "IA local", detalle: "En este computador"};
    return {nivel: "aviso", texto: "Sin IA", detalle: "Pon una clave en Tus APIs"};
  }

  function pintarCabecera() {
    const h = new Date().getHours();
    const fecha = new Date().toLocaleDateString("es", {weekday: "long", day: "numeric", month: "long"});
    $("#saludo").textContent = `${h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"} · ${fecha}`;
    const p = [];
    if (modo === "listo") {
      const n = E.nube || {};
      p.push(n.conectada ? ["bien", "Internet conectado"] : n.activa ? ["aviso", "Conectando a internet"] : ["", "Sin nube"]);
      const robots = (E.dispositivos || []).length;
      p.push(robots ? ["bien", robots === 1 ? "Robot conectado" : robots + " robots"] : ["", "Sin robot"]);
      const ia = nombreIA();
      p.push([ia.nivel, ia.texto]);
    } else if (modo === "preparando") {
      p.push(["aviso", "Preparando"]);
    }
    $("#pildoras").innerHTML = p.map(([n, t]) => `<span class="pildora ${n}"><i></i>${esc(t)}</span>`).join("");
    const punto = $("#punto");
    punto.className = "punto " + (modo === "listo" ? "bien" : modo === "preparando" ? "aviso" : modo === "apagado" ? "mal" : "");
    $("#estado-mini").textContent = modo === "listo" ? "Píxel en marcha" : modo === "preparando" ? "Preparando…" : modo === "apagado" ? "Apagado" : "Conectando…";
  }

  function pintarPreparando(p) {
    $("#apagado").hidden = true;
    pintarCabecera();
    const caja = $("#preparando");
    caja.hidden = false;
    p = p || {};
    $("#prep-fase").textContent = p.fase || "Arrancando a Píxel…";
    const hay = p.total > 0;
    const barra = $("#prep-barra");
    barra.classList.toggle("sin", !hay);
    $("i", barra).style.width = hay ? Math.round((p.hecho / p.total) * 100) + "%" : "";
    $("#prep-cifra").textContent = hay ? Math.round((p.hecho / p.total) * 100) + " %" : "";
    const err = $("#prep-error");
    err.hidden = !p.error;
    if (p.error) err.textContent = p.error + (p.registro ? " Detalles en " + p.registro : "");
    if (p.version) $("#version").textContent = p.version;
    ponDato("d-pixel", "aviso", "Preparando", hay ? `${(p.hecho / 1048576).toFixed(0)} de ${(p.total / 1048576).toFixed(0)} MB` : p.fase || "");
    ponDato("d-nube", "", "Esperando", "Cuando Píxel esté listo");
    ponDato("d-robot", "", "Esperando", "");
    ponDato("d-ia", "", "Esperando", "");
    if (!E) {
      for (const c of $$("[data-lista-apps]")) c.innerHTML = '<div class="vacio">Disponible cuando Píxel esté listo.</div>';
      $("#resumen-apis").innerHTML = '<div class="vacio">Disponible cuando Píxel esté listo.</div>';
    }
    pintarVincular();
  }

  function pintarApagado() {
    pintarCabecera();
    const v = ventana();
    $("#apagado").hidden = false;
    $("#apagado-titulo").textContent = apagadoAqui ? "Apagaste a Píxel" : "Píxel está apagado";
    $("#apagado-texto").textContent = v ? "No escucha al robot ni a tus apps hasta que lo enciendas."
      : "Esta página no encuentra a Píxel. Ábrelo desde el menú de inicio o el escritorio.";
    $("#encender").hidden = !v;
    $("#cerrar-ventana").hidden = !v;
  }

  // -- vincular (Inicio y Dispositivos) --
  let firmaVincular = "", codigoHasta = 0;
  function pintarVincular() {
    const n = (E && modo === "listo" && E.nube) || null;
    const enlace = n && n.enlace;
    const firma = modo !== "listo" ? "prep" : !n.activa ? "sin" : !n.conectada ? "con:" + (n.error || "") : enlace ? "cod:" + enlace.codigo : "nada:" + (n.duenos || []).length;
    if (enlace) codigoHasta = Date.now() + enlace.quedan_s * 1000;
    if (firma === firmaVincular) { contarAtras(); return; }
    firmaVincular = firma;
    const duenos = (n && n.duenos) || [];
    const izquierda = `<div>
      <h2>Vincula a Píxel con tu cuenta</h2>
      <p class="sub">${duenos.length ? `Ya está vinculado con ${duenos.length === 1 ? "una cuenta" : duenos.length + " cuentas"}. Puedes sumar otra.` : "Así lo manejas desde tu celular o cualquier computador."}</p>
      <ol class="pasos">
        <li><span>Abre <a href="${URL_APP}" target="_blank" rel="noopener"><b>pixelassitance.web.app</b></a> y entra con tu cuenta de Google.</span></li>
        <li><span>Toca <b>Buscar a Píxel</b> y elige <b>${esc((n && n.nombre) || "este Píxel")}</b>.</span></li>
        <li><span>Escribe el código de 6 cifras que ves aquí.</span></li>
      </ol></div>`;
    let derecha;
    const enchufe = '<svg viewBox="0 0 24 24"><path d="M9 7 7 9a4.2 4.2 0 0 0 6 6l2-2M15 17l2-2a4.2 4.2 0 0 0-6-6L9 11M8 16l8-8"/></svg>';
    if (modo !== "listo") {
      derecha = `<div class="sin-codigo">${enchufe}<span>Cuando Píxel termine de prepararse podrás vincularlo.</span></div>`;
    } else if (!n.activa) {
      derecha = `<div class="sin-codigo">${enchufe}<span>Este Píxel funciona sin conexión a la nube, así que no se puede vincular.</span></div>`;
    } else if (!n.conectada) {
      derecha = `<div class="sin-codigo">${enchufe}<span>Conectando con internet…${n.error ? "<br><small>" + esc(n.error) + "</small>" : ""}</span></div>`;
    } else if (enlace) {
      const c = String(enlace.codigo);
      derecha = `<div class="codigo-zona">
        <div class="digitos" aria-label="Código ${esc(c.split("").join(" "))}">${c.split("").map((d) => `<span>${esc(d)}</span>`).join("")}</div>
        <div class="cuenta-atras"><svg viewBox="0 0 28 28" aria-hidden="true"><circle class="pista" cx="14" cy="14" r="11"/><circle class="resto" cx="14" cy="14" r="11" stroke-dasharray="69.1" stroke-dashoffset="0"/></svg><span data-quedan></span></div>
        <div class="acciones centro"><button class="btn suave" type="button" data-decir>Decirlo en voz alta</button><button class="btn fantasma" type="button" data-nuevo>Código nuevo</button></div>
      </div>`;
    } else {
      derecha = `<div class="sin-codigo">${enchufe}<span>Pide un código y escríbelo en la app.</span><button class="btn primario" type="button" data-nuevo>Mostrar código para vincular</button></div>`;
    }
    for (const t of $$("[data-vincular]")) t.innerHTML = izquierda + derecha;
    contarAtras();
  }
  function contarAtras() {
    const quedan = Math.max(0, Math.round((codigoHasta - Date.now()) / 1000));
    for (const el of $$("[data-quedan]")) el.textContent = quedan > 0 ? `Válido ${Math.floor(quedan / 60)}:${String(quedan % 60).padStart(2, "0")}` : "Venció: pide otro";
    const total = quedan > 600 ? 3600 : 300;
    for (const c of $$(".cuenta-atras .resto")) c.setAttribute("stroke-dashoffset", String(69.1 * (1 - Math.min(1, quedan / total))));
  }
  setInterval(contarAtras, 1000);

  function fechaCorta(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString("es", {day: "numeric", month: "short", year: "numeric"});
  }

  function pintarApps() {
    const duenos = (E.nube && E.nube.duenos) || [];
    const oyen = Object.fromEntries((E.celulares || []).map((c) => [c.uid, c]));
    for (const caja of $$("[data-lista-apps]")) {
      const quitar = caja.hasAttribute("data-con-quitar");
      caja.innerHTML = duenos.length ? `<div class="lista">${duenos.map((d) => {
        const c = oyen[d.uid];
        return `<div class="fila"><span class="ico">${ICONOS.movil}</span><div class="txt"><b>${esc(d.nombre || "App de Píxel")}</b>
          <small>${c && c.escuchando ? "Escuchando ahora · " : ""}Vinculada el ${esc(fechaCorta(d.desde))}</small></div>
          ${quitar ? `<button class="btn fantasma" type="button" data-quitar-app="${esc(d.uid)}" data-nombre="${esc(d.nombre || "")}">Desvincular</button>` : ""}</div>`;
      }).join("")}</div>`
        : `<div class="vacio">Todavía no hay ninguna cuenta vinculada.</div>`;
    }
  }

  // 12 nov (pedido: "debe salir que API estoy usando y el indicador si esta en uso"): la que contesta primero
  // dice "En uso"; la otra, si tambien tiene clave, "De respaldo"
  function enUso(c) {
    const lista = c.ia === "groq" ? ["groq", "gemini"] : ["gemini", "groq"];
    return lista.find((k) => c[k] && c[k].configurada && c[k].modelo) || "";
  }
  function chipApi(api, c) {
    const v = c[api];
    if (!v || !v.configurada) return ["", "Sin clave"];
    const conError = v.error && v.hace_error != null && (v.hace_ok == null || v.hace_error < v.hace_ok);
    if (conError) return ["mal", "Con error"];
    if (!v.modelo) return ["aviso", "Sin probar"];
    return enUso(c) === api ? ["bien", "En uso"] : ["", "De respaldo"];
  }

  let apiOcupada = "";
  function pintarApis() {
    const c = E.cuentas || {};
    const datos = {gemini: c.gemini || {}, groq: c.groq || {}};
    const nombres = {gemini: "Gemini", groq: "Groq"};
    for (const api of ["gemini", "groq"]) {
      const v = datos[api], tarjeta = $(`[data-api="${api}"]`);
      const [nivel, texto] = chipApi(api, c);
      const chip = $("[data-chip]", tarjeta);
      chip.className = "chip " + nivel;
      chip.textContent = texto;
      const det = [];
      if (v.configurada && v.modelo) det.push(`Modelo: ${v.modelo}.`);
      if (v.configurada && v.error && nivel === "mal") det.push(`Último error: ${v.error}`);
      if (!v.configurada) det.push(api === "gemini" ? "Pega tu clave para que Píxel piense con Google Gemini." : "Pega tu clave para que Píxel piense con Groq.");
      if (v.configurada && v.modelo && nivel !== "mal") det.push("También la usa la app de las cuentas vinculadas.");
      $("[data-detalle]", tarjeta).textContent = det.join(" ");
      $("[data-probar]", tarjeta).hidden = !v.configurada;
      $("[data-quitar]", tarjeta).hidden = !v.configurada;
      for (const b of $$("button", tarjeta)) b.disabled = apiOcupada === api;
    }
    for (const b of $$("[data-ia]")) b.setAttribute("aria-checked", String(b.dataset.ia === (c.ia || "gemini")));
    // Google en el PC (12 nov: "no esta vinculado Google: lo que le pido por voz no llega a la app")
    const g = c.google || {}, chipG = $("#chip-google"), detG = $("#google-detalle"), botonG = $("#google-conectar");
    const [nivelG, textoG, detalleG] = !g.credenciales
      ? ["aviso", "Falta un paso", "Este programa todavía no trae la credencial de Google. Cuando la tenga, aquí conectas tu cuenta y lo que le pidas por voz (eventos, correos) irá a tu Google Calendar y Gmail, los mismos de la app."]
      : g.estado === "esperando" ? ["aviso", "Esperando…", "Se abrió Google en el navegador de este computador: entra con tu cuenta y acepta."]
      : g.vinculada ? ["bien", "Conectada", "Lo que le pidas por voz al robot o a este computador va a tu Google Calendar y Gmail, los mismos de la app." + (g.autorizado ? " Conectada el " + g.autorizado + "." : "")]
      : g.estado === "error" ? ["mal", "Con error", "No se pudo conectar: " + (g.error || "inténtalo otra vez") + "."]
      : ["", "Sin conectar", "Conecta tu cuenta de Google para que lo que le pidas por voz (eventos, correos) vaya a tu Google Calendar y Gmail."];
    chipG.className = "chip " + nivelG;
    chipG.textContent = textoG;
    detG.textContent = detalleG;
    botonG.hidden = !g.credenciales || g.estado === "esperando";
    botonG.textContent = g.vinculada ? "Conectar otra cuenta" : "Conectar con Google";
    const local = $("#chip-local");
    local.className = "chip " + (E.servidor && E.servidor.ollama ? "bien" : "");
    local.textContent = E.servidor && E.servidor.ollama ? "Instalada" : "No instalada";
    $("#resumen-apis").innerHTML = ["gemini", "groq"].map((api) => {
      const [nivel, texto] = chipApi(api, c);
      return `<div class="fila"><span class="ico">${api === "gemini" ? '<svg viewBox="0 0 24 24"><path d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>'}</span>
        <div class="txt"><b>${nombres[api]}</b><small>${esc(datos[api].modelo || (datos[api].configurada ? "Clave guardada" : "Sin clave"))}</small></div><span class="chip ${nivel}">${esc(texto)}</span></div>`;
    }).join("");
  }

  function pintarRobots() {
    const lista = E.dispositivos || [];
    $("#lista-robots").innerHTML = lista.length ? `<div class="lista">${lista.map((d) => `<div class="fila"><span class="ico">${ICONOS.robot}</span>
      <div class="txt"><b>Robot en ${esc(d.ip)}</b><small>Conectado desde las ${esc(d.desde)} · ${esc(d.estado)}${d.frases ? " · " + d.frases + " frases" : ""}</small></div>
      <span class="estado-dot ${d.estado === "sin datos" ? "mal" : "bien"}"></span></div>`).join("")}</div>`
      : `<div class="vacio">Ningún robot conectado. Enciéndelo cerca de este computador, en la misma red WiFi: se conecta solo.</div>`;
  }

  let formRed = "";
  function pintarRed() {
    const b = (E.wifi && E.wifi.busqueda) || {};
    const fase = $("#red-fase");
    const buscando = b.estado === "buscando";
    fase.hidden = !(buscando || b.estado === "error");
    fase.className = b.estado === "error" ? "nota error" : "nota";
    fase.textContent = b.fase || "";
    $("#buscar-red").disabled = buscando;
    $("#buscar-red").textContent = buscando ? "Buscando…" : "Buscar en la red";
    if (!formRed) {
      const lista = (b.encontrados || []).filter((d) => d.tipo !== "pixel");
      $("#lista-red").innerHTML = b.estado === "listo" || lista.length
        ? (lista.length ? `<div class="lista">${lista.map((d) => {
          const nombre = d.nombre || d.modelo || d.host || d.fabricante || "Equipo sin nombre";
          return `<div class="fila"><span class="ico">${icono(d.tipo)}</span><div class="txt"><b>${esc(nombre)}</b>
            <small>${esc(TIPOS[d.tipo] || "Equipo")} · ${esc(d.ip)}${d.fabricante ? " · " + esc(d.fabricante) : ""}</small></div>
            ${d.agregado ? '<span class="chip bien">Guardado</span>' : d.tipo === "router" ? "" : `<button class="btn suave" type="button" data-agregar="${esc(d.mac)}">Agregar</button>`}</div>`;
        }).join("")}</div>` : `<div class="vacio">No encontré equipos en ${esc(b.red || "tu red")}.</div>`)
        : `<div class="vacio">Toca «Buscar en la red» para ver qué hay conectado.</div>`;
    }
    const mios = E.mis_dispositivos || [];
    $("#lista-guardados").innerHTML = mios.length ? `<div class="lista">${mios.map((d) => `<div class="fila"><span class="ico">${icono(d.tipo)}</span>
      <div class="txt"><b>${esc(d.nombre)}</b><small>${esc(TIPOS[d.tipo] || (d.via === "ble" ? "Bluetooth" : "Equipo"))}${d.ip ? " · " + esc(d.ip) : ""}${d.encendido === true ? " · encendido" : d.encendido === false ? " · apagado" : ""}</small></div>
      <span class="estado-dot ${d.encendido === true || d.cerca ? "bien" : d.encendido === false ? "mal" : ""}"></span>
      <button class="btn fantasma" type="button" data-olvidar="${esc(d.mac)}" data-nombre="${esc(d.nombre)}">Olvidar</button></div>`).join("")}</div>`
      : `<div class="vacio">Aún no guardas ningún aparato.</div>`;
  }

  function abrirFormRed(mac) {
    const d = ((E.wifi && E.wifi.busqueda && E.wifi.busqueda.encontrados) || []).find((x) => x.mac === mac);
    if (!d) return;
    formRed = mac;
    const fila = $(`[data-agregar="${CSS.escape(mac)}"]`).closest(".fila");
    const form = document.createElement("form");
    form.className = "fila-form";
    form.innerHTML = `<label class="campo">Nombre<input name="nombre" maxlength="40" required value="${esc(d.nombre || d.modelo || d.fabricante || "")}"></label>
      <label class="campo">Tipo<select name="tipo">${Object.entries(TIPOS).filter(([k]) => k !== "pixel").map(([k, v]) => `<option value="${k}"${k === d.tipo ? " selected" : ""}>${v}</option>`).join("")}</select></label>
      <div class="acciones" style="margin:0;align-self:end"><button class="btn primario" type="submit">Guardar</button><button class="btn fantasma" type="button" data-cancelar>Cancelar</button></div>`;
    fila.after(form);
    $("input", form).focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ok = await enviar("/api/wifi/agregar", {mac: d.mac, ip: d.ip, nombre: form.nombre.value.trim(), tipo: form.tipo.value});
      if (ok) { formRed = ""; form.remove(); }
    });
    $("[data-cancelar]", form).addEventListener("click", () => { formRed = ""; form.remove(); if (E) pintarRed(); });
  }

  // -- voz --
  let vozTocada = false, vozPintada = false;
  function pintarVoz() {
    const ag = E.agente || {};
    const aj = ag.ajustes || {};
    const sel = $("#sel-voz");
    if (!vozPintada || sel.options.length !== (ag.voces || []).length) {
      sel.innerHTML = (ag.voces || []).map((v) => `<option value="${esc(v.id)}">${esc(v.nombre)}</option>`).join("");
    }
    if (vozTocada && vozPintada) return;
    const f = $("#f-voz");
    for (const nombre of ["salida_voz", "respuesta"]) {
      for (const r of $$(`input[name="${nombre}"]`, f)) r.checked = r.value === aj[nombre];
    }
    sel.value = aj.voz || "";
    f.tono.value = aj.tono || "normal";
    f.personalidad.value = aj.personalidad || "";
    f.personalidad.maxLength = ag.personalidad_max || 300;
    contarPersonalidad();
    vozPintada = true;
  }
  function contarPersonalidad() {
    const f = $("#f-voz");
    $("#personalidad-cuenta").textContent = `${f.personalidad.value.length} de ${f.personalidad.maxLength > 0 ? f.personalidad.maxLength : 300} letras`;
  }
  function datosVoz() {
    const f = $("#f-voz");
    const marcado = (n) => { const r = $(`input[name="${n}"]:checked`, f); return r ? r.value : undefined; };
    return {voz: f.voz.value, respuesta: marcado("respuesta") || "normal", salida_voz: marcado("salida_voz") || "esp32",
      tono: f.tono.value, personalidad: f.personalidad.value};
  }

  function pintar() {
    $("#apagado").hidden = true;
    $("#preparando").hidden = true;
    pintarCabecera();
    const prog = E.programa || {};
    if (prog.version) $("#version").textContent = prog.version;
    $("#apagar").hidden = !prog.apagar;
    const n = E.nube || {};
    ponDato("d-pixel", "bien", "En marcha", E.servidor && E.servidor.ip ? "En " + E.servidor.ip : "");
    ponDato("d-nube", n.conectada ? "bien" : n.activa ? "aviso" : "", n.conectada ? "Conectado" : n.activa ? "Conectando…" : "Sin nube",
      n.conectada ? ((n.duenos || []).length ? (n.duenos.length === 1 ? "1 cuenta vinculada" : n.duenos.length + " cuentas vinculadas") : "Sin cuentas vinculadas") : n.error || "");
    const robots = E.dispositivos || [];
    ponDato("d-robot", robots.length ? "bien" : "", robots.length ? (robots.length === 1 ? "Conectado" : robots.length + " conectados") : "Sin robot",
      robots.length ? robots[0].estado : "Se conecta solo por WiFi");
    const ia = nombreIA();
    ponDato("d-ia", ia.nivel, ia.texto, ia.detalle);
    pintarVincular();
    pintarApps();
    pintarApis();
    pintarRobots();
    pintarRed();
    pintarVoz();
  }

  // ------------------------------------------------------------------ eventos
  function irA(vista) {
    for (const b of $$(".menu button")) {
      const si = b.dataset.vista === vista;
      b.classList.toggle("activo", si);
      if (si) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    for (const s of $$(".vista")) s.hidden = s.id !== "v-" + vista;
    $("#titulo").textContent = TITULOS[vista];
    $("#principal").scrollTop = 0;
  }
  for (const b of $$(".menu button")) b.addEventListener("click", () => irA(b.dataset.vista));

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.ir) { irA(t.dataset.ir); return; }
    if (t.hasAttribute("data-nuevo")) {
      t.disabled = true;
      await enviar("/api/nube/enlazar", {});
      t.disabled = false;
      return;
    }
    if (t.hasAttribute("data-decir")) { enviar("/api/nube/decir", {}); return; }
    if (t.dataset.quitarApp) {
      if (confirm(`¿Desvincular «${t.dataset.nombre || "esa cuenta"}»? Ya no podrá manejar a Píxel desde su app.`)) enviar("/api/nube/quitar", {uid: t.dataset.quitarApp});
      return;
    }
    if (t.dataset.agregar) { if (!formRed) abrirFormRed(t.dataset.agregar); return; }
    if (t.dataset.olvidar) {
      if (confirm(`¿Olvidar «${t.dataset.nombre}»?`)) enviar("/api/dispositivos/olvidar", {mac: t.dataset.olvidar});
      return;
    }
    if (t.dataset.ia) { enviar("/api/ia", {ia: t.dataset.ia}); return; }
    const tarjeta = t.closest("[data-api]");
    if (tarjeta && t.hasAttribute("data-probar")) {
      const api = tarjeta.dataset.api;
      apiOcupada = api;
      if (E) pintarApis();
      toast(`Probando ${api === "gemini" ? "Gemini" : "Groq"}…`);
      await enviar(`/api/${api}/probar`, {});
      apiOcupada = "";
      if (E) pintarApis();
      return;
    }
    if (tarjeta && t.hasAttribute("data-quitar")) {
      const api = tarjeta.dataset.api;
      if (confirm(`¿Quitar la clave de ${api === "gemini" ? "Gemini" : "Groq"} de este computador?`)) enviar(`/api/${api}/clave`, {clave: ""});
    }
  });

  for (const f of $$("[data-form]")) {
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const tarjeta = f.closest("[data-api]"), api = tarjeta.dataset.api;
      const campo = f.clave, clave = campo.value.trim();
      if (!clave) { toast("Pega primero la clave.", true); campo.focus(); return; }
      apiOcupada = api;
      if (E) pintarApis();
      toast("Guardando y probando la clave…");
      const r = await enviar(`/api/${api}/clave`, {clave});
      apiOcupada = "";
      campo.value = "";                    // que la clave no se quede en la pantalla
      if (E) pintarApis();
      if (!r) mirarYa();                   // la clave queda guardada aunque falle la prueba: que se vea
    });
  }

  $("#buscar-red").addEventListener("click", () => { formRed = ""; enviar("/api/wifi/buscar", {}); });
  $("#google-conectar").addEventListener("click", () => enviar("/api/google/vincular", {}));

  const fVoz = $("#f-voz");
  fVoz.addEventListener("input", () => { vozTocada = true; contarPersonalidad(); });
  fVoz.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await enviar("/api/agente", datosVoz())) vozTocada = false;
  });
  $("#probar-voz").addEventListener("click", async () => {
    const d = datosVoz();
    if (await enviar("/api/agente", d, {silencio: true})) { vozTocada = false; enviar("/api/agente/probar", {donde: d.salida_voz}); }
  });

  $("#apagar").addEventListener("click", async () => {
    if (!confirm("¿Apagar Píxel? Dejará de escuchar al robot y a tus apps hasta que lo abras otra vez.")) return;
    apagadoAqui = true;
    await enviar("/api/apagar", {}, {silencio: true});
    modo = "apagado";
    pintarApagado();
  });
  $("#encender").addEventListener("click", async () => {
    const v = ventana();
    if (!v) return;
    $("#apagado-texto").textContent = "Encendiendo a Píxel…";
    $("#encender").disabled = true;
    try { await v.encender(); } catch (e) { toast("No pude encender a Píxel.", true); }
    apagadoAqui = false;
    fallos = 0;
    setTimeout(() => { $("#encender").disabled = false; }, 4000);
    mirarYa();
  });
  $("#cerrar-ventana").addEventListener("click", () => { const v = ventana(); if (v) v.cerrar(); });

  window.addEventListener("pywebviewready", () => { if (modo === "apagado") pintarApagado(); });

  // ------------------------------------------------------------------ arranque
  pintarCabecera();
  mirar();
  intro();
  window.Escritorio = {terminarIntro, irA};          // para las pruebas (tools/prueba_escritorio.js)
})();
