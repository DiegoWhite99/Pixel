// Fase 13 - Prueba de punta a punta de Pixel en la app, en Chrome sin pantalla:
//   - Gemini de verdad (Firebase AI Logic) y la Realtime Database de verdad, con una cuenta anonima
//     que se borra al final (con todos sus datos);
//   - reconocimiento de voz falso que dicta frases como Chrome en Android (se corta tras cada final);
//   - Google Calendar y Gmail simulados: se interceptan las peticiones a googleapis.com.
// Uso (con web/ servido en localhost:8099, por ejemplo: python3 -m http.server 8099 -d web):
//   PUPPETEER=/ruta/a/node_modules/puppeteer-core node tools/prueba_app.js [cerebro|enfoque|google|aparatos ...]
"use strict";
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const DIRECCION = "http://localhost:8099/?nube=anonimo";
const PARTES = process.argv.slice(2).length ? process.argv.slice(2) : ["cerebro", "enfoque", "google", "aparatos", "musica", "humor", "notas"];
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let peticiones = 0, fallos = 0;
const google = {llamadas: [], borradores: {}, enviados: []};

async function hasta(page, fn, ms, que, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return Date.now() - t0; await espera(120); }
  throw new Error("no llegó: " + que);
}
function comprobar(ok, que, detalle) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "BIEN" : "MAL "} ${que}${!ok && detalle ? " -> " + detalle : ""}`);
}

// YouTube a veces le pide a Chrome sin pantalla "Accede para confirmar que no eres un bot" (pasa tras
// muchas pruebas seguidas) y entonces ningun video suena. No es un fallo de Pixel y no se esquiva: se
// detecta, se avisa y lo que depende de que suene de verdad queda "omitido"; la logica se sigue probando
// (que video carga, en que ventana, el modo musica, el volumen, cerrar).
let ytBloqueado = false, omitidos = 0;
let textoYoutube = "";
async function youtubePideBot(nav) {
  textoYoutube = "";
  for (const p of await nav.pages()) {
    for (const f of p.frames()) {
      if (!/youtube\.com\/embed/.test(f.url())) continue;
      const t = await Promise.race([f.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => ""), espera(3000).then(() => "")]);
      textoYoutube += " [" + p.url().slice(-40) + "] " + t.slice(0, 80).replace(/\n/g, " ");
      if (/no eres un bot|not a bot/i.test(t)) return true;
    }
  }
  return false;
}
async function hastaQueSuene(page, nav, fn, ms, que, k) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    // sin busqueda: el cupo diario de la YouTube Data API (unas 100) se acabo y no hay PC de puente
    if (await page.evaluate((j) => /No puedo buscar el video exacto/.test(window.__dichas.slice(j || 0).join(" ")), k)) {
      console.log("  AVISO no hay búsqueda de YouTube (cupo diario de la YouTube Data API agotado y sin PC): lo que necesita sonido queda omitido");
      ytBloqueado = true;
      return false;
    }
    // Pixel ya se rindio: todos los resultados dieron error (con el bloqueo, YouTube da 150 a todos)
    const rendido = await page.evaluate((j) => /no me dejó poner/.test(window.__dichas.slice(j || 0).join(" ")), k);
    if (rendido || (Date.now() - t0 > 6000 && await youtubePideBot(nav))) {
      console.log(rendido ? "  AVISO YouTube no dejó poner ninguno de los resultados aquí (Píxel se rindió y lo dijo)"
        : "  AVISO YouTube pide «confirmar que no eres un bot» a este Chrome sin pantalla: lo que necesita sonido de verdad queda omitido");
      ytBloqueado = true;
      return false;
    }
    await espera(300);
  }
  throw new Error("no llegó: " + que + " | YouTube:" + (textoYoutube || " (sin recuadro de YouTube)") + " | " + JSON.stringify(await page.evaluate(() => window.PixelMusica.estado())));
}
function siSuena(ok, que, detalle) {
  if (ytBloqueado) { omitidos++; console.log(`  OMIT ${que} (YouTube no deja sonar aquí)`); return; }
  comprobar(ok, que, detalle);
}

// ------------------------------------------------------------------ Google falso
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const AHORA = new Date();
const hoyA = (h, m) => { const d = new Date(AHORA); d.setHours(h, m, 0, 0); return d.toISOString(); };
const EVENTOS = [
  {id: "e1", summary: "Clase de cálculo", start: {dateTime: hoyA(10, 0)}, end: {dateTime: hoyA(12, 0)}, location: "Salón 204"},
  {id: "e2", summary: "Reunión con Ana del proyecto de feria", start: {dateTime: hoyA(17, 0)}, end: {dateTime: hoyA(18, 0)}},
];
const CORREOS = {
  m1: {id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD"], internalDate: String(Date.now() - 3600e3), snippet: "Hola Diego, ¿vienes mañana a la reunión del proyecto a las 3?",
    payload: {headers: [{name: "From", value: "Ana Pérez <ana.perez@ejemplo.com>"}, {name: "Subject", value: "Reunión del proyecto"},
      {name: "Message-ID", value: "<m1@ejemplo.com>"}, {name: "Date", value: new Date().toUTCString()}],
    mimeType: "text/plain", body: {data: b64("Hola Diego,\n\n¿Vienes mañana a la reunión del proyecto a las 3 de la tarde? Trae el informe de avances.\n\nAna")}}},
  m2: {id: "m2", threadId: "t2", labelIds: ["INBOX", "UNREAD"], internalDate: String(Date.now() - 7200e3), snippet: "Tu pedido 4512 ya va en camino.",
    payload: {headers: [{name: "From", value: "Tienda <pedidos@tienda.com>"}, {name: "Subject", value: "Tu pedido va en camino"},
      {name: "Message-ID", value: "<m2@tienda.com>"}], mimeType: "text/html", body: {data: b64("<p>Tu pedido <b>4512</b> ya va en camino.</p>")}}},
};

async function responderGoogle(req) {
  const u = new URL(req.url()), m = req.method(), cuerpo = req.postData() ? JSON.parse(req.postData()) : null;
  google.llamadas.push(`${m} ${u.pathname}${u.search ? "?" + decodeURIComponent(u.search.slice(1)).slice(0, 80) : ""}`);
  const json = (o, st) => req.respond({status: st || 200, contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"}, body: JSON.stringify(o)});
  if (m === "OPTIONS") return req.respond({status: 204, headers: {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE"}});
  if (!/Bearer token-falso/.test(req.headers().authorization || "")) return json({error: {message: "Invalid Credentials"}}, 401);
  const p = u.pathname;
  if (p.endsWith("/calendars/primary/events") && m === "GET") return json({items: EVENTOS});
  if (p.endsWith("/calendars/primary/events") && m === "POST") { google.evento = cuerpo; return json(Object.assign({id: "nuevo"}, cuerpo)); }
  if (/\/events\/\w+$/.test(p)) { google.cambioEvento = {m, cuerpo}; return m === "DELETE" ? req.respond({status: 204, headers: {"Access-Control-Allow-Origin": "*"}}) : json({}); }
  if (p.endsWith("/messages") && m === "GET") {         // la busqueda: por palabras del remitente o del asunto
    const q = (u.searchParams.get("q") || "").toLowerCase().replace(/\b(in|is|label|category|newer_than|older_than):\S+/g, "").replace(/\b(from|to|subject):/g, "").replace(/[()"]/g, " ");
    const palabras = q.split(/\s+or\s+|\s+/).filter((w) => w.length > 2);
    const ids = Object.values(CORREOS).filter((c) => !palabras.length || palabras.some((w) => JSON.stringify(c.payload.headers).toLowerCase().includes(w))).map((c) => ({id: c.id}));
    return json({messages: ids, resultSizeEstimate: ids.length});
  }
  const mm = /\/messages\/(m\d)$/.exec(p);
  if (mm && m === "GET") { const c = JSON.parse(JSON.stringify(CORREOS[mm[1]])); if (u.searchParams.get("format") === "metadata") delete c.payload.body; return json(c); }
  if (/\/messages\/m\d\/modify$/.test(p)) return json({});
  if (p.endsWith("/messages/batchModify")) { google.batch = cuerpo; return req.respond({status: 204, headers: {"Access-Control-Allow-Origin": "*"}}); }
  if (p.endsWith("/drafts") && m === "POST") { google.borradores.d1 = cuerpo; return json({id: "d1"}); }
  if (/\/drafts\/d1$/.test(p) && m === "PUT") { google.borradores.d1 = cuerpo; google.corregido = true; return json({id: "d1"}); }
  if (p.endsWith("/drafts/send")) { google.enviados.push(cuerpo.id); return json({id: "s1"}); }
  if (p.endsWith("/labels")) return json({labels: [{id: "Label_1", name: "Feria"}]});
  return json({error: {message: "no simulado: " + p}}, 404);
}
const rawDe = (d) => Buffer.from(d.message.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const cuerpoDe = (raw) => Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");

// ------------------------------------------------------------------ prueba
(async () => {
  const nav = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run"]});
  const page = await nav.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({width: 390, height: 844, isMobile: true, hasTouch: true});
  const errores = [];
  page.on("pageerror", (e) => errores.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); if (/^(cerebro|tiempo|google|aparatos|agente|musica):/.test(m.text())) console.log("    [consola]", m.text().slice(0, 200)); });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (/firebasevertexai|generativelanguage/.test(r.url()) && r.method() === "POST") peticiones++;
    if (/^https:\/\/(www|gmail)\.googleapis\.com\/(calendar|gmail)\//.test(r.url())) return responderGoogle(r);
    r.continue();
  });
  await page.evaluateOnNewDocument(() => {
    window.__dichas = [];
    window.__rec = {inst: null};
    class RecFalso {
      constructor() { window.__rec.inst = this; this.vivo = false; }
      start() { if (this.vivo) throw new DOMException("ya", "InvalidStateError"); this.vivo = true; setTimeout(() => this.onstart && this.onstart(), 5); }
      abort() { if (!this.vivo) return; this.vivo = false; setTimeout(() => this.onend && this.onend(), 5); }
      stop() { this.abort(); }
      decir(texto) {
        if (!this.vivo) return false;
        const res = [{transcript: texto}]; res.isFinal = true;
        this.onresult({resultIndex: 0, results: [res]});
        this.vivo = false; setTimeout(() => this.onend && this.onend(), 40);   // Android: se corta tras cada final
        return true;
      }
    }
    window.webkitSpeechRecognition = RecFalso;
    window.SpeechRecognition = RecFalso;
    window.__tonos = [];
    speechSynthesis.speak = (u) => {           // sin voces en Chrome sin pantalla: se "dice" al momento
      if (u.text.trim()) { window.__dichas.push(u.text); window.__tonos.push(u.pitch); }
      setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 30); }, 10);
    };
  });

  const t0 = Date.now();
  await page.goto(DIRECCION, {waitUntil: "domcontentloaded"});
  await hasta(page, () => window.Agente && window.Agente.activo() && document.querySelector("#pill-ollama").textContent.includes("Gemini"), 40000, "agente listo");
  const uid = await page.evaluate(() => nube.uid);
  console.log(`listo en ${Date.now() - t0} ms, cuenta de prueba ${uid.slice(0, 6)}…`);
  await page.click("#ag-btn");

  const escuchando = () => page.evaluate(() => /Te escucho|Dime|Modo música|Música en pausa/.test(document.querySelector("#hero-estado").textContent) && window.__rec.inst && window.__rec.inst.vivo);
  // Dice algo (con o sin "Píxel") y espera a que Pixel conteste y vuelva a escuchar. Devuelve lo que dijo.
  async function hablar(texto, ms) {
    await espera(Number(process.env.PAUSA || 3000));   // como una persona; y el plan gratis de Gemini tiene limite por minuto
    await hasta(page, () => window.__rec.inst && window.__rec.inst.vivo, 8000, "micro abierto para: " + texto);
    const k = await page.evaluate(() => window.__dichas.length);
    await page.evaluate((t) => window.__rec.inst.decir(t), texto);
    await hasta(page, (j) => window.__dichas.length > j, ms || 45000, "respuesta a: " + texto, k);
    await espera(500);
    await hasta(page, () => /Te escucho|Dime|Modo música|Música en pausa/.test(document.querySelector("#hero-estado").textContent) && window.__rec.inst.vivo, 45000, "fin de: " + texto);
    const dicho = (await page.evaluate((j) => window.__dichas.slice(j), k)).join(" ");
    console.log(`\n» ${texto}\n  Píxel: ${dicho}`);
    return dicho;
  }
  const leer = (ruta) => page.evaluate((r) => nube.d.get(nube.d.ref(nube.db, `usuarios/${nube.uid}/${r}`)).then((s) => s.val()), ruta);
  const escribir = (ruta, v) => page.evaluate((r, x) => nube.d.set(nube.d.ref(nube.db, `usuarios/${nube.uid}/${r}`), x), ruta, v);

  try {
    // -------------------------------------------------------------- cerebro
    if (PARTES.includes("cerebro")) {
      console.log("\n=== CEREBRO");
      await hablar("Píxel, recuerda que me llamo Diego y que estudio ingeniería de sistemas");
      await espera(1500);
      const notas = Object.values((await leer("cerebro")) || {});
      comprobar(notas.some((n) => /Diego/.test(n.texto)), "guardó el nombre en el cerebro", JSON.stringify(notas));
      let r = await hablar("Píxel, ¿cómo me llamo y qué estudio?");
      comprobar(/Diego/.test(r) && /sistemas/i.test(r), "lo recuerda");
      r = await hablar("Píxel, ¿cómo funciona la técnica pomodoro?");
      comprobar(/25/.test(r) || /veinticinco/i.test(r), "RAG: sabe la técnica Pomodoro de saber.md");
      await escribir("cerebro/regla1", {titulo: "Despedida", texto: "Termina siempre cada respuesta con la frase: cambio y fuera.", tipo: "regla", fijo: true, actualizado: Date.now(), origen: "app"});
      await espera(800);
      r = await hablar("Píxel, ¿cuál es la capital de Japón?");
      comprobar(/cambio y fuera/i.test(r), "cumple una regla del usuario");
      await page.evaluate(() => nube.d.remove(nube.d.ref(nube.db, `usuarios/${nube.uid}/cerebro/regla1`)));
      r = await hablar("Píxel, olvida lo que estudio");
      await espera(1000);
      const despues = Object.values((await leer("cerebro")) || {});
      comprobar(!despues.some((n) => /sistemas/.test(n.texto)) || despues.length < notas.length, "olvidar borra la nota", JSON.stringify(despues));
      await page.evaluate(() => { location.hash = "#agente"; });
      await espera(500);
      const tarjeta = await page.$eval("#cb-lista", (e) => e.textContent.replace(/\s+/g, " ").trim());
      comprobar(/Diego/.test(tarjeta), "la nota sale en Personalidad", tarjeta.slice(0, 120));
      await page.evaluate(() => { location.hash = "#inicio"; });
    }

    // -------------------------------------------------------------- enfoque
    if (PARTES.includes("enfoque")) {
      console.log("\n=== ENFOQUE");
      await hablar("Píxel, agrega una tarea urgente e importante: entregar el informe de física");
      await hablar("Píxel, agrega la tarea de organizar el escritorio, no es urgente ni importante");
      await espera(800);
      const ts = Object.values((await leer("tareas")) || {});
      comprobar(ts.length === 2 && ts.some((t) => /informe/.test(t.texto) && t.urgente && t.importante), "dos tareas con sus cuadrantes", JSON.stringify(ts));
      let r = await hablar("Píxel, ¿qué hago primero?");
      comprobar(/informe/i.test(r), "qué hago primero = el informe");
      r = await hablar("sí, empieza un pomodoro con esa");
      await espera(800);
      let p = await leer("pomodoro");
      comprobar(p && p.fase === "trabajo" && /informe/.test(p.tarea || ""), "pomodoro en marcha con la tarea", JSON.stringify(p));
      r = await hablar("Píxel, ¿cuánto me queda del pomodoro?");
      comprobar(/minutos|minuto/.test(r), "dice cuánto queda");
      // que acabe ya: la fase termina en 1 s y Pixel lo anuncia solo
      const k = await page.evaluate(() => window.__dichas.length);
      await page.evaluate(() => nube.d.update(nube.d.ref(nube.db, `usuarios/${nube.uid}/pomodoro`), {fin: Date.now() + 1000}));
      await hasta(page, (j) => window.__dichas.slice(j).some((d) => /Tiempo/.test(d)), 15000, "aviso de fin de pomodoro", k);
      console.log("  aviso:", (await page.evaluate((j) => window.__dichas.slice(j), k)).join(" "));
      await espera(1200);
      p = await leer("pomodoro");
      comprobar(p && p.fase === "descanso", "pasó al descanso", JSON.stringify(p));
      const informe = Object.values((await leer("tareas")) || {}).find((t) => /informe/.test(t.texto));
      comprobar(informe && informe.pomodoros === 1, "contó el pomodoro en la tarea", JSON.stringify(informe));
      await page.evaluate(() => { location.hash = "#enfoque"; });
      await espera(600);
      const hacer = await page.$eval("#mx-hacer", (e) => e.textContent);
      const relojV = await page.$eval("#pm-reloj", (e) => e.textContent);
      comprobar(/informe/.test(hacer) && /^\d+:\d\d$/.test(relojV), "página Enfoque: matriz y reloj", hacer + " " + relojV);
      await page.screenshot({path: (process.env.CAPTURAS || "/tmp") + "/enfoque.png", fullPage: true});
      await page.evaluate(() => { location.hash = "#inicio"; });
      await hablar("Píxel, para el pomodoro");
      await hablar("Píxel, marca como hecha la tarea del informe");
      await espera(800);
      comprobar(Object.values((await leer("tareas")) || {}).some((t) => /informe/.test(t.texto) && t.hecha), "tarea completada");
    }

    // -------------------------------------------------------------- google (simulado)
    if (PARTES.includes("google")) {
      console.log("\n=== GOOGLE (simulado)");
      let r = await hablar("Píxel, ¿qué tengo hoy en el calendario?");
      comprobar(/permiso|Conectar Google|entrar con tu cuenta/i.test(r), "sin token pide permiso");
      comprobar(await page.$eval("#ag-google", (e) => !e.hidden), "sale el botón Conectar Google");
      await page.evaluate((u) => {
        localStorage.setItem("pixel.google", JSON.stringify({uid: u, token: "token-falso", vence: Date.now() + 3600e3,
          alcances: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify", email: "prueba@ejemplo.com"}));
        window.Agente.usuario(nube.usuario);   // vuelve a leer el token guardado
      }, uid);
      await espera(1500);
      await page.click("#ag-btn");
      r = await hablar("Píxel, ¿qué tengo hoy en el calendario?");
      comprobar(/cálculo/i.test(r) && /Ana/.test(r), "lee los eventos de hoy");
      r = await hablar("Píxel, agenda estudiar cálculo mañana a las 4 de la tarde");
      const ev = google.evento;
      comprobar(ev && /T16:00:00$/.test(ev.start.dateTime) && /cálculo/i.test(ev.summary), "crea el evento a las 16:00", JSON.stringify(ev));
      r = await hablar("Píxel, ¿tengo correos nuevos?");
      comprobar(/Ana/.test(r) && /pedido/i.test(r), "resume los correos sin leer");
      r = await hablar("Píxel, léeme el de Ana");
      comprobar(/informe/i.test(r), "lee el correo de Ana");
      r = await hablar("Píxel, respóndele que sí voy y que llevo el informe");
      const d1 = google.borradores.d1;
      comprobar(d1 && d1.message.threadId === "t1" && /In-Reply-To: <m1@ejemplo.com>/.test(rawDe(d1)) && /ana.perez@ejemplo.com/.test(rawDe(d1)), "borrador de respuesta en el hilo", d1 && rawDe(d1).slice(0, 300));
      comprobar(/¿Lo envío/.test(r) && google.enviados.length === 0, "lo lee y pregunta antes de enviar");
      comprobar(await page.$eval("#ag-confirmar", (e) => !e.hidden && /Enviar/.test(e.textContent)), "tarjeta con Enviar");
      r = await hablar("cámbialo para que sea más formal");
      comprobar(google.corregido && google.enviados.length === 0, "corrige el borrador sin enviar", d1 && cuerpoDe(rawDe(google.borradores.d1)));
      console.log("  borrador corregido:", JSON.stringify(cuerpoDe(rawDe(google.borradores.d1))));
      r = await hablar("envíalo");
      comprobar(google.enviados.includes("d1") && /Enviado/.test(r), "envía solo tras «envíalo»");
      r = await hablar("Píxel, archiva el correo de la tienda");
      comprobar(google.batch && google.batch.ids.join() === "m2" && google.batch.removeLabelIds.includes("INBOX"), "archiva solo el de la tienda", JSON.stringify(google.batch));
      console.log("  llamadas a Google:", google.llamadas.length);
    }
    // -------------------------------------------------------------- musica (reproductor de YouTube de verdad)
    if (PARTES.includes("musica")) {
      console.log("\n=== MÚSICA en otra ventana (la de Píxel, con YouTube) y manejada por voz");
      await hasta(page, () => !!window.PixelMusica, 10000, "módulo de música");
      await page.evaluate(() => window.PixelMusica.guardarDonde("ventana"));
      const pestanas = [];
      nav.on("targetcreated", (t) => pestanas.push(t));
      const ve = () => page.evaluate(() => window.PixelMusica.estado());
      const abiertas = async () => (await nav.pages()).filter((x) => /reproductor\.html/.test(x.url())).length;
      // si YouTube no deja sonar a este Chrome: Pixel lo dice, deja el boton y la ventana queda con su aviso
      const siYoutubeNoDeja = async (donde, k) => {
        if (await page.evaluate((j) => /No puedo buscar el video exacto/.test(window.__dichas.slice(j).join(" ")), k)) {
          comprobar(!(await page.$eval("#ag-video", (x) => x.hidden)), `${donde}: sin búsqueda, deja la tarjeta para abrirlo en YouTube`);
          await page.evaluate(() => { document.querySelector("#ag-video").hidden = true; });
          omitidos++;
          console.log(`  OMIT ${donde}: lo demás necesita buscar en YouTube`);
          return;
        }
        await hasta(page, (j) => /no me dejó poner/.test(window.__dichas.slice(j).join(" ")), 40000, "que avise que YouTube no deja", k).catch(() => {});
        await espera(800);
        const dicho = await page.evaluate((j) => window.__dichas.slice(j).join(" "), k);
        comprobar(/no me dejó poner/.test(dicho), `${donde}: si YouTube no deja sonar, Píxel lo dice`, dicho.slice(-200));
        comprobar(!(await page.$eval("#ag-video", (x) => x.hidden)), `${donde}: y deja el botón «Abrir en YouTube»`);
        comprobar(!(await page.evaluate(() => document.querySelector(".hero").classList.contains("modo-musica"))), `${donde}: sin música no se queda en «Modo música»`);
        if (donde === "ventana") {
          const pop = (await nav.pages()).find((x) => /reproductor\.html/.test(x.url()));
          const av = pop && await pop.evaluate(() => ({aviso: !document.querySelector("#toque").hidden && document.querySelector("#toque").classList.contains("aviso"), yt: document.querySelector("#toque-yt").href}));
          comprobar(av && av.aviso && /watch\?v=/.test(av.yt), "ventana: queda abierta con su aviso y el enlace al video", JSON.stringify(av));
        }
        await page.evaluate(() => { document.querySelector("#ag-video").hidden = true; });
        omitidos++;
        console.log(`  OMIT ${donde}: lo demás (pausa, sigue, cambiar, volumen) necesita que YouTube deje sonar`);
      };
      const k0 = await page.evaluate(() => window.__dichas.length);
      let r = await hablar("Píxel, pon Acróstico de Shakira");
      await hastaQueSuene(page, nav, () => { const e = window.PixelMusica.estado(); return e.ventana && e.ventana.estado === 1; }, 25000, "que suene en la ventana", k0);
      let e;
      if (ytBloqueado) await siYoutubeNoDeja("ventana", k0);
      else {
      e = await ve();
      console.log("  ventana:", pestanas.map((t) => t.url()).filter((u) => /reproductor/.test(u)).join(" "), "|", JSON.stringify(e.ventana));
      comprobar(/ventana de música/.test(r) && e.ventana.video === e.cola[0].id && !e.ventana.silencio, "abre otra ventana con el video pedido (con volumen)", r);
      comprobar(!(await page.$eval("#ag-musica", (x) => x.hidden)) && await page.$eval("#ag-musica", (x) => x.classList.contains("remota")), "en la app queda la barra de mando");
      await espera(800);
      const heroMusica = await page.evaluate(() => [document.querySelector("#hero-estado").textContent, document.querySelector("#pill-esp").textContent, document.querySelector(".hero").classList.contains("modo-musica")]);
      comprobar(/Modo música/.test(heroMusica[0]) && /Modo música/.test(heroMusica[1]) && heroMusica[2], "se nota el «Modo música» (título, píldora y colores)", JSON.stringify(heroMusica));
      comprobar((await page.evaluate(() => window.__tonos.slice(-1)[0])) === 1.55, "la voz es la infantil (tono 1,55)");
      await espera(1500);
      let baile = await page.evaluate(() => { const d = cara.depurar(); return {animo: d.animo, baile: d.baile}; });
      console.log("  baile:", JSON.stringify(baile));
      siSuena(baile.baile && baile.baile.bpm >= 60 && baile.baile.estilo && !/hablando|pensando|escuchando/.test(baile.animo), "Píxel baila al ritmo y al estilo del género", JSON.stringify(baile));
      await espera(2500);
      siSuena((await page.evaluate(() => cara.depurar().figuras)) > 0 && await page.$eval(".fondo-musica", (x) => x.classList.contains("con-musica")), "salen figuras musicales por el fondo");
      const escena = await page.evaluate(() => ({escena: cara.depurar().escena, estilo: (cara.depurar().baile || {}).estilo, svg: !!document.querySelector(".fondo-musica .escenario svg")}));
      siSuena(escena.escena && escena.svg, "detrás hay un escenario según el género", JSON.stringify(escena));
      console.log("  escenario:", JSON.stringify(escena));
      r = await hablar("Píxel, para la canción");
      await espera(1200);
      e = await ve();
      comprobar(e.ventana === null || e.ventana.estado === 2 || /par/.test(r), "«para la canción» la para", r + " " + JSON.stringify(e.ventana));
      if (!e.ventana) {                                   // «para» la cerro: se vuelve a poner para seguir probando
        r = await hablar("Píxel, pon Acróstico de Shakira");
        await hastaQueSuene(page, nav, () => { const x = window.PixelMusica.estado(); return x.ventana && x.ventana.estado === 1; }, 25000, "que vuelva a sonar");
      }
      r = await hablar("Píxel, pausa");
      await espera(1200);
      siSuena((await ve()).ventana.estado === 2, "«pausa» la pausa", r);
      comprobar(!(await page.evaluate(() => cara.depurar().baile)) && !(await page.$eval(".fondo-musica", (x) => x.classList.contains("con-musica"))), "en pausa deja de bailar y el fondo se calma");
      siSuena(/Música en pausa/.test(await page.$eval("#hero-estado", (x) => x.textContent)), "en pausa dice «Música en pausa»");
      r = await hablar("Píxel, sigue");
      await espera(2500);
      siSuena((await ve()).ventana.estado === 1, "«sigue» la sigue", r);
      r = await hablar("Píxel, cambia de canción");
      await espera(4000);
      e = await ve();
      comprobar(e.i === 1 && e.ventana.video === e.cola[1].id && await abiertas() === 1, "«cambia de canción» la cambia en la misma ventana", r);
      r = await hablar("Píxel, pon Bohemian Rhapsody de Queen");
      await espera(4000);
      e = await ve();
      comprobar(/Queen/i.test(e.cola[0].titulo) && e.ventana.video === e.cola[0].id && await abiertas() === 1, "otra canción pedida por nombre, en la misma ventana", r);
      r = await hablar("Píxel, súbele el volumen");
      await espera(800);
      comprobar(/Volumen al 100/.test(r) && (await ve()).ventana.volumen === 100, "«súbele» sube el volumen", r);
      r = await hablar("Píxel, quita la música");
      await espera(1500);
      comprobar((await ve()).ventana === null && await page.$eval("#ag-musica", (x) => x.hidden), "«quita la música» cierra la ventana", r);
      await espera(800);
      comprobar(!/música/i.test(await page.$eval("#hero-estado", (x) => x.textContent)) && !(await page.evaluate(() => document.querySelector(".hero").classList.contains("modo-musica"))), "sin música vuelve al modo normal");
      // en Android: suena aqui (una web no maneja la app de YouTube) con el boton para abrirla en la app
      await page.evaluate(() => Object.defineProperty(navigator, "userAgent", {get: () => "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/131 Mobile"}));
      r = await hablar("Píxel, pon Acróstico de Shakira");
      await espera(3000);
      e = await ve();
      comprobar(e.donde === "app" && !(await page.$eval("#mu-app-yt", (x) => x.hidden)), "Android: suena aquí y ofrece la app de YouTube", r);
      await hablar("Píxel, quita la música");
      await page.evaluate(() => { delete navigator.userAgent; });
      }

      console.log("\n=== MÚSICA aquí en la app (búsqueda real con la YouTube Data API)");
      await page.evaluate(() => window.PixelMusica.guardarDonde("app"));
      for (const t of pestanas) { const p2 = await t.page().catch(() => null); if (p2 && p2 !== page) await p2.close().catch(() => {}); }
      const est = () => page.evaluate(() => window.PixelMusica.estado());
      const k1 = await page.evaluate(() => window.__dichas.length);
      r = await hablar("Píxel, pon Bohemian Rhapsody de Queen");
      comprobar(/Pongo|No puedo buscar el video exacto/.test(r), "dice «Pongo…» (o, sin búsqueda, que no puede)", r);
      await hastaQueSuene(page, nav, () => { const e = window.PixelMusica.estado(); return e.jugador && e.jugador.estado === 1; }, 25000, "que suene el video", k1);
      if (ytBloqueado) await siYoutubeNoDeja("app", k1);
      else {
      comprobar(!(await page.$eval("#ag-musica", (e) => e.hidden)) && await page.$eval("#ag-video", (e) => e.hidden), "sale el reproductor, sin la tarjeta «Abrir en YouTube»");
      e = await est();
      console.log("  reproductor:", JSON.stringify(e.jugador), "| sin sonido:", e.sinSonido);
      comprobar(e.cola.length > 1 && e.jugador.video === e.cola[e.i].id, "busca de verdad y carga el video", JSON.stringify(e));
      siSuena(e.jugador.estado === 1 && !e.sinSonido, "suena solo, sin tocar nada", JSON.stringify(e.jugador));
      console.log("  encontró:", e.cola.map((v) => v.titulo).join(" | "));
      // tras oir "Píxel" la musica baja 6 s; luego vuelve a su volumen
      const vuelve = await hasta(page, () => window.PixelMusica.estado().jugador.volumen >= 70, 9000, "que vuelva el volumen").then(() => true, () => false);
      comprobar(vuelve, "volumen normal mientras Píxel escucha", (await est()).jugador.volumen);
      await page.screenshot({path: (process.env.CAPTURAS || "/tmp") + "/musica.png"});
      // al hablarle, la musica baja
      await hasta(page, () => window.__rec.inst && window.__rec.inst.vivo, 8000, "micro");
      const k = await page.evaluate(() => window.__dichas.length);
      await page.evaluate(() => window.__rec.inst.decir("Píxel, pausa la música"));
      await hasta(page, () => /pensando|hablando/.test(document.querySelector("#hero-estado").textContent) || window.PixelMusica.estado().jugador.volumen <= 12, 8000, "que baje");
      const bajo = (await est()).jugador.volumen;
      await hasta(page, (j) => window.__dichas.length > j && /Te escucho|Dime|Modo música|Música en pausa/.test(document.querySelector("#hero-estado").textContent), 40000, "respuesta a pausa", k);
      await espera(800);
      e = await est();
      console.log("  » Píxel, pausa la música\n  Píxel:", (await page.evaluate((j) => window.__dichas.slice(j), k)).join(" "));
      comprobar(bajo <= 12, "la música bajó mientras le hablaba", bajo);
      siSuena(e.jugador.estado === 2, "pausada", JSON.stringify(e.jugador));
      r = await hablar("Píxel, sigue con la música");
      await espera(2500);
      siSuena((await est()).jugador.estado === 1 && /Sigo/.test(r), "sigue sonando");
      r = await hablar("Píxel, pon la siguiente");
      await espera(4000);
      e = await est();
      comprobar(e.i >= 1 && e.jugador.video === e.cola[e.i].id, "pasa a la siguiente", JSON.stringify(e.jugador));
      r = await hablar("Píxel, quita la música");
      comprobar(await page.$eval("#ag-musica", (x) => x.hidden), "la quita");
      }
    }

    // -------------------------------------------------------------- humor (tocarle la cara)
    if (PARTES.includes("humor")) {
      console.log("\n=== HUMOR (tocarle la cara)");
      await hasta(page, () => !!window.PixelHumor, 10000, "módulo de humor");
      const caja = await page.$eval("#cara", (e) => { const r = e.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height * 0.45}; });
      const dichasDesde = (j) => page.evaluate((k) => window.__dichas.slice(k), j);
      const animo = () => page.evaluate(() => cara.depurar().animo);
      // zarandearlo 3 veces seguidas: se marea
      let k = await page.evaluate(() => window.__dichas.length);
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(caja.x, caja.y); await page.mouse.down();
        await page.mouse.move(caja.x + 90, caja.y - 60, {steps: 6}); await page.mouse.move(caja.x - 90, caja.y + 40, {steps: 6});
        await page.mouse.up(); await espera(450);
      }
      const gesto = await animo();
      await espera(1200);
      let d = (await dichasDesde(k)).join(" | ");
      console.log("  zarandeado:", gesto, "→", d);
      comprobar(gesto === "mareado" && /vueltas|gravedad|estrellitas/.test(d), "se marea y lo dice");
      // esperar a que se le pase y tocarlo muchas veces
      await espera(3000);
      await page.evaluate(() => window.PixelHumor.reiniciar());   // como si hubiera pasado un buen rato
      k = await page.evaluate(() => window.__dichas.length);
      const caras = [];
      for (let i = 0; i < 11; i++) { await page.mouse.click(caja.x, caja.y); await espera(700); caras.push(await animo()); }
      await espera(1500);
      d = (await dichasDesde(k));
      console.log("  toques:", caras.join(" "), "\n  dijo:", d.join(" | "));
      comprobar(/^¡Jejeje, qué divertido!$/.test(d[0] || ""), "al principio: «¡Jejeje, qué divertido!»");
      comprobar(d.some((x) => /toques así|Basta|mareo/.test(x)), "después se enoja y lo dice");
      comprobar(caras.slice(-3).every((c) => c === "enojado" || c === "dormido"), "cara de enojado al final");
      comprobar(!(await page.$$eval("#ultimo p.px", (ps) => ps.some((p) => /jeje|toques/i.test(p.textContent)))), "no ensucia «Lo último que oí»");
      // eventos al azar: se fuerza el siguiente y se mira que la cara haga algo distinto
      await page.evaluate(() => window.PixelHumor.reiniciar());
      await espera(1500);
      const vistos = new Set();
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.PixelHumor.ya());
        await espera(1300);
        vistos.add(await animo());
        await espera(2200);
      }
      console.log("  eventos al azar vistos:", [...vistos].join(", "));
      comprobar([...vistos].some((a) => /curioso|guino|feliz|bostezo|apretado|sorpresa|aburrido|amor/.test(a)), "hace cosas solo");
      // 5 min sin actividad: dice que se va a dormir y se duerme; un toque lo despierta
      k = await page.evaluate(() => window.__dichas.length);
      await page.evaluate(() => window.PixelHumor.envejecer(5 * 60000 + 1000));
      await hasta(page, (j) => window.__dichas.length > j, 6000, "aviso de dormir", k);
      await espera(2500);
      const sueno = (await dichasDesde(k)).join(" | "), cerrados = await animo();
      console.log("  5 min sin actividad:", sueno, "→", cerrados);
      comprobar(/dormir|siestita/.test(sueno) && cerrados === "dormido", "avisa que se va a dormir y se duerme");
      k = await page.evaluate(() => window.__dichas.length);
      await page.mouse.click(caja.x, caja.y);
      await espera(1500);
      const despierta = (await dichasDesde(k)).join(" | ");
      console.log("  un toque:", despierta);
      comprobar(/soñando|despierto/.test(despierta) && (await animo()) !== "dormido", "un toque lo despierta");
      // la charla: "gracias" pone ojos de corazon
      const r = await hablar("Píxel, muchas gracias, eres el mejor");
      const ojos = await animo();
      comprobar(ojos === "amor" || (await page.evaluate(() => cara.depurar().ojos[0].g.forma)) === 1, "«gracias» → ojos de corazón", ojos);
    }

    // -------------------------------------------------------------- notas dictadas
    if (PARTES.includes("notas")) {
      console.log("\n=== NOTAS («Píxel, toma nota», dictado y análisis)");
      await hasta(page, () => !!window.PixelApuntes, 10000, "módulo de notas");
      let r = await hablar("Píxel, toma nota de la clase de biología");
      comprobar(/^Tomando notas para el (lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d+ de \w+ a las? /.test(r) && await page.evaluate(() => window.PixelApuntes.dictando()), "«toma nota» → «Tomando notas para el día… a las…»", r);
      comprobar((await page.evaluate(() => cara.depurar().animo)) === "escribiendo", "la cara se pone a escribir");
      const dictar = async (t) => { await hasta(page, () => window.__rec.inst && window.__rec.inst.vivo, 8000, "micro"); await page.evaluate((x) => window.__rec.inst.decir(x), t); await espera(1800); };
      await dictar("la célula es la unidad básica de la vida");
      await dictar("tiene membrana citoplasma y núcleo y las plantas además pared celular");
      await espera(6500);
      await dictar("el examen es el viernes 14 de noviembre y hay que estudiar la mitosis");
      let e = await page.evaluate(() => window.PixelApuntes.estado());
      console.log("  texto:", JSON.stringify(e.activa && e.activa.texto));
      comprobar(e.activa && /^La célula es la unidad básica de la vida\. Tiene membrana[^]*\n\nEl examen es el viernes/.test(e.activa.texto), "lo dictado va a la nota, sin decir Píxel, con párrafo tras una pausa");
      r = await hablar("Píxel, termina la nota");
      comprobar(/guardé tu nota de \d+ palabras\. ¿Quieres que la analice\?/.test(r) && !(await page.evaluate(() => window.PixelApuntes.dictando())), "«termina la nota» la guarda y ofrece analizarla", r);
      r = await hablar("sí", 60000);
      const nota = Object.values((await leer("apuntes")) || {})[0];
      const an = nota && nota.analisis ? JSON.parse(nota.analisis) : null;
      console.log("  análisis:", an && JSON.stringify(an).slice(0, 300));
      comprobar(/^Listo\./.test(r) && an && an.resumen && an.ideas_generales.length && an.destacado.length, "«sí» → resumen, ideas y lo destacado", r);
      comprobar(an && an.pendientes.some((x) => /mitosis|examen|estudiar/i.test(x)), "saca el pendiente (estudiar para el examen)", an && JSON.stringify(an.pendientes));
      const clasif = Object.values((await leer("apuntes")) || {})[0];
      console.log("  asunto:", clasif.asunto, "| importante:", clasif.importante);
      comprobar(clasif.asunto && clasif.importante, "al guardarla le pone asunto y lo más importante", JSON.stringify({asunto: clasif.asunto, importante: clasif.importante}));
      // varias notas de otros dias y asuntos; una de hace 31 dias se borra sola al abrir
      const D = 86400000, ahoraMs = Date.now();
      await escribir("apuntes/vieja", {titulo: "Nota vieja", contexto: "", creado: ahoraMs - 31 * D, actualizado: ahoraMs - 31 * D, texto: "Algo viejo.", asunto: "Viejo", importante: "Algo viejo"});
      await escribir("apuntes/ayer", {titulo: "Reunión de la feria", contexto: "", creado: ahoraMs - D, actualizado: ahoraMs - D, texto: "Presupuesto de 200 mil pesos para el stand.", asunto: "Feria", importante: "Presupuesto de 200 mil para el stand"});
      await escribir("apuntes/semana", {titulo: "Mitosis", contexto: "", creado: ahoraMs - 4 * D, actualizado: ahoraMs - 4 * D, texto: "Profase, metafase, anafase y telofase.", asunto: clasif.asunto, importante: "Cuatro fases"});
      await page.evaluate(() => window.Agente.usuario(nube.usuario));      // como abrir la app otra vez
      await espera(2500);
      comprobar(!(await leer("apuntes/vieja")), "la nota de hace 31 días se borró sola");
      await page.evaluate(() => { location.hash = "#notas"; });
      await espera(800);
      const filas = () => page.$$eval("#nt-lista .nota-fila", (fs) => fs.map((x) => x.querySelector("b").textContent));
      let fs = await filas();
      console.log("  filas:", fs.join(" | "), "| grupos:", (await page.$$eval("#nt-lista .nt-dia", (x) => x.map((y) => y.textContent))).join(", "));
      comprobar(fs.length === 3 && !(await page.$("#nt-lista .nota-hoja")), "lista compacta: una fila por nota, sin hojas abiertas");
      await page.evaluate((a) => document.querySelector(`[data-nota-asunto="${a}"]`).click(), clasif.asunto);
      await espera(300);
      fs = await filas();
      comprobar(fs.length === 2 && fs.every((t) => t !== "Reunión de la feria"), "filtro por asunto", fs.join(" | "));
      await page.evaluate(() => { document.querySelector('[data-nota-asunto=""]').click(); document.querySelector('[data-nota-fecha="ayer"]').click(); });
      await espera(300);
      fs = await filas();
      comprobar(fs.length === 1 && fs[0] === "Reunión de la feria", "filtro por fecha (ayer)", fs.join(" | "));
      await page.evaluate(() => document.querySelector('[data-nota-fecha="todas"]').click());
      await page.type("#nt-buscar", "telofase");
      await espera(300);
      fs = await filas();
      comprobar(fs.length === 1 && fs[0] === "Mitosis", "buscar por palabras", fs.join(" | "));
      await page.evaluate(() => { const b = document.querySelector("#nt-buscar"); b.value = ""; b.dispatchEvent(new Event("input")); });
      await espera(300);
      await page.evaluate(() => document.querySelector("#nt-lista .nota-fila").click());
      await espera(300);
      const hoja = await page.$eval("#nt-lista .nota-hoja", (x) => x.textContent.replace(/\s+/g, " "));
      comprobar(/Clase de biología/.test(hoja) && /Resumen/.test(hoja) && /Lo más destacado/.test(hoja) && /se borra en 30 días/.test(hoja), "al tocarla se abre su hoja con el análisis", hoja.slice(0, 200));
      comprobar(await page.evaluate(() => ["agregar", "enlazar"].every((id) => getComputedStyle(document.getElementById(id)).display === "none")), "las hojas cerradas (agregar, enlazar) no se ven");
      await page.screenshot({path: (process.env.CAPTURAS || "/tmp") + "/notas.png", fullPage: true});
      await page.evaluate(() => { location.hash = "#inicio"; });
      await page.evaluate(() => nube.d.remove(nube.d.ref(nube.db, `usuarios/${nube.uid}/apuntes`)));
    }

    // -------------------------------------------------------------- aparatos (con un ESP32 simulado)
    if (PARTES.includes("aparatos")) {
      console.log("\n=== APARATOS (ESP32 simulado: tools/puente_simulado.py)");
      const {spawn} = require("child_process");
      const sim = spawn("python3", [__dirname + "/puente_simulado.py", "--dueno", uid, "--segundos", "400"]);
      const ordenes = [];
      let sid = "";
      sim.stdout.on("data", (b) => String(b).split("\n").filter(Boolean).forEach((l) => {
        const j = JSON.parse(l);
        if (j.listo) sid = j.listo; else if (j.ruta) { ordenes.push(j); console.log("    [ESP32]", j.ruta, JSON.stringify(j.cuerpo), "->", j.mensaje); }
      }));
      sim.stderr.on("data", (b) => console.log("    [ESP32 error]", String(b).slice(0, 200)));
      try {
        const t1 = Date.now();
        while (!sid && Date.now() - t1 < 20000) await espera(200);
        await hasta(page, () => /ESP32 de prueba[\s\S]*En línea/.test(document.querySelector("#ap-puentes").textContent), 30000, "puente en línea en Dispositivos");
        comprobar(true, "el ESP32 simulado aparece como puente en línea");
        await escribir("aparatos/lampara", {nombre: "Lámpara del cuarto", tipo: "luz", metodo: "rele", puente: sid, config: {pin: 16}});
        await escribir("aparatos/tele", {nombre: "Tele de la sala", tipo: "tv", metodo: "ir", puente: sid, acciones: {encender: {codigo: "nec:0x20DF10EF"}}});
        await escribir("aparatos/aire", {nombre: "Aire", tipo: "aire", metodo: "ir", puente: sid});
        await espera(1000);
        let r = await hablar("Píxel, apaga la lámpara");
        comprobar(ordenes.some((o) => o.cuerpo.metodo === "rele" && o.cuerpo.estado === 0 && o.cuerpo.pin === 16) && /apagué/.test(r), "apaga la lámpara por el relé");
        r = await hablar("Píxel, prende la tele");
        comprobar(ordenes.some((o) => o.cuerpo.metodo === "ir" && o.cuerpo.codigo === "nec:0x20DF10EF") && /encendí/.test(r), "enciende la tele por infrarrojo");
        r = await hablar("Píxel, sube el volumen del aire");
        comprobar(/Aprender botón/i.test(r), "pide aprender un botón que no conoce");
        r = await hablar("Píxel, ¿qué aparatos puedes manejar?");
        comprobar(/lámpara/i.test(r) && /tele/i.test(r), "lista los aparatos");
        // la pagina: boton rapido y aprender un boton del control
        await page.evaluate(() => { location.hash = "#dispositivos"; });
        await espera(600);
        const n0 = ordenes.length;
        await page.evaluate(() => document.querySelector('[data-ap="lampara"][data-accion="encender"]').click());
        await hasta(page, () => true, 100, "");
        const t2 = Date.now();
        while (ordenes.length === n0 && Date.now() - t2 < 15000) await espera(200);
        comprobar(ordenes.slice(n0).some((o) => o.cuerpo.metodo === "rele" && o.cuerpo.estado === 1), "botón Encender de la página");
        await page.evaluate(() => document.querySelector('[data-ap-mas="aire"]').click());
        await page.evaluate(() => { document.querySelector('[data-ap-boton="aire"]').value = "encender"; document.querySelector('[data-ap-aprender="aire"]').click(); });
        await hasta(page, () => true, 100, "");
        const t3 = Date.now();
        let aprendido = null;
        while (!aprendido && Date.now() - t3 < 20000) { await espera(500); aprendido = await leer("aparatos/aire/acciones/encender"); }
        comprobar(aprendido && aprendido.codigo === "nec:0x20DF10EF", "aprende el botón encender del aire", JSON.stringify(aprendido));
        await page.screenshot({path: (process.env.CAPTURAS || "/tmp") + "/dispositivos.png", fullPage: true});
        await page.evaluate(() => { location.hash = "#inicio"; });
        r = await hablar("Píxel, enciende el aire");
        comprobar(/encendí/.test(r), "ya enciende el aire con el código aprendido");
      } finally {
        sim.kill("SIGTERM");
        await new Promise((ok) => { sim.on("exit", ok); setTimeout(ok, 8000); });
      }
      await espera(1500);
      const r = await hablar("Píxel, apaga la lámpara");
      comprobar(/no está|enlazado|conectado|puente/i.test(r), "sin el puente lo dice", r);
    }
  } catch (e) {
    fallos++;
    console.log("\nERROR:", e.message);
    await page.screenshot({path: (process.env.CAPTURAS || "/tmp") + "/error.png"}).catch(() => {});
  }

  console.log(`\npeticiones a Gemini: ${peticiones} | errores de consola: ${errores.join(" / ") || "ninguno"}`);
  // limpieza: los datos y la cuenta anonima de la prueba
  const limpio = await page.evaluate(async () => {
    const d = nube.d, r = (x) => d.ref(nube.db, `usuarios/${nube.uid}/${x}`);
    await Promise.all(["cerebro", "tareas", "pomodoro", "preferencias", "recordatorios", "ajustes", "aparatos", "apuntes"].map((x) => d.remove(r(x)).catch(() => {})));
    return nube.usuario.delete().then(() => "cuenta borrada", (e) => "no pude borrar la cuenta: " + e.code);
  });
  console.log(limpio);
  await nav.close();
  if (omitidos) console.log(`\n${omitidos} omitida(s): YouTube no dejó sonar videos en este Chrome sin pantalla`);
  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO BIEN");
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
