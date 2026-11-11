"use strict";
// 11 nov - Chrome sin pantalla: WhatsApp (espera los contactos y no adivina entre parecidos), el registro
// de acciones y la tarjeta del microfono del PC. Gemini SIMULADO y WhatsApp sin abrir de verdad (window.open
// falso): no se manda nada. Los contactos de la prueba (nombres de ejemplo) van en una cuenta anonima de prueba.
//   python3 -m http.server 8099 -d web &
//   PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_whatsapp_registro.js
// El registro se guarda en la nube solo con las reglas nuevas publicadas (database.rules.json): si no lo
// estan, la prueba lo dice como PENDIENTE y no como bien.
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const cola = [];                 // respuestas de Gemini, en orden (una por turno)
const fallos = [], pendientes = [];
const ok = (cond, texto) => { console.log((cond ? "BIEN " : "FALLO ") + texto); if (!cond) fallos.push(texto); };

async function mockear(p) {
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = r.url(), m = r.method();
    if (/huggingface|hf\.co|jsdelivr/.test(u)) return r.abort();          // sin bajar 398 MB de voz
    if (u.startsWith("http://localhost")) return r.continue();
    const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS"};
    if (m === "OPTIONS") return r.respond({status: 204, headers: cors, body: ""});
    if (/generativelanguage/.test(u)) {
      const turno = cola.length ? cola.shift() : {texto: "Listo."};
      const parte = turno.fn ? {functionCall: {name: turno.fn, args: turno.args}} : {text: turno.texto};
      const cuerpo = {candidates: [{content: {role: "model", parts: [parte]}, finishReason: "STOP"}]};
      const sse = u.includes("streamGenerateContent");
      return r.respond({status: 200, headers: cors, contentType: sse ? "text/event-stream" : "application/json",
        body: sse ? "data: " + JSON.stringify(cuerpo) + "\n\n" : JSON.stringify(cuerpo)});
    }
    r.continue();
  });
}

