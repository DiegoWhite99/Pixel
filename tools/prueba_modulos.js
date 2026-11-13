// Fase 13 - Pruebas en Node (sin dependencias) de las funciones de texto de la app de internet:
// agente.js y sus modulos se cargan en un contexto falso (sin pagina) y se prueban sus funciones puras.
//   node tools/prueba_modulos.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");

const WEB = path.join(__dirname, "..", "web");
const ctx = {console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, URL, TextEncoder, TextDecoder,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"), atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Intl, navigator: {language: "es-CO", onLine: true}, performance: {now: () => Date.now()}};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
// lo que pone app.js: aqui solo lo justo para que los modulos carguen sin pagina
vm.runInContext("var nube = {uid: '', usuario: null, d: null}; var $ = () => null; var esc = (t) => String(t); var toast = () => {};", ctx);
for (const f of ["proveedores.js", "proveedor_claude.js", "voz.js", "agente.js", "cerebro.js", "google.js", "tiempo.js", "aparatos.js", "musica.js", "humor.js", "apuntes.js", "contactos.js", "whatsapp.js", "ajustes.js", "perfil.js", "registro.js"]) {
  const ruta = path.join(WEB, f);
  if (fs.existsSync(ruta)) vm.runInContext(fs.readFileSync(ruta, "utf8"), ctx, {filename: f});
}

let fallos = 0, hechas = 0;
// los objetos del contexto falso tienen otro Object: se comparan pasando por JSON
const igual = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const esperando = [];                          // las pruebas asincronas (devuelven una promesa)
function prueba(nombre, f) {
  const mal = (e) => { fallos++; console.log("FALLA", nombre, "\n ", e.message); };
  try {
    const r = f();
    if (r && typeof r.then === "function") esperando.push(r.then(() => { hechas++; }, mal));
    else hechas++;
  } catch (e) { mal(e); }
}

// ---------------------------------------------------------------- nucleo
const T = ctx.Agente.texto;
prueba("respuestaPendiente: si y no", () => {
  const est = ctx.Agente.nucleo.est;
  est.pendiente = {si: /\b(envialo|mandalo|envia|manda)\b/};
  assert.strictEqual(T.respuestaPendiente("Sí, envíalo"), true);
  assert.strictEqual(T.respuestaPendiente("mándalo ya"), true);
  assert.strictEqual(T.respuestaPendiente("no, no lo envíes"), false);
  assert.strictEqual(T.respuestaPendiente("envíalo pero cambia el asunto"), null);
  assert.strictEqual(T.respuestaPendiente("qué hora es"), null);
  est.pendiente = null;
  assert.strictEqual(T.respuestaPendiente("envíalo"), null);
});
prueba("juntarParte: texto seguido y llamadas con firma", () => {
  const partes = [];
  T.juntarParte(partes, {text: "Hola, "});
  T.juntarParte(partes, {text: "Diego."});
  T.juntarParte(partes, {thought: true, text: "pienso"});
  T.juntarParte(partes, {functionCall: {name: "x", args: {}}, thoughtSignature: "abc"});
  T.juntarParte(partes, {text: "", thoughtSignature: "def"});
  assert.strictEqual(partes.length, 3);
  assert.strictEqual(partes[0].text, "Hola, Diego.");
  assert.strictEqual(partes[1].thoughtSignature, "abc");
});

// ---------------------------------------------------------------- cerebro
if (ctx.Cerebro) {
  const C = ctx.Cerebro.texto;
  prueba("fichas: sin tildes, sin palabras vacias, 5 letras", () => {
    assert.deepStrictEqual([...C.fichas("¿Qué correos tengo de Ana?")], ["corre", "ana"]);
    assert.deepStrictEqual([...C.fichas("El calendario")], ["calen"]);
  });
  const saber = C.trozosMd(fs.readFileSync(path.join(WEB, "saber.md"), "utf8"));
  prueba("trozosMd: un trozo por seccion", () => {
    assert.ok(saber.length >= 8, "hay " + saber.length);
    assert.ok(saber.some((t) => /Pomodoro/.test(t.titulo)));
  });
  prueba("buscar: el trozo que toca", () => {
    const ind = C.indice(saber);
    assert.match(C.buscar(ind, "¿cómo funciona la técnica pomodoro?", 1)[0].doc.titulo, /Pomodoro/);
    assert.match(C.buscar(ind, "explícame la matriz de urgente e importante", 1)[0].doc.titulo, /Eisenhower/);
    assert.match(C.buscar(ind, "cómo le enseño el botón del control remoto de la tele", 1)[0].doc.titulo, /botón del control/);
    assert.strictEqual(C.buscar(ind, "hola", 3).length, 0);
  });
  prueba("contextoDe: reglas siempre, notas por relevancia", () => {
    const notas = [
      {id: "1", titulo: "Hablar de tú", texto: "Quiere que Píxel le hable de tú.", tipo: "regla"},
      {id: "2", titulo: "Nombre", texto: "Se llama Diego.", tipo: "yo"},
      {id: "3", titulo: "Hermana Laura", texto: "Su hermana se llama Laura, correo laura@ejemplo.com.", tipo: "persona"},
      {id: "4", titulo: "Música favorita", texto: "Le gusta Queen.", tipo: "gusto"},
    ];
    const s = C.contextoDe(notas, saber, "mándale un correo a mi hermana");
    assert.match(s, /Reglas que te dio el usuario[\s\S]*Hablar de tú/);
    assert.match(s, /Lo que sabes del usuario[\s\S]*Se llama Diego/);
    assert.match(s, /Hermana Laura/);
    assert.doesNotMatch(s, /Queen/);
  });
  prueba("mismoTitulo: ignora tildes y signos", () => {
    assert.ok(C.mismoTitulo("Música favorita", "musica  favorita."));
    assert.ok(!C.mismoTitulo("Nombre", "Apellido"));
  });
}

// ---------------------------------------------------------------- google
if (ctx.PixelGoogle) {
  const G = ctx.PixelGoogle.texto;
  prueba("mime: asunto y cuerpo en UTF-8, base64url", () => {
    const raw = G.armarMime({para: "Ana <ana@ejemplo.com>", asunto: "Reunión mañana", cuerpo: "Hola Ana,\nllego a las 3.\n¡Gracias!"});
    const txt = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.match(txt, /^To: Ana <ana@ejemplo.com>\r\n/m);
    assert.match(txt, /Subject: =\?UTF-8\?B\?/);
    assert.ok(!/[+/=]/.test(raw), "base64url sin relleno");
    const cuerpo = txt.split("\r\n\r\n")[1];
    assert.strictEqual(Buffer.from(cuerpo.replace(/\r\n/g, ""), "base64").toString("utf8"), "Hola Ana,\r\nllego a las 3.\r\n¡Gracias!");
  });
  prueba("mime: respuesta con In-Reply-To", () => {
    const raw = G.armarMime({para: "a@b.co", asunto: "Re: Hola", cuerpo: "Sí", enRespuestaA: "<x@mail>"});
    const txt = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.match(txt, /In-Reply-To: <x@mail>/);
    assert.match(txt, /References: <x@mail>/);
  });
  prueba("textoCorreo: text/plain o html sin etiquetas", () => {
    const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    const msg = {payload: {mimeType: "multipart/alternative", parts: [
      {mimeType: "text/html", body: {data: b64("<p>Hola <b>Diego</b></p>")}},
      {mimeType: "text/plain", body: {data: b64("Hola Diego, ¿vienes?")}}]}};
    assert.strictEqual(G.textoCorreo(msg), "Hola Diego, ¿vienes?");
    const html = {payload: {mimeType: "text/html", body: {data: b64("<div>Uno&nbsp;dos<br>tres</div><style>x{}</style>")}}};
    assert.strictEqual(G.textoCorreo(html), "Uno dos\ntres");
  });
  prueba("direccion: nombre y correo", () => {
    igual(G.direccion('"Ana Pérez" <ana@x.co>'), {nombre: "Ana Pérez", correo: "ana@x.co"});
    igual(G.direccion("bob@x.co"), {nombre: "", correo: "bob@x.co"});
  });
  prueba("rangoDia: todo el dia local", () => {
    const [a, b] = G.rangoDia("2026-11-09");
    assert.strictEqual(new Date(a).getHours(), 0);
    assert.strictEqual(b - a, 86400000);
  });
}

// ---------------------------------------------------------------- tiempo
if (ctx.PixelTiempo) {
  const P = ctx.PixelTiempo.texto;
  const cfg = {trabajo: 25, descanso: 5, largo: 15, ciclos: 4};
  prueba("pomodoro: trabajo -> descanso -> trabajo -> ... -> largo", () => {
    let p = P.nuevoPomodoro("física", cfg, 0);
    assert.strictEqual(p.fase, "trabajo");
    assert.strictEqual(p.fin, 25 * 60000);
    const fases = [];
    for (let i = 0; i < 8; i++) { p = P.siguienteFase(p, cfg, p.fin); fases.push(p ? p.fase + p.ciclo : "fin"); if (!p) break; }
    assert.deepStrictEqual(fases, ["descanso1", "trabajo2", "descanso2", "trabajo3", "descanso3", "trabajo4", "largo4", "fin"]);
  });
  prueba("pomodoro: pausa y sigue", () => {
    let p = P.nuevoPomodoro("", cfg, 0);
    p = P.pausar(p, 10 * 60000);
    assert.strictEqual(p.queda, 15 * 60000);
    p = P.reanudar(p, 50 * 60000);
    assert.strictEqual(p.fin, 65 * 60000);
  });
  prueba("eisenhower: cuadrantes y orden", () => {
    assert.strictEqual(P.cuadrante({urgente: true, importante: true}), "hacer");
    assert.strictEqual(P.cuadrante({urgente: false, importante: true}), "planificar");
    assert.strictEqual(P.cuadrante({urgente: true, importante: false}), "delegar");
    assert.strictEqual(P.cuadrante({urgente: false, importante: false}), "eliminar");
    const ts = [{texto: "c", urgente: false, importante: true}, {texto: "a", urgente: true, importante: true, vence: 5},
      {texto: "b", urgente: true, importante: true, vence: 2}, {texto: "z", urgente: false, importante: false}, {texto: "h", hecha: true, urgente: true, importante: true}];
    assert.deepStrictEqual(P.ordenTareas(ts).map((t) => t.texto), ["b", "a", "c", "z"]);
  });
  prueba("buscarTarea: por palabras", () => {
    const ts = [{id: "1", texto: "Entregar el informe de física"}, {id: "2", texto: "Comprar pan"}];
    assert.strictEqual(P.buscarTarea(ts, "el informe").id, "1");
    assert.strictEqual(P.buscarTarea(ts, "llamar a mamá"), null);
  });
  // Fase 14: la guia de Eisenhower y los atajos del pomodoro (sin Gemini)
  prueba("guia: la tarea y lo que se dice de ella", () => {
    igual(P.leerTarea("tengo que entregar el informe de física para el viernes"), {texto: "entregar el informe de física", urgente: true});
    igual(P.leerTarea("Terminar el informe, es urgente e importante"), {texto: "Terminar el informe", urgente: true, importante: true});
    igual(P.leerTarea("organizar el escritorio, no es urgente ni importante"), {texto: "organizar el escritorio", urgente: false, importante: false});
    igual(P.leerTarea("y también comprar los regalos que es importante pero no urgente"), {texto: "comprar los regalos", urgente: false, importante: true});
    igual(P.leerTarea("llamar a la abuela"), {texto: "llamar a la abuela"});
  });
  prueba("guia: respuestas a urgente / importante", () => {
    igual(P.respuestaPaso("sí", "urgente"), {urgente: true});
    igual(P.respuestaPaso("no, pero es importante", "urgente"), {importante: true, urgente: false});
    igual(P.respuestaPaso("es para mañana", "urgente"), {urgente: true});
    igual(P.respuestaPaso("mmm creo que sí", "importante"), {importante: true});
    igual(P.respuestaPaso("la verdad no mucho", "importante"), {importante: false});
    igual(P.respuestaPaso("qué", "importante"), {});
    const pl = ctx.Agente.texto.plano;
    assert.ok(P.esListo(pl("listo")) && P.esListo(pl("no, eso es todo")) && P.esListo(pl("no")) && !P.esListo(pl("noviembre")));
    assert.ok(P.esSalir(pl("sal de la guía")) && P.esSalir(pl("salir")) && P.esSalir(pl("salir del modo enfoque")) && !P.esSalir(pl("listo")) && !P.esSalir(pl("salir a correr el sábado")));
  });
  prueba("guia: cuándo se abre", () => {
    for (const f of ["organiza mis tareas", "ayúdame a organizar mis pendientes", "usa la matriz de Eisenhower", "matriz de Aisenhauer"]) assert.ok(P.pedidoGuia(f), f);
    for (const f of ["agrega a la matriz de eisenhower comprar pan", "agrega una tarea urgente e importante: entregar el informe", "ordena la música"]) assert.ok(!P.pedidoGuia(f), f);
    assert.ok(P.pideQueHago("¿qué hago primero?") && P.pideQueHago("por dónde empiezo") && !P.pideQueHago("qué hago hoy"));
  });
  prueba("atajos del pomodoro", () => {
    igual(P.pedidoPomodoro("Empieza un pomodoro de 50 minutos para estudiar física"), {accion: "empezar", minutos: 50, tarea: "estudiar física"});
    igual(P.pedidoPomodoro("sí, empieza un pomodoro con esa"), {accion: "empezar", tarea: "@sugerida"});
    igual(P.pedidoPomodoro("pon un pomodoro de media hora con descanso de 10 para el informe"), {accion: "empezar", descanso: 10, minutos: 30, tarea: "informe"});
    igual(P.pedidoPomodoro("quita la pausa del pomodoro"), {accion: "seguir"});
    igual(P.pedidoPomodoro("pausa el pomodoro"), {accion: "pausar"});
    igual(P.pedidoPomodoro("para el pomodoro"), {accion: "parar"});
    igual(P.pedidoPomodoro("¿cuánto me queda del pomodoro?"), {accion: "estado"});
    igual(P.pedidoPomodoro("¿cuánto queda?"), {accion: "estado", siHay: true});
    assert.strictEqual(P.pedidoPomodoro("qué es un pomodoro"), null);
    assert.strictEqual(P.pedidoPomodoro("pausa"), null);              // sin "pomodoro": es de la musica
  });
  prueba("modo enfoque: la frase, la elección y «¿La terminaste?»", () => {
    for (const f of ["modo enfoque", "Modo Enfoque.", "activa el modo enfoque", "modo en foque", "quiero enfocarme"]) assert.ok(P.pidoEnfoque(f), f);
    for (const f of ["el enfoque de la cámara", "qué es el modo enfoque"]) assert.ok(!P.pidoEnfoque(f), f);
    const pl = ctx.Agente.texto.plano;
    assert.deepStrictEqual(["sí", "la matriz", "mejor pomodoro", "no", "qué"].map((f) => P.eleccionEnfoque(pl(f))), ["si", "matriz", "pomodoro", "no", null]);
    assert.deepStrictEqual(["sí, ya la terminé", "lista", "aún no", "me falta un poco", "qué hora es"].map(P.respuestaHecha), [true, true, false, false, null]);
  });
  prueba("modo enfoque: un pomodoro para cada tarea importante", () => {
    const ts = [{id: "a", texto: "informe", urgente: true, importante: true}, {id: "b", texto: "llamar", urgente: false, importante: true},
      {id: "c", texto: "escritorio", urgente: false, importante: false}, {id: "d", texto: "correo", urgente: true, importante: false},
      {id: "e", texto: "ya hecha", urgente: true, importante: true, hecha: true}];
    const plan = P.planDeTareas(ts);
    igual(plan, [{id: "a", texto: "informe"}, {id: "b", texto: "llamar"}]);
    const p = {plan: JSON.stringify(plan), paso: 0, total: 2};
    igual(P.avanzarPlan(p, new Set()), {paso: 1, tarea: "llamar", tareaId: "b", seguir: false, total: 2});
    igual(P.avanzarPlan(Object.assign({}, p, {seguir: true}), new Set()), {paso: 0, tarea: "informe", tareaId: "a", seguir: false, total: 3});
    assert.strictEqual(P.avanzarPlan(p, new Set(["b"])), null);        // la siguiente ya esta hecha: se acabo el plan
    igual(P.planDeTareas([ts[2], ts[3]]), [{id: "d", texto: "correo"}]);   // sin importantes: las pendientes menos Eliminar
  });
}

// ---------------------------------------------------------------- aparatos
if (ctx.PixelAparatos) {
  const D = ctx.PixelAparatos.texto;
  const aparatos = [{id: "t", nombre: "Televisor de la sala", tipo: "tv"}, {id: "p", nombre: "PC", tipo: "pc"}, {id: "l", nombre: "Lámpara", tipo: "luz"}];
  prueba("buscarAparato: por nombre o por tipo", () => {
    assert.strictEqual(D.buscarAparato(aparatos, "la tele").id, "t");
    assert.strictEqual(D.buscarAparato(aparatos, "el televisor").id, "t");
    assert.strictEqual(D.buscarAparato(aparatos, "el computador").id, "p");
    assert.strictEqual(D.buscarAparato(aparatos, "la luz").id, "l");
    assert.strictEqual(D.buscarAparato(aparatos, "la nevera"), null);
  });
  prueba("conArticulo: genero y siglas", () => {
    assert.strictEqual(D.conArticulo("Tele de la sala"), "la tele de la sala");
    assert.strictEqual(D.conArticulo("Lámpara del cuarto"), "la lámpara del cuarto");
    assert.strictEqual(D.conArticulo("PC"), "el PC");
    assert.strictEqual(D.conArticulo("Aire"), "el aire");
    assert.strictEqual(D.conArticulo("La luz"), "la luz");
  });
  prueba("plan: accion -> orden para el puente", () => {
    const pc = {nombre: "PC", tipo: "pc", metodo: "pc", puente: "P1", acciones: {encender: {metodo: "wol", mac: "aa:bb:cc:dd:ee:ff", puente: "E1"}}};
    igual(D.plan(pc, "subir_volumen"), {puente: "P1", ruta: "/api/pc", cuerpo: {accion: "subir_volumen"}});
    igual(D.plan(pc, "encender"), {puente: "E1", ruta: "/api/aparato", cuerpo: {metodo: "wol", mac: "aa:bb:cc:dd:ee:ff"}});
    const luz = {nombre: "Lámpara", tipo: "luz", metodo: "rele", puente: "E1", config: {pin: 16}};
    igual(D.plan(luz, "apagar"), {puente: "E1", ruta: "/api/aparato", cuerpo: {metodo: "rele", pin: 16, estado: 0}});
    const tv = {nombre: "TV", tipo: "tv", metodo: "atv", puente: "P1", config: {ip: "192.168.1.50"}};
    igual(D.plan(tv, "bajar_volumen"), {puente: "P1", ruta: "/api/tv", cuerpo: {ip: "192.168.1.50", tecla: "VOLUME_DOWN"}});
    const ir = {nombre: "Aire", tipo: "aire", metodo: "ir", puente: "E1", acciones: {encender: {codigo: "nec:0x20DF10EF"}}};
    igual(D.plan(ir, "encender"), {puente: "E1", ruta: "/api/aparato", cuerpo: {metodo: "ir", codigo: "nec:0x20DF10EF"}});
    assert.strictEqual(D.plan(ir, "subir_volumen"), null);
  });
}

// ---------------------------------------------------------------- musica
if (ctx.PixelMusica) {
  const M = ctx.PixelMusica.texto;
  prueba("tituloDicho: sin (Official Video) ni | Lyrics", () => {
    assert.strictEqual(M.tituloDicho("Queen – Bohemian Rhapsody (Official Video Remastered)"), "Queen – Bohemian Rhapsody");
    assert.strictEqual(M.tituloDicho("Shakira - Acróstico [Official Video] | Shakira"), "Shakira - Acróstico");
    assert.strictEqual(M.tituloDicho("Soda Stereo &amp; amigos - De música ligera (En Vivo)"), "Soda Stereo & amigos - De música ligera");
    assert.strictEqual(M.tituloDicho("Bohemian Rhapsody - Queen [Subtitulos Español][Traducido]"), "Bohemian Rhapsody - Queen");
  });
  prueba("urlIntent: la app de YouTube en Android, con la web de respaldo", () => {
    const u = M.urlIntent("abc12345678");
    assert.match(u, /^intent:\/\/www\.youtube\.com\/watch\?v=abc12345678#Intent;scheme=https;package=com\.google\.android\.youtube;S\.browser_fallback_url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3Dabc12345678;end$/);
  });
  prueba("normalizarDonde: «youtube» de antes es la ventana", () => {
    assert.deepStrictEqual(["youtube", "ventana", "app", "pc", "otra", null].map(M.normalizarDonde), ["ventana", "ventana", "app", "pc", "ventana", "ventana"]);
  });
  prueba("atajoDe: órdenes cortas de música sin Gemini", () => {
    const a = (t) => { const r = M.atajoDe(t); return r ? r.accion + (r.valor !== undefined ? ":" + r.valor : "") : null; };
    assert.strictEqual(a("Para la canción"), "parar");
    assert.strictEqual(a("para la música, por favor"), "parar");
    assert.strictEqual(a("pausa"), "pausar");
    assert.strictEqual(a("sigue con la música"), "seguir");
    assert.strictEqual(a("cambia de canción"), "siguiente");
    assert.strictEqual(a("pon la siguiente"), "siguiente");
    assert.strictEqual(a("la anterior"), "anterior");
    assert.strictEqual(a("súbele"), "subir_volumen");
    assert.strictEqual(a("más bajo"), "bajar_volumen");
    assert.strictEqual(a("volumen al 40"), "volumen:40");
    assert.strictEqual(a("pon otra canción de Shakira"), null);
    assert.strictEqual(a("para qué sirve la fotosíntesis"), null);
    assert.strictEqual(a("qué hora es"), null);
  });
  prueba("resultadosApi: solo videos con id", () => {
    const r = M.resultadosApi({items: [{id: {videoId: "abc12345678"}, snippet: {title: "Uno &quot;dos&quot;", channelTitle: "Canal"}}, {id: {channelId: "x"}}]});
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].titulo, 'Uno "dos"');
  });
}

