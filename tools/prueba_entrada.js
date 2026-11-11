"use strict";
// 11 nov - Chrome sin pantalla: la app sin sesion manda al lobby; sin clave de IA no se llama a ninguna IA;
// con clave, Gemini con la clave de esa cuenta. La IA esta SIMULADA (no gasta cupo).
//   python3 -m http.server 8099 -d web &
//   PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_entrada.js [carpeta para las capturas]
// Crea cuentas anonimas en Firebase (la de la prueba): quedan en Authentication.
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const CAPTURAS = process.argv[2] || require("os").tmpdir();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const fallos = [];
const ok = (c, t) => { console.log((c ? "BIEN " : "FALLO ") + t); if (!c) fallos.push(t); };
const CLAVE = "AIza" + "PruebaFalsaNoReal0123456789ab";
const IA = /generativelanguage\.googleapis\.com|firebasevertexai|firebaseml|api\.openai\.com|api\.anthropic\.com|openrouter\.ai|api\.deepseek\.com/;
const lanzar = () => puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new", userDataDir: "/tmp/claude-1000/perfil-" + Date.now() + Math.random(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]});

async function mockear(p, pedidosIA) {
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = r.url(), m = r.method();
    if (/huggingface|hf\.co|cdn\.jsdelivr\.net\/npm\/onnxruntime/.test(u)) return r.abort();   // sin bajar 398 MB de voz
    if (u.startsWith("http://localhost")) return r.continue();
    const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS"};
    if (IA.test(u)) {
      if (m === "OPTIONS") return r.respond({status: 204, headers: cors, body: ""});
      pedidosIA.push({url: u.replace(/\?.*$/, ""), clave: r.headers()["x-goog-api-key"] || ""});
      const cuerpo = {candidates: [{content: {role: "model", parts: [{text: "¡Hola! Aquí estoy."}]}, finishReason: "STOP"}], usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 5}};
      return r.respond({status: 200, headers: cors, contentType: "text/event-stream", body: "data: " + JSON.stringify(cuerpo) + "\n\n"});
    }
    r.continue();
  });
}
const escribir = (p, t) => p.evaluate((x) => { const i = document.getElementById("ag-texto"); i.value = x; document.getElementById("ag-escribir").dispatchEvent(new Event("submit", {cancelable: true, bubbles: true})); }, t);

(async () => {
  // ---- 1 y 2: sin sesion, la app manda al lobby; el lobby carga bien
  {
    const b = await lanzar(), p = await b.newPage(), errores = [];
    p.on("pageerror", (e) => errores.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    await p.goto("http://localhost:8099/?nube", {waitUntil: "load", timeout: 60000});
    await esperar(8000);
    ok(/\/lobby\.html\?nube$/.test(p.url()), "sin sesión, la app manda al lobby (" + p.url() + ")");
    await p.setViewport({width: 390, height: 844});
    await esperar(800);
    const d = await p.evaluate(() => ({ancho: document.documentElement.scrollWidth, funciones: document.querySelectorAll("#funciones .funcion").length,
      boton: document.getElementById("entrar-texto").textContent, entrar: document.querySelectorAll("[data-entrar]").length}));
    ok(d.ancho <= 390, "el lobby cabe en un celular de 390 px (ancho " + d.ancho + ")");
    ok(d.funciones >= 12, d.funciones + " tarjetas de funciones");
    ok(d.boton === "Entrar con Google" && d.entrar === 3, "botones de entrar: " + d.entrar);
    ok(errores.length === 0, "sin errores en la consola" + (errores.length ? ": " + errores.join(" | ").slice(0, 300) : ""));
    await p.screenshot({path: CAPTURAS + "/lobby_movil.png", fullPage: true});
    await p.setViewport({width: 1280, height: 900});
    await esperar(500);
    await p.screenshot({path: CAPTURAS + "/lobby_pc.png", fullPage: false});
    await b.close();
  }
  // ---- 3 y 4: la app sin clave no llama a ninguna IA; con clave, usa la de esta cuenta
  {
    const b = await lanzar(), p = await b.newPage(), pedidosIA = [];
    await mockear(p, pedidosIA);
    await p.goto("http://localhost:8099/?nube=anonimo", {waitUntil: "load", timeout: 60000});
    await esperar(10000);
    ok(p.url().includes("index.html") || !p.url().includes("lobby"), "la prueba anónima no se va al lobby");
    let e = await p.evaluate(() => ({pasos: !document.getElementById("pasos").hidden, clave: document.getElementById("paso-clave").classList.contains("hecho"),
      pill: document.getElementById("pill-ollama").textContent.trim()}));
    ok(e.pasos && !e.clave, "sale «Primeros pasos» con la clave pendiente");
    ok(/sin clave/i.test(e.pill), "la píldora dice: " + e.pill);
    await escribir(p, "hola");
    await esperar(5000);
    const aviso = await p.evaluate(() => document.getElementById("ag-aviso").textContent);
    ok(pedidosIA.length === 0, "sin clave no se llama a ninguna IA (hubo " + pedidosIA.length + ")");
    ok(/clave de inteligencia artificial/.test(aviso), "avisa que falta la clave: «" + aviso.slice(0, 80) + "»");

    await p.evaluate((k) => localStorage.setItem("pixel.ia:" + nube.uid, JSON.stringify({proveedor: "gemini", claves: {gemini: k}, modelos: {gemini: "gemini-3.5-flash-lite"}})), CLAVE);
    await p.reload({waitUntil: "load"});
    await esperar(10000);
    await escribir(p, "hola");
    await esperar(6000);
    ok(pedidosIA.length >= 1 && pedidosIA.every((x) => /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash-lite:streamGenerateContent/.test(x.url)),
      "con clave, llama a Gemini por su API: " + JSON.stringify(pedidosIA.map((x) => x.url.replace(/^https:\/\//, ""))));
    ok(pedidosIA.length >= 1 && pedidosIA.every((x) => x.clave === CLAVE), "con la clave de esta cuenta, en la cabecera");
    e = await p.evaluate(() => ({pasos: !document.getElementById("pasos").hidden, clave: document.getElementById("paso-clave").classList.contains("hecho"),
      sub: document.getElementById("paso-clave-sub").textContent, pill: document.getElementById("pill-ollama").textContent.trim()}));
    ok(e.clave && /Gemini 3\.5 Flash-Lite/.test(e.sub), "el paso de la clave queda hecho: «" + e.sub + "»");
    ok(/Gemini 3\.5 Flash-Lite · tu clave/.test(e.pill), "la píldora dice: " + e.pill);
    await p.screenshot({path: CAPTURAS + "/inicio_pasos.png"});
    await b.close();
  }
  console.log(fallos.length ? fallos.length + " FALLO(S)" : "TODO BIEN");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERROR DE LA PRUEBA", e); process.exit(2); });
