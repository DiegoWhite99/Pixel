"use strict";
// 2.4.0 (12 nov) - El espejo entre el programa del PC y la app de internet, de punta a punta, en Chrome sin pantalla:
// una cuenta anonima de prueba se enlaza con el Pixel DE PRUEBA de tools/pc_de_prueba.py (con su codigo) y se
// comprueba que los ajustes del agente y las claves de IA van del PC a la app y de la app al PC, que una clave
// quitada en el PC se quita en la app y que el perfil de la app llega al PC. Las claves son inventadas: el PC de prueba las "prueba" sin llamar a nadie
// (--ia-simulada) y la de Groq que se pone en la app se prueba contra un Groq simulado. Al final borra lo de la
// cuenta de prueba y la propia cuenta, y el PC de prueba borra lo suyo.
//   .venv/bin/python tools/pc_de_prueba.py <carpeta> --ia-simulada &      (espera a que escriba <carpeta>/pc.json)
//   python3 -m http.server 8099 -d web &
//   PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_espejo.js <carpeta> [<carpeta2>]
// Con <carpeta2> (otro PC de prueba: --puerto 8798 --panel 8082 --nombre "Pixel de prueba 2") se comprueba ademas que
// ese segundo PC, que no es el elegido en la app, queda igual que el primero: la app hace de centro.
const fs = require("fs"), path = require("path");
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const carpeta = process.argv[2], carpeta2 = process.argv[3];    // la 2a: otro PC de prueba (--panel 8082)
const PANEL = "http://127.0.0.1:8081", PANEL2 = "http://127.0.0.1:8082";
const fallos = [];
const ok = (cond, texto) => { console.log((cond ? "BIEN " : "FALLO ") + texto); if (!cond) fallos.push(texto); };
const CLAVE_PC = "AIzaPruebaEspejoDesdeElPC000000000000";
const CLAVE_APP = "gsk_PruebaEspejoDesdeLaApp00000000000";

async function panel(ruta, cuerpo, base) {
  const r = await fetch((base || PANEL) + ruta, cuerpo ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(cuerpo)} : {});
  return r.json();
}
async function hasta(f, segundos) {
  for (let i = 0; i < segundos; i++) {
    const v = await f();
    if (v) return v;
    await esperar(1000);
  }
  return f();
}

