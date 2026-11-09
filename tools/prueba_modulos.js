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
for (const f of ["agente.js", "cerebro.js", "google.js", "tiempo.js", "aparatos.js", "musica.js", "humor.js", "apuntes.js"]) {
  const ruta = path.join(WEB, f);
  if (fs.existsSync(ruta)) vm.runInContext(fs.readFileSync(ruta, "utf8"), ctx, {filename: f});
}

let fallos = 0, hechas = 0;
// los objetos del contexto falso tienen otro Object: se comparan pasando por JSON
const igual = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
function prueba(nombre, f) {
  try { f(); hechas++; } catch (e) { fallos++; console.log("FALLA", nombre, "\n ", e.message); }
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

console.log(fallos ? `${fallos} fallo(s), ${hechas} bien` : `todo bien (${hechas} pruebas)`);
process.exit(fallos ? 1 : 0);
