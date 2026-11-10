/* Fase 12 - Pixel en la app: el celular es Pixel entero, sin PC ni servidor.
   Oye con el reconocimiento de voz del navegador (Web Speech API: Chrome en Android, Safari en
   iPhone), piensa con Gemini a traves de Firebase AI Logic (la clave de Gemini la guarda Firebase,
   no esta en la pagina) y habla con la voz del propio celular (speechSynthesis). Los recordatorios
   y los ajustes van en usuarios/<uid>/ (database.rules.json).
   Solo en la app de internet: app.js lo carga al iniciar Firebase y llama a Agente.iniciar(app).
   Usa de app.js: nube, cara, $, esc, toast, pill, contar, SDK, dichoHasta y agenteTocado.
   Al cargarse no toca la pagina: asi sus funciones de texto se prueban en Node.
   Fase 13: es el nucleo. Las capacidades van en modulos (MODULOS: cerebro, google, tiempo,
   aparatos) que se registran con Agente.modulo({...}): cada uno da sus herramientas (function
   calling), las ejecuta y anade contexto al prompt. Las instrucciones de Pixel estan en agente.md.
   Una herramienta devuelve un texto (se dice tal cual, la app confirma en local) o {respuesta}
   (datos que vuelven a Gemini para que los resuma: correos, eventos...). */
