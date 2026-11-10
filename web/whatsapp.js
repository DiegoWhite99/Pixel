/* Fase 14 - WhatsApp (pedido del usuario el 10 nov: "dile que entre a WhatsApp y le escriba a tal persona hola").
   Con el enlace oficial "click to chat" de WhatsApp (wa.me), sin bots ni programas no oficiales.
   - "Píxel, escríbele a Ana por WhatsApp: hola" -> Gemini llama a escribir_whatsapp. La herramienta NO
     envia: arma el mensaje y pregunta "¿Se lo mando?" (Agente.nucleo.confirmar, la misma regla que el
     correo). Solo con "sí" (por voz) o el boton se hace algo.
   - Celular: se abre WhatsApp con el chat y el mensaje escritos; el usuario toca enviar (una web no
     puede tocar el boton de otra app). Si el navegador no deja abrirlo sin un toque (el "sí" fue por
     voz), sale una tarjeta con el boton "Abrir WhatsApp".
   - PC (si el usuario lo pide o si la app esta abierta en un computador): el PC (puente_pc.whatsapp)
     abre WhatsApp Web con el chat y el mensaje y oprime Enter con xdotool.
   - Los numeros se guardan en las notas de personas del cerebro ("WhatsApp: +57 300 123 4567"): si no
     lo tiene, Pixel lo pregunta y la siguiente vez basta con el nombre.
   Al cargarse no toca la pagina: las funciones de texto (PixelWhatsapp.texto) se prueban en Node. */