// ---------------------------------------------------------------- humor
if (ctx.PixelHumor) {
  const H = ctx.PixelHumor.texto;
  prueba("nivel de molestia", () => {
    assert.deepStrictEqual([0, 3, 4, 6.5, 10].map(H.nivel), ["divertido", "divertido", "cansado", "enojado", "harto"]);
  });
  prueba("animoDeCharla", () => {
    assert.strictEqual(H.animoDeCharla("muchas gracias Píxel", "De nada."), "corazones");
    assert.strictEqual(H.animoDeCharla("cuéntame un chiste", "¿Por qué el libro de mates estaba triste? ¡Jaja!"), "risa");
    assert.strictEqual(H.animoDeCharla("eres un tonto", "Vaya."), "triste");
    assert.strictEqual(H.animoDeCharla("pon Queen", "Lo siento, no encontré eso."), "triste");
    assert.strictEqual(H.animoDeCharla("qué hora es", "Son las 3."), "");
  });
  prueba("elegirEvento: con música tararea más", () => {
    assert.strictEqual(H.elegirEvento(0, false, 0), "mirar");
    const n = 2000, cuenta = (m) => { let k = 0; for (let i = 0; i < n; i++) if (H.elegirEvento(0, m, i / n) === "tararear") k++; return k; };
    assert.ok(cuenta(true) > cuenta(false) * 2);
    let aburre = 0; for (let i = 0; i < n; i++) if (H.elegirEvento(400000, false, i / n) === "aburrido") aburre++;
    assert.ok(aburre > 0);
  });
}