(async () => {
  const pc = JSON.parse(fs.readFileSync(path.join(carpeta, "pc.json"), "utf8"));
  const b = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]});
  const p = await b.newPage();
  await p.setViewport({width: 412, height: 900, deviceScaleFactor: 1});
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e.message || e)));
  const consola = [];
  p.on("console", (m) => { if (/espejo|PERMISSION|ordenNube/i.test(m.text())) consola.push(new Date().toTimeString().slice(0, 8) + " " + m.type() + ": " + m.text()); });
  await p.setRequestInterception(true);
  const aGroq = [];
  p.on("request", (r) => {
    const u = r.url();
    if (/huggingface|hf\.co|jsdelivr/.test(u)) return r.abort();             // sin bajar 398 MB de voz
    if (/api\.groq\.com/.test(u) && r.method() === "OPTIONS") {             // la consulta previa del navegador (CORS)
      return r.respond({status: 204, headers: {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}});
    }
    if (/api\.groq\.com/.test(u)) {                                           // Groq simulado: la clave "vale"
      aGroq.push(u);
      return r.respond({status: 200, contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"},
        body: JSON.stringify({choices: [{message: {content: "listo"}, finish_reason: "stop"}], usage: {prompt_tokens: 5, completion_tokens: 1}})});
    }
    if (/generativelanguage\.googleapis\.com/.test(u)) return r.abort();      // nadie debe llamar a Gemini aqui
    return r.continue();
  });
  await p.goto("http://localhost:8099/?nube=anonimo", {waitUntil: "load", timeout: 60000});
  await esperar(9000);

  // ---- 1. enlazar con el codigo
  const r = await p.evaluate(async (x) => {
    enlazando = {pid: x.pid, nombre: x.nombre};
    try { return {ok: true, r: await pedirAPixel(x.codigo)}; } catch (e) { return {ok: false, error: e.message}; }
  }, pc);
  ok(r.ok, "1: la cuenta de prueba se enlaza con el Píxel de prueba (" + JSON.stringify(r).slice(0, 120) + ")");
  const pc2 = carpeta2 ? JSON.parse(fs.readFileSync(path.join(carpeta2, "pc.json"), "utf8")) : null;
  if (pc2) {                                   // el segundo PC (como el Windows del usuario junto al PC del robot)
    const r2b = await p.evaluate(async (x) => {
      enlazando = {pid: x.pid, nombre: x.nombre};
      try { await pedirAPixel(x.codigo); return "ok"; } catch (e) { return e.message; }
    }, pc2);
    ok(r2b === "ok", "1: también se enlaza un segundo PC (" + r2b + ")");
    await p.evaluate((pid) => { try { localStorage.setItem("pixel.elegido", pid); } catch (e) { /* nada */ } elegirPixel(); }, pc.pid);
  }
  const listo = await hasta(() => p.evaluate((pid) => nube.pid === pid && !!nube.enLinea && !!(nube.estado && nube.estado.agente
    && nube.estado.agente.ajustes && "t" in nube.estado.agente.ajustes), pc.pid), 40);
  ok(listo, "1: el PC está en línea y publica sus ajustes con hora (2.4.0)");
  const uid = await p.evaluate(() => nube.uid);
  try {

  // ---- 2. del PC a la app: ajustes del agente
  const AJ_PC = {voz: "st-M1", respuesta: "corta", tono: "infantil", personalidad: "Prueba del espejo: desde el PC", salida_voz: "esp32"};
  const r2 = await panel("/api/agente", AJ_PC);
  ok(!r2.error, "2: el PC guarda sus ajustes (" + (r2.mensaje || r2.error) + ")");
  // del servidor (REST con el token de la cuenta), no de la pagina: Firebase muestra antes lo que luego puede rechazar
  const servidor = (ruta) => p.evaluate(async (r) => {
    const tok = await nube.auth.currentUser.getIdToken();
    return (await fetch(nube.db.app.options.databaseURL + "/" + r + ".json?auth=" + tok)).json();
  }, ruta);
  const aj = await hasta(async () => {
    const v = await servidor(`usuarios/${uid}/ajustes`);
    return v && v.personalidad === "Prueba del espejo: desde el PC" ? v : null;
  }, 30);
  ok(!!aj, "2: los ajustes del PC llegan a la cuenta en la app");
  ok(aj && aj.voz === "st-M1" && aj.tono === "infantil" && aj.respuesta === "corta", "2: con la voz, el tipo de voz y el largo del PC (" + JSON.stringify(aj) + ")");

  // ---- 3. del PC a la app: una clave de Gemini
  const r3 = await panel("/api/gemini/clave", {clave: CLAVE_PC});
  ok(!r3.error, "3: el PC guarda una clave de Gemini (" + (r3.mensaje || r3.error) + ")");
  const g = await hasta(() => p.evaluate((c) => Proveedores.leer().claves.gemini === c, CLAVE_PC), 30);
  ok(g, "3: la clave de Gemini del PC aparece en la app");

  // ---- 4. de la app al PC: una clave de Groq puesta en Ajustes, como lo haria una persona
  await p.evaluate(() => { location.hash = "#ajustes"; });
  await esperar(1500);
  await p.select("#ia-proveedor", "groq");
  await p.type("#ia-clave", CLAVE_APP);
  await p.evaluate(() => { document.getElementById("ia-modelo").value = "llama-prueba"; });
  await p.click("#f-ia button[type=submit]");
  const enApp = await hasta(() => p.evaluate((c) => Proveedores.leer().claves.groq === c, CLAVE_APP), 15);
  ok(enApp, "4: la app guarda la clave de Groq (probada contra el Groq simulado: " + aGroq.length + " llamada(s))");
  const enPc = await hasta(async () => {
    const e = await panel("/api/estado");
    return e.cuentas && e.cuentas.groq && e.cuentas.groq.configurada && e.cuentas.ia === "groq" ? e : null;
  }, 40);
  ok(!!enPc, "4: la clave de Groq de la app llega al PC, y Groq queda primero también allá");
  const iaPc = await p.evaluate(async (pid) => (await nube.d.get(nube.d.ref(nube.db, `pixeles/${pid}/ia`))).val(), pc.pid);
  ok(iaPc && iaPc.groq && iaPc.groq.clave === CLAVE_APP && iaPc.gemini.clave === CLAVE_PC, "4: el PC publica las dos claves");
  const texto = await p.evaluate(() => (document.getElementById("ia-pc") || {}).innerText || "");
  ok(/se copian solas/.test(texto), "4: Ajustes dice que las claves se copian solas (" + texto.replace(/\s+/g, " ").slice(0, 120) + ")");
  await p.screenshot({path: path.join(carpeta, "espejo_ajustes.png")});

  // ---- 5. de la app al PC: ajustes del agente (lo que escribe la app al guardar)
  const escrito = await p.evaluate(async (u) => {
    try {
      await nube.d.set(nube.d.ref(nube.db, `usuarios/${u}/ajustes`), {personalidad: "Prueba del espejo: desde la app",
        respuesta: "normal", voz: "st-F2", tono: "normal", t: nube.d.serverTimestamp()});
      return "ok";
    } catch (e) { return String(e.message || e); }
  }, uid);
  ok(escrito === "ok", "5: la app guarda sus ajustes con la hora del cambio (" + escrito + ")");
  const ajPc = await hasta(async () => {
    const e = await panel("/api/estado");
    const a = e.agente && e.agente.ajustes;
    return a && a.personalidad === "Prueba del espejo: desde la app" ? a : null;
  }, 40);
  ok(!!ajPc, "5: los ajustes de la app llegan al PC");
  ok(ajPc && ajPc.voz === "st-F2" && ajPc.tono === "normal" && ajPc.respuesta === "normal" && ajPc.salida_voz === "esp32",
    "5: con la voz y el tono de la app, y la salida del PC sin tocar (" + JSON.stringify(ajPc) + ")");

  // ---- 6. quitada en el PC, quitada en la app
  const r6 = await panel("/api/gemini/clave", {clave: ""});
  ok(!r6.error, "6: el PC quita su clave de Gemini");
  const quitada = await hasta(() => p.evaluate(() => !Proveedores.leer().claves.gemini), 30);
  ok(quitada, "6: la clave de Gemini desaparece también de la app");
  await esperar(3000);
  const quieto = await panel("/api/estado");
  ok(quieto.cuentas.groq.configurada && !quieto.cuentas.gemini.configurada, "6: nada vuelve atrás (Groq sigue, Gemini sigue quitada en el PC)");

    // ---- 7. el perfil de la app llega al PC: el robot y el PC tratan al usuario igual que la app
    const r7 = await p.evaluate(async (u) => {
      try {
        await nube.d.update(nube.d.ref(nube.db, `usuarios/${u}/perfil`), {nombre: "Ana Prueba", apodo: "Anita", trato: "tu",
          gustos: "el café y la salsa", actualizado: nube.d.serverTimestamp()});
        return "ok";
      } catch (e) { return String(e.message || e); }
    }, uid);
    ok(r7 === "ok", "7: la app guarda un perfil (" + r7 + ")");
    const pf = await hasta(async () => {
      const e = await panel("/api/estado"), x = e.agente && e.agente.perfil;
      return x && /Anita/.test(x.texto || "") ? x : null;
    }, 40);
    ok(!!pf, "7: el perfil de la app llega al PC");
    ok(pf && /café y la salsa/.test(pf.texto) && pf.t > 0, "7: con sus gustos y la hora del cambio (" + JSON.stringify(pf).slice(0, 140) + ")");
    // ---- 8. el segundo PC queda igual que el primero, pasando por la app (no es el elegido)
    if (pc2) {
      const igualA = await hasta(async () => {
        const a = await panel("/api/estado"), b = await panel("/api/estado", null, PANEL2);
        const aa = a.agente.ajustes, bb = b.agente.ajustes;
        const mismos = ["voz", "tono", "respuesta", "personalidad"].every((k) => aa[k] === bb[k]);
        const ia = b.cuentas.groq.configurada && !b.cuentas.gemini.configurada && b.cuentas.ia === "groq";
        return mismos && ia && /Anita/.test((b.agente.perfil || {}).texto || "") ? b : null;
      }, 45);
      ok(!!igualA, "8: el segundo PC tiene los mismos ajustes, claves, IA preferida y perfil que el primero");
      const ia2 = await p.evaluate(async (pid) => (await nube.d.get(nube.d.ref(nube.db, `pixeles/${pid}/ia`))).val(), pc2.pid);
      ok(ia2 && ia2.groq.clave === CLAVE_APP && !ia2.gemini.clave, "8: y publica la misma clave de Groq, sin la de Gemini quitada");
    }
  } catch (e) {
    ok(false, "la prueba se cortó: " + (e.message || e).split("\n")[0]);
  }
  // ---- limpieza (siempre): lo de la cuenta de prueba y la cuenta misma
  const borrada = await p.evaluate(async (pid) => {
    const d = nube.d, u = nube.uid;
    for (const x of [`usuarios/${u}`].concat(pid.map((q) => `pixeles/${q}/duenos/${u}`))) await d.remove(d.ref(nube.db, x)).catch(() => {});
    try { localStorage.removeItem("pixel.ia:" + u); } catch (e) { /* nada */ }
    try { await nube.au.deleteUser(nube.auth.currentUser); return true; } catch (e) { return String(e.code || e.message); }
  }, [pc.pid].concat(pc2 ? [pc2.pid] : []));
  ok(borrada === true, "limpieza: borrados los datos y la cuenta anónima de prueba (" + borrada + ")");

  ok(!errores.length, "sin errores de JavaScript en la página" + (errores.length ? ": " + errores.join(" | ") : ""));
  console.log("Consola de la página:\n  " + consola.slice(-25).join("\n  "));
  console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : "\nTODO BIEN");
  await b.close();
  fs.writeFileSync(path.join(carpeta, "parar"), "");
  if (carpeta2) fs.writeFileSync(path.join(carpeta2, "parar"), "");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => {
  console.error("ERROR DE LA PRUEBA", e);
  for (const c of [carpeta, carpeta2].filter(Boolean)) { try { fs.writeFileSync(path.join(c, "parar"), ""); } catch (x) { /* nada */ } }
  process.exit(2);
});
