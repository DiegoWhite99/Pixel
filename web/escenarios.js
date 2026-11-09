// Fase 13 - Los fondos de Pixel cuando suena musica, segun el genero (pedido del usuario el 9 nov):
//   salsa y cumbia: una playa del Caribe de dia, con palmeras y una garita del Morro (Puerto Rico);
//   regueton: la misma playa al atardecer;
//   rock y metal: un escenario negro con luces tenues que barren (ambar en rock, rojas en metal);
//   electronica: laseres, bola de espejos, focos de colores y un suelo de rejilla que avanza;
//   balada: noche con luna y estrellas; rap: la ciudad de noche; clasica y jazz: un teatro con telon;
//   pop: una guirnalda de bombillos y confeti.
// Son SVG hechos aqui, sin imagenes ni nada de internet (el panel local tambien los usa). cara3d.js los
// pone en su capa .fondo-musica y le pasa el golpe del compas en la variable CSS --golpe (0 a 1):
// con eso laten las luces, los laseres y los bombillos (las reglas estan en estilos.css, "Escenarios").
// Se dibujan en 400x300 con "slice": lo importante va entre y=30 y y=270 (en pantallas anchas se recorta
// arriba y abajo) y entre x=25 y x=375 (en el celular, a los lados). Pixel tapa el centro.
"use strict";
const Escenarios = (function () {
  // genero (los de ESTILOS en cara3d.js) -> escena
  const ESCENA = {salsa: "playa", cumbia: "playa", reggaeton: "atardecer", rock: "escenario", metal: "metal",
    electronica: "laser", balada: "noche", rap: "ciudad", clasica: "teatro", jazz: "jazz", pop: "fiesta"};

  // azar con semilla: la misma escena sale siempre igual (estrellas, edificios, confeti)
  let semilla = 1;
  const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  const r1 = (n) => Math.round(n * 10) / 10;
  const svg = (defs, cuerpo) => `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${cuerpo}</svg>`;
  const vertical = (id, paradas) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${paradas.map(([o, c, a]) =>
    `<stop offset="${o}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`).join("")}</linearGradient>`;
  const brillo = (id, color) => `<radialGradient id="${id}"><stop offset="0" stop-color="${color}"/><stop offset="0.4" stop-color="${color}" stop-opacity="0.55"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;

  // ------------------------------------------------------------------ playa del Caribe
  // olas: una linea ondulada de periodo 20 que se desplaza 20 (estilos.css) y parece que no acaba
  function olas(y, color, opacidad, lenta) {
    let d = `M-40 ${y}`;
    for (let x = -40; x < 440; x += 20) d += " q5 -2.6 10 0 t10 0";
    return `<path class="es-olas${lenta ? " lenta" : ""}" d="${d}" fill="none" stroke="${color}" stroke-opacity="${opacidad}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  // palmera que se mece desde la base; las hojas son medias lunas que caen hacia los lados
  function palma(x, base, alto, inclina, c, retraso) {
    const tx = x + inclina, ty = base - alto;
    const tronco = `M${x} ${base} Q${x + inclina * 0.15} ${base - alto * 0.55} ${tx} ${ty}`;
    const hoja = (a, lado, i) => `<path d="M0 0 q26 -16 54 7 q-26 -7 -54 -7z" fill="${c.hojas[i % 2]}" transform="translate(${tx} ${ty}) scale(${lado} 1) rotate(${a})"/>`;
    const hojas = [-58, -28, 2, 30].map((a, i) => hoja(a, 1, i) + hoja(a + 6, -1, i + 1)).join("");
    return `<g class="es-palma" style="transform-origin:${x}px ${base}px;animation-delay:-${retraso}s">` +
      `<path d="${tronco}" stroke="${c.tronco}" stroke-width="6.5" fill="none" stroke-linecap="round"/>` +
      `<path d="${tronco}" stroke="${c.anillos}" stroke-width="6.5" fill="none" stroke-dasharray="1.6 5"/>` +
      hojas + `<circle cx="${tx - 3}" cy="${ty + 4}" r="3.2" fill="${c.cocos}"/><circle cx="${tx + 3}" cy="${ty + 5}" r="3" fill="${c.cocos}"/></g>`;
  }
  // la garita del Morro (San Juan) sobre su muralla, a la orilla
  function garita(c) {
    return `<path d="M-20 204 H92 L96 246 H-20Z" fill="${c.muro}"/><path d="M-20 204 H92 V209 H-20Z" fill="${c.sombra}" opacity="0.5"/>` +
      `<path d="M66 204 L90 204 L86 196 L70 196Z" fill="${c.sombra}"/>` +
      `<rect x="70" y="174" width="16" height="22" fill="${c.muro}"/><rect x="76.5" y="180" width="3" height="9" rx="1.5" fill="${c.sombra}"/>` +
      `<path d="M68 174 Q78 156 88 174Z" fill="${c.muro}"/><rect x="67" y="172.5" width="22" height="2.5" fill="${c.sombra}"/>` +
      `<circle cx="78" cy="157" r="2.4" fill="${c.muro}"/>`;
  }
  function gaviota(x, y, color, dur, retraso) {
    return `<path class="es-gaviota" style="animation-duration:${dur}s;animation-delay:-${retraso}s" d="M${x} ${y} q5 -5 10 0 q5 -5 10 0" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  function playa(atardecer) {
    const c = atardecer
      ? {cielo: [[0, "#3c096c"], [0.5, "#c9184a"], [1, "#ffb703"]], sol: "#ff9e00", solY: 182, solR: 30, mar: [[0, "#5a189a"], [1, "#240046"]],
        espuma: "#ffd6a5", arena: [[0, "#7b2d43"], [1, "#3c1028"]], tronco: "#1e0533", anillos: "#2d0a4a", hojas: ["#240046", "#1a0333"],
        cocos: "#12001f", muro: "#2b0a45", sombra: "#18032b", ave: "#2b0a45"}
      : {cielo: [[0, "#1c9fe0"], [0.55, "#7fd4fb"], [1, "#fff2c2"]], sol: "#ffd43b", solY: 70, solR: 22, mar: [[0, "#0284c7"], [1, "#22d3ee"]],
        espuma: "#ffffff", arena: [[0, "#fde68a"], [1, "#f4b860"]], tronco: "#8b5a2b", anillos: "#5e3a17", hojas: ["#2f9e44", "#51cf66"],
        cocos: "#5e3a17", muro: "#e9c48a", sombra: "#b98a52", ave: "#33536b"};
    const defs = vertical("es-cielo", c.cielo) + brillo("es-solb", c.sol) + vertical("es-mar", c.mar) + vertical("es-arena", c.arena);
    return svg(defs,
      `<rect width="400" height="300" fill="url(#es-cielo)"/>` +
      `<circle class="es-sol" cx="300" cy="${c.solY}" r="${c.solR * 3}" fill="url(#es-solb)"/><circle cx="300" cy="${c.solY}" r="${c.solR}" fill="${c.sol}"/>` +
      `<rect y="186" width="400" height="70" fill="url(#es-mar)"/>` +
      (atardecer ? `<path d="M270 190 h60 M278 198 h44 M286 206 h28" stroke="${c.sol}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>` : "") +
      olas(196, c.espuma, 0.35, true) + olas(212, c.espuma, 0.5) + olas(226, c.espuma, 0.6, true) +
      `<path d="M-20 238 Q110 222 220 232 T420 228 V320 H-20Z" fill="url(#es-arena)"/>` +
      `<path d="M-20 238 Q110 222 220 232 T420 228" fill="none" stroke="${c.espuma}" stroke-opacity="0.75" stroke-width="2.5"/>` +
      garita(c) + gaviota(120, 96, c.ave, 30, 4) + gaviota(60, 120, c.ave, 38, 21) +
      palma(352, 262, 120, -26, c, 0) + palma(384, 270, 92, -14, c, 1.7) + palma(30, 276, 74, 12, c, 3.1));
  }

  // ------------------------------------------------------------------ escenario de rock (negro, luces tenues)
  function escenario(metal) {
    const luces = metal ? ["#ff1a1a", "#ff4d00", "#ff1a1a", "#ff4d00"] : ["#ffb347", "#f1f3f5", "#ffb347", "#ff6b6b"];
    const xs = [70, 150, 250, 330];
    let defs = vertical("es-pared", [[0, "#0d0d12"], [1, "#040405"]]) + vertical("es-humo", [[0, "#ffffff", 0], [1, "#ffffff", metal ? 0.05 : 0.07]]);
    luces.forEach((col, i) => { defs += vertical("es-haz" + i, [[0, col, 0.75], [0.6, col, 0.18], [1, col, 0]]); });
    let haces = "", lamparas = "", charcos = "";
    xs.forEach((x, i) => {
      const lado = i < 2 ? 1 : -1;
      haces += `<g class="es-haz" style="transform-origin:${x}px 44px;animation-delay:-${i * 1.9}s;animation-direction:${i % 2 ? "alternate-reverse" : "alternate"}">` +
        `<polygon points="${x - 3},44 ${x + 3},44 ${x + 46 + lado * 14},266 ${x - 46 + lado * 14},266" fill="url(#es-haz${i})"/></g>`;
      lamparas += `<rect x="${x - 7}" y="34" width="14" height="10" rx="2" fill="#1d1d24"/><circle class="es-foquito" cx="${x}" cy="44" r="3.2" fill="${luces[i]}"/>`;
      charcos += `<ellipse class="es-charco" cx="${x + lado * 14}" cy="268" rx="44" ry="6" fill="${luces[i]}"/>`;
    });
    let truss = "";
    for (let x = 0; x < 400; x += 16) truss += `M${x} 26 L${x + 8} 34 L${x + 16} 26 `;
    const ampli = (x) => `<rect x="${x}" y="206" width="58" height="58" rx="3" fill="#121216" stroke="#26262e"/>` +
      `<rect x="${x + 5}" y="211" width="48" height="8" rx="1" fill="#1c1c22"/><circle cx="${x + 15}" cy="215" r="1.6" fill="#55555f"/><circle cx="${x + 22}" cy="215" r="1.6" fill="#55555f"/>` +
      `<circle cx="${x + 16}" cy="238" r="10" fill="#0a0a0d" stroke="#1f1f26"/><circle cx="${x + 42}" cy="238" r="10" fill="#0a0a0d" stroke="#1f1f26"/>` +
      `<rect x="${x + 6}" y="254" width="46" height="5" rx="1" fill="#0d0d11"/>`;
    return svg(defs,
      `<rect width="400" height="300" fill="#040405"/><rect width="400" height="262" fill="url(#es-pared)"/>` +
      `<path d="${truss}" stroke="#2b2b35" stroke-width="1.6" fill="none"/><rect y="24" width="400" height="3" fill="#2b2b35"/><rect y="33" width="400" height="3" fill="#2b2b35"/>` +
      haces + lamparas +
      `<rect y="262" width="400" height="40" fill="#0b0b0e"/><rect y="261" width="400" height="2.5" fill="#25252d"/>` + charcos +
      ampli(14) + ampli(328) +
      `<rect class="es-humo" x="-30" y="150" width="460" height="150" fill="url(#es-humo)"/>`);
  }

  // ------------------------------------------------------------------ electronica: laseres y luces
  function laser() {
    const colores = ["#22d3ee", "#e879f9", "#4ade80"];
    const fuentes = [[34, 44, 20, 3.1], [366, 44, 160, 3.7], [200, 40, 90, 2.6]];   // x, y, hacia donde apunta (grados), segundos
    let defs = vertical("es-noche", [[0, "#020010"], [0.68, "#14002e"], [1, "#05000f"]]) +
      vertical("es-horiz", [[0, "#e879f9", 0], [0.5, "#e879f9", 0.45], [1, "#e879f9", 0]]) +
      `<radialGradient id="es-bola" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#a5b4fc"/><stop offset="1" stop-color="#312e81"/></radialGradient>`;
    let rejilla = "";
    for (let i = -9; i <= 9; i++) rejilla += `<line x1="${200 + i * 7}" y1="206" x2="${200 + i * 58}" y2="300" stroke="#c026d3" stroke-opacity="0.55" stroke-width="0.8"/>`;
    for (let k = 0; k < 5; k++) rejilla += `<line class="es-linea" style="animation-delay:-${(k * 0.48).toFixed(2)}s" x1="-60" y1="206" x2="460" y2="206" stroke="#e879f9" stroke-width="1"/>`;
    let laseres = "";
    fuentes.forEach(([x, y, haciaDonde, seg], i) => {
      let rayos = "";
      for (let j = -2; j <= 2; j++) {
        const a = (haciaDonde + j * 11) * Math.PI / 180, x2 = r1(x + Math.cos(a) * 520), y2 = r1(y + Math.sin(a) * 520);
        rayos += `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${colores[i]}" stroke-width="4" stroke-opacity="0.22"/>` +
          `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${colores[i]}" stroke-width="1" stroke-opacity="0.95"/>`;
      }
      laseres += `<g class="es-laser" style="transform-origin:${x}px ${y}px;animation-duration:${seg}s;animation-delay:-${i * 0.9}s">${rayos}</g>`;
    });
    const focos = colores.map((c, i) => `<circle class="es-foco" style="animation-delay:-${i * 2.7}s" cx="${80 + i * 120}" cy="${110 + (i % 2) * 40}" r="46" fill="${c}"/>`).join("");
    let bola = `<line x1="200" y1="0" x2="200" y2="27" stroke="#6b7280" stroke-width="1"/><circle cx="200" cy="40" r="13" fill="url(#es-bola)"/>`;
    for (let k = -2; k <= 2; k++) bola += `<line x1="${200 + k * 5}" y1="${28 + Math.abs(k) * 1.2}" x2="${200 + k * 5}" y2="${52 - Math.abs(k) * 1.2}" stroke="#1e1b4b" stroke-width="0.5" opacity="0.6"/>`;
    for (let k = -2; k <= 2; k++) bola += `<line x1="${188 + Math.abs(k) * 1.2}" y1="${40 + k * 5}" x2="${212 - Math.abs(k) * 1.2}" y2="${40 + k * 5}" stroke="#1e1b4b" stroke-width="0.5" opacity="0.6"/>`;
    bola += `<circle class="es-destello" cx="195" cy="35" r="2" fill="#fff"/>`;
    return svg(defs,
      `<rect width="400" height="300" fill="url(#es-noche)"/>` + focos +
      `<rect y="196" width="400" height="20" fill="url(#es-horiz)"/><rect y="206" width="400" height="94" fill="#07001a"/>` + rejilla +
      laseres + bola);
  }

  // ------------------------------------------------------------------ balada: noche con luna y estrellas
  function noche() {
    semilla = 11;
    let estrellas = "";
    for (let i = 0; i < 46; i++) {
      estrellas += `<circle class="es-estrella" style="animation-delay:-${r1(azar() * 3)}s;animation-duration:${r1(2 + azar() * 2.5)}s" cx="${r1(azar() * 400)}" cy="${r1(azar() * 190)}" r="${r1(0.5 + azar() * 1.2)}" fill="#fff"/>`;
    }
    const defs = vertical("es-cielo", [[0, "#070b24"], [0.55, "#2e1065"], [1, "#9d174d"]]) + brillo("es-lunab", "#fff4d6");
    return svg(defs,
      `<rect width="400" height="300" fill="url(#es-cielo)"/>` + estrellas +
      `<line class="es-fugaz" x1="330" y1="40" x2="352" y2="30" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>` +
      `<circle class="es-sol" cx="316" cy="78" r="60" fill="url(#es-lunab)"/><circle cx="316" cy="78" r="19" fill="#fff4d6"/>` +
      `<circle cx="309" cy="73" r="3.5" fill="#efe1b8"/><circle cx="322" cy="85" r="2.5" fill="#efe1b8"/>` +
      `<path d="M-20 238 Q60 200 140 226 T300 214 T420 222 V320 H-20Z" fill="#2a0f4a"/>` +
      `<path d="M-20 256 Q90 232 200 252 T420 246 V320 H-20Z" fill="#170630"/>`);
  }

  // ------------------------------------------------------------------ rap: la ciudad de noche
  function ciudad() {
    semilla = 23;
    let edificios = "";
    for (let x = -14; x < 414;) {
      const ancho = Math.round(22 + azar() * 28), alto = Math.round(60 + azar() * 110), y = 262 - alto;
      edificios += `<rect x="${x}" y="${y}" width="${ancho}" height="${alto}" fill="${azar() < 0.5 ? "#0b1024" : "#121735"}"/>`;
      for (let wy = y + 8; wy < 252; wy += 11) {
        for (let wx = x + 5; wx < x + ancho - 6; wx += 8) {
          if (azar() < 0.32) edificios += `<rect${azar() < 0.15 ? ` class="es-ventana" style="animation-delay:-${r1(azar() * 2)}s"` : ""} x="${wx}" y="${wy}" width="3.5" height="5" fill="#fcd34d" opacity="0.8"/>`;
        }
      }
      x += ancho + 2;
    }
    const defs = vertical("es-cielo", [[0, "#0b1024"], [0.6, "#3b0764"], [1, "#f97316"]]);
    return svg(defs,
      `<rect width="400" height="300" fill="url(#es-cielo)"/>` +
      `<circle class="es-sol" cx="90" cy="70" r="14" fill="#fde68a" opacity="0.85"/>` + edificios +
      `<rect y="262" width="400" height="40" fill="#08080f"/><path d="M0 281 H400" stroke="#facc15" stroke-width="2" stroke-dasharray="16 14" opacity="0.6"/>`);
  }

  // ------------------------------------------------------------------ clasica y jazz: un teatro con telon
  function teatro(jazz) {
    const c = jazz
      ? {telon: ["#0b1a4a", "#1e40af", "#0b1a4a"], ribete: "#d4a017", pared: [[0, "#060a18"], [1, "#0b1226"]], suelo: [[0, "#1a2340"], [1, "#0a0f1f"]], luz: "#ffb347"}
      : {telon: ["#4a0710", "#b91c1c", "#4a0710"], ribete: "#e0b84a", pared: [[0, "#12040a"], [1, "#1f0a10"]], suelo: [[0, "#4a2512"], [1, "#1c0d06"]], luz: "#fff4d6"};
    const defs = vertical("es-pared", c.pared) + vertical("es-suelo", c.suelo) + vertical("es-cono", [[0, c.luz, 0.5], [1, c.luz, 0.04]]) +
      `<linearGradient id="es-telon" x1="0" y1="0" x2="0.12" y2="0" spreadMethod="repeat"><stop offset="0" stop-color="${c.telon[0]}"/><stop offset="0.5" stop-color="${c.telon[1]}"/><stop offset="1" stop-color="${c.telon[2]}"/></linearGradient>`;
    let festones = "M-20 0 H420 V40";
    for (let x = 420; x > -20; x -= 40) festones += ` q-20 18 -40 0`;
    festones += "Z";
    return svg(defs,
      `<rect width="400" height="300" fill="url(#es-pared)"/>` +
      `<polygon class="es-cono" points="186,30 214,30 300,262 100,262" fill="url(#es-cono)"/>` +
      `<rect y="258" width="400" height="44" fill="url(#es-suelo)"/><rect y="257" width="400" height="2.5" fill="${c.ribete}" opacity="0.7"/>` +
      `<ellipse class="es-charco" cx="200" cy="266" rx="96" ry="9" fill="${c.luz}"/>` +
      `<path d="M-20 0 H96 Q74 120 92 258 H-20Z" fill="url(#es-telon)"/><path d="M420 0 H304 Q326 120 308 258 H420Z" fill="url(#es-telon)"/>` +
      `<path d="M92 258 Q74 120 96 0" fill="none" stroke="${c.ribete}" stroke-width="1.5" opacity="0.6"/><path d="M308 258 Q326 120 304 0" fill="none" stroke="${c.ribete}" stroke-width="1.5" opacity="0.6"/>` +
      `<path d="${festones}" fill="url(#es-telon)" transform="translate(0 18)"/><path d="M-20 18 H420" stroke="${c.ribete}" stroke-width="2"/>` +
      (jazz ? `<path class="es-humo" d="M40 250 q20 -30 0 -60 t0 -60 M360 250 q-20 -30 0 -60 t0 -60" fill="none" stroke="#94a3b8" stroke-opacity="0.12" stroke-width="10" stroke-linecap="round"/>` : ""));
  }

  // ------------------------------------------------------------------ pop: guirnalda de bombillos y confeti
  function fiesta() {
    semilla = 5;
    const colores = ["#ff6b6b", "#fcc419", "#51cf66", "#339af0", "#cc5de8", "#ff922b"];
    let bombillos = "";
    for (let i = 0; i <= 14; i++) {
      const t = 0.03 + i * 0.0671, x = r1(-10 + 420 * t), y = r1((1 - t) * (1 - t) * 40 + 2 * (1 - t) * t * 96 + t * t * 40);
      bombillos += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 5}" stroke="#495057" stroke-width="1.2"/>` +
        `<ellipse class="es-bombillo ${i % 2 ? "impar" : "par"}" cx="${x}" cy="${y + 10}" rx="4.5" ry="6" fill="${colores[i % colores.length]}"/>`;
    }
    let confeti = "";
    for (let i = 0; i < 26; i++) {
      confeti += `<rect class="es-confeti" style="animation-delay:-${r1(azar() * 6)}s;animation-duration:${r1(4.5 + azar() * 3)}s" x="${r1(azar() * 400)}" y="0" width="4" height="7" rx="1" fill="${colores[i % colores.length]}"/>`;
    }
    const defs = vertical("es-cielo", [[0, "#d0ebff"], [0.6, "#f3f0ff"], [1, "#fff0f6"]]);
    return svg(defs,
      `<rect width="400" height="300" fill="url(#es-cielo)"/>` + confeti +
      `<path d="M-10 40 Q200 152 410 40" fill="none" stroke="#495057" stroke-width="1.2"/>` + bombillos +
      `<rect y="262" width="400" height="40" fill="#e7f5ff"/>`);
  }

  const HACER = {playa: () => playa(false), atardecer: () => playa(true), escenario: () => escenario(false), metal: () => escenario(true),
    laser, noche, ciudad, teatro: () => teatro(false), jazz: () => teatro(true), fiesta};

  // la escena de un genero: {nombre, svg}
  function de(estilo) {
    const nombre = ESCENA[estilo] || "fiesta";
    // ids propios de cada escena (sus degradados no se pisan si hay mas de una en la pagina)
    return {nombre, svg: HACER[nombre]().replace(/(id="|url\(#)es-/g, `$1es-${nombre}-`)};
  }
  return {ESCENA, de, nombres: Object.keys(HACER)};
})();
if (typeof module !== "undefined") module.exports = Escenarios;
