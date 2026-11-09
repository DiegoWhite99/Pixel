/* Fase 9 - Cara 3D de Pixel en WebGL, sin librerias. Se estira al arrastrarla y vuelve rebotando,
   como la cara de Mario 64.
   Fase 13 (9 nov, a pedido del usuario): sin boca, y los ojos son dos LED amarillos DENTRO del visor
   negro (no sobresalen): se dibujan en el shader de la cabeza, sobre su superficie, asi que se
   estiran con ella. Tienen rejilla de LED, nucleo casi blanco, borde naranja y brillan sobre el
   visor (retroiluminacion). Son muy expresivos: los parpados recortan la forma con curvas (feliz
   ^ ^, triste, enojado, dormido, curioso, guino...) y como pantalla LED pueden ser corazones, X,
   "> <" o espirales. El tamano va con muelles que rebotan, parpadean, miran y, como no hay boca,
   al hablar laten con el volumen de la voz.
   La usa app.js: CaraPixel.montar(canvas) devuelve la api, o null sin WebGL:
     estado(nombre)       esperando | escuchando | pensando | hablando | sin-servidor | normal
     emocion(nombre, ms)  un gesto un rato (ms = 0 lo quita); ver GESTOS
     evento(nombre)       una animacion corta: mirar, bostezo, estornudo, tararear, mareo, risa, corazones, guino
     boca(nivel)          volumen de la voz que suena (0..1; null = sin voz): hace latir los ojos
     bailar(bpm, reloj, genero)  con musica: baila al tempo (bpm; 0 = para) y al estilo del genero
                          (ESTILOS: pasos, ojos, color de los LED y figuras musicales que suben por el
                          fondo en cada golpe). reloj() da los segundos del video (asi se para en las
                          pausas y sigue el paso); sin reloj, cuenta desde ahora
     alAgarrar(), alSoltar(toque, info): ganchos para quien quiera reaccionar (humor.js) */
"use strict";