(async () => {
  const b = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]});
  const p = await b.newPage();
  await p.setViewport({width: 412, height: 900, deviceScaleFactor: 1});
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e.message || e)));
  // WhatsApp de mentira: se apunta la direccion y no se abre nada
  await p.evaluateOnNewDocument(() => { window.__abiertos = []; window.open = (url) => { window.__abiertos.push(String(url)); return null; }; });
  await mockear(p);
  await p.goto("http://localhost:8099/?nube=anonimo", {waitUntil: "load", timeout: 60000});
  await esperar(9000);
  await p.evaluate(() => {
    localStorage.setItem("pixel.ia:" + nube.uid, JSON.stringify({proveedor: "gemini", claves: {gemini: "AIzaPruebaFalsaNoReal0123456789ab"}, modelos: {gemini: "gemini-3.5-flash-lite"}}));
  });
  await p.reload({waitUntil: "load"});
  await esperar(9000);
  await p.evaluate(async () => {
    await PixelContactos.guardar({nombre: "Ana Prueba", telefono: "300 111 2233"});
    await PixelContactos.guardar({nombre: "Ana Ejemplo", telefono: "300 444 5566"});
    await PixelContactos.esperar();
    // se apunta cada N.registrar (ademas de guardarse en la nube)
    const N = Agente.nucleo, real = N.registrar;
    window.__registro = [];
    N.registrar = (tipo, texto, detalle) => { window.__registro.push({tipo, texto, detalle}); return real(tipo, texto, detalle); };
  });
  await esperar(1500);

  const decir = async (texto) => {
    await p.evaluate((t) => { const i = document.getElementById("ag-texto"); i.value = t; document.getElementById("ag-escribir").dispatchEvent(new Event("submit", {cancelable: true, bubbles: true})); }, texto);
    await esperar(6000);
  };
  const ultimo = () => p.evaluate(() => { const c = Agente.nucleo.est.conversacion; return c.length ? c[c.length - 1].texto : ""; });
  const pendiente = () => p.evaluate(() => (Agente.nucleo.est.pendiente ? {pregunta: Agente.nucleo.est.pendiente.pregunta, detalle: Agente.nucleo.est.pendiente.detalle} : null));

  // ---- 1. dos "Ana" con celular: pregunta a cual, no prepara nada
  cola.push({fn: "escribir_whatsapp", args: {para: "Ana", mensaje: "hola"}});
  await decir("escríbele a Ana por WhatsApp hola");
  let t = await ultimo();
  ok(/varios parecidos/.test(t) && /Ana Prueba/.test(t) && /Ana Ejemplo/.test(t), "1: con dos Ana pregunta a cuál (" + t + ")");
  ok(!(await pendiente()), "1: no queda nada esperando el «sí»");

  // ---- 2. la persona exacta: prepara y pregunta, sin abrir WhatsApp
  cola.push({fn: "escribir_whatsapp", args: {para: "Ana Prueba", mensaje: "hola"}});
  await decir("a Ana Prueba");
  const pe = await pendiente();
  ok(pe && /\+57 300 111 2233/.test(pe.detalle || ""), "2: la confirmación lleva el número de Ana Prueba de Contactos");
  ok((await p.evaluate(() => window.__abiertos.length)) === 0, "2: WhatsApp no se abrió antes del «sí»");
  ok((await p.evaluate(() => window.__registro.length)) === 0, "2: nada en el registro antes del «sí»");

  // ---- 3. "sí": abre WhatsApp una vez y lo anota
  await decir("sí");
  const abiertos = await p.evaluate(() => window.__abiertos);
  ok(abiertos.length === 1 && /^https:\/\/wa\.me\/573001112233\?text=hola$/.test(abiertos[0]), "3: con «sí» abre wa.me de Ana Prueba una vez (" + abiertos.join(", ") + ")");
  const reg = await p.evaluate(() => window.__registro);
  ok(reg.length === 1 && reg[0].tipo === "whatsapp" && /Ana Prueba/.test(reg[0].texto), "3: queda anotado en el registro (" + JSON.stringify(reg) + ")");

  // ---- 4. la pestaña Registro
  await p.evaluate(() => { location.hash = "#registro"; });
  await esperar(4000);
  const vista = await p.evaluate(() => ({tab: !document.getElementById("tab-registro").hidden, visible: !document.getElementById("v-registro").hidden,
    filas: document.querySelectorAll("#rg-lista .rg-fila").length, texto: document.getElementById("rg-lista").innerText.slice(0, 300),
    filtros: document.querySelectorAll("#rg-filtros [data-rg-filtro]").length}));
  ok(vista.tab && vista.visible && vista.filtros === 7, "4: la pestaña Registro se ve, con sus 7 filtros");
  if (vista.filas >= 1 && /Ana Prueba/.test(vista.texto)) ok(true, "4: el registro guardado en la nube se ve en la lista");
  else { pendientes.push("4: el registro no llegó a la nube (¿reglas sin publicar?)"); console.log("PENDIENTE 4: la lista dice: " + vista.texto.replace(/\s+/g, " ")); }
  await p.screenshot({path: process.env.CAPTURA || "/tmp/registro.png", fullPage: false});

  // ---- 5. el microfono del PC: sin PC enlazado no se ve
  const oido = await p.evaluate(() => ({oculto: document.getElementById("oido").hidden, hay: !!window.PixelOido}));
  ok(oido.hay && oido.oculto, "5: sin Píxel del PC enlazado, «Usar el PC» no se muestra");

  ok(!errores.length, "sin errores de JavaScript en la página" + (errores.length ? ": " + errores.join(" | ") : ""));
  console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : pendientes.length ? `\nBIEN, con ${pendientes.length} PENDIENTE(S): ${pendientes.join("; ")}` : "\nTODO BIEN");
  await b.close();
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERROR DE LA PRUEBA", e); process.exit(2); });
