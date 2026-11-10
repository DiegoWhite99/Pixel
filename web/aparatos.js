/* Fase 13 - Aparatos de la casa: Pixel los maneja a traves de un puente.
   El navegador no puede hablar con los aparatos de la red de casa ni mandar infrarrojo, asi que la
   orden va por Firebase a un "puente" que esta en la casa y la ejecuta:
     - el ESP32 (firmware Pixel_portal con la parte de puente): infrarrojo, rele, Wake-on-LAN y http;
     - el PC con el servidor (nube.py + control_pc.py + tv_android.py): el propio PC (volumen, musica,
       bloquear...), un TV Android/Google TV por WiFi, Wake-on-LAN y http.
   Un puente es un Pixel enlazado a la cuenta (usuarios/<uid>/pixeles/<pid>) y recibe ordenes igual
   que el PC: pixeles/<pid>/ordenes/<id> = {uid, ruta, cuerpo (JSON)} -> pixeles/<pid>/respuestas/<id>.
   Sus capacidades salen de su estado (pixeles/<pid>/estado: el del PC trae "puente"; el del ESP32
   es {tipo: "puente", capacidades}).
   Los aparatos: usuarios/<uid>/aparatos/<aid> = {nombre, tipo, metodo, puente, config, acciones}.
   El ESP32 se agrega por Bluetooth desde el celular (Web Bluetooth, Chrome en Android).
   Al cargarse no toca la pagina: las funciones de texto (PixelAparatos.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo, T = A.texto, plano = T.plano;

  // El mismo servicio BLE que anuncia Pixel_portal.ino; "nube" es la caracteristica para enlazarlo
  const BLE_SERVICIO = "6e400001-8f4d-4b7a-9c9a-70697865c000";
  const BLE_NUBE = "6e400003-8f4d-4b7a-9c9a-70697865c000";
  const VIVO_MS = 45000;                       // un puente esta en linea si su latido es de hace menos de esto

  const TIPOS = {tv: "TV", pc: "PC", luz: "Luz o lámpara", enchufe: "Enchufe", aire: "Aire acondicionado", ventilador: "Ventilador", otro: "Otro"};
  const METODOS = {
    pc: {nombre: "Es el PC de Píxel", sub: "volumen, música, YouTube, bloquear y suspender", cap: "pc"},
    atv: {nombre: "TV Android o Google TV por WiFi", sub: "lo maneja el PC; se empareja con un código", cap: "atv"},
    ir: {nombre: "Infrarrojo, como su control remoto", sub: "el ESP32 aprende los botones del control", cap: "ir"},
    rele: {nombre: "Relé del ESP32", sub: "enciende y apaga lo que esté conectado al relé", cap: "rele"},
    wol: {nombre: "Encender por red (Wake-on-LAN)", sub: "despierta un PC con su MAC", cap: "wol"},
    http: {nombre: "Enchufe o luz WiFi (dirección web)", sub: "Shelly, Tasmota y parecidos: una URL para cada acción", cap: "http"},
  };
  // Para encontrar "la tele", "el computador"... aunque el aparato se llame de otra forma
  const SINONIMOS = {
    tv: ["tele", "tv", "televisor", "television", "televisión", "pantalla"],
    pc: ["pc", "computador", "computadora", "ordenador", "portatil", "portátil", "compu"],
    luz: ["luz", "luces", "lampara", "lámpara", "bombillo", "foco", "bombilla"],
    enchufe: ["enchufe", "toma", "tomacorriente"],
    aire: ["aire", "clima", "acondicionado"],
    ventilador: ["ventilador", "abanico"],
  };
  const TECLAS_TV = {encender: "WAKEUP", apagar: "SLEEP", alternar: "POWER", subir_volumen: "VOLUME_UP", bajar_volumen: "VOLUME_DOWN",
    silenciar: "VOLUME_MUTE", pausa: "MEDIA_PLAY_PAUSE", play: "MEDIA_PLAY_PAUSE", siguiente: "MEDIA_NEXT", anterior: "MEDIA_PREVIOUS",
    inicio: "HOME", atras: "BACK", arriba: "DPAD_UP", abajo: "DPAD_DOWN", izquierda: "DPAD_LEFT", derecha: "DPAD_RIGHT", ok: "DPAD_CENTER",
    canal_mas: "CHANNEL_UP", canal_menos: "CHANNEL_DOWN", entrada: "TV_INPUT"};
  const ACCIONES_PC = ["encender", "apagar", "subir_volumen", "bajar_volumen", "volumen", "silenciar", "pausa", "play", "siguiente",
    "anterior", "abrir", "youtube", "bloquear", "suspender", "apagar_pantalla"];
  const ACCIONES = [...new Set(["encender", "apagar", "alternar"].concat(Object.keys(TECLAS_TV), ACCIONES_PC))];
  const PIDEN_SI = new Set(["suspender"]);       // y "apagar" en un PC: se confirma antes
  const DICHO = {encender: "encendí", apagar: "apagué", alternar: "cambié", subir_volumen: "subí el volumen de", bajar_volumen: "bajé el volumen de",
    volumen: "puse el volumen de", silenciar: "silencié", pausa: "pausé", play: "le di play a", siguiente: "pasé a lo siguiente en",
    anterior: "volví a lo anterior en", abrir: "abrí", youtube: "puse YouTube en", bloquear: "bloqueé", suspender: "suspendí",
    apagar_pantalla: "apagué la pantalla de", inicio: "fui al inicio en", atras: "volví atrás en", entrada: "cambié la entrada de",
    canal_mas: "subí el canal de", canal_menos: "bajé el canal de"};

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  function buscarAparato(aparatos, q) {
    let mejor = null, nota = 0;
    for (const a of aparatos) {
      const n = T.parecido(q, a.nombre);
      if (n > nota) { mejor = a; nota = n; }
    }
    if (nota >= 0.5) return mejor;
    const p = plano(q);
    for (const [tipo, palabras] of Object.entries(SINONIMOS)) {
      if (palabras.some((w) => new RegExp("\\b" + plano(w) + "\\b").test(p))) {
        const delTipo = aparatos.filter((a) => a.tipo === tipo || palabras.some((w) => new RegExp("\\b" + plano(w)).test(plano(a.nombre))));
        if (delTipo.length) return delTipo[0];
      }
    }
    return null;
  }

  // Lo que hay que mandar, y a que puente, para hacer "accion" con el aparato. null: no sabe hacerlo.
  // Una accion propia (acciones[accion]) manda sobre el metodo del aparato: asi un PC se maneja con
  // el puente del PC pero se enciende por Wake-on-LAN desde el ESP32.
  function plan(a, accion, valor) {
    const propia = (a.acciones && a.acciones[accion]) || null, cfg = a.config || {};
    const metodo = (propia && propia.metodo) || a.metodo, puente = (propia && propia.puente) || a.puente;
    const con = (o) => (valor !== undefined && valor !== null && valor !== "" ? Object.assign(o, {valor}) : o);
    switch (metodo) {
      case "pc": return {puente, ruta: "/api/pc", cuerpo: con({accion})};
      case "atv":
        if (accion === "abrir" || accion === "youtube") return {puente, ruta: "/api/tv", cuerpo: con({ip: cfg.ip, abrir: accion === "youtube" ? "youtube" : String(valor || "")})};
        return TECLAS_TV[accion] ? {puente, ruta: "/api/tv", cuerpo: {ip: cfg.ip, tecla: TECLAS_TV[accion]}} : null;
      case "rele": {
        const e = {encender: 1, apagar: 0, alternar: -1}[accion];
        if (e === undefined) return null;
        const c = {metodo: "rele", pin: cfg.pin, estado: e};
        if (cfg.invertido) c.invertido = true;          // modulos que se activan con nivel bajo
        return {puente, ruta: "/api/aparato", cuerpo: c};
      }
      case "wol": return accion === "encender" ? {puente, ruta: "/api/aparato", cuerpo: {metodo: "wol", mac: (propia && propia.mac) || cfg.mac}} : null;
      case "ir": return propia && propia.codigo ? {puente, ruta: "/api/aparato", cuerpo: {metodo: "ir", codigo: propia.codigo}} : null;
      case "http": return propia && propia.url ? {puente, ruta: "/api/aparato", cuerpo: {metodo: "http", url: propia.url}} : null;
    }
    return null;
  }

  // "Tele de la sala" -> "la tele de la sala"; "PC" -> "el PC". Las siglas se quedan en mayusculas.
  const FEMENINAS = /^(lampara|luz|luces|tele|television|pantalla|computadora|toma|bombilla|lavadora|nevera|cafetera|radio|consola|impresora|camara)\b/;
  function conArticulo(nombre) {
    const n = String(nombre || "").trim(), p = plano(n);
    if (/^(el|la|los|las|mi|mis)\s/.test(p)) return n.replace(/^\S+/, (w) => w.toLowerCase());
    const primera = n.split(/\s+/)[0];
    const suave = primera === primera.toUpperCase() && primera.length > 1 ? n : n.charAt(0).toLowerCase() + n.slice(1);
    return (FEMENINAS.test(p) ? "la " : "el ") + suave;
  }

  // Las acciones que sabe hacer un aparato
  function accionesDe(a) {
    const propias = Object.keys(a.acciones || {});
    const base = a.metodo === "pc" ? ACCIONES_PC.filter((x) => x !== "encender") : a.metodo === "atv" ? Object.keys(TECLAS_TV).concat(["abrir", "youtube"])
      : a.metodo === "rele" ? ["encender", "apagar", "alternar"] : a.metodo === "wol" ? ["encender"] : [];
    return [...new Set(base.concat(propias))];
  }

  // ------------------------------------------------------------------ estado y nube
  const ap = {aparatos: null, puentes: {}, quitar: [], quitarPuentes: {}, pintado: "", pintadoP: ""};
  const ref = (sub) => nube.d.ref(nube.db, sub);
  const lista = () => ap.aparatos || [];
  const enLinea = (pid) => { const p = ap.puentes[pid]; return !!p && !!p.vivo && Date.now() + (nube.offset || 0) - p.vivo < VIVO_MS; };
  const capacidades = (pid) => ((ap.puentes[pid] && ap.puentes[pid].capacidades) || []);
  const nombrePuente = (pid) => { const p = ap.puentes[pid]; return p ? p.nombre : "el puente"; };

  function alUsuario(u) {
    ap.quitar.forEach((f) => f());
    Object.values(ap.quitarPuentes).forEach((fs) => fs.forEach((f) => f()));
    Object.assign(ap, {quitar: [], quitarPuentes: {}, puentes: {}, aparatos: null, pintado: "", pintadoP: ""});
    if (!u) { pintar(); return; }
    ap.quitar.push(nube.d.onValue(ref(`usuarios/${nube.uid}/aparatos`), (s) => {
      const v = s.val() || {};
      ap.aparatos = Object.entries(v).filter(([, a]) => a && a.nombre).map(([id, a]) => Object.assign({id}, a));
      pintar();
    }, (e) => { console.warn("aparatos:", e); ap.aparatos = []; pintar(); }));
    ap.quitar.push(nube.d.onValue(ref(`usuarios/${nube.uid}/pixeles`), (s) => {
      const mios = s.val() || {};
      for (const pid of Object.keys(ap.quitarPuentes)) {           // los que ya no estan
        if (!mios[pid]) { ap.quitarPuentes[pid].forEach((f) => f()); delete ap.quitarPuentes[pid]; delete ap.puentes[pid]; }
      }
      for (const [pid, info] of Object.entries(mios)) {
        if (ap.quitarPuentes[pid]) continue;
        ap.puentes[pid] = {nombre: (info && info.nombre) || "Píxel", tipo: (info && info.tipo) || "pc", vivo: 0, capacidades: []};
        ap.quitarPuentes[pid] = [
          nube.d.onValue(ref(`pixeles/${pid}/vivo`), (x) => { ap.puentes[pid].vivo = x.val() || 0; pintar(); }, () => {}),
          nube.d.onValue(ref(`pixeles/${pid}/estado`), (x) => {
            const v = x.val();
            if (!v || !v.json) return;
            try {
              const e = JSON.parse(v.json), p = e.puente || e;          // el PC lo trae en "puente"; el ESP32 es todo puente
              Object.assign(ap.puentes[pid], {capacidades: p.capacidades || [], tvs: p.tvs || [], mac: p.mac || "", ip: p.ip || (e.servidor && e.servidor.ip) || "",
                panel: (e.servidor && e.servidor.panel) || 0, version: p.version || "", rssi: p.rssi || 0,
                ir_rx: !!p.ir_rx, wifi: (e.wifi && e.wifi.dispositivos) || []});
            } catch (er) { /* estado roto: se ignora */ }
            pintar();
          }, () => {}),
        ];
      }
      pintar();
    }, () => {}));
  }

  // Manda una orden a un puente y espera su respuesta ({ok, mensaje, ...}). esperarRespuesta es de app.js.
  async function mandar(pid, ruta, cuerpo, ms) {
    if (!ap.puentes[pid]) throw new Error("Ese puente ya no está enlazado.");
    if (!enLinea(pid)) throw new Error(`${nombrePuente(pid)} no está conectado. ¿Está encendido y con internet?`);
    const r = nube.d.push(ref(`pixeles/${pid}/ordenes`));
    await N.conTiempo(nube.d.set(r, {uid: nube.uid, ruta, cuerpo: JSON.stringify(cuerpo || {}), t: nube.d.serverTimestamp()}), 8000);
    return esperarRespuesta(pid, r.key, "", ms || 15000);
  }

  // ------------------------------------------------------------------ probar un puente (Fase 14)
  // De punta a punta y sin piezas: la orden va por internet (Firebase) y la respuesta vuelve.
  //  - ESP32: 1) una orden que no existe ("/api/eco"): si contesta "esa orden no existe", recibe y
  //    contesta; 2) que pida una pagina al panel del PC por el WiFi de casa (orden http): llega a la
  //    red de casa, que es lo que necesita para encender el PC por red o hablar con aparatos WiFi.
  //  - PC: /api/pc {accion: "probar"} (solo lee): volumen, musica y si el TV esta emparejado.
  // Devuelve [{ok, texto}] (una linea por paso) y un resumen para decir.
  async function probarPuente(pid) {
    const p = ap.puentes[pid], pasos = [];
    if (!p) return {pasos: [{ok: false, texto: "Ese puente ya no está enlazado."}], resumen: "Ese puente ya no está enlazado."};
    const seg = (t0) => `${((Date.now() - t0) / 1000).toFixed(1).replace(".", ",")} s`;
    if (!enLinea(pid)) {
      pasos.push({ok: false, texto: `Sin latido: ${p.tipo === "puente" ? "¿el ESP32 está encendido y con WiFi?" : "¿el PC está encendido con el servidor?"}`});
      return {pasos, resumen: `${p.nombre} no está conectado.`};
    }
    pasos.push({ok: true, texto: "En línea (manda su latido)"});
    if (p.tipo === "puente") {
      let t0 = Date.now();
      try { await mandar(pid, "/api/eco", {}, 15000); pasos.push({ok: true, texto: `Recibe órdenes y contesta (${seg(t0)})`}); } catch (e) {
        const m = String(e.message || e);
        if (/no existe/.test(m)) pasos.push({ok: true, texto: `Recibe órdenes y contesta (${seg(t0)})`});
        else if (/dueña/.test(m)) { pasos.push({ok: false, texto: "No te reconoce como dueño: vuelve a enlazarlo por Bluetooth"}); return {pasos, resumen: "El ESP32 no me reconoce como su dueño."}; }
        else { pasos.push({ok: false, texto: "No contestó la orden: " + m}); return {pasos, resumen: "El ESP32 no contestó."}; }
      }
      const pc = Object.entries(ap.puentes).find(([id, x]) => x.tipo !== "puente" && x.ip && enLinea(id));
      if (pc) {
        t0 = Date.now();
        try {
          await mandar(pid, "/api/aparato", {metodo: "http", url: `http://${pc[1].ip}:${pc[1].panel || 8080}/api/voz`}, 20000);
          pasos.push({ok: true, texto: `Llega a tu red de casa: habló con el PC (${pc[1].ip}) en ${seg(t0)}`});
        } catch (e) { pasos.push({ok: false, texto: "No llegó al PC por el WiFi de casa: " + (e.message || e)}); }
      } else pasos.push({ok: null, texto: "La red de casa no se probó: hace falta el PC en línea"});
      pasos.push({ok: null, texto: `Piezas: emisor infrarrojo en IO${16}, receptor en IO${15} y relé en un pin libre. Sin ellas, puede encender el PC por red.`});
      if (p.version) pasos.push({ok: null, texto: `Programa del puente ${p.version}${p.rssi ? ` · WiFi ${p.rssi} dBm` : ""}`});
    } else {
      const t0 = Date.now();
      try {
        const r = await mandar(pid, "/api/pc", {accion: "probar"}, 15000);
        let d = {};
        try { d = JSON.parse(r.resultados || "{}"); } catch (e) { d = {}; }
        pasos.push({ok: true, texto: `Contesta órdenes (${seg(t0)})`});
        pasos.push({ok: d.volumen !== null && d.volumen !== undefined, texto: d.volumen !== null && d.volumen !== undefined ? `Volumen del PC: ${d.volumen} %` : "No pude leer el volumen (pactl)"});
        pasos.push({ok: !/sin playerctl/.test(d.musica || ""), texto: `Música: ${d.musica === "nada abierto" ? "no hay ningún reproductor abierto" : d.musica || "?"}`});
        pasos.push({ok: /emparejado/.test(d.tv || "") && !/sin/.test(d.tv || ""), texto: `TV Android: ${d.tv || "?"}`});
      } catch (e) {
        pasos.push({ok: false, texto: "No contestó: " + (e.message || e)});
        return {pasos, resumen: "El PC no contestó."};
      }
    }
    const malos = pasos.filter((x) => x.ok === false).length;
    return {pasos, resumen: malos ? `${p.nombre}: ${malos} cosa${malos === 1 ? "" : "s"} por revisar. Te dejo el detalle en Dispositivos.`
      : `${p.nombre} funciona: recibe las órdenes y contesta.`};
  }

  function pintarPrueba(pid, r) {
    const caja = $("#ap-prueba");
    if (!caja) return;
    const p = ap.puentes[pid];
    caja.hidden = false;
    caja.innerHTML = r ? `<b>Prueba de ${esc(p ? p.nombre : "puente")}</b><ul>${r.pasos.map((x) => `<li class="${x.ok === true ? "ok" : x.ok === false ? "mal" : ""}">${esc(x.texto)}</li>`).join("")}</ul>`
      : `<div class="buscando"><span class="giro"></span>Probando ${esc(p ? p.nombre : "el puente")}…</div>`;
  }

  async function hacer(a, accion, valor) {
    const pl = plan(a, accion, valor);
    if (!pl) {
      const de = ("de " + conArticulo(a.nombre)).replace(/^de el /, "del ");
      if (a.metodo === "ir") return `Todavía no sé el botón «${accion.replace(/_/g, " ")}» ${de}. Enséñamelo en Dispositivos con «Aprender botón».`;
      return `No sé hacer «${accion.replace(/_/g, " ")}» con ${conArticulo(a.nombre)}.`;
    }
    if (!pl.puente) return `${a.nombre} no tiene puente asignado. Edítalo en Dispositivos.`;
    try {
      const r = await mandar(pl.puente, pl.ruta, pl.cuerpo);
      return r.decir || `Listo, ${DICHO[accion] || "hice eso con"} ${conArticulo(a.nombre)}.`;
    } catch (e) {
      return String(e.message || e).replace(/^Píxel no contestó.*/, `${nombrePuente(pl.puente)} no contestó. ¿Está encendido y con internet?`);
    }
  }

  // ------------------------------------------------------------------ herramientas para Gemini
  const HERRAMIENTAS = [
    {name: "controlar_aparato", description: "Maneja un aparato de la casa (TV, PC, luz, enchufe, aire, ventilador) a través del puente (el ESP32 o el PC de Píxel). Llámala siempre que pida algo a un aparato, aunque creas que no sabe hacerlo: la app le explica qué falta.",
      parameters: {type: "object", properties: {
        aparato: {type: "string", description: "Cómo lo nombra el usuario: 'la tele', 'el PC', 'la lámpara del cuarto'."},
        accion: {type: "string", enum: ACCIONES},
        valor: {type: "string", description: "Solo si hace falta: el volumen de 0 a 100, la app o la página que abrir, o qué buscar en YouTube."}},
      required: ["aparato", "accion"]}},
    {name: "ver_aparatos", description: "Lista los aparatos que Píxel puede manejar, qué sabe hacer con cada uno y si su puente está conectado."},
  ];

  async function ejecutar(nombre, a) {
    if (nombre === "ver_aparatos") {
      return {respuesta: {aparatos: lista().map((x) => ({nombre: x.nombre, tipo: TIPOS[x.tipo] || x.tipo, puede: accionesDe(x), conectado: enLinea(x.puente)})),
        puentes: Object.entries(ap.puentes).map(([pid, p]) => ({nombre: p.nombre, conectado: enLinea(pid)})),
        nota: lista().length ? "" : "No hay aparatos: se agregan en la página Dispositivos."}};
    }
    if (nombre !== "controlar_aparato") return undefined;
    if (!lista().length) return "Todavía no tengo aparatos. Agrégalos en la página Dispositivos.";
    const x = buscarAparato(lista(), String(a.aparato || ""));
    if (!x) return `No encuentro ${a.aparato} entre tus aparatos. Tengo: ${lista().map((y) => y.nombre).join(", ")}.`;
    const accion = ACCIONES.includes(a.accion) ? a.accion : "";
    if (!accion) return "¿Qué quieres que haga?";
    const real = x.metodo === "pc" && accion === "apagar" ? "suspender" : accion;   // un PC se suspende: asi se puede despertar
    if (PIDEN_SI.has(real)) {
      N.confirmar({pregunta: `¿Suspendo ${x.nombre}?`, titulo: `Suspender ${x.nombre}`, boton: "Sí, suspender",
        si: /^(si|dale|claro|hazlo|confirmo|correcto|ok|okay|suspendelo|apagalo)\b/, hacer: () => hacer(x, real, a.valor)});
      return `¿Suspendo ${x.nombre}? Para volver a encenderlo hace falta Wake-on-LAN.`;
    }
    return hacer(x, real, a.valor);
  }

  // ------------------------------------------------------------------ agregar el ESP32 por Bluetooth (Web Bluetooth)
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function leerBle(c) { try { return JSON.parse(dec.decode(await c.readValue())); } catch (e) { return {}; } }

  async function agregarEsp32() {
    const caja = $("#ap-ble");
    const paso = (h) => { caja.innerHTML = h; caja.hidden = false; };
    if (!navigator.bluetooth) { paso('<p class="aviso">Este navegador no tiene Bluetooth web. Usa Chrome en Android (o en el PC).</p>'); return; }
    let disp;
    try {
      disp = await navigator.bluetooth.requestDevice({filters: [{services: [BLE_SERVICIO]}], optionalServices: [BLE_SERVICIO]});
    } catch (e) { if (e.name !== "NotFoundError") paso(`<p class="aviso">${esc(e.message)}</p>`); return; }
    try {
      paso('<div class="buscando"><span class="giro"></span>Conectando con ' + esc(disp.name || "Píxel") + "…</div>");
      const gatt = await disp.gatt.connect();
      const c = await (await gatt.getPrimaryService(BLE_SERVICIO)).getCharacteristic(BLE_NUBE);
      let info = await leerBle(c);
      if (!info.wifi) {
        // sin WiFi: se le pasa la red desde aqui (sin el portal)
        const red = await pedirWifi(paso, info.red || "");
        if (!red) { gatt.disconnect(); caja.hidden = true; return; }
        await c.writeValue(enc.encode(JSON.stringify({ssid: red.ssid, clave: red.clave})));
        paso('<div class="buscando"><span class="giro"></span>El ESP32 se está conectando a ' + esc(red.ssid) + "…</div>");
      }
      // espera a que tenga WiFi y su cuenta de Firebase (la crea al tener internet)
      const t0 = Date.now();
      while (Date.now() - t0 < 45000 && (!info.wifi || !info.id)) { await N.esperar(2000); info = await leerBle(c); }
      if (!info.wifi) throw new Error("El ESP32 no pudo conectarse a esa red WiFi. Revisa el nombre y la clave.");
      if (!info.id) throw new Error("El ESP32 tiene WiFi pero no llega a internet (Firebase).");
      if (info.dueno && !info.emparejar && !(nube.mios && nube.mios[info.id])) {
        throw new Error("Este ESP32 ya tiene dueño. Pulsa una vez su botón BOOT (el LED parpadea en azul) y vuelve a intentarlo.");
      }
      await c.writeValue(enc.encode(JSON.stringify({dueno: nube.uid, nombre: (nube.usuario && (nube.usuario.displayName || nube.usuario.email)) || "Píxel app"})));
      paso('<div class="buscando"><span class="giro"></span>Enlazando el ESP32 con tu cuenta…</div>');
      const t1 = Date.now();
      while (Date.now() - t1 < 30000 && !ap.puentes[info.id]) await N.esperar(1000);
      gatt.disconnect();
      if (!ap.puentes[info.id]) throw new Error("El ESP32 no confirmó el enlace. Mira que tenga internet e inténtalo otra vez.");
      paso('<div class="vacio" style="border-style:solid;background:var(--green-soft);color:var(--green);font-weight:650">¡Listo! El ESP32 ya es tu puente. Ahora agrega los aparatos que maneja.</div>');
    } catch (e) {
      try { if (disp && disp.gatt.connected) disp.gatt.disconnect(); } catch (er) { /* nada */ }
      paso(`<p class="aviso">${esc(e.message || e)}</p>`);
    }
  }

  function pedirWifi(paso, red) {
    return new Promise((ok) => {
      paso(`<form class="grupo" id="ap-wifi"><p class="sub">El ESP32 aún no tiene WiFi. ¿A qué red lo conecto? (Solo redes de 2,4 GHz.)</p>
        <div class="form-fila"><label class="campo">Red WiFi<input type="text" id="ap-ssid" maxlength="32" value="${esc(red)}" required></label>
        <label class="campo">Clave<input type="password" id="ap-clave" maxlength="64"></label>
        <button class="btn primario" type="submit">Conectar</button></div>
        <button class="btn" type="button" id="ap-wifi-no">Cancelar</button></form>`);
      $("#ap-wifi").addEventListener("submit", (e) => { e.preventDefault(); ok({ssid: $("#ap-ssid").value.trim(), clave: $("#ap-clave").value}); });
      $("#ap-wifi-no").addEventListener("click", () => ok(null));
    });
  }

  // ------------------------------------------------------------------ pantalla (Dispositivos)
  const ICONO = {tv: "M3 5h18v12H3zM8 21h8", pc: "M3 4h18v12H3zM8 20h8M12 16v4", luz: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
    enchufe: "M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3", aire: "M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8",
    ventilador: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10c0-4 1-7 4-7s2 5-2 7M14 12c4 0 7 1 7 4s-5 2-7-2M12 14c0 4-1 7-4 7s-2-5 2-7M10 12c-4 0-7-1-7-4s5-2 7 2", otro: "M4 4h16v16H4z"};
  const svg = (t) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONO[t] || ICONO.otro}"/></svg>`;
  const RAPIDAS = {tv: ["encender", "apagar", "bajar_volumen", "subir_volumen", "pausa"], pc: ["bajar_volumen", "subir_volumen", "pausa", "bloquear"],
    luz: ["encender", "apagar"], enchufe: ["encender", "apagar"], aire: ["encender", "apagar"], ventilador: ["encender", "apagar"], otro: ["encender", "apagar"]};
  const ETIQUETA = {encender: "Encender", apagar: "Apagar", bajar_volumen: "Vol −", subir_volumen: "Vol +", pausa: "⏯", bloquear: "Bloquear"};

  function pintar() {
    if (!document.getElementById("card-aparatos")) return;
    const u = nube.usuario;
    $("#card-aparatos").hidden = !u;
    $("#card-puentes").hidden = !u;
    // lo del Pixel del PC (Bluetooth y WiFi del PC, ESP32 conectados al servidor) solo si hay PC enlazado
    document.querySelectorAll("#v-dispositivos .solo-pc").forEach((e) => { e.hidden = !nube.estado; });
    if (!u) return;
    const ps = Object.entries(ap.puentes);
    const hp = ps.length ? ps.map(([pid, p]) => `<div class="fila"><span class="ico ${enLinea(pid) ? "verde" : ""}">${svg(p.tipo === "puente" ? "otro" : "pc")}</span>
        <div class="txt"><b>${esc(p.nombre)}</b><small>${p.tipo === "puente" ? "ESP32" : "PC con el servidor"} · ${enLinea(pid) ? "conectado" : "desconectado"}${p.capacidades.length ? " · " + esc(p.capacidades.join(", ")) : ""}</small></div>
        <span class="chip ${enLinea(pid) ? "ok" : "warn"}">${enLinea(pid) ? "En línea" : "Sin conexión"}</span>
        <button class="btn suave" type="button" data-probar-puente="${esc(pid)}">Probar</button></div>`).join("")
      : '<div class="vacio">Aún no hay puentes. Agrega el ESP32 por Bluetooth, o enlaza el PC en Cuentas.</div>';
    if (hp !== ap.pintadoP) { $("#ap-puentes").innerHTML = hp; ap.pintadoP = hp; pintarFormulario(); }
    const xs = ap.aparatos;
    const h = xs === null ? '<div class="vacio">Cargando…</div>' : xs.length ? xs.map((a) => {
      const acc = accionesDe(a), rapidas = (RAPIDAS[a.tipo] || RAPIDAS.otro).filter((r) => acc.includes(r) || (a.metodo === "pc" && r === "encender" && a.acciones && a.acciones.encender));
      return `<div class="fila aparato"><span class="ico ${enLinea(a.puente) ? "verde" : ""}">${svg(a.tipo)}</span>
        <div class="txt"><b>${esc(a.nombre)}</b><small>${esc((METODOS[a.metodo] || {}).nombre || a.metodo)} · ${esc(nombrePuente(a.puente))}${enLinea(a.puente) ? "" : " (sin conexión)"}</small></div>
        <div class="acciones">${rapidas.map((r) => `<button class="btn" type="button" data-ap="${esc(a.id)}" data-accion="${r}">${ETIQUETA[r] || r}</button>`).join("")}
        <button class="btn suave" type="button" data-ap-mas="${esc(a.id)}">⋯</button></div>
        <div class="ap-mas" id="ap-mas-${esc(a.id)}" hidden>${masDe(a)}</div></div>`;
    }).join("") : '<div class="vacio">Aún no hay aparatos. Agrega la tele, el PC, una lámpara…</div>';
    if (h !== ap.pintado) {
      const abiertos = [...document.querySelectorAll(".ap-mas:not([hidden])")].map((e) => e.id);
      $("#ap-lista").innerHTML = h;
      abiertos.forEach((id) => { const e = document.getElementById(id); if (e) e.hidden = false; });
      ap.pintado = h;
    }
  }

  // Lo de "⋯": aprender botones (infrarrojo), emparejar (TV Android), borrar
  function masDe(a) {
    let h = "";
    if (a.metodo === "ir") {
      const sabidos = Object.keys(a.acciones || {});
      h += `<p class="sub">Botones aprendidos: ${sabidos.length ? esc(sabidos.join(", ").replace(/_/g, " ")) : "ninguno"}.</p>
        <div class="form-linea"><select data-ap-boton="${esc(a.id)}">${["encender", "apagar", "subir_volumen", "bajar_volumen", "silenciar", "canal_mas", "canal_menos", "entrada", "ok", "pausa"]
          .map((x) => `<option value="${x}">${x.replace(/_/g, " ")}</option>`).join("")}</select>
        <button class="btn primario" type="button" data-ap-aprender="${esc(a.id)}">Aprender botón</button></div>`;
    }
    if (a.metodo === "atv") h += `<div class="form-linea"><button class="btn" type="button" data-ap-emparejar="${esc(a.id)}">Emparejar con el TV</button>
      <input type="text" data-ap-codigo="${esc(a.id)}" maxlength="6" placeholder="Código del TV" hidden><button class="btn primario" type="button" data-ap-enviar-codigo="${esc(a.id)}" hidden>Enviar código</button></div>`;
    if (a.metodo === "pc") {
      const enc = a.acciones && a.acciones.encender;
      h += `<p class="sub">${enc ? "Se enciende por red desde " + esc(nombrePuente(enc.puente)) + "." : "Para encenderlo por voz, activa Wake-on-LAN en su BIOS y agrega su MAC:"}</p>`;
      if (!enc) h += `<div class="form-linea"><input type="text" data-ap-mac="${esc(a.id)}" placeholder="MAC, ej. aa:bb:cc:dd:ee:ff" value="${esc(ap.puentes[a.puente] ? ap.puentes[a.puente].mac : "")}">
        <button class="btn" type="button" data-ap-wol="${esc(a.id)}">Guardar</button></div>`;
    }
    return h + `<div class="acciones"><button class="btn peligro" type="button" data-ap-borrar="${esc(a.id)}">Borrar aparato</button></div>`;
  }

  // El formulario de "Agregar aparato": solo los metodos que tiene algun puente
  function pintarFormulario() {
    const sel = $("#ap-metodo"), actual = sel.value;
    const opciones = Object.entries(METODOS).map(([k, m]) => {
      const con = Object.keys(ap.puentes).filter((pid) => capacidades(pid).includes(m.cap));
      return `<option value="${k}" ${con.length ? "" : "disabled"}>${esc(m.nombre)}${con.length ? "" : " (sin puente)"}</option>`;
    }).join("");
    sel.innerHTML = opciones;
    if (actual && sel.querySelector(`option[value="${actual}"]:not([disabled])`)) sel.value = actual;
    else { const o = sel.querySelector("option:not([disabled])"); if (o) sel.value = o.value; }
    camposMetodo();
  }

  function camposMetodo() {
    const m = $("#ap-metodo").value, cap = (METODOS[m] || {}).cap;
    const ps = Object.keys(ap.puentes).filter((pid) => capacidades(pid).includes(cap));
    $("#ap-puente").innerHTML = ps.map((pid) => `<option value="${esc(pid)}">${esc(nombrePuente(pid))}${enLinea(pid) ? "" : " (sin conexión)"}</option>`).join("");
    $("#ap-campo-ip").hidden = m !== "atv";
    $("#ap-campo-pin").hidden = m !== "rele";
    $("#ap-campo-mac").hidden = m !== "wol";
    $("#ap-campo-url").hidden = m !== "http";
    $("#ap-metodo-sub").textContent = (METODOS[m] || {}).sub || "";
    const tvs = ps.flatMap((pid) => (ap.puentes[pid].wifi || []).filter((w) => w.tipo === "tv")).map((w) => w.ip);
    $("#ap-ip").placeholder = tvs[0] || "192.168.1.50";
  }

  async function guardarAparato(e) {
    e.preventDefault();
    const m = $("#ap-metodo").value;
    const a = {nombre: $("#ap-nombre").value.trim().slice(0, 60), tipo: $("#ap-tipo").value, metodo: m, puente: $("#ap-puente").value, config: {}, acciones: {}, creado: nube.d.serverTimestamp()};
    if (!a.nombre || !a.puente) { toast("Falta el nombre o un puente que lo maneje.", true); return; }
    if (m === "atv") a.config.ip = $("#ap-ip").value.trim() || $("#ap-ip").placeholder;
    if (m === "rele") { a.config.pin = Number($("#ap-pin").value) || 18; if ($("#ap-invertido").checked) a.config.invertido = true; }
    if (m === "wol") a.config.mac = $("#ap-mac").value.trim().toLowerCase();
    if (m === "http") {
      if ($("#ap-url-on").value.trim()) a.acciones.encender = {url: $("#ap-url-on").value.trim()};
      if ($("#ap-url-off").value.trim()) a.acciones.apagar = {url: $("#ap-url-off").value.trim()};
    }
    if (m === "wol" && !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(a.config.mac)) { toast("La MAC no es válida (aa:bb:cc:dd:ee:ff).", true); return; }
    try {
      await N.conTiempo(nube.d.set(nube.d.push(ref(`usuarios/${nube.uid}/aparatos`)), a), 8000);
      toast(`Agregado: ${a.nombre}.${m === "ir" ? " Ahora enséñale los botones con ⋯ → Aprender botón." : m === "atv" ? " Ahora emparéjalo con ⋯." : ""}`);
      $("#f-aparato").reset();
      camposMetodo();
    } catch (er) { toast("No pude guardarlo: " + (er.code || er.message), true); }
  }

  function montar() {
    if (!document.getElementById("card-aparatos")) return;
    $("#ap-tipo").innerHTML = Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#ap-metodo").addEventListener("change", camposMetodo);
    $("#f-aparato").addEventListener("submit", guardarAparato);
    $("#ap-ble-btn").addEventListener("click", () => agregarEsp32());
    $("#ap-puentes").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-probar-puente]");
      if (!b) return;
      b.disabled = true;
      pintarPrueba(b.dataset.probarPuente, null);
      try { pintarPrueba(b.dataset.probarPuente, await probarPuente(b.dataset.probarPuente)); } finally { b.disabled = false; }
    });
    $("#ap-lista").addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;           // cada boton espera lo suyo; los demas siguen funcionando
      const a = lista().find((x) => x.id === (b.dataset.ap || b.dataset.apMas || b.dataset.apAprender || b.dataset.apEmparejar || b.dataset.apEnviarCodigo || b.dataset.apBorrar || b.dataset.apWol));
      if (!a) return;
      const err = (er) => toast(String(er.message || er.code || er), true);
      if (b.dataset.apMas) { const m = $("#ap-mas-" + a.id); m.hidden = !m.hidden; return; }
      if (b.dataset.apBorrar) { nube.d.remove(ref(`usuarios/${nube.uid}/aparatos/${a.id}`)).catch(err); return; }
      b.disabled = true;
      try {
        if (b.dataset.ap) toast(await hacer(a, b.dataset.accion));
        if (b.dataset.apAprender) {
          const boton = document.querySelector(`[data-ap-boton="${a.id}"]`).value;
          toast(`Apunta el control al ESP32 y aprieta «${boton.replace(/_/g, " ")}» (tienes 10 segundos).`);
          const r = await mandar(a.puente, "/api/ir/aprender", {segundos: 10}, 20000);
          if (!r.codigo) throw new Error("No recibí ningún código. Acerca más el control.");
          await nube.d.set(ref(`usuarios/${nube.uid}/aparatos/${a.id}/acciones/${boton}`), {codigo: r.codigo});
          toast(`¡Aprendido! Ya sé «${boton.replace(/_/g, " ")}» ${("de " + conArticulo(a.nombre)).replace(/^de el /, "del ")}.`);
        }
        if (b.dataset.apEmparejar) {
          const r = await mandar(a.puente, "/api/tv/emparejar", {ip: a.config.ip}, 20000);
          toast(r.mensaje || "Mira el código en el TV.");
          document.querySelector(`[data-ap-codigo="${a.id}"]`).hidden = false;
          document.querySelector(`[data-ap-enviar-codigo="${a.id}"]`).hidden = false;
        }
        if (b.dataset.apEnviarCodigo) {
          const codigo = document.querySelector(`[data-ap-codigo="${a.id}"]`).value.trim();
          const r = await mandar(a.puente, "/api/tv/codigo", {ip: a.config.ip, codigo}, 20000);
          toast(r.mensaje || "¡Emparejado!");
        }
        if (b.dataset.apWol) {
          const mac = document.querySelector(`[data-ap-mac="${a.id}"]`).value.trim().toLowerCase();
          if (!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(mac)) throw new Error("La MAC no es válida (aa:bb:cc:dd:ee:ff).");
          const otro = Object.keys(ap.puentes).find((pid) => pid !== a.puente && capacidades(pid).includes("wol")) || a.puente;
          await nube.d.set(ref(`usuarios/${nube.uid}/aparatos/${a.id}/acciones/encender`), {metodo: "wol", mac, puente: otro});
          toast(`Listo: lo enciendo por red desde ${nombrePuente(otro)}.`);
        }
      } catch (er) { err(er); }
      b.disabled = false;
    });
  }

  A.modulo({
    nombre: "aparatos", montar, alUsuario, pintar, ejecutar,
    // "Píxel, prueba el ESP32" / "prueba el PC": la misma prueba que el boton, sin Gemini
    atajo: (texto) => {
      const m = /^(?:prueba|probar|pruebame|verifica|revisa|comprueba|chequea)\s+(?:el\s+|la\s+|los\s+|mis\s+|si\s+funciona\s+el\s+)?(esp ?32|esp|puente|puentes|pc|computador|portatil|laptop|ordenador)\b/.exec(A.texto.plano(String(texto || "")).trim());
      if (!m || !nube.uid) return undefined;
      const esp = /esp|puente/.test(m[1]);
      const pid = Object.keys(ap.puentes).find((id) => (ap.puentes[id].tipo === "puente") === esp);
      if (!pid) return Promise.resolve(esp ? "Aún no tengo el ESP32 enlazado. En Dispositivos, toca «Agregar ESP32 por Bluetooth»." : "El PC no está enlazado a tu cuenta.");
      pintarPrueba(pid, null);
      return probarPuente(pid).then((r) => { pintarPrueba(pid, r); return r.resumen; });
    },
    herramientas: () => (nube.uid ? HERRAMIENTAS : []),
    capacidad: () => (lista().length ? `- Manejar los aparatos de la casa (controlar_aparato, ver_aparatos): ${lista().map((a) => a.nombre).join(", ")}.`
      : "- Manejar aparatos de la casa, cuando el usuario los agregue en Dispositivos (ahora no hay ninguno)."),
    contexto: () => (lista().length ? "## Aparatos\n" + lista().map((a) => `- ${a.nombre} (${TIPOS[a.tipo] || a.tipo}): ${accionesDe(a).join(", ").replace(/_/g, " ") || "sin botones aprendidos"}${enLinea(a.puente) ? "" : "; su puente está desconectado"}.`).join("\n") : ""),
  });

  window.PixelAparatos = {texto: {buscarAparato, plan, accionesDe, conArticulo}, TIPOS, METODOS, mandar, probar: probarPuente,
    // el primer puente en linea que sabe hacer algo ("youtube": el PC busca videos con yt-dlp)
    puenteCon: (cap) => Object.keys(ap.puentes).find((pid) => capacidades(pid).includes(cap) && enLinea(pid)) || ""};
})();