// ---------------------------------------------------------------- notas
if (ctx.PixelApuntes) {
  const P = ctx.PixelApuntes.texto;
  prueba("pedidoDeNota: «toma nota» y su contexto", () => {
    assert.strictEqual(P.pedidoDeNota("toma nota").contexto, "");
    assert.strictEqual(P.pedidoDeNota("Toma nota de la clase de física").contexto, "la clase de física");
    assert.strictEqual(P.pedidoDeNota("por favor, toma notas sobre la reunión con Ana.").contexto, "la reunión con Ana");
    assert.strictEqual(P.pedidoDeNota("apunta esto: comprar pan").contexto, "comprar pan");
    assert.strictEqual(P.pedidoDeNota("qué notas sacaste en el examen"), null);
    assert.strictEqual(P.pedidoDeNota("recuérdame tomar nota mañana"), null);
  });
  prueba("esFin: cerrar la nota", () => {
    for (const t of ["Píxel, termina la nota", "terminar la nota", "deja de tomar notas", "Píxel, listo", "oye píxel ya terminé", "cierra el dictado"]) assert.ok(P.esFin(t), t);
    for (const t of ["la clase terminó tarde", "listo para el examen", "anota que mañana hay parcial"]) assert.ok(!P.esFin(t), t);
  });
  prueba("fraseDictada: sin Píxel, con mayúscula y punto", () => {
    assert.strictEqual(P.fraseDictada("la mitosis tiene cuatro fases"), "La mitosis tiene cuatro fases.");
    assert.strictEqual(P.fraseDictada("Píxel, el examen es el viernes"), "El examen es el viernes.");
    assert.strictEqual(P.fraseDictada("¿qué es un mol?"), "¿qué es un mol?");
  });
  prueba("grupoFecha, filtrarNotas, asuntos, viejas", () => {
    const ahora = new Date(2026, 10, 9, 15, 0).getTime(), h = 3600000, d = 24 * h;
    assert.strictEqual(P.grupoFecha(ahora - 2 * h, ahora), "Hoy");
    assert.strictEqual(P.grupoFecha(ahora - d, ahora), "Ayer");
    assert.strictEqual(P.grupoFecha(new Date(2026, 10, 3, 10).getTime(), ahora), "Martes 3 de noviembre");
    const ns = [
      {id: "a", titulo: "Clase de biología", contexto: "", asunto: "Biología", importante: "Examen el viernes", texto: "La célula…", creado: ahora - h},
      {id: "b", titulo: "Reunión", contexto: "", asunto: "Trabajo", importante: "", texto: "Presupuesto de la feria", creado: ahora - d},
      {id: "c", titulo: "Mitosis", contexto: "", asunto: "Biología", importante: "", texto: "Fases", creado: ahora - 5 * d},
      {id: "v", titulo: "Vieja", contexto: "", asunto: "", importante: "", texto: "", creado: ahora - 31 * d}];
    const ids = (f) => JSON.stringify(P.filtrarNotas(ns, f, ahora).map((n) => n.id));
    assert.strictEqual(ids({fecha: "hoy"}), '["a"]');
    assert.strictEqual(ids({fecha: "ayer"}), '["b"]');
    assert.strictEqual(ids({fecha: "semana"}), '["a","b","c"]');
    assert.strictEqual(ids({fecha: "todas", asunto: "Biología"}), '["a","c"]');
    assert.strictEqual(ids({fecha: "todas", texto: "feria"}), '["b"]');
    assert.strictEqual(ids({fecha: "2026-11-04"}), '["c"]');
    assert.strictEqual(JSON.stringify(P.asuntos(ns)), '[["Biología",2],["Trabajo",1]]');
    assert.strictEqual(JSON.stringify(P.viejas(ns, ahora)), '["v"]');
    assert.strictEqual(P.diasQuedan(ns[0], ahora), 30);
    assert.strictEqual(P.clasificacionLocal({titulo: "Nota del 9 de noviembre", texto: "Primero esto. Luego aquello."}).asunto, "General");
    assert.strictEqual(P.clasificacionLocal({titulo: "Clase de física", texto: "Primero esto. Luego aquello."}).importante, "Primero esto.");
  });
  prueba("limpiarAnalisis y contarPalabras", () => {
    const a = P.limpiarAnalisis({resumen: " Algo ", ideas_generales: ["a", "", 3], destacado: "no es lista"});
    assert.strictEqual(a.resumen, "Algo");
    assert.strictEqual(JSON.stringify(a.ideas_generales), '["a","3"]');
    assert.strictEqual(a.destacado.length, 0);
    assert.strictEqual(P.contarPalabras("Hola, ¿qué tal? Bien: 3 cosas."), 6);
  });
}

