/* 17 nov - La luz del robot Píxel, igual en el panel del PC (escritorio.js) y en la app de internet (aparatos.js).
   Pedidos del usuario: "azul es WiFi, verde si todo está bien conectado, rojo si hay un error, amarillo si no hay API";
   verde = "si detecta API, red, y enlace con la app y el panel de control"; "los colores son los testigos de la
   conectividad"; y "si está el panel debe estar igual que en la web". El color lo decide el robot (luz_estado.h del
   firmware) y lo cuenta: al PC por la red (debug "robot:{...}") y a la app por la nube (pixeles/<pid>/estado). Aquí
   solo se dibuja lo que dice, con los mismos textos en los dos sitios.
   describir({luz, red, panel, api, app}) -> {luz, titulo, detalle, condiciones: [{nombre, ok, nota}]}; sin luz
   (el robot no está conectado), condiciones vacías. Función pura: se prueba en tools/prueba_modulos.js. */
"use strict";

window.LuzRobot = (function () {
  const LUCES = {
    verde: ["Todo bien conectado", ""],
    azul: ["Tiene WiFi", "Para el verde le falta lo que está en rojo abajo."],
    amarilla: ["Conectado, pero no hay API", "Ninguna IA de internet le contesta: revisa las claves de IA."],
    roja: ["Hay un error", "Se reinició por falta de corriente o no logra entrar a su WiFi."],
  };

  function describir(r) {
    r = r || {};
    const luz = LUCES[r.luz] ? r.luz : "";
    if (!luz) return {luz, titulo: "Sin conexión", detalle: "El robot no está conectado.", condiciones: []};
    return {
      luz, titulo: LUCES[luz][0], detalle: LUCES[luz][1],
      condiciones: [
        {nombre: "Red", ok: !!r.red, nota: r.red ? "WiFi" : "sin WiFi"},
        {nombre: "Panel de control", ok: !!r.panel, nota: r.panel ? "conectado" : "sin conectar"},
        {nombre: "API", ok: !!r.api, nota: r.api ? "una IA de internet contesta" : "ninguna IA de internet contesta"},
        {nombre: "Enlace con la app", ok: !!r.app, nota: r.app ? "enlazado" : "sin enlazar"},
      ],
    };
  }

  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

  // El HTML de las condiciones (los dos sitios lo pintan igual); extra(nombre, ok) agrega algo al final de una fila
  function htmlCondiciones(d, extra) {
    return d.condiciones.map((c) => `<li class="${c.ok ? "bien" : "mal"}"><span>${c.ok ? "✓" : "✗"}</span><b>${esc(c.nombre)}</b><small>${esc(c.nota)}</small>${extra ? extra(c.nombre, c.ok) : ""}</li>`).join("");
  }

  return {LUCES, describir, htmlCondiciones};
})();