"use strict";
(function () {
  // ------------------------------------------------------------------ ajustes
  // El cupo gratis de Gemini es por modelo y por dia: si uno lo agota (429 PerDay), se sigue con el
  // siguiente hasta que se renueve (medianoche del Pacifico). gemini-flash-lite-latest es el mismo 3.5.
  const MODELOS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
  const MODULOS = ["cerebro.js", "google.js", "tiempo.js", "aparatos.js", "musica.js", "humor.js", "apuntes.js", "whatsapp.js", "ajustes.js"];
  const MAX_RONDAS = 4;                         // vueltas herramienta -> Gemini en un mismo turno
  const CONFIRMAR_MS = 15000;                   // tras preguntar "¿lo envío?", se contesta sin decir "Píxel"
  // Firebase App Check (consola > App Check > app web Pixel > reCAPTCHA v3): su clave de sitio. Si en la
  // consola se "aplica" App Check a Firebase AI Logic, sin esto Gemini contesta 401. Vacia = sin App Check.
  const APP_CHECK_CLAVE = "";
  const MAX_TURNOS = 4;                         // pares usuario/Pixel que se recuerdan
  const TURNOS_AHORRO = 2;                      // con "Consumo bajo" (Ajustes): cada pregunta lleva menos historial
  // Fase 14 - Ajustes: un interruptor por modo (usuarios/<uid>/preferencias/modos/<id>, lo escribe ajustes.js).
  // Los modulos apagados no dan herramientas, atajos ni contexto. Sin valor guardado vale lo de aqui
  // (el usuario pidio "dejar el consumo en bajo": lo que gasta Gemini en segundo plano viene apagado).
  const MODOS_DEFECTO = {aprender: false, clasificar: false, analizar: true, ahorro: true};
  let modos = {};
  const activo = (id) => (id in modos ? modos[id] !== false : MODOS_DEFECTO[id] !== false);
  const usar = (m) => activo(m.nombre);
  const turnos = () => (activo("ahorro") ? TURNOS_AHORRO : MAX_TURNOS);
  const OLVIDO_MS = 120000;                     // sin hablar este rato se olvida la conversacion (el reposo del servidor)
  const VENTANA_MS = 8000;                      // tras "Dime", la siguiente frase no necesita "Píxel"
  // Android da la frase por terminada en cada pausa corta: se juntan los trozos y solo se responde tras
  // este silencio. Tras "Píxel" sola se espera mas, por si sigue la orden, antes de decir "Dime" (9 nov:
  // "Píxel… necesito que reproduzcas No te va a gustar" se quedaba en "reproduce").
  const PAUSA_FIN_MS = 1200;
  const PAUSA_PIXEL_MS = 1800;
  const ACTIVACION = "Píxel";
  // Tipo de voz (Fase 13): no hay voces de nino, asi que la infantil es la del celular mas aguda
  // (pitch) y un poco mas rapida. Por defecto, infantil (lo pidio el usuario el 9 nov).
  const TONOS = {normal: {pitch: 1, rate: 1.05}, infantil: {pitch: 1.55, rate: 1.08}, muy_infantil: {pitch: 1.9, rate: 1.1}};
  const TONO_DEFECTO = "infantil";
  const VARIANTES = ["bixel"];                  // plano() ya iguala Pixel y Píxel
  const PREFIJOS = ["oye", "hey", "hola"];
  const FIN_FRASE = ".!?…", CORTE_PRIMERA = ",;", CIERRES = "\"')»", PRIMERA_MIN_PALABRAS = 6;
  const VERBO = "(?:pon(?:me|er|ga|gas)?|reproduc(?:e|es|en|eme|elo|ela|ir)|reproduzc(?:a|as|an)|busc(?:a|ame|ar)|busque)";
  // El reconocimiento del navegador casi no pone comas: "Píxel" en medio de la frase vale tambien
  // si lo que sigue suena a orden o a pregunta. Asi "un píxel de la pantalla" sigue sin activarla.
  const ARRANQUE = "(?:dime|cuentame|explicame|hablame|recuerdame|recuerda|avisame|borra|quita|cancela|sabes|puedes|tienes|" + VERBO + ")";
  const PREGUNTA = "(?:qué|cuál|cuáles|cómo|cuándo|dónde|quién|quiénes|cuánto|cuánta|cuántos|cuántas|por qué)";
  const SR = (typeof window !== "undefined") && (window.SpeechRecognition || window.webkitSpeechRecognition);

  // ------------------------------------------------------------------ texto (lo mismo que servidor.py)
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // minusculas y sin tildes, con la MISMA longitud: los indices sirven para recortar el original
  function plano(t) {
    let s = "";
    for (let i = 0; i < t.length; i++) s += t[i].toLowerCase().normalize("NFD")[0] || t[i];
    return s;
  }

  function regexPalabras(palabras, prefijos, enMedio) {
    const vs = [...new Set(palabras.map(plano))].sort((a, b) => b.length - a.length);
    const palabra = vs.map((v) => v.split(/\s+/).map(escRe).join("[\\s,]+")).join("|");
    const prefijo = prefijos.length ? `(?:(?:${prefijos.map((p) => escRe(plano(p))).join("|")})[\\s,]+)?` : "";
    // sin lookbehind: Safari anterior a 16.4 no lo entiende y la pagina entera fallaria
    const inicio = enMedio ? "(^|[\\s,.;:!?¡¿…\"'])" : "^[\\s¡¿\"'.,]*";
    return new RegExp(`${inicio}${prefijo}(${palabra})\\b[\\s,.;:!?¡¿…"']*`, enMedio ? "g" : "");
  }
  const RE_ACT = regexPalabras(VARIANTES.concat(ACTIVACION), PREFIJOS, false);
  const RE_ACT_MEDIO = regexPalabras(VARIANTES.concat(ACTIVACION), PREFIJOS, true);
  const RE_ORDEN = new RegExp(`^[\\s¡¿"'.,]*${VERBO}\\b`);
  const RE_ARRANQUE = new RegExp(`^${ARRANQUE}\\b`);
  const RE_PREGUNTA = new RegExp(`^${PREGUNTA}(?![a-záéíóúüñ])`);

  // Como servidor.quitar_activacion: [true, lo que va despues] si llaman a Pixel; [false, texto] si no
  function quitarActivacion(texto) {
    const p = plano(texto);
    let m = RE_ACT.exec(p);
    if (m) return [true, texto.slice(m[0].length).trim()];
    const v = RE_ORDEN.exec(p);                 // "Reproduce, Píxel, reproduce Queen"
    if (v) {
      m = RE_ACT.exec(p.slice(v[0].length));
      if (m) {
        let resto = texto.slice(v[0].length + m[0].length).trim();
        if (!RE_ORDEN.test(plano(resto))) {      // "Pon, Píxel, Queen" -> "Pon Queen"
          resto = (texto.slice(0, v[0].length).replace(/^[\s,.¡¿"']+|[\s,.¡¿"']+$/g, "") + " " + resto).trim();
        }
        return [true, resto];
      }
    }
    // en medio de la frase: vale lo que va tras la ultima vez que se nota que la llaman
    let ultima = -1;
    const finTexto = p.trimEnd().length;
    for (const mm of p.matchAll(RE_ACT_MEDIO)) {
      const ini = mm.index + mm[1].length, fin = mm.index + mm[0].length;
      const finW = fin - /[\s,.;:!?¡¿…"']*$/.exec(mm[0])[0].length;
      const antes = p.slice(0, ini).trimEnd();
      const sigue = texto.slice(fin);
      const pausaAntes = !antes || ".,;:!?…".includes(antes[antes.length - 1]);
      const pausaDespues = fin >= finTexto || /[.,;:!?…]/.test(p.slice(finW, fin))
        || RE_ARRANQUE.test(plano(sigue)) || RE_PREGUNTA.test(sigue.toLowerCase().replace(/^[¿¡\s]+/, ""));
      if (pausaAntes || pausaDespues) ultima = fin;
    }
    if (ultima >= 0) return [true, texto.slice(ultima).trim()];
    return [false, texto];
  }

  // Para encontrar "el de Ana", "la reunion", "la tele": que parte de las palabras de la consulta esta
  // en el texto (0 a 1). Palabras de 3 letras o mas, sin tildes, cortadas a 5 letras ("correos" = "correo").
  const VACIAS = new Set("del las los una uno unos unas con por para que mis tus sus este esta ese esa eso".split(" "));
  const claves = (t) => plano(String(t || "")).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VACIAS.has(w)).map((w) => w.slice(0, 5));
  function parecido(consulta, texto) {
    const q = new Set(claves(consulta));
    if (!q.size) return 0;
    const t = new Set(claves(texto));
    let n = 0;
    for (const w of q) if (t.has(w)) n++;
    return n / q.size;
  }

  // "Píxel, Píxel" cuenta como una sola llamada
  function activacion(texto) {
    let [ok, resto] = quitarActivacion(texto);
    while (ok && resto) {
      const m = RE_ACT.exec(plano(resto));
      if (!m) break;
      resto = resto.slice(m[0].length).trim();
    }
    return [ok, resto];
  }

  function entreDigitos(buf, i) {               // 8.848 o 3,5: el signo es parte de una cifra
    if (i === 0 || !/\d/.test(buf[i - 1])) return false;
    return i + 1 >= buf.length || /\d/.test(buf[i + 1]);
  }

  // Como servidor.extraer_frases: [frases cerradas, resto]. La primera tambien corta en coma
  // (si ya lleva PRIMERA_MIN_PALABRAS palabras), para que la voz arranque antes.
  function extraerFrases(buf, primera) {
    const frases = [];
    let ini = 0, i = 0;
    while (i < buf.length) {
      const c = buf[i];
      let corta = false;
      if (FIN_FRASE.includes(c)) corta = !(c === "." && entreDigitos(buf, i));
      else if (primera && CORTE_PRIMERA.includes(c)) {
        corta = !entreDigitos(buf, i) && buf.slice(ini, i).split(/\s+/).filter(Boolean).length >= PRIMERA_MIN_PALABRAS;
      }
      if (corta) {
        let j = i + 1;
        while (j < buf.length && (FIN_FRASE + CIERRES).includes(buf[j])) j++;
        const trozo = buf.slice(ini, j).trim();
        if (trozo) { frases.push(trozo); primera = false; }
        ini = j; i = j;
      } else i++;
    }
    return [frases, buf.slice(ini)];
  }

  // ------------------------------------------------------------------ fechas dichas
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function horaDicha(f) {
    const h = f.getHours(), m = f.getMinutes(), h12 = h % 12 || 12;
    const parte = h === 12 && !m ? "del mediodía" : h < 6 ? "de la madrugada" : h < 12 ? "de la mañana" : h < 20 ? "de la tarde" : "de la noche";
    const num = m ? `${h12}:${String(m).padStart(2, "0")}` : h12 === 1 ? "una" : String(h12);
    return `${h12 === 1 ? "a la" : "a las"} ${num} ${parte}`;
  }

  function cuandoDicho(ms, ahora) {
    ahora = ahora === undefined ? Date.now() : ahora;
    const f = new Date(ms), hoy = new Date(ahora), min = Math.round((ms - ahora) / 60000);
    if (ms >= ahora && min < 1) return "en un momento";
    if (ms > ahora && min < 60) return min === 1 ? "en un minuto" : `en ${min} minutos`;
    const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dd = Math.round((dia(f) - dia(hoy)) / 86400000), hora = horaDicha(f);
    if (dd === 0) return `hoy ${hora}`;
    if (dd === 1) return `mañana ${hora}`;
    if (dd === -1) return `ayer ${hora}`;
    if (dd > 1 && dd < 7) return `el ${DIAS[f.getDay()]} ${hora}`;
    return `el ${DIAS[f.getDay()]} ${f.getDate()} de ${MESES[f.getMonth()]} ${hora}`;
  }

  function fechaAhora(d) {
    d = d || new Date();
    let zona = "";
    try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { zona = ""; }
    return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}, `
      + `${[d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")}${zona ? " (zona " + zona + ")" : ""}`;   // con segundos: "en 1 minuto" no se queda en 15 s
  }

  // "2026-11-06T17:25:00" -> ms en hora LOCAL. La "Z" que a veces anade el modelo tambien se lee como
  // hora local: se le pidio sin zona. Un desfase explicito (+01:00) si se respeta.
  function leerCuando(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(String(s).trim());
    if (!m) return NaN;
    if (m[7] && m[7] !== "Z") return Date.parse(s);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  }

  // ------------------------------------------------------------------ estado
  const est = {
    montado: false, app: null, ia: null, ai: null, estado: "listo", turnoId: 0, historial: [], ultimaT: 0,
    conversacion: [], recordatorios: null, ajustes: {personalidad: "", respuesta: "normal", voz: "", tono: TONO_DEFECTO},
    aviso: "", iaError: "", quitar: [], diciendoRec: false, fallidos: new Set(), pintadoConv: "", pintadoAgenda: "",
    instrucciones: "",                          // agente.md (plantilla con {{...}})
    pendiente: null,                            // {pregunta, si: RegExp, hacer(), cancelar(), seguir}: espera un "sí"
  };
  const modulos = [];                           // los registra cada archivo de MODULOS con Agente.modulo()
  const oye = {rec: null, quiere: false, corriendo: false, ventanaHasta: 0, interino: "", arranques: [], reloj: null, pantalla: null,
    pendiente: "", inicio: 0, relojFin: null};   // pendiente: lo oido de la frase en curso; inicio: cuando empezo
  const habla = {cola: [], actual: null, esperas: [], boundaryT: 0, generando: false, desbloqueada: false};
  let audio = null;

  const ocupado = () => est.estado === "pensando" || est.estado === "hablando";
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  function conTiempo(promesa, ms) {
    return Promise.race([promesa, new Promise((_, mal) => setTimeout(() => mal(new Error("sin respuesta de la nube")), ms))]);
  }

  function ponerEstado(e) {
    est.estado = e;
    pintar();
  }

  function aviso(texto) { est.aviso = texto; pintar(); }

  // ------------------------------------------------------------------ hablar (voz del celular)
  function idioma() {
    const l = navigator.language || "";
    return /^es\b/i.test(l) ? l : "es-ES";
  }

  function voces() {
    if (typeof speechSynthesis === "undefined") return [];
    const hay = speechSynthesis.getVoices().filter((v) => /^es\b/i.test(v.lang));
    const mio = idioma().toLowerCase(), latino = !/^es-es$/i.test(mio);
    const nota = (v) => (v.lang.toLowerCase() === mio ? 4 : 0) + (latino && /^es-(us|mx|419|co)/i.test(v.lang) ? 2 : 0)
      + (/google|natural|neural|premium|enhanced|online/i.test(v.name) ? 2 : 0) + (v.default ? 1 : 0);
    return hay.sort((a, b) => nota(b) - nota(a));
  }
  const idVoz = (v) => v.voiceURI || v.name;

  function vozElegida() {
    const vs = voces();
    return vs.find((v) => idVoz(v) === est.ajustes.voz) || vs[0] || null;
  }

  // la primera vez, dentro de un toque: iPhone (y Chrome) solo dejan sonar despues de tocar la pagina
  function desbloquear() {
    try {
      if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (C) audio = new C(); }
      if (audio && audio.state !== "running") audio.resume().catch(() => {});
    } catch (e) { audio = null; }
    if (!habla.desbloqueada && typeof speechSynthesis !== "undefined") {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
      habla.desbloqueada = true;
    }
  }

  function beep(f0, f1) {                      // como los del ESP32: sube al oir la orden, baja al terminar
    if (!audio || audio.state !== "running") return;
    const t = audio.currentTime + 0.01, o = audio.createOscillator(), g = audio.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.01);
    g.gain.setValueAtTime(0.15, t + 0.11);
    g.gain.linearRampToValueAtTime(0, t + 0.12);
    o.connect(g);
    g.connect(audio.destination);
    o.start(t);
    o.stop(t + 0.13);
  }

  function decirFrase(texto) {
    habla.cola.push(texto);
    siguiente();
  }

  // Una frase cada vez, con nuestra propia cola: asi se sabe cuando acaba todo y la boca sabe si hay voz.
  // Si la voz no empieza en 2,5 s (sin voces instaladas) o no acaba a su tiempo, se da por dicha.
  function siguiente() {
    if (habla.actual) return;
    if (!habla.cola.length) {
      if (habla.generando) { if (est.estado === "hablando") ponerEstado("pensando"); }
      else avisarFin();
      return;
    }
    const texto = habla.cola.shift();
    if (est.estado !== "hablando") ponerEstado("hablando");
    const act = {texto, reloj: null};
    const fin = () => {
      if (habla.actual !== act) return;
      clearTimeout(act.reloj);
      habla.actual = null;
      siguiente();
    };
    habla.actual = act;
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      act.reloj = setTimeout(fin, 600 + texto.length * 60);      // sin voz: el texto queda en pantalla
      return;
    }
    const u = new SpeechSynthesisUtterance(texto);
    const v = vozElegida();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = idioma();
    const tono = TONOS[est.ajustes.tono] || TONOS[TONO_DEFECTO];
    u.pitch = tono.pitch;
    u.rate = tono.rate;
    u.onstart = () => { clearTimeout(act.reloj); act.reloj = setTimeout(fin, 4000 + texto.length * 110); };
    u.onboundary = () => { habla.boundaryT = performance.now(); };
    u.onend = fin;
    u.onerror = fin;
    act.u = u;                                 // que no se lo lleve el recolector antes de onend (Chrome)
    act.reloj = setTimeout(fin, 2500);
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  }

  function avisarFin() {
    const e = habla.esperas;
    habla.esperas = [];
    e.forEach((f) => f());
  }

  function finHablar() {
    return new Promise((ok) => {
      if (!habla.actual && !habla.cola.length && !habla.generando) ok();
      else habla.esperas.push(ok);
    });
  }

  function callar() {
    habla.cola = [];
    if (habla.actual) { clearTimeout(habla.actual.reloj); habla.actual = null; }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    avisarFin();
  }

  // la boca: con eventos de palabra (si el navegador los da) abre en cada palabra; si no, una envolvente
  function nivelBoca() {
    if (!habla.actual) return null;
    const t = performance.now(), dt = t - habla.boundaryT;
    if (dt < 250) return 0.3 + 0.6 * (1 - dt / 250);
    return 0.2 + 0.5 * Math.abs(Math.sin(t / 95)) * (0.6 + 0.4 * Math.abs(Math.sin(t / 41)));
  }

  // ------------------------------------------------------------------ oir (reconocimiento del navegador)
  function crearRec() {
    const r = new SR();
    r.lang = idioma();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let fin = "", inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else inter += t;
      }
      oye.interino = inter.trim();
      for (const m of modulos) { try { if (m.alOirParcial && usar(m)) m.alOirParcial(oye.pendiente + " " + oye.interino + " " + fin); } catch (er) { /* nada */ } }
      if (fin.trim()) oye.pendiente = (oye.pendiente + " " + fin.trim()).trim().slice(-400);
      if (fin.trim() || oye.interino) {
        if (!oye.inicio) oye.inicio = Date.now();
        programarFin();
      }
      pintar();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        parar();
        aviso("El navegador no me dio permiso para el micrófono. Permítelo en los ajustes del sitio (el candado junto a la dirección) y toca Escuchar otra vez.");
      } else if (e.error === "audio-capture") {
        parar();
        aviso("No encuentro ningún micrófono en este aparato.");
      } else if (e.error === "language-not-supported") {
        parar();
        aviso("El reconocimiento de voz de este navegador no entiende español. Escríbeme abajo.");
      } else if (e.error === "network") {
        aviso("Para oírte necesito internet: el reconocimiento de voz del navegador va por la red.");
      }                                         // "no-speech" y "aborted" son normales: se vuelve a empezar
    };
    r.onstart = () => { if (est.aviso.startsWith("Para oírte necesito internet")) aviso(""); };
    r.onend = () => {
      oye.corriendo = false;
      if (oye.interino) {                       // se corto sin dar el resultado final: vale lo provisional
        oye.pendiente = (oye.pendiente + " " + oye.interino).trim().slice(-400);
        oye.interino = "";
        programarFin();
      }
      // a media frase se vuelve a arrancar ya: lo que se diga mientras tanto se pierde
      if (oye.quiere && est.estado === "escuchando") programarArranque(!!oye.pendiente);
      pintar();
    };
    return r;
  }

  // La frase se da por terminada tras un silencio (sin resultados nuevos, ni provisionales)
  function programarFin() {
    clearTimeout(oye.relojFin);
    let espera = PAUSA_FIN_MS;
    if (oye.pendiente && !oye.interino) {
      const [ok, resto] = activacion(oye.pendiente);
      if (ok && !resto) espera = PAUSA_PIXEL_MS;   // "Píxel" sola: puede que siga la orden
    }
    oye.relojFin = setTimeout(cerrarFrase, espera);
  }

  function cerrarFrase() {
    const texto = (oye.pendiente + " " + oye.interino).trim(), inicio = oye.inicio;
    oye.pendiente = "";
    oye.interino = "";
    oye.inicio = 0;
    if (texto) alOir(texto, inicio);
    pintar();
  }

  // El reconocimiento se corta solo tras cada frase (en Android siempre): se vuelve a arrancar.
  // Si se corta una y otra vez sin oir nada, se espera mas para no girar en vacio.
  function programarArranque(rapido) {
    const ahora = Date.now();
    oye.arranques = oye.arranques.filter((t) => ahora - t < 10000);
    clearTimeout(oye.reloj);
    oye.reloj = setTimeout(arrancarRec, oye.arranques.length > 8 ? 3000 : rapido ? 0 : 250);
  }

  function arrancarRec() {
    if (!oye.rec || !oye.quiere || est.estado !== "escuchando" || oye.corriendo || document.hidden) return;
    try { oye.rec.start(); oye.corriendo = true; oye.arranques.push(Date.now()); } catch (e) { /* ya estaba en marcha */ }
  }

  function pararRec() {
    clearTimeout(oye.reloj);
    clearTimeout(oye.relojFin);
    if (oye.rec && oye.corriendo) { try { oye.rec.abort(); } catch (e) { /* ya estaba parado */ } }
    oye.corriendo = false;
    oye.interino = "";
    oye.pendiente = "";
    oye.inicio = 0;
  }

  async function pedirPantalla() {
    try {
      if (oye.quiere && !oye.pantalla && "wakeLock" in navigator && !document.hidden) {
        oye.pantalla = await navigator.wakeLock.request("screen");
        oye.pantalla.addEventListener("release", () => { oye.pantalla = null; });
      }
    } catch (e) { /* sin Wake Lock: la pantalla se apaga segun el ajuste del celular */ }
  }

  // todo dentro del toque (sin await antes de start): en iPhone el microfono solo arranca asi
  function empezar() {
    desbloquear();
    if (!SR) { aviso("Este navegador no puede oírme. Abre la app en Chrome (Android) o Safari (iPhone), o escríbeme abajo."); return; }
    if (!oye.rec) oye.rec = crearRec();
    oye.quiere = true;
    est.aviso = "";
    if (est.estado === "listo") est.estado = "escuchando";
    arrancarRec();
    pedirPantalla();
    pintar();
  }

  function parar() {
    oye.quiere = false;
    oye.ventanaHasta = 0;
    pararRec();
    if (oye.pantalla) oye.pantalla.release().catch(() => {});
    if (est.estado === "escuchando") est.estado = "listo";
    pintar();
  }

  function volverAEscuchar() {
    ponerEstado(oye.quiere ? "escuchando" : "listo");
    if (oye.quiere) setTimeout(arrancarRec, 150);
  }

  function alOir(texto, inicio) {
    if (est.estado !== "escuchando") return;
    // dictado (apuntes.js con una nota abierta): todo lo que se oye va a la nota, sin "Píxel" ni Gemini
    for (const m of modulos) { try { if (m.dictar && usar(m) && m.dictar(texto)) return; } catch (e) { console.warn("agente:", m.nombre, e); } }
    const [ok, resto] = activacion(texto);
    if (!ok) {                                  // vale si empezo a hablar dentro de la ventana
      if ((inicio || Date.now()) < oye.ventanaHasta) { oye.ventanaHasta = 0; orden(texto); }
      return;                                   // sin "Píxel": no es para mi
    }
    if (!resto) { dime(); return; }
    oye.ventanaHasta = 0;
    orden(resto);
  }

  async function dime() {
    const id = ++est.turnoId;
    if (cara) cara.emocion("curioso", 1600);   // "¿si?": un ojo grande y la cabeza ladeada
    pararRec();
    decirFrase("Dime");
    await finHablar();
    if (id !== est.turnoId) return;
    oye.ventanaHasta = Date.now() + VENTANA_MS;
    volverAEscuchar();
  }

  // ------------------------------------------------------------------ pensar (Gemini por Firebase AI Logic)
  const BASICAS = [
    {name: "crear_recordatorio", description: "Crea un recordatorio que Píxel dirá en voz alta a su hora. Si el usuario no dice cuándo, pregúntaselo en vez de llamar a esta función.",
      parameters: {type: "object", properties: {
        texto: {type: "string", description: "Qué hay que recordar, corto, por ejemplo 'sacar la ropa'."},
        en_minutos: {type: "number", description: "Solo si el usuario dice dentro de cuánto ('en 10 minutos', 'en 2 horas' = 120): los minutos desde ahora. Entonces no pongas cuando."},
        cuando: {type: "string", description: "Solo si dice una hora o un día ('mañana a las 8'): fecha y hora local en ISO 8601 sin zona horaria (AAAA-MM-DDTHH:MM:SS), calculada desde la hora actual."}},
      required: ["texto"]}},
    {name: "ver_recordatorios", description: "Dice los recordatorios pendientes del usuario."},
    {name: "borrar_recordatorio", description: "Borra un recordatorio pendiente, o todos.",
      parameters: {type: "object", properties: {texto: {type: "string", description: "Qué recordatorio borrar, con sus palabras; 'todos' para borrarlos todos."}}, required: ["texto"]}},
  ];

  // Las de los modulos se piden en cada turno: dependen de lo que este conectado (Google, puentes...)
  function herramientas() {
    const todas = BASICAS.slice();
    for (const m of modulos) {
      try { if (m.herramientas && usar(m)) todas.push(...(m.herramientas() || [])); } catch (e) { console.warn("agente:", m.nombre, e); }
    }
    return [{functionDeclarations: todas}];
  }

  // Si agente.md no carga (sin red la primera vez), lo minimo para que Pixel funcione
  const INSTRUCCIONES_MINIMAS = "Te llamas {{ACTIVACION}} y eres un asistente de voz que vive en una app del celular; hablas en español "
    + "y lo que respondes se lee en voz alta, sin listas, markdown ni emojis. {{LARGO}} Para hacer algo llama siempre a su función. "
    + "Lo que puedes hacer:\n{{CAPACIDADES}}\n{{ESTILO}}\nAhora es {{FECHA}}, hora local del usuario.";

  // Rellena la plantilla de agente.md. "texto" es lo que dijo el usuario: los modulos lo usan para
  // buscar lo relevante (el cerebro hace RAG con las notas y saber.md).
  function sistema(texto) {
    const a = est.ajustes;
    const capacidades = ["- Crear, ver y borrar recordatorios que suenan a su hora."];   // la musica: musica.js
    const extra = [];
    for (const m of modulos) {
      if (!usar(m)) continue;
      try {
        if (m.capacidad) { const c = m.capacidad(); if (c) capacidades.push(c); }
        if (m.contexto) { const c = m.contexto(texto || ""); if (c) extra.push(c); }
      } catch (e) { console.warn("agente:", m.nombre, e); }
    }
    const valores = {
      ACTIVACION: ACTIVACION,
      LARGO: a.respuesta === "corta" ? "Responde en 1 o 2 frases." : "Responde en 2 a 4 frases.",
      CAPACIDADES: capacidades.join("\n"),
      ESTILO: a.personalidad ? "Estilo que pidió el usuario: " + a.personalidad : "Sin estilo especial: amable y natural.",
      FECHA: fechaAhora(),
    };
    let s = (est.instrucciones || INSTRUCCIONES_MINIMAS).replace(/\{\{(\w+)\}\}/g, (t, k) => (k in valores ? valores[k] : t));
    if (est.pendiente) extra.push("## Esperando confirmación\nPreguntaste: «" + est.pendiente.pregunta + "». Si el usuario pide cambios, "
      + "hazlos con la función que toca; la app vuelve a preguntar. Si dice que sí, ya lo hace la app sola.");
    if (extra.length) s += "\n\n" + extra.join("\n\n");
    return s;
  }

  // Junta los trozos del streaming en las partes del turno del modelo. Las llamadas a funciones se
  // guardan tal cual, con su thoughtSignature: Gemini 3 la exige al devolverle los resultados.
  function juntarParte(partes, p) {
    if (p.thought) return;
    const ultima = partes[partes.length - 1];
    if (typeof p.text === "string" && !p.functionCall) {
      if (ultima && typeof ultima.text === "string" && !ultima.functionCall) {
        ultima.text += p.text;
        if (p.thoughtSignature) ultima.thoughtSignature = p.thoughtSignature;
      } else partes.push(Object.assign({}, p));
      return;
    }
    partes.push(Object.assign({}, p));
  }

  // 429 de Gemini: el plan gratis tiene un limite por minuto (unas 15 peticiones) y otro por dia.
  const textoDe = (e) => String((e && (e.message || e.code)) || e) + " " + JSON.stringify((e && e.customErrorData) || "");
  const esCupo = (e) => /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(textoDe(e));
  const cupoDelDia = (e) => /PerDay|per day|daily/i.test(textoDe(e));
  function esperaCupo(e) {                      // lo que Google dice que hay que esperar, entre 5 y 20 s
    const m = /retry ?(?:in|Delay)["':\s]*([\d.]+)\s*s/i.exec(textoDe(e));
    return Math.min(20000, Math.max(5000, m ? Number(m[1]) * 1000 : 12000));
  }

  function textoError(e) {
    if (cara) cara.emocion("triste", 2600);
    const s = String((e && (e.message || e.code)) || e);
    console.warn("agente:", e);
    if (esCupo(e)) {
      if (!cupoDelDia(e)) { est.iaError = "minuto"; return "Me están haciendo muchas preguntas seguidas. Dame un minuto y vuelve a preguntarme."; }
      est.iaError = "cupo";
      return "Se acabó el cupo gratis de Gemini por hoy. Mañana vuelvo a pensar.";
    }
    if (/App Check/i.test(s)) {
      est.iaError = "appcheck";
      aviso("Firebase pide la verificación de apps (App Check) para usar Gemini y esta app aún no la tiene configurada.");
      return "Firebase no me deja usar la inteligencia artificial: falta configurar la verificación de apps.";
    }
    if (!navigator.onLine || /network|failed to fetch|timeout|timed out|abort/i.test(s)) { est.iaError = "red"; return "No tengo conexión con internet ahora mismo."; }
    est.iaError = "error";
    return "Ahora no puedo pensar. Inténtalo otra vez en un momento.";
  }

  // Un turno con Gemini. Puede dar varias vueltas: si una herramienta devuelve datos ({respuesta}),
  // se le devuelven a Gemini y lo que conteste se dice. Las que devuelven texto ya lo dijeron.
  async function pensar(texto, id) {
    const dicho = [];
    const decir = (f) => { dicho.push(f); decirFrase(f); };
    if (!est.ai) {
      decir(est.aviso || "Todavía me estoy despertando. Inténtalo en unos segundos.");
    } else {
      habla.generando = true;
      try {
        const crear = () => est.ia.getGenerativeModel(est.ai, {model: modeloDeHoy(), systemInstruction: sistema(texto), tools: herramientas(),
          generationConfig: {maxOutputTokens: 1500, thinkingConfig: {thinkingLevel: "LOW"}}}, {timeout: 30000});
        let modelo = crear();
        const contents = est.historial.concat([{role: "user", parts: [{text: texto}]}]);
        let reintentado = false;
        for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
          const partes = [], llamadas = [];
          let buf = "", primera = !dicho.length;
          let r;
          try {
            r = await modelo.generateContentStream({contents});
          } catch (e) {
            // cupo del dia agotado en este modelo: el siguiente, sin decir nada
            while (esCupo(e) && cupoDelDia(e) && siguienteModelo()) {
              modelo = crear();
              try { r = await modelo.generateContentStream({contents}); e = null; break; } catch (e2) { e = e2; }
            }
            if (!e) { /* ya respondio otro modelo */ }
            // limite por minuto: se avisa, se espera lo que pide Google y se intenta una vez mas
            else if (!esCupo(e) || cupoDelDia(e) || reintentado) throw e;
            else {
              reintentado = true;
              console.warn("agente: limite por minuto de Gemini, reintento", e);
              decir("Un momento, que tengo muchas preguntas a la vez.");
              await esperar(esperaCupo(e));
              if (id !== est.turnoId) return;
              r = await modelo.generateContentStream({contents});
            }
          }
          let gasto = null;                     // los tokens vienen en los trozos (el resumen final del SDK no los trae)
          for await (const trozo of r.stream) {
            if (trozo && trozo.usageMetadata) gasto = trozo.usageMetadata;
            if (id !== est.turnoId) return;
            const c = trozo.candidates && trozo.candidates[0];
            for (const p of (c && c.content && c.content.parts) || []) {
              juntarParte(partes, p);
              if (p.functionCall) llamadas.push(p.functionCall);
              else if (typeof p.text === "string" && !p.thought) {
                buf += p.text;
                const [frases, resto] = extraerFrases(buf, primera);
                buf = resto;
                for (const f of frases) { primera = false; decir(f); }
              }
            }
          }
          if (buf.trim()) decir(buf.trim());
          contarUso(ronda ? "herramienta" : "charla", modeloDeHoy(), gasto);
          if (!llamadas.length) break;
          const resultados = [];
          let hayDatos = false;
          for (const ll of llamadas) {
            let res;
            try { res = await ejecutar(ll.name, ll.args || {}, {texto, dicho}); } catch (e) {
              console.warn("agente: herramienta", ll.name, e);
              res = "No pude hacerlo: " + String((e && e.message) || e).slice(0, 120);
            }
            if (id !== est.turnoId) return;
            if (res && typeof res === "object" && "respuesta" in res) {
              if (res.decir) decir(res.decir);
              resultados.push(res.respuesta);
              hayDatos = true;
            } else {
              if (res) decir(String(res));
              resultados.push({resultado: res ? String(res) : "hecho", ya_dicho_al_usuario: !!res});
            }
          }
          if (cara && resultados.some((r) => r && r.resultado && /^(Listo|Anotad|Enviado|Borr|¡Bien|Empieza|Lo recordar)/.test(r.resultado))) cara.emocion("feliz", 1400);
          if (!hayDatos) break;
          // una respuesta por cada llamada (Gemini lo exige), y la vuelta del modelo con sus firmas.
          // Las respuestas van con el rol "user": la API de Gemini rechaza "function" (400).
          contents.push({role: "model", parts: partes});
          contents.push({role: "user", parts: llamadas.map((ll, i) => ({functionResponse: Object.assign({name: ll.name, response: resultados[i]}, ll.id ? {id: ll.id} : {})}))});
        }
        est.iaError = "";
        if (est.aviso.startsWith("Firebase pide")) est.aviso = "";
      } catch (e) {
        if (id !== est.turnoId) return;
        decir(textoError(e));
      } finally {
        habla.generando = false;
        siguiente();
      }
    }
    if (!dicho.length) decir("Perdona, no sé qué decir a eso.");
    const respuesta = dicho.join(" ");
    conversar("px", respuesta);
    est.historial.push({role: "user", parts: [{text: texto}]}, {role: "model", parts: [{text: respuesta}]});
    est.historial = est.historial.slice(-turnos() * 2);
    for (const m of modulos) { try { if (m.alTurno && usar(m)) m.alTurno(texto, respuesta); } catch (e) { console.warn("agente:", m.nombre, e); } }
    return respuesta;
  }

  // Una pregunta que espera un "sí" (enviar un correo, borrar un evento...). La app no deja que
  // Gemini haga estas cosas solo: las hace ella cuando el usuario confirma, por voz o con el boton.
  //   pregunta: lo que se dice ("¿Lo envío?")    si: RegExp sobre el texto plano (sin tildes)
  //   hacer(): async, devuelve lo que se dice    cancelar(): opcional, devuelve lo que se dice
  //   seguir: si true, otra frase (una correccion) va a Gemini y la pregunta sigue en pie
  const RE_NO = /^(no|nop|nel|cancela|cancelalo|olvidalo|dejalo|mejor no|para|espera)\b/;
  const RE_PERO = /\b(pero|cambia|cambialo|agrega|anade|quita|corrige|antes|primero|mejor)\b/;
  //   dura: ms que la pregunta sigue en pie (por defecto 1 min; un borrador de correo, mas)
  function confirmar(p) {
    est.pendiente = Object.assign({hasta: Date.now() + CONFIRMAR_MS, caduca: Date.now() + (p.dura || 60000)}, p);
    pintar();
  }

  function caducarPendiente() {
    const p = est.pendiente;
    if (!p || Date.now() < p.caduca || ocupado()) return;
    est.pendiente = null;
    if (p.cancelar) Promise.resolve().then(p.cancelar).catch(() => {});
    pintar();
  }

  async function resolverPendiente(si) {
    const p = est.pendiente;
    est.pendiente = null;
    pintar();
    if (!p) return "";
    try { return si ? await p.hacer() : (p.cancelar ? await p.cancelar() : "Vale, no lo hago."); } catch (e) {
      console.warn("agente: confirmacion", e);
      return "No pude hacerlo: " + String((e && e.message) || e).slice(0, 120);
    }
  }

  // El "sí" o el "no" a la pregunta pendiente, sin pasar por Gemini. null: no es una respuesta a eso.
  function respuestaPendiente(texto) {
    const p = est.pendiente;
    if (!p) return null;
    const t = plano(texto).replace(/^[\s¡¿,.]+/, "").trim();
    if (RE_NO.test(t)) return false;
    if (p.si.test(t) && !RE_PERO.test(t)) return true;
    return null;
  }

  // Una orden para Pixel (ya sin "Píxel"), dicha o escrita
  async function orden(texto) {
    const id = ++est.turnoId;
    pararRec();
    if (Date.now() - est.ultimaT > OLVIDO_MS) est.historial = [];
    est.ultimaT = Date.now();
    conversar("tu", texto);
    ponerEstado("pensando");
    beep(800, 1200);
    let respuesta;
    const r = respuestaPendiente(texto);
    if (r !== null) {
      respuesta = await resolverPendiente(r);
      if (id !== est.turnoId) return;
      if (respuesta) { decirFrase(respuesta); conversar("px", respuesta); }
    } else {
      if (est.pendiente && !est.pendiente.seguir) { const p = est.pendiente; est.pendiente = null; if (p.cancelar) p.cancelar(); }
      // atajos: ordenes que un modulo entiende solo ("pausa" con musica sonando), sin esperar a Gemini
      let atajo;
      for (const m of modulos) { if (m.atajo && usar(m)) { try { atajo = m.atajo(texto); } catch (e) { atajo = undefined; } if (atajo !== undefined) break; } }
      if (atajo !== undefined) {
        respuesta = await atajo;
        if (id !== est.turnoId) return;
        if (respuesta) { decirFrase(respuesta); conversar("px", respuesta); }
        est.historial.push({role: "user", parts: [{text: texto}]}, {role: "model", parts: [{text: respuesta || "Hecho."}]});
        est.historial = est.historial.slice(-turnos() * 2);
      } else if (!activo("gemini")) {           // Gemini apagado en Ajustes: solo lo que no lo necesita
        respuesta = "Tengo Gemini apagado en Ajustes, así que solo hago lo que no lo necesita: el modo enfoque, los pomodoros, tomar notas y manejar la música que ya suena. Si quieres que conteste todo, enciéndelo en Ajustes.";
        decirFrase(respuesta);
        conversar("px", respuesta);
      } else respuesta = await pensar(texto, id);
    }
    await finHablar();
    if (id !== est.turnoId) return;
    beep(1200, 800);
    est.ultimaT = Date.now();
    // si Pixel pregunto algo ("¿Qué quieres que ponga?", "¿Lo envío?"), se le contesta sin decir "Píxel"
    if (est.pendiente) {
      est.pendiente.hasta = Date.now() + CONFIRMAR_MS;
      est.pendiente.caduca = Date.now() + (est.pendiente.dura || 60000);
      oye.ventanaHasta = est.pendiente.hasta;
    }
    else if (/\?["'»)]*\s*$/.test(respuesta || "")) oye.ventanaHasta = Date.now() + VENTANA_MS;
    await esperar(200);
    if (id === est.turnoId) volverAEscuchar();
  }

  // Un aviso que Pixel dice por su cuenta (recordatorio, fin de un pomodoro): espera a que no este
  // pensando ni hablando, y despues vuelve a escuchar.
  //   opciones: toast (false: sin aviso), gesto (false: no cambia la cara), beep (false: sin pitido),
  //   registro (false: no va a "Lo último que oí"; para lo que dice por su cuenta, como "¡jejeje!")
  async function anunciar(frase, opciones) {
    opciones = opciones || {};
    while (ocupado()) await esperar(500);
    const id = ++est.turnoId;
    pararRec();
    if (opciones.toast !== false) toast(frase);
    if (cara && opciones.gesto !== false) cara.emocion(opciones.gesto || "sorpresa", 1100);
    if (opciones.registro !== false) conversar("px", frase);
    if (opciones.beep !== false) beep(800, 1200);
    decirFrase(frase);
    await finHablar();
    if (id === est.turnoId) volverAEscuchar();
  }

  // ------------------------------------------------------------------ acciones
  async function ejecutar(nombre, args, ctx) {
    for (const m of modulos) {
      if (!m.ejecutar) continue;
      const r = await m.ejecutar(nombre, args, ctx || {});
      if (r !== undefined) return r;           // undefined: no es de este modulo
    }
    if (nombre === "crear_recordatorio") {
      const texto = String(args.texto || "").trim().replace(/[.\s]+$/, "").slice(0, 200);
      // "en 10 minutos" se cuenta aqui, al segundo: Gemini redondea la hora al minuto (en 1 minuto salian 15 s)
      const minutos = Number(args.en_minutos);
      const cuando = isFinite(minutos) && minutos > 0 ? Date.now() + minutos * 60000 : leerCuando(args.cuando || "");
      if (!texto) return "¿Qué quieres que te recuerde?";
      if (!isFinite(cuando) || cuando < Date.now() - 60000) return "No entendí para cuándo. Dímelo así: en 10 minutos, o mañana a las 8.";
      const hora = Math.max(cuando, Date.now() + 5000);
      try {
        const d = nube.d, r = d.push(refRec());
        await conTiempo(d.set(r, {texto, cuando: hora, creado: d.serverTimestamp()}), 8000);
      } catch (e) {
        console.warn("agente: recordatorio", e);
        return "No pude guardar el recordatorio. Revisa la conexión e inténtalo otra vez.";
      }
      return `Listo, te recuerdo ${texto} ${cuandoDicho(hora)}.`;
    }
    if (nombre === "ver_recordatorios") {
      const rs = (est.recordatorios || []).filter((r) => r.cuando > Date.now() - 60000);
      if (!rs.length) return "No tienes recordatorios pendientes.";
      const lista = rs.slice(0, 5).map((r) => `${r.texto}, ${cuandoDicho(r.cuando)}`).join("; ");
      return `Tienes ${rs.length === 1 ? "un recordatorio" : rs.length + " recordatorios"}: ${lista}${rs.length > 5 ? ", y más" : ""}.`;
    }
    if (nombre === "borrar_recordatorio") {
      const rs = est.recordatorios || [], q = plano(String(args.texto || "")).trim();
      if (!rs.length) return "No tienes recordatorios pendientes.";
      const todos = /^(todos|todo|todas)\b/.test(q);
      const palabras = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const nota = (r) => palabras.filter((w) => plano(r.texto).includes(w)).length;
      let elegidos = todos ? rs : [];
      if (!todos) {
        const mejor = rs.reduce((a, r) => (nota(r) > nota(a) ? r : a), rs[0]);
        if (nota(mejor) > 0) elegidos = [mejor];
      }
      if (!elegidos.length) return "No encontré ese recordatorio.";
      try {
        await conTiempo(Promise.all(elegidos.map((r) => nube.d.remove(refRec(r.id)))), 8000);
      } catch (e) {
        console.warn("agente: borrar", e);
        return "No pude borrar el recordatorio. Revisa la conexión.";
      }
      return todos ? "Borré todos tus recordatorios." : `Borré el recordatorio de ${elegidos[0].texto}.`;
    }
    return "";
  }

  // Ultimo recurso de musica.js (sin forma de encontrar el video exacto): una busqueda de YouTube que se
  // abre con un toque. En el celular abre la app de YouTube.
  function mostrarVideo(q) {
    const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
    const caja = $("#ag-video");
    caja.innerHTML = `<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/></svg></span>
      <div class="txt"><b>${esc(q)}</b><small>En YouTube: tócalo para ponerlo.</small></div>
      <a class="btn primario" href="${esc(url)}" target="_blank" rel="noopener">Abrir en YouTube</a>
      <button class="btn" type="button" data-quitar-video aria-label="Quitar">✕</button>`;
    caja.hidden = false;
  }

  // ------------------------------------------------------------------ recordatorios y ajustes en la nube
  const refRec = (id) => nube.d.ref(nube.db, `usuarios/${nube.uid}/recordatorios${id ? "/" + id : ""}`);
  const refAjustes = () => nube.d.ref(nube.db, `usuarios/${nube.uid}/ajustes`);

  function escucharUsuario() {
    est.quitar.forEach((f) => f());
    est.quitar = [];
    est.recordatorios = null;
    if (!nube.uid) return;
    const d = nube.d;
    est.quitar.push(d.onValue(refRec(), (s) => {
      const v = s.val() || {};
      est.recordatorios = Object.entries(v)
        .filter(([, r]) => r && typeof r.texto === "string" && typeof r.cuando === "number")
        .map(([id, r]) => ({id, texto: r.texto, cuando: r.cuando}))
        .sort((a, b) => a.cuando - b.cuando);
      pintarAgenda();
      pintar();
    }, (e) => { console.warn("agente: recordatorios", e); est.recordatorios = []; pintarAgenda(); }));
    est.quitar.push(d.onValue(refAjustes(), (s) => {
      const v = s.val() || {};
      est.ajustes = {personalidad: typeof v.personalidad === "string" ? v.personalidad : "",
        respuesta: v.respuesta === "corta" ? "corta" : "normal", voz: typeof v.voz === "string" ? v.voz : "",
        tono: TONOS[v.tono] ? v.tono : TONO_DEFECTO};
      pintarFormulario();
      pintar();
    }, (e) => console.warn("agente: ajustes", e)));
  }

  // Los que vencen se dicen con la app abierta; si estaba cerrada, al volver, avisando que van tarde.
  // Se borra antes de decirlo con una transaccion: si la app esta abierta en dos aparatos, lo dice uno.
  async function revisarRecordatorios() {
    if (!est.recordatorios || est.diciendoRec || !nube.uid || ocupado()) return;
    const ahora = Date.now();
    const r = est.recordatorios.find((x) => x.cuando <= ahora && !est.fallidos.has(x.id));
    if (!r) return;
    est.diciendoRec = true;
    let decirlo = false;
    try {
      const res = await conTiempo(nube.d.runTransaction(refRec(r.id), (actual) => (actual ? null : undefined), {applyLocally: false}), 10000);
      decirlo = res.committed;
    } catch (e) {
      console.warn("agente: no pude marcar el recordatorio", e);
      est.fallidos.add(r.id);                  // que no lo repita cada segundo; se dice igual una vez
      decirlo = true;
    }
    if (decirlo && !ocupado()) {
      const id = ++est.turnoId;
      pararRec();
      const tarde = ahora - r.cuando > 120000;
      const frase = tarde ? `Se me pasó un recordatorio de ${cuandoDicho(r.cuando, ahora)}: ${r.texto}.` : `Recordatorio: ${r.texto}.`;
      toast(frase);
      conversar("px", frase);
      beep(800, 1200);
      decirFrase(frase);
      await finHablar();
      if (id === est.turnoId) volverAEscuchar();
    }
    est.diciendoRec = false;
  }

  async function guardarAjustes(a) {
    const nuevo = {personalidad: String(a.personalidad || "").trim().slice(0, 300), respuesta: a.respuesta === "corta" ? "corta" : "normal",
      voz: String(a.voz || "").slice(0, 200), tono: TONOS[a.tono] ? a.tono : TONO_DEFECTO};
    est.ajustes = nuevo;                       // vale ya en este celular aunque no se pueda guardar
    agenteTocado = false;
    pintar();
    if (!nube.uid) return false;
    try {
      await conTiempo(nube.d.set(refAjustes(), nuevo), 8000);
      toast("Guardado. Píxel ya habla así.");
      return true;
    } catch (e) {
      toast("Se usa en este celular, pero no pude guardarlo en tu cuenta (" + (e.code || e.message) + ").", true);
      return false;
    }
  }

  async function probar() {
    if (ocupado()) { toast("Espera a que termine de hablar.", true); return; }
    desbloquear();
    const id = ++est.turnoId;
    pararRec();
    const v = vozElegida();
    decirFrase(`Hola, soy ${ACTIVACION}. Así sueno en este celular.`);
    if (!v) toast("Este navegador no tiene voces en español: Píxel solo podrá escribir.", true);
    await finHablar();
    if (id === est.turnoId) volverAEscuchar();
  }

  // ------------------------------------------------------------------ pantalla
  function conversar(quien, texto) {
    est.conversacion.push({quien, texto});
    est.conversacion = est.conversacion.slice(-6);
    pintar();
  }

  function pintarFormulario() {
    if (!est.montado || agenteTocado) return;
    const a = est.ajustes, vs = voces(), elegida = vozElegida();
    $("#activacion").textContent = ACTIVACION;
    $("#voces").innerHTML = vs.length
      ? vs.map((v) => `<label class="voz"><input type="radio" name="voz" value="${esc(idVoz(v))}" ${elegida && idVoz(v) === idVoz(elegida) ? "checked" : ""}><span>${esc(v.name)} <small class="sub">· ${esc(v.lang)}</small></span></label>`).join("")
      : '<div class="vacio">Este navegador no tiene voces en español. Píxel te contestará por escrito.</div>';
    $("#personalidad").value = a.personalidad;
    document.querySelectorAll("input[name=respuesta]").forEach((r) => { r.checked = r.value === a.respuesta; });
    document.querySelectorAll("input[name=tono]").forEach((r) => { r.checked = r.value === (a.tono || TONO_DEFECTO); });
    contar();
  }

  function pintarAgenda() {
    if (!est.montado) return;
    const rs = est.recordatorios;
    const h = rs === null ? '<div class="vacio">Cargando…</div>'
      : rs.length ? rs.map((r) => `<div class="fila"><div class="txt"><b>${esc(r.texto)}</b><small>${esc(cuandoDicho(r.cuando))}</small></div>
          <button class="btn peligro" type="button" data-borrar-rec="${esc(r.id)}">Borrar</button></div>`).join("")
      : '<div class="vacio">No hay recordatorios pendientes.</div>';
    if (h !== est.pintadoAgenda) { $("#lista-recordatorios").innerHTML = h; est.pintadoAgenda = h; }
    const n = rs ? rs.length : 0;
    $("#r-agenda").textContent = rs ? n : "–";
    $("#r-agenda-sub").textContent = `recordatorio${n === 1 ? "" : "s"}`;
  }

  function pintar() {
    if (!est.montado) return;
    const conSesion = !!nube.usuario, e = est.estado;
    $("#ag").hidden = !conSesion || !SR;
    $("#ag-escribir").hidden = !conSesion;
    const b = $("#ag-btn");
    b.textContent = oye.quiere ? "Parar" : "Escuchar";
    b.className = "btn grande" + (oye.quiere ? "" : " primario");
    b.setAttribute("aria-pressed", oye.quiere ? "true" : "false");
    const oido = (oye.pendiente + " " + oye.interino).trim();
    $("#ag-interino").textContent = oido ? "“" + oido + "…”" : "";
    $("#ag-aviso").hidden = !est.aviso;
    $("#ag-aviso").textContent = est.aviso;
    const p = est.pendiente, caja = $("#ag-confirmar");
    const hp = p ? `<div class="txt"><b>${esc(p.titulo || p.pregunta)}</b>${p.detalle ? `<small>${esc(p.detalle)}</small>` : ""}</div>
      <div class="acciones"><button class="btn primario" type="button" data-pendiente="si">${esc(p.boton || "Sí, hazlo")}</button>
      <button class="btn" type="button" data-pendiente="no">Cancelar</button></div>` : "";
    if (caja.dataset.firma !== hp) { caja.innerHTML = hp; caja.dataset.firma = hp; caja.hidden = !p; }
    for (const m of modulos) { try { if (m.pintar) m.pintar(); } catch (e) { console.warn("agente:", m.nombre, e); } }
    if (!conSesion) return;                   // sin sesion, Inicio lo pinta app.js ("Entrar con Google")

    // un modulo puede poner su propio estado en Inicio (la musica: "Modo música"; tiempo.js: el pomodoro
    // o la guia de Eisenhower). Manda el primero de MODULOS que conteste.
    let propio = null;
    for (const m of modulos) { try { if (m.hero && usar(m)) { propio = m.hero(); if (propio) break; } } catch (er) { propio = null; } }
    pill("#pill-esp", oye.quiere ? "ok" : SR ? "" : "warn", propio && propio.pill ? propio.pill : oye.quiere ? "Escuchando" : SR ? "Micrófono apagado" : "Sin reconocimiento de voz");
    pill("#pill-ollama", !est.ai ? "" : est.iaError ? "warn" : "ok",
      !est.ai ? "IA cargando…" : est.iaError === "cupo" ? "Gemini sin cupo hoy" : est.iaError === "red" ? "Sin internet"
        : est.iaError === "appcheck" ? "Falta App Check" : est.iaError === "minuto" ? "Gemini: espera un minuto" : est.iaError ? "Gemini con error" : "IA: Gemini");
    if (cara) cara.estado(e === "hablando" ? "hablando" : e === "pensando" ? "pensando" : oye.quiere ? "escuchando" : "normal");
    $("#zzz").hidden = true;
    $("#latido").className = "latido" + (e === "hablando" ? " habla" : e === "escuchando" || e === "pensando" ? " ok" : "");
    if (Date.now() > dichoHasta) {
      const ventana = Date.now() < oye.ventanaHasta;
      const [titulo, sub] = e === "pensando" ? ["Déjame pensar…", "Te oí. Ya te contesto."]
        : e === "hablando" ? ["Estoy hablando…", oye.quiere ? "Cuando acabe, te sigo escuchando." : ""]
        : e === "escuchando" ? (ventana ? ["Dime…", "Te escucho: ahora no hace falta decir Píxel."]
          : oido ? ["Te oigo…", "Si es para mí, empieza con «Píxel»."]
          : ["Te escucho", `Di «${ACTIVACION}» y tu pregunta. Deja la app abierta en pantalla.`])
        : ["¡Hola! Soy Píxel", SR ? "Toca Escuchar y háblame, o escríbeme abajo." : "Este navegador no puede oírme: escríbeme abajo, o abre la app en Chrome (Android) o Safari (iPhone)."];
      const enMusica = propio && (e === "escuchando" || e === "listo") && !ventana && !oido;
      $("#hero-estado").textContent = enMusica ? propio.titulo : titulo;
      $("#hero-sub").textContent = enMusica ? propio.sub : sub;
      // cada modo tiene sus colores (estilos.css): musica, pausa, pomodoro, descanso, matriz
      $(".hero").classList.toggle("modo-musica", !!(propio && (propio.modo === "musica" || propio.modo === "pausa")));
      $(".hero").dataset.modo = (propio && propio.modo) || "";
    }
    const conv = est.conversacion.length
      ? `<div class="conv">${est.conversacion.map((c) => `<p class="${c.quien}"><b>${c.quien === "tu" ? "Tú" : "Píxel"}</b> ${esc(c.texto)}</p>`).join("")}</div>`
      : "Todavía nada. Toca Escuchar y di «Píxel, ¿qué hora es?».";
    if (conv !== est.pintadoConv) { $("#ultimo").innerHTML = conv; est.pintadoConv = conv; }
    const v = vozElegida();
    $("#r-voz").textContent = v ? v.name.replace(/^(Google|Microsoft)\s+/i, "").split(/\s+[-(]/)[0] : "Sin voz";
    $("#r-voz-sub").textContent = v ? "voz de este celular · " + v.lang : "este navegador no tiene voces en español";
    const u = nube.usuario;
    $("#r-cuentas").textContent = u && u.isAnonymous ? "Prueba" : "Google";
    $("#r-cuentas-sub").textContent = u ? (u.email || u.displayName || "sesión iniciada") : "";
  }

  function montarDom() {
    $("#ag-btn").addEventListener("click", () => (oye.quiere ? parar() : empezar()));
    $("#ag-escribir").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const t = $("#ag-texto").value.trim();
      if (!t) return;
      if (ocupado()) { toast("Espera a que termine.", true); return; }
      desbloquear();
      $("#ag-texto").value = "";
      orden(t);
    });
    $("#ag-video").addEventListener("click", (ev) => { if (ev.target.closest("[data-quitar-video]")) $("#ag-video").hidden = true; });
    $("#ag-confirmar").addEventListener("click", async (ev) => {       // "Enviar" / "Cancelar" con el dedo
      const b = ev.target.closest("[data-pendiente]");
      if (!b || !est.pendiente || ocupado()) return;
      desbloquear();
      const id = ++est.turnoId;
      pararRec();
      ponerEstado("pensando");
      const t = await resolverPendiente(b.dataset.pendiente === "si");
      if (id !== est.turnoId) return;
      if (t) { conversar("px", t); decirFrase(t); }
      await finHablar();
      if (id === est.turnoId) volverAEscuchar();
    });
    $("#lista-recordatorios").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-borrar-rec]");
      if (b && nube.uid) nube.d.remove(refRec(b.dataset.borrarRec)).catch((e) => toast("No pude borrarlo: " + (e.code || e.message), true));
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !oye.quiere) return;
      pedirPantalla();
      if (audio && audio.state !== "running") audio.resume().catch(() => {});
      arrancarRec();
    });
    if (typeof speechSynthesis !== "undefined") speechSynthesis.addEventListener("voiceschanged", () => { pintarFormulario(); pintar(); });
    // la pagina de Personalidad edita a este Pixel: sin "Por dónde habla" (siempre el celular)
    $("#salida-bloque").hidden = true;
    $("#voces-nota").textContent = "Voces de este celular. Cambian según el aparato y el navegador.";
    $("#voces-nota").hidden = false;
    $("#card-eventos").hidden = true;
    $("#agenda-sub").textContent = "Los recordatorios suenan a su hora con la app abierta; si estaba cerrada, te los digo al volver.";
    setInterval(() => {
      revisarRecordatorios();
      caducarPendiente();
      for (const m of modulos) { try { if (m.alSegundo && usar(m)) m.alSegundo(); } catch (e) { console.warn("agente:", m.nombre, e); } }
    }, 1000);
    setInterval(() => { if (est.estado === "escuchando" && oye.ventanaHasta) pintar(); }, 500);
  }

  // ------------------------------------------------------------------ modulos
  // Cada modulo es un objeto con lo que necesite de esto (todo opcional):
  //   nombre, capacidad() -> linea para "Lo que puedes hacer", herramientas() -> [declaraciones],
  //   ejecutar(nombre, args, ctx) -> texto | {respuesta, decir?} | undefined (no es mia),
  //   contexto(texto) -> texto para el prompt, montar(), alUsuario(u), alSegundo(), pintar(),
  //   alTurno(texto, respuesta) -> tras cada respuesta de Gemini
  //   atajo(texto) -> undefined, o una promesa con lo que se dice: la orden se resuelve sin Gemini
  //   dictar(texto) -> true si se queda con lo que se oyo (una nota abierta), antes de buscar "Píxel"
  function modulo(m) {
    modulos.push(m);
    if (est.montado && m.montar) m.montar();
    if (est.montado && nube.usuario && m.alUsuario) m.alUsuario(nube.usuario);
  }

  function cargarScript(src) {
    return new Promise((ok) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => { console.warn("agente: no cargo", src); ok(); };   // sin un modulo, el resto sigue
      document.head.append(s);
    });
  }

  async function cargarInstrucciones() {
    try {
      const r = await fetch("agente.md", {cache: "no-cache"});
      if (r.ok) est.instrucciones = await r.text();
    } catch (e) { console.warn("agente: sin agente.md", e); }
  }

  // Una pregunta suelta a Gemini que devuelve JSON (el cerebro la usa para aprender del usuario).
  // No pasa por la voz ni por el historial.
  //   motivo: para la cuenta del uso (Ajustes): "aprender", "clasificar", "analizar"...
  async function generarJSON(prompt, instrucciones, motivo) {
    if (!est.ai) throw new Error("IA sin cargar");
    for (;;) {
      const modelo = est.ia.getGenerativeModel(est.ai, {model: modeloDeHoy(), systemInstruction: instrucciones || undefined,
        generationConfig: {maxOutputTokens: 1200, responseMimeType: "application/json", thinkingConfig: {thinkingLevel: "LOW"}}}, {timeout: 30000});
      try {
        const r = await modelo.generateContent(prompt);
        contarUso(motivo || "otro", modeloDeHoy(), r.response && r.response.usageMetadata);
        return JSON.parse(r.response.text());
      } catch (e) {
        if (!(esCupo(e) && cupoDelDia(e) && siguienteModelo())) throw e;
      }
    }
  }

  // ------------------------------------------------------------------ cuanto se gasta de Gemini (Fase 14)
  // Cada peticion que contesta Gemini se apunta en usuarios/<uid>/uso/<dia del cupo> (el dia de Google:
  // empieza a medianoche del Pacifico): peticiones y tokens de entrada y de salida (los de "pensar" van
  // con la salida: Google los cobra asi), por motivo y por modelo. ajustes.js lo dibuja.
  function contarUso(motivo, modelo, u) {
    if (!nube.uid || !nube.d) return;
    const e = (u && u.promptTokenCount) || 0, sal = ((u && u.candidatesTokenCount) || 0) + ((u && u.thoughtsTokenCount) || 0);
    const mk = String(modelo || "otro").replace(/[.#$/[\]]/g, "_");
    nube.d.runTransaction(nube.d.ref(nube.db, `usuarios/${nube.uid}/uso/${diaDelCupo()}`), (v) => {
      v = v || {};
      v.peticiones = (v.peticiones || 0) + 1;
      v.entrada = (v.entrada || 0) + e;
      v.salida = (v.salida || 0) + sal;
      v.por = v.por || {};
      v.por[motivo] = (v.por[motivo] || 0) + 1;
      v.m = v.m || {};
      const x = v.m[mk] || {n: 0, e: 0, s: 0};
      v.m[mk] = {n: x.n + 1, e: x.e + e, s: x.s + sal};
      return v;
    }).catch((er) => console.warn("agente: no pude apuntar el uso de Gemini", er));
  }

  // ------------------------------------------------------------------ que modelo usar hoy
  // El dia del cupo de Google empieza a medianoche del Pacifico (UTC-8; con el horario de verano, 1 h antes)
  const diaDelCupo = () => new Date(Date.now() - 8 * 3600000).toISOString().slice(0, 10);
  function modeloDeHoy() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem("pixel.modelo") || "null"); } catch (e) { v = null; }
    const i = v && v.dia === diaDelCupo() ? Math.min(v.i, MODELOS.length - 1) : 0;
    return MODELOS[i];
  }
  function siguienteModelo() {
    const i = MODELOS.indexOf(modeloDeHoy());
    if (i + 1 >= MODELOS.length) return false;
    try { localStorage.setItem("pixel.modelo", JSON.stringify({dia: diaDelCupo(), i: i + 1})); } catch (e) { return false; }
    console.warn("agente: el cupo de hoy de", MODELOS[i], "se acabo; sigo con", MODELOS[i + 1]);
    return true;
  }

  // ------------------------------------------------------------------ entrada desde app.js
  async function iniciar(app) {
    est.app = app;
    est.montado = true;
    montarDom();
    usuario(nube.usuario);
    // las instrucciones y los modulos se cargan mientras llega la IA
    const piezas = cargarInstrucciones().then(async () => { for (const f of MODULOS) await cargarScript(f); });
    try {
      if (APP_CHECK_CLAVE) {
        const ac = await import(SDK + "firebase-app-check.js");
        if (location.hostname === "localhost") self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;   // en pruebas: token de depuracion (se registra en la consola)
        ac.initializeAppCheck(app, {provider: new ac.ReCaptchaV3Provider(APP_CHECK_CLAVE), isTokenAutoRefreshEnabled: true});
      }
      const ia = await import(SDK + "firebase-ai.js");
      await piezas;                            // que Gemini no conteste sin sus instrucciones ni herramientas
      est.ia = ia;
      est.ai = ia.getAI(app, {backend: new ia.GoogleAIBackend()});
    } catch (e) {
      console.warn("agente: no cargo firebase-ai", e);
      est.aviso = "No pude cargar la IA de Gemini. Revisa la conexión y recarga la página.";
    }
    pintar();
  }

  // la sesion cambio (entrar, salir u otra cuenta): se empieza de cero
  function usuario(u) {
    if (!est.montado) return;
    parar();
    est.turnoId++;
    callar();
    Object.assign(est, {historial: [], conversacion: [], ultimaT: 0, estado: "listo", pintadoConv: "", pintadoAgenda: "",
      ajustes: {personalidad: "", respuesta: "normal", voz: "", tono: TONO_DEFECTO}, fallidos: new Set(), pendiente: null});
    if (u) escucharUsuario();
    else { est.quitar.forEach((f) => f()); est.quitar = []; est.recordatorios = null; }
    for (const m of modulos) { try { if (m.alUsuario) m.alUsuario(u); } catch (e) { console.warn("agente:", m.nombre, e); } }
    pintarFormulario();
    pintarAgenda();
    pintar();
  }

  // Lo que usan los modulos (cerebro.js, google.js, tiempo.js, aparatos.js)
  const nucleo = {
    est, oye, decir: decirFrase, finHablar, pararRec, volverAEscuchar, ponerEstado, conversar, pintar, aviso, beep, ocupado,
    conTiempo, esperar, confirmar, anunciar, generarJSON, desbloquear, orden, mostrarVideo, escuchar: empezar,
    hayIA: () => !!est.ai, ajustes: () => est.ajustes, sistema, herramientas,
    // Ajustes (ajustes.js): los interruptores, el modelo de hoy y el dia del cupo de Google
    activo, modos: (o) => { modos = Object.assign({}, o || {}); pintar(); }, MODOS_DEFECTO, modeloDeHoy, diaDelCupo, MODELOS,
  };

  window.Agente = {iniciar, usuario, nivelBoca, guardarAjustes, probar, pintar, modulo, nucleo,
    activo: () => est.montado && !!nube.usuario,
    texto: {plano, activacion, extraerFrases, cuandoDicho, leerCuando, horaDicha, fechaAhora, respuestaPendiente, juntarParte, parecido}};
})();
