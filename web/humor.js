/* Fase 13 - La personalidad de Pixel (pedido del usuario, 9 nov): como reacciona cuando lo tocan,
   cosas que hace solo de vez en cuando y caras segun la conversacion.
   - Tocarlo o estirarle la cara: al principio le divierte ("¡Jejeje, qué divertido!"); si sigue, se
     cansa; si es mucho, se enoja ("¡Ya no me toques así!") y al final se hace el dormido. La
     molestia baja sola con el tiempo, y cuando se le pasa, a veces perdona. Zarandearlo varias
     veces seguidas lo marea (ojos en espiral).
   - Eventos al azar cada 25-60 s cuando esta tranquilo: mirar alrededor, guinar, tararear, bostezar,
     estornudar, aburrirse... A veces lo dice en voz alta, pocas, y solo con "Escuchar" puesto.
     Tras 5 min sin actividad (ni hablarle, ni tocarlo, ni musica) dice que se va a dormir y se
     duerme; al oir "Píxel" o al tocarlo se despierta (tocandolo, con una frase).
   - Charla: "gracias", "te quiero"... ojos de corazon; risas, ojos "> <"; insultos, triste.
   Usa la cara de app.js (cara) y la voz del agente (Agente.nucleo.anunciar). Al cargarse no toca
   la pagina: las funciones de texto (PixelHumor.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo, plano = A.texto.plano;

  const FRASES = {
    divertido: ["¡Jejeje, qué divertido!", "¡Jiji, cosquillas!", "¡Boiiing! ¡Otra vez!", "¡Wiii!", "¡Jejeje!", "¡Ay, que me haces cosquillas!"],
    cansado: ["Jeje… bueno, ya está bien, ¿no?", "Oye, me vas a dejar la cara chueca.", "Ya, ya… que me despeinas. Bueno, si tuviera pelo."],
    enojado: ["¡Ya no me toques así!", "¡Oye! ¡Que me mareo!", "¡Basta! Déjame un ratito, porfa."],
    harto: ["Hmph. Me voy a hacer el dormido para que me dejes en paz."],
    mareado: ["Uy… todo me da vueltas.", "¿Quién apagó la gravedad?", "Ay, ay, ay… veo estrellitas."],
    perdon: ["Bueno, ya se me pasó. Te perdono.", "Vale, amigos otra vez."],
    estornudo: ["¡Achís! Perdón, polvo en el visor.", "¡Achís!"],
    tararear: ["Tururú, tururú…", "La la laaa…"],
    bostezo: ["Aaah… perdón, qué sueño."],
    aburrido: ["¿Hablamos de algo?", "Si me necesitas, solo di «Píxel»."],
    despierto: ["¡Ah! Estaba soñando con ovejas eléctricas.", "¡Uy! Ya estoy despierto, ya estoy despierto."],
    dormir: ["Llevo un rato sin hacer nada… me voy a dormir. Si me necesitas, di «Píxel».",
      "Bueno, me echo una siestita. Despiértame diciendo «Píxel»."],
  };
  const AMOR = /\b(gracias|te quiero|te amo|te adoro|eres (el|la|lo) mejor|que lindo|que bonito|bien hecho|buen trabajo|genial|excelente|crack|me encantas)\b/;
  const RISA = /\b(jaja\w*|jeje\w*|jiji\w*|chiste|gracios[oa])\b/;
  const INSULTO = /\b(tont[oa]|estupid[oa]|inutil|fe[oa]|brut[oa]|idiota|bobo|boba|te odio)\b/;
  const LO_SIENTO = /^(lo siento|perdona|perdon|no pude|no puedo|no encontr|ahora no puedo)/;
  const MOLESTIA_BAJA_S = 5;                   // cada tanto, un punto menos de molestia
  const DORMIR_MS = 5 * 60000;                 // tanto sin hablarle ni tocarlo (ni musica): avisa y se duerme

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // Del nivel de molestia al animo: 0-3 divertido, 3,5-6 cansado, 6-9 enojado, 9+ harto
  const nivel = (m) => (m < 3.5 ? "divertido" : m < 6 ? "cansado" : m < 9 ? "enojado" : "harto");

  // Que cara poner (y si decir algo) segun lo que dijo el usuario y lo que contesto Pixel
  function animoDeCharla(texto, respuesta) {
    const t = plano(texto || ""), r = plano(respuesta || "").replace(/^[¡¿\s]+/, "");
    if (INSULTO.test(t)) return "triste";
    if (AMOR.test(t)) return "corazones";
    if (RISA.test(t) || RISA.test(r)) return "risa";
    if (LO_SIENTO.test(r)) return "triste";
    return "";
  }

  // Un evento al azar, segun cuanto lleva sin hablarle (ms) y si suena musica
  function elegirEvento(inactivo, musica, azar) {
    const opciones = [["mirar", 30], ["guino", 10], ["tararear", musica ? 40 : 10], ["bostezo", inactivo > 120000 ? 25 : 6],
      ["estornudo", 6], ["aburrido", inactivo > 180000 ? 20 : 0], ["corazones", 3]];
    const total = opciones.reduce((s, [, p]) => s + p, 0);
    let x = (azar === undefined ? Math.random() : azar) * total;
    for (const [nombre, p] of opciones) { if ((x -= p) < 0) return nombre; }
    return "mirar";
  }

  // una frase al azar de la lista, sin repetir la ultima que dijo
  let ultimaFrase = "";
  function alAzar(lista) {
    const otras = lista.length > 1 ? lista.filter((f) => f !== ultimaFrase) : lista;
    ultimaFrase = otras[Math.floor(Math.random() * otras.length)];
    return ultimaFrase;
  }

  // ------------------------------------------------------------------ estado
  const h = {molestia: 0, nivelAntes: "divertido", estirones: [], vozT: 0, ultimaT: Date.now(), proximo: Date.now() + 30000,
    dormido: false, irseADormir: false, desperto: false, aburridoT: 0, perdonar: false, enCola: ""};
  // la cara es la constante global "cara" de app.js (un const no queda como propiedad de window)
  const laCara = () => (typeof cara !== "undefined" ? cara : null);

  // La voz de Pixel por su cuenta: solo si no esta ocupado, no muy seguido y con la app atenta
  function hablar(frase, forzar) {
    if (!frase) return;
    if (typeof decir === "function") decir(frase, "", 2400);          // el titulo de Inicio (app.js)
    if (N.ocupado() || N.est.pendiente) { if (forzar) h.enCola = frase; return; }   // la importante, al acabar
    if (!forzar && Date.now() - h.vozT < 2500) return;
    if (!N.oye.quiere && !forzar) return;                              // sin "Escuchar": solo la cara y el texto
    h.vozT = Date.now();
    N.anunciar(frase, {toast: false, beep: false, registro: false, gesto: false});
  }

  // tocarlo, hablarle o que conteste: cuenta como actividad. Si dormia, se despierta.
  // Devuelve true si estaba dormido.
  function interaccion() {
    h.ultimaT = Date.now();
    h.proximo = Date.now() + 25000 + Math.random() * 35000;
    h.irseADormir = false;
    if (!h.dormido) return false;
    h.dormido = false;
    if (laCara()) laCara().emocion("normal", 0);
    return true;
  }

  // ------------------------------------------------------------------ tocarlo
  function alAgarrar() {
    h.desperto = interaccion();
    if (laCara() && h.molestia >= 6) laCara().emocion("enojado", 60000);    // ya no le hace gracia
  }

  function alSoltar(toque, info) {
    interaccion();
    const c = laCara();
    if (h.desperto) {                                                  // lo desperto un toque
      h.desperto = false;
      if (c) c.emocion("sorpresa", 1200);
      hablar(alAzar(FRASES.despierto), true);
      return;
    }
    const movido = (info && info.movido) || 0, ahora = Date.now();
    h.molestia = Math.min(12, h.molestia + (toque ? 1 : movido > 120 ? 2 : 1.4));
    if (!toque && movido > 60) h.estirones.push(ahora);
    h.estirones = h.estirones.filter((t) => ahora - t < 6000);
    const n = nivel(h.molestia), nuevo = n !== h.nivelAntes;
    h.nivelAntes = n;
    if (h.estirones.length >= 3 && n !== "harto") {                    // zarandeado: mareo
      h.estirones = [];
      if (c) c.evento("mareo");
      hablar(alAzar(FRASES.mareado), true);
      return;
    }
    if (n === "divertido") {
      if (c && toque) c.evento("risa");           // estirado: la cara ya pone su "feliz" con rebote
      // el primer toque tras un rato, siempre "¡Jejeje, qué divertido!"; luego, variado
      hablar(Date.now() - h.vozT > 6000 ? FRASES.divertido[0] : alAzar(FRASES.divertido));
    } else if (n === "cansado") {
      if (c) c.emocion("aburrido", 2200);
      if (nuevo || Math.random() < 0.5) hablar(alAzar(FRASES.cansado), nuevo);
    } else if (n === "enojado") {
      h.perdonar = true;
      if (c) c.emocion("enojado", 3500);
      if (nuevo || Math.random() < 0.6) hablar(alAzar(FRASES.enojado), nuevo);
    } else {
      h.perdonar = true;
      if (c) c.emocion(nuevo ? "dormido" : "enojado", nuevo ? 7000 : 3000);
      if (nuevo) hablar(FRASES.harto[0], true);
    }
  }

  // ------------------------------------------------------------------ solo, de vez en cuando
  let pasos = 0;
  function alSegundo() {
    const c = laCara();
    if (!c || !A.activo()) return;
    if (++pasos % MOLESTIA_BAJA_S === 0 && h.molestia > 0) {
      h.molestia = Math.max(0, h.molestia - 1);
      h.nivelAntes = nivel(h.molestia);
      if (h.perdonar && h.molestia < 2) {                             // se le paso el enojo
        h.perdonar = false;
        c.emocion("feliz", 1800);
        if (Math.random() < 0.6) hablar(alAzar(FRASES.perdon));
      }
    }
    if (h.enCola && !N.ocupado() && !N.est.pendiente) { const f = h.enCola; h.enCola = ""; hablar(f, true); }
    if (window.PixelApuntes && window.PixelApuntes.dictando()) { h.ultimaT = Date.now(); return; }   // dictando: ni sueno ni eventos
    if (window.PixelTiempo && window.PixelTiempo.enfocado()) { h.ultimaT = Date.now(); return; }     // en un pomodoro o en la guia: no interrumpe
    const ahora = Date.now(), inactivo = ahora - h.ultimaT;
    if (document.hidden || N.ocupado() || N.est.pendiente || N.oye.pendiente || N.oye.interino || c.ocupada()) return;
    const musica = !!(window.PixelMusica && window.PixelMusica.estado().cola.length);
    if (musica) h.ultimaT = Math.max(h.ultimaT, ahora - DORMIR_MS / 2);    // con musica no se duerme
    // 5 min sin actividad: lo dice, bosteza y, cuando acaba de hablar, cierra los ojos
    if (h.irseADormir && !N.ocupado()) {
      h.irseADormir = false;
      h.dormido = true;
      c.emocion("dormido", 24 * 3600 * 1000);
      return;
    }
    if (!h.dormido && !h.irseADormir && inactivo > DORMIR_MS && !musica) {
      h.irseADormir = true;
      c.evento("bostezo");
      hablar(alAzar(FRASES.dormir), true);
      return;
    }
    if (h.dormido || ahora < h.proximo || h.molestia >= 6 || (c.bailando && c.bailando())) return;   // bailando, nada de eventos
    h.proximo = ahora + 25000 + Math.random() * 35000;
    const ev = elegirEvento(inactivo, musica);
    if (ev === "aburrido") {
      c.emocion("aburrido", 3000);
      if (ahora - h.aburridoT > 300000 && Math.random() < 0.5) { h.aburridoT = ahora; hablar(alAzar(FRASES.aburrido)); }
      return;
    }
    c.evento(ev);
    const prob = {estornudo: 0.6, tararear: musica ? 0 : 0.3, bostezo: 0.3}[ev] || 0;
    if (Math.random() < prob) hablar(alAzar(FRASES[ev]));
  }

  // ------------------------------------------------------------------ la charla
  function alTurno(texto, respuesta) {
    interaccion();
    const c = laCara();
    if (!c) return;
    const a = animoDeCharla(texto, respuesta);
    if (INSULTO.test(plano(texto || ""))) h.molestia = Math.min(12, h.molestia + 2);
    if (a === "corazones" || a === "risa") c.evento(a);
    else if (a) c.emocion(a, 2600);
  }

  // en cuanto lo llaman, se despierta
  function alOirParcial(t) {
    if (h.dormido && /p[ií]xel|bixel/i.test(t)) {
      h.dormido = false;
      h.ultimaT = Date.now();
      if (laCara()) laCara().emocion("sorpresa", 900);              // ¡eh! ¿que?
    }
  }

  A.modulo({nombre: "humor", alSegundo, alTurno, alOirParcial, alUsuario: () => { h.molestia = 0; h.dormido = false; interaccion(); }});

  window.PixelHumor = {alAgarrar, alSoltar, texto: {nivel, animoDeCharla, elegirEvento}, estado: () => Object.assign({}, h),
    ya: () => { h.proximo = 0; },
    reiniciar: () => { Object.assign(h, {molestia: 0, nivelAntes: "divertido", estirones: [], perdonar: false, enCola: "", vozT: 0}); },
    envejecer: (ms) => { h.ultimaT -= ms; }};                          // para las pruebas: como si llevara ms sin actividad                                    // para las pruebas: el siguiente evento al azar, ya
})();
