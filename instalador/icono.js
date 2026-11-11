/* Instaladores - web/icono.svg -> pixel.ico (16, 32, 48 y 256 px) para los accesos de Windows.
   Dibuja el SVG en Chrome sin pantalla (puppeteer-core, fuera del repo) y arma el .ico a mano:
   16/32/48 como mapas de bits de 32 bits (los entiende cualquier Windows) y 256 como PNG.
   Uso: PUPPETEER=<carpeta>/node_modules/puppeteer-core node instalador/icono.js web/icono.svg salida.ico */
"use strict";
const fs = require("fs");
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core");

const [, , svgRuta, icoRuta] = process.argv;
const TAMANOS = [16, 32, 48, 256];

function mapaDeBits(px, rgba) {          // BITMAPINFOHEADER + BGRA de abajo arriba + mascara AND vacia
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

(async () => {
  const svg = fs.readFileSync(svgRuta, "utf8");
  const nav = await puppeteer.launch({executablePath: "/usr/bin/google-chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run"]});
  try {
    const p = await nav.newPage();
    const imgs = await p.evaluate(async (svg, tamanos) => {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      return tamanos.map((t) => {
        const c = document.createElement("canvas");
        c.width = c.height = t;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0, t, t);
        return {t, rgba: Array.from(x.getImageData(0, 0, t, t).data), png: c.toDataURL("image/png").split(",")[1]};
      });
    }, svg, TAMANOS);
    const datos = imgs.map((i) => (i.t === 256 ? Buffer.from(i.png, "base64") : mapaDeBits(i.t, i.rgba)));
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
    fs.writeFileSync(icoRuta, Buffer.concat([cab, ...datos]));
    console.log(`icono: ${icoRuta} (${TAMANOS.join(", ")} px)`);
  } finally { await nav.close(); }
})().catch((e) => { console.error("icono:", e.message); process.exit(1); });
