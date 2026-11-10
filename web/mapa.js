// Fase 14 - El mapa del cerebro (pedido del usuario el 10 nov: "un visual de como se forman los nodos
// de conexion en Obsidian"). Un grafo de fuerzas en un <canvas>, a mano y sin librerias, como la vista de
// grafo de Obsidian: "Tú" en el centro, de ahi las carpetas (tipos de nota) y de cada carpeta sus notas;
// las notas que se nombran entre si van unidas (cerebro.js calcula esos enlaces, igual que obsidian.py
// los escribe en la boveda, asi los dos grafos muestran lo mismo).
//   const m = MapaCerebro.montar(canvas, {alTocar(id | null)})
//   m.datos(nodos, aristas)   nodos: [{id, etiqueta, color, tam, clase: "centro"|"grupo"|"nota"}]
//                             aristas: [[idA, idB, clase]]  clase: "grupo" | "tipo" | "mencion"
//   m.elegir(id | null)       resalta un nodo y sus vecinos (como al pasar el raton en Obsidian)
// Los nodos se arrastran con el dedo o el raton; tocar uno lo elige y tocar el fondo lo suelta. La vista
// se ajusta sola para que quepa todo. Con movimiento reducido se calcula de una vez, sin animacion.
"use strict";
const MapaCerebro = (function () {
  const LARGO = {grupo: 130, tipo: 64, mencion: 100};      // largo de reposo de cada clase de arista
  const RIGIDEZ = {grupo: 0.05, tipo: 0.08, mencion: 0.02};
  const REPULSION = 4200;

  function montar(canvas, opciones) {
    opciones = opciones || {};
    const ctx = canvas.getContext("2d");
    const quieto = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let nodos = [], aristas = [], porId = new Map(), elegido = null, vecinos = new Set();
    let alfa = 0, corriendo = false, ancho = 0, alto = 0, dpr = 1;
    const vista = {x: 0, y: 0, esc: 1, ok: false};
    let arrastre = null;                                       // {n, x0, y0, movido}

    // ---------------------------------------------------------------- datos
    function datos(ns, as) {
      const viejos = porId;
      porId = new Map();
      nodos = ns.map((n, i) => {
        const v = viejos.get(n.id);
        const a = (i / Math.max(1, ns.length)) * Math.PI * 2, r = n.clase === "centro" ? 0 : n.clase === "grupo" ? 110 : 170 + Math.random() * 40;
        const nodo = Object.assign({x: v ? v.x : Math.cos(a) * r + Math.random() * 10, y: v ? v.y : Math.sin(a) * r + Math.random() * 10,
          vx: 0, vy: 0, grado: 0}, n);
        porId.set(n.id, nodo);
        return nodo;
      });
      aristas = as.filter(([a, b]) => porId.has(a) && porId.has(b)).map(([a, b, clase]) => ({a: porId.get(a), b: porId.get(b), clase: clase || "mencion"}));
      for (const e of aristas) { e.a.grado++; e.b.grado++; }
      // las notas nuevas nacen junto a su carpeta (y no en cualquier parte)
      for (const e of aristas) {
        if (e.clase !== "tipo") continue;
        const nota = e.a.clase === "nota" ? e.a : e.b, grupo = nota === e.a ? e.b : e.a;
        if (!viejos.has(nota.id)) { nota.x = grupo.x + (Math.random() - 0.5) * 40; nota.y = grupo.y + (Math.random() - 0.5) * 40; }
      }
      if (elegido && !porId.has(elegido)) elegir(null);
      else calcularVecinos();
      calentar(1);
    }

    function calcularVecinos() {
      vecinos = new Set();
      if (!elegido) return;
      for (const e of aristas) {
        if (e.a.id === elegido) vecinos.add(e.b.id);
        if (e.b.id === elegido) vecinos.add(e.a.id);
      }
    }

    function elegir(id) {
      elegido = id && porId.has(id) ? id : null;
      calcularVecinos();
      dibujar();
    }

    // ---------------------------------------------------------------- fuerzas
    function paso() {
      const n = nodos.length;
      for (let i = 0; i < n; i++) {                            // repulsion entre todos (n es pequeño: notas de una persona)
        const a = nodos[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodos[j];
          let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
          const f = Math.min(40, (REPULSION * alfa) / d2), d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      for (const e of aristas) {                               // muelles
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - LARGO[e.clase]) * RIGIDEZ[e.clase] * alfa, fx = (dx / d) * f, fy = (dy / d) * f;
        e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
      }
      for (const a of nodos) {
        if (a.clase === "centro") { a.vx -= a.x * 0.08 * alfa; a.vy -= a.y * 0.08 * alfa; }   // "Tú" se queda en medio
        else { a.vx -= a.x * 0.004 * alfa; a.vy -= a.y * 0.004 * alfa; }
        if (arrastre && arrastre.n === a) { a.vx = 0; a.vy = 0; continue; }
        a.vx *= 0.6; a.vy *= 0.6;
        a.x += a.vx; a.y += a.vy;
      }
      alfa *= 0.985;
    }

    function calentar(a) {
      alfa = Math.max(alfa, a);
      if (quieto) { while (alfa > 0.02) paso(); ajustar(true); dibujar(); return; }
      if (!corriendo) { corriendo = true; requestAnimationFrame(cuadro); }
    }

    function cuadro() {
      if (!medir()) { corriendo = false; return; }             // pestaña oculta: se para (y sigue al volver)
      if (alfa > 0.02 || arrastre) paso();
      ajustar(false);
      dibujar();
      if (alfa > 0.02 || arrastre) requestAnimationFrame(cuadro);
      else corriendo = false;
    }

    // ---------------------------------------------------------------- vista: que quepa todo
    function medir() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (Math.round(r.width * dpr) !== canvas.width || Math.round(r.height * dpr) !== canvas.height) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      ancho = r.width; alto = r.height;
      return true;
    }

    function ajustar(deGolpe) {
      if (!nodos.length || arrastre) return;                   // arrastrando, la vista no se mueve bajo el dedo
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const a of nodos) { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x); y1 = Math.max(y1, a.y); }
      const margen = 34;
      const esc = Math.min(2.2, (ancho - margen * 2) / Math.max(1, x1 - x0), (alto - margen * 2) / Math.max(1, y1 - y0));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const k = deGolpe || !vista.ok ? 1 : 0.12;
      vista.esc += (esc - vista.esc) * k;
      vista.x += (cx - vista.x) * k;
      vista.y += (cy - vista.y) * k;
      vista.ok = true;
    }

    const aPantalla = (a) => [(a.x - vista.x) * vista.esc + ancho / 2, (a.y - vista.y) * vista.esc + alto / 2];
    const aMundo = (px, py) => [(px - ancho / 2) / vista.esc + vista.x, (py - alto / 2) / vista.esc + vista.y];
    const radio = (a) => a.tam * Math.max(0.75, Math.min(1.3, vista.esc));

    // ---------------------------------------------------------------- dibujo
    function dibujar() {
      if (!medir()) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);
      const hay = !!elegido;
      for (const e of aristas) {
        const [ax, ay] = aPantalla(e.a), [bx, by] = aPantalla(e.b);
        const suya = hay && (e.a.id === elegido || e.b.id === elegido);
        ctx.globalAlpha = hay && !suya ? 0.12 : e.clase === "mencion" ? 0.75 : 0.45;
        ctx.strokeStyle = suya ? "#1c7ed6" : e.clase === "mencion" ? "#868e96" : "#adb5bd";
        ctx.lineWidth = suya ? 2.2 : e.clase === "mencion" ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const etiquetas = [];
      for (const a of nodos) {
        const [x, y] = aPantalla(a), r = radio(a);
        const apagado = hay && a.id !== elegido && !vecinos.has(a.id);
        ctx.globalAlpha = apagado ? 0.25 : 1;
        if (a.id === elegido) { ctx.fillStyle = "rgba(28, 126, 214, 0.18)"; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = a.clase === "nota" ? 1.5 : 2.5;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        if (!apagado) etiquetas.push([a, x, y, r]);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      // Etiquetas sin pisarse: primero Tú, las carpetas, el elegido y sus vecinos; una que choca con otra
      // ya puesta no se escribe (como en Obsidian, se ve al tocar o al acercar el punto)
      const prioridad = (a) => (a.clase === "centro" ? 0 : a.id === elegido ? 1 : a.clase === "grupo" ? 2 : vecinos.has(a.id) ? 3 : 4 - Math.min(0.9, a.grado / 10));
      etiquetas.sort((p, q) => prioridad(p[0]) - prioridad(q[0]));
      const puestas = [];
      for (const [a, x, y, r] of etiquetas) {
        ctx.font = `${a.clase === "nota" ? 500 : 700} ${a.clase === "centro" ? 14 : a.clase === "grupo" ? 12.5 : 11.5}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        const t = a.etiqueta.length > 24 ? a.etiqueta.slice(0, 23) + "…" : a.etiqueta;
        const w = ctx.measureText(t).width, caja = [x - w / 2 - 2, y + r + 2, x + w / 2 + 2, y + r + 18];
        if (puestas.some((b) => caja[0] < b[2] && caja[2] > b[0] && caja[1] < b[3] && caja[3] > b[1])) continue;
        puestas.push(caja);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
        ctx.lineWidth = 4;
        ctx.strokeText(t, x, y + r + 3);
        ctx.fillStyle = a.clase === "nota" ? "#344e63" : "#0f2a3d";
        ctx.fillText(t, x, y + r + 3);
      }
    }

    // ---------------------------------------------------------------- tocar y arrastrar
    function nodoEn(px, py) {
      let mejor = null, dmin = Infinity;
      for (const a of nodos) {
        const [x, y] = aPantalla(a), d = Math.hypot(x - px, y - py);
        if (d < radio(a) + 10 && d < dmin) { mejor = a; dmin = d; }
      }
      return mejor;
    }
    const punto = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    canvas.addEventListener("pointerdown", (e) => {
      const [px, py] = punto(e), n = nodoEn(px, py);
      arrastre = {n, x0: px, y0: py, movido: false};
      if (n) { canvas.setPointerCapture(e.pointerId); calentar(0.3); }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!arrastre) { canvas.style.cursor = nodoEn(...punto(e)) ? "pointer" : "default"; return; }
      const [px, py] = punto(e);
      if (Math.hypot(px - arrastre.x0, py - arrastre.y0) > 5) arrastre.movido = true;
      if (arrastre.n && arrastre.movido) {
        e.preventDefault();
        [arrastre.n.x, arrastre.n.y] = aMundo(px, py);
        alfa = Math.max(alfa, 0.25);
        if (!corriendo) calentar(0.25);
      }
    });
    const soltar = () => {
      const a = arrastre;
      arrastre = null;
      if (!a) return;
      if (!a.movido) {                                         // un toque: elegir (o soltar si fue en el fondo)
        const id = a.n ? (a.n.id === elegido ? null : a.n.id) : null;
        elegir(id);
        if (opciones.alTocar) opciones.alTocar(id);
      }
      calentar(0.1);
    };
    canvas.addEventListener("pointerup", soltar);
    canvas.addEventListener("pointercancel", soltar);
    if (window.ResizeObserver) new ResizeObserver(() => { vista.ok = false; calentar(0.05); }).observe(canvas);

    return {datos, elegir, redibujar: () => calentar(0.05), depurar: () => ({nodos: nodos.length, aristas: aristas.length, alfa, elegido,
      vista: Object.assign({}, vista), posiciones: nodos.map((a) => ({id: a.id, x: Math.round(a.x), y: Math.round(a.y)}))})};
  }

  return {montar};
})();
if (typeof module !== "undefined") module.exports = MapaCerebro;
