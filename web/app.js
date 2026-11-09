/* Fase 9 - App de Pixel: estado en vivo, cara 3D, dispositivos (Bluetooth y WiFi), personalidad,
   agenda y cuentas. La sirve panel.py (modo local: /api del mismo origen) y Firebase Hosting.
   Fase 10: desde internet no hay direcciones que escribir. Se entra con Google, se busca a Pixel
   (visibles), se enlaza con el codigo que el dice y desde entonces la app lee su estado y le
   manda ordenes por la Realtime Database (ver nube.py). El enlace es de la cuenta de Google:
   vale en cualquier movil o PC donde se entre con ella.
   Fase 12: en la app de internet el propio celular es Pixel (agente.js: oye, piensa con Gemini por
   Firebase AI Logic y habla). Enlazar el Pixel del PC queda como algo opcional. */
"use strict";

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

// ------------------------------------------------------------------ dos modos: panel local o app en internet
// "?nube" fuerza el modo internet sirviendo la web desde el panel local (para probarlo), y en localhost
// "?nube=anonimo" entra sin Google, para las pruebas automaticas
const PARAMS = new URLSearchParams(location.search);
const EN_INTERNET = /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) || PARAMS.has("nube");
const PRUEBA_ANONIMA = location.hostname === "localhost" && PARAMS.get("nube") === "anonimo";
const URL_APP = "https://pixelassitance.web.app";
const NUBE = {apiKey: "AIzaSyAKcuXL3qvNDCUPUlZXjrSOUKW3k4z2hZ8", authDomain: "pixelassitance.firebaseapp.com",
  databaseURL: "https://pixelassitance-default-rtdb.firebaseio.com", projectId: "pixelassitance",
  appId: "1:794659517422:web:43c3cb46985a905d0c54ff"};
const SDK = "https://www.gstatic.com/firebasejs/13.1.0/";     // 13.1.0 trae firebase-ai.js (Fase 12)
const nube = {d: null, au: null, auth: null, db: null, usuario: null, uid: "", offset: 0, mios: null, pid: null,
  estado: null, vivo: 0, enLinea: false, quitar: [], quitarMios: null, visibles: {}, quitarVisibles: null, latidoT: 0, error: ""};

function llamar(ruta, opciones) {
  return fetch(ruta, Object.assign({cache: "no-store"}, opciones || {}));
}