// ------------------------------------------------------------------ escenarios.js (fondos por genero)
{
  const E = require(path.join(__dirname, "..", "web", "escenarios.js"));
  // los generos de cara3d.js: se leen de su tabla ESTILOS sin cargar WebGL
  const fuente = fs.readFileSync(path.join(__dirname, "..", "web", "cara3d.js"), "utf8");
  const tabla = fuente.slice(fuente.indexOf("const ESTILOS = {"), fuente.indexOf("};", fuente.indexOf("const ESTILOS = {")));
  const generos = [...tabla.matchAll(/^\s{4}(\w+): \{/gm)].map((m) => m[1]);
  prueba("escenarios: cada genero tiene su escena", () => {
    assert.ok(generos.length >= 11, "generos leidos: " + generos.join());
    for (const g of generos) assert.ok(E.ESCENA[g], "sin escena: " + g);
    assert.strictEqual(E.de("salsa").nombre, "playa");
    assert.strictEqual(E.de("reggaeton").nombre, "atardecer");
    assert.strictEqual(E.de("metal").nombre, "metal");
    assert.strictEqual(E.de("electronica").nombre, "laser");
    assert.strictEqual(E.de("cualquiera").nombre, "fiesta");
  });
  prueba("escenarios: SVG bien cerrado, ids propios y sin nada de fuera", () => {
    for (const n of new Set(Object.values(E.ESCENA))) {
      const g = Object.keys(E.ESCENA).find((k) => E.ESCENA[k] === n), svg = E.de(g).svg;
      assert.ok(/^<svg [^>]*viewBox="0 0 400 300"/.test(svg) && svg.endsWith("</svg>"), n);
      // cada etiqueta abierta se cierra (las que no terminan en "/>")
      const pila = [];
      for (const m of svg.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>/g)) {
        if (m[3]) continue;
        if (!m[1]) pila.push(m[2]);
        else assert.strictEqual(pila.pop(), m[2], n + ": cierra " + m[2]);
      }
      assert.strictEqual(pila.length, 0, n + ": sin cerrar " + pila.join());
      for (const u of svg.matchAll(/url\(#([\w-]+)\)/g)) assert.ok(svg.includes(`id="${u[1]}"`), n + ": falta el degradado " + u[1]);
      assert.ok(!/id="es-(?!\w+-)/.test(svg.replace(new RegExp(`id="es-${n}-`, "g"), "")), n + ": id sin el nombre de la escena");
      assert.ok(!/https?:|NaN|undefined/.test(svg.replace("http://www.w3.org/2000/svg", "")), n + ": algo raro");
    }
  });
}

// ------------------------------------------------------------------ la regla del correo (Fase 14)
// "Que no envie sin aprobacion, mantener esa regla" (usuario, 10 nov): Gemini no tiene ninguna herramienta
// que envie, y el unico envio (drafts/send) esta en enviarBorrador, al que solo se llega confirmando.
prueba("correo: nunca se envía sin confirmar", () => {
  const g = fs.readFileSync(path.join(WEB, "google.js"), "utf8");
  const nombres = [...g.matchAll(/\{name: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(nombres.length >= 9, "herramientas leídas: " + nombres.join());
  for (const n of nombres) assert.ok(!/envia|enviar|send|mandar/.test(n), "herramienta que envía: " + n);
  assert.strictEqual((g.match(/drafts\/send/g) || []).length, 1, "un solo sitio envía");
  const envio = g.slice(g.indexOf("async function enviarBorrador"), g.indexOf("drafts/send"));
  assert.ok(envio.length > 0 && envio.length < 400, "drafts/send está dentro de enviarBorrador");
  const usos = [...g.matchAll(/enviarBorrador/g)].length - 1;          // sin contar su definicion
  const enConfirmar = [...g.matchAll(/hacer: (?:\(\) => )?enviarBorrador\b/g)].length;
  assert.ok(enConfirmar >= 1 && usos === enConfirmar, `enviarBorrador solo como "hacer" de una confirmación (${enConfirmar} de ${usos})`);
  assert.ok(/nunca envías nada por tu cuenta/.test(fs.readFileSync(path.join(WEB, "agente.md"), "utf8")), "agente.md lo dice");
});

// ------------------------------------------------------------------ WhatsApp (Fase 14)
if (ctx.PixelWhatsapp) {
  const W = ctx.PixelWhatsapp.texto;
  prueba("whatsapp: números", () => {
    assert.strictEqual(W.normalizar("300 123 4567", "57"), "573001234567");
    assert.strictEqual(W.normalizar("+57 (300) 123-4567", "57"), "573001234567");
    assert.strictEqual(W.normalizar("0034 612 345 678", "57"), "34612345678");
    assert.strictEqual(W.normalizar("+34 612 345 678", "57"), "34612345678");
    assert.strictEqual(W.normalizar("12345", "57"), "");
    assert.strictEqual(W.numeroDe("Mi hermana. WhatsApp: +57 300 123 4567. Cumple el 3 de mayo"), "+573001234567");
    assert.strictEqual(W.numeroDe("Su celular es 300-765-4321"), "3007654321");
    assert.strictEqual(W.numeroDe("Estudia medicina"), "");
    assert.strictEqual(W.formato("573001234567"), "+57 300 123 4567");
    assert.strictEqual(W.conNumero("Mi hermana.", "573001234567"), "Mi hermana.\nWhatsApp: +57 300 123 4567");
    assert.strictEqual(W.conNumero("Mi hermana. WhatsApp: +57 300 000 0000", "573001234567"), "Mi hermana. WhatsApp: +57 300 123 4567");
    assert.strictEqual(W.urlCelular("573001234567", "hola, ¿cómo vas?"), "https://wa.me/573001234567?text=hola%2C%20%C2%BFc%C3%B3mo%20vas%3F");
  });
}
// 11 nov: WhatsApp busca como el correo: espera la lista de Contactos (al entrar llega tarde) y no adivina
// entre parecidos. Contactos y notas falsos, solo en esta prueba.
if (ctx.PixelWhatsapp && ctx.PixelContactos && ctx.Cerebro) {
  prueba("whatsapp: espera los contactos y pregunta si hay dos parecidos", async () => {
    // se cambian solo esperar y candidatos (las demas pruebas usan PixelContactos.texto a la vez)
    const PC = ctx.PixelContactos, CT = PC.texto, real = {esperar: PC.esperar, candidatos: PC.candidatos}, notasReal = ctx.Cerebro.notas;
    let lista = null;                           // como al entrar: la lista aun no ha llegado de Firebase
    PC.esperar = () => new Promise((ok) => setTimeout(() => {
      lista = [{nombre: "Ana Prueba", telefono: "573001112233", correo: ""}, {nombre: "Ana Ejemplo", telefono: "573004445566", correo: ""},
        {nombre: "Luis Prueba", telefono: "", correo: "luis@example.com"}];
      ok();
    }, 30));
    PC.candidatos = (q, campo) => CT.candidatosDe(lista, q, campo);
    ctx.Cerebro.notas = () => [{titulo: "Marta Prueba", texto: "WhatsApp: +57 300 777 8899", tipo: "persona"}, {titulo: "Marta Ejemplo", texto: "", tipo: "persona"}];
    try {
      const B = ctx.PixelWhatsapp.buscarPersona;
      const a = await B("Ana Prueba");
      igual([a.titulo, a.texto], ["Ana Prueba", "WhatsApp: +57 300 111 2233"]);
      igual((await B("Ana")).ambiguo, ["Ana Prueba", "Ana Ejemplo"]);
      igual(await B("Luis"), {titulo: "Luis Prueba", texto: "", tipo: "persona", contacto: true});   // sin celular: se le guarda a el
      assert.strictEqual((await B("Marta Prueba")).titulo, "Marta Prueba");
      igual((await B("Marta")).ambiguo, ["Marta Prueba", "Marta Ejemplo"]);
      assert.strictEqual(await B("Nadie Prueba"), null);
    } finally { Object.assign(PC, real); ctx.Cerebro.notas = notasReal; }
    const w = fs.readFileSync(path.join(WEB, "whatsapp.js"), "utf8");
    assert.ok(/const nota = await buscarPersona\(para\);\s*if \(nota && nota\.ambiguo\) return/.test(w), "ejecutar pregunta a cuál si hay parecidos");
  });
}
// La misma regla que el correo para WhatsApp: ninguna herramienta envia, y abrir (lo unico que manda
// algo) solo se usa como "hacer" de una confirmacion
prueba("whatsapp: nunca se envía sin confirmar", () => {
  const w = fs.readFileSync(path.join(WEB, "whatsapp.js"), "utf8");
  const nombres = [...w.matchAll(/\{name: "([a-z_]+)"/g)].map((m) => m[1]);
  igual(nombres, ["escribir_whatsapp"]);
  const usos = [...w.matchAll(/\babrir\(/g)].length - 1;          // sin contar su definicion
  assert.ok(usos === 1 && /hacer: \(\) => abrir\(/.test(w), "abrir() solo desde la confirmación");
  assert.strictEqual((w.match(/window\.open\(/g) || []).length, 1);
  assert.ok(/WhatsApp: igual/.test(fs.readFileSync(path.join(WEB, "agente.md"), "utf8")), "agente.md lo dice");
});

// ------------------------------------------------------------------ Registro de acciones (2.1.0)
if (ctx.PixelRegistro) {
  const R = ctx.PixelRegistro.texto;
  prueba("registro: junta la cuenta y el PC, de lo más nuevo a lo más viejo", () => {
    const l = R.juntar({a: {t: 100, tipo: "correo", texto: "Envié un correo", aparato: "Celular"}, b: {t: 300, tipo: "evento", texto: "Creé el evento"}, roto: {t: "x", texto: 1}},
      {c: {t: 200, tipo: "crear_evento", texto: "Agendé", aparato: "PC", detalle: "por voz"}});
    igual(l.map((x) => [x.id, x.origen, x.grupo]), [["b", "cuenta", "evento"], ["c", "pc", "evento"], ["a", "cuenta", "correo"]]);
    assert.strictEqual(l[1].detalle, "por voz");
    assert.strictEqual(R.grupo("youtube"), "otro");
    igual(R.juntar(null, undefined), []);
  });
  prueba("registro: hoy, ayer y la fecha", () => {
    const ahora = new Date(2026, 10, 11, 9, 0).getTime();
    assert.strictEqual(R.dia(new Date(2026, 10, 11, 0, 5).getTime(), ahora), "Hoy");
    assert.strictEqual(R.dia(new Date(2026, 10, 10, 23, 59).getTime(), ahora), "Ayer");
    assert.ok(/^Miércoles,? 4 de noviembre$/.test(R.dia(new Date(2026, 10, 4, 12).getTime(), ahora)), R.dia(new Date(2026, 10, 4, 12).getTime(), ahora));
  });
}
// Se anota DESPUES de hacerlo: cada N.registrar va detras de la llamada que lo hace de verdad
prueba("registro: se anota después de hacerlo, no antes", () => {
  const g = fs.readFileSync(path.join(WEB, "google.js"), "utf8");
  const antes = (a, b) => { const i = g.indexOf(a), j = g.indexOf(b); assert.ok(i > 0 && j > i, `${a} antes de ${b}`); };
  antes("drafts/send", 'N.registrar("correo", `Envié');
  antes('await api(CAL, {method: "POST"', 'N.registrar("evento", `Creé');
  antes('{method: "DELETE"}', 'N.registrar("evento", `Borré');
  antes('{method: "PATCH"', 'N.registrar("evento", `Moví');
  antes("/trash`", 'N.registrar("correo", `Mandé');
  const w = fs.readFileSync(path.join(WEB, "whatsapp.js"), "utf8");
  const ini = w.indexOf("async function abrir("), fin = w.indexOf("herramienta para Gemini");
  const usos = [...w.matchAll(/N\.registrar\(/g)].map((m) => m.index);
  assert.ok(usos.length === 2 && usos.every((i) => i > ini && i < fin), "WhatsApp solo se anota dentro de abrir() (tras el «sí»)");
  const ap = fs.readFileSync(path.join(WEB, "aparatos.js"), "utf8");
  assert.ok(ap.indexOf("await mandar(pl.puente") < ap.indexOf('N.registrar("aparato"'), "aparatos: tras la respuesta del puente");
  const ag = fs.readFileSync(path.join(WEB, "agente.js"), "utf8");
  assert.ok(ag.indexOf("creado: d.serverTimestamp()") < ag.indexOf('registrar("recordatorio", `Creé'), "recordatorio: tras guardarlo");
});

// ------------------------------------------------------------------ microfono del PC (Fase 11, oido.js)
{
  const O = require(path.join(WEB, "oido.js")).texto;
  // tramas de 20 ms (320 muestras): ruido suave y una "voz" (tono de 300 Hz)
  const trama = (amp, k) => Int16Array.from({length: 320}, (_, i) => Math.round(amp * Math.sin(2 * Math.PI * 300 * (k * 320 + i) / 16000)));
  prueba("oido: corta una frase entre silencios y no corta mientras suena Píxel", () => {
    const frases = [];
    let suena = false;
    const c = O.cortador((pcm) => frases.push(pcm), () => suena);
    let k = 0;
    for (let i = 0; i < 50; i++) c.trama(trama(60, k++));          // 1 s de fondo: calibra
    for (let i = 0; i < 50; i++) c.trama(trama(3000, k++));        // 1 s de voz
    for (let i = 0; i < 50; i++) c.trama(trama(60, k++));          // 1 s de silencio: cierra
    assert.strictEqual(frases.length, 1);
    const n = frases[0].length / 320;                               // preroll + voz + silencio de cierre
    assert.ok(n >= 50 + 35 && n <= 50 + 35 + 15, "tramas: " + n);
    suena = true;                                                   // Pixel habla: lo que se oye no cuenta
    for (let i = 0; i < 50; i++) c.trama(trama(3000, k++));
    suena = false;
    for (let i = 0; i < 50; i++) c.trama(trama(60, k++));
    assert.strictEqual(frases.length, 1);
    for (let i = 0; i < 5; i++) c.trama(trama(3000, k++));         // un golpe corto (100 ms): no es frase
    for (let i = 0; i < 50; i++) c.trama(trama(60, k++));
    assert.strictEqual(frases.length, 1);
  });
  prueba("oido: remuestreo de 48 kHz a 16 kHz y base64", () => {
    const r = O.remuestreador(48000);
    let total = 0;
    for (let b = 0; b < 10; b++) total += r(Float32Array.from({length: 2048}, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * (b * 2048 + i) / 48000))).length;
    assert.ok(Math.abs(total - 10 * 2048 / 3) <= 2, "muestras: " + total);
    const bytes = new Uint8Array([0, 1, 254, 255, 128]);
    assert.strictEqual(Buffer.from(O.aBase64(bytes), "base64").toString("hex"), "0001feff80");
  });
  prueba("oido: va en la página y deja la escucha del celular al usar el PC", () => {
    const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8"), o = fs.readFileSync(path.join(WEB, "oido.js"), "utf8");
    assert.ok(html.indexOf('<script src="app.js">') < html.indexOf('<script src="oido.js">'), "oido.js después de app.js");
    assert.ok(/id="oido-btn"/.test(html) && /id="oido-nivel"/.test(html));
    assert.ok(/dejarDeEscuchar\(\)/.test(o) && /dejarDeEscuchar: parar/.test(fs.readFileSync(path.join(WEB, "agente.js"), "utf8")));
    const reglas = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "database.rules.json"), "utf8")).rules.pixeles.$pid;
    assert.ok(reglas.frases && reglas.escuchando && reglas.habla, "las reglas de frases, escuchando y habla");
  });
}

// ------------------------------------------------------------------ Ajustes (Fase 14)
if (ctx.PixelAjustes) {
  const J = ctx.PixelAjustes.texto;
  prueba("ajustes: lo que costaría con el plan de pago", () => {
    // precios oficiales: 3.5 Flash-Lite 0,30 / 2,50 y 3.1 Flash-Lite 0,25 / 1,50 US$ por millón (entrada / salida)
    const dia = {m: {"gemini-3_5-flash-lite": {n: 2, e: 1000000, s: 100000}, "gemini-3_1-flash-lite": {n: 1, e: 2000000, s: 1000000}}};
    assert.ok(Math.abs(J.costoDia(dia) - (0.30 + 0.25 + 0.50 + 1.50)) < 1e-9, J.costoDia(dia));
    assert.strictEqual(J.costoDia({}), 0);
    assert.strictEqual(J.dolares(0.0031), "US$ 0,0031");
    assert.strictEqual(J.compacto(12900), "12,9 mil");
    igual(J.ultimosDias("2026-11-01", 3), ["2026-10-30", "2026-10-31", "2026-11-01"]);
    igual(J.porMotivo({"2026-11-01": {por: {charla: 3, aprender: 1}}, "2026-10-31": {por: {charla: 2}}}, ["2026-10-31", "2026-11-01"]), [["charla", 5], ["aprender", 1]]);
  });
  prueba("ajustes: todos los modos de Píxel tienen su interruptor", () => {
    const ids = new Set(ctx.PixelAjustes.MODOS.map((m) => m.id));
    const ag = fs.readFileSync(path.join(WEB, "agente.js"), "utf8");
    const modulos = JSON.parse(/const MODULOS = (\[[^\]]*\])/.exec(ag)[1]).map((f) => f.replace(".js", "")).filter((m) => !["ajustes", "perfil", "contactos", "registro"].includes(m));   // no son modos: siempre van (el registro no se apaga)
    for (const m of modulos) assert.ok(ids.has(m), "falta en Ajustes: " + m);
    for (const m of ctx.PixelAjustes.MODOS) assert.ok(["si", "aveces", "no", "ahorra"].includes(m.gasto) && m.que && m.cuanto, m.id);
  });
}

// ------------------------------------------------------------------ proveedores de IA (Fase 14)
{
  const P = vm.runInContext("Proveedores", ctx), C = vm.runInContext("ProveedorClaude", ctx), X = P.texto;
  const decl = [{functionDeclarations: [{name: "ver_tareas", description: "Ver", parameters: {type: "object", properties: {cuadrante: {type: "string"}}}},
    {name: "escribir_whatsapp", description: "WA", parameters: {type: "object", properties: {para: {type: "string"}, mensaje: {type: "string"}}, required: ["para", "mensaje"]}},
    {name: "modo_enfoque", description: "Enfoque"}]}];
  const historia = [{role: "user", parts: [{text: "escríbele a Ana"}]},
    {role: "model", parts: [{text: "Voy."}, {functionCall: {name: "escribir_whatsapp", args: {para: "Ana", mensaje: "hola"}, id: "c1"}}]},
    {role: "user", parts: [{functionResponse: {name: "escribir_whatsapp", response: {resultado: "ok"}, id: "c1"}}]}];
  prueba("proveedores: OpenAI y compatibles (GPT, OpenRouter, DeepSeek)", () => {
    igual(X.aMensajesOpenAI(historia, "Eres Píxel"), [{role: "system", content: "Eres Píxel"}, {role: "user", content: "escríbele a Ana"},
      {role: "assistant", content: "Voy.", tool_calls: [{id: "c1", type: "function", function: {name: "escribir_whatsapp", arguments: '{"para":"Ana","mensaje":"hola"}'}}]},
      {role: "tool", tool_call_id: "c1", content: '{"resultado":"ok"}'}]);
    const ts = X.aHerramientasOpenAI(decl);
    assert.strictEqual(ts.length, 3);
    igual(ts[2], {type: "function", function: {name: "modo_enfoque", description: "Enfoque", parameters: {type: "object", properties: {}}}});
    const d = decl[0].functionDeclarations;
    assert.ok(X.entradaValida("escribir_whatsapp", {para: "Ana", mensaje: "hola"}, d) && !X.entradaValida("escribir_whatsapp", {para: "Ana"}, d) && !X.entradaValida("otra", {}, d));
    assert.strictEqual(X.extraerJSON('Claro: {"a": 1} listo'), '{"a": 1}');
  });
  prueba("proveedores: la respuesta en vivo de OpenAI, con una herramienta en trozos", async () => {
    const sse = (evs) => new Response(evs.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n");
    const trozos = [];
    for await (const t of X.trozosOpenAI(sse([{choices: [{delta: {content: "Ho"}}]}, {choices: [{delta: {content: "la"}}]},
      {choices: [{delta: {tool_calls: [{index: 0, id: "t9", function: {name: "escribir_whatsapp", arguments: '{"para":"An'}}]}}]},
      {choices: [{delta: {tool_calls: [{index: 0, function: {arguments: 'a","mensaje":"hola"}'}}]}, finish_reason: "tool_calls"}]},
      {choices: [], usage: {prompt_tokens: 900, completion_tokens: 30}}]), decl[0].functionDeclarations)) trozos.push(t);
    const textos = trozos.flatMap((t) => t.candidates[0].content.parts).filter((p) => p.text).map((p) => p.text).join("");
    const final = trozos[trozos.length - 1];
    assert.strictEqual(textos, "Hola");
    igual(final.candidates[0].content.parts, [{functionCall: {name: "escribir_whatsapp", args: {para: "Ana", mensaje: "hola"}, id: "t9"}}]);
    igual(final.usageMetadata, {promptTokenCount: 900, candidatesTokenCount: 30});
    // cortado por el tope: no se ejecuta la herramienta
    const cortados = [];
    for await (const t of X.trozosOpenAI(sse([{choices: [{delta: {tool_calls: [{index: 0, id: "t1", function: {name: "ver_tareas", arguments: "{}"}}]}, finish_reason: "length"}]}]), decl[0].functionDeclarations)) cortados.push(t);
    igual(cortados[cortados.length - 1].candidates[0].content.parts, []);
  });
  prueba("proveedores: Claude (formato de mensajes y herramientas)", () => {
    igual(C.texto.aMensajes(historia), [{role: "user", content: [{type: "text", text: "escríbele a Ana"}]},
      {role: "assistant", content: [{type: "text", text: "Voy."}, {type: "tool_use", id: "c1", name: "escribir_whatsapp", input: {para: "Ana", mensaje: "hola"}}]},
      {role: "user", content: [{type: "tool_result", tool_use_id: "c1", content: '{"resultado":"ok"}'}]}]);
    const hs = C.texto.aHerramientas(decl);
    assert.ok(hs.every((h) => h.eager_input_streaming === true && h.input_schema.type === "object"));
    assert.ok(C.texto.entradaValida({name: "escribir_whatsapp", input: {para: "Ana", mensaje: "hola"}}, hs) && !C.texto.entradaValida({name: "escribir_whatsapp", input: "{}"}, hs));
    igual(C.texto.uso({input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7}), {promptTokenCount: 15, candidatesTokenCount: 7});
  });
  prueba("proveedores: nombres, precios y lo que se apunta", () => {
    assert.strictEqual(P.sanear("moonshotai/kimi-k2.5"), "moonshotai_kimi-k2_5");
    assert.strictEqual(P.claveUso({propio: true, modelo: "claude-haiku-5-5"}), "propia:claude-haiku-5-5");
    assert.strictEqual(P.nombreModelo("propia:claude-opus-5-5"), "Claude Opus 5.5 · tu clave");
    igual(P.precioDe("propia:claude-haiku-5-5"), {e: 0.10, s: 0.50});
    igual(P.precioDe("gemini-3_5-flash-lite"), {e: 0.30, s: 2.50});
    assert.strictEqual(P.precioDe("propia:modelo-raro"), null);
    assert.ok(P.claveValida("claude", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz") && P.claveValida("openai", "sk-proj-1234567890abcdef"));
    // 12 nov: una clave de Google que no empieza por AIza tambien se acepta (la prueba el servicio); rotas, no
    assert.ok(P.claveValida("gemini", "AQ.Ab8RN6" + "k".repeat(40)) && P.claveValida("gemini", "AIzaSy" + "x".repeat(33)));
    assert.ok(!P.claveValida("gemini", "AIza Sy" + "x".repeat(33)) && !P.claveValida("gemini", "corta") && !P.claveValida("gemini", ""));
    igual(P.actual(), {proveedor: "", modelo: "", clave: "", base: "", propio: false});   // sin nada guardado: ninguno (11 nov: no hay IA incluida)
    // el panel: lo de la clave propia se cuenta aparte de lo gratis
    const J = ctx.PixelAjustes.texto, dia = {m: {"propia:claude-haiku-5-5": {n: 2, e: 1000000, s: 1000000}, "gemini-3_5-flash-lite": {n: 1, e: 1000000, s: 0}}};
    assert.ok(Math.abs(J.costoDia(dia, "propia") - 0.60) < 1e-9 && Math.abs(J.costoDia(dia, "gratis") - 0.30) < 1e-9);
    igual(J.porModelo({d1: dia}, ["d1"]).map(([k, x]) => [k, x.n]), [["propia:claude-haiku-5-5", 2], ["gemini-3_5-flash-lite", 1]]);
  });
  // 11 nov: "cada persona paga Gemini o el proveedor que quiera": no hay IA incluida, y la clave es de cada cuenta
  prueba("IA: no hay Gemini incluido (sin Firebase AI ni proveedor gratis)", () => {
    assert.ok(!("pixel" in P.LISTA), "el proveedor gratis sigue en la lista");
    const ag = fs.readFileSync(path.join(WEB, "agente.js"), "utf8");
    assert.ok(!/firebase-ai\.js|getGenerativeModel|getAI\(/.test(ag), "agente.js todavía carga Firebase AI");
    assert.ok(ctx.Agente.nucleo.hayIA() === false, "sin clave, hayIA debe ser falso");
    const aj = fs.readFileSync(path.join(WEB, "ajustes.js"), "utf8");
    assert.ok(!/Gemini gratis|Píxel gratis|"pixel"/.test(aj), "ajustes.js habla del Gemini gratis");
  });
  prueba("IA: la clave se guarda por cuenta (dos cuentas en el mismo navegador no la comparten)", () => {
    const antes = {ls: ctx.localStorage, uid: ctx.nube.uid}, mem = {};
    ctx.localStorage = {getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; }};
    try {
      ctx.nube.uid = "";
      assert.strictEqual(P.guardar({proveedor: "gemini", claves: {gemini: "AIza" + "x".repeat(30)}, modelos: {}}), false, "sin sesión no se guarda");
      ctx.nube.uid = "cuenta-1";
      assert.ok(P.guardar({proveedor: "gemini", claves: {gemini: "AIza" + "x".repeat(30)}, modelos: {gemini: "gemini-3.5-flash-lite"}}));
      igual(Object.keys(mem), ["pixel.ia:cuenta-1"]);
      assert.ok(P.actual().propio && P.actual().proveedor === "gemini");
      ctx.nube.uid = "cuenta-2";
      assert.strictEqual(P.actual().propio, false, "la otra cuenta ve la clave de la primera");
    } finally {
      ctx.localStorage = antes.ls;
      ctx.nube.uid = antes.uid;
    }
  });
}

// ------------------------------------------------------------------ 11 nov: el lobby es la entrada
prueba("lobby: mismo proyecto de Firebase que la app, y la app solo manda al lobby sin sesión real", () => {
  const app = fs.readFileSync(path.join(WEB, "app.js"), "utf8"), lobby = fs.readFileSync(path.join(WEB, "lobby.html"), "utf8");
  for (const campo of ["apiKey", "authDomain", "databaseURL", "projectId", "appId"]) {
    const re = new RegExp(campo + ':\\s*"([^"]+)"');
    const a = re.exec(app), l = re.exec(lobby);
    assert.ok(a && l && a[1] === l[1], `${campo} distinto entre app.js y lobby.html`);
  }
  assert.ok(/if \(entrada && !PRUEBA_ANONIMA\) \{ location\.replace\("lobby\.html"/.test(app), "app.js no manda al lobby, o también en las pruebas anónimas");
  assert.ok(!/onAuthStateChanged[^\n]*location\.(replace|href)/.test(lobby), "el lobby reenvía solo a la app: puede haber vueltas sin fin");
  assert.ok(/signInWithPopup/.test(lobby) && /select_account/.test(lobby), "el lobby no entra con Google o no deja elegir la cuenta");
});

// 11 nov (pedido): quien visita el lobby no debe saber con qué tecnología está hecho Píxel
prueba("lobby: el texto visible no nombra la tecnología por dentro, y el video existe", () => {
  const lobby = fs.readFileSync(path.join(WEB, "lobby.html"), "utf8");
  const visible = lobby.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
  const tecnicas = /esp ?32|wake-on-lan|markdown|tokens?\b|rel[eé]s?\b|infrarroj|sha-?256|firebase|python|whisper|ollama|supertonic|piper|nuitka|servidor|\bapi\b|\bhttp\b/i;
  const m = tecnicas.exec(visible);
  assert.ok(!m, "el lobby dice «" + (m && m[0]) + "»");
  for (const f of ["medios/pixel.mp4", "medios/pixel.jpg"]) {
    assert.ok(lobby.includes(f) && fs.existsSync(path.join(WEB, f)), "falta " + f);
  }
  assert.ok(fs.statSync(path.join(WEB, "medios/pixel.mp4")).size < 2e6, "el video pesa más de 2 MB: el plan gratis de Hosting da ~360 MB al día");
  assert.ok(/\(esp \?32\|esp\|puente\|puentes\|robot\|/.test(fs.readFileSync(path.join(WEB, "aparatos.js"), "utf8")), "«prueba el robot» (frase del lobby) no se entiende");
});

// ------------------------------------------------------------------ cerebro: el mapa (Fase 14)
if (ctx.Cerebro && ctx.Cerebro.texto.enlaces) {
  const C = ctx.Cerebro.texto;
  // las mismas notas que la prueba 8 de prueba_obsidian.py: los dos lados deben dar los mismos enlaces
  const EJEMPLO = [{id: "a", titulo: "Ana", texto: "Mi hermana; estudia medicina.", tipo: "persona"},
    {id: "f", titulo: "Feria de ciencias", texto: "Proyecto Píxel con Ana para la feria.", tipo: "proyecto"},
    {id: "m", titulo: "Música", texto: "Le gusta Queen.", tipo: "gusto"},
    {id: "e", titulo: "Estudio", texto: "Estudia con MÚSICA de fondo. Ver [[Feria de ciencias]].", tipo: "yo"}];
  prueba("mapa: enlaces como obsidian.py", () => {
    igual(C.enlaces(EJEMPLO), [[1, 0], [3, 1], [3, 2]]);
  });
  prueba("mapa: Tú, carpetas, notas y conexiones", () => {
    const g = C.grafo(EJEMPLO);
    assert.strictEqual(g.nodos.filter((n) => n.clase === "centro").length, 1);
    assert.strictEqual(g.nodos.filter((n) => n.clase === "grupo").length, 4);
    assert.strictEqual(g.aristas.filter((a) => a[2] === "grupo").length, 4);
    assert.strictEqual(g.aristas.filter((a) => a[2] === "tipo").length, 4);
    igual(g.aristas.filter((a) => a[2] === "mencion").map((a) => a.slice(0, 2)), [["f", "a"], ["e", "f"], ["e", "m"]]);
  });
}

// ------------------------------------------------------------------ 2.0.0: la voz de Mexico (voz.js)
{
  const V = vm.runInContext("VozPixel", ctx);      // const de arriba: no queda en window
  prueba("voz: Supertonic 3, 10 voces, la F4 por defecto; las de Piper de antes pasan a ella", () => {
    assert.strictEqual(V.VOCES.length, 10);
    assert.strictEqual(V.DEFECTO, "st-F4");
    assert.strictEqual(V.de("st-F4").estilo, "F4");
    assert.strictEqual(V.de("mx-mujer").id, "st-F4");
    assert.strictEqual(V.de("celular"), null);
  });
  prueba("voz: los números, horas, precios y símbolos se leen en palabras", () => {
    const L = V.texto.leer;
    assert.strictEqual(L("Mañana a las 3 de la tarde, el 10 de noviembre de 2026."), "Mañana a las tres de la tarde, el diez de noviembre de dos mil veintiséis.");
    assert.strictEqual(L("Tienes 25 % de batería y hacen 21 °C."), "Tienes veinticinco por ciento de batería y hacen veintiún grados.");
    assert.strictEqual(L("La reunión es a las 15:30 con 1 persona."), "La reunión es a las quince y treinta con una persona.");
    assert.strictEqual(L("Cuesta $ 45.000, o 3,5 dólares."), "Cuesta cuarenta y cinco mil pesos, o tres coma cinco dólares.");
    assert.strictEqual(V.texto.enLetras(2500000), "dos millones quinientos mil");
    assert.strictEqual(V.texto.enLetras(115), "ciento quince");
    assert.strictEqual(L("Hola, ¿qué tal?"), "Hola, ¿qué tal?");
  });
  prueba("voz: más pasos si sobra tiempo, menos si va justa, y «lenta» si ni así alcanza", () => {
    const A = V.texto.ajustarPasos;
    assert.strictEqual(A({pasos: 5, lentas: 0}, 0.2).pasos, 6);
    assert.strictEqual(A({pasos: 5, lentas: 0}, 0.8).pasos, 4);
    assert.strictEqual(A({pasos: 8, lentas: 0}, 0.1).pasos, 8);
    assert.ok(!A({pasos: 4, lentas: 1}, 1.5).lenta && A({pasos: 4, lentas: 2}, 1.5).lenta);
    assert.strictEqual(A({pasos: 4, lentas: 2}, 0.9).lentas, 0);
  });
  prueba("voz: la boca sigue el volumen (0 a 1)", () => {
    const sr = 1000, pcm = new Float32Array(400);
    for (let i = 100; i < 200; i++) pcm[i] = Math.sin(i) * 0.5;      // silencio, voz, silencio
    const e = V.texto.envolvente(pcm, sr, 0.1);
    assert.strictEqual(e.length, 4);
    assert.ok(e[1] === 1 && e[0] === 0 && e[3] === 0);
    assert.strictEqual(V.texto.agudo("infantil"), 1.32);
    assert.strictEqual(V.texto.agudo("raro"), 1);
  });
}

// ------------------------------------------------------------------ 2.0.0: Mi perfil (perfil.js)
if (ctx.PixelPerfil) {
  const P = ctx.PixelPerfil.texto;
  const PERFIL = {nombre: "Diego Castelblanco", apodo: "Dieguito", trato: "usted", sobre: "Estudio ingeniería en Bogotá.",
    gustos: "La salsa y la robótica.", ayuda: "Organizar la feria.", reglas: "Explícame con ejemplos."};
  prueba("perfil: la plantilla .md va y vuelve sin la IA", () => {
    const r = P.leerMarkdown(P.aMarkdown(PERFIL));
    assert.strictEqual(r.reconocidos, 7);
    igual(r.campos, PERFIL);
  });
  prueba("perfil: .md con títulos parecidos, listas y apartados extra", () => {
    const r = P.leerMarkdown("---\nautor: yo\n---\n# Yo\n## Nombre\nAna\n## Trato\nDe usted, por favor\n## Hobbies\n- cine\n- **lectura**\n## Mascotas\nUn gato\n");
    igual(r.campos, {nombre: "Ana", trato: "usted", gustos: "cine\nlectura", sobre: "Mascotas: Un gato"});
  });
  prueba("perfil: un .md escrito a su manera lo lee la IA", () => {
    const r = P.leerMarkdown("Hola, me llamo Ana y me gusta el cine.\n\n## Mi gato\nSe llama Tom.");
    assert.strictEqual(r.reconocidos, 0);
    assert.ok(r.sobrante.includes("me llamo Ana"));
  });
  prueba("perfil: lo que entra en las instrucciones, sin pronombres", () => {
    const t = P.paraPrompt(PERFIL, false);
    assert.ok(t.includes("«Dieguito»") && t.includes("Háblale de usted") && t.includes("robótica") && t.includes("nunca la seguridad"));
    assert.ok(!/\b(él|ella|lo trates|la trates)\b/i.test(t), t);
    assert.ok(P.paraPrompt(Object.assign({}, PERFIL, {sobre: "x".repeat(600)}), true).length < P.paraPrompt(Object.assign({}, PERFIL, {sobre: "x".repeat(600)}), false).length);
    assert.strictEqual(P.paraPrompt(null), "");
  });
  prueba("perfil: la presentación (Divergencia IA, la API del modelo, el perfil)", () => {
    const t = P.presentacion("Diego", false);
    assert.ok(t.startsWith("¡Hola, Diego!") && t.includes("creado por Divergencia IA") && t.includes("híbrido") && t.includes("Markdown") && t.includes("Te invito"));
    assert.ok(P.presentacion("", true).startsWith("¡Hola! ") && P.presentacion("", true).includes("Lo invito"));
    assert.strictEqual(P.nombreCorto({nombre: "Diego Castelblanco"}), "Diego");
    assert.strictEqual(P.nombreCorto({nombre: "Diego Castelblanco", apodo: "Dieguito"}), "Dieguito");
    assert.strictEqual(P.iniciales("diego castelblanco"), "DC");
  });
  prueba("perfil: agente.md tiene el lugar del perfil", () => {
    const md = fs.readFileSync(path.join(WEB, "agente.md"), "utf8");
    assert.ok(md.includes("{{PERFIL}}") && md.includes("Divergencia IA"));
  });
}

// ------------------------------------------------------------------ 2.0.0: Contactos (contactos.js)
if (ctx.PixelContactos) {
  const C = ctx.PixelContactos.texto;
  prueba("contactos: celular con indicativo y correo limpio", () => {
    igual(C.limpio({nombre: "  Ana   Gómez ", telefono: "300 123 4567", correo: "Ana.Gomez@Gmail.com "}), {nombre: "Ana Gómez", telefono: "573001234567", correo: "ana.gomez@gmail.com"});
    assert.strictEqual(C.telefono("+34 612 34 56 78"), "34612345678");
    assert.strictEqual(C.telefono("123"), "");
    assert.strictEqual(C.formato("573001234567"), "+57 300 123 4567");
  });
  prueba("contactos: buscar por nombre (sin tildes, «a Ana», solo con lo que hace falta)", () => {
    const l = [{nombre: "Ana Gómez", telefono: "573001234567", correo: ""}, {nombre: "Andrés", telefono: "", correo: "andres@x.co"}, {nombre: "Laura", telefono: "573009999999", correo: "laura@x.co"}];
    assert.strictEqual(C.buscar(l, "a ana", "telefono").nombre, "Ana Gómez");
    assert.strictEqual(C.buscar(l, "andres", "correo").nombre, "Andrés");
    assert.strictEqual(C.buscar(l, "andres", "telefono"), null);
    assert.strictEqual(C.buscar(l, "pedro"), null);
  });
  prueba("contactos: las personas de la memoria con número o correo se pasan una vez", () => {
    const notas = [{tipo: "persona", titulo: "Ana", texto: "Mi hermana. WhatsApp: +57 300 123 4567"},
      {tipo: "persona", titulo: "Correo de Pedro", texto: "pedro@gmail.com"}, {tipo: "persona", titulo: "Laura", texto: "Sin datos"},
      {tipo: "gusto", titulo: "Música", texto: "300 123 4567"}];
    igual(C.desdeNotas(notas, []), [{nombre: "Ana", telefono: "573001234567", correo: ""}, {nombre: "Pedro", telefono: "", correo: "pedro@gmail.com"}]);
    assert.strictEqual(C.desdeNotas(notas, [{nombre: "ana"}]).length, 1);
  });
}

// ------------------------------------------------------------------ 2.1: confirmaciones y destinatarios
// Lo que paso con el correo (11 nov): "manda" en cualquier frase enviaba el borrador pendiente,
// el destinatario se adivinaba del historial de Gmail, y el cuerpo salia con \n escritos.
{
  const gsrc = fs.readFileSync(path.join(WEB, "google.js"), "utf8");
  const reEnviar = new RegExp(/const RE_ENVIAR = (\/.*\/);/.exec(gsrc)[1].slice(1, -1));
  const reCrear = new RegExp(/const RE_CREAR = (\/.*\/);/.exec(gsrc)[1].slice(1, -1));
  prueba("confirmar envio: solo sí, envíalo, mándalo (no una frase cualquiera)", () => {
    for (const t of ["si", "si envialo", "envialo", "mandalo ya", "si, envialo.", "si mandalo por favor"]) assert.ok(reEnviar.test(t), "debe confirmar: " + t);
    for (const t of ["", " ", "manda un correo a ana diciendo hola", "envia otro", "no lo envies", "pero cambia el asunto", "mandame el pdf"]) assert.ok(!reEnviar.test(t), "NO debe confirmar: " + t);
  });
  prueba("confirmar agendar: solo sí o agéndalo", () => {
    assert.ok(reCrear.test("si") && reCrear.test("agendalo") && reCrear.test("si, ya"));
    assert.ok(!reCrear.test("") && !reCrear.test("crea otro evento") && !reCrear.test("si pero a las 5"));
  });
  prueba("crear evento: no llama a Calendar hasta confirmar", () => {
    const i = gsrc.indexOf("async function crearEvento"), fin = gsrc.indexOf("\n  }\n", i);
    const cuerpo = gsrc.slice(i, fin);
    const antes = cuerpo.slice(0, cuerpo.indexOf("N.confirmar("));
    assert.ok(!/api\(CAL/.test(antes), "Calendar se llama antes de pedir confirmación");
    assert.ok(/hacer: async \(\) => \{\s*await api\(CAL, \{method: "POST"/.test(cuerpo), "la llamada POST va dentro de hacer");
  });
  prueba("correo: el cuerpo con \\n escritos sale con saltos de línea reales", () => {
    const raw = Buffer.from(ctx.PixelGoogle.texto.armarMime({para: "a@b.co", asunto: "Hola", cuerpo: "Estimado profe,\\n\\nGracias.\\nDiego"}).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const cuerpoB64 = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    const texto = Buffer.from(cuerpoB64, "base64").toString("utf8");
    assert.strictEqual(texto, "Estimado profe,\r\n\r\nGracias.\r\nDiego");
  });
  prueba("contactos: candidatos y espera (sin Gmail para adivinar)", () => {
    const PC = ctx.PixelContactos;
    assert.ok(PC.candidatos && PC.esperar, "exporta candidatos y esperar");
    const fuente = fs.readFileSync(path.join(WEB, "google.js"), "utf8");
    const persona = fuente.slice(fuente.indexOf("async function correoDePersona"), fuente.indexOf("\n  }\n", fuente.indexOf("async function correoDePersona")));
    assert.ok(!/messages\?/.test(persona), "correoDePersona no busca en el historial de Gmail");
    assert.ok(/await PC\.esperar\(\)/.test(persona), "espera a la lista de contactos");
  });
}

// ------------------------------------------------------------------ 2.2.0 (12 nov): Groq y la ventana del programa
{
  const P = vm.runInContext("Proveedores", ctx);
  prueba("proveedores: Groq, con su clave gsk_ y su dirección compatible con OpenAI", () => {
    const g = P.LISTA.groq;
    assert.ok(g && g.compatible && g.base === "https://api.groq.com/openai/v1");
    assert.ok(P.claveValida("groq", "gsk_" + "a".repeat(40)) && !P.claveValida("groq", "gsk_ con espacios " + "a".repeat(20)));
  });
  prueba("proveedores: sin clave propia, Píxel usa la IA del programa del PC (la preferida del PC primero)", () => {
    P.ponerDelPc({pc: "PC de prueba", preferida: "groq", gemini: {clave: "g".repeat(39), modelo: "gemini-3.5-flash-lite"},
      groq: {clave: "q".repeat(50), modelo: "openai/gpt-oss-120b"}});
    let a = P.actual();
    assert.ok(a.propio && a.proveedor === "groq" && a.modelo === "openai/gpt-oss-120b" && a.base === "https://api.groq.com/openai/v1" && a.delPc === "PC de prueba");
    P.ponerDelPc({pc: "PC de prueba", preferida: "gemini", gemini: {clave: "g".repeat(39), modelo: "gemini-3.5-flash-lite"}});
    a = P.actual();
    assert.ok(a.proveedor === "gemini" && a.clave === "g".repeat(39));
    igual(P.pcTiene().map((x) => x.id), ["gemini"]);
    P.ponerDelPc(null);
    assert.ok(!P.actual().propio && P.pcTiene().length === 0);
  });
  const RAIZ = path.join(__dirname, "..");
  const esc = fs.readFileSync(path.join(WEB, "escritorio.js"), "utf8");
  const html = fs.readFileSync(path.join(WEB, "escritorio.html"), "utf8");
  prueba("ventana: saluda con lo que pidió el usuario", () => {
    const frases = [...esc.slice(esc.indexOf("const FRASES"), esc.indexOf("];", esc.indexOf("const FRASES"))).matchAll(/t: "([^"]*)"/g)].map((m) => m[1]).join(" ");
    assert.strictEqual(frases.replace(/ +/g, " "), "Hola, soy Píxel, un agente creado por Divergency IA . Bienvenido al panel de control. Aquí puedes vincular tus dispositivos y guardar tus APIs.");
  });
  prueba("ventana: cada botón llama a una ruta que el programa tiene", () => {
    const fuente = ["panel.py", "nube.py", path.join("instalador", "pixel_lanzador.py")].map((f) => fs.readFileSync(path.join(RAIZ, f), "utf8")).join("\n");
    const rutas = new Set([...esc.matchAll(/enviar\("(\/api\/[a-z/]+)"/g)].map((m) => m[1]));
    for (const api of ["gemini", "groq"]) for (const r of ["clave", "probar"]) rutas.add(`/api/${api}/${r}`);
    assert.ok(rutas.size >= 12, "rutas: " + [...rutas].join(", "));
    for (const r of rutas) assert.ok(fuente.includes(`"${r}"`), "el programa no tiene " + r);
  });
  prueba("ventana: solo habla con este PC (nada de internet salvo los enlaces que abre el usuario)", () => {
    assert.ok(!/fetch\(\s*["'`]https?:/.test(esc), "escritorio.js llama a internet");
    assert.ok(!/<script[^>]+src=["']https?:/.test(html) && !/<link[^>]+href=["']https?:/.test(html), "escritorio.html carga algo de internet");
    for (const m of html.matchAll(/<a [^>]*href="https:[^"]*"[^>]*>/g)) assert.ok(/target="_blank"/.test(m[0]) && /rel="noopener"/.test(m[0]), m[0]);
  });
}

// ------------------------------------------------------------------ 2.4.0: el espejo entre el PC y la app (espejo.js)
{
  const E = require(path.join(WEB, "espejo.js"));
  const VW = ["st-F1", "st-F4", "st-M1"], VP = VW.concat(["claude"]);
  const aj = (o) => Object.assign({personalidad: "", respuesta: "normal", voz: "st-F4", tono: "normal"}, o);
  prueba("espejo: ajustes iguales no hacen nada (aunque la hora sea distinta)", () => {
    igual(E.decidirAjustes(aj({t: 5}), aj({voz: "", t: 9}), VW, VP, 100), {web: null, pc: null});
  });
  prueba("espejo: el cambio del PC (mas nuevo) va a la app con la hora del PC", () => {
    igual(E.decidirAjustes(aj({personalidad: "Seria", t: 50}), aj({t: 10}), VW, VP, 100),
      {web: {personalidad: "Seria", respuesta: "normal", voz: "st-F4", tono: "normal", t: 50}, pc: null});
  });
  prueba("espejo: el cambio de la app (mas nuevo) va al PC con la hora de la app", () => {
    igual(E.decidirAjustes(aj({t: 10}), aj({tono: "infantil", respuesta: "corta", t: 60}), VW, VP, 100),
      {web: null, pc: {personalidad: "", respuesta: "corta", voz: "st-F4", tono: "infantil", t: 60}});
  });
  prueba("espejo: una voz que la app no tiene no se copia (se queda la suya)", () => {
    const r = E.decidirAjustes(aj({voz: "claude", t: 50}), aj({voz: "st-M1", t: 10}), VW, VP, 100);
    igual(r, {web: null, pc: null});
    const r2 = E.decidirAjustes(aj({voz: "claude", personalidad: "X", t: 50}), aj({voz: "st-M1", t: 10}), VW, VP, 100);
    assert.strictEqual(r2.web.voz, "st-M1");
  });
  prueba("espejo: sin horas (antes de la 2.4.0) se juntan: lo del PC que no es de fabrica, si no lo de la app", () => {
    const r = E.decidirAjustes(aj({personalidad: "Amable"}), aj({respuesta: "corta", tono: "infantil"}), VW, VP, 100);
    const m = {personalidad: "Amable", respuesta: "corta", voz: "st-F4", tono: "infantil", t: 100};
    igual(r, {web: m, pc: m});
  });
  const cfg = (o) => Object.assign({proveedor: "gemini", claves: {}, modelos: {}, bases: {}, precios: {}, t: {}}, o);
  const MG = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
  prueba("espejo: la clave nueva del PC llega a la app (con su modelo de Groq)", () => {
    const r = E.decidirIa({groq: {clave: "gsk_PC_0123456789abcdef", modelo: "llama-x", t: 70}}, cfg({}), 100, MG);
    assert.strictEqual(r.cfg.claves.groq, "gsk_PC_0123456789abcdef");
    assert.strictEqual(r.cfg.modelos.groq, "llama-x");
    assert.strictEqual(r.cfg.t.groq, 70);
    igual(r.ordenes, []);
  });
  prueba("espejo: la clave nueva de la app va al PC; una quitada aqui se quita alla", () => {
    const r = E.decidirIa({gemini: {clave: "VIEJA-0123456789abcd", t: 10}}, cfg({claves: {gemini: "NUEVA-0123456789abcd"}, t: {gemini: 80}}), 100, MG);
    assert.strictEqual(r.cfg, null);
    igual(r.ordenes, [{ruta: "/api/gemini/clave", cuerpo: {clave: "NUEVA-0123456789abcd", t: 80}}]);
    const q = E.decidirIa({gemini: {clave: "VIEJA-0123456789abcd", t: 10}}, cfg({t: {gemini: 90}}), 100, MG);
    igual(q.ordenes, [{ruta: "/api/gemini/clave", cuerpo: {clave: "", t: 90}}]);
  });
  prueba("espejo: la clave quitada en el PC (mas nuevo) se quita en la app", () => {
    const r = E.decidirIa({gemini: {clave: "", t: 95}}, cfg({claves: {gemini: "K-0123456789abcdefg"}, t: {gemini: 20}}), 100, MG);
    assert.ok(!r.cfg.claves.gemini && r.cfg.t.gemini === 95);
  });
  prueba("espejo: sin horas, manda la clave del PC; si el PC no tiene, la de la app va al PC", () => {
    const r = E.decidirIa({gemini: {clave: "PC-0123456789abcdefg", modelo: "gemini-3.5-flash-lite", t: 0}, groq: {clave: "", t: 0}},
      cfg({claves: {gemini: "WEB-0123456789abcdefg", groq: "gsk_WEB_0123456789ab"}}), 500, MG);
    assert.strictEqual(r.cfg.claves.gemini, "PC-0123456789abcdefg");
    igual(r.ordenes, [{ruta: "/api/groq/clave", cuerpo: {clave: "gsk_WEB_0123456789ab", t: 500}}]);
    assert.strictEqual(r.cfg.t.groq, 500);
  });
  prueba("espejo: la IA preferida va y viene; si aqui se usa Claude, un empate no la cambia", () => {
    const pc = {preferida: "groq", preferida_t: 60, gemini: {clave: "G-0123456789abcdefgh", t: 1}, groq: {clave: "Q-0123456789abcdefgh", modelo: "m", t: 1}};
    const base = {claves: {gemini: "G-0123456789abcdefgh", groq: "Q-0123456789abcdefgh"}, modelos: {groq: "m"}, t: {gemini: 1, groq: 1}};
    assert.strictEqual(E.decidirIa(pc, cfg(Object.assign({}, base, {t: {gemini: 1, groq: 1, proveedor: 10}})), 100, MG).cfg.proveedor, "groq");
    igual(E.decidirIa(pc, cfg(Object.assign({}, base, {t: {gemini: 1, groq: 1, proveedor: 99}})), 100, MG).ordenes, [{ruta: "/api/ia", cuerpo: {ia: "gemini", t: 99}}]);
    const claude = cfg(Object.assign({}, base, {proveedor: "claude", claves: Object.assign({claude: "sk-ant-0123456789abc"}, base.claves)}));
    assert.strictEqual(E.decidirIa(Object.assign({}, pc, {preferida_t: 0}), claude, 100, MG).cfg, null);
  });
  prueba("espejo: el perfil va de la app al PC; el de otra cuenta mas nuevo no se pisa", () => {
    const tx = "- Su nombre: Ana Prueba.";
    igual(E.decidirPerfil({texto: "", t: 0}, {actualizado: 40}, tx, "Ana", 100), {ruta: "/api/perfil", cuerpo: {texto: tx, t: 40, de: "Ana"}});
    assert.strictEqual(E.decidirPerfil({texto: tx, t: 40}, {actualizado: 90}, tx, "Ana", 100), null);          // ya esta
    igual(E.decidirPerfil({texto: "- Otro.", t: 40}, {actualizado: 90}, tx, "Ana", 100).cuerpo.t, 90);        // el mio es mas nuevo
    assert.strictEqual(E.decidirPerfil({texto: "- Otro.", t: 95}, {actualizado: 90}, tx, "Ana", 100), null);   // el del PC, mas nuevo
    assert.strictEqual(E.decidirPerfil({texto: "", t: 0}, {}, "", "Ana", 100), null);                         // sin perfil escrito
    igual(E.decidirPerfil(null, {}, tx, "", 100).cuerpo.t, 100);                                             // sin hora: la de ahora
  });
  prueba("espejo: index.html carga espejo.js antes de app.js", () => {
    const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
    assert.ok(html.indexOf('src="espejo.js"') > 0 && html.indexOf('src="espejo.js"') < html.indexOf('src="app.js"'));
  });
}

Promise.all(esperando).then(() => {
  console.log(fallos ? `${fallos} fallo(s), ${hechas} bien` : `todo bien (${hechas} pruebas)`);
  process.exit(fallos ? 1 : 0);
});
