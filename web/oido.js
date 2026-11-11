/* Fase 11 - El celular como microfono y altavoz del Pixel del PC (restaurada el 11 nov; el usuario:
   "lo del celular es clave! no se puede quitar!"). Se habia quitado en la Fase 12 (commit 2ec254d) al
   poner a Pixel entero en la app; el servidor lo seguia soportando (servidor.SesionMovil y nube.py).
   - Con "Usar el PC", el celular hace de ESP32 remoto: corta las frases con un VAD por energia (los mismos
     tiempos que servidor.py), las pasa a PCM 16 kHz y las deja en pixeles/<pid>/frases. El PC las trata
     como las del ESP32 ("Píxel", acciones, su IA) y deja su voz en pixeles/<pid>/habla/<uid>: aqui se toca
     en orden y, mientras suena, el micro no capta.
   - Sirve sin clave de IA en la app: piensa el PC (su Gemini u Ollama) y hace lo del PC (musica, YouTube...).
   - Es una cosa u otra: al usar el PC se para la escucha de Pixel en el celular (agente.js), y al tocar su
     "Escuchar" se para esto.
   - Las reglas (database.rules.json: frases, escuchando, habla) tienen que estar publicadas.
   Va despues de app.js (usa nube, $, esc, cara, EN_INTERNET). */