// ------------------------------------------------------------------ iconos y textos
const ICONOS = {
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  audio: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  altavoz: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="6.5" r="1"/>',
  movil: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  control: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11.5" r=".6"/><circle cx="18" cy="13.5" r=".6"/>',
  ordenador: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  luz: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.2.9 2V16h5.4v-.2c0-.8.3-1.5.9-2A6 6 0 0 0 12 3z"/>',
  enchufe: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  tv: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  camara: '<path d="M3 8h3.5L8.5 5h7l2 3H21v12H3z"/><circle cx="12" cy="13.5" r="3.5"/>',
  impresora: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  router: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M10.5 16.5h.01M12 13V9M9 7a4.5 4.5 0 0 1 6 0M6.5 4.5a8 8 0 0 1 11 0"/>',
  pixel: '<circle cx="12" cy="12" r="9.5"/><rect x="7.6" y="8" width="3" height="5" rx="1.2"/><rect x="13.4" y="8" width="3" height="5" rx="1.2"/><path d="M9.5 16q2.5 1.8 5 0"/>',
  otro: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>',
};
const icono = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n] || ICONOS.otro}</svg>`;
const TIPO = {audio: "Altavoz o audífonos", movil: "Móvil", control: "Mando o teclado", ordenador: "Ordenador", otro: "Otro aparato", "": "Aparato",
  luz: "Luz", enchufe: "Enchufe", tv: "Pantalla o TV", altavoz: "Altavoz", camara: "Cámara", impresora: "Impresora", router: "Router", pixel: "Píxel (ESP32)"};
const TIPOS_WIFI = ["luz", "enchufe", "tv", "altavoz", "camara", "impresora", "movil", "ordenador", "otro"];
const ICONO_TIPO = (t) => (ICONOS[t] ? t : "otro");
document.querySelectorAll("[data-icono]").forEach((e) => { e.innerHTML = icono(e.dataset.icono); });

const hace = (s) => (s === null || s === undefined ? "" : s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`);
function barras(rssi) {
  const n = rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1;
  return `<span class="barras" title="${rssi} dBm" aria-label="señal ${n} de 4">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? "on" : ""}" style="height:${4 + i * 3}px"></i>`).join("")}</span>`;
}

// ------------------------------------------------------------------ avisos y peticiones
let datos = null, agenteFirma = "", agenteTocado = false, toastHasta = 0;   // agenteTocado: hay cambios sin guardar en Personalidad

function toast(texto, error) {
  const t = $("#toast");
  t.textContent = texto; t.className = "toast" + (error ? " error" : ""); t.hidden = false;
  toastHasta = Date.now() + 3200;
  setTimeout(() => { if (Date.now() >= toastHasta) t.hidden = true; }, 3300);
}

async function enviar(ruta, cuerpo, silencioso) {
  try {
    let j;
    if (EN_INTERNET) j = await ordenNube(ruta, cuerpo);
    else {
      const r = await llamar(ruta, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(cuerpo || {})});
      j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo.");
    }
    if (!silencioso) toast(j.mensaje || "Hecho.");
    refrescar();
    return true;
  } catch (e) {
    toast(e instanceof TypeError ? "No llego al servidor." : e.message, true);
    return false;
  }
}

// ------------------------------------------------------------------ pestanas
function vista() {
  const nombre = (location.hash || "#inicio").slice(1);
  const v = document.getElementById("v-" + nombre) ? nombre : "inicio";
  document.querySelectorAll("section.vista").forEach((s) => { s.hidden = s.id !== "v-" + v; });
  document.querySelectorAll("nav.tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.vista === v ? "page" : "false"));
}
window.addEventListener("hashchange", vista);

function pill(id, clase, texto) { const p = $(id); p.className = "pill " + clase; p.innerHTML = "<i></i>" + esc(texto); }

// ------------------------------------------------------------------ la cara
const cara = window.CaraPixel && window.CaraPixel.montar($("#cara"));
if (!cara) { $("#cara").hidden = true; $("#pista").hidden = true; $("#cara-plana").hidden = false; }
let dichoHasta = 0;
function decir(titulo, sub, ms) {
  $("#hero-estado").textContent = titulo;
  if (sub !== undefined) $("#hero-sub").textContent = sub;
  dichoHasta = Date.now() + (ms || 2600);
}
if (cara) {
  let veces = 0;
  // Fase 13: con Pixel en este celular, reacciona humor.js (se rie, se cansa, se enoja y lo dice en voz alta)
  const conHumor = () => window.PixelHumor && window.Agente && window.Agente.activo();
  cara.alAgarrar = () => { if (conHumor()) window.PixelHumor.alAgarrar(); };
  cara.alSoltar = (toque, info) => {
    $("#pista").classList.add("fuera");
    if (conHumor()) { window.PixelHumor.alSoltar(toque, info); return; }
    veces++;
    decir(toque ? "¡Jiji, cosquillas!" : veces > 3 ? "¡Eh, que me deformo!" : "¡Boiiing!", toque ? "Tócame otra vez, o estírame la cara." : "Vuelvo a mi forma solito.");
  };
}
function feliz(texto) {
  if (cara) cara.emocion("feliz", 2600);
  decir(texto, "", 2600);
}

// ------------------------------------------------------------------ boca sincronizada con la voz
// El servidor apunta el volumen de cada trozo de voz y a que hora (de su reloj) empieza a sonar;
// aqui se busca el trozo que suena ahora y la boca se abre segun su volumen. En la app de internet,
// mientras Pixel habla en este celular (agente.js), la boca sigue esa voz.
const voz = {segmentos: [], offset: 0, recibida: 0};      // offset: reloj del servidor - reloj de aqui (ms)

async function pedirVoz() {
  const t0 = Date.now();
  try {
    const j = await (await llamar("/api/voz")).json();
    voz.offset = j.ahora - (t0 + Date.now()) / 2;
    voz.segmentos = j.segmentos;
    voz.recibida = Date.now();
  } catch (e) { /* sin servidor: la boca se queda quieta */ }
}

function moverBoca() {
  if (!cara) return;
  const propia = window.Agente ? window.Agente.nivelBoca() : null;
  if (propia !== null) { cara.boca(propia); return; }
  const t = Date.now() + (EN_INTERNET ? nube.offset : voz.offset);
  let nivel = null;
  for (const s of voz.segmentos) {
    const i = Math.floor((t - s.t) / s.paso);
    if (i >= 0 && i < s.niveles.length) { nivel = s.niveles[i]; break; }
  }
  cara.boca(nivel);
}
setInterval(moverBoca, 50);
if (!EN_INTERNET) setInterval(() => { if (!document.hidden && !$("#v-inicio").hidden) pedirVoz(); }, 300);

// ------------------------------------------------------------------ inicio
function pintarInicio(d) {
  const activos = d.activos, hablando = d.dispositivos.some((x) => x.estado === "hablando");
  const mios = misDispositivos(d);
  $("#r-disp").textContent = mios.length;
  $("#r-disp-sub").textContent = `dispositivo${mios.length === 1 ? "" : "s"} · ${activos} Píxel`;
  if (EN_INTERNET) return;                // en la app de internet, Inicio es de Pixel en este celular (agente.js)
  // con la voz real la boca la mueve moverBoca(); sin ella, la animacion aproximada de "hablando"
  if (cara) cara.estado(!activos ? "esperando" : hablando && !voz.recibida ? "hablando" : "escuchando");
  $("#zzz").hidden = !!activos || !cara;
  $("#latido").className = "latido" + (hablando ? " habla" : activos ? " ok" : "");
  $("#hero-acciones").hidden = true;
  if (Date.now() > dichoHasta) {
    $("#hero-estado").textContent = !activos ? "Estoy dormido" : hablando ? "Estoy hablando…" : "¡Hola! Te escucho";
    $("#hero-sub").textContent = !activos ? "Espero a que se conecte el ESP32. Enciéndelo o revisa su WiFi."
      : hablando ? (d.agente.ajustes.salida_voz === "pc" ? "Sueno por el altavoz del PC." : "Sueno por el ESP32.")
      : `Di "${d.agente.activacion}" y tu orden.`;
  }
  const nr = d.agenda.recordatorios.length, ne = d.agenda.eventos.length;
  $("#r-agenda").textContent = nr + ne;
  $("#r-agenda-sub").textContent = `${nr} recordatorio${nr === 1 ? "" : "s"} · ${ne} evento${ne === 1 ? "" : "s"}`;
  const voz = d.agente.voces.find((v) => v.id === d.agente.ajustes.voz);
  $("#r-voz").textContent = voz ? voz.nombre.split(" · ")[0] : "–";
  $("#r-voz-sub").textContent = d.agente.ajustes.salida_voz === "pc" ? "por el altavoz del PC (" + d.bt_pc.musica_en + ")" : "por el ESP32";
  $("#palabra").textContent = d.agente.activacion;
  const g = d.cuentas.google;
  $("#r-cuentas").textContent = g.vinculada ? "Vinculada" : "Sin vincular";
  $("#r-cuentas-sub").textContent = g.vinculada ? "Google · calendario y correo" : "Google · se usa el calendario local";
  const conTexto = d.dispositivos.filter((x) => x.ultimo).pop();
  $("#ultimo").innerHTML = conTexto ? `<b>"${esc(conTexto.ultimo)}"</b> · desde ${esc(conTexto.ip)}` : "Todavía nada.";
}

// ------------------------------------------------------------------ mis dispositivos (Bluetooth del PC, WiFi y cerca de Pixel)
function misDispositivos(d) {
  const bt = d.bt_pc.encendido ? d.bt_pc.dispositivos.filter((x) => x.emparejado).map((x) => Object.assign({via: "bt"}, x)) : [];
  return bt.concat(d.mis_dispositivos.filter((m) => m.via === "wifi"), d.mis_dispositivos.filter((m) => m.via === "ble"));
}

function botonesBt(x, op) {
  if (op.estado === "en_curso" && op.mac === x.mac) {
    return `<span class="buscando" style="padding:0"><span class="giro"></span>${op.accion === "emparejar" ? "Emparejando…" : "Conectando…"}</span>`;
  }
  let h = "";
  if (!x.emparejado) h += `<button class="btn primario" type="button" data-bt="emparejar" data-mac="${esc(x.mac)}">Agregar</button>`;
  else if (!x.conectado) h += `<button class="btn suave" type="button" data-bt="conectar" data-mac="${esc(x.mac)}">Conectar</button>`;
  else h += `<button class="btn" type="button" data-bt="desconectar" data-mac="${esc(x.mac)}">Desconectar</button>`;
  if (x.conectado && x.puede_musica && !x.musica) h += `<button class="btn primario" type="button" data-bt="musica" data-mac="${esc(x.mac)}">Usar para la música</button>`;
  if (x.emparejado) h += `<button class="btn peligro" type="button" data-bt="olvidar" data-mac="${esc(x.mac)}">Olvidar</button>`;
  return h;
}

function filaMio(m, op) {
  if (m.via === "bt") {
    return `<div class="fila"><span class="ico">${icono(ICONO_TIPO(m.tipo))}</span>
      <div class="txt"><b>${esc(m.nombre || m.mac)}</b><small>Bluetooth · ${esc(TIPO[m.tipo] || "Aparato")}</small></div>
      ${m.musica ? '<span class="chip info">Suena aquí</span>' : ""}
      ${m.conectado ? '<span class="chip ok">Conectado</span>' : '<span class="chip">Emparejado</span>'}
      <div class="acciones">${botonesBt(m, op)}</div></div>`;
  }
  if (m.via === "wifi") {
    const chip = m.encendido === null ? '<span class="chip">Comprobando…</span>'
      : m.encendido ? '<span class="chip ok">Encendido</span>' : '<span class="chip warn">No responde</span>';
    return `<div class="fila"><span class="ico verde">${icono(ICONO_TIPO(m.tipo))}</span>
      <div class="txt"><b>${esc(m.nombre)}</b><small>WiFi · ${esc(TIPO[m.tipo] || "Aparato")} · <span class="mono">${esc(m.ip)}</span>${m.fabricante ? " · " + esc(m.fabricante) : ""}</small></div>
      ${chip}<button class="btn peligro" type="button" data-olvidar="${esc(m.mac)}">Olvidar</button></div>`;
  }
  return `<div class="fila"><span class="ico">${icono("bluetooth")}</span>
    <div class="txt"><b>${esc(m.nombre)}</b><small>Cerca de Píxel · <span class="mono">${esc(m.mac)}</span>${m.hace !== null ? " · visto " + hace(m.hace) : ""}</small></div>
    ${m.cerca ? barras(m.rssi) + '<span class="chip ok">Cerca</span>' : '<span class="chip">No está cerca</span>'}
    <button class="btn peligro" type="button" data-olvidar="${esc(m.mac)}">Olvidar</button></div>`;
}

function pintarDispositivos(d) {
  const b = d.bt_pc, mios = misDispositivos(d);
  // los dos altavoces fijos: el del ESP32 y los del PC. Cada uno dice si Pixel habla por el, y se prueba
  // en ese mismo altavoz. La musica del PC suena por su salida (los del PC o un altavoz Bluetooth).
  const vozEnPc = d.agente.ajustes.salida_voz === "pc", musicaEnPc = b.musica_en === "los altavoces del PC";
  const habla = (aqui, donde) => aqui ? '<span class="chip ok">Habla por aquí</span>'
    : `<button class="btn suave" type="button" data-voz="${donde}">Que hable por aquí</button>`;
  let h = `<div class="fila"><span class="ico">${icono("pixel")}</span>
    <div class="txt"><b>Altavoz de Píxel</b><small>En el ESP32${d.activos ? "" : " · sin conectar"}</small></div>
    ${habla(!vozEnPc, "esp32")}<button class="btn" type="button" data-probar-en="esp32">Probar</button></div>
    <div class="fila"><span class="ico">${icono("ordenador")}</span>
    <div class="txt"><b>Altavoces del PC</b><small>${musicaEnPc ? "Aquí suena la música del PC" : "La música suena ahora por " + esc(b.musica_en)}</small></div>
    ${habla(vozEnPc, "pc")}${musicaEnPc ? "" : '<button class="btn" type="button" data-bt="musica" data-mac="">Música aquí</button>'}
    <button class="btn" type="button" data-probar-en="pc">Probar</button></div>`;
  h += mios.length ? mios.map((m) => filaMio(m, b.operacion)).join("")
    : '<div class="vacio">Aún no hay dispositivos. Pulsa <b>Agregar dispositivo</b> para conectar un altavoz, unos audífonos o un aparato de tu WiFi.</div>';
  $("#lista-mios").innerHTML = h;

  const n = d.dispositivos.length;
  $("#pixeles-sub").textContent = n ? `${d.activos} activo${d.activos === 1 ? "" : "s"}` : "";
  $("#lista-disp").innerHTML = n ? d.dispositivos.map((x) => `
    <div class="card"><div class="head">
      <div class="titulo"><span class="ico">${icono("pixel")}</span><div><h2>${esc(x.ble.yo || "Píxel")} · ESP32-S3</h2><span class="sub mono">${esc(x.ip)}</span></div></div>
      <span class="chip ${x.estado === "escuchando" ? "ok" : x.estado === "hablando" ? "info" : ""}">${esc(x.estado)}</span></div>
      <dl class="kv"><dt>Conectado</dt><dd>desde las ${esc(x.desde)} (${x.minutos} min)</dd>
      <dt>Frases oídas</dt><dd>${x.frases}</dd>
      <dt>Ruido de fondo</dt><dd>${x.piso === null ? "calibrando…" : x.piso + (x.piso < 200 ? " · bien" : x.piso < 400 ? " · algo de ruido" : " · mucho ruido")}</dd>
      <dt>Último texto</dt><dd>${x.ultimo ? "“" + esc(x.ultimo) + "”" : "–"}</dd></dl>
      ${x.ble.yo ? `<details class="mas"><summary>Bluetooth cerca · ${x.ble.vistos.length} ${hace(x.ble.hace)}</summary><div class="lista">${x.ble.vistos.slice(0, 12).map((v) => `
        <div class="fila"><div class="txt"><b>${v.nombre ? esc(v.nombre) : "Sin nombre"}</b><small class="mono">${esc(v.mac)}</small></div>${v.aceptado ? '<span class="chip ok">Recordado</span>' : ""}${barras(v.rssi)}</div>`).join("")}</div></details>` : ""}
      ${x.estado === "sin datos" ? '<p class="aviso">Esta conexión dejó de mandar audio: el ESP32 se reconectó o se apagó. Se cierra sola en 2 minutos.</p>' : ""}
    </div>`).join("") : '<div class="vacio">No hay ningún Píxel conectado. Pulsa <b>Agregar dispositivo → Otro Píxel</b> para ver cómo conectarlo.</div>';
  $("#ip-servidor").textContent = d.servidor.ip;
  $("#portal-clave").textContent = d.portal.clave;
  $("#kv-servidor").innerHTML = `<dt>IP</dt><dd class="mono">${esc(d.servidor.ip)}</dd><dt>Puerto ESP32</dt><dd class="mono">${d.servidor.puerto}</dd>
    <dt>Este panel</dt><dd class="mono">http://${esc(d.servidor.ip)}:${d.servidor.panel}</dd>
    <dt>Reconocimiento</dt><dd>Whisper ${esc(d.servidor.stt)}</dd><dt>IA</dt><dd>${d.cuentas.gemini && d.cuentas.gemini.configurada ? "Gemini " + esc(d.cuentas.gemini.modelo) + " · respaldo " : ""}${esc(d.servidor.llm)} ${d.servidor.ollama ? "· lista" : "· apagada"}</dd>`;
}

// ------------------------------------------------------------------ hoja "Agregar dispositivo"
const PASOS = {elegir: "Agregar dispositivo", bt: "Por Bluetooth", wifi: "Por WiFi", pixel: "Otro Píxel"};
let paso = "elegir", btDesde = 0, wifiDesde = 0, wifiForm = null, aceptando = null, busqueda = null, ultimaOp = "";

function irA(p) {
  if (p === "pixel" && EN_INTERNET) { $("#agregar").close(); abrirEnlazar(); return; }
  paso = p;
  Object.keys(PASOS).forEach((x) => { $("#paso-" + x).hidden = x !== p; });
  $("#agregar-atras").hidden = p === "elegir";
  $("#agregar-titulo").textContent = PASOS[p];
  if (p === "bt") iniciarBt();
  if (p === "wifi") iniciarWifi();
  if (datos) pintarHoja(datos);
}

async function iniciarBt() {
  const b = datos && datos.bt_pc;
  btDesde = Date.now();
  if (!b || !b.hay) return;
  if (!b.encendido && !(await enviar("/api/bt/encender", {}, true))) return;
  if (!b.buscando) enviar("/api/bt/buscar", {}, true);
}

function iniciarWifi() {
  const w = datos && datos.wifi.busqueda;
  if (w && (w.estado === "buscando" || (w.estado === "listo" && w.hace !== null && w.hace < 90))) return;
  wifiDesde = Date.now();
  enviar("/api/wifi/buscar", {}, true);
}

function progreso(desde, total) {
  const p = Math.min(100, ((Date.now() - desde) / 1000 / total) * 100);
  return `<div class="progreso"><i style="width:${p.toFixed(0)}%"></i></div>`;
}

function pintarBt(b) {
  const enc = $("#bt-encabezado"), lista = $("#bt-encontrados");
  if (!b.hay) { enc.innerHTML = '<div class="vacio">Este PC no tiene Bluetooth.</div>'; lista.innerHTML = ""; return; }
  if (!b.encendido) {
    enc.innerHTML = `<div class="grupo"><p class="sub">El Bluetooth del PC está apagado${b.bloqueado ? " (bloqueado)" : ""}.</p>
      <div class="acciones"><button class="btn primario" type="button" data-bt-iniciar>Encender y buscar</button></div></div>`;
    lista.innerHTML = ""; return;
  }
  const op = b.operacion;
  const reciente = op.estado && op.hace !== null && op.hace < 40;
  let h = b.buscando
    ? `<div class="grupo"><div class="buscando" style="padding:0"><span class="giro"></span>Buscando aparatos cerca del PC…</div>${progreso(btDesde, 12)}
       <p class="sub">Pon tu altavoz o audífonos en <b>modo emparejar</b>: suele ser mantener pulsado el botón de Bluetooth hasta que parpadee.</p></div>`
    : `<div class="cabecera"><p class="sub">Búsqueda terminada.</p><button class="btn suave" type="button" data-bt-iniciar>Buscar otra vez</button></div>`;
  if (reciente && op.estado === "error") h += `<p class="aviso">${esc(op.mensaje)}</p>`;
  enc.innerHTML = h;

  const nuevos = b.dispositivos.filter((x) => !x.emparejado).sort((a, c) => (c.rssi ?? -999) - (a.rssi ?? -999));
  const recien = reciente && op.estado === "ok" && op.accion === "emparejar" ? b.dispositivos.filter((x) => x.mac === op.mac) : [];
  let l = recien.map((x) => `<div class="fila" style="background:var(--green-soft)"><span class="ico verde">${icono(ICONO_TIPO(x.tipo))}</span>
    <div class="txt"><b>${esc(x.nombre || x.mac)}</b><small>${esc(op.mensaje)}</small></div><div class="acciones">${botonesBt(x, op)}</div></div>`).join("");
  l += nuevos.length ? `<h3>Cerca del PC</h3><div class="lista">${nuevos.map((x) => `<div class="fila"><span class="ico">${icono(ICONO_TIPO(x.tipo))}</span>
      <div class="txt"><b>${esc(x.nombre || x.mac)}</b><small>${esc(TIPO[x.tipo] || "Aparato")}</small></div>
      ${x.rssi !== null ? barras(x.rssi) : ""}<div class="acciones">${botonesBt(x, op)}</div></div>`).join("")}</div>`
    : b.buscando ? '<div class="vacio">Todavía no veo ninguno…</div>'
    : recien.length ? "" : '<div class="vacio">No encontré aparatos nuevos. Revisa que esté en modo emparejar y busca otra vez.</div>';
  lista.innerHTML = l;
  $("#bt-visible").innerHTML = b.visible_s
    ? `<p class="aviso">En el móvil: Ajustes → Bluetooth → toca <b>${esc(b.nombre_pc)}</b> y acepta. El PC acepta solo durante ${b.visible_s} s.</p>` : "";
}

function filaEncontradoBle(v) {
  return `<div class="fila"><div class="txt"><b>${v.nombre ? esc(v.nombre) : "Sin nombre"}</b><small class="mono">${esc(v.mac)}</small></div>${barras(v.rssi)}
    ${v.aceptado ? '<span class="chip ok">Recordado</span>'
                 : `<button class="btn suave" type="button" data-aceptar="${esc(v.mac)}" data-nombre="${esc(v.nombre)}">Recordar</button>`}</div>`;
}

function pintarBusquedaBle(d) {
  if (!busqueda || aceptando) return;
  const caja = $("#busqueda");
  const conBle = d.dispositivos.filter((x) => x.ble.yo && x.estado !== "sin datos");
  if (!conBle.length) {
    caja.innerHTML = '<div class="vacio">No hay ningún Píxel con Bluetooth conectado. Revisa que esté encendido y con el firmware nuevo.</div>';
    busqueda = null; return;
  }
  const pasado = (Date.now() - busqueda.t0) / 1000;
  const frescos = conBle.filter((x) => x.ble.hace !== null && x.ble.hace <= pasado);
  if (!busqueda.listo && !frescos.length) {
    if (pasado > 45) { caja.innerHTML = '<div class="vacio">No llegó ninguna búsqueda. Prueba otra vez.</div>'; busqueda = null; return; }
    caja.innerHTML = `<div class="buscando"><span class="giro"></span>Buscando… ${Math.round(pasado)} s (Píxel mira cada 30 s)</div>`;
    return;
  }
  busqueda.listo = true;
  const mapa = new Map();
  conBle.forEach((x) => x.ble.vistos.forEach((v) => { const p = mapa.get(v.mac); if (!p || v.rssi > p.rssi) mapa.set(v.mac, v); }));
  const lista = [...mapa.values()].sort((a, b) => b.rssi - a.rssi);
  caja.innerHTML = lista.length
    ? `<div class="sub">Encontrados ${lista.length}, del más cercano al más lejano</div><div class="lista">${lista.map(filaEncontradoBle).join("")}</div>`
    : '<div class="vacio">No encontró dispositivos cerca.</div>';
}

function filaWifi(x) {
  const detalle = [TIPO[x.tipo] || "Aparato", x.fabricante, x.modelo].filter(Boolean).map(esc).join(" · ");
  const boton = x.tipo === "router" || x.tipo === "pixel" ? ""
    : x.agregado ? '<span class="chip ok">Agregado</span>'
    : `<button class="btn primario" type="button" data-wifi-agregar="${esc(x.mac)}">Agregar</button>`;
  return `<div class="fila" data-mac="${esc(x.mac)}"><span class="ico verde">${icono(ICONO_TIPO(x.tipo))}</span>
    <div class="txt"><b>${esc(x.nombre || "Sin nombre")}</b><small>${detalle} · <span class="mono">${esc(x.ip)}</span></small></div>${boton}</div>`;
}

function pintarWifi(w) {
  const enc = $("#wifi-encabezado"), lista = $("#wifi-encontrados");
  if (w.estado === "buscando") {
    enc.innerHTML = `<div class="grupo"><div class="buscando" style="padding:0"><span class="giro"></span>${esc(w.fase)}</div>${progreso(wifiDesde || Date.now() - (w.hace || 0) * 1000, 14)}</div>`;
  } else if (w.estado === "error") {
    enc.innerHTML = `<p class="aviso">${esc(w.fase)}</p><div class="acciones"><button class="btn suave" type="button" data-wifi-buscar>Buscar otra vez</button></div>`;
  } else {
    enc.innerHTML = `<div class="cabecera"><p class="sub">${w.estado === "listo" ? `Encontré ${w.encontrados.length} aparato${w.encontrados.length === 1 ? "" : "s"} en tu red (${esc(w.red)}).` : ""}</p>
      <button class="btn suave" type="button" data-wifi-buscar>Buscar otra vez</button></div>`;
  }
  if (wifiForm) return;
  const nuevos = w.encontrados.filter((x) => !x.agregado && x.tipo !== "router" && x.tipo !== "pixel");
  const ya = w.encontrados.filter((x) => x.agregado), otros = w.encontrados.filter((x) => x.tipo === "router" || x.tipo === "pixel");
  const grupo = (titulo, xs) => (xs.length ? `<div class="grupo"><h3>${titulo}</h3><div class="lista">${xs.map(filaWifi).join("")}</div></div>` : "");
  lista.innerHTML = w.estado !== "listo" ? ""
    : (grupo("Para agregar", nuevos) || '<div class="vacio">No encontré aparatos nuevos en tu red.</div>') + grupo("Ya agregados", ya) + grupo("También en tu red", otros);
}

function pintarHoja(d) {
  if (!$("#agregar").open) return;
  if (paso === "bt") { pintarBt(d.bt_pc); pintarBusquedaBle(d); }
  if (paso === "wifi") pintarWifi(d.wifi.busqueda);
}

// ------------------------------------------------------------------ cuentas, agenda y agente
function filaAgenda(item, tipo) {
  return `<div class="fila"><div class="txt"><b>${esc(item.texto)}</b><small>${esc(item.dicho)}</small></div>
    <button class="btn peligro" type="button" data-borrar="${tipo}" data-id="${item.id}">Borrar</button></div>`;
}

// Gemini con error: el ultimo fallo es mas reciente que la ultima respuesta buena
function geminiConError(gm) {
  return !!(gm && gm.configurada && gm.error && (gm.hace_ok === null || gm.hace_error < gm.hace_ok));
}

function pintarGemini(gm) {
  if (!gm) return;                      // servidor anterior a la Fase 11
  const mal = geminiConError(gm);
  $("#gm-chip").textContent = !gm.configurada ? "Sin clave" : mal ? "Con error" : "Activa";
  $("#gm-chip").className = "chip" + (!gm.configurada ? "" : mal ? " warn" : " ok");
  $("#gm-info").textContent = (gm.configurada ? `Responde ${gm.modelo}. Si falla, responde la IA local.` : "Ahora responde la IA local del PC.")
    + (EN_INTERNET ? " La clave se pone desde el panel del PC, en tu red." : "");
  $("#gm-aviso").hidden = !mal;
  $("#gm-aviso").textContent = mal ? "Último error: " + gm.error : "";
  $("#f-gemini").hidden = EN_INTERNET;  // la clave nunca viaja por la nube
  $("#gm-probar").disabled = !gm.configurada;
  $("#gm-quitar").hidden = !gm.configurada;
}

function pintarResto(d) {
  pintarGemini(d.cuentas.gemini);
  const g = d.cuentas.google, chip = $("#g-chip"), boton = $("#g-vincular"), aviso = $("#g-aviso");
  chip.textContent = g.vinculada ? "Vinculada" : g.estado === "esperando" ? "Esperando en el navegador" : "No vinculada";
  chip.className = "chip" + (g.vinculada ? " ok" : g.estado === "esperando" ? " warn" : "");
  boton.disabled = !g.credenciales || g.estado === "esperando";
  boton.textContent = g.vinculada ? "Volver a vincular" : "Vincular con Google";
  aviso.hidden = g.credenciales && g.estado !== "error";
  aviso.textContent = g.estado === "error" ? "No se pudo vincular: " + g.error
    : "Antes hay que crear las credenciales en Google Cloud y guardarlas como google_cliente.json en la carpeta del asistente.";
  $("#lista-contactos").innerHTML = d.cuentas.contactos.length ? d.cuentas.contactos.map((c) => `
    <div class="fila"><div class="txt"><b>${esc(c.nombre)}</b><small class="mono">${esc(c.correo)}</small></div>
    <button class="btn peligro" type="button" data-borrar-contacto="${esc(c.nombre)}">Quitar</button></div>`).join("")
    : '<div class="vacio">Aún no hay contactos.</div>';
  if (EN_INTERNET) return;                // la agenda y la Personalidad de la app son de Pixel en este celular (agente.js)

  const nr = d.agenda.recordatorios.length, ne = d.agenda.eventos.length;
  $("#lista-recordatorios").innerHTML = nr ? d.agenda.recordatorios.map((r) => filaAgenda(r, "recordatorio")).join("") : '<div class="vacio">No hay recordatorios pendientes.</div>';
  $("#lista-eventos").innerHTML = ne ? d.agenda.eventos.map((e) => filaAgenda(e, "evento")).join("") : '<div class="vacio">No hay eventos desde hoy.</div>';

  $("#salida-pc-nota").textContent = "ahora: " + d.bt_pc.musica_en;
  // el formulario se repinta si los ajustes cambian en el servidor, salvo que se este editando:
  // pintado una sola vez, un "Guardar" despues devolvia los valores viejos (asi volvio la voz al PC)
  const firma = JSON.stringify(d.agente.ajustes);
  if (firma !== agenteFirma && !agenteTocado) {
    const a = d.agente.ajustes;
    $("#activacion").textContent = d.agente.activacion;
    $("#voces").innerHTML = d.agente.voces.map((v) => `<label class="voz"><input type="radio" name="voz" value="${esc(v.id)}" ${v.id === a.voz ? "checked" : ""}><span>${esc(v.nombre)}</span></label>`).join("");
    $("#personalidad").value = a.personalidad;
    document.querySelectorAll("input[name=respuesta]").forEach((r) => { r.checked = r.value === a.respuesta; });
    document.querySelectorAll("input[name=salida_voz]").forEach((r) => { r.checked = r.value === a.salida_voz; });
    document.querySelectorAll("input[name=tono]").forEach((r) => { r.checked = r.value === (a.tono || "normal"); });
    contar();
    agenteFirma = firma;
  }
}

let pintadoNube = "";
function pintarNube(d) {
  const n = (d && d.nube) || {activa: false, duenos: []};
  const chip = $("#nube-chip");
  let h = "";
  if (EN_INTERNET) {
    const u = nube.usuario, conectado = !!nube.pid && nube.enLinea;
    chip.textContent = !u ? "Sin sesión" : !nube.pid ? "PC sin enlazar" : conectado ? "PC conectado" : "PC desconectado";
    chip.className = "chip" + (conectado ? " ok" : nube.pid ? " warn" : "");
    if (u) h += `<div class="fila"><span class="ico">${icono("pixel")}</span><div class="txt"><small>Sesión iniciada como</small><b>${esc(u.displayName || u.email || "anónimo")}</b>${u.email && u.displayName ? `<small>${esc(u.email)}</small>` : ""}</div>
      <button class="btn" type="button" data-salir>Cerrar sesión</button></div>`;
    h += nube.pid
      ? `<p class="sub">Este celular ya es Píxel. Además, esta cuenta maneja <b>${esc(n.nombre || "el Píxel del PC")}</b> (ESP32 y panel) desde cualquier sitio con internet.</p>`
      : '<p class="sub">Este celular ya es Píxel: no necesita el PC. Si también tienes el Píxel del PC, con el ESP32, puedes enlazarlo para manejarlo desde aquí.</p>';
    if (u && !nube.pid) h += '<div class="acciones"><button class="btn suave" type="button" data-buscar-pixel>Enlazar el Píxel del PC</button></div>';
  } else {
    chip.textContent = !n.activa ? "Desactivada" : n.conectada ? "Conectada" : "Sin conexión";
    chip.className = "chip" + (n.conectada ? " ok" : n.activa ? " warn" : "");
    h += `<p class="sub">En el móvil abre <b>${URL_APP}</b>, entra con Google, toca <b>Buscar a Píxel</b> y escribe el código que diga Píxel.</p>`;
    if (n.activa && !n.conectada) h += `<p class="aviso">Sin conexión con la nube: ${esc(n.error || "¿hay internet?")}</p>`;
    if (n.enlace) {
      h += `<div class="codigo-grande"><small>Código para enlazar</small><b>${esc(n.enlace.codigo.replace(/(\d{3})(\d{3})/, "$1 $2"))}</b>
        <small>válido ${Math.max(1, Math.ceil(n.enlace.quedan_s / 60))} min</small></div>
        <div class="acciones"><button class="btn suave" type="button" data-nube="decir">Que lo diga en voz alta</button></div>`;
    } else if (n.conectada) {
      h += '<div class="acciones"><button class="btn primario" type="button" data-nube="enlazar">Enlazar otra app</button></div>';
    }
  }
  const apps = n.duenos || [];
  h += apps.length ? `<h3>Cuentas enlazadas</h3><div class="lista">${apps.map((a) => `<div class="fila"><span class="ico">${icono("movil")}</span>
      <div class="txt"><b>${esc(a.nombre)}</b><small>enlazada ${a.desde ? "el " + new Date(a.desde).toLocaleDateString("es") : ""}</small></div>
      ${a.uid === nube.uid ? '<span class="chip info">Tu cuenta</span>' : ""}
      <button class="btn peligro" type="button" data-nube-quitar="${esc(a.uid)}">${a.uid === nube.uid ? "Desenlazar" : "Quitar"}</button></div>`).join("")}</div>`
    : n.activa && !EN_INTERNET ? '<div class="vacio">Todavía no hay ninguna cuenta enlazada.</div>' : "";
  if (h !== pintadoNube) { $("#nube-cuerpo").innerHTML = h; pintadoNube = h; }   // sin repintar botones a cada rato
}

// ------------------------------------------------------------------ refresco
function pintar(d) {
  datos = d;
  const op = d.bt_pc.operacion, clave = op.accion + op.mac + op.estado + op.hace;
  if (ultimaOp && op.estado === "ok" && op.accion === "emparejar" && !ultimaOp.startsWith("emparejar" + op.mac + "ok")) {
    const x = d.bt_pc.dispositivos.find((y) => y.mac === op.mac);
    feliz(`¡Listo! Ya conozco ${x ? "a " + x.nombre : "ese aparato"}`);
  }
  ultimaOp = clave;
  pill("#pill-servidor", "ok", EN_INTERNET ? "PC · " + (d.nube.nombre || "Píxel") : "Servidor · " + d.servidor.ip);
  if (!EN_INTERNET) {                     // en la app de internet, las de microfono e IA son de agente.js
    pill("#pill-esp", d.activos ? "ok" : "warn", d.activos ? (d.activos === 1 ? "ESP32 conectado" : d.activos + " ESP32") : "ESP32 sin conectar");
    const gm = d.cuentas.gemini;
    if (gm && gm.configurada) pill("#pill-ollama", geminiConError(gm) ? "warn" : "ok", geminiConError(gm) ? "Gemini con error" : "IA: Gemini");
    else pill("#pill-ollama", d.servidor.ollama ? "ok" : "warn", d.servidor.ollama ? "IA local lista" : "IA local apagada");
  }
  pintarInicio(d);
  pintarDispositivos(d);
  pintarHoja(d);
  pintarResto(d);
  pintarNube(d);
  if (EN_INTERNET) revisarNube();
}

let temporizador = null;
async function refrescar() {
  clearTimeout(temporizador);
  const abierta = $("#agregar").open && (paso === "bt" || paso === "wifi");
  temporizador = setTimeout(refrescar, abierta ? 1500 : 3000);
  if (EN_INTERNET) {                     // el estado llega solo por la nube; aqui solo latido y avisos
    if (nube.pid && Date.now() - nube.latidoT > 20000) latido();
    revisarNube();
    if (nube.estado) pintarHoja(nube.estado);
    if ($("#enlazar").open) pintarVisibles();
    return;
  }
  try {
    const r = await llamar("/api/estado");
    if (!r.ok) throw new Error("HTTP " + r.status);
    pintar(await r.json());
  } catch (e) {
    pill("#pill-servidor", "warn", "Servidor sin respuesta");
    if (cara) cara.estado("sin-servidor");
    $("#zzz").hidden = true;
    $("#latido").className = "latido";
    $("#hero-estado").textContent = "No encuentro el servidor";
    $("#hero-sub").textContent = "Arráncalo en el PC: .venv/bin/python servidor.py";
  }
}

// ------------------------------------------------------------------ la nube (app en internet)
function errorNube(e) {
  nube.error = (e && (e.code || e.message)) || "error";
  console.warn("nube:", e);
  revisarNube();
}

async function iniciarNube() {
  try {
    const [a, au, d] = await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-database.js"].map((m) => import(SDK + m)));
    const app = a.initializeApp(NUBE);
    Object.assign(nube, {d, au, auth: au.getAuth(app), db: d.getDatabase(app), error: ""});
    d.onValue(d.ref(nube.db, ".info/serverTimeOffset"), (s) => { nube.offset = s.val() || 0; });
    // Fase 12: Pixel vive en este celular (agente.js); el Pixel del PC se enlaza aparte, si se quiere
    const s = document.createElement("script");
    s.src = "agente.js";
    s.onload = () => window.Agente.iniciar(app);
    s.onerror = () => toast("No pude cargar a Píxel en este celular. Recarga la página.", true);
    document.head.append(s);
    au.onAuthStateChanged(nube.auth, sesion);          // la sesion de Google se recuerda en este navegador
    if (PRUEBA_ANONIMA) au.signInAnonymously(nube.auth).catch(errorNube);
  } catch (e) { errorNube(e); }
}

function sesion(u) {
  nube.quitar.forEach((f) => f());
  if (nube.quitarMios) nube.quitarMios();
  Object.assign(nube, {usuario: u, uid: u ? u.uid : "", quitar: [], quitarMios: null, mios: null, pid: null, estado: null, vivo: 0});
  if (window.Agente) window.Agente.usuario(u);
  if (!u) { revisarNube(); return; }
  nube.quitarMios = nube.d.onValue(nube.d.ref(nube.db, `usuarios/${nube.uid}/pixeles`), (s) => { nube.mios = s.val() || {}; elegirPixel(); }, errorNube);
}

async function entrar() {
  try {
    await nube.au.signInWithPopup(nube.auth, new nube.au.GoogleAuthProvider());
  } catch (e) {
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    toast(e.code === "auth/popup-blocked" ? "El navegador bloqueó la ventana de Google: permítela y toca Entrar otra vez."
      : e.code === "auth/operation-not-allowed" ? "Falta activar el acceso con Google en Firebase."
      : "No pude entrar: " + (e.code || e.message), true);
  }
}

function elegirPixel() {
  // Fase 13: los ESP32 puente (tipo "puente") tambien estan en usuarios/<uid>/pixeles, pero no son el
  // Pixel del PC: de esos se encarga aparatos.js
  const ids = Object.keys(nube.mios || {}).filter((pid) => !(nube.mios[pid] && nube.mios[pid].tipo === "puente"));
  let guardado = "";
  try { guardado = localStorage.getItem("pixel.elegido") || ""; } catch (e) { guardado = ""; }
  const pid = ids.includes(guardado) ? guardado : ids[0] || "";
  if (pid === nube.pid) { revisarNube(); return; }
  nube.quitar.forEach((f) => f());
  Object.assign(nube, {quitar: [], pid, estado: null, vivo: 0});
  if (!pid) { revisarNube(); return; }      // sin Pixel del PC tambien se puede: este celular es Pixel
  const d = nube.d;
  nube.quitar.push(d.onValue(d.ref(nube.db, `pixeles/${pid}/estado`), (s) => {
    const v = s.val();
    if (!v || !v.json) return;
    try { nube.estado = JSON.parse(v.json); } catch (e) { return; }
    pintar(nube.estado);
  }, errorNube));
  nube.quitar.push(d.onValue(d.ref(nube.db, `pixeles/${pid}/vivo`), (s) => { nube.vivo = s.val() || 0; revisarNube(); }, errorNube));
  nube.quitar.push(d.onValue(d.ref(nube.db, `pixeles/${pid}/voz`), (s) => {
    const v = s.val();
    if (!v || !v.json) return;
    try { voz.segmentos = JSON.parse(v.json); voz.recibida = Date.now(); } catch (e) { /* trozo roto: se ignora */ }
  }, errorNube));
  latido();
}

function latido() {                       // "la app esta abierta": Pixel publica su estado mas a menudo
  if (!nube.pid) return;
  nube.latidoT = Date.now();
  nube.d.set(nube.d.ref(nube.db, `pixeles/${nube.pid}/mirando/${nube.uid}`), nube.d.serverTimestamp()).catch(() => {});
}

function revisarNube() {
  if (!EN_INTERNET) return;
  const hero = (titulo, sub) => {
    if (Date.now() > dichoHasta) { $("#hero-estado").textContent = titulo; $("#hero-sub").textContent = sub; }
    $("#latido").className = "latido";
  };
  const acciones = $("#hero-acciones");
  acciones.hidden = !nube.d || !!nube.usuario;          // con sesion, Inicio es de Pixel en este celular
  if (!nube.usuario) acciones.innerHTML = '<button class="btn primario grande" type="button" data-entrar>Entrar con Google</button>';
  if (!nube.d) {
    pill("#pill-servidor", "warn", nube.error ? "Sin nube" : "Conectando…");
    if (cara) cara.estado("esperando");
    hero(nube.error ? "No pude conectar con la nube" : "Conectando…", nube.error ? "¿Tienes internet? Recarga la página para intentarlo otra vez." : "Un momento.");
    return;
  }
  if (!nube.usuario) {
    pill("#pill-servidor", "warn", "Sin sesión");
    pill("#pill-esp", "", "Micrófono apagado");
    pill("#pill-ollama", "", "IA: Gemini");
    if (cara) cara.estado("esperando");
    $("#zzz").hidden = !cara;
    hero("¡Hola! Soy Píxel", "Entra con tu cuenta de Google y háblame: vivo en este celular.");
    pintarNube(null);
    return;
  }
  // el Pixel del PC (ESP32 y panel) es opcional: solo su pildora y la tarjeta de Cuentas
  // en Cuentas, Gemini, Google y los contactos son del Pixel del PC: sin el, no se ensenan
  ["#card-gemini", "#card-google", "#card-contactos"].forEach((id) => { $(id).hidden = !nube.estado; });
  nube.enLinea = !!nube.pid && !!nube.vivo && Date.now() + nube.offset - nube.vivo < 40000;
  pill("#pill-servidor", !nube.pid ? "" : nube.enLinea ? "ok" : "warn",
    !nube.pid ? "PC sin enlazar" : nube.enLinea ? "PC · " + ((nube.estado && nube.estado.nube.nombre) || "Píxel") : "PC desconectado");
  pintarNube(nube.estado);
}

function ordenNube(ruta, cuerpo) {
  if (!nube.pid) return Promise.reject(new Error("Primero enlaza esta app con Píxel."));
  const d = nube.d, r = d.push(d.ref(nube.db, `pixeles/${nube.pid}/ordenes`));
  return d.set(r, {uid: nube.uid, ruta, cuerpo: JSON.stringify(cuerpo || {}), t: d.serverTimestamp()})
    .then(() => esperarRespuesta(nube.pid, r.key, "", 25000));
}

function esperarRespuesta(pid, clave, n, ms) {
  const d = nube.d;
  return new Promise((bien, mal) => {
    let quitar = () => {};
    const reloj = setTimeout(() => { quitar(); mal(new Error("Píxel no contestó. ¿Está encendido y con internet?")); }, ms);
    quitar = d.onValue(d.ref(nube.db, `pixeles/${pid}/respuestas/${clave}`), (s) => {
      const v = s.val();
      if (!v || (n && v.n !== n)) return;           // aun no, o la respuesta de un intento anterior
      clearTimeout(reloj); quitar();
      if (v.ok) bien(v); else mal(new Error(v.error || "No se pudo."));
    }, (e) => { clearTimeout(reloj); mal(new Error("Sin permiso: " + (e.code || e.message))); });
  });
}

// ------------------------------------------------------------------ enlazar (como Alexa)
let enlazando = null;          // {pid, nombre} del Pixel elegido en la lista

function nombreApp() {
  const u = nube.usuario, ua = navigator.userAgent;
  return ((u && (u.displayName || u.email)) || (/iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Móvil Android" : "Navegador")).slice(0, 40);
}

function pasoEnlace(p) {
  ["buscar", "codigo", "listo"].forEach((x) => { $("#enlazar-" + x).hidden = x !== p; });
  $("#enlazar-atras").hidden = p !== "codigo";
  $("#enlazar-titulo").textContent = p === "buscar" ? "Buscar a Píxel" : p === "codigo" ? "Enlazar con Píxel" : "¡Enlazados!";
}

function abrirEnlazar() {
  if (!nube.usuario) { if (nube.d) entrar(); return; }
  const dlg = $("#enlazar");
  pasoEnlace("buscar");
  if (!dlg.open) dlg.showModal();
  if (nube.d && !nube.quitarVisibles) {
    nube.quitarVisibles = nube.d.onValue(nube.d.ref(nube.db, "visibles"), (s) => { nube.visibles = s.val() || {}; pintarVisibles(); }, errorNube);
  }
  pintarVisibles();
}

function pintarVisibles() {
  const ahora = Date.now() + nube.offset;
  const lista = Object.entries(nube.visibles || {}).filter(([, v]) => v && v.hasta > ahora);
  $("#lista-visibles").innerHTML = !nube.d
    ? `<div class="buscando"><span class="giro"></span>${nube.error ? "No pude conectar con la nube. ¿Tienes internet?" : "Conectando con la nube…"}</div>`
    : lista.length ? `<div class="lista">${lista.map(([pid, v]) => `<div class="fila"><span class="ico">${icono("pixel")}</span>
        <div class="txt"><b>${esc(v.nombre)}</b><small>Esperando a enlazarse</small></div>
        ${nube.mios && nube.mios[pid] ? '<span class="chip ok">Ya enlazado</span>'
          : `<button class="btn primario" type="button" data-enlazar="${esc(pid)}" data-nombre="${esc(v.nombre)}">Enlazar</button>`}</div>`).join("")}</div>`
    : `<div class="buscando"><span class="giro"></span>Buscando a Píxel…</div>
       <p class="sub">Su servidor tiene que estar encendido en el PC y con internet. Si ya está enlazado con otra app, en el PC abre el panel → Cuentas → <b>Enlazar otra app</b>.</p>`;
}

async function pedirAPixel(codigo) {
  const n = Math.random().toString(36).slice(2, 12);
  const d = nube.d;
  await d.set(d.ref(nube.db, `pixeles/${enlazando.pid}/solicitudes/${nube.uid}`), {codigo, n, nombre: nombreApp()});
  return esperarRespuesta(enlazando.pid, "enlace-" + nube.uid, n, 15000);
}

async function decirCodigo() {
  const aviso = $("#enlazar-nota");
  aviso.textContent = "Pidiéndole a Píxel que diga el código…";
  try {
    const r = await pedirAPixel("");
    aviso.textContent = r.dicho ? "🔊 Escucha a Píxel y escribe el código." : r.mensaje;
  } catch (e) { aviso.textContent = e.message; }
}
// ------------------------------------------------------------------ eventos
function contar() { $("#contador").textContent = $("#personalidad").value.length + " / 300"; }
$("#personalidad").addEventListener("input", contar);
$("#presets").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-texto]"); if (!b) return;
  $("#personalidad").value = b.dataset.texto; contar();
});
function datosAgente() {
  const voz = document.querySelector("input[name=voz]:checked"), resp = document.querySelector("input[name=respuesta]:checked");
  const salida = document.querySelector("input[name=salida_voz]:checked"), tono = document.querySelector("input[name=tono]:checked");
  return {voz: voz && voz.value, respuesta: resp && resp.value, personalidad: $("#personalidad").value, salida_voz: salida ? salida.value : "esp32",
    tono: tono ? tono.value : undefined};
}
$("#f-agente").addEventListener("input", () => { agenteTocado = true; });
$("#f-agente").addEventListener("change", () => { agenteTocado = true; });
// en la app de internet la Personalidad es la de Pixel en este celular (agente.js); en el panel, la del PC
$("#f-agente").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (EN_INTERNET) { if (window.Agente) window.Agente.guardarAjustes(datosAgente()); return; }
  if (await enviar("/api/agente", datosAgente())) agenteTocado = false;
});
$("#guardar-probar").addEventListener("click", async () => {
  if (EN_INTERNET) { if (window.Agente) { await window.Agente.guardarAjustes(datosAgente()); window.Agente.probar(); } return; }
  if (await enviar("/api/agente", datosAgente())) { agenteTocado = false; enviar("/api/agente/probar"); }
});
$("#f-contacto").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await enviar("/api/contactos", {nombre: $("#c-nombre").value, correo: $("#c-correo").value})) { $("#c-nombre").value = ""; $("#c-correo").value = ""; }
});
$("#g-vincular").addEventListener("click", () => enviar("/api/google/vincular"));
$("#f-gemini").addEventListener("submit", async (e) => {
  e.preventDefault();
  const clave = $("#gm-clave").value.trim();
  if (!clave) { toast("Pega primero la clave.", true); return; }
  toast("Guardando y probando la clave…");
  await enviar("/api/gemini/clave", {clave});
  $("#gm-clave").value = "";            // que la clave no se quede en la pantalla
});
$("#gm-probar").addEventListener("click", () => { toast("Probando Gemini…"); enviar("/api/gemini/probar"); });
$("#gm-quitar").addEventListener("click", () => {
  if (confirm("¿Quitar la clave de Gemini? Píxel volverá a usar la IA local.")) enviar("/api/gemini/clave", {clave: ""});
});

const hoja = $("#agregar");
hoja.addEventListener("click", (e) => { if (e.target === hoja) hoja.close(); });
hoja.addEventListener("close", () => { wifiForm = null; aceptando = null; });
$("#agregar-atras").addEventListener("click", () => irA("elegir"));

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("[data-buscar-pixel]")) { abrirEnlazar(); return; }
  if (t.closest("[data-entrar]")) { entrar(); return; }
  if (t.closest("[data-salir]")) { if (confirm("¿Cerrar sesión en este navegador?")) nube.au.signOut(nube.auth); return; }
  const en = t.closest("[data-enlazar]");
  if (en) {
    enlazando = {pid: en.dataset.enlazar, nombre: en.dataset.nombre};
    $("#enlazar-nombre").textContent = enlazando.nombre;
    $("#codigo").value = ""; $("#enlazar-error").hidden = true;
    pasoEnlace("codigo");
    $("#codigo").focus();
    decirCodigo();
    return;
  }
  if (t.closest("#b-decir")) { decirCodigo(); return; }
  if (t.closest("#enlazar-atras")) { pasoEnlace("buscar"); return; }
  if (t.closest("[data-cerrar-enlazar]")) { $("#enlazar").close(); return; }
  const nb = t.closest("[data-nube]");
  if (nb) { enviar("/api/nube/" + nb.dataset.nube); return; }
  const nq = t.closest("[data-nube-quitar]");
  if (nq) {
    const propia = nq.dataset.nubeQuitar === nube.uid;
    if (confirm(propia ? "¿Desenlazar tu cuenta de Píxel?" : "¿Quitar esa cuenta? Ya no podrá manejar a Píxel.")) enviar("/api/nube/quitar", {uid: nq.dataset.nubeQuitar});
    return;
  }
  if (t.closest("[data-agregar]")) { hoja.showModal(); irA("elegir"); return; }
  if (t.closest("[data-cerrar]")) { hoja.close(); return; }
  const p = t.closest("[data-paso]");
  if (p) { irA(p.dataset.paso); return; }
  if (t.closest("[data-probar]")) { if (EN_INTERNET && window.Agente) window.Agente.probar(); else enviar("/api/agente/probar"); }
  const b = t.closest("[data-borrar]");
  if (b) enviar("/api/agenda/borrar", {tipo: b.dataset.borrar, id: Number(b.dataset.id)});
  const c = t.closest("[data-borrar-contacto]");
  if (c) enviar("/api/contactos/borrar", {nombre: c.dataset.borrarContacto});
  if (t.closest("[data-bt-iniciar]")) { iniciarBt(); return; }
  const vz = t.closest("[data-voz]");
  if (vz && datos) { enviar("/api/agente", Object.assign({}, datos.agente.ajustes, {salida_voz: vz.dataset.voz})); return; }
  const pr = t.closest("[data-probar-en]");
  if (pr) { enviar("/api/agente/probar", {donde: pr.dataset.probarEn}); return; }
  const bt = t.closest("[data-bt]");
  if (bt && !bt.disabled) {
    if (bt.dataset.bt === "olvidar" && !confirm("¿Olvidar este dispositivo? Habrá que emparejarlo otra vez.")) return;
    enviar("/api/bt/" + bt.dataset.bt, {mac: bt.dataset.mac || ""}, bt.dataset.bt === "emparejar");
    return;
  }
  if (t.closest("[data-wifi-buscar]")) { wifiDesde = Date.now(); wifiForm = null; enviar("/api/wifi/buscar", {}, true); return; }
  const wa = t.closest("[data-wifi-agregar]");
  if (wa && datos) {
    const x = datos.wifi.busqueda.encontrados.find((y) => y.mac === wa.dataset.wifiAgregar);
    if (!x) return;
    wifiForm = x.mac;
    wa.closest(".fila").innerHTML = `<form class="form-linea" data-wifi-form="${esc(x.mac)}">
      <span class="ico verde">${icono(ICONO_TIPO(x.tipo))}</span>
      <input type="text" id="wifi-nombre" maxlength="40" required value="${esc(x.nombre || TIPO[x.tipo] || "")}" placeholder="Luz del salón" aria-label="Nombre">
      <select id="wifi-tipo" aria-label="Tipo">${TIPOS_WIFI.map((k) => `<option value="${k}" ${k === x.tipo ? "selected" : ""}>${TIPO[k]}</option>`).join("")}</select>
      <button class="btn primario" type="submit">Guardar</button><button class="btn" type="button" data-wifi-cancelar>Cancelar</button></form>`;
    $("#wifi-nombre").select();
    return;
  }
  if (t.closest("[data-wifi-cancelar]")) { wifiForm = null; if (datos) pintarWifi(datos.wifi.busqueda); return; }
  if (t.closest("#b-buscar")) {
    busqueda = {t0: Date.now(), listo: false}; aceptando = null;
    $("#busqueda").innerHTML = '<div class="buscando"><span class="giro"></span>Buscando…</div>';
    refrescar();
    return;
  }
  const a = t.closest("[data-aceptar]");
  if (a) {
    aceptando = a.dataset.aceptar;
    a.closest(".fila").innerHTML = `<form class="form-linea" data-ble-form="${esc(aceptando)}">
      <input type="text" id="nombre-disp" maxlength="40" required value="${esc(a.dataset.nombre || "")}" placeholder="Mi reloj" aria-label="Nombre para ${esc(aceptando)}">
      <button class="btn primario" type="submit">Guardar</button><button class="btn" type="button" data-cancelar>Cancelar</button></form>`;
    $("#nombre-disp").focus();
    return;
  }
  if (t.closest("[data-cancelar]")) { aceptando = null; refrescar(); return; }
  const o = t.closest("[data-olvidar]");
  if (o && confirm("¿Olvidar este dispositivo?")) enviar("/api/dispositivos/olvidar", {mac: o.dataset.olvidar});
});

$("#enlazar-codigo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const codigo = $("#codigo").value.replace(/\D/g, "");
  const error = $("#enlazar-error");
  if (codigo.length !== 6) { error.hidden = false; error.textContent = "El código tiene 6 cifras."; return; }
  error.hidden = true;
  try {
    await pedirAPixel(codigo);
    try { localStorage.setItem("pixel.elegido", enlazando.pid); } catch (err) { /* sin almacenamiento */ }
    pasoEnlace("listo");
    feliz("¡Hola! Ya estamos enlazados");
    setTimeout(() => { if ($("#enlazar").open) $("#enlazar").close(); }, 1800);
  } catch (err) { error.hidden = false; error.textContent = err.message; }
});
$("#enlazar").addEventListener("close", () => {
  if (nube.quitarVisibles) { nube.quitarVisibles(); nube.quitarVisibles = null; }
});
$("#pill-servidor").addEventListener("click", () => { if (EN_INTERNET) abrirEnlazar(); else location.hash = "#dispositivos"; });

document.addEventListener("submit", async (e) => {
  const fw = e.target.closest("[data-wifi-form]");
  if (fw) {
    e.preventDefault();
    const x = datos.wifi.busqueda.encontrados.find((y) => y.mac === fw.dataset.wifiForm);
    const nombre = $("#wifi-nombre").value;
    wifiForm = null;
    if (x && await enviar("/api/wifi/agregar", {mac: x.mac, ip: x.ip, nombre, tipo: $("#wifi-tipo").value})) feliz(`¡Listo! Ya conozco ${nombre}`);
    return;
  }
  const fb = e.target.closest("[data-ble-form]");
  if (fb) {
    e.preventDefault();
    const nombre = $("#nombre-disp").value;
    aceptando = null;
    if (await enviar("/api/dispositivos/aceptar", {mac: fb.dataset.bleForm, nombre})) feliz(`¡Listo! Recordaré ${nombre}`);
  }
});

if (EN_INTERNET) {
  const op = document.querySelector('[data-paso="pixel"]');
  op.querySelector("b").textContent = "Enlazar un Píxel";
  op.querySelector("small").textContent = "Búscalo y escribe el código que te diga.";
  iniciarNube();
}
vista();
refrescar();
