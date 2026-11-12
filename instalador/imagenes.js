/* Fase 15 (12 nov) - Las imagenes del programa, dibujadas en Chrome sin pantalla (puppeteer-core, fuera del repo):
     instalador/imagenes/pixel.ico      icono del instalador, sus accesos y la ventana (16 a 256 px)
     instalador/imagenes/pixel.png      el mismo, 256 px (el menu de Linux)
     instalador/imagenes/bienvenida.bmp 164x314, la franja de la primera y la ultima pagina del instalador
     instalador/imagenes/cabecera.bmp   150x57, la cabecera de las demas paginas
   Todo sale de web/icono_programa.svg (pedido del usuario: "generar un icono", todo azul). Se guardan en el repo:
   construir.sh ya no necesita Chrome para tener icono (la 2.1.2 salio sin el por eso). Volver a correrlo solo si
   cambia el dibujo:
     PUPPETEER=<carpeta>/node_modules/puppeteer-core node instalador/imagenes.js */
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");

const RAIZ = path.join(__dirname, "..");
const SALIDA = path.join(__dirname, "imagenes");
const ICONO = fs.readFileSync(path.join(RAIZ, "web", "icono_programa.svg"), "utf8");
const TAMANOS_ICO = [16, 20, 24, 32, 40, 48, 64, 256];
const FONDO = "#071533";              // = MUI_BGCOLOR de pixel.nsi: la imagen se funde con la pagina

// La cara de Pixel sin el cuadro de fondo (para las imagenes grandes del instalador)
const CARA = ICONO.replace(/<rect width="64" height="64"[^>]*\/>/g, "").replace(/<!--[\s\S]*?-->/g, "")
  .replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const BIENVENIDA = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="fb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14408f"/><stop offset=".55" stop-color="#0a1f4d"/><stop offset="1" stop-color="${FONDO}"/></linearGradient>
    <radialGradient id="luz" cx="50%" cy="38%" r="45%"><stop offset="0" stop-color="#5ee7ff" stop-opacity=".45"/><stop offset="1" stop-color="#5ee7ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="suelo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8" stop-opacity="0"/><stop offset="1" stop-color="#38bdf8" stop-opacity=".35"/></linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#fb)"/>
  <rect width="164" height="314" fill="url(#luz)"/>
  <g stroke="url(#suelo)" stroke-width="1">
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<line x1="${82 + (i - 4) * 9}" y1="226" x2="${82 + (i - 4) * 70}" y2="314"/>`).join("")}
    ${[234, 246, 262, 284, 312].map((y) => `<line x1="0" y1="${y}" x2="164" y2="${y}"/>`).join("")}
  </g>
  ${[[18, 30, 1.2], [140, 22, 1], [128, 70, 1.4], [30, 96, .9], [148, 140, 1.1], [14, 170, 1.3], [60, 18, .8], [110, 190, .9]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#bfe3ff" opacity=".8"/>`).join("")}
  <g transform="translate(22 46) scale(1.875)">${CARA}</g>
  <text x="82" y="200" text-anchor="middle" font-family="DejaVu Sans, Segoe UI, sans-serif" font-size="27" font-weight="700" fill="#ffffff">Píxel</text>
  <text x="82" y="219" text-anchor="middle" font-family="DejaVu Sans, Segoe UI, sans-serif" font-size="10.5" font-weight="600" fill="#7dd3fc" letter-spacing=".6">DIVERGENCY IA</text>
</svg>`;

const CABECERA = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs>
    <linearGradient id="fc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${FONDO}"/><stop offset="1" stop-color="#123a85"/></linearGradient>
    <radialGradient id="lc" cx="82%" cy="50%" r="40%"><stop offset="0" stop-color="#5ee7ff" stop-opacity=".45"/><stop offset="1" stop-color="#5ee7ff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="150" height="57" fill="url(#fc)"/>
  <rect width="150" height="57" fill="url(#lc)"/>
  <g transform="translate(97 1) scale(0.86)">${CARA}</g>
</svg>`;

function mapaDeBitsIco(px, rgba) {      // para el .ico: BITMAPINFOHEADER + BGRA de abajo arriba + mascara AND vacia
  const fila = px * 4, mascara = Math.ceil(px / 32) * 4 * px;
  const b = Buffer.alloc(40 + fila * px + mascara);
  b.writeUInt32LE(40, 0); b.writeInt32LE(px, 4); b.writeInt32LE(px * 2, 8);
  b.writeUInt16LE(1, 12); b.writeUInt16LE(32, 14); b.writeUInt32LE(fila * px + mascara, 20);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const o = (y * px + x) * 4, d = 40 + (px - 1 - y) * fila + x * 4;
      b[d] = rgba[o + 2]; b[d + 1] = rgba[o + 1]; b[d + 2] = rgba[o]; b[d + 3] = rgba[o + 3];
    }
  }
  return b;
}

function archivoBmp(w, h, rgba) {       // BMP de 24 bits (lo que pide NSIS), filas de abajo arriba rellenas a 4 bytes
  const fila = Math.ceil((w * 3) / 4) * 4, datos = fila * h;
  const b = Buffer.alloc(54 + datos);
  b.write("BM", 0); b.writeUInt32LE(54 + datos, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(datos, 34); b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, d = 54 + (h - 1 - y) * fila + x * 3;
      b[d] = rgba[o + 2]; b[d + 1] = rgba[o + 1]; b[d + 2] = rgba[o];
    }
  }
  return b;
}

(async () => {
  fs.mkdirSync(SALIDA, {recursive: true});
  const nav = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run"]});
  try {
    const p = await nav.newPage();
    const pintar = (svg, w, h) => p.evaluate(async (svg, w, h) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(img, 0, 0, w, h);
      return {rgba: Array.from(x.getImageData(0, 0, w, h).data), png: c.toDataURL("image/png").split(",")[1]};
    }, svg, w, h);

    const imgs = [];
    for (const t of TAMANOS_ICO) imgs.push(Object.assign({t}, await pintar(ICONO, t, t)));
    const datos = imgs.map((i) => (i.t === 256 ? Buffer.from(i.png, "base64") : mapaDeBitsIco(i.t, i.rgba)));
    const cab = Buffer.alloc(6 + 16 * imgs.length);
    cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(imgs.length, 4);
    let pos = cab.length;
    imgs.forEach((i, k) => {
      const e = 6 + 16 * k;
      cab[e] = i.t === 256 ? 0 : i.t; cab[e + 1] = i.t === 256 ? 0 : i.t;
      cab.writeUInt16LE(1, e + 4); cab.writeUInt16LE(32, e + 6);
      cab.writeUInt32LE(datos[k].length, e + 8); cab.writeUInt32LE(pos, e + 12);
      pos += datos[k].length;
    });
    fs.writeFileSync(path.join(SALIDA, "pixel.ico"), Buffer.concat([cab, ...datos]));
    fs.writeFileSync(path.join(SALIDA, "pixel.png"), Buffer.from(imgs.find((i) => i.t === 256).png, "base64"));
    const b = await pintar(BIENVENIDA, 164, 314);
    fs.writeFileSync(path.join(SALIDA, "bienvenida.bmp"), archivoBmp(164, 314, b.rgba));
    const c = await pintar(CABECERA, 150, 57);
    fs.writeFileSync(path.join(SALIDA, "cabecera.bmp"), archivoBmp(150, 57, c.rgba));
    console.log("imagenes en " + SALIDA + ": " + fs.readdirSync(SALIDA).join(", "));
  } finally { await nav.close(); }
})().catch((e) => { console.error("imagenes:", e.message); process.exit(1); });