"use strict";
(function () {
  const OIDO = {
    TRAMA: 320,             // 20 ms a 16 kHz
    CALIB: 25,              // 500 ms para medir el ruido de fondo (mediana)
    MULT: 3.5, MIN_RMS: 300, MAX_RMS: 4000,      // MIN_RMS mas bajo que el del ESP32: el celular trae control de ganancia
    PISO_BAJA: 0.05, PISO_SUBE: 0.002,           // fuera de las frases el piso sigue al ruido
    ABRIR: 3, CERRAR: 35, PREROLL: 15,           // 60 ms de voz abren, 700 ms de silencio cierran, 300 ms de antes
    MIN_TRAMAS: 15, MAX_TRAMAS: 500,             // de 300 ms a 10 s
    MIN_VOZ: 8,             // 11 nov: y al menos 160 ms con voz (sin contar el antes ni el silencio del final):
                            // un golpe no sube a Firebase (el ESP32 los manda por la red de casa y Whisper los tira)
    MARGEN_S: 0.35,         // tras la voz de Pixel, el micro sigue sordo este rato
    PENSAR_MS: 30000,       // como mucho, cuanto se muestra "pensando"
  };
  const oido = {activo: false, ctx: null, stream: null, fuente: null, nodo: null, mudo: null, remuestrear: null,
    trama: new Int16Array(OIDO.TRAMA), lleno: 0, calib: [], piso: 0, umbral: OIDO.MIN_RMS, enVoz: false, seguidas: 0,
    silencio: 0, frase: [], preroll: [], finVoz: 0, finHabla: 0, pensandoHasta: 0, nivel: 0, boca: [], quitar: null, pantalla: null,
    aviso: "", reloj: null, latido: null, refEscucha: null, enviadas: 0, oidas: 0};   // finVoz: acaba de sonar todo (micro sordo); finHabla: acaba la voz, sin beeps

  // ------------------------------------------------------------------ audio (puro: se prueba en Node)
  // Remuestreo a 16 kHz: paso bajo (FIR con ventana de Hamming) e interpolacion lineal, por bloques.
  // No se usa AudioContext({sampleRate: 16000}): Firefox no conecta el micro a un contexto con otra frecuencia.
  function remuestreador(origen) {
    const paso = origen / 16000, N = 31, m = (N - 1) / 2, corte = 7600 / origen, h = new Float32Array(N);
    let suma = 0;
    for (let i = 0; i < N; i++) {
      const x = i - m;
      h[i] = (x === 0 ? 2 * corte : Math.sin(2 * Math.PI * corte * x) / (Math.PI * x)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1)));
      suma += h[i];
    }
    for (let i = 0; i < N; i++) h[i] /= suma;
    let historia = new Float32Array(N - 1), anterior = 0, pos = 1;
    return (entrada) => {
      const buf = new Float32Array(historia.length + entrada.length);
      buf.set(historia);
      buf.set(entrada, historia.length);
      const f = new Float32Array(entrada.length + 1);      // f[0]: la ultima filtrada del bloque anterior
      f[0] = anterior;
      for (let k = 0; k < entrada.length; k++) {
        let s = 0;
        for (let j = 0; j < N; j++) s += h[j] * buf[k + j];
        f[k + 1] = s;
      }
      const salida = [];
      for (; pos <= f.length - 2; pos += paso) {
        const i = Math.floor(pos), fr = pos - i, v = f[i] * (1 - fr) + f[i + 1] * fr;
        salida.push(Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
      }
      pos -= f.length - 1;
      anterior = f[f.length - 1];
      historia = buf.slice(buf.length - (N - 1));
      return salida;
    };
  }

  function aBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // Corta frases: se le pasa cada trama (Int16Array de 320) y llama a alFrase(pcm) con cada frase cerrada.
  // sordo(): mientras suena Pixel no se capta.
  function cortador(alFrase, sordo) {
    const e = {calib: [], piso: 0, umbral: OIDO.MIN_RMS, enVoz: false, seguidas: 0, silencio: 0, frase: [], preroll: [], nivel: 0, conVoz: 0};
    const umbral = () => { e.umbral = Math.min(OIDO.MAX_RMS, Math.max(e.piso * OIDO.MULT, OIDO.MIN_RMS)); };
    function cerrar() {
      const tramas = e.frase, conVoz = e.conVoz;
      Object.assign(e, {frase: [], enVoz: false, seguidas: 0, silencio: 0, conVoz: 0});
      if (tramas.length < OIDO.MIN_TRAMAS || conVoz < OIDO.MIN_VOZ) return;
      const pcm = new Int16Array(tramas.length * OIDO.TRAMA);
      tramas.forEach((t, i) => pcm.set(t, i * OIDO.TRAMA));
      alFrase(pcm);
    }
    function trama(t) {
      let suma = 0;
      for (let i = 0; i < t.length; i++) suma += t[i] * t[i];
      const rms = Math.sqrt(suma / t.length);
      e.nivel = rms;
      if (sordo()) { Object.assign(e, {enVoz: false, frase: [], preroll: [], seguidas: 0, silencio: 0}); return; }
      if (!e.enVoz) {
        e.preroll.push(t);
        if (e.preroll.length > OIDO.PREROLL) e.preroll.shift();
      }
      if (e.calib.length < OIDO.CALIB) {
        e.calib.push(rms);
        if (e.calib.length === OIDO.CALIB) { e.piso = e.calib.slice().sort((a, b) => a - b)[OIDO.CALIB >> 1]; umbral(); }
        return;
      }
      const hayVoz = rms >= e.umbral;
      if (!e.enVoz) {
        e.piso += (rms - e.piso) * (rms < e.piso ? OIDO.PISO_BAJA : OIDO.PISO_SUBE);
        umbral();
        if (!hayVoz) { e.seguidas = 0; return; }
        if (++e.seguidas >= OIDO.ABRIR) Object.assign(e, {enVoz: true, silencio: 0, frase: e.preroll, preroll: [], conVoz: e.seguidas});
        return;
      }
      e.frase.push(t);
      e.silencio = hayVoz ? 0 : e.silencio + 1;
      if (hayVoz) e.conVoz++;
      if (e.silencio >= OIDO.CERRAR || e.frase.length >= OIDO.MAX_TRAMAS) cerrar();
    }
    return {trama, estado: e};
  }

  const texto = {remuestreador, aBase64, cortador, OIDO};
  if (typeof window === "undefined" || typeof document === "undefined" || typeof nube === "undefined") {
    if (typeof module !== "undefined") module.exports = {texto};
    return;
  }

  // ------------------------------------------------------------------ captar
  const agenteHabla = () => !!(window.Agente && window.Agente.nivelBoca() !== null);   // la voz de Pixel en el celular
  function sordo() { return (!!oido.ctx && oido.ctx.currentTime < oido.finVoz + OIDO.MARGEN_S) || agenteHabla(); }
  let corte = null;

  function procesar(e) {
    if (!oido.activo || document.hidden) return;        // en segundo plano (p. ej. YouTube abierto) no se capta
    const muestras = oido.remuestrear(e.inputBuffer.getChannelData(0));
    for (const v of muestras) {
      oido.trama[oido.lleno++] = v;
      if (oido.lleno === OIDO.TRAMA) { corte.trama(oido.trama.slice()); oido.lleno = 0; }
    }
  }

  function mandarFrase(pcm) {
    if (!nube.pid || !nube.enLinea) return;            // PC desconectado: que no se amontonen frases en la nube
    const d = nube.d, r = d.push(d.ref(nube.db, `pixeles/${nube.pid}/frases`));
    // Int16Array va en el orden de bytes del aparato: todos los celulares son little-endian, como el PCM del servidor
    d.set(r, {uid: nube.uid, pcm: aBase64(new Uint8Array(pcm.buffer)), t: d.serverTimestamp()})
      .then(() => { if (oido.aviso.startsWith("No pude mandar")) avisar(""); })
      .catch((e) => avisar("No pude mandar lo que dijiste al PC (" + (e.code || e.message) + ")."));
    oido.enviadas++;
  }

  // ------------------------------------------------------------------ la voz del PC
  // {tipo: "oido" | "voz" | "cierre" | "fin" | "video", pcm, dime, id, titulo}. "oido" es el beep de "te escuche".
  function alHabla(s) {
    const v = s.val();
    nube.d.remove(s.ref).catch(() => {});
    if (!v || !oido.activo) return;
    oido.oidas++;
    if (v.tipo === "video") { mostrarVideo(v.id, v.titulo); return; }
    if (v.tipo === "oido") oido.pensandoHasta = Date.now() + OIDO.PENSAR_MS;
    if (v.tipo === "voz" || v.tipo === "fin") oido.pensandoHasta = 0;
    // "Píxel" y sigue hablando: sin beep ni "Dime", que le cortarian la orden (como con el ESP32)
    if (!v.pcm || ((v.tipo === "oido" || v.dime) && corte && corte.estado.enVoz)) return;
    tocar(v.pcm, v.tipo === "voz");
  }

  function tocar(b64, esVoz) {
    const bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      f[i] = (x >= 32768 ? x - 65536 : x) / 32768;
    }
    const ctx = oido.ctx;
    let buf;
    try {
      buf = ctx.createBuffer(1, n, 16000);
      buf.getChannelData(0).set(f);
    } catch (e) {                           // Safari viejo no crea buffers de 16 kHz: se sube a la del contexto
      const r = ctx.sampleRate / 16000, m = Math.floor(n * r);
      buf = ctx.createBuffer(1, m, ctx.sampleRate);
      const c = buf.getChannelData(0);
      for (let i = 0; i < m; i++) { const p = i / r, j = Math.floor(p), fr = p - j; c[i] = f[j] * (1 - fr) + (f[j + 1] || 0) * fr; }
    }
    const fuente = ctx.createBufferSource();
    fuente.buffer = buf;
    fuente.connect(ctx.destination);
    const ahora = ctx.currentTime, inicio = Math.max(ahora + 0.05, oido.finVoz);
    fuente.start(inicio);
    oido.finVoz = inicio + buf.duration;
    if (esVoz) { oido.finHabla = oido.finVoz; apuntarBoca(f, inicio - ahora); }
  }

  function apuntarBoca(f, retrasoS) {        // como _apuntar_voz() del servidor: volumen cada 50 ms
    const paso = 800, niveles = [];
    for (let i = 0; i + paso <= f.length; i += paso) {
      let s = 0;
      for (let j = i; j < i + paso; j++) s += f[j] * f[j];
      niveles.push(Math.min(1, Math.round(Math.sqrt(s / paso) * 32768 / 5000 * 100) / 100));
    }
    const ahora = Date.now();
    oido.boca = oido.boca.filter((x) => x.t + x.niveles.length * x.paso > ahora - 1000);
    oido.boca.push({t: ahora + retrasoS * 1000, paso: 50, niveles});
  }

  // Para moverBoca() de app.js: el volumen de la voz del PC que suena ahora aqui (null: no suena)
  function nivelBoca() {
    if (!oido.activo) return null;
    const t = Date.now();
    for (const s of oido.boca) {
      const i = Math.floor((t - s.t) / s.paso);
      if (i >= 0 && i < s.niveles.length) return s.niveles[i];
    }
    return null;
  }

  // YouTube pedido al PC desde el celular: ningun navegador deja ponerlo sin un toque, asi que se muestra
  // el video con un boton. En Android y iPhone el enlace abre la app de YouTube.
  function mostrarVideo(id, titulo) {
    if (!/^[\w-]{6,20}$/.test(id || "")) return;
    const caja = $("#ag-video");
    caja.innerHTML = `<img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" width="112" height="63">
      <div class="txt"><b>${esc(titulo || "Video de YouTube")}</b><small>Te lo dejé aquí: tócalo para ponerlo.</small></div>
      <a class="btn primario" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Abrir en YouTube</a>
      <button class="btn" type="button" data-quitar-video aria-label="Quitar el video">✕</button>`;
    caja.hidden = false;
  }

  // ------------------------------------------------------------------ empezar y parar
  async function pedirPantalla() {
    try {
      if (oido.activo && !oido.pantalla && "wakeLock" in navigator && !document.hidden) {
        oido.pantalla = await navigator.wakeLock.request("screen");
        oido.pantalla.addEventListener("release", () => { oido.pantalla = null; });
      }
    } catch (e) { /* sin Wake Lock: la pantalla se apaga segun el ajuste del celular */ }
  }

  function avisar(t) { oido.aviso = t; pintar(); }

  // "este celular escucha": el PC le manda los recordatorios y "Probar voz" si no hay ESP32, y Dispositivos
  // lo muestra. Al cerrar la app, Firebase lo borra solo (onDisconnect).
  function latido() {
    if (oido.activo && oido.refEscucha) nube.d.set(oido.refEscucha, nube.d.serverTimestamp()).catch(() => {});
  }

  async function empezar() {
    avisar("");
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      avisar("Este navegador no deja usar el micrófono aquí. Abre la app en Chrome (Android) o Safari (iPhone).");
      return;
    }
    if (!nube.pid || !nube.enLinea) { avisar("El Píxel del PC no está conectado ahora mismo."); return; }
    // todo esto dentro del toque: en iPhone el audio solo arranca asi
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!oido.ctx) oido.ctx = new Ctx();
    oido.ctx.resume().catch(() => {});
    const silencio = oido.ctx.createBufferSource();
    silencio.buffer = oido.ctx.createBuffer(1, 1, oido.ctx.sampleRate);
    silencio.connect(oido.ctx.destination);
    silencio.start(0);
    try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch (e) { /* Safari 16.4+ */ }
    // es una cosa u otra: Pixel en el celular deja de escuchar y se calla
    if (window.Agente) { try { Agente.nucleo.dejarDeEscuchar(); Agente.nucleo.callar(); } catch (e) { /* sin agente */ } }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}});
    } catch (e) {
      avisar(e.name === "NotAllowedError" || e.name === "SecurityError"
        ? "El navegador no dio permiso para el micrófono. Permítelo en los ajustes del sitio (el candado junto a la dirección) y vuelve a tocar «Usar el PC»."
        : e.name === "NotFoundError" ? "No encuentro ningún micrófono en este aparato."
        : "No pude abrir el micrófono (" + e.name + ").");
      return;
    }
    const ctx = oido.ctx;
    corte = cortador(mandarFrase, sordo);
    Object.assign(oido, {activo: true, stream, remuestrear: remuestreador(ctx.sampleRate), lleno: 0, finVoz: 0, finHabla: 0, pensandoHasta: 0, boca: []});
    oido.fuente = ctx.createMediaStreamSource(stream);
    oido.nodo = ctx.createScriptProcessor(2048, 1, 1);     // AudioWorklet pediria otro archivo; esto va en todos los navegadores
    oido.mudo = ctx.createGain();
    oido.mudo.gain.value = 0;                              // Chrome solo procesa si el nodo llega a la salida
    oido.nodo.onaudioprocess = procesar;
    oido.fuente.connect(oido.nodo);
    oido.nodo.connect(oido.mudo);
    oido.mudo.connect(ctx.destination);
    const d = nube.d, ref = d.ref(nube.db, `pixeles/${nube.pid}/habla/${nube.uid}`);
    await d.remove(ref).catch(() => {});                  // la voz de antes ya no se toca
    if (!oido.activo) return;
    oido.quitar = d.onChildAdded(ref, alHabla, (e) => avisar("No puedo oír al PC (" + (e.code || e.message) + "). ¿Están publicadas las reglas nuevas?"));
    oido.refEscucha = d.ref(nube.db, `pixeles/${nube.pid}/escuchando/${nube.uid}`);
    try { d.onDisconnect(oido.refEscucha).remove(); } catch (e) { /* sin onDisconnect: caduca solo en 45 s */ }
    latido();
    clearInterval(oido.latido);
    oido.latido = setInterval(latido, 15000);
    pedirPantalla();
    clearInterval(oido.reloj);
    oido.reloj = setInterval(pintar, 150);
    pintar();
    if (window.Agente) Agente.pintar();                   // su pildora y su burbuja dicen que oye el PC
  }

  function parar() {
    if (!oido.activo) return;
    oido.activo = false;
    if (oido.quitar) oido.quitar();
    if (oido.nodo) oido.nodo.onaudioprocess = null;
    for (const n of [oido.fuente, oido.nodo, oido.mudo]) { try { if (n) n.disconnect(); } catch (e) { /* ya estaba suelto */ } }
    if (oido.stream) oido.stream.getTracks().forEach((t) => t.stop());
    if (oido.pantalla) oido.pantalla.release().catch(() => {});
    clearInterval(oido.reloj);
    clearInterval(oido.latido);
    if (oido.refEscucha && nube.d) {
      nube.d.remove(oido.refEscucha).catch(() => {});
      try { nube.d.onDisconnect(oido.refEscucha).cancel(); } catch (e) { /* nada que cancelar */ }
    }
    Object.assign(oido, {quitar: null, fuente: null, nodo: null, mudo: null, stream: null, pantalla: null, reloj: null,
      latido: null, refEscucha: null, boca: [], nivel: 0});
    corte = null;
    pintar();
    if (window.Agente) Agente.pintar();
  }

  // ------------------------------------------------------------------ pantalla
  function pintar() {
    const caja = $("#oido");
    if (!caja) return;
    // solo en la app de internet, con sesion y un Pixel del PC enlazado
    caja.hidden = !EN_INTERNET || !nube.usuario || (!oido.activo && !nube.pid);
    if (oido.activo && (!nube.pid || !nube.usuario)) { parar(); return; }
    const b = $("#oido-btn"), en = !!nube.enLinea;
    b.textContent = oido.activo ? "Parar" : "Usar el PC";
    b.className = "btn" + (oido.activo ? "" : " primario");
    b.disabled = !oido.activo && !en;
    b.setAttribute("aria-pressed", oido.activo ? "true" : "false");
    $("#oido-nivel").hidden = !oido.activo;
    const e = corte ? corte.estado : null;
    $("#oido-nivel i").style.width = oido.activo && e && !sordo() ? Math.min(100, Math.round(e.nivel / (2 * e.umbral) * 100)) + "%" : "0%";
    $("#oido-aviso").hidden = !oido.aviso;
    $("#oido-aviso").textContent = oido.aviso;
    let titulo = "Hablar con el Píxel del PC", sub = "Lo oye tu computador: su voz, su inteligencia artificial y sus acciones.";
    if (!oido.activo && !en) sub = "El PC está desconectado. Enciéndelo con el programa de Píxel abierto.";
    if (oido.activo) {
      const habla = oido.ctx.currentTime < oido.finHabla, ahora = Date.now();     // los beeps no cuentan como hablar
      const palabra = (nube.estado && nube.estado.agente && nube.estado.agente.activacion) || "Píxel";
      [titulo, sub] = !en ? ["El PC se desconectó", "Lo que digas no le llega. Espera a que vuelva o toca Parar."]
        : habla ? ["El PC te está hablando…", "Suena por este celular."]
        : ahora < oido.pensandoHasta ? ["El PC está pensando…", "Te oyó. Ya te contesta."]
        : e && e.enVoz ? ["Te oigo…", "Sigue, te escucho."]
        : e && e.calib.length < OIDO.CALIB ? ["Un momento…", "Estoy midiendo el ruido de fondo."]
        : ["El PC te escucha", `Di "${palabra}" y tu orden. Deja la app abierta en pantalla.`];
    }
    $("#oido-titulo").textContent = titulo;
    $("#oido-sub").textContent = sub;
  }

  if (document.getElementById("oido")) {
    $("#oido-btn").addEventListener("click", () => (oido.activo ? parar() : empezar()));
    // tocar "Escuchar" de Pixel en el celular para esto (antes de que el agente arranque su microfono)
    const ag = document.getElementById("ag-btn");
    if (ag) ag.addEventListener("click", () => { if (oido.activo) parar(); }, true);
    document.addEventListener("visibilitychange", () => {
      if (!oido.activo || document.hidden) return;
      pedirPantalla();
      if (oido.ctx && oido.ctx.state !== "running") oido.ctx.resume().catch(() => {});
    });
    setInterval(() => { if (!oido.activo) pintar(); }, 1000);      // el PC se conecta o se desconecta
  }

  window.PixelOido = {texto, parar, nivelBoca, activo: () => oido.activo, estado: () => ({enviadas: oido.enviadas, oidas: oido.oidas})};
})();
