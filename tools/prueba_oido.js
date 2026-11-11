"use strict";
// 11 nov - El microfono del celular (Fase 11) de punta a punta, en Chrome sin pantalla:
// una cuenta anonima de prueba se enlaza con el Pixel DE PRUEBA de tools/pc_de_prueba.py (con su codigo),
// toca "Usar el PC" y el microfono falso de Chrome "dice" la frase de <carpeta>/frase.wav. Se comprueba que
// la frase llega al PC, que su voz vuelve al celular y que el PC lo anota en el registro.
// Necesita las reglas de database.rules.json publicadas (frases, escuchando, habla, registro).
//   .venv/bin/python tools/pc_de_prueba.py <carpeta> &      (espera a que escriba <carpeta>/pc.json)
//   python3 -m http.server 8099 -d web &
//   PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_oido.js <carpeta>
const fs = require("fs"), path = require("path");
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const carpeta = process.argv[2];
const fallos = [];
const ok = (cond, texto) => { console.log((cond ? "BIEN " : "FALLO ") + texto); if (!cond) fallos.push(texto); };

(async () => {
  const pc = JSON.parse(fs.readFileSync(path.join(carpeta, "pc.json"), "utf8"));
  const b = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      "--use-file-for-fake-audio-capture=" + path.join(carpeta, "frase.wav") + "%noloop"]});
  const p = await b.newPage();
  await p.setViewport({width: 412, height: 900, deviceScaleFactor: 1});
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e.message || e)));
  await p.setRequestInterception(true);
  p.on("request", (r) => (/huggingface|hf\.co|jsdelivr/.test(r.url()) ? r.abort() : r.continue()));   // sin bajar 398 MB de voz
  await p.goto("http://localhost:8099/?nube=anonimo", {waitUntil: "load", timeout: 60000});
  await esperar(9000);

  // ---- 1. enlazar con el codigo, como en "Buscar a Píxel"
  const r = await p.evaluate(async (x) => {
    enlazando = {pid: x.pid, nombre: x.nombre};
    try { return {ok: true, r: await pedirAPixel(x.codigo)}; } catch (e) { return {ok: false, error: e.message}; }
  }, pc);
  ok(r.ok, "1: la cuenta de prueba se enlaza con el Píxel de prueba (" + JSON.stringify(r).slice(0, 160) + ")");
  let listo = false;
  for (let i = 0; i < 30 && !listo; i++) {
    await esperar(1000);
    listo = await p.evaluate((pid) => nube.pid === pid && !!nube.enLinea && !document.getElementById("oido").hidden && !document.getElementById("oido-btn").disabled, pc.pid);
  }
  ok(listo, "1: aparece «Usar el PC» y el PC está en línea");
  await p.screenshot({path: path.join(carpeta, "oido_antes.png")});

  // ---- 2. "Usar el PC": la frase va al PC y su voz vuelve
  await p.click("#oido-btn");
  let est = {enviadas: 0, oidas: 0};
  for (let i = 0; i < 60 && !(est.enviadas >= 1 && est.oidas >= 2); i++) {
    await esperar(1000);
    est = await p.evaluate(() => PixelOido.estado());
  }
  ok(est.enviadas >= 1, "2: el celular mandó la frase al PC (" + est.enviadas + ")");
  ok(est.oidas >= 2, "2: la voz del PC volvió al celular (" + est.oidas + " trozos)");
  await p.screenshot({path: path.join(carpeta, "oido_durante.png")});
  const activo = await p.evaluate(() => ({oido: PixelOido.activo(), agente: Agente.nucleo.oye.quiere, pildora: document.getElementById("pill-esp").textContent}));
  ok(activo.oido && !activo.agente, "2: con «Usar el PC», Píxel en el celular no escucha a la vez");
  ok(/lo oye el PC/.test(activo.pildora), "2: la píldora dice que oye el PC (" + activo.pildora + ")");

  // ---- 3. el PC lo anota en el registro, y se ve en la app
  let fila = "";
  await p.evaluate(() => { location.hash = "#registro"; });
  for (let i = 0; i < 20 && !fila; i++) {
    await esperar(1000);
    fila = await p.evaluate(() => [...document.querySelectorAll("#rg-lista .rg-fila")].map((x) => x.innerText).find((t) => /Píxel del PC/.test(t)) || "");
  }
  ok(/recuerd/i.test(fila), "3: el registro muestra lo que hizo el PC (" + fila.replace(/\s+/g, " ").slice(0, 160) + ")");
  await p.screenshot({path: path.join(carpeta, "oido_registro.png")});

  // ---- 4. parar
  await p.evaluate(() => { location.hash = "#inicio"; });
  await p.click("#oido-btn");
  await esperar(1000);
  ok(!(await p.evaluate(() => PixelOido.activo())), "4: «Parar» apaga el micrófono");
  // lo de la cuenta de prueba: el enlace con el Pixel de prueba y su registro
  await p.evaluate(async (pid) => {
    const d = nube.d;
    for (const x of [`usuarios/${nube.uid}/pixeles/${pid}`, `usuarios/${nube.uid}/enlazando/${pid}`, `usuarios/${nube.uid}/registro`]) await d.remove(d.ref(nube.db, x)).catch(() => {});
  }, pc.pid);

  ok(!errores.length, "sin errores de JavaScript en la página" + (errores.length ? ": " + errores.join(" | ") : ""));
  console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : "\nTODO BIEN");
  await b.close();
  fs.writeFileSync(path.join(carpeta, "parar"), "");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERROR DE LA PRUEBA", e); try { fs.writeFileSync(path.join(carpeta, "parar"), ""); } catch (x) { /* nada */ } process.exit(2); });
