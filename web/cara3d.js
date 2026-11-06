/* Fase 9 - Cara 3D de Pixel: una esfera con ojos y boca de LED, en WebGL sin librerias.
   Se estira al arrastrarla y vuelve rebotando, como la cara de Mario 64. Los ojos y la
   boca se pintan en una textura (canvas 2D), asi se deforman con la cara. La usa app.js:
   CaraPixel.montar(canvas) devuelve {estado(nombre), emocion(nombre, ms), boca(nivel)}, o null sin WebGL.
   boca(nivel) mueve la boca con el volumen de la voz real (0..1; null = sin voz). */
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

  // ---------------------------------------------------------------- dibujos de LED (5x7 los ojos, 9x3 la boca)
  const OJOS = {
    normal: [".###.", "#####", "#####", "#####", "#####", "#####", ".###."],
    feliz: [".....", "..#..", ".###.", "##.##", "#...#", ".....", "....."],
    sorpresa: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    dormido: [".....", ".....", ".....", ".....", "#####", ".....", "....."],
    error: [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
  };
  const BOCAS = {
    normal: ["#.......#", ".#.....#.", "..#####.."],
    feliz: ["##.....##", ".#######.", "..#####.."],
    sorpresa: ["...###...", "..#...#..", "...###..."],
    dormido: [".........", "...###...", "........."],
    error: [".........", ".#.#.#.#.", "#.#.#.#.#"],
    habla: [                     // de cerrada a muy abierta
      [".........", "..#####..", "........."],
      ["...###...", "..#...#..", "...###..."],
      ["...###...", ".#######.", "...###..."],
      ["..#####..", ".#.....#.", "..#####.."],
    ],
  };

  // textura equirectangular: u = longitud (-180..180), v = latitud (90..-90); el frente es el centro
  const TW = 2048, TH = 1024, GRADO = TW / 360;
  const RX = 768, RY = 304, RW = 512, RH = 448;                  // zona de la cara que se repinta

  function lienzo(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function rectRedondo(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const zona = (lon, lat) => [TW / 2 + lon * GRADO - RX, TH / 2 - lat * (TH / 180) - RY];

  function color(fila, filas) {      // de azul arriba a verde abajo
    const t = filas > 1 ? fila / (filas - 1) : 0.5;
    const a = [77, 171, 247], b = [32, 201, 151];
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
  }

  // ---------------------------------------------------------------- shaders
  const VS_CARA = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUV;
    uniform mat4 uProj, uView; uniform mat3 uRot; uniform vec3 uCentro;
    varying vec3 vN; varying vec3 vP; varying vec2 vUV;
    void main() {
      vec3 p = uRot * aPos + uCentro;
      vP = p; vN = uRot * aNor; vUV = aUV;
      gl_Position = uProj * uView * vec4(p, 1.0);
    }`;
  const FS_CARA = `
    precision mediump float;
    uniform sampler2D uTex, uBrillo; uniform vec3 uOjo;
    varying vec3 vN; varying vec3 vP; varying vec2 vUV;
    void main() {
      vec3 n = normalize(vN), v = normalize(uOjo - vP);
      vec3 l = normalize(vec3(-0.45, 0.75, 0.6)), l2 = normalize(vec3(0.85, 0.05, 0.35));
      vec3 alb = texture2D(uTex, vUV).rgb, brillo = texture2D(uBrillo, vUV).rgb;
      vec3 cielo = mix(vec3(0.86, 0.96, 0.92), vec3(0.93, 0.97, 1.0), n.y * 0.5 + 0.5);
      vec3 luz = cielo * 0.72 + vec3(1.0, 0.99, 0.96) * max(dot(n, l), 0.0) * 0.45
               + vec3(0.75, 0.88, 1.0) * max(dot(n, l2), 0.0) * 0.16
               + vec3(0.85, 0.97, 0.92) * max(-n.y, 0.0) * 0.25;          // rebote del suelo
      float esp = pow(max(dot(n, normalize(l + v)), 0.0), 70.0) * 0.5;
      float borde = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 c = alb * luz + esp + borde * vec3(0.30, 0.82, 0.70) * 0.28 + brillo * 1.15;
      gl_FragColor = vec4(c, 1.0);
    }`;
  const VS_SUELO = `
    attribute vec3 aPos; uniform mat4 uProj, uView; varying vec3 vP;
    void main() { vP = aPos; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
  const FS_SUELO = `
    precision mediump float;
    uniform vec3 uCentro; varying vec3 vP;
    void main() {
      vec2 celda = floor(vP.xz * 0.95);
      float cuadro = mod(celda.x + celda.y, 2.0);
      vec3 c = mix(vec3(1.0), vec3(0.80, 0.94, 0.89), cuadro);
      float d = length(vP.xz - uCentro.xz), alto = max(uCentro.y - vP.y, 0.5);
      c *= 1.0 - 0.22 * smoothstep(0.95, 0.0, d) * clamp(1.6 / alto, 0.4, 1.0);
      float a = 1.0 - smoothstep(2.5, 7.0, length(vP.xz - vec2(0.0, 1.0)));
      gl_FragColor = vec4(c * a, a);
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

    // esfera: posiciones base, normales, uv e indices
    const LAT = 40, LON = 64, R = 1;
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

    const pc = programa(gl, VS_CARA, FS_CARA), ps = programa(gl, VS_SUELO, FS_SUELO);
    const buf = (datos, tipo, uso) => { const b = gl.createBuffer(); gl.bindBuffer(tipo, b); gl.bufferData(tipo, datos, uso); return b; };
    const bPos = buf(pos, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW), bNor = buf(nor, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    const bUV = buf(uv, gl.ARRAY_BUFFER, gl.STATIC_DRAW), bInd = buf(ind, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
    const Y_SUELO = -1.45;
    const bSuelo = buf(new Float32Array([-14, Y_SUELO, -12, 14, Y_SUELO, -12, -14, Y_SUELO, 8, 14, Y_SUELO, 8]), gl.ARRAY_BUFFER, gl.STATIC_DRAW);

    // texturas: color (la luz le afecta) y brillo (LED que se suman tal cual)
    const fondo = lienzo(TW, TH), fondoBrillo = lienzo(TW, TH);
    {
      const c = fondo.getContext("2d");
      c.fillStyle = "#f4f9ff"; c.fillRect(0, 0, TW, TH);
      for (const lon of [-34, 34]) {                    // mejillas
        const [x, y] = zona(lon, -10);
        const g = c.createRadialGradient(x + RX, y + RY, 0, x + RX, y + RY, 46);
        g.addColorStop(0, "rgba(120, 225, 200, 0.28)"); g.addColorStop(1, "rgba(120, 225, 200, 0)");
        c.fillStyle = g; c.fillRect(x + RX - 50, y + RY - 50, 100, 100);
      }
      const b = fondoBrillo.getContext("2d");
      b.fillStyle = "#000"; b.fillRect(0, 0, TW, TH);
    }
    const zonaColor = lienzo(RW, RH), zonaBrillo = lienzo(RW, RH);
    const textura = (lz) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lz);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tColor = textura(fondo), tBrillo = textura(fondoBrillo);

    // ------------------------------------------------------------ estado de la animacion
    let estado = "esperando", emocion = "", emocionHasta = 0, vozReal = null;   // vozReal: {nivel, hasta}
    const mirada = {x: 0, y: 0, ox: 0, oy: 0, t: 0}, giro = {yaw: 0, pitch: 0};
    let parpadeo = {siguiente: 2, inicio: -1}, boca = {frame: 0, siguiente: 0};
    let clave = "", tiempo = 0, ultimo = performance.now(), visible = true, activa = false;
    let agarre = null, rot = rotacion(0, 0, 0), centro = [0, 0, 0];

    const OJO = [0, 0.55, 4.6], MIRA = [0, -0.05, 0];
    const F = norm(sub(MIRA, OJO)), DER = norm(cross(F, [0, 1, 0])), ARR = cross(DER, F);
    const FOV = (34 * Math.PI) / 180;
    const vista = mirar(OJO, MIRA, [0, 1, 0]);
    let proy = perspectiva(FOV, 1, 0.1, 50), aspecto = 1;

    function pintarCara() {
      const ahora = tiempo;
      const emo = ahora < emocionHasta ? emocion : "";
      const animo = emo || {esperando: "dormido", "sin-servidor": "error"}[estado] || "normal";
      let cierre = 0;                                     // parpadeo: 0 abierto, 1 cerrado
      if (parpadeo.inicio >= 0) {
        const p = (ahora - parpadeo.inicio) / 0.18;
        cierre = p >= 1 ? 0 : 1 - Math.abs(p * 2 - 1);
        if (p >= 1) parpadeo.inicio = -1;
      }
      const filasAbiertas = Math.round((1 - cierre) * 3.5);
      const pupila = animo === "normal" ? [clamp(Math.round(1.5 + mirada.ox * 1.6), 0, 3), clamp(Math.round(2.5 - mirada.oy * 2.2), 0, 5)] : null;
      const conVoz = vozReal !== null && tiempo < vozReal.hasta;
      const hablando = (estado === "hablando" || conVoz) && !emo;
      const patronBoca = hablando ? BOCAS.habla[boca.frame] : BOCAS[animo] || BOCAS.normal;
      const k = [animo, filasAbiertas, pupila, boca.frame * hablando].join("|");
      if (k === clave) return;
      clave = k;

      const c = zonaColor.getContext("2d"), b = zonaBrillo.getContext("2d");
      c.drawImage(fondo, RX, RY, RW, RH, 0, 0, RW, RH);
      b.drawImage(fondoBrillo, RX, RY, RW, RH, 0, 0, RW, RH);
      const patron = OJOS[animo] || OJOS.normal, CELDA = 15.5, LED = 12;
      for (const lon of [-18, 18]) {
        const [cx, cy] = zona(lon, 11);
        const w = 5 * CELDA + 14, h = 7 * CELDA + 14;
        c.fillStyle = "#13305a"; rectRedondo(c, cx - w / 2, cy - h / 2, w, h, 22); c.fill();
        for (let f = 0; f < 7; f++) {
          for (let col = 0; col < 5; col++) {
            const x = cx - (5 * CELDA) / 2 + col * CELDA + (CELDA - LED) / 2, y = cy - (7 * CELDA) / 2 + f * CELDA + (CELDA - LED) / 2;
            const encendido = patron[f][col] === "#" && (animo !== "normal" || Math.abs(f - 3) <= filasAbiertas);
            const linea = animo === "normal" && filasAbiertas === 0 && f === 3;
            if (encendido || linea) {
              const brillante = pupila && col >= pupila[0] && col <= pupila[0] + 1 && f >= pupila[1] && f <= pupila[1] + 1;
              const tono = brillante ? "#effffa" : color(f, 7);
              c.fillStyle = tono; c.globalAlpha = 0.35; rectRedondo(c, x, y, LED, LED, 3); c.fill(); c.globalAlpha = 1;
              b.shadowColor = tono; b.shadowBlur = 9; b.fillStyle = tono;
              rectRedondo(b, x, y, LED, LED, 3); b.fill();
            } else {
              c.fillStyle = "#0d2447"; rectRedondo(c, x, y, LED, LED, 3); c.fill();
            }
          }
        }
      }
      const [bx, by] = zona(0, -13), CB = 13, LB = 10;
      for (let f = 0; f < 3; f++) {
        for (let col = 0; col < 9; col++) {
          if (patronBoca[f][col] !== "#") continue;
          const x = bx - (9 * CB) / 2 + col * CB + (CB - LB) / 2, y = by - (3 * CB) / 2 + f * CB + (CB - LB) / 2;
          c.fillStyle = "#1c3a66"; rectRedondo(c, x, y, LB, LB, 2.5); c.fill();
          if (hablando) {
            const tono = color(f + 1, 4);
            b.shadowColor = tono; b.shadowBlur = 8; b.fillStyle = tono;
            rectRedondo(b, x, y, LB, LB, 2.5); b.fill();
          }
        }
      }
      b.shadowBlur = 0;
      for (const [t, lz] of [[tColor, zonaColor], [tBrillo, zonaBrillo]]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, RX, RY, gl.RGBA, gl.UNSIGNED_BYTE, lz);
      }
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
      // normales de la malla deformada
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
      api.emocion("sorpresa", 60000);
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
      const toque = agarre.movido < 6 && performance.now() - agarre.t0 < 300;
      if (toque) {                                         // un toque: rebote hacia dentro
        for (let i = 0; i < nv; i++) for (let e = 0; e < 3; e++) vel[i * 3 + e] -= agarre.p0[e] * 3.2 * peso[i];
      }
      agarre = null;
      canvas.classList.remove("agarrando");
      api.emocion("feliz", 1400);
      if (api.alSoltar) api.alSoltar(toque);
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

    function cuadro(ahora) {
      requestAnimationFrame(cuadro);
      const dt = Math.min((ahora - ultimo) / 1000, 1 / 30);
      ultimo = ahora;
      if (!visible || document.hidden) return;
      tiempo += dt;

      // mirada: el raton, o vistazos al azar si no se mueve (moviles)
      if (tiempo - movidoEn > 3.5 && tiempo > mirada.t) {
        mirada.x = (Math.random() * 2 - 1) * 0.7; mirada.y = (Math.random() * 2 - 1) * 0.4;
        mirada.t = tiempo + 1.4 + Math.random() * 2.2;
      }
      const suave = 1 - Math.exp(-dt * 7);
      mirada.ox += (mirada.x - mirada.ox) * suave; mirada.oy += (mirada.y - mirada.oy) * suave;
      if (!agarre) {
        giro.yaw += (mirada.ox * 0.42 - giro.yaw) * (1 - Math.exp(-dt * 3.5));
        giro.pitch += (-mirada.oy * 0.28 - giro.pitch) * (1 - Math.exp(-dt * 3.5));
      }
      const conVoz = vozReal !== null && tiempo < vozReal.hasta;
      const mece = quieto ? 0 : 1, habla = estado === "hablando" || conVoz ? 1 : 0;
      const dormido = estado === "esperando" || estado === "sin-servidor";
      centro = [0, mece * (0.06 * Math.sin(tiempo * 1.6) + habla * 0.025 * Math.sin(tiempo * 11)) - (dormido ? 0.04 : 0), 0];
      rot = rotacion(giro.yaw, giro.pitch + (dormido ? 0.12 : 0), mece * 0.045 * Math.sin(tiempo * 0.9));

      if (tiempo > parpadeo.siguiente && parpadeo.inicio < 0) {
        parpadeo.inicio = tiempo;
        parpadeo.siguiente = tiempo + 2.2 + Math.random() * 3.5;
      }
      if (conVoz) {                                       // la boca sigue el volumen de la voz real
        const n = vozReal.nivel;
        boca.frame = n < 0.06 ? 0 : n < 0.25 ? 1 : n < 0.5 ? 2 : 3;
      } else if (habla && tiempo > boca.siguiente) {
        boca.frame = (boca.frame + 1 + Math.floor(Math.random() * 3)) % BOCAS.habla.length;
        boca.siguiente = tiempo + 0.08 + Math.random() * 0.09;
      }
      pintarCara();
      if (activa) fisica(dt);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(ps.p);
      gl.uniformMatrix4fv(ps.u.uProj, false, proy); gl.uniformMatrix4fv(ps.u.uView, false, vista);
      gl.uniform3fv(ps.u.uCentro, centro);
      atributo(ps, "aPos", bSuelo, 3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(pc.p);
      gl.uniformMatrix4fv(pc.u.uProj, false, proy); gl.uniformMatrix4fv(pc.u.uView, false, vista);
      gl.uniformMatrix3fv(pc.u.uRot, false, new Float32Array([...rot[0], ...rot[1], ...rot[2]]));
      gl.uniform3fv(pc.u.uCentro, centro); gl.uniform3fv(pc.u.uOjo, OJO);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tColor); gl.uniform1i(pc.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tBrillo); gl.uniform1i(pc.u.uBrillo, 1);
      atributo(pc, "aPos", bPos, 3); atributo(pc, "aNor", bNor, 3); atributo(pc, "aUV", bUV, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bInd);
      gl.drawElements(gl.TRIANGLES, ind.length, gl.UNSIGNED_SHORT, 0);
    }

    const api = {
      estado(nombre) { estado = nombre; },
      emocion(nombre, ms) { emocion = nombre; emocionHasta = tiempo + (ms || 1500) / 1000; },
      boca(nivel) { vozReal = nivel === null || nivel === undefined ? null : {nivel, hasta: tiempo + 0.15}; },
      alSoltar: null,
    };
    requestAnimationFrame(cuadro);
    return api;
  }

  return {montar};
})();
