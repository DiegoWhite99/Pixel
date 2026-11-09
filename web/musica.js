/* Fase 13 - Musica y videos de YouTube con Pixel como asistente de verdad: "pon tal cancion" la pone
   ya, y "para", "pausa", "sigue", "cambia de cancion", "mas alto"... la manejan, este donde este.
   - Buscar el video exacto, en este orden:
       1. YouTube Data API (search.list) con YOUTUBE_CLAVE: clave de navegador restringida a esa API y
          a los dominios de la app. Cupo gratis: 10 000 unidades al dia = 100 busquedas.
       2. Un puente con "youtube" en linea (el PC: puente_pc.buscar_youtube, con yt-dlp).
       3. Si no hay ninguno, la tarjeta "Abrir en YouTube" de antes.
     Se piden 5 resultados: si uno no deja verse fuera de YouTube (error 101/150), va el siguiente;
     al acabar uno sigue el siguiente, y "cambia de canción" recorre esa lista.
   - Donde suena (Personalidad, por aparato, o por voz con "donde"). Las tres se manejan igual (SALIDAS):
       ventana (por defecto en el PC; el usuario la quiere "en otra ventana"): la ventana de musica de
         Pixel (reproductor.html) con el reproductor de YouTube dentro. No se abre youtube.com directo:
         YouTube manda Cross-Origin-Opener-Policy y la pagina que lo abre pierde la ventana (no podria
         pararla ni cambiarla). Esta es del mismo origen: se maneja entera y se reutiliza. Hace falta
         permitir una vez las ventanas emergentes de la pagina; si no, suena aqui y lo dice.
         En Android una ventana es una pestana que tapa a Pixel (y deja de oir), y una web no puede
         manejar la app de YouTube: ahi suena aqui, y hay un boton para abrirla en la app (sin control).
       app: el reproductor embebido de Inicio (IFrame Player API).
       pc: el navegador del PC de Pixel (puente_pc): pausa, siguiente y volumen con playerctl y pactl.
   - Mientras el usuario dice "Píxel..." o Pixel piensa y habla, la musica baja (y luego vuelve).
   - Pixel baila mientras suena (pedido del usuario): el sonido de YouTube no se puede analizar (va
     dentro de su reproductor), asi que Gemini da el tempo (bpm) al poner la cancion, y la cara baila
     a ese tempo contando con el tiempo del video (si se pausa, para; al seguir, retoma el paso).
   Al cargarse no toca la pagina: las funciones de texto (PixelMusica.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo;

  // Clave de navegador de Google Cloud (proyecto pixelassitance) restringida a la YouTube Data API v3
  // (search.list) y a los dominios de la app: no es secreta. Vacia: busca el PC.
  const YOUTUBE_CLAVE = (window.PIXEL_CLAVES || {}).youtube || "";    // web/claves.js, fuera de git
  const API_YT = "https://www.youtube.com/iframe_api";
  const VOLUMEN_BAJO = 12;                     // mientras Pixel oye la orden, piensa o habla
  const VENTANA = "popup=yes,width=1000,height=640,left=40,top=40";   // ventana aparte (una pestana taparia a Pixel)
  const DONDE = ["ventana", "app", "pc"];

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  function desentidades(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  }

  // Un titulo de YouTube para decirlo: sin "(Official Video)", "[HD]", "| Lyrics"...
  function tituloDicho(t) {
    return desentidades(t).replace(/\[[^\]]*\]/g, "")
      .replace(/\([^)]*(official|oficial|video|lyric|letra|audio|hd|4k|remaster|visualizer|en vivo|live|subt|traduc|espa)[^)]*\)/gi, "")
      .replace(/\s*[|•]\s*.*$/, "").replace(/\s{2,}/g, " ").trim() || desentidades(t);
  }

  const urlVideo = (id) => `https://www.youtube.com/watch?v=${id}`;
  // la app de YouTube en Android; si no esta instalada, la pagina
  const urlIntent = (id) => `intent://www.youtube.com/watch?v=${id}#Intent;scheme=https;package=com.google.android.youtube;`
    + `S.browser_fallback_url=${encodeURIComponent(urlVideo(id))};end`;

  function resultadosApi(j) {
    return ((j && j.items) || []).filter((it) => it.id && it.id.videoId)
      .map((it) => ({id: it.id.videoId, titulo: desentidades(it.snippet && it.snippet.title), canal: desentidades(it.snippet && it.snippet.channelTitle)}));
  }

  // Ordenes cortas de musica que se entienden sin Gemini (mas rapido y sin gastar cupo): la accion de
  // controlar_musica, o null. Solo frases cortas que son solo eso: "pon otra de Shakira" va a Gemini.
  const ATAJOS = [
    ["parar", /^(para|paralo|parala|deten|detenla|quita|quitala|apaga|apagala|stop|basta)( la| el| esa| esta| ya)?( musica| cancion| video| cancion ya| musica ya)?( ya)?$/],
    ["pausar", /^(pausa|pausala|pon pausa|pon en pausa|pausar)( la| el)?( musica| cancion| video)?$/],
    ["seguir", /^(sigue|siguela|continua|reanuda|dale play|play|quita la pausa|dale)( con)?( la| el)?( musica| cancion| video)?$/],
    ["siguiente", /^(siguiente|la siguiente|pasa|pasala|salta|saltala|next|otra|otra cancion|cambia|cambiala|cambia la cancion|cambia de cancion|cambia el video|pon la siguiente|pon otra)$/],
    ["anterior", /^(anterior|la anterior|vuelve a la anterior|regresa|pon la anterior)$/],
    ["subir_volumen", /^(sube|subele|mas alto|mas fuerte|sube el volumen|subele el volumen|subele volumen)$/],
    ["bajar_volumen", /^(baja|bajale|mas bajo|mas suave|baja el volumen|bajale el volumen|bajale volumen)$/],
  ];
  function atajoDe(texto) {
    const t = A.texto.plano(String(texto || "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\b(por favor|porfa|oye|ahora)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.split(" ").length > 6) return null;
    const v = /^(pon )?(el )?volumen (al |a |en )?(\d{1,3})( por ciento)?$/.exec(t);
    if (v) return {accion: "volumen", valor: +v[4]};
    for (const [accion, re] of ATAJOS) if (re.test(t)) return {accion};
    return null;
  }

  // "youtube" era el nombre de antes de "ventana"
  const normalizarDonde = (v) => (v === "youtube" ? "ventana" : DONDE.includes(v) ? v : "ventana");

  // ------------------------------------------------------------------ estado
  const mu = {salida: null, cola: [], i: 0, consulta: "", volumen: 80, bajo: false, estado: -1, pintado: "",
    jugador: null, listo: null, empezo: false, sinSonido: false, comprobar: null,    // reproductor de la app
    ventana: null, vigia: null,                                                                 // ventana de musica
    bpm: 110, genero: "pop", bailando: false};                                                  // la cara baila

  function dondeGuardado() {
    try { return normalizarDonde(localStorage.getItem("pixel.musica")); } catch (e) { return "ventana"; }
  }
  function guardarDonde(v) { try { localStorage.setItem("pixel.musica", normalizarDonde(v)); } catch (e) { /* solo esta vez */ } }
  const esAndroid = () => /Android/i.test(navigator.userAgent || "");
  const actual = () => mu.cola[mu.i] || null;
  // mientras Pixel oye, piensa o habla, la musica baja
  const volumenAhora = () => (mu.bajo || N.ocupado() ? Math.min(VOLUMEN_BAJO, mu.volumen) : mu.volumen);

  // ------------------------------------------------------------------ buscar
  async function buscarApi(q) {
    const u = "https://www.googleapis.com/youtube/v3/search?" + new URLSearchParams({part: "snippet", type: "video", videoEmbeddable: "true",
      videoSyndicated: "true", maxResults: "5", q, key: YOUTUBE_CLAVE, relevanceLanguage: "es"});
    const r = await N.conTiempo(fetch(u), 10000);
    if (!r.ok) throw new Error("YouTube " + r.status);
    return resultadosApi(await r.json());
  }

  async function buscarPc(q) {
    const P = window.PixelAparatos, pid = P && P.puenteCon("youtube");
    if (!pid) return null;
    const r = await P.mandar(pid, "/api/youtube/buscar", {consulta: q}, 20000);
    try { return JSON.parse(r.resultados || "[]"); } catch (e) { return []; }
  }

  // [{id, titulo, canal}] o null si no hay forma de buscar
  async function buscar(q) {
    if (YOUTUBE_CLAVE) {
      try { const r = await buscarApi(q); if (r.length) return r; } catch (e) { console.warn("musica: API de YouTube", e); }
    }
    try { return await buscarPc(q); } catch (e) { console.warn("musica: el PC no busco", e); return null; }
  }

  // ------------------------------------------------------------------ salida 1: el reproductor de la app
  function cargarApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (mu.listo) return mu.listo;
    mu.listo = new Promise((ok, mal) => {
      const antes = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (antes) antes(); ok(); };
      const s = document.createElement("script");
      s.src = API_YT;
      s.onerror = () => { mu.listo = null; mal(new Error("no cargo el reproductor de YouTube")); };
      document.head.append(s);
    });
    return mu.listo;
  }

  const APP = {
    nombre: "app",
    async poner(v) {
      await cargarApi();
      $("#ag-musica").hidden = false;
      $("#ag-musica").classList.remove("remota");
      mu.empezo = false;
      if (mu.jugador && mu.jugador.loadVideoById) mu.jugador.loadVideoById(v.id);
      else {
        await new Promise((ok) => {
          mu.jugador = new YT.Player("ag-yt", {videoId: v.id, width: "100%", height: "100%",
            playerVars: {autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 1},
            events: {
              onReady: (e) => { e.target.setVolume(volumenAhora()); e.target.playVideo(); ok(); },
              onStateChange: (e) => { if (mu.salida !== APP) return; mu.estado = e.data; if (e.data === 1) mu.empezo = true; if (e.data === 0) siguiente(true); pintar(); },
              onError: (e) => {                        // 100: no existe; 101/150: no deja verse fuera de YouTube
                console.warn("musica: el video", actual() && actual().id, "dio error", e.data);
                if (mu.salida === APP) videoFallo();
              },
            }});
          setTimeout(ok, 8000);
        });
      }
      // si Chrome no lo deja sonar solo, que suene sin volumen y se pida un toque (solo si nunca sono:
      // si el usuario lo pauso en estos segundos, se queda pausado)
      clearTimeout(mu.comprobar);
      mu.comprobar = setTimeout(() => {
        const j = mu.jugador;
        if (!j || !j.getPlayerState || mu.empezo || mu.salida !== APP) return;
        if (j.getPlayerState() !== 1 && j.getPlayerState() !== 3) { j.mute(); j.playVideo(); mu.sinSonido = true; pintar(); }
      }, 3500);
      return true;
    },
    pausar() { clearTimeout(mu.comprobar); if (mu.jugador) mu.jugador.pauseVideo(); },
    seguir() { if (mu.jugador) mu.jugador.playVideo(); },
    parar() { clearTimeout(mu.comprobar); if (mu.jugador && mu.jugador.stopVideo) mu.jugador.stopVideo(); },
    volumen(n) { if (mu.jugador && mu.jugador.setVolume && !mu.sinSonido) mu.jugador.setVolume(n); },
    estado() { return mu.estado; },
  };

  // ------------------------------------------------------------------ salida 2: la ventana de musica de Pixel
  const ventanaViva = () => mu.ventana && !mu.ventana.closed && mu.ventana.Pixel ? mu.ventana : null;

  const VENT = {
    nombre: "ventana",
    async poner(v) {
      let w = ventanaViva();
      if (w) {                                     // ya abierta: se cambia el video, sin otra ventana
        w.Pixel.poner(v.id, tituloDicho(v.titulo));
        return true;
      }
      try { w = window.open(`reproductor.html#v=${v.id}`, "pixel-musica", VENTANA); } catch (e) { w = null; }
      if (!w) return false;                        // ventanas emergentes bloqueadas
      mu.ventana = w;
      // cuando cargue: el titulo, que avise al acabar cada video y seguir su estado
      const t0 = Date.now();
      while (!(w.Pixel) && Date.now() - t0 < 8000 && !w.closed) await N.esperar(150);
      if (w.Pixel) {
        w.Pixel.poner(v.id, tituloDicho(v.titulo));
        w.Pixel.alTerminar((error) => { if (mu.salida === VENT) { if (error) videoFallo(); else siguiente(true); } });
      }
      clearInterval(mu.vigia);
      mu.vigia = setInterval(() => {               // la ventana manda: si la cierran, se acabo la musica
        if (mu.salida !== VENT) return;
        if (!mu.ventana || mu.ventana.closed) { clearInterval(mu.vigia); mu.cola = []; mu.salida = null; $("#ag-musica").hidden = true; pintar(); return; }
        const e = mu.ventana.Pixel ? mu.ventana.Pixel.estado() : null;
        if (e && e.estado !== mu.estado) { mu.estado = e.estado; pintar(); }
      }, 700);
      return true;
    },
    pausar() { const w = ventanaViva(); if (w) w.Pixel.pausar(); },
    seguir() { const w = ventanaViva(); if (w) w.Pixel.seguir(); },
    parar() { clearInterval(mu.vigia); if (mu.ventana && !mu.ventana.closed) mu.ventana.close(); mu.ventana = null; },
    volumen(n) { const w = ventanaViva(); if (w) w.Pixel.volumenTemporal(n); },
    estado() { const w = ventanaViva(); return w ? w.Pixel.estado().estado : -1; },
  };

  // ------------------------------------------------------------------ salida 3: el navegador del PC
  async function alPc(cuerpo) {
    const P = window.PixelAparatos, pid = P && P.puenteCon("pc");
    if (!pid) throw new Error("El PC no está conectado.");
    return P.mandar(pid, "/api/pc", cuerpo, 25000);
  }
  const PC = {
    nombre: "pc",
    async poner(v) {
      if (mu.cola.length && mu.estado !== -1) await alPc({accion: "pausar"}).catch(() => {});   // que la anterior no siga sonando
      await alPc({accion: "youtube", valor: urlVideo(v.id)});
      mu.estado = 1;
      return true;
    },
    pausar() { return alPc({accion: "pausar"}); },
    seguir() { return alPc({accion: "play"}); },
    parar() { return alPc({accion: "pausar"}).catch(() => {}); },
    volumen() { /* el del PC se cambia con su accion de volumen (abajo) */ },
    estado() { return mu.estado; },
  };
  const SALIDAS = {app: APP, ventana: VENT, pc: PC};

  // ------------------------------------------------------------------ bailar
  // El tiempo del video en segundos, suavizado: el reproductor de YouTube lo da a saltos (cada ~250 ms)
  function relojDe(leer) {
    let ultimo = {t: -1, at: 0};
    return () => {
      let t;
      try { t = leer(); } catch (e) { return null; }
      if (typeof t !== "number" || !isFinite(t)) return null;
      const ahora = performance.now();
      if (t !== ultimo.t) ultimo = {t, at: ahora};
      return ultimo.t + (mu.estado === 1 ? (ahora - ultimo.at) / 1000 : 0);
    };
  }
  const RELOJES = {
    app: relojDe(() => mu.jugador.getCurrentTime()),
    ventana: relojDe(() => mu.ventana.Pixel.tiempo()),
  };

  // Baila mientras suena; quieto en pausa, al parar o si no hay musica
  function sincronizarBaile() {
    const c = typeof cara !== "undefined" ? cara : null;
    if (!c || !c.bailar) return;
    const suena = mu.cola.length > 0 && mu.salida && mu.estado === 1;
    if (suena) { c.bailar(mu.bpm, RELOJES[mu.salida.nombre] || null, mu.genero); mu.bailando = true; }
    else if (mu.bailando) { c.bailar(0); mu.bailando = false; }
  }

  // ------------------------------------------------------------------ lo comun
  async function reproducir(i) {
    mu.i = i;
    const v = actual();
    if (!v) return false;
    mu.estado = 3;
    mu.sinSonido = false;
    const ok = await mu.salida.poner(v);
    pintar();
    return ok;
  }

  function siguiente(solo) {
    if (mu.i + 1 >= mu.cola.length) { if (solo) parar(); return false; }
    reproducir(mu.i + 1);
    return true;
  }

  // Un video que no deja verse aqui (100: no existe; 101/150: no deja verse fuera de YouTube; o YouTube
  // pide "confirmar que no eres un bot"): se pasa al siguiente resultado. Si ninguno sirve, Pixel no se
  // calla sin mas: lo dice y deja el boton para abrirlo en YouTube. La ventana de musica se queda abierta
  // con su aviso, por si YouTube pide iniciar sesion en su recuadro.
  function videoFallo() {
    if (mu.i + 1 < mu.cola.length) { reproducir(mu.i + 1); return; }
    const q = mu.consulta, primero = mu.cola[0];
    if (mu.salida === VENT) {
      clearInterval(mu.vigia);
      const w = ventanaViva();
      if (w && w.Pixel.aviso) w.Pixel.aviso(primero && primero.id);
      mu.cola = []; mu.i = 0; mu.estado = -1; mu.salida = null;
      $("#ag-musica").hidden = true;
      pintar();
    } else parar();
    N.mostrarVideo(q);
    N.anunciar("YouTube no me dejó poner ese video aquí. Te dejo el botón para abrirlo en YouTube.", {gesto: "triste"});
  }

  function parar() {
    if (mu.salida) mu.salida.parar();
    mu.cola = []; mu.i = 0; mu.estado = -1; mu.sinSonido = false; mu.salida = null;
    $("#ag-musica").hidden = true;
    pintar();
  }

  function aplicarVolumen() {
    if (mu.salida && mu.cola.length && mu.salida !== PC) mu.salida.volumen(volumenAhora());
  }

  // ------------------------------------------------------------------ herramientas para Gemini
  const HERRAMIENTAS = [
    {name: "poner_musica", description: "Pone ya una canción, un artista, un álbum o un video de YouTube. También para «cambia de canción» o «pon otra» cuando dice cuál.",
      parameters: {type: "object", properties: {
        consulta: {type: "string", description: "Qué buscar en YouTube, por ejemplo 'Queen Bohemian Rhapsody'. Corrige nombres mal oídos."},
        donde: {type: "string", enum: DONDE, description: "Solo si el usuario lo dice: ventana (en otra ventana con YouTube), app (aquí dentro) o pc (en el PC)."},
        bpm: {type: "number", description: "Tempo de la canción en pulsos por minuto, para que Píxel baile a ritmo. Si no lo sabes exacto, estímalo por la canción o el género (reguetón ~95, pop ~115, rock ~120, electrónica ~125, balada ~70)."},
        genero: {type: "string", enum: ["pop", "reggaeton", "rock", "metal", "electronica", "balada", "salsa", "cumbia", "rap", "clasica", "jazz"],
          description: "Género de la canción, para que Píxel baile a su estilo (salsa incluye merengue y bachata; cumbia incluye vallenato)."}},
      required: ["consulta"]}},
    {name: "controlar_musica", description: "Maneja la música o el video que puso Píxel: «para», «pausa», «sigue», «cambia de canción» o «la siguiente» (sin decir cuál), «la anterior», «más alto», «más bajo».",
      parameters: {type: "object", properties: {
        accion: {type: "string", enum: ["pausar", "seguir", "parar", "siguiente", "anterior", "subir_volumen", "bajar_volumen", "volumen"]},
        valor: {type: "number", description: "Solo para volumen: de 0 a 100."}}, required: ["accion"]}},
  ];

  async function ejecutar(nombre, a) {
    if (nombre === "poner_musica") {
      const q = String(a.consulta || "").trim().slice(0, 150);
      if (!q) return "¿Qué quieres que ponga?";
      const res = await buscar(q);
      if (!res) {                              // sin clave de YouTube ni PC encendido: la tarjeta de antes
        N.mostrarVideo(q);
        return `No puedo buscar el video exacto ahora mismo. Te dejo ${q} para abrirlo en YouTube.`;
      }
      if (!res.length) return `No encontré ${q} en YouTube.`;
      let donde = a.donde ? normalizarDonde(a.donde) : dondeGuardado();
      if (donde === "ventana" && esAndroid()) donde = "app";      // en el celular, aqui (ver arriba)
      if (donde === "pc" && !(window.PixelAparatos && window.PixelAparatos.puenteCon("pc"))) donde = esAndroid() ? "app" : "ventana";
      const otra = SALIDAS[donde];
      if (mu.salida && mu.salida !== otra) mu.salida.parar();    // cambia de sitio: lo de antes se calla
      mu.salida = otra;
      mu.cola = res; mu.consulta = q;
      mu.bpm = Math.max(50, Math.min(200, Number(a.bpm) || 110));
      mu.genero = String(a.genero || "pop").slice(0, 30);
      $("#ag-video").hidden = true;
      const titulo = tituloDicho(res[0].titulo);
      try {
        if (await reproducir(0)) {
          if (otra === VENT) { $("#ag-musica").hidden = false; $("#ag-musica").classList.add("remota"); pintar(); return `Te pongo ${titulo} en la ventana de música.`; }
          if (otra === PC) { $("#ag-musica").hidden = false; $("#ag-musica").classList.add("remota"); pintar(); return `Listo, pongo ${titulo} en el PC.`; }
          return `Pongo ${titulo}.`;
        }
      } catch (e) { console.warn("musica:", e); }
      // la ventana no se abrio (ventanas emergentes bloqueadas) o fallo el PC: suena aqui
      mu.salida = APP;
      try { await reproducir(0); } catch (e) { N.mostrarVideo(q); return "No pude cargar el reproductor de YouTube. Te lo dejo para abrirlo con un toque."; }
      return otra === VENT ? `Pongo ${titulo} aquí. Para que salga en otra ventana, permite las ventanas emergentes de esta página: el icono de la barra de direcciones.`
        : `El PC no contestó: pongo ${titulo} aquí.`;
    }
    if (nombre === "controlar_musica") {
      const s = mu.salida;
      if (!s || !mu.cola.length) return "No está sonando nada. Dime qué quieres escuchar.";
      try {
        switch (a.accion) {
          case "pausar": await s.pausar(); mu.estado = 2; pintar(); return "Pausado.";
          case "seguir": await s.seguir(); mu.estado = 1; pintar(); return "Sigo.";
          case "parar": parar(); return "Listo, la paré.";
          case "siguiente": return siguiente(false) ? `Pongo ${tituloDicho(actual().titulo)}.` : "No tengo más de esa búsqueda. Dime qué otra canción quieres.";
          case "anterior":
            if (mu.i === 0) return "Esa es la primera. Dime qué otra canción quieres.";
            await reproducir(mu.i - 1);
            return `Vuelvo a ${tituloDicho(actual().titulo)}.`;
          case "subir_volumen": case "bajar_volumen": case "volumen": {
            if (a.accion === "volumen") mu.volumen = Math.max(0, Math.min(100, Math.round(Number(a.valor) || 50)));
            else mu.volumen = Math.max(5, Math.min(100, mu.volumen + (a.accion === "subir_volumen" ? 20 : -20)));
            if (s === PC) await alPc(a.accion === "volumen" ? {accion: "volumen", valor: mu.volumen} : {accion: a.accion});
            else { if (s === VENT && ventanaViva()) mu.ventana.Pixel.volumen(mu.volumen); aplicarVolumen(); }
            return s === PC ? "Listo." : `Volumen al ${mu.volumen}.`;
          }
        }
      } catch (e) { return "No pude: " + String(e.message || e).slice(0, 100); }
      return "No sé hacer eso con la música.";
    }
    return undefined;
  }

  // ------------------------------------------------------------------ pantalla
  // En la app: con "app", el reproductor y su barra; con "ventana" o "pc", solo la barra (un mando)
  function pintar() {
    if (!document.getElementById("ag-musica")) return;
    aplicarVolumen();
    sincronizarBaile();
    const v = actual();
    const h = v ? `${v.titulo}|${mu.estado}|${mu.sinSonido}|${mu.i}/${mu.cola.length}|${mu.salida && mu.salida.nombre}` : "";
    if (h === mu.pintado) return;
    mu.pintado = h;
    if (!v) return;
    const donde = {ventana: " · en la ventana de música", pc: " · en el PC"}[mu.salida && mu.salida.nombre] || "";
    $("#mu-titulo").textContent = tituloDicho(v.titulo);
    const GENERO = {pop: "pop", reggaeton: "reguetón", rock: "rock", metal: "metal", electronica: "electrónica", balada: "balada", salsa: "salsa",
      cumbia: "cumbia", rap: "rap", clasica: "clásica", jazz: "jazz"};
    $("#mu-estado").textContent = (mu.estado === 2 ? "En pausa" : mu.estado === 3 || mu.estado === -1 ? "Cargando…" : "Sonando")
      + (GENERO[mu.genero] ? " · " + GENERO[mu.genero] : "") + donde
      + (mu.cola.length > 1 ? ` · ${mu.i + 1} de ${mu.cola.length}` : "");
    $("#mu-pausa").textContent = mu.estado === 2 ? "▶" : "❚❚";
    $("#mu-sonido").hidden = !mu.sinSonido;
    $("#mu-app-yt").hidden = !(esAndroid() && mu.salida === APP);
  }

  function montar() {
    if (!document.getElementById("ag-musica")) return;
    $("#card-musica").hidden = false;
    const elegir = document.querySelectorAll("input[name=musica-donde]");
    elegir.forEach((r) => { r.checked = r.value === dondeGuardado(); });
    elegir.forEach((r) => r.addEventListener("change", () => {
      if (!r.checked) return;
      guardarDonde(r.value);
      toast("Listo: la música sonará " + {ventana: esAndroid() ? "aquí (en el celular, la ventana de música es esta)." : "en la ventana de música.", app: "aquí en la app.", pc: "en el PC."}[r.value]);
    }));
    $("#ag-musica").addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || !mu.salida) return;
      if (b.id === "mu-pausa") await ejecutar("controlar_musica", {accion: mu.estado === 2 ? "seguir" : "pausar"});
      if (b.id === "mu-siguiente") siguiente(false);
      if (b.id === "mu-parar") parar();
      if (b.id === "mu-sonido" && mu.jugador) { mu.jugador.unMute(); mu.sinSonido = false; aplicarVolumen(); mu.jugador.playVideo(); pintar(); }
      if (b.id === "mu-app-yt" && actual()) { const v = actual(); APP.pausar(); location.href = urlIntent(v.id); }   // dentro del toque
    });
  }

  A.modulo({
    nombre: "musica", montar, pintar, ejecutar,
    herramientas: () => HERRAMIENTAS,
    capacidad: () => "- Poner música o videos de YouTube y manejarlos por voz: parar, pausar, seguir, cambiar de canción, volver a la anterior y el volumen (poner_musica, controlar_musica).",
    contexto: () => {
      const donde = {ventana: "en la ventana de música (otra ventana con YouTube)", app: "aquí en la app", pc: "en el PC"};
      let s = `## Música\nEl usuario la quiere ${donde[esAndroid() && dondeGuardado() === "ventana" ? "app" : dondeGuardado()]}.`;
      if (mu.cola.length && actual()) {
        s += ` Ahora ${mu.estado === 2 ? "está en pausa" : "suena"} «${tituloDicho(actual().titulo)}» ${donde[mu.salida.nombre]} (se pidió «${mu.consulta}»).`
          + " «Para», «pausa», «cambia de canción», «más alto» se refieren a esto: usa controlar_musica (o poner_musica si dice qué otra canción).";
      }
      return s;
    },
    // en cuanto se oye "Píxel" mientras suena aqui o en la ventana, la musica baja para oir la orden
    alOirParcial: (t) => {
      if (mu.cola.length && mu.salida !== PC && /p[ií]xel|bixel/i.test(t) && !mu.bajo) {
        mu.bajo = true; aplicarVolumen();
        setTimeout(() => { mu.bajo = false; aplicarVolumen(); }, 6000);
      }
    },
    alUsuario: (u) => { if (!u && mu.cola.length) parar(); },
    // "Modo música": en Inicio se nota que esta sonando (o en pausa) y como salir
    hero: () => {
      if (!mu.cola.length || !mu.salida || !actual()) return null;
      const t = tituloDicho(actual().titulo);
      if (mu.estado === 2) return {modo: "pausa", pill: "Música en pausa", titulo: "Música en pausa", sub: `«${t}». Di «Píxel, sigue» o «Píxel, para la música».`};
      return {modo: "musica", pill: "♪ Modo música", titulo: "♪ Modo música",
        sub: `Sonando «${t}». Di «Píxel, cambia de canción» o «Píxel, para la música» para salir.`};
    },
    // con musica sonando, "para", "pausa", "cambia de canción", "más alto"... sin pasar por Gemini
    atajo: (texto) => {
      if (!mu.cola.length || !mu.salida) return undefined;
      const a = atajoDe(texto);
      return a ? ejecutar("controlar_musica", a) : undefined;
    },
  });

  window.PixelMusica = {modo: () => (mu.cola.length && mu.salida ? (mu.estado === 2 ? "pausa" : "musica") : ""), texto: {tituloDicho, resultadosApi, desentidades, urlIntent, urlVideo, normalizarDonde, atajoDe}, buscar, guardarDonde,
    estado: () => ({cola: mu.cola.slice(), i: mu.i, estado: mu.estado, volumen: mu.volumen, sinSonido: mu.sinSonido,
      donde: mu.salida ? mu.salida.nombre : "", ventana: mu.ventana && !mu.ventana.closed && mu.ventana.Pixel ? mu.ventana.Pixel.estado() : null,
      jugador: mu.jugador && mu.jugador.getPlayerState ? {estado: mu.jugador.getPlayerState(), volumen: mu.jugador.getVolume(), video: (mu.jugador.getVideoData() || {}).video_id} : null}),
    usarBuscador: (f) => { buscar = f; }};                 // para las pruebas: cambiar el buscador
})();