window.CaraPixel = (function () {
  // ---------------------------------------------------------------- vectores y matrices
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const RAD = Math.PI / 180;

  function perspectiva(fovy, aspecto, cerca, lejos) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (cerca - lejos);
    return new Float32Array([f / aspecto, 0, 0, 0, 0, f, 0, 0, 0, 0, (lejos + cerca) * nf, -1, 0, 0, 2 * lejos * cerca * nf, 0]);
  }

  function mirar(ojo, centro, arriba) {
    const z = norm(sub(ojo, centro)), x = norm(cross(arriba, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, ojo), -dot(y, ojo), -dot(z, ojo), 1]);
  }

  // rotacion Ry(yaw) * Rx(pitch) * Rz(roll), en columnas
  function rotacion(yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx = [[1, 0, 0], [0, cp, sp], [0, -sp, cp]];            // columnas de Rx
    const ry = [[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]];
    const rz = [[cr, sr, 0], [-sr, cr, 0], [0, 0, 1]];
    const aplicar = (m, v) => add(add(mul(m[0], v[0]), mul(m[1], v[1])), mul(m[2], v[2]));
    const rxz = rz.map((c) => aplicar(rx, c));
    return rxz.map((c) => aplicar(ry, c));                         // 3 columnas
  }
  const rotar = (r, v) => add(add(mul(r[0], v[0]), mul(r[1], v[1])), mul(r[2], v[2]));
  const desrotar = (r, v) => [dot(r[0], v), dot(r[1], v), dot(r[2], v)];
  const direccion = (lon, lat) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];

  // ---------------------------------------------------------------- gestos de los ojos
  // forma: 0 ojo con parpados, 1 corazon, 2 X, 3 "> <" (apretados), 4 espiral (mareo).
  // esc: [ancho, alto]. Parpados (forma 0): arriba / abajo = altura en el centro (1,05 / -1,05:
  // abiertos); incl: ceno (+ enojado: baja el lado de la nariz; - triste); curvaA: el de arriba baja
  // por los lados; curvaB: el de abajo sube en el centro (+ sonrisa ^ ^; - linea curva de dormido).
  // brillo: luz. Con izq / der, cada ojo el suyo (izq = el de la izquierda de la pantalla).
  const ABIERTO = {forma: 0, esc: [1, 1], arriba: 1.05, incl: 0, curvaA: 0, abajo: -1.05, curvaB: 0, brillo: 1};
  const G = (o) => Object.assign({}, ABIERTO, o);
  const GESTOS = {
    normal: G({}),
    escuchando: G({esc: [1.06, 1.1], brillo: 1.15}),
    hablando: G({esc: [1.04, 1], abajo: -0.85, curvaB: 0.12, brillo: 1.1}),
    pensando: {izq: G({esc: [1.02, 1.04], arriba: 0.8, incl: -0.12, brillo: 0.95}),
      der: G({esc: [0.96, 0.92], arriba: 0.55, incl: 0.1, abajo: -0.65, brillo: 0.95})},
    feliz: G({esc: [1.1, 1.02], abajo: -0.25, curvaB: 0.9, brillo: 1.3}),
    sorpresa: G({esc: [1.28, 1.34], brillo: 1.45}),
    triste: G({esc: [0.96, 0.94], arriba: 0.5, incl: -0.5, abajo: -1.05, brillo: 0.72}),
    enojado: G({esc: [1.02, 0.92], arriba: 0.5, incl: 0.6, abajo: -0.75, brillo: 1.25}),
    curioso: {izq: G({esc: [1.2, 1.24], brillo: 1.25}), der: G({esc: [0.94, 0.9], arriba: 0.42, incl: 0.18, brillo: 1.05})},
    guino: {izq: G({esc: [1.08, 1.04], abajo: -0.4, curvaB: 0.55, brillo: 1.25}),
      der: G({esc: [1.08, 1], arriba: -0.36, curvaA: -0.3, abajo: -0.52, curvaB: -0.3, brillo: 1.15})},
    dormido: G({esc: [1.06, 1], arriba: -0.42, curvaA: -0.26, abajo: -0.6, curvaB: -0.26, brillo: 0.62}),
    aburrido: G({esc: [1.04, 1], arriba: 0.12, abajo: -0.75, brillo: 0.8}),
    bostezo: G({esc: [1.04, 0.95], arriba: -0.05, curvaA: -0.15, abajo: -0.55, curvaB: -0.15, brillo: 0.85}),
    amor: G({forma: 1, esc: [1.15, 1.15], brillo: 1.4}),
    error: G({forma: 2, esc: [0.85, 0.85], brillo: 0.6}),
    mareado: G({forma: 4, esc: [1.12, 1.12], brillo: 1.1}),
    risa: G({forma: 3, esc: [1.05, 1.0], brillo: 1.3}),
    bailando: G({esc: [1.08, 1.02], abajo: -0.3, curvaB: 0.85, brillo: 1.3}),
    escribiendo: G({esc: [1.04, 0.98], arriba: 0.78, abajo: -0.95, brillo: 1.15}),
    chevere: G({esc: [1.14, 0.9], arriba: 0.32, incl: 0.06, abajo: -0.85, brillo: 1.3}),              // medio cerrados, con actitud
    extasis: G({esc: [1.08, 1], arriba: -0.4, curvaA: -0.26, abajo: -0.6, curvaB: -0.26, brillo: 1.15}),   // cerrados, disfrutando
    apretado: G({forma: 3, esc: [0.95, 0.9], brillo: 1.1}),
  };
  const CAMPOS = ["arriba", "incl", "curvaA", "abajo", "curvaB", "brillo"];
  const SIN_PARPADEO = new Set(["dormido", "feliz", "guino", "bostezo", "amor", "error", "mareado", "risa", "apretado", "bailando", "chevere", "extasis"]);

  // ---------------------------------------------------------------- estilos de baile por genero
  // pasos: uno cada 8 tiempos, en orden (ver PASOS); gestos: los ojos, uno por compas de 4 tiempos;
  // led: color de los ojos (null = amarillo; "neon" = cambia en cada golpe); figuras y tonos: lo que
  // sube por el fondo; cada: cada cuantos golpes sale una figura; fuerza: amplitud de los pasos.
  const ESTILOS = {
    pop: {pasos: ["rebote", "asentir", "giro"], gestos: ["bailando", "feliz"], figuras: "♪♫♬♩", tonos: ["#4dabf7", "#20c997", "#fcc419"], fuerza: 1},
    reggaeton: {pasos: ["perreo", "perreo", "lado"], gestos: ["chevere", "chevere", "guino", "chevere"], figuras: "♪♫♬", tonos: ["#fcc419", "#ff922b", "#f06595"], fuerza: 1.1},
    rock: {pasos: ["cabezazo", "cabezazo", "sacudir"], gestos: ["apretado", "enojado"], figuras: "⚡★♫♪", tonos: ["#ff6b6b", "#fab005", "#868e96"], fuerza: 1.2},
    metal: {pasos: ["cabezazo", "sacudir"], gestos: ["apretado", "enojado"], figuras: "⚡★⚡♫", tonos: ["#fa5252", "#495057", "#fd7e14"], fuerza: 1.4},
    electronica: {pasos: ["robot", "pulso", "robot", "giro"], gestos: ["bailando", "sorpresa"], led: "neon", figuras: "◆▲●■♪", tonos: ["#22b8cf", "#cc5de8", "#51cf66", "#fcc419"], fuerza: 1, cada: 1},
    balada: {pasos: ["mecer"], gestos: ["extasis", "extasis", "amor", "extasis"], figuras: "♥♪♫♥", tonos: ["#f783ac", "#ffa8a8", "#e599f7"], fuerza: 0.8, cada: 2},
    salsa: {pasos: ["cadera", "rebote", "giro"], gestos: ["feliz", "bailando"], figuras: "♪♫♬♩", tonos: ["#ff922b", "#fab005", "#20c997", "#f06595"], fuerza: 1.1},
    cumbia: {pasos: ["cadera", "paso", "cadera", "giro"], gestos: ["feliz", "bailando"], figuras: "♪♫♬", tonos: ["#fab005", "#40c057", "#ff922b"], fuerza: 1},
    rap: {pasos: ["asentir", "asentir", "lado"], gestos: ["chevere"], figuras: "♪♫", tonos: ["#868e96", "#fcc419", "#339af0"], fuerza: 1},
    clasica: {pasos: ["director"], gestos: ["extasis", "extasis", "bailando"], figuras: "♩♪♫", tonos: ["#748ffc", "#adb5bd", "#fcc419"], fuerza: 0.8, cada: 2},
    jazz: {pasos: ["asentir", "mecer"], gestos: ["chevere", "extasis"], figuras: "♪♫♬", tonos: ["#e8590c", "#5c7cfa", "#fcc419"], fuerza: 0.9, cada: 2},
  };
  // Un paso de baile: posicion de la cabeza en este momento (fase = tiempos desde el inicio)
  const PASOS = {
    rebote: (fase, g) => ({y: 0.09 * Math.abs(Math.sin(fase * Math.PI)), roll: 0.16 * Math.sin(fase * Math.PI)}),
    asentir: (fase, g) => ({pitch: 0.16 * g - 0.04, yaw: 0.28 * Math.sin(fase * Math.PI / 2), y: 0.04 * g}),
    giro: (fase, g, enPaso) => ({y: 0.07 * Math.abs(Math.sin(fase * Math.PI)), roll: 0.08 * Math.sin(fase * Math.PI),
      yaw: enPaso > 0.75 ? ((enPaso - 0.75) / 0.25) * Math.PI * 2 : 0, gira: true}),          // vuelta entera en los 2 ultimos tiempos
    perreo: (fase, g) => ({y: 0.07 * g - 0.02, pitch: 0.1 + 0.06 * g, x: 0.12 * Math.sin(fase * Math.PI), roll: 0.06 * Math.sin(fase * Math.PI)}),
    lado: (fase, g) => ({x: 0.18 * Math.sin(fase * Math.PI / 2), y: 0.05 * Math.abs(Math.sin(fase * Math.PI)), yaw: 0.15 * Math.sin(fase * Math.PI / 2)}),
    cabezazo: (fase, g) => ({pitch: 0.34 * g - 0.08, roll: 0.05 * Math.sin(fase * Math.PI * 4), y: -0.03 * g}),
    sacudir: (fase, g) => ({roll: 0.24 * Math.sin(fase * Math.PI * 2), pitch: 0.12 * g, y: 0.03 * g}),
    robot: (fase, g) => {                                 // a golpes secos, como un robot
      const n = Math.floor(fase) % 4, yaw = [-0.3, 0, 0.3, 0][n], pitch = [0, -0.12, 0, 0.12][n], k = Math.min(1, (fase % 1) * 6);
      return {yaw: yaw * k, pitch: pitch * k, y: 0.02 * g};
    },
    pulso: (fase, g) => ({y: 0.05 * g, escala: 0.11 * g, roll: 0.04 * Math.sin(fase * Math.PI)}),
    mecer: (fase, g) => ({roll: 0.13 * Math.sin(fase * Math.PI / 2), x: 0.05 * Math.sin(fase * Math.PI / 2), y: 0.03 * Math.sin(fase * Math.PI)}),
    cadera: (fase, g) => ({x: 0.14 * Math.sin(fase * Math.PI), roll: 0.1 * Math.sin(fase * Math.PI), y: 0.05 * Math.abs(Math.sin(fase * Math.PI))}),
    paso: (fase, g) => ({yaw: 0.22 * Math.sin(fase * Math.PI), x: 0.08 * Math.sin(fase * Math.PI / 2), y: 0.04 * g}),
    director: (fase, g) => ({roll: 0.09 * Math.sin(fase * Math.PI / 2), pitch: 0.07 * Math.sin(fase * Math.PI), y: 0.02 * Math.sin(fase * Math.PI)}),
  };
  // nombres como los dice Gemini (o el usuario) -> estilo
  function estiloDe(genero) {
    const g = String(genero || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (ESTILOS[g]) return g;
    if (/regg?ae?ton|urbano|dembow|trap latino/.test(g)) return "reggaeton";
    if (/metal|hardcore|punk/.test(g)) return "metal";
    if (/rock|grunge|indie/.test(g)) return "rock";
    if (/electr|edm|house|techno|trance|dubstep|dance/.test(g)) return "electronica";
    if (/balad|romant|bolero|acust|soul|r&b|rnb/.test(g)) return "balada";
    if (/salsa|merengue|bachata|tropical|son/.test(g)) return "salsa";
    if (/cumbia|vallenato|champeta|porro/.test(g)) return "cumbia";
    if (/rap|hip ?hop/.test(g)) return "rap";
    if (/clasic|orquest|opera|instrumental/.test(g)) return "clasica";
    if (/jazz|blues|swing|bossa/.test(g)) return "jazz";
    return "pop";
  }
  // la cabeza tambien actua: ladeo y cabeceo (radianes), salto al empezar, vaiven [amplitud, Hz]
  const CABEZA = {pensando: {ladeo: 0.14, cabeceo: -0.08}, curioso: {ladeo: -0.2}, triste: {ladeo: 0.05, cabeceo: 0.16},
    feliz: {cabeceo: -0.05, salta: 1}, sorpresa: {cabeceo: -0.1, salta: 0.6}, enojado: {cabeceo: 0.1, vaiven: [0.03, 7]},
    dormido: {ladeo: 0.06, cabeceo: 0.14}, guino: {ladeo: -0.12}, aburrido: {ladeo: 0.1, cabeceo: 0.12},
    bostezo: {cabeceo: -0.28, ladeo: -0.06}, amor: {vaiven: [0.08, 1.6]}, mareado: {vaiven: [0.16, 3.2]},
    risa: {salta: 1, vaiven: [0.07, 5]}, apretado: {cabeceo: 0.08}, error: {ladeo: 0.1}, escribiendo: {cabeceo: 0.12, ladeo: 0.05}};
  // animaciones cortas: una lista de [gesto, ms]; "mirar" mueve los ojos de lado a lado
  const EVENTOS = {
    bostezo: [["bostezo", 1700], ["normal", 200]],
    estornudo: [["apretado", 520], ["sorpresa", 650]],
    tararear: [["feliz", 3200]],
    mareo: [["mareado", 2600]],
    risa: [["risa", 1300]],
    corazones: [["amor", 2400]],
    guino: [["guino", 900]],
    mirar: [["curioso", 1600]],
  };

  // ---------------------------------------------------------------- textura de la cabeza (visor y mejillas)
  const TW = 2048, TH = 1024, GRADO = TW / 360;
  const xy = (lon, lat) => [TW / 2 + lon * GRADO, TH / 2 - lat * (TH / 180)];

  function texturaCabeza() {
    const t = document.createElement("canvas");
    t.width = TW; t.height = TH;
    const c = t.getContext("2d");
    c.fillStyle = "#f4f9ff"; c.fillRect(0, 0, TW, TH);
    for (const lon of [-36, 36]) {                     // mejillas
      const [x, y] = xy(lon, -14);
      const g = c.createRadialGradient(x, y, 0, x, y, 52);
      g.addColorStop(0, "rgba(120, 225, 200, 0.26)"); g.addColorStop(1, "rgba(120, 225, 200, 0)");
      c.fillStyle = g; c.fillRect(x - 56, y - 56, 112, 112);
    }
    // visor: la banda negra donde viven los LED
    const [x0, y0] = xy(-42, 28), [x1, y1] = xy(42, -10), r = (y1 - y0) / 2;
    c.beginPath();
    c.moveTo(x0 + r, y0); c.arcTo(x1, y0, x1, y1, r); c.arcTo(x1, y1, x0, y1, r); c.arcTo(x0, y1, x0, y0, r); c.arcTo(x0, y0, x1, y0, r);
    c.closePath();
    const gv = c.createLinearGradient(0, y0, 0, y1);
    gv.addColorStop(0, "#162f55"); gv.addColorStop(0.5, "#0b1c37"); gv.addColorStop(1, "#08152b");
    c.fillStyle = gv; c.fill();
    c.lineWidth = 6; c.strokeStyle = "rgba(77, 171, 247, 0.55)"; c.stroke();     // filo azul del visor
    return t;
  }

  // ---------------------------------------------------------------- shaders
  const VS_CARA = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUV;
    uniform mat4 uProj, uView; uniform mat3 uRot; uniform vec3 uCentro; uniform vec3 uEscala;
    varying vec3 vN; varying vec3 vP; varying vec2 vUV;
    void main() {
      vec3 p = uRot * (aPos * uEscala) + uCentro;
      vP = p; vN = uRot * aNor; vUV = aUV;
      gl_Position = uProj * uView * vec4(p, 1.0);
    }`;
  // Los ojos LED se dibujan aqui, sobre la cabeza, en coordenadas de longitud y latitud (salen de la
  // UV): asi quedan dentro del visor y se estiran con la cara. Cada ojo: uC (lon, lat, ancho, alto),
  // uA (arriba, incl, curvaA, apertura), uB (abajo, curvaB, brillo, forma).
  const FS_CARA = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D uTex; uniform vec3 uOjo;
    uniform vec4 uC1, uA1, uB1, uC2, uA2, uB2; uniform float uRadio, uT;
    uniform vec3 uMejA, uMejB; uniform float uRubor; uniform vec4 uTinte;    // uTinte: color de los LED (rgb) y cuanto (a)
    varying vec3 vN; varying vec3 vP; varying vec2 vUV;

    float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
    float corazon(vec2 p) {                     // el corazon de Inigo Quilez, centrado
      p = p * 0.82 + vec2(0.0, 0.62); p.x = abs(p.x);
      if (p.y + p.x > 1.0) return (length(p - vec2(0.25, 0.75)) - 0.35355) / 0.82;
      vec2 q = p - 0.5 * max(p.x + p.y, 0.0), t = p - vec2(0.0, 1.0);
      return sqrt(min(dot(t, t), dot(q, q))) * sign(p.x - p.y) / 0.82;
    }
    // distancia con signo al borde del LED (negativa dentro), en radios de ojo
    float forma(vec2 p, vec4 a, vec4 b, float lado) {
      float f = b.w;
      if (f < 0.5) {
        float x = p.x * lado;                   // x > 0: hacia la nariz
        float bajo = b.x + b.y * (1.0 - x * x);
        float alto = a.x - a.y * x - a.z * x * x;
        alto = mix(bajo + 0.1, max(alto, bajo + 0.1), a.w);              // parpadeo: hasta una rayita
        return max(length(p) - 1.0, max(p.y - alto, bajo - p.y));
      }
      if (f < 1.5) return corazon(p);
      if (f < 2.5) return min(seg(p, vec2(-0.6, -0.6), vec2(0.6, 0.6)), seg(p, vec2(-0.6, 0.6), vec2(0.6, -0.6))) - 0.2;
      if (f < 3.5) { vec2 q = vec2(p.x * lado, p.y);                     // "> <": apuntan a la nariz
        return min(seg(q, vec2(-0.5, 0.62), vec2(0.45, 0.0)), seg(q, vec2(0.45, 0.0), vec2(-0.5, -0.62))) - 0.19; }
      float r = length(p), ang = atan(p.y, p.x);                          // espiral que gira
      float s = fract(r * 1.7 - ang / 6.2832 * lado - uT * 1.4);
      return max(r - 1.0, (abs(s - 0.5) - 0.2) / 1.7);
    }
    // la luz de un ojo en este punto: rgb = color del LED, a = brillo alrededor (retroiluminacion)
    vec4 led(vec2 ll, vec4 c, vec4 a, vec4 b, float lado) {
      vec2 p = vec2((ll.x - c.x) * cos(radians(c.y)), ll.y - c.y) / (uRadio * c.zw);
      if (dot(p, p) > 9.0) return vec4(0.0);
      float d = forma(p, a, b, lado);
      float dentro = smoothstep(0.06, -0.06, d);
      float nucleo = clamp(-d * 1.5, 0.0, 1.0);
      vec3 naranja = vec3(1.0, 0.5, 0.04), amarillo = vec3(1.0, 0.83, 0.12), blanco = vec3(1.0, 0.98, 0.82);
      vec3 col = mix(naranja, amarillo, smoothstep(0.0, 0.3, nucleo));
      col = mix(col, blanco, smoothstep(0.55, 1.0, nucleo) * 0.55);
      col = mix(col, mix(uTinte.rgb, vec3(1.0), smoothstep(0.6, 1.0, nucleo) * 0.45), uTinte.a);   // electronica: neon
      vec2 celda = fract(p * 5.2) - 0.5;                                  // la rejilla de puntos del LED
      float punto = smoothstep(0.5, 0.28, length(celda));
      float luz = dentro * mix(0.6, 1.0, punto) * b.z;
      float halo = exp(-max(d, 0.0) * 3.0) * (1.0 - dentro) * b.z;
      return vec4(col * luz, halo);
    }
    void main() {
      vec3 n = normalize(vN), v = normalize(uOjo - vP);
      vec3 l = normalize(vec3(-0.45, 0.75, 0.6)), l2 = normalize(vec3(0.85, 0.05, 0.35));
      vec3 alb = texture2D(uTex, vUV).rgb;
      float oscuro = 1.0 - dot(alb, vec3(0.299, 0.587, 0.114));
      vec3 cielo = mix(vec3(0.86, 0.96, 0.92), vec3(0.93, 0.97, 1.0), n.y * 0.5 + 0.5);
      vec3 luz = cielo * 0.72 + vec3(1.0, 0.99, 0.96) * max(dot(n, l), 0.0) * 0.45
               + vec3(0.75, 0.88, 1.0) * max(dot(n, l2), 0.0) * 0.16
               + vec3(0.85, 0.97, 0.92) * max(-n.y, 0.0) * 0.25;          // rebote del suelo
      float esp = pow(max(dot(n, normalize(l + v)), 0.0), mix(70.0, 160.0, oscuro)) * mix(0.5, 0.95, oscuro);
      float borde = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 c = alb * luz + borde * vec3(0.30, 0.82, 0.70) * 0.28;
      // los LED, solo dentro del visor
      vec2 ll = vec2((vUV.x - 0.5) * 360.0, 90.0 - vUV.y * 180.0);
      float visor = smoothstep(0.55, 0.75, oscuro);
      vec4 o1 = led(ll, uC1, uA1, uB1, 1.0), o2 = led(ll, uC2, uA2, uB2, -1.0);
      vec3 calido = mix(vec3(1.0, 0.62, 0.1), uTinte.rgb, uTinte.a);
      c += ((o1.rgb + o2.rgb) + calido * (o1.a + o2.a) * 0.42) * visor;
      c += esp;                                                           // el reflejo del vidrio, encima
      vec3 mA = vP - uMejA, mB = vP - uMejB;
      float rub = (exp(-dot(mA, mA) / 0.018) + exp(-dot(mB, mB) / 0.018)) * uRubor;
      c = mix(c, vec3(1.0, 0.62, 0.55), rub * 0.55);
      gl_FragColor = vec4(c, 1.0);
    }`;
  const VS_SUELO = `
    attribute vec3 aPos; uniform mat4 uProj, uView; varying vec3 vP;
    void main() { vP = aPos; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
  const FS_SUELO = `
    precision mediump float;
    uniform vec3 uCentro; uniform float uSoloSombra; varying vec3 vP;
    void main() {
      vec2 celda = floor(vP.xz * 0.95);
      float cuadro = mod(celda.x + celda.y, 2.0);
      vec3 c = mix(vec3(1.0), vec3(0.80, 0.94, 0.89), cuadro);
      float d = length(vP.xz - uCentro.xz), alto = max(uCentro.y - vP.y, 0.5);
      float sombra = 0.22 * smoothstep(0.95, 0.0, d) * clamp(1.6 / alto, 0.4, 1.0);
      c *= 1.0 - sombra;
      float a = 1.0 - smoothstep(2.5, 7.0, length(vP.xz - vec2(0.0, 1.0)));
      // con un escenario de musica detras (escenarios.js) no se dibuja el suelo de cuadros: solo la sombra
      gl_FragColor = mix(vec4(c * a, a), vec4(0.0, 0.0, 0.0, sombra * 1.9 * a), uSoloSombra);
    }`;

  function programa(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [tipo, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nombre = gl.getActiveUniform(p, i).name; u[nombre] = gl.getUniformLocation(p, nombre); }
    return {p, u, a: (nombre) => gl.getAttribLocation(p, nombre)};
  }

  // ---------------------------------------------------------------- montar
  function montar(canvas) {
    let gl;
    try { gl = canvas.getContext("webgl", {alpha: true, premultipliedAlpha: true, antialias: true}); } catch (e) { gl = null; }
    if (!gl) return null;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // esfera: posiciones base, normales, uv e indices (mas fina que antes: los ojos van en ella)
    const LAT = 48, LON = 72, R = 1;
    const nv = (LAT + 1) * (LON + 1);
    const base = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let i = 0, k = 0; i <= LAT; i++) {
      const th = Math.PI / 2 - (i * Math.PI) / LAT;
      for (let j = 0; j <= LON; j++, k++) {
        const ph = -Math.PI + (j * 2 * Math.PI) / LON;
        base[k * 3] = R * Math.cos(th) * Math.sin(ph);
        base[k * 3 + 1] = R * Math.sin(th);
        base[k * 3 + 2] = R * Math.cos(th) * Math.cos(ph);
        uv[k * 2] = j / LON; uv[k * 2 + 1] = i / LAT;
      }
    }
    const ind = new Uint16Array(LAT * LON * 6);
    for (let i = 0, k = 0; i < LAT; i++) {
      for (let j = 0; j < LON; j++) {
        const a = i * (LON + 1) + j, b = a + LON + 1;
        ind.set([a, b, a + 1, a + 1, b, b + 1], k); k += 6;
      }
    }
    const pos = new Float32Array(base), nor = new Float32Array(base);
    const desp = new Float32Array(nv * 3), vel = new Float32Array(nv * 3), peso = new Float32Array(nv);

    let pc, ps;
    try { pc = programa(gl, VS_CARA, FS_CARA); ps = programa(gl, VS_SUELO, FS_SUELO); } catch (e) { console.warn("cara3d:", e); return null; }
    const buf = (datos, tipo, uso) => { const b = gl.createBuffer(); gl.bindBuffer(tipo, b); gl.bufferData(tipo, datos, uso); return b; };
    const bPos = buf(pos, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW), bNor = buf(nor, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    const bUV = buf(uv, gl.ARRAY_BUFFER, gl.STATIC_DRAW), bInd = buf(ind, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
    const Y_SUELO = -1.45;
    const bSuelo = buf(new Float32Array([-14, Y_SUELO, -12, 14, Y_SUELO, -12, -14, Y_SUELO, 8, 14, Y_SUELO, 8]), gl.ARRAY_BUFFER, gl.STATIC_DRAW);

    const tCabeza = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tCabeza);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texturaCabeza());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // ------------------------------------------------------------ los ojos (LED en el visor)
    const RADIO = 9;                                       // radio de cada ojo, en grados de la cabeza
    const OJOS = [-19, 19].map((lon) => ({lon, lat: 9, lado: lon < 0 ? 1 : -1, g: Object.assign({}, ABIERTO), esc: [1, 1], vesc: [0, 0], luz: 1}));
    const MEJILLAS = [-36, 36].map((lon) => direccion(lon, -14));

    // ------------------------------------------------------------ estado de la animacion
    let estado = "esperando", emocion = "", emocionHasta = 0, vozReal = null;   // vozReal: {nivel, hasta}
    let secuencia = [];                                    // [{gesto, hasta}] de un evento
    let baile = null, golpeBaile = 0;                      // {bpm, reloj, t0, ultimo}: bailando con la musica
    const mirada = {x: 0, y: 0, ox: 0, oy: 0, t: 0}, giro = {yaw: 0, pitch: 0, roll: 0};
    let parpadeo = {siguiente: 2, inicio: -1, doble: false}, voz = 0, rubor = 0, salto = 0, animoAntes = "";
    let tiempo = 0, ultimo = performance.now(), visible = true, activa = false;
    let agarre = null, rot = rotacion(0, 0, 0), centro = [0, 0, 0];

    const OJO = [0, 0.55, 4.6], MIRA = [0, -0.05, 0];
    const F = norm(sub(MIRA, OJO)), DER = norm(cross(F, [0, 1, 0])), ARR = cross(DER, F);
    const FOV = (34 * Math.PI) / 180;
    const vista = mirar(OJO, MIRA, [0, 1, 0]);
    let proy = perspectiva(FOV, 1, 0.1, 50), aspecto = 1;

    function animoActual() {
      while (secuencia.length && tiempo > secuencia[0].hasta) secuencia.shift();
      if (secuencia.length) return secuencia[0].gesto;
      const emo = tiempo < emocionHasta ? emocion : "";
      if (emo && GESTOS[emo]) return emo;
      if (baile && estado !== "hablando" && estado !== "pensando") {
        const e = ESTILOS[baile.estilo], compas = Math.floor((baile.fase || 0) / 4);
        return e.gestos[compas % e.gestos.length];
      }
      return {esperando: "dormido", "sin-servidor": "error", escuchando: "escuchando", hablando: "hablando", pensando: "pensando"}[estado] || "normal";
    }

    // Lleva cada ojo hacia su gesto: los parpados suaves y el tamano con un muelle que rebota
    function moverOjos(dt, animo) {
      const gesto = GESTOS[animo] || GESTOS.normal;
      const k = 1 - Math.exp(-dt * 11);
      const latido = animo === "amor" ? Math.pow(Math.max(0, Math.sin(tiempo * 7.5)), 6) * 0.16 : 0;   // corazon que late
      for (const o of OJOS) {
        const meta = gesto.izq ? (o.lado > 0 ? gesto.izq : gesto.der) : gesto;
        for (const c of CAMPOS) o.g[c] += (meta[c] - o.g[c]) * k;
        o.g.forma = meta.forma;
        const ex = meta.esc[0] * (1 + voz * 0.1 + latido), ey = meta.esc[1] * (1 - voz * 0.12 + latido);
        for (const [e, objetivo] of [[0, ex], [1, ey]]) {
          o.vesc[e] += (240 * (objetivo - o.esc[e]) - (quieto ? 31 : 13) * o.vesc[e]) * dt;
          o.esc[e] = Math.max(0.3, o.esc[e] + o.vesc[e] * dt);
        }
        let luz = o.g.brillo;
        if (animo === "escuchando") luz *= 1 + 0.07 * Math.sin(tiempo * 3.2);
        if (animo === "dormido") luz *= 0.75 + 0.25 * Math.sin(tiempo * 1.3);
        if (animo === "pensando") luz *= 0.9 + 0.12 * Math.sin(tiempo * 5 + o.lado);
        if (animo === "error") luz *= Math.random() < 0.05 ? 0.3 : 1;          // bombilla floja
        if (animo === "hablando") luz *= 1 + voz * 0.55;
        if (baile) luz *= 1 + 0.4 * golpeBaile;                                 // destello en cada golpe
        o.luz = luz;
      }
    }

    // Al cambiar de gesto, un empujon a los muelles: los ojos "saltan" al nuevo
    function empujon(animo) {
      const fuerza = {sorpresa: 7, feliz: 4, curioso: 3, amor: 5, risa: 4, mareado: 3, enojado: -3, triste: -2, apretado: -4}[animo] || 1.5;
      for (const o of OJOS) { o.vesc[0] += fuerza * 0.6; o.vesc[1] += fuerza; }
      const c = CABEZA[animo];
      if (c && c.salta) salto = c.salta;
    }

    // ------------------------------------------------------------ deformacion (muelles)
    function rayo(ev) {
      const r = canvas.getBoundingClientRect();
      const nx = ((ev.clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((ev.clientY - r.top) / r.height) * 2;
      const t = Math.tan(FOV / 2);
      return norm(add(add(F, mul(DER, nx * t * aspecto)), mul(ARR, ny * t)));
    }

    function golpe(d) {                                    // donde el rayo toca la esfera sin deformar
      const oc = sub(OJO, centro), b = dot(oc, d), c = dot(oc, oc) - R * R, disc = b * b - c;
      if (disc < 0) return null;
      return add(OJO, mul(d, -b - Math.sqrt(disc)));
    }

    function pesos(p0, sigma) {
      for (let i = 0; i < nv; i++) {
        const dx = base[i * 3] - p0[0], dy = base[i * 3 + 1] - p0[1], dz = base[i * 3 + 2] - p0[2];
        peso[i] = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sigma * sigma));
      }
    }

    function fisica(dt) {
      const k = 150, c = quieto ? 2 * Math.sqrt(150) : 6.5;
      const objetivo = agarre ? agarre.d : null;
      let energia = 0;
      for (let paso = 0; paso < 2; paso++) {
        const h = dt / 2;
        for (let i = 0; i < nv; i++) {
          for (let e = 0; e < 3; e++) {
            const j = i * 3 + e, meta = objetivo ? objetivo[e] * peso[i] : 0;
            vel[j] += (k * (meta - desp[j]) - c * vel[j]) * h;
            desp[j] += vel[j] * h;
          }
        }
      }
      for (let j = 0; j < nv * 3; j++) { pos[j] = base[j] + desp[j]; energia += Math.abs(desp[j]) + Math.abs(vel[j]); }
      nor.fill(0);
      for (let t = 0; t < ind.length; t += 3) {
        const a = ind[t] * 3, b = ind[t + 1] * 3, cc = ind[t + 2] * 3;
        const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
        const e2 = [pos[cc] - pos[a], pos[cc + 1] - pos[a + 1], pos[cc + 2] - pos[a + 2]];
        const n = cross(e1, e2);
        for (const v of [a, b, cc]) { nor[v] += n[0]; nor[v + 1] += n[1]; nor[v + 2] += n[2]; }
      }
      for (let i = 0; i < nv; i++) {
        const j = i * 3, l = Math.hypot(nor[j], nor[j + 1], nor[j + 2]);
        if (l > 1e-9) { nor[j] /= l; nor[j + 1] /= l; nor[j + 2] /= l; } else { nor[j] = base[j]; nor[j + 1] = base[j + 1]; nor[j + 2] = base[j + 2]; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, bNor); gl.bufferSubData(gl.ARRAY_BUFFER, 0, nor);
      activa = agarre !== null || energia > nv * 1e-4;
      if (!activa) {                                       // en reposo: malla exacta y sin calculos
        desp.fill(0); vel.fill(0); pos.set(base); nor.set(base);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
        gl.bindBuffer(gl.ARRAY_BUFFER, bNor); gl.bufferSubData(gl.ARRAY_BUFFER, 0, nor);
      }
    }

    canvas.addEventListener("pointerdown", (ev) => {
      const d = rayo(ev), h = golpe(d);
      if (!h) return;
      ev.preventDefault();
      canvas.setPointerCapture(ev.pointerId);
      const p0 = desrotar(rot, sub(h, centro));
      pesos(p0, 0.55);
      agarre = {id: ev.pointerId, h, p0, d: [0, 0, 0], t0: performance.now(), movido: 0, x: ev.clientX, y: ev.clientY};
      activa = true;
      secuencia = [];
      api.emocion("sorpresa", 60000);
      if (api.alAgarrar) api.alAgarrar();                  // humor.js puede poner otra cara (enojado si ya esta harto)
      canvas.classList.add("agarrando");
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!agarre || ev.pointerId !== agarre.id) return;
      const d = rayo(ev), den = dot(d, F);
      if (Math.abs(den) < 1e-4) return;
      const q = add(OJO, mul(d, dot(sub(agarre.h, OJO), F) / den));
      let w = sub(q, agarre.h);
      const l = Math.hypot(w[0], w[1], w[2]);
      if (l > 1.5) w = mul(w, 1.5 / l);
      agarre.d = desrotar(rot, w);
      agarre.movido = Math.max(agarre.movido, Math.hypot(ev.clientX - agarre.x, ev.clientY - agarre.y));
    });
    const soltar = (ev) => {
      if (!agarre || ev.pointerId !== agarre.id) return;
      const dura = performance.now() - agarre.t0, toque = agarre.movido < 6 && dura < 300;
      if (toque) {                                         // un toque: rebote hacia dentro
        for (let i = 0; i < nv; i++) for (let e = 0; e < 3; e++) vel[i * 3 + e] -= agarre.p0[e] * 3.2 * peso[i];
      }
      const info = {movido: agarre.movido, ms: dura};
      agarre = null;
      canvas.classList.remove("agarrando");
      api.emocion(toque ? "guino" : "feliz", toque ? 1100 : 1400);
      if (api.alSoltar) api.alSoltar(toque, info);
    };
    canvas.addEventListener("pointerup", soltar);
    canvas.addEventListener("pointercancel", soltar);

    let movidoEn = -10;
    window.addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "touch") return;
      const r = canvas.getBoundingClientRect();
      mirada.x = clamp((ev.clientX - (r.left + r.width / 2)) / Math.max(r.width * 0.6, 300), -1, 1);
      mirada.y = clamp(-(ev.clientY - (r.top + r.height * 0.45)) / Math.max(r.height * 0.9, 300), -1, 1);
      movidoEn = tiempo;
    }, {passive: true});

    // ------------------------------------------------------------ tamano y visibilidad
    function medir() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      aspecto = w / h;
      proy = perspectiva(FOV, aspecto, 0.1, 50);
    }
    if (window.ResizeObserver) new ResizeObserver(medir).observe(canvas);
    if (window.IntersectionObserver) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(canvas);
    medir();

    // ------------------------------------------------------------ bucle
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    function atributo(prog, nombre, b, n) {
      const a = prog.a(nombre);
      if (a < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, n, gl.FLOAT, false, 0, 0);
    }

    // ------------------------------------------------------------ el fondo cuando hay musica
    // Una capa detras de Pixel (dentro de .escena): el escenario del genero (escenarios.js: playa,
    // escenario de rock, laseres...), figuras musicales que suben en cada golpe y un
    // destello del color del genero. Sin animaciones si el sistema pide movimiento reducido.
    const fondo = document.createElement("div");
    fondo.className = "fondo-musica";
    fondo.setAttribute("aria-hidden", "true");
    fondo.innerHTML = '<div class="escenario"></div><div class="luces"></div>';
    (canvas.parentElement || document.body).insertBefore(fondo, canvas);
    const escenario = fondo.querySelector(".escenario"), luces = fondo.querySelector(".luces");
    // el golpe del compas va a CSS (--golpe, de 0 a 1): con el laten las luces del escenario
    let golpeCss = -1, soloSombra = 0;
    function marcarGolpe(g) {
      const v = Math.round(g * 20) / 20;
      if (v !== golpeCss) { golpeCss = v; fondo.style.setProperty("--golpe", v); }
    }
    function ponerEscenario(estilo) {
      if (typeof Escenarios === "undefined") return;
      const es = Escenarios.de(estilo);
      if (fondo.dataset.escena !== es.nombre) { escenario.innerHTML = es.svg; fondo.dataset.escena = es.nombre; }
    }
    let tonoNeon = 0;
    function soltarFigura(e) {
      const tono = e.tonos[Math.floor(Math.random() * e.tonos.length)];
      tonoNeon = (tonoNeon + 1) % e.tonos.length;
      luces.style.setProperty("--tono", tono);
      luces.classList.add("golpe");
      setTimeout(() => luces.classList.remove("golpe"), 70);
      if (quieto || fondo.childElementCount > 18) return;
      const simbolos = [...e.figuras], f = document.createElement("span");
      f.className = "figura";
      f.textContent = simbolos[Math.floor(Math.random() * simbolos.length)];
      f.style.left = (12 + Math.random() * 76) + "%";
      f.style.color = tono;
      f.style.fontSize = Math.round(18 + Math.random() * 20) + "px";
      f.style.setProperty("--dx", Math.round(Math.random() * 90 - 45) + "px");
      f.style.setProperty("--giro", Math.round(Math.random() * 70 - 35) + "deg");
      f.style.animationDuration = (2.1 + Math.random() * 1.3).toFixed(2) + "s";
      f.addEventListener("animationend", () => f.remove());
      fondo.appendChild(f);
    }
    // el color de los LED: amarillo, salvo la electronica (neon que cambia en cada golpe)
    const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    function tinteLed() {
      const e = baile && ESTILOS[baile.estilo];
      if (!e || e.led !== "neon") return [0, 0, 0, 0];
      return hexRgb(e.tonos[tonoNeon % e.tonos.length]).concat([0.85]);
    }

    // El paso de baile de ahora: movimientos de la cabeza y su aplastado, al tempo de la cancion.
    // Cada 8 tiempos cambia de paso: rebote con vaiven, asentir mirando a los lados, y un giro completo.
    let escala = [1, 1, 1];
    function pasoDeBaile(animo) {
      const nada = {x: 0, y: 0, yaw: 0, pitch: 0, roll: 0, esc: [1, 1, 1]};
      golpeBaile = 0;
      if (!baile || agarre || quieto) { if (golpeCss) marcarGolpe(0); return nada; }
      const seg = baile.reloj ? baile.reloj() : tiempo - baile.t0;
      if (seg === null || !isFinite(seg)) return nada;
      const fase = Math.max(0, seg) * baile.bpm / 60, f = fase - Math.floor(fase), n = Math.floor(fase);
      const golpe = Math.pow(1 - f, 3);                    // fuerte en el golpe, se apaga hasta el siguiente
      golpeBaile = golpe;
      marcarGolpe(golpe);
      if (n !== baile.ultimo) { baile.ultimo = n; for (const o of OJOS) o.vesc[1] += 2.2; }   // los ojos saltan en cada golpe
      const e = ESTILOS[baile.estilo];
      baile.fase = fase;
      if (n !== baile.figura && n % (e.cada || 1) === 0) { baile.figura = n; soltarFigura(e); }
      const suave = (animo === "hablando" || animo === "pensando" ? 0.4 : 1) * e.fuerza;   // hablando o pensando, baila menos
      const nombre = e.pasos[Math.floor(fase / 8) % e.pasos.length], enPaso = (fase % 8) / 8;
      const m = Object.assign({x: 0, y: 0, yaw: 0, pitch: 0, roll: 0, escala: 0}, PASOS[nombre](fase, golpe, enPaso));
      if (m.gira && suave < 0.9) m.yaw = 0;                // hablando, sin dar vueltas
      const aplasta = 0.06 * golpe * suave + m.escala;
      return {x: m.x * suave, y: m.y * suave, yaw: m.gira ? m.yaw : m.yaw * suave, pitch: m.pitch * suave, roll: m.roll * suave,
        esc: [1 + aplasta * 0.8, 1 - aplasta, 1 + aplasta * 0.8]};
    }

    function cuadro(ahora) {
      requestAnimationFrame(cuadro);
      // el primer cuadro puede traer una hora anterior a la de montar: dt negativo hace explotar los muelles
      const dt = clamp((ahora - ultimo) / 1000, 0, 1 / 30);
      ultimo = ahora;
      if (!visible || document.hidden) return;
      tiempo += dt;
      const animo = animoActual();
      if (animo !== animoAntes) { empujon(animo); animoAntes = animo; }

      // mirada: el raton, o vistazos al azar si no se mueve (moviles); algunos gestos miran a un sitio
      if (animo === "pensando") { mirada.x = 0.55; mirada.y = 0.65; mirada.t = tiempo + 0.5; }
      else if (animo === "aburrido") { mirada.x = 0.2; mirada.y = -0.7; mirada.t = tiempo + 0.5; }
      else if (animo === "escribiendo") { mirada.x = 0.45 * Math.sin(tiempo * 1.3); mirada.y = -0.55; mirada.t = tiempo + 0.5; }   // como leyendo renglones
      else if (animo === "curioso" && secuencia.length) { mirada.x = Math.sin(tiempo * 3.8) * 0.95; mirada.y = 0.1; mirada.t = tiempo + 0.6; }
      else if (animo === "mareado") { mirada.x = Math.cos(tiempo * 6) * 0.6; mirada.y = Math.sin(tiempo * 6) * 0.5; mirada.t = tiempo + 0.6; }
      else if (tiempo - movidoEn > 3.5 && tiempo > mirada.t) {
        const vivo = animo === "escuchando" || animo === "hablando" ? 0.35 : 0.7;   // atento: mira mas al frente
        mirada.x = (Math.random() * 2 - 1) * vivo; mirada.y = (Math.random() * 2 - 1) * 0.4 * vivo;
        mirada.t = tiempo + 1.4 + Math.random() * 2.2;
      }
      const suave = 1 - Math.exp(-dt * 7);
      mirada.ox += (mirada.x - mirada.ox) * suave; mirada.oy += (mirada.y - mirada.oy) * suave;
      const cabeza = CABEZA[animo] || {};
      if (!agarre) {
        giro.yaw += (mirada.ox * 0.42 - giro.yaw) * (1 - Math.exp(-dt * 3.5));
        giro.pitch += (-mirada.oy * 0.28 + (cabeza.cabeceo || 0) - giro.pitch) * (1 - Math.exp(-dt * 3.5));
      }
      const vaiven = cabeza.vaiven ? cabeza.vaiven[0] * Math.sin(tiempo * cabeza.vaiven[1] * Math.PI * 2) : 0;
      giro.roll += ((cabeza.ladeo || 0) + vaiven - giro.roll) * (1 - Math.exp(-dt * 6));

      // la voz (sin boca, la llevan los ojos): la real si llega, si no, un latido inventado
      const conVoz = vozReal !== null && tiempo < vozReal.hasta;
      const objetivoVoz = conVoz ? vozReal.nivel : animo === "hablando" ? 0.35 + 0.35 * Math.abs(Math.sin(tiempo * 9.3) * Math.sin(tiempo * 4.1)) : 0;
      voz += (clamp(objetivoVoz, 0, 1) - voz) * (1 - Math.exp(-dt * 18));

      const mece = quieto ? 0 : 1;
      const dormido = animo === "dormido";
      salto = Math.max(0, salto - dt * 2.2);
      const brinco = mece * Math.sin((1 - salto) * Math.PI * 2) * salto * 0.12;
      const b = pasoDeBaile(animo);
      centro = [b.x, mece * (0.06 * Math.sin(tiempo * 1.6) + voz * 0.03 * Math.sin(tiempo * 11)) - (dormido ? 0.04 : 0) + Math.abs(brinco) + b.y, 0];
      rot = rotacion(giro.yaw + b.yaw, giro.pitch + (dormido ? 0.12 : 0) + b.pitch, giro.roll + mece * 0.045 * Math.sin(tiempo * 0.9) + b.roll);
      escala = b.esc;

      // parpadeo (a veces doble); no en los gestos con otra forma, cerrados o sonriendo
      if (tiempo > parpadeo.siguiente && parpadeo.inicio < 0 && !SIN_PARPADEO.has(animo)) {
        parpadeo.inicio = tiempo;
        parpadeo.doble = Math.random() < 0.2;
        parpadeo.siguiente = tiempo + 2.2 + Math.random() * 3.5;
      }
      let apertura = 1;
      if (parpadeo.inicio >= 0) {
        const dura = parpadeo.doble ? 0.42 : 0.17, p = (tiempo - parpadeo.inicio) / dura;
        if (p >= 1) parpadeo.inicio = -1;
        else apertura = parpadeo.doble ? Math.abs(Math.cos(p * Math.PI * 2)) : Math.abs(p * 2 - 1);
      }
      if (SIN_PARPADEO.has(animo)) apertura = 1;
      rubor += ((animo === "feliz" || animo === "guino" || animo === "amor" || animo === "risa" ? 1 : 0) - rubor) * (1 - Math.exp(-dt * 4));
      moverOjos(dt, animo);
      if (activa) fisica(dt);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(ps.p);
      gl.uniformMatrix4fv(ps.u.uProj, false, proy); gl.uniformMatrix4fv(ps.u.uView, false, vista);
      gl.uniform3fv(ps.u.uCentro, centro);
      soloSombra += ((fondo.classList.contains("con-musica") && fondo.dataset.escena ? 1 : 0) - soloSombra) * (1 - Math.exp(-dt * 2.5));
      gl.uniform1f(ps.u.uSoloSombra, soloSombra);
      atributo(ps, "aPos", bSuelo, 3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(pc.p);
      gl.uniformMatrix4fv(pc.u.uProj, false, proy); gl.uniformMatrix4fv(pc.u.uView, false, vista);
      gl.uniformMatrix3fv(pc.u.uRot, false, new Float32Array([...rot[0], ...rot[1], ...rot[2]]));
      gl.uniform3fv(pc.u.uCentro, centro); gl.uniform3fv(pc.u.uOjo, OJO); gl.uniform3fv(pc.u.uEscala, escala);
      gl.uniform1f(pc.u.uRadio, RADIO); gl.uniform1f(pc.u.uT, tiempo);
      OJOS.forEach((o, i) => {
        const n = i + 1;
        gl.uniform4f(pc.u["uC" + n], o.lon + mirada.ox * 4.5, o.lat + mirada.oy * 3.5, o.esc[0], o.esc[1]);
        gl.uniform4f(pc.u["uA" + n], o.g.arriba, o.g.incl, o.g.curvaA, apertura);
        gl.uniform4f(pc.u["uB" + n], o.g.abajo, o.g.curvaB, o.luz, o.g.forma);
      });
      gl.uniform3fv(pc.u.uMejA, add(rotar(rot, MEJILLAS[0]), centro)); gl.uniform3fv(pc.u.uMejB, add(rotar(rot, MEJILLAS[1]), centro));
      gl.uniform1f(pc.u.uRubor, rubor);
      gl.uniform4fv(pc.u.uTinte, tinteLed());
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tCabeza); gl.uniform1i(pc.u.uTex, 0);
      atributo(pc, "aPos", bPos, 3); atributo(pc, "aNor", bNor, 3); atributo(pc, "aUV", bUV, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bInd);
      gl.drawElements(gl.TRIANGLES, ind.length, gl.UNSIGNED_SHORT, 0);
    }

    const api = {
      estado(nombre) { estado = nombre; },
      emocion(nombre, ms) { emocion = nombre; emocionHasta = tiempo + (ms === undefined ? 1500 : ms) / 1000; },
      evento(nombre) {
        const pasos = EVENTOS[nombre];
        if (!pasos || agarre) return false;
        let t = tiempo;
        secuencia = pasos.map(([gesto, ms]) => ({gesto, hasta: (t += ms / 1000)}));
        return true;
      },
      ocupada: () => !!agarre || secuencia.length > 0,
      bailar(bpm, reloj, genero) {
        bpm = Number(bpm) || 0;
        if (!bpm) { baile = null; fondo.classList.remove("con-musica"); return; }
        while (bpm > 150) bpm /= 2;                        // a doble tiempo se ve frenetico: a la mitad
        while (bpm < 60) bpm *= 2;
        const estilo = estiloDe(genero);
        if (baile && Math.abs(baile.bpm - bpm) < 0.5 && baile.reloj === (reloj || null) && baile.estilo === estilo) return;
        baile = {bpm, reloj: reloj || null, t0: tiempo, ultimo: -1, figura: -1, fase: 0, estilo};
        fondo.dataset.estilo = estilo;
        ponerEscenario(estilo);
        fondo.classList.add("con-musica");
      },
      bailando: () => !!baile,
      boca(nivel) { vozReal = nivel === null || nivel === undefined ? null : {nivel, hasta: tiempo + 0.15}; },
      alAgarrar: null,
      alSoltar: null,
      // para las pruebas: como estan los ojos ahora
      depurar: () => ({animo: animoActual(), tiempo, baile: baile ? {bpm: baile.bpm, estilo: baile.estilo} : null, golpe: golpeBaile,
        figuras: fondo.querySelectorAll(".figura").length, escena: fondo.classList.contains("con-musica") ? fondo.dataset.escena || null : null, giro: Object.assign({}, giro), ojos: OJOS.map((o) => ({luz: o.luz, esc: o.esc.slice(), g: Object.assign({}, o.g)}))}),
    };
    requestAnimationFrame(cuadro);
    return api;
  }

  return {montar, estiloDe, GESTOS: Object.keys(GESTOS), EVENTOS: Object.keys(EVENTOS), ESTILOS: Object.keys(ESTILOS)};
})();
