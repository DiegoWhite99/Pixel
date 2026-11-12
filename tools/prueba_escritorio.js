/* Fase 15 (12 nov) - Prueba de la ventana del programa (web/escritorio.html) en Chrome sin pantalla.
   No toca ningun Pixel de verdad: /api/... y /progreso se simulan aqui (datos de ejemplo de prueba).
   Necesita la web servida en 8099 (python3 -m http.server 8099 -d web).
   Uso: PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_escritorio.js [carpeta para capturas] */
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");

const PAGINA = "http://127.0.0.1:8099/escritorio.html";
const CAPTURAS = process.argv[2] || "";
const SALUDO = "Hola, soy Píxel, un agente creado por Divergency IA. Bienvenido al panel de control. Aquí puedes vincular tus dispositivos y guardar tus APIs.";

const ESTADO = {
  servidor: {ip: "192.168.1.50", puerto: 8765, panel: 8080, ollama: false, stt: "base", llm: "qwen2.5:3b"},
  programa: {version: "9.9.9", apagar: true},
  dispositivos: [{ip: "192.168.1.60", puerto: 5000, desde: "08:10:00", minutos: 3, estado: "escuchando", frases: 2, pico: 0, piso: 0, ultimo: "", ble: {}}],
  celulares: [{uid: "u-prueba", nombre: "Celular de Ana Prueba", escuchando: true, estado: "escuchando", frases: 0, ultimo: ""}],
  mis_dispositivos: [{nombre: "Luz de prueba", mac: "aa:bb:cc:dd:ee:01", via: "wifi", ip: "192.168.1.70", tipo: "luz", encendido: true}],
  wifi: {busqueda: {estado: "listo", fase: "", hace: 5, red: "192.168.1.0/24", encontrados: [
    {ip: "192.168.1.71", mac: "aa:bb:cc:dd:ee:02", nombre: "Enchufe de prueba", tipo: "enchufe", fabricante: "Espressif", modelo: "", puertos: [], host: "", agregado: false},
    {ip: "192.168.1.1", mac: "aa:bb:cc:dd:ee:03", nombre: "", tipo: "router", fabricante: "", modelo: "", puertos: [], host: "", agregado: false}]}},
  nube: {activa: true, conectada: true, error: "", pid: "p-prueba", nombre: "Píxel de prueba",
    duenos: [{uid: "u-prueba", nombre: "Ana Prueba", desde: 1762900000000}], enlace: {codigo: "482913", quedan_s: 271}},
  agente: {activacion: "Píxel", ajustes: {voz: "st-F4", personalidad: "Amable.", respuesta: "normal", salida_voz: "pc", tono: "normal"},
    voces: [{id: "st-F4", nombre: "Alta calidad · Mujer 4"}, {id: "st-M1", nombre: "Alta calidad · Hombre 1"}], personalidad_max: 300},
  cuentas: {gemini: {configurada: true, modelo: "gemini-3.5-flash-lite", error: "", hace_error: null, hace_ok: 30},
    groq: {configurada: false, modelo: "", error: "", hace_error: null, hace_ok: null}, ia: "gemini"},
};

