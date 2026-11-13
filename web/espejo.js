/* 2.4.0 (12 nov) - Espejo entre el programa del PC y la app de internet.
   El usuario: "las configuraciones deben ser un espejo de uno al otro, como en el escritorio como la web... si pongo
   la API desde el panel de control debe reflejarse automaticamente en la web". Con cada Pixel del PC enlazado a la
   cuenta (no solo el elegido: el robot piensa con su PC y puede haber otro, como su Windows) se copia, en los dos sentidos:
     - las claves de Gemini y de Groq, y cual contesta primero. En el PC: pixeles/<pid>/ia (nube.publicar_ia, cada
       una con la hora de su ultimo cambio, tambien la que se quito). En la app: localStorage pixel.ia:<uid>
       (proveedores.js; cfg.t guarda la hora de cada cambio hecho aqui).
     - los ajustes del agente: personalidad, largo de la respuesta, voz y tipo de voz. En el PC: su estado
       (agente.ajustes, con "t"). En la app: usuarios/<uid>/ajustes (con "t").
   Gana el cambio mas reciente (horas con el reloj de Firebase). Con la misma hora y distinto contenido (lo guardado
   antes de la 2.4.0 no tiene hora), manda el PC si tiene algo; si no, la app.
   Lo de la app va al PC con las ordenes del panel (/api/gemini/clave, /api/groq/clave, /api/ia, /api/agente), que
   el PC solo acepta de las cuentas enlazadas. Lo del PC se escribe aqui. Las otras IA de la app (Claude, GPT...)
   no estan en el PC: no se copian.
   Al cargarse no toca la pagina: decidirAjustes y decidirIa se prueban en Node (tools/prueba_modulos.js). */