"use strict";
(function () {
  const A = window.Agente, N = A.nucleo, T = A.texto;

  // Indicativo por defecto (numeros de 10 cifras sin "+"), segun el pais del navegador; si no, Colombia
  const INDICATIVOS = {CO: "57", MX: "52", ES: "34", AR: "54", PE: "51", CL: "56", EC: "593", VE: "58", US: "1", BO: "591", UY: "598", PY: "595", GT: "502", PA: "507", CR: "506", DO: "1"};
  const PAIS = (() => { const m = /-([A-Z]{2})$/.exec((typeof navigator !== "undefined" && navigator.language) || ""); return (m && INDICATIVOS[m[1]]) || "57"; })();
  const RE_SI = /^(si|sip|dale|claro|envialo|mandalo|enviaselo|mandaselo|ok|okay|de una|hazlo|por favor|listo|va)\b/;

  // ------------------------------------------------------------------ texto (puro: se prueba en Node)
  // El primer numero de telefono de un texto, solo cifras (con su "+" si lo trae): "" si no hay
  function numeroDe(texto) {
    const s = String(texto || "");
    const pref = /(?:whatsapp|wasap|celular|cel|movil|telefono|tel|numero|número)[^\d+]{0,12}(\+?\d[\d\s().-]{6,18}\d)/i.exec(s);
    const m = pref || /(\+?\d[\d\s().-]{6,18}\d)/.exec(s);
    if (!m) return "";
    const crudo = m[1];
    return (crudo.trim().startsWith("+") ? "+" : "") + crudo.replace(/\D/g, "");
  }

  // El numero completo para wa.me: solo cifras, con indicativo. "" si no parece un numero de WhatsApp.
  //   "300 123 4567" -> "573001234567" (Colombia); "+34 612..." -> "34612..."; "0057300..." -> "57300..."
  function normalizar(numero, pais) {
    let s = String(numero || "").trim();
    const mas = s.startsWith("+");
    s = s.replace(/\D/g, "");
    if (!s) return "";
    if (s.startsWith("00")) return s.length >= 10 && s.length <= 17 ? s.slice(2) : "";
    if (mas) return s.length >= 8 && s.length <= 15 ? s : "";
    if (s.length === 10) return (pais || "57") + s;                 // un celular sin indicativo
    if (s.length >= 11 && s.length <= 15) return s;                  // ya trae el indicativo
    return "";
  }

  // "+57 300 123 4567" para leerlo y escribirlo en la nota
  function formato(n) {
    const s = String(n || "");
    if (/^57\d{10}$/.test(s)) return `+57 ${s.slice(2, 5)} ${s.slice(5, 8)} ${s.slice(8)}`;
    return s ? "+" + s : "";
  }

  // El texto de la nota de la persona con su numero: cambia el que ya tenia o lo agrega al final
  function conNumero(texto, n) {
    const linea = `WhatsApp: ${formato(n)}`;
    const t = String(texto || "").trim();
    if (/whatsapp\s*:\s*\+?[\d\s().-]+/i.test(t)) return t.replace(/whatsapp\s*:\s*\+?[\d\s().-]+\d/i, linea);
    return t ? `${t}\n${linea}` : linea;
  }

  const urlCelular = (n, msg) => `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;

  // ------------------------------------------------------------------ contactos (notas de personas)
  const notas = () => (window.Cerebro && window.Cerebro.notas ? window.Cerebro.notas() : []);
  function buscarPersona(nombre) {
    const q = String(nombre || "").trim();
    if (!q || /\d{4}/.test(q)) return null;
    const ns = notas();
    const exacta = ns.find((n) => window.Cerebro.texto.mismoTitulo(n.titulo, q));
    if (exacta) return exacta;
    let mejor = null, nota = 0;
    for (const n of ns.filter((x) => x.tipo === "persona")) {
      const p = T.parecido(q, n.titulo);
      if (p > nota) { mejor = n; nota = p; }
    }
    return nota >= 0.6 ? mejor : null;
  }

  // Guarda (o cambia) el numero en la nota de la persona; si no hay nota, la crea (tipo persona)
  async function guardarNumero(nota, nombre, n) {
    if (!window.Cerebro || !window.Cerebro.recordar) return;
    const titulo = nota ? nota.titulo : nombre.replace(/^\s*(?:a|al|la|el)\s+/i, "").trim();
    if (!titulo) return;
    try { await window.Cerebro.recordar(titulo, conNumero(nota ? nota.texto : "", n), nota ? nota.tipo : "persona", "voz"); } catch (e) { console.warn("whatsapp: no guarde el numero", e); }
  }

  // ------------------------------------------------------------------ abrir y enviar (tras el "sí")
  const esAndroid = () => /Android/i.test(navigator.userAgent);
  const puentePc = () => (window.PixelAparatos ? window.PixelAparatos.puenteCon("whatsapp") || window.PixelAparatos.puenteCon("pc") : "");

  // donde: "pc" | "celular". Sin decirlo: en Android el celular; en un computador, el PC si esta conectado
  function elegirDonde(d) {
    if (d === "pc" && puentePc()) return "pc";
    if (d === "celular") return "celular";
    return !esAndroid() && puentePc() ? "pc" : "celular";
  }

  function tarjeta(nombre, mensaje, url) {
    const caja = document.getElementById("ag-whatsapp");
    if (!caja) return;
    caja.innerHTML = `<div class="txt"><b>WhatsApp para ${esc(nombre)}</b><small>«${esc(mensaje.length > 120 ? mensaje.slice(0, 120) + "…" : mensaje)}»</small></div>
      <a class="btn primario" href="${esc(url)}" target="_blank" rel="noopener" data-wa-abrir>Abrir WhatsApp</a>
      <button class="btn" type="button" data-wa-quitar aria-label="Quitar">✕</button>`;
    caja.hidden = false;
  }

  async function abrir(numero, mensaje, nombre, donde) {
    if (donde === "pc") {
      try {
        const r = await window.PixelAparatos.mandar(puentePc(), "/api/pc", {accion: "whatsapp", numero, texto: mensaje}, 50000);
        return r.decir || "Listo: lo escribí en WhatsApp del PC.";
      } catch (e) { console.warn("whatsapp: el PC no pudo", e); }      // si el PC falla, se ofrece en el celular
    }
    const url = urlCelular(numero, mensaje);
    let w = null;
    try { w = window.open(url, "_blank"); } catch (e) { w = null; }        // null: el navegador pidio un toque (el "sí" fue por voz)
    if (w) { try { w.opener = null; } catch (e) { /* nada */ } }          // (no "noopener": con el, open() devuelve null siempre)
    tarjeta(nombre, mensaje, url);                                        // y el boton queda por si acaso
    return w ? `Te abrí WhatsApp con el mensaje para ${nombre}: solo toca enviar.` : `Toca «Abrir WhatsApp» y luego enviar.`;
  }

  // ------------------------------------------------------------------ herramienta para Gemini
  const HERRAMIENTAS = [
    {name: "escribir_whatsapp", description: "Prepara un mensaje de WhatsApp para una persona (por su nombre, de sus notas de personas, o un número). Nunca lo envía solo: la app le lee el mensaje y pregunta «¿Se lo mando?». Si no hay número guardado, pídeselo al usuario y vuelve a llamar con numero. Para corregir el mensaje, vuelve a llamarla con el texto nuevo.",
      parameters: {type: "object", properties: {
        para: {type: "string", description: "A quién: el nombre como lo dijo ('Ana', 'mi mamá') o el número."},
        mensaje: {type: "string", description: "El texto exacto a enviar, como lo dijo el usuario (puedes corregir la ortografía)."},
        numero: {type: "string", description: "Solo si el usuario acaba de decir el número de esa persona."},
        donde: {type: "string", enum: ["celular", "pc"], description: "Solo si lo dice: desde el celular o desde el PC (WhatsApp Web)."}},
      required: ["para", "mensaje"]}},
  ];

  async function ejecutar(nombre, a) {
    if (nombre !== "escribir_whatsapp") return undefined;
    a = a || {};
    const para = String(a.para || "").trim().slice(0, 80), mensaje = String(a.mensaje || "").trim().slice(0, 1000);
    const nota = buscarPersona(para);
    let numero = normalizar(a.numero, PAIS) || (/\d{7}/.test(para.replace(/\D/g, "")) ? normalizar(para, PAIS) : "");
    if (!numero && nota) numero = normalizar(numeroDe(nota.texto), PAIS);
    const quien = nota ? nota.titulo : numero && /\d/.test(para) ? formato(numero) : para.replace(/^\s*(?:a|al)\s+/i, "") || "esa persona";
    // termina en "?": asi el nucleo abre la ventana y el numero se dice sin "Píxel"
    if (!numero) return `No tengo el número de ${quien}. Si no es de Colombia, dímelo con el indicativo. ¿Cuál es?`;
    if (a.numero && para && !/\d{4}/.test(para)) await guardarNumero(nota, para, numero);   // lo recuerda para la proxima
    if (!mensaje) return `¿Qué le escribo a ${quien}?`;
    const donde = elegirDonde(a.donde);
    N.confirmar({pregunta: "¿Se lo mando?", titulo: `WhatsApp para ${quien}`, detalle: `${formato(numero)}${donde === "pc" ? " · desde el PC" : ""}\n\n${mensaje}`,
      boton: "Enviar por WhatsApp", si: RE_SI, seguir: true, dura: 5 * 60000, hacer: () => abrir(numero, mensaje, quien, donde),
      cancelar: () => "Vale, no se lo mando."});
    return `Le escribo a ${quien}: «${mensaje}». ¿Se lo mando?`;
  }

  function montar() {
    const caja = document.getElementById("ag-whatsapp");
    if (!caja) return;
    caja.addEventListener("click", (e) => {
      if (e.target.closest("[data-wa-quitar]") || e.target.closest("[data-wa-abrir]")) setTimeout(() => { caja.hidden = true; }, 300);
    });
  }

  A.modulo({
    nombre: "whatsapp", montar, ejecutar,
    herramientas: () => (nube.uid ? HERRAMIENTAS : []),
    capacidad: () => "- Escribir por WhatsApp a sus contactos (escribir_whatsapp). Siempre pregunta antes de enviar.",
  });

  window.PixelWhatsapp = {texto: {numeroDe, normalizar, formato, conNumero, urlCelular}, PAIS};
})();
