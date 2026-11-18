/* 18 nov - Perfil de identidad y calibración cognitiva (pedido del usuario: "hay un formulario que uno llena y el
   agente toma eso de referencia para entenderte: agrega este y realiza el empalme"). Va dentro de Mi perfil
   (perfil.js): las 14 preguntas del cuestionario del usuario, su Matriz de Orquestación Arquetípica y los
   modificadores, y el texto que entra en las instrucciones de Píxel (la app, y por el espejo el PC y el robot).
   - respuestas: {p1: "A".."D", ..., p4: "V"|"F", ...}; temperatura: 1..10 (o nada: entonces la sugerida).
   - evaluar(respuestas) -> {puntos, orden, dominante, secundario, modos, sugerida, respondidas, listo}
   - paraPrompt(cal, corto) -> líneas para {{PERFIL}} ("" si aún no hay perfil cognitivo).
   Funciones puras (sin página): se prueban en tools/prueba_modulos.js. */
"use strict";
(function () {
  const BLOQUES = [
    "Bloque I: Estructura del Yo, Deseo y Sombra (Psicoanálisis)",
    "Bloque II: Procesamiento, Atención y Dopamina (Neurociencia Cognitiva)",
    "Bloque III: Estilo de Comunicación, Fricción y Vínculo",
  ];
  const VF = {V: "Verdadero", F: "Falso"};
  // p: id; b: bloque (0, 1, 2); o: opciones A-D (sin o: Verdadero / Falso)
  const PREGUNTAS = [
    {p: "p1", b: 0, t: "Ante un error crítico o un bloqueo inesperado en un proyecto, tu primera reacción interna (antes de racionalizar) es:", o: {
      A: "Frustración dirigida al fallo del sistema; necesidad inmediata de aislar la variable y depurar.",
      B: "Autocrítica severa («debí prever esto») acompañada de tensión física.",
      C: "Desconexión emocional rápida para evitar sentir el impacto del fallo.",
      D: "Búsqueda inmediata de una segunda opinión o validación externa para recalibrar."}},
    {p: "p2", b: 0, t: "Cuando un proyecto está a punto de terminarse o exponerse al mundo, ¿qué resistencia suele aparecer?", o: {
      A: "La trampa de la sobre-optimización: sentir que «aún le falta un detalle técnico» para no lanzarlo.",
      B: "La dispersión: perder el interés repentinamente y querer empezar algo nuevo desde cero.",
      C: "La duda sobre el impacto real: cuestionar si el resultado estará a la altura de tus estándares.",
      D: "Ninguna resistencia significativa; prioridad absoluta en cerrar y entregar rápido."}},
    {p: "p3", b: 0, t: "El tipo de reconocimiento que genuinamente alimenta tu motivación es:", o: {
      A: "Que validen la elegancia, lógica o precisión estructural de lo que construiste.",
      B: "Que reconozcan el impacto tangible, velocidad o utilidad práctica del resultado.",
      C: "Que valoren tu visión original y tu capacidad de pensar fuera de lo convencional.",
      D: "Que reconozcan tu esfuerzo, compromiso y resiliencia durante el proceso."}},
    {p: "p4", b: 0, t: "En entornos formales ocultas deliberadamente tu humor ácido, tu impaciencia ante la ineficiencia o tu lado más disruptivo para evitar fricciones innecesarias."},
    {p: "p5", b: 0, t: "Lo que más te irrita en otras personas (o en una herramienta/IA) es la lentitud mental, la ambigüedad o el exceso de diplomacia sin sustancia."},
    {p: "p6", b: 1, t: "Para asimilar un concepto o sistema complejo, tu canal de entrada óptimo es:", o: {
      A: "Un mapa global, esquema o diagrama de arquitectura antes de ver los detalles.",
      B: "Un ejemplo práctico funcionando en tiempo real para desarmarlo y entenderlo.",
      C: "Una secuencia lógica paso a paso, estructurada de lo simple a lo complejo.",
      D: "Una analogía conceptual o narrativa que conecte el tema con algo que ya dominas."}},
    {p: "p7", b: 1, t: "Tu arquitectura de atención alcanza su máximo rendimiento mediante:", o: {
      A: "Ráfagas cortas e intensas de hiperfoco seguidas de pausas de desconexión total.",
      B: "Bloques largos y profundos de inmersión continua sin interrupciones externas.",
      C: "Alternancia dinámica entre múltiples tareas o frentes para evitar el aburrimiento.",
      D: "Rutinas predecibles con horarios fijos y objetivos claramente delimitados."}},
    {p: "p8", b: 1, t: "El detonante número uno de tu fatiga cognitiva (saturación mental) es:", o: {
      A: "El texto de relleno («paja»), las introducciones largas y la redundancia.",
      B: "La ambigüedad en las instrucciones o la falta de un objetivo claro.",
      C: "El exceso de teoría abstracta sin aplicación práctica inmediata.",
      D: "Las interrupciones constantes que rompen tu hilo de pensamiento."}},
    {p: "p9", b: 1, t: "Tu circuito de dopamina se activa con mayor fuerza al:", o: {
      A: "Resolver un problema técnico difícil y ver que el sistema funciona sin errores.",
      B: "Tachar pendientes de una lista y sentir avance tangible y velocidad.",
      C: "Conectar dos ideas aparentemente opuestas y descubrir un patrón nuevo.",
      D: "Completar una obra o entregable que refleja tu identidad y estándar de calidad."}},
    {p: "p10", b: 1, t: "Cuando cruzas el umbral hacia el agotamiento mental, tiendes a seguir forzando la máquina por terquedad antes que detenerte a descansar."},
    {p: "p11", b: 2, t: "En momentos de alta presión o caos mental, necesitas que tu asistente opere como:", o: {
      A: "Una herramienta quirúrgica: ejecuta órdenes precisas en silencio y sin adornos.",
      B: "Un espejo ordenador: estructura tus ideas dispersas y te devuelve claridad lógica.",
      C: "Un sparring intelectual: cuestiona tus premisas y te reta para fortalecer tus planes.",
      D: "Un copiloto táctico: absorbe la carga operativa y te mantiene enfocado en la estrategia."}},
    {p: "p12", b: 2, t: "Si planteas una idea con un fallo lógico evidente, prefieres recibir la corrección:", o: {
      A: "Directa y sin anestesia: «Esto fallará por X razón; aquí tienes dos alternativas».",
      B: "Mediante preguntas estratégicas que te permitan detectar el fallo por ti mismo.",
      C: "Con un análisis de riesgos pros/contras dejando la decisión final en tus manos.",
      D: "Con tacto y contexto, suavizando la crítica antes de proponer ajustes."}},
    {p: "p13", b: 2, t: "La carga mental cotidiana que delegarías sin dudar (si tuvieras garantía de precisión) es:", o: {
      A: "La microgestión operativa: recordatorios, agendas, seguimiento y orden de tareas.",
      B: "El filtrado de información: resumir ruido, investigar datos y sintetizar opciones.",
      C: "La redacción y formateo: transformar ideas en bruto en documentos estructurados.",
      D: "La validación inicial: detectar errores o puntos ciegos antes de ejecutar."}},
    {p: "p14", b: 2, t: "El tono corporativo excesivamente amable («¡Claro que sí! Estaré encantado de ayudarte...») te genera desconexión inmediata y pérdida de confianza."},
  ];
  const IDS = PREGUNTAS.map((q) => q.p);
  const valida = (q, v) => (q.o ? Object.prototype.hasOwnProperty.call(q.o, v) : v === "V" || v === "F");

  // Matriz de Orquestación Arquetípica (del usuario)
  const ARQUETIPOS = {
    arquitecto: {nombre: "El Arquitecto (Creador)",
      nucleo: "Busca control estructural, elegancia técnica y sistemas duraderos. Teme la mediocridad y la improvisación.",
      regla: "Entregar estructuras claras, código/soluciones limpias y respetar su estándar de calidad sin simplificar de más."},
    mago: {nombre: "El Mago (Tecnólogo / Ejecutor)",
      nucleo: "Orientado a la transformación rápida, resultados tangibles y apalancamiento mediante herramientas.",
      regla: "Ir directo al grano. Primero la solución ejecutable, luego la teoría solo si la solicita. Cero relleno."},
    estratega: {nombre: "El Estratega (Sabio / Analítico)",
      nucleo: "Necesita comprender las leyes ocultas, detectar patrones y minimizar riesgos antes de actuar.",
      regla: "Proveer datos duros, análisis de escenarios, cuestionamiento lógico y mapas conceptuales completos."},
    explorador: {nombre: "El Explorador (Disruptor)",
      nucleo: "Impulsado por la novedad, la autonomía y la conexión de ideas no convencionales. Odia la burocracia.",
      regla: "Mantener ritmo dinámico, ofrecer enfoques alternativos, evitar rigidez excesiva y absorber la microgestión."},
  };
  const ORDEN = ["arquitecto", "mago", "estratega", "explorador"];      // si empatan, este orden
  const MODOS = {
    directo: {nombre: "Modo Directo / Sin Filtros",
      instruccion: "Elimina saludos protocolarios, disculpas innecesarias y lenguaje corporativo. Usa un tono horizontal, ágil y ligeramente afilado."},
    monitor: {nombre: "Monitor de Economía Libidinal",
      instruccion: "Cuando lleve múltiples iteraciones densas o muestre dispersión, sugiere pausas de cierre o dividir el problema en bloques atómicos."},
    freno: {nombre: "Freno al Perfeccionismo",
      instruccion: "Señala cuándo una solución ya es funcional (MVP), para que no se quede sobre-optimizando."},
  };
  const MIN_RESPUESTAS = 7;        // con menos, aún no hay arquetipo (ni nada en las instrucciones)

  function limpiarRespuestas(r) {
    const o = {};
    for (const q of PREGUNTAS) { const v = r && String(r[q.p] || "").toUpperCase(); if (valida(q, v)) o[q.p] = v; }
    return o;
  }

  // 1. Regla de asignación por dominancia: cada arquetipo suma su patrón de respuestas clave
  function evaluar(respuestas) {
    const r = limpiarRespuestas(respuestas);
    const cuenta = (ids, letras) => ids.filter((p) => letras.includes(r[p])).length;
    const I = ["p1", "p2", "p3"], II = ["p6", "p7", "p8", "p9"], III = ["p11", "p12", "p13"], I_II = I.concat(II);
    const v = (p) => (r[p] === "V" ? 1 : 0);
    const puntos = {
      arquitecto: cuenta(I_II, ["A"]) + v("p4") + v("p5"),               // mayoría A en I y II + V en P4/P5
      mago: cuenta(I_II, ["B"]) + cuenta(III, ["A", "D"]),               // mayoría B en I y II + A/D en III
      estratega: cuenta(I_II, ["C"]) + cuenta(III, ["B", "C"]),          // mayoría C en I y II + B/C en III
      explorador: cuenta(I, ["D"]) + cuenta(II, ["C"]) + v("p4"),        // mayoría D en I + C en II + V en P4
    };
    const orden = ORDEN.slice().sort((a, b) => puntos[b] - puntos[a] || ORDEN.indexOf(a) - ORDEN.indexOf(b));
    const respondidas = Object.keys(r).length, listo = respondidas >= MIN_RESPUESTAS;
    // 2. Calibración de modificadores (ajuste fino)
    const modos = [];
    if (r.p4 === "V" && r.p14 === "V") modos.push("directo");
    if (r.p10 === "V") modos.push("monitor");
    if (r.p2 === "A") modos.push("freno");
    return {puntos, orden, respondidas, listo, modos, sugerida: temperaturaSugerida(r, modos),
      dominante: listo && puntos[orden[0]] > 0 ? orden[0] : "",
      secundario: listo && puntos[orden[1]] > 0 ? orden[1] : ""};
  }

  // Temperatura de comunicación, de 1 (seca y directa) a 10 (cálida y cercana). El cuestionario la deja para
  // completar tras evaluar: se sugiere con cómo quiere las correcciones (P12), el tono corporativo (P14) y lo que
  // oculta en entornos formales (P4); con el Modo Directo no pasa de 3. El usuario la puede mover.
  function temperaturaSugerida(r, modos) {
    let t = 6;
    t += {A: -2, B: 0, C: -1, D: 2}[r.p12] || 0;
    if (r.p14 === "V") t -= 1;
    if (r.p4 === "V") t -= 1;
    if (modos.includes("directo")) t = Math.min(t, 3);
    return Math.max(1, Math.min(10, t));
  }
  const temperatura = (cal, e) => {
    const t = Math.round(Number(cal && cal.temperatura));
    return t >= 1 && t <= 10 ? t : e.sugerida;
  };

  // Lo que entra en las instrucciones de Pixel (sin pronombres de él o ella). corto: sin las preferencias, para que el
  // perfil entero quepa en lo que acepta el PC (4000 letras) o con "Consumo bajo".
  const PREFERENCIAS = [["p6", "Aprende mejor con"], ["p7", "Su atención rinde con"], ["p8", "Lo que más le satura"],
    ["p11", "Bajo presión, quiere que operes como"], ["p12", "Las correcciones, así"], ["p13", "Delegaría sin dudar"],
    ["p3", "Lo que de verdad le motiva"]];
  function paraPrompt(cal, corto) {
    const r = limpiarRespuestas(cal && cal.respuestas), e = evaluar(r);
    if (!e.dominante) return "";
    const a = ARQUETIPOS[e.dominante], s = e.secundario && ARQUETIPOS[e.secundario];
    const l = ["- Su perfil cognitivo (lo llenó en su perfil; úsalo para entenderle, no lo menciones):",
      `  Arquetipo dominante: ${a.nombre}. ${corto ? "" : a.nucleo + " "}Regla de oro: ${a.regla}`];
    if (s) l.push(`  Arquetipo secundario: ${s.nombre}. Regla: ${s.regla}`);
    l.push(`  Temperatura de comunicación: ${temperatura(cal, e)} de 10 (1 = seca y directa, 10 = cálida y cercana).`);
    for (const m of e.modos) l.push(`  ${MODOS[m].nombre}: ${MODOS[m].instruccion}`);
    if (!corto) for (const [p, t] of PREFERENCIAS) if (r[p]) l.push(`  ${t}: ${PREGUNTAS.find((q) => q.p === p).o[r[p]]}`);
    return l.join("\n");
  }

  const api = {BLOQUES, PREGUNTAS, IDS, VF, ARQUETIPOS, MODOS, MIN_RESPUESTAS, evaluar, paraPrompt, limpiarRespuestas, temperatura};
  if (typeof window !== "undefined") window.Calibracion = api;
  if (typeof module !== "undefined") module.exports = api;
})();