let modo = "listo";              // "listo" | "preparando" | "apagado"
const enviados = [];
let fallos = 0;
function ok(cond, texto) {
  if (!cond) { fallos += 1; console.log("  MAL: " + texto); } else console.log("  bien: " + texto);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const nav = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--window-size=1200,780"]});
  try {
    const p = await nav.newPage();
    await p.setViewport({width: 1200, height: 780});
    const errores = [];
    p.on("pageerror", (e) => errores.push(e.message));
    await p.setRequestInterception(true);
    p.on("request", (r) => {
      const u = new URL(r.url());
      if (u.port === "8099" && (u.pathname.startsWith("/api/") || u.pathname === "/progreso")) {
        if (modo === "apagado") return r.abort("connectionrefused");
        if (r.method() === "POST") {
          enviados.push({ruta: u.pathname, datos: JSON.parse(r.postData() || "{}")});
          return r.respond({status: 200, contentType: "application/json", body: JSON.stringify({mensaje: "Hecho (prueba)."})});
        }
        if (u.pathname === "/progreso") {
          return r.respond({status: 200, contentType: "application/json",
            body: JSON.stringify({fase: "Bajando la voz de Píxel…", hecho: 157286400, total: 524288000, error: "", registro: "", version: "9.9.9"})});
        }
        if (modo === "preparando") return r.respond({status: 503, contentType: "application/json", body: '{"preparando": true}'});
        return r.respond({status: 200, contentType: "application/json", body: JSON.stringify(ESTADO)});
      }
      if (u.hostname !== "127.0.0.1") return r.abort();          // nada de internet en la prueba
      r.continue();
    });
    const foto = async (nombre) => { if (CAPTURAS) await p.screenshot({path: path.join(CAPTURAS, nombre + ".png")}); };
    if (CAPTURAS) fs.mkdirSync(CAPTURAS, {recursive: true});

    console.log("Bienvenida");
    await p.goto(PAGINA, {waitUntil: "domcontentloaded"});
    // el tamano de Pixel durante la llegada: el mas pequeno visto contra el del final
    const anchos = [];
    for (let i = 0; i < 26; i++) {
      anchos.push(await p.$eval("#intro-pixel", (e) => e.getBoundingClientRect().width));
      if (i === 6) await foto("1_llega");
      await esperar(100);
    }
    await foto("2_cerca");
    await esperar(600);
    const lejos = Math.min(...anchos), cerca = await p.$eval("#intro-pixel", (e) => e.getBoundingClientRect().width);
    ok(cerca > lejos * 3, `Píxel se acerca de atrás hacia adelante (${Math.round(lejos)} px → ${Math.round(cerca)} px)`);
    await p.waitForFunction(() => document.querySelector("#intro-entrar").classList.contains("ver"), {timeout: 15000});
    await foto("3_saludo");
    const dicho = await p.$eval("#intro-texto", (e) => e.innerText.replace(/\s+/g, " ").trim());
    ok(dicho === SALUDO, "el saludo dice exactamente lo pedido");
    await p.click("#intro-entrar");
    await esperar(1000);
    ok(await p.$eval("#intro", (e) => e.hidden), "«Entrar al panel» quita la bienvenida");
    await foto("4_inicio");

    console.log("Inicio");
    const digitos = await p.$$eval("#v-inicio .digitos span", (s) => s.map((x) => x.textContent).join(""));
    ok(digitos === "482913", "se ve el código de 6 cifras para vincular");
    ok((await p.$eval("#v-inicio [data-lista-apps]", (e) => e.textContent)).includes("Ana Prueba"), "sale la cuenta vinculada");
    ok((await p.$eval("#d-ia strong", (e) => e.textContent)) === "Gemini", "el dato de IA dice Gemini");
    ok((await p.$eval("#version", (e) => e.textContent)) === "9.9.9", "sale la versión del programa");
    ok(!(await p.$eval("#apagar", (e) => e.hidden)), "el botón «Apagar Píxel» sale en el programa");

    console.log("Tus APIs");
    await p.click('[data-vista="apis"]');
    await esperar(400);
    await foto("5_apis");
    await p.type('[data-api="groq"] input[name="clave"]', "gsk_" + "x".repeat(40));
    await p.click('[data-api="groq"] button[type="submit"]');
    await esperar(600);
    const groq = enviados.find((e) => e.ruta === "/api/groq/clave");
    ok(groq && groq.datos.clave === "gsk_" + "x".repeat(40), "guardar la clave de Groq la manda al panel local");
    ok((await p.$eval('[data-api="groq"] input[name="clave"]', (e) => e.value)) === "", "la clave no se queda en la pantalla");
    await p.click('[data-ia="groq"]');
    await esperar(300);
    ok(enviados.some((e) => e.ruta === "/api/ia" && e.datos.ia === "groq"), "elegir «Groq primero» se guarda");

    console.log("Dispositivos");
    await p.click('[data-vista="dispositivos"]');
    await esperar(400);
    await foto("6_dispositivos");
    ok((await p.$eval("#lista-red", (e) => e.textContent)).includes("Enchufe de prueba"), "salen los aparatos encontrados en la red");
    await p.click('[data-agregar="aa:bb:cc:dd:ee:02"]');
    await p.click('.fila-form button[type="submit"]');
    await esperar(400);
    const agregado = enviados.find((e) => e.ruta === "/api/wifi/agregar");
    ok(agregado && agregado.datos.mac === "aa:bb:cc:dd:ee:02" && agregado.datos.tipo === "enchufe", "agregar un aparato de la red");
    ESTADO.wifi.busqueda = {estado: "error", fase: "No pude buscar: el PC no está conectado a ninguna red.", hace: 1, red: "", encontrados: []};
    await esperar(2600);
    ok((await p.$eval("#red-fase", (e) => !e.hidden && e.textContent)).includes("No pude buscar"), "un fallo de la búsqueda se ve");

    console.log("Voz");
    await p.click('[data-vista="voz"]');
    await esperar(300);
    await foto("7_voz");
    ok(await p.$eval('input[name="salida_voz"][value="pc"]', (e) => e.checked), "la salida guardada (PC) sale marcada");
    await p.click("#probar-voz");
    await esperar(600);
    ok(enviados.some((e) => e.ruta === "/api/agente/probar" && e.datos.donde === "pc"), "probar la voz la manda al PC");

    console.log("Preparando");
    modo = "preparando";
    await p.click('[data-vista="inicio"]');
    await esperar(2600);
    await foto("8_preparando");
    ok(!(await p.$eval("#preparando", (e) => e.hidden)), "mientras baja la voz se ve «Preparando a Píxel»");
    ok((await p.$eval("#prep-cifra", (e) => e.textContent)) === "30 %", "con su avance (30 %)");

    console.log("Apagado");
    modo = "apagado";
    await esperar(6000);
    await foto("9_apagado");
    ok(!(await p.$eval("#apagado", (e) => e.hidden)), "sin Píxel, la ventana lo dice");
    modo = "listo";
    await esperar(2600);
    ok(await p.$eval("#apagado", (e) => e.hidden), "y cuando vuelve, sigue sola");

    console.log("Pantalla pequeña");
    await p.setViewport({width: 390, height: 800});
    await esperar(400);
    await foto("10_estrecha");
    for (const vista of ["inicio", "dispositivos", "apis", "voz"]) {
      await p.evaluate((v) => window.Escritorio.irA(v), vista);
      await esperar(200);
      const sobra = await p.evaluate(() => Array.from(document.querySelectorAll("body *"))
        .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 3)
        .map((e) => e.tagName.toLowerCase() + "." + e.className));
      ok(sobra.length === 0, `nada se sale a lo ancho a 390 px en ${vista}` + (sobra.length ? ": " + sobra.join(", ") : ""));
    }
    await p.evaluate(() => window.Escritorio.irA("inicio"));

    ok(errores.length === 0, "sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  } finally { await nav.close(); }
  console.log(fallos ? `\n${fallos} MAL` : "\nTODO BIEN");
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