"use strict";
const Espejo = (function () {
  const CAMPOS = ["personalidad", "respuesta", "voz", "tono"];
  const DEFECTO = {personalidad: "", respuesta: "normal", voz: "st-F4", tono: "normal"};
  const TONOS = ["normal", "infantil", "muy_infantil"];
  const IAS = ["gemini", "groq"];
  const num = (x) => (typeof x === "number" && isFinite(x) && x > 0 ? x : 0);

  // ------------------------------------------------------------------ decisiones (puras)
  function normal(a) {
    a = a || {};
    return {personalidad: String(a.personalidad || "").trim().slice(0, 300), respuesta: a.respuesta === "corta" ? "corta" : "normal",
      voz: String(a.voz || DEFECTO.voz), tono: TONOS.includes(a.tono) ? a.tono : DEFECTO.tono};
  }
  const iguales = (a, b) => CAMPOS.every((k) => a[k] === b[k]);
  // Lo que va a un lado, sin la voz que ese lado no tiene (se queda la suya)
  function para(origen, destino, voces) {
    const r = Object.assign({}, origen);
    if (voces && voces.length && !voces.includes(r.voz)) r.voz = destino.voz;
    return r;
  }

  // pc: estado.agente.ajustes del PC; web: usuarios/<uid>/ajustes (o null). vocesWeb/vocesPc: los id que tiene cada
  // uno. -> {web: lo que se guarda en la app (con t) o null, pc: el cuerpo de /api/agente (con t) o null}
  function decidirAjustes(pc, web, vocesWeb, vocesPc, ahora) {
    const P = normal(pc), W = normal(web);
    if (iguales(P, W)) return {web: null, pc: null};
    const tPc = num(pc && pc.t), tWeb = num(web && web.t);
    if (tPc > tWeb) {
      const w = para(P, W, vocesWeb);
      return {web: iguales(w, W) ? null : Object.assign(w, {t: tPc}), pc: null};
    }
    if (tWeb > tPc) {
      const p = para(W, P, vocesPc);
      return {web: null, pc: iguales(p, P) ? null : Object.assign(p, {t: tWeb})};
    }
    // misma hora (lo de antes de la 2.4.0): por campo, el del PC si no es el de fabrica; si no, el de la app
    const m = {};
    CAMPOS.forEach((k) => { m[k] = P[k] !== DEFECTO[k] ? P[k] : W[k]; });
    const w = para(m, W, vocesWeb), p = para(m, P, vocesPc);
    return {web: iguales(w, W) ? null : Object.assign(w, {t: ahora}), pc: iguales(p, P) ? null : Object.assign(p, {t: ahora})};
  }

  // pc: pixeles/<pid>/ia ({preferida, preferida_t, gemini: {clave, modelo, t}, groq: {...}}); cfg: Proveedores.leer().
  // modelosGemini: los id que la app sabe usar. -> {cfg: la configuracion nueva de la app o null, ordenes: [{ruta, cuerpo}]}
  function decidirIa(pc, cfg, ahora, modelosGemini) {
    pc = pc && typeof pc === "object" ? pc : {};
    const nuevo = JSON.parse(JSON.stringify({proveedor: cfg.proveedor, modelos: cfg.modelos || {}, claves: cfg.claves || {},
      bases: cfg.bases || {}, precios: cfg.precios || {}, t: cfg.t || {}}));
    let cambio = false;
    const ordenes = [];
    for (const p of IAS) {
      const x = pc[p] && typeof pc[p] === "object" ? pc[p] : {};
      const cPc = String(x.clave || ""), cWeb = String(nuevo.claves[p] || ""), tPc = num(x.t), tWeb = num(nuevo.t[p]);
      if (cPc === cWeb) {
        // la misma clave de Groq sin modelo aqui: el que eligio el PC al probarla
        if (cPc && p === "groq" && x.modelo && !nuevo.modelos.groq) { nuevo.modelos.groq = String(x.modelo); cambio = true; }
        continue;
      }
      if (tPc > tWeb || (tPc === tWeb && cPc)) {
        if (cPc) {
          nuevo.claves[p] = cPc;
          if (x.modelo && (p !== "gemini" || (modelosGemini || []).includes(x.modelo))) nuevo.modelos[p] = String(x.modelo);
        } else delete nuevo.claves[p];
        nuevo.t[p] = tPc;
        cambio = true;
      } else {
        const t = tWeb || ahora;
        if (!tWeb) { nuevo.t[p] = t; cambio = true; }
        ordenes.push({ruta: `/api/${p}/clave`, cuerpo: {clave: cWeb, t}});
      }
    }
    // cual contesta primero, solo entre Gemini y Groq (si aqui se usa Claude, el PC no lo cambia en un empate)
    const pref = pc.preferida, tPp = num(pc.preferida_t), tWp = num(nuevo.t.proveedor);
    if (IAS.includes(pref) && pref !== nuevo.proveedor) {
      const libre = IAS.includes(nuevo.proveedor) || !nuevo.claves[nuevo.proveedor];
      if (nuevo.claves[pref] && (tPp > tWp || (tPp === tWp && libre))) {
        nuevo.proveedor = pref;
        nuevo.t.proveedor = tPp;
        cambio = true;
      } else if (tWp > tPp && IAS.includes(nuevo.proveedor) && nuevo.claves[nuevo.proveedor]) {
        ordenes.push({ruta: "/api/ia", cuerpo: {ia: nuevo.proveedor, t: tWp}});
      }
    }
    return {cfg: cambio ? nuevo : null, ordenes};
  }

  // El perfil (el texto que va en las instrucciones) va de la app al PC; el PC no lo cambia. pc: estado.agente.perfil
  // ({texto, t}); perfil: usuarios/<uid>/perfil (su hora es "actualizado"). Gana el de la cuenta que lo cambio despues.
  // -> la orden /api/perfil o null
  function decidirPerfil(pc, perfil, texto, de, ahora) {
    const tx = String(texto || "").trim();
    if (!tx || (pc && String(pc.texto || "").trim() === tx)) return null;
    const tWeb = num(perfil && (perfil.actualizado || perfil.creado)), tPc = num(pc && pc.t);
    if (pc && pc.texto && tPc >= tWeb) return null;     // el del PC es de otra cuenta y mas nuevo
    return {ruta: "/api/perfil", cuerpo: {texto: tx, t: tWeb || ahora, de: String(de || "").slice(0, 60)}};
  }

  // ------------------------------------------------------------------ en la pagina
  // Con TODOS los Pixel del PC enlazados a la cuenta (usuarios/<uid>/pixeles, sin los robots: tipo "puente"), no solo
  // con el elegido: el robot piensa con su PC y el usuario puede tener otro (su Windows). La app hace de centro: lo
  // que cambia en un PC llega aqui y de aqui a los demas.
  const es = {uid: "", web: undefined, quitar: [], pcs: {}, reloj: 0, mandadas: new Set(), corriendo: false, otraVez: false, fallida: ""};
  const VIVO_MS = 40000;                       // como app.js: un PC con latido de hace menos de esto esta en linea

  function escucharCuenta() {
    if (typeof nube === "undefined" || !nube.d || nube.uid === es.uid) return;
    es.quitar.forEach((f) => f());
    Object.values(es.pcs).forEach((x) => x.quitar.forEach((f) => f()));
    Object.assign(es, {quitar: [], pcs: {}, web: undefined, uid: nube.uid || "", fallida: ""});
    if (!es.uid) return;
    const d = nube.d, ref = (r) => d.ref(nube.db, r);
    es.quitar.push(d.onValue(ref(`usuarios/${es.uid}/ajustes`), (s) => { es.web = s.val(); revisar(); },
      (e) => console.warn("espejo: ajustes", e)));
    es.quitar.push(d.onValue(ref(`usuarios/${es.uid}/pixeles`), (s) => {
      const mios = s.val() || {};
      const pids = Object.keys(mios).filter((pid) => !(mios[pid] && mios[pid].tipo === "puente"));
      for (const pid of Object.keys(es.pcs)) if (!pids.includes(pid)) { es.pcs[pid].quitar.forEach((f) => f()); delete es.pcs[pid]; }
      for (const pid of pids) {
        if (es.pcs[pid]) continue;
        const x = es.pcs[pid] = {estado: null, ia: undefined, vivo: 0, quitar: []};
        x.quitar.push(d.onValue(ref(`pixeles/${pid}/estado`), (v) => {
          const j = v.val();
          try { x.estado = j && j.json ? JSON.parse(j.json) : null; } catch (e) { x.estado = null; }
          revisar();
        }, () => {}));
        x.quitar.push(d.onValue(ref(`pixeles/${pid}/ia`), (v) => { x.ia = v.val() || null; revisar(); }, () => {}));
        x.quitar.push(d.onValue(ref(`pixeles/${pid}/vivo`), (v) => {
          const antes = enLinea(x);
          x.vivo = v.val() || 0;
          if (enLinea(x) && !antes) revisar();     // lo cambiado aqui mientras ese PC no estaba
        }, () => {}));
      }
      revisar();
    }, (e) => console.warn("espejo: pixeles", e)));
  }
  // app.js avisa cuando cambia algo del PC elegido; los demas se escuchan aqui. Se revisa un poco despues (una sola vez
  // si llegan varios avisos juntos)
  function ponerIaPc() { revisar(); }
  function olvidarPc() { /* cada PC se escucha aqui */ }
  function revisar() {
    clearTimeout(es.reloj);
    es.reloj = setTimeout(() => { correr().catch((e) => console.warn("espejo: " + (e.message || e))); }, 600);
  }
  const ahora = () => Date.now() + ((typeof nube !== "undefined" && nube.offset) || 0);
  const enLinea = (x) => !!x.vivo && ahora() - x.vivo < VIVO_MS;
  const nombrePc = (x) => (x.estado && x.estado.nube && x.estado.nube.nombre) || "el PC";

  // Una orden a un PC, una sola vez por cambio (la misma ruta, hora y valor no se repite en esta sesion). No se espera
  // la respuesta aqui (hasta 25 s): el PC las hace en el orden en que llegan
  function mandar(pid, o, que, x) {
    const k = pid + "|" + o.ruta + "|" + JSON.stringify(o.cuerpo);
    if (es.mandadas.has(k)) return;
    es.mandadas.add(k);
    const t0 = Date.now(), d = nube.d, r = d.push(d.ref(nube.db, `pixeles/${pid}/ordenes`));
    console.info(`espejo: mando ${o.ruta} a ${nombrePc(x)}`);
    d.set(r, {uid: nube.uid, ruta: o.ruta, cuerpo: JSON.stringify(o.cuerpo || {}), t: d.serverTimestamp()})
      .then(() => esperarRespuesta(pid, r.key, "", 25000))
      .then(() => console.info(`espejo: ${nombrePc(x)} hizo ${o.ruta} (${Date.now() - t0} ms)`),
        (e) => toast(`No pude copiar ${que} a ${nombrePc(x)}: ${e.message || e}`, true));
  }

  async function correr() {
    escucharCuenta();
    if (es.corriendo) { es.otraVez = true; return; }          // al acabar la vuelta de ahora, otra
    if (typeof nube === "undefined" || !nube.uid) return;
    es.corriendo = true;
    for (const [pid, x] of Object.entries(es.pcs)) {
      const ag = x.estado && x.estado.agente;
      // un PC con la 2.3.0 o antes no guarda la hora de sus cambios ni acepta claves desde aqui: no se toca
      if (!ag || !ag.ajustes || !("t" in ag.ajustes)) continue;
      const vivo = enLinea(x);
      // cada parte por su lado: si una falla (sin permiso, sin red), las otras siguen
      try { await espejarAjustes(pid, x, ag, vivo); } catch (e) { console.warn("espejo: ajustes: " + (e.message || e)); }
      try { espejarIa(pid, x, vivo); } catch (e) { console.warn("espejo: claves: " + (e.message || e)); }
      try { espejarPerfil(pid, x, ag, vivo); } catch (e) { console.warn("espejo: perfil: " + (e.message || e)); }
    }
    es.corriendo = false;
    if (es.otraVez) { es.otraVez = false; revisar(); }
  }

  async function espejarAjustes(pid, x, ag, vivo) {
    if (es.web === undefined) return;
    const vocesPc = (ag.voces || []).map((v) => v.id);
    const vocesWeb = typeof VozPixel !== "undefined" ? VozPixel.VOCES.map((v) => v.id) : [];
    const r = decidirAjustes(ag.ajustes, es.web, vocesWeb, vocesPc, ahora());
    if (r.web) {
      const k = JSON.stringify(r.web);
      if (k === es.fallida) return;               // ya se intento y no se pudo: no se repite cada segundo
      try {
        await nube.d.set(nube.d.ref(nube.db, `usuarios/${nube.uid}/ajustes`), r.web);
        es.web = r.web;                           // ya: los demas PC se comparan con esto en esta misma vuelta
        console.info(`espejo: ajustes de ${nombrePc(x)} copiados a la app`);
      } catch (e) { es.fallida = k; throw e; }
    }
    if (r.pc && vivo) mandar(pid, {ruta: "/api/agente", cuerpo: Object.assign({salida_voz: ag.ajustes.salida_voz}, r.pc)}, "los ajustes", x);
  }

  function espejarPerfil(pid, x, ag, vivo) {
    const PP = window.PixelPerfil;
    if (!vivo || !PP || !("perfil" in ag)) return;      // un PC sin la 2.4.0 no sabe de perfiles
    const u = nube.usuario || {};
    const o = decidirPerfil(ag.perfil, PP.perfil(), PP.paraPrompt(false), u.displayName || u.email || "", ahora());
    if (o) mandar(pid, o, "tu perfil", x);
  }

  function espejarIa(pid, x, vivo) {
    if (x.ia === undefined || typeof Proveedores === "undefined") return;
    const r = decidirIa(x.ia, Proveedores.leer(), ahora(), (Proveedores.LISTA.gemini.modelos || []).map((m) => m.id));
    if (r.cfg && Proveedores.guardar(r.cfg)) {
      console.info(`espejo: claves de IA de ${nombrePc(x)} copiadas a la app`);
      if (window.PixelAjustes && window.PixelAjustes.pintarIA) window.PixelAjustes.pintarIA();
      if (window.pintarPasos) window.pintarPasos();
    }
    if (vivo) for (const o of r.ordenes) mandar(pid, o, o.ruta === "/api/ia" ? "la IA preferida" : "la clave", x);
  }

  return {decidirAjustes, decidirIa, decidirPerfil, normal, ponerIaPc, olvidarPc, revisar, CAMPOS, DEFECTO};
})();
if (typeof window !== "undefined") window.Espejo = Espejo;   // una const de arriba no queda en window
if (typeof module !== "undefined") module.exports = Espejo;
