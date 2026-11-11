"use strict";
// 11 nov - Chrome sin pantalla: el boton "Exportar contactos" trae los contactos de Google (People API SIMULADA).
// Ojo al simular: solo gmail, calendar, oauth2 y people. Si se simula todo googleapis.com se rompe la sesion de
// Firebase (identitytoolkit, securetoken) y la app parece sin permiso de Google.
//   python3 -m http.server 8099 -d web &
//   PUPPETEER=<carpeta>/node_modules/puppeteer-core node tools/prueba_contactos_google.js
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const fallos = [];
const ok = (c, t) => { console.log((c ? "BIEN " : "FALLO ") + t); if (!c) fallos.push(t); };
(async () => {
  const b = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]});
  const p = await b.newPage();
  const pedidos = [];
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = r.url(), m = r.method();
    if (/huggingface|hf\.co|jsdelivr/.test(u)) return r.abort();
    if (u.startsWith("http://localhost")) return r.continue();
    const cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS"};
    if (m === "OPTIONS") return r.respond({status: 204, headers: cors, body: ""});
    const json = (o) => r.respond({status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(o)});
    if (/generativelanguage|firebasevertexai|firebaseml/.test(u)) return json({candidates: [{content: {role: "model", parts: [{text: "Listo."}]}, finishReason: "STOP"}]});
    if (u.includes("tokeninfo")) return json({scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/contacts.readonly", expires_in: "3000", email: "prueba@example.com"});
    if (u.includes("people.googleapis.com")) {
      pedidos.push(u);
      if (u.includes("pageToken=p2")) return json({connections: [{names: [{displayName: "Carla Prueba"}], emailAddresses: [{value: "carla-prueba@example.com"}]}]});
      return json({connections: [
        {names: [{displayName: "Ana Prueba"}], emailAddresses: [{value: "ana-prueba@example.com"}]},
        {names: [{displayName: "Luis Prueba"}], phoneNumbers: [{value: "300 111 2222"}]},
        {names: [{displayName: "Sin datos"}]},
        {names: [{displayName: "Celular malo"}], phoneNumbers: [{value: "12"}]}],
        nextPageToken: "p2"});
    }
    if (/gmail\.googleapis\.com|googleapis\.com\/calendar|googleapis\.com\/oauth2/.test(u)) return json({});   // la sesion de Firebase (identitytoolkit, securetoken) pasa
    r.continue();
  });
  await p.goto("http://localhost:8099/?nube=anonimo", {waitUntil: "load", timeout: 60000});
  await esperar(9000);
  await p.evaluate((alc) => localStorage.setItem("pixel.google", JSON.stringify({uid: nube.uid, token: "falso", vence: Date.now() + 3600000, alcances: alc, email: "prueba@example.com"})),
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/contacts.readonly");
  await p.reload({waitUntil: "load"});
  await esperar(9000);
  await p.evaluate(() => { document.querySelector('[data-vista="contactos"], #tab-contactos, a[href="#contactos"]')?.click(); });
  await esperar(1000);
  await p.evaluate(() => document.getElementById("ct-google").click());
  await esperar(6000);
  const estado = await p.evaluate(() => document.getElementById("ct-google-estado").textContent);
  ok(/Listo: guardé 3 de 5/.test(estado), "el botón dice: " + estado);
  ok(pedidos.length === 2, "pidió las 2 páginas de contactos (hubo " + pedidos.length + ")");
  const guardados = await p.evaluate(() => PixelContactos.lista().map((c) => c.nombre + " " + (c.correo || c.telefono)));
  console.log("Contactos en Píxel:", JSON.stringify(guardados));
  ok(guardados.some((x) => /Ana Prueba/.test(x)) && guardados.some((x) => /Carla Prueba/.test(x)) && guardados.some((x) => /Luis Prueba/.test(x)), "están Ana, Luis y Carla");
  ok(!guardados.some((x) => /Sin datos|Celular malo/.test(x)), "no guarda los incompletos ni el celular malo");
  await b.close();
  console.log(fallos.length ? fallos.length + " FALLO(S)" : "TODO BIEN");
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error("ERROR DE LA PRUEBA", e.message); process.exit(2); });
