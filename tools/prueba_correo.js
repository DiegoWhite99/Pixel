"use strict";
// 11 nov - Chrome sin pantalla: el correo y los eventos solo con confirmacion, y destinatarios solo de Contactos.
// Gmail, Calendar y Gemini SIMULADOS: no se envia ni se crea nada real. Los contactos de la prueba
// (nombres de ejemplo) se guardan en una cuenta anonima de prueba, nunca en la del usuario.
//   python3 -m http.server 8099 -d web &
//   PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_correo.js
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const manana = (() => { const d = new Date(); d.setDate(d.getDate() + 1); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00:00`; })();

const cola = [];                 // respuestas de Gemini, en orden (una por turno)
const llamadas = [];             // lo que la app le pide a Google
let borradores = 0, eventos = 0;
const fallos = [];
const ok = (cond, texto) => { console.log((cond ? "BIEN " : "FALLO ") + texto); if (!cond) fallos.push(texto); };

async function mockear(p) {
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = r.url(), m = r.method();
    if (/huggingface|hf\.co|jsdelivr/.test(u)) return r.abort();          // sin bajar 398 MB de voz
    if (u.startsWith("http://localhost")) return r.continue();
    const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS"};
    if (m === "OPTIONS") return r.respond({status: 204, headers: cors, body: ""});
    const json = (obj) => r.respond({status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(obj)});
    if (/generativelanguage|firebasevertexai|firebaseml/.test(u)) {
      const turno = cola.length ? cola.shift() : {texto: "Listo."};
      const parte = turno.fn ? {functionCall: {name: turno.fn, args: turno.args}} : {text: turno.texto};
      const cuerpo = {candidates: [{content: {role: "model", parts: [parte]}, finishReason: "STOP"}]};
      llamadas.push({gemini: turno.fn || "texto"});
      const sse = u.includes("streamGenerateContent");
      return r.respond({status: 200, headers: cors, contentType: sse ? "text/event-stream" : "application/json",
        body: sse ? "data: " + JSON.stringify(cuerpo) + "\n\n" : JSON.stringify(cuerpo)});
    }
    if (u.includes("tokeninfo")) return json({scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify", expires_in: "3000", email: "prueba@example.com"});
    if (/gmail\.googleapis\.com|googleapis\.com\/calendar|googleapis\.com\/oauth2/.test(u)) {
      llamadas.push({google: m + " " + u.replace(/\?.*$/, "").replace(/^https:\/\/[^/]+/, "")});
      if (m === "POST" && /gmail.*\/drafts$/.test(u.replace(/\?.*$/, ""))) { borradores++; return json({id: "d" + borradores, message: {id: "m" + borradores}}); }
      if (m === "POST" && /drafts\/send/.test(u)) return json({id: "m1", threadId: "t1"});
      if (m === "POST" && /calendar\/v3\/calendars\/primary\/events/.test(u)) { eventos++; return json({id: "e" + eventos}); }
      if (m === "GET" && /messages\?/.test(u)) return json({messages: []});
      return json({});
    }
    r.continue();
  });
}

(async () => {
  const b = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]});
  const p = await b.newPage();
  await mockear(p);
  await p.goto("http://localhost:8099/?nube=anonimo", {waitUntil: "load", timeout: 60000});
  await esperar(9000);
  // Cuenta de Google falsa (la anonima no puede tener Gmail real) y dos Oscar en Contactos
  await p.evaluate((alc) => {
    localStorage.setItem("pixel.google", JSON.stringify({uid: nube.uid, token: "token-falso", vence: Date.now() + 3600000, alcances: alc, email: "prueba@example.com"}));
    localStorage.setItem("pixel.ia:" + nube.uid, JSON.stringify({proveedor: "gemini", claves: {gemini: "AIzaPruebaFalsaNoReal0123456789ab"}, modelos: {gemini: "gemini-3.5-flash-lite"}}));
  }, "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify");
  await p.reload({waitUntil: "load"});
  await esperar(9000);
  await p.evaluate(async () => {
    await PixelContactos.guardar({nombre: "Óscar Mauricio", correo: "om@example.com"});
    await PixelContactos.guardar({nombre: "Ana Gómez", correo: "ana@example.com"});
    await PixelContactos.esperar();
  });
  await esperar(1500);

  const decir = async (texto) => {
    await p.evaluate((t) => { const i = document.getElementById("ag-texto"); i.value = t; document.getElementById("ag-escribir").dispatchEvent(new Event("submit", {cancelable: true, bubbles: true})); }, texto);
    await esperar(7000);
  };
  const estado = () => p.evaluate(() => ({pendiente: Agente.nucleo.est.pendiente ? {pregunta: Agente.nucleo.est.pendiente.pregunta, detalle: Agente.nucleo.est.pendiente.detalle} : null}));

  // ---- 1. destinatario de Contactos: borrador, sin enviar
  cola.push({fn: "redactar_correo", args: {para: "Óscar Mauricio", asunto: "Saludo", cuerpo: "Hola\\n\\nQué tal"}});
  await decir("escríbele un correo a Óscar Mauricio que diga hola");
  let e = await estado();
  ok(borradores === 1, "1 borrador creado");
  ok(!llamadas.some((l) => /drafts\/send/.test(l.google || "")), "1: no se envió nada");
  ok(e.pendiente && /om@example\.com/.test(e.pendiente.detalle), "1: la confirmación muestra el correo de Óscar Mauricio de Contactos");
  ok(!llamadas.some((l) => /messages\?/.test(l.google || "")), "1: no buscó destinatario en el historial de Gmail");

  // ---- 2. un pedido nuevo con "manda" NO envía el borrador
  cola.push({texto: "Vale."});
  await decir("manda un correo a Ana diciendo hola");
  ok(!llamadas.some((l) => /drafts\/send/.test(l.google || "")), "2: \"manda un correo a Ana\" no envió el borrador viejo");

  // ---- 3. "sí" envía una sola vez
  await decir("sí");
  const envios = llamadas.filter((l) => /drafts\/send/.test(l.google || "")).length;
  ok(envios === 1, "3: con \"sí\" se envía exactamente una vez (hubo " + envios + ")");

  // ---- 4. evento: no se crea hasta el "sí"
  cola.push({fn: "crear_evento", args: {titulo: "Dentista", inicio: manana}});
  await decir("agenda dentista mañana a las 10");
  ok(eventos === 0, "4: el evento NO se creó antes de confirmar");
  e = await estado();
  ok(e.pendiente && /agendo/.test(e.pendiente.pregunta), "4: pregunta \"¿Lo agendo…?\"");
  await decir("sí");
  ok(eventos === 1, "4: con \"sí\" el evento se crea una vez (hubo " + eventos + ")");

  // ---- 5. nombre ambiguo: dos Óscar
  await p.evaluate(async () => { await PixelContactos.guardar({nombre: "Óscar Rodríguez", correo: "or@example.com"}); await PixelContactos.esperar(); });
  await esperar(1000);
  const antes = borradores;
  cola.push({fn: "redactar_correo", args: {para: "Óscar", asunto: "Hola", cuerpo: "Hola"}});
  await decir("escríbele a Óscar");
  ok(borradores === antes, "5: con dos Óscar no crea borrador (pregunta cuál)");

  // ---- 6. persona que no está en Contactos
  const antes6 = borradores;
  cola.push({fn: "redactar_correo", args: {para: "Pedro", asunto: "Hola", cuerpo: "Hola"}});
  await decir("escríbele a Pedro");
  ok(borradores === antes6, "6: Pedro no está en Contactos: no crea borrador ni se inventa un correo");
  ok(!llamadas.some((l) => /messages\?/.test(l.google || "")), "6: no busca a Pedro en Gmail");

  const malas = llamadas.filter((l) => /drafts\/send|events/.test(l.google || "") && /POST/.test(l.google));
  console.log("\nLlamadas de envío/creación:", JSON.stringify(malas));
  console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : "\nTODO BIEN");
  await b.close();
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERROR DE LA PRUEBA", e); process.exit(2); });
