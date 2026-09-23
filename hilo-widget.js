/**
 * Hilo — website chat widget.
 *
 * One <script> tag on the client's site, no build step, no dependencies:
 *
 *   <script src="hilo-widget.js"
 *           data-api="https://hilo.tu-dominio.com"
 *           data-title="Café El Buen Sabor"
 *           data-accent="#1f6f54"></script>
 *
 * The session id is issued by the server and kept in sessionStorage, so a
 * refresh keeps the conversation and a new tab starts a fresh one. It is
 * never generated here: a client-chosen id would let anyone read somebody
 * else's chat by guessing it.
 *
 * Replies are collected by polling rather than a socket. For the message
 * volume a small business sees, a poll every two seconds while the panel is
 * open costs less than keeping a connection per visitor alive, and it
 * survives the proxies and captive networks a socket does not.
 */
(function () {
  "use strict";

  // currentScript covers the normal <script> tag and dynamic insertion alike.
  // The fallback is for tag managers, which run the snippet from a callback
  // where currentScript is null — a common way a small business installs this.
  var script =
    document.currentScript ||
    document.querySelector('script[src*="hilo-widget"][data-api]');

  if (!script) {
    console.error("[hilo] no se encontró la etiqueta <script> del widget.");
    return;
  }

  var API = (script.getAttribute("data-api") || "").replace(/\/$/, "");
  var TITLE = script.getAttribute("data-title") || "Chat";
  var ACCENT = script.getAttribute("data-accent") || "#1f6f54";
  var PLACEHOLDER = script.getAttribute("data-placeholder") || "Escribí tu consulta";
  var GREETING = script.getAttribute("data-greeting") || "";
  // El default sigue siendo la burbuja genérica: esto no cambia lo que ya
  // corre en el sitio de ningún cliente. Sólo Milagros la prende, a mano,
  // en su propia etiqueta <script>.
  var ICON = script.getAttribute("data-icon") || "";
  var STORAGE_KEY = "hilo.session";

  // El texto sobre el acento se elige solo por luminancia, no por una lista
  // de casos: con el verde de siempre sigue dando blanco: con un acento claro
  // (el ámbar de Milagros, o el que elija cualquier otro cliente) pasa a
  // tinta oscura. Fórmula de luminancia relativa WCAG.
  function textoLegibleSobre(hex) {
    var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
    if (!m) return "#fff";
    var canal = function (v) {
      v = parseInt(v, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    var L = 0.2126 * canal(m[1]) + 0.7152 * canal(m[2]) + 0.0722 * canal(m[3]);
    return L > 0.44 ? "#1b1a17" : "#fff";
  }
  var ACCENT_FG = textoLegibleSobre(ACCENT);

  // Cuánto tarda la tarjeta en formarse cuando se abre: lo comparten el CSS
  // (la revelación del contenido sólido) y el canvas (la convergencia de las
  // partículas), para que sean la misma animación y no dos que coinciden por
  // casualidad.
  var DUR_OPEN = 460;

  var POLL_OPEN_MS = 2500;
  var POLL_AFTER_SEND_MS = 700;
  var POLL_AFTER_SEND_TRIES = 12;

  if (!API) {
    console.error("[hilo] falta data-api en la etiqueta <script>.");
    return;
  }

  // ── styles ──────────────────────────────────────────────────────────────

  var css = `
  .hilo-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;
    width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;
    background:var(--hilo-accent);color:var(--hilo-accent-fg);
    box-shadow:0 6px 24px rgba(0,0,0,.22);
    display:grid;place-items:center;transition:transform .15s ease}
  .hilo-launcher:hover{transform:translateY(-2px)}
  .hilo-launcher:focus-visible{outline:3px solid var(--hilo-accent);outline-offset:3px}
  .hilo-panel{position:fixed;right:20px;bottom:88px;z-index:2147483000;
    width:min(370px,calc(100vw - 40px));height:min(520px,calc(100vh - 130px));
    display:none;flex-direction:column;overflow:hidden;
    background:var(--hilo-bg);color:var(--hilo-fg);
    border:1px solid var(--hilo-line);border-radius:14px;
    box-shadow:0 18px 50px rgba(0,0,0,.24);
    font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .hilo-panel[data-open="true"]{display:flex;
    animation:hilo-materializar ${DUR_OPEN}ms ease-out both}
  .hilo-panel[data-open="true"] .hilo-panel-cont{
    animation:hilo-materializar-contenido ${DUR_OPEN}ms ease-out both}
  @keyframes hilo-materializar{0%{opacity:0}100%{opacity:1}}
  @keyframes hilo-materializar-contenido{0%,60%{opacity:0}100%{opacity:1}}
  .hilo-panel-c{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .hilo-panel-cont{display:flex;flex-direction:column;min-height:0;flex:1}
  .hilo-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
    padding:12px 14px;background:var(--hilo-accent);color:var(--hilo-accent-fg);
    font-weight:600}
  .hilo-close{background:none;border:0;color:var(--hilo-accent-fg);font-size:22px;
    line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
  .hilo-close:focus-visible{outline:2px solid var(--hilo-accent-fg);outline-offset:1px}
  .hilo-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;
    position:relative}
  .hilo-log-c{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .hilo-msg{max-width:82%;padding:9px 12px;border-radius:13px;white-space:pre-wrap;
    overflow-wrap:anywhere;background:#fff;border:0}
  .hilo-msg[data-from="user"]{align-self:flex-end;color:var(--hilo-fg);
    border-bottom-right-radius:4px}
  .hilo-msg[data-from="agent"]{align-self:flex-start;color:var(--hilo-fg);
    border-bottom-left-radius:4px}
  .hilo-msg[data-from="system"]{align-self:center;font-size:13px;color:var(--hilo-muted);
    background:none;text-align:center}
  .hilo-typing{align-self:flex-start;display:flex;gap:4px;padding:11px 13px;
    background:var(--hilo-bubble);border-radius:13px;border-bottom-left-radius:4px}
  .hilo-typing i{width:6px;height:6px;border-radius:50%;background:var(--hilo-muted);
    animation:hilo-blink 1.2s infinite}
  .hilo-typing i:nth-child(2){animation-delay:.2s}
  .hilo-typing i:nth-child(3){animation-delay:.4s}
  @keyframes hilo-blink{0%,60%,100%{opacity:.25}30%{opacity:1}}
  .hilo-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--hilo-line)}
  .hilo-input{flex:1;padding:10px 12px;border:1px solid var(--hilo-line);border-radius:9px;
    background:var(--hilo-bg);color:var(--hilo-fg);font:inherit;min-width:0}
  .hilo-input:focus-visible{outline:2px solid var(--hilo-accent);outline-offset:-1px}
  .hilo-send{padding:0 15px;border:0;border-radius:9px;background:#fff;
    color:var(--hilo-fg);font:inherit;font-weight:600;cursor:pointer;
    position:relative;overflow:visible}
  .hilo-send-c{position:absolute;inset:-6px;width:calc(100% + 12px);
    height:calc(100% + 12px);pointer-events:none}
  .hilo-send:disabled{opacity:.5;cursor:default}
  .hilo-send:focus-visible{outline:3px solid var(--hilo-accent);outline-offset:2px}
  :root{--hilo-accent:${ACCENT};--hilo-accent-fg:${ACCENT_FG};--hilo-bg:#fff;
    --hilo-fg:#16181d;--hilo-line:#e3e5ea;--hilo-bubble:#f1f3f6;--hilo-muted:#6b7280}
  @media (prefers-color-scheme:dark){
    :root{--hilo-bg:#16181d;--hilo-fg:#f2f3f5;--hilo-line:#2c3039;--hilo-bubble:#23262e;
      --hilo-muted:#9aa1ad}
    .hilo-msg[data-from="user"],.hilo-msg[data-from="agent"],.hilo-send{
      background:#20232b;color:var(--hilo-fg)}}
  @media (prefers-reduced-motion:reduce){
    .hilo-launcher{transition:none}.hilo-typing i{animation:none;opacity:.5}
    .hilo-panel[data-open="true"]{animation:none}}
  `;

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── markup ──────────────────────────────────────────────────────────────

  var launcher = document.createElement("button");
  launcher.className = "hilo-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Abrir el chat");
  launcher.setAttribute("aria-expanded", "false");
  if (ICON !== "campana") {
    launcher.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';
  }

  var panel = document.createElement("div");
  panel.className = "hilo-panel";
  panel.setAttribute("data-open", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", TITLE);
  panel.innerHTML =
    '<div class="hilo-panel-cont">' +
    '<div class="hilo-head"><span></span>' +
    '<button class="hilo-close" type="button" aria-label="Cerrar el chat">&times;</button></div>' +
    '<div class="hilo-log" role="log" aria-live="polite" aria-atomic="false"></div>' +
    '<form class="hilo-form">' +
    '<label class="hilo-sr" for="hilo-input" hidden>Mensaje</label>' +
    '<input class="hilo-input" id="hilo-input" autocomplete="off" />' +
    '<button class="hilo-send" type="submit">Enviar</button>' +
    "</form></div>";

  panel.querySelector(".hilo-head span").textContent = TITLE;
  panel.querySelector(".hilo-input").placeholder = PLACEHOLDER;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  // ── ícono opcional: la mascota-campana en vez de la burbuja ──────────────
  // Mismo dibujo y mismo motor que lab/mesa/anim/campana-mascota.html,
  // portado sin dependencias porque este archivo es el que se le entrega a
  // cada cliente tal cual. Sin círculo de fondo: el botón directamente ES
  // la animación, así que el hitbox del <button> es la propia campana.
  if (ICON === "campana") {
    (function (launcher, panel) {
      var TAU = Math.PI * 2;
      var lim = function (v, a, b) { return v < a ? a : v > b ? b : v; };
      var mez = function (a, b, t) { return a + (b - a) * t; };
      var suavizar = function (t) { return t * t * (3 - 2 * t); };

      var ANCHO = 64, ALTO = 116;   // proporción 338:614 del arte original

      launcher.style.background = "none";
      launcher.style.borderRadius = "0";
      launcher.style.boxShadow = "none";
      launcher.style.width = ANCHO + "px";
      launcher.style.height = ALTO + "px";
      launcher.style.filter = "drop-shadow(0 6px 16px rgba(0,0,0,.22))";
      // El panel se apoya en la altura real del lanzador, no en el valor fijo
      // de la burbuja: si el tamaño de la mascota cambia, esto se acomoda solo.
      panel.style.bottom = (20 + ALTO + 14) + "px";

      var NS = "http://www.w3.org/2000/svg";
      function crear(tag, attrs, padre) {
        var e = document.createElementNS(NS, tag);
        for (var k in attrs) e.setAttribute(k, attrs[k]);
        padre.appendChild(e);
        return e;
      }

      launcher.innerHTML =
        '<svg viewBox="338 187 338 614" width="' + ANCHO + '" height="' + ALTO + '"' +
        ' preserveAspectRatio="xMidYMid meet" aria-hidden="true"' +
        ' style="display:block;overflow:visible">' +
        '<defs>' +
        '<radialGradient id="hm-nucleo"><stop offset="0%" stop-color="#ffe89b"/>' +
        '<stop offset="55%" stop-color="#f0b41c" stop-opacity=".97"/>' +
        '<stop offset="100%" stop-color="#d69a0e" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="hm-halo"><stop offset="0%" stop-color="#ffe89b" stop-opacity=".85"/>' +
        '<stop offset="45%" stop-color="#f0b41c" stop-opacity=".28"/>' +
        '<stop offset="100%" stop-color="#f0b41c" stop-opacity="0"/></radialGradient>' +
        "</defs>" +
        '<g id="hm-campana"></g><g id="hm-colgante"></g><g id="hm-ojos"></g>' +
        "</svg>";

      var svg = launcher.querySelector("svg");
      var gCampana = svg.querySelector("#hm-campana");
      var gColgante = svg.querySelector("#hm-colgante");
      var gOjos = svg.querySelector("#hm-ojos");

      // -- el sombrerito: el mismo contorno de components/campana --
      var CAMPANA = [
        { d: "M486 250 C474 232 484 210 502 212 C520 214 526 234 514 250", w: 9 },
        { d: "M478 258 L438 282 L420 318", w: 12 },
        { d: "M528 256 L572 280 L594 318", w: 12 },
        { d: "M420 318 L398 396 L370 494 L342 572", w: 13 },
        { d: "M594 318 L618 396 L646 494 L672 572", w: 13 },
        { d: "M462 268 L444 366 L420 476", w: 5 },
        { d: "M546 266 L570 364 L596 474", w: 5 },
        { d: "M342 572 L312 592 L326 616", w: 12 },
        { d: "M672 572 L702 592 L686 616", w: 12 },
        { d: "M334 600 C424 628 586 628 678 600", w: 6 },
        { d: "M326 616 C420 646 590 646 686 616", w: 12 }
      ];
      var PIVOTE = [500, 232], ESCALA_CAMPANA = 0.78;
      var RIM_SIN_ESCALAR = [506, 638.5];
      var RIM = [
        PIVOTE[0] + ESCALA_CAMPANA * (RIM_SIN_ESCALAR[0] - PIVOTE[0]),
        PIVOTE[1] + ESCALA_CAMPANA * (RIM_SIN_ESCALAR[1] - PIVOTE[1])
      ];
      gCampana.setAttribute("transform",
        "translate(" + PIVOTE[0] + " " + PIVOTE[1] + ") scale(" + ESCALA_CAMPANA +
        ") translate(" + (-PIVOTE[0]) + " " + (-PIVOTE[1]) + ")");
      CAMPANA.forEach(function (t) {
        crear("path", { d: t.d, fill: "none", stroke: "#1b1a17",
          "stroke-linecap": "round", "stroke-linejoin": "round",
          "stroke-width": t.w }, gCampana);
      });

      // -- los ojos: pupila chica y corrida, así se ve la medialuna sola --
      var OJO_ESCALA = 0.85;
      var OJO_RW = 42 * OJO_ESCALA, OJO_RP = 30 * OJO_ESCALA;
      var OJOS_Y = RIM[1] + OJO_RW - 0.5;
      var OJOS_X = [RIM[0] - 71, RIM[0] + 69];
      var SESGO = [9 * OJO_ESCALA, 1 * OJO_ESCALA];
      var MAX_OFF_X = 7 * OJO_ESCALA, MAX_OFF_Y = 4 * OJO_ESCALA;

      var iris = OJOS_X.map(function (cx) {
        crear("circle", { cx: cx, cy: OJOS_Y, r: OJO_RW, fill: "#fffdf6",
          stroke: "#1b1a17", "stroke-width": 6 }, gOjos);
        var g = crear("g", { transform:
          "translate(" + (cx + SESGO[0]) + " " + (OJOS_Y + SESGO[1]) + ")" }, gOjos);
        crear("circle", { r: OJO_RP, fill: "#1b1a17" }, g);
        crear("ellipse", { cx: -2.5, cy: -12, rx: 8.5, ry: 6, fill: "#fff",
          opacity: .92, transform: "rotate(-25 -2.5 -12)" }, g);
        crear("ellipse", { cx: -15, cy: 13, rx: 5.5, ry: 4, fill: "#fff",
          opacity: .85, transform: "rotate(18 -15 13)" }, g);
        return { g: g, cx: cx };
      });

      [[OJOS_X[0] - 62, OJOS_Y - 14, .30], [OJOS_X[1] + 62, OJOS_Y - 14, .34],
       [OJOS_X[0] - 30, OJOS_Y + 50, .22], [OJOS_X[1] + 30, OJOS_Y + 50, .24]]
        .forEach(function (m) {
          crear("circle", { cx: m[0], cy: m[1], r: 3.4, fill: "#1b1a17",
            opacity: m[2] }, gOjos);
        });

      // -- el badajo, de nariz: nace en el labio, cordel ondulado de punta a punta --
      var ANCLA = [RIM[0] + 0.3, RIM[1] - 2.5];
      var BOLA = [RIM[0] - 2, RIM[1] + 169.5];
      var halo = crear("circle", { cx: BOLA[0], cy: BOLA[1], r: 54,
        fill: "url(#hm-halo)" }, gColgante);
      crear("path", {
        d: "M" + ANCLA[0].toFixed(1) + "," + ANCLA[1].toFixed(1) + " " +
          "C489,562 521,576 505,590 C489,604 521,618 505,633 " +
          "C489,648 521,662 505,676 C489,691 519,703 " +
          BOLA[0].toFixed(1) + "," + BOLA[1].toFixed(1),
        fill: "none", stroke: "#1b1a17", "stroke-linecap": "round",
        "stroke-linejoin": "round", "stroke-width": 5.5
      }, gColgante);
      var nucleo = crear("circle", { cx: BOLA[0], cy: BOLA[1], r: 28,
        fill: "url(#hm-nucleo)" }, gColgante);
      function estrella(cx, cy, rE, rI) {
        var pts = [];
        for (var i = 0; i < 8; i++) {
          var a = (i / 8) * TAU - Math.PI / 2, r = i % 2 === 0 ? rE : rI;
          pts.push((cx + Math.cos(a) * r).toFixed(1) + "," +
            (cy + Math.sin(a) * r).toFixed(1));
        }
        return "M" + pts.join("L") + "Z";
      }
      var chispa = crear("path", { d: estrella(BOLA[0] + 27, BOLA[1] - 24, 11, 4),
        fill: "#fff8dd", opacity: 0 }, gColgante);

      // -- mirada: el puntero si es mouse y se movió hace poco, si no, barrido propio --
      var gx = 0, gy = 0, objX = 0, objY = 0, apuntando = false, ultimoMouse = -1e9;
      function puntoEnPantalla(x, y) {
        var pt = new DOMPoint(x, y);
        var m = svg.getScreenCTM();
        return m ? pt.matrixTransform(m) : { x: x, y: y };
      }
      window.addEventListener("pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        var centro = puntoEnPantalla((OJOS_X[0] + OJOS_X[1]) / 2, OJOS_Y);
        var dx = e.clientX - centro.x, dy = e.clientY - centro.y;
        var d = Math.hypot(dx, dy) || 1;
        var mag = Math.tanh(d / 220);
        objX = (dx / d) * mag; objY = (dy / d) * mag * .5;
        apuntando = true; ultimoMouse = performance.now();
      }, { passive: true });

      function miradaIdle(t) {
        var T = 4.4;
        return [Math.sin((t / T) * TAU), .16 * Math.sin((t / T) * TAU * 1.7 + 1.1)];
      }

      var RED = [];
      for (var i = 0; i < 64; i++) RED.push(Math.random());
      function ruido(x) {
        var i0 = Math.floor(x), f = suavizar(x - i0);
        return mez(RED[i0 & 63], RED[(i0 + 1) & 63], f);
      }

      var quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      function pintar(ms) {
        var t = ms / 1000;
        var tx, ty;
        if (!quieto && apuntando && ms - ultimoMouse < 3500) { tx = objX; ty = objY; }
        else {
          var idle = quieto ? [0, 0] : miradaIdle(t);
          tx = idle[0]; ty = idle[1]; apuntando = false;
        }
        var inercia = quieto ? 1 : .085;
        gx += (tx - gx) * inercia; gy += (ty - gy) * inercia;
        var dx = gx * MAX_OFF_X, dy = gy * MAX_OFF_Y;
        iris.forEach(function (o) {
          o.g.setAttribute("transform",
            "translate(" + (o.cx + SESGO[0] + dx).toFixed(2) + " " +
            (OJOS_Y + SESGO[1] + dy).toFixed(2) + ")");
        });

        var angulo = quieto ? 0 : Math.sin((t * TAU) / 2.6) * 3;
        gColgante.setAttribute("transform",
          "rotate(" + angulo.toFixed(3) + " " + ANCLA[0] + " " + ANCLA[1] + ")");

        if (!quieto) {
          var base = .82 + .14 * Math.sin((t * TAU) / 2.3);
          var r = ruido(t * .5);
          var guino = r > .88 ? (r - .88) / .12 : 0;
          var luz = lim(base + guino * .5, 0, 1);
          nucleo.setAttribute("opacity", luz.toFixed(3));
          nucleo.setAttribute("transform", "scale(" + (1 + guino * .22).toFixed(3) + ")");
          nucleo.setAttribute("transform-origin", BOLA[0] + "px " + BOLA[1] + "px");
          halo.setAttribute("opacity", (.55 + guino * .45).toFixed(3));
          chispa.setAttribute("opacity", (guino * .9).toFixed(3));
        } else {
          nucleo.setAttribute("opacity", .9);
          halo.setAttribute("opacity", .5);
        }
        requestAnimationFrame(pintar);
      }

      // Fuera de pantalla no hace falta seguir pintando.
      var visible = true;
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; },
        { rootMargin: "80px" }).observe(launcher);
      var ultimo = -1;
      (function lazo(ms) {
        if (visible && ms !== ultimo) { ultimo = ms; pintar(ms); }
        requestAnimationFrame(lazo);
      })(0);
    })(launcher, panel);
  }

  var log = panel.querySelector(".hilo-log");
  var form = panel.querySelector(".hilo-form");
  var input = panel.querySelector(".hilo-input");
  var sendButton = panel.querySelector(".hilo-send");

  // ── contorno de partículas: Enviar + burbujas ─────────────────────────────
  // Reemplaza el relleno de color por fondo blanco con un borde dibujado por
  // partículas quietas en reposo, que se apartan cuando el mouse pasa cerca y
  // vuelven solas (resorte amortiguado). Mismo espíritu que el polvo del hub
  // (components/ui/hub-polvo.tsx) -amplitud por partícula que varía poco, para
  // que se lea como una nube y no como ruido-, pero de cero: aquél traza
  // órbitas alrededor de un círculo, esto traza el perímetro de un rectángulo
  // redondeado, y ese perímetro no existe en ningún lado del código de ella.
  var contorno = (function () {
    var TAU = Math.PI * 2;
    var cl = function (x, a, b) { return x < a ? a : x > b ? b : x; };
    // Las dos curvas del motor real (particulas-transmutacion.tsx): sm es la
    // meseta suave para las mezclas de opacidad, e3 es el acomodado -entra
    // rápido, se asienta despacio- para todo lo que converge en el lugar.
    var sm = function (a, b, x) { var t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    var e3 = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    var reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var MUTED = getComputedStyle(document.documentElement)
      .getPropertyValue("--hilo-muted").trim() || "#8a8f99";

    var mx = -9999, my = -9999, apuntando = false;
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      mx = e.clientX; my = e.clientY; apuntando = true;
    }, { passive: true });

    // Camina el contorno de un rectángulo con radio propio por esquina (las
    // burbujas tienen una esquina casi recta, la "cola"), y devuelve n puntos
    // parejos en fracción 0..1 de w/h -así, si el elemento cambia de tamaño,
    // el punto sigue estando "en el mismo lugar" del contorno sin recalcular-.
    function perimetro(w, h, rTL, rTR, rBR, rBL, n) {
      var tramos = [
        { len: Math.max(0, w - rTL - rTR),
          fn: function (t) { return [rTL + t * (w - rTL - rTR), 0]; } },
        { len: (Math.PI / 2) * rTR,
          fn: function (t) { var a = -Math.PI / 2 + t * (Math.PI / 2);
            return [w - rTR + Math.cos(a) * rTR, rTR + Math.sin(a) * rTR]; } },
        { len: Math.max(0, h - rTR - rBR),
          fn: function (t) { return [w, rTR + t * (h - rTR - rBR)]; } },
        { len: (Math.PI / 2) * rBR,
          fn: function (t) { var a = t * (Math.PI / 2);
            return [w - rBR + Math.cos(a) * rBR, h - rBR + Math.sin(a) * rBR]; } },
        { len: Math.max(0, w - rBR - rBL),
          fn: function (t) { return [w - rBR - t * (w - rBR - rBL), h]; } },
        { len: (Math.PI / 2) * rBL,
          fn: function (t) { var a = Math.PI / 2 + t * (Math.PI / 2);
            return [rBL + Math.cos(a) * rBL, h - rBL + Math.sin(a) * rBL]; } },
        { len: Math.max(0, h - rBL - rTL),
          fn: function (t) { return [0, h - rBL - t * (h - rBL - rTL)]; } },
        { len: (Math.PI / 2) * rTL,
          fn: function (t) { var a = Math.PI + t * (Math.PI / 2);
            return [rTL + Math.cos(a) * rTL, rTL + Math.sin(a) * rTL]; } }
      ];
      var total = tramos.reduce(function (s, tr) { return s + tr.len; }, 0) || 1;
      var pts = [];
      for (var i = 0; i < n; i++) {
        var s = (i / n) * total, acc = 0, k, p;
        for (k = 0; k < tramos.length; k++) {
          if (s <= acc + tramos[k].len || k === tramos.length - 1) {
            var t = tramos[k].len > 0 ? (s - acc) / tramos[k].len : 0;
            p = tramos[k].fn(Math.max(0, Math.min(1, t)));
            break;
          }
          acc += tramos[k].len;
        }
        pts.push([p[0] / w, p[1] / h]);
      }
      return pts;
    }

    var datosPorElemento = new WeakMap();
    function datosDe(el) {
      var d = datosPorElemento.get(el);
      if (d) return d;
      var rect = el.getBoundingClientRect();
      var w = rect.width || 1, h = rect.height || 1;
      var est = getComputedStyle(el);
      var rTL = parseFloat(est.borderTopLeftRadius) || 0;
      var rTR = parseFloat(est.borderTopRightRadius) || 0;
      var rBR = parseFloat(est.borderBottomRightRadius) || 0;
      var rBL = parseFloat(est.borderBottomLeftRadius) || 0;
      var n = Math.max(14, Math.min(40, Math.round((w + h) / 9)));
      var pts = perimetro(w, h, rTL, rTR, rBR, rBL, n);
      d = {
        pts: pts,
        ox: pts.map(function () { return 0; }),
        oy: pts.map(function () { return 0; }),
        vx: pts.map(function () { return 0; }),
        vy: pts.map(function () { return 0; }),
        fase: pts.map(function () { return Math.random() * TAU; }),
        amp: pts.map(function () { return 0.88 + Math.random() * 0.24; })
      };
      datosPorElemento.set(el, d);
      return d;
    }

    // Un canvas por zona (el log entero, el botón), no uno por burbuja.
    function crearCanvas(contenedor, clase) {
      var c = document.createElement("canvas");
      c.className = clase;
      contenedor.appendChild(c);
      return c;
    }
    function ajustar(c) {
      var rect = c.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.round(rect.width * dpr));
      var h = Math.max(1, Math.round(rect.height * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      var ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    function pintarItems(ctx, canvasRect, items, t) {
      items.forEach(function (item) {
        var rect = item.el.getBoundingClientRect();
        if (rect.width < 1) return;
        if (rect.bottom < canvasRect.top - 30 || rect.top > canvasRect.bottom + 30) return;
        var d = datosDe(item.el);
        ctx.fillStyle = item.tono === "accent" ? ACCENT : MUTED;
        for (var i = 0; i < d.pts.length; i++) {
          var px0 = rect.left - canvasRect.left + d.pts[i][0] * rect.width;
          var py0 = rect.top - canvasRect.top + d.pts[i][1] * rect.height;
          var px = px0, py = py0;
          if (!reducido) {
            if (apuntando) {
              var dx = px0 + d.ox[i] - (mx - canvasRect.left);
              var dy = py0 + d.oy[i] - (my - canvasRect.top);
              var dist = Math.hypot(dx, dy), alcance = 24;
              if (dist < alcance) {
                var fuerza = (1 - dist / alcance) * 2.6;
                d.vx[i] += (dx / (dist || 1)) * fuerza;
                d.vy[i] += (dy / (dist || 1)) * fuerza;
              }
            }
            d.vx[i] += -d.ox[i] * 0.05; d.vy[i] += -d.oy[i] * 0.05;
            d.vx[i] *= 0.86; d.vy[i] *= 0.86;
            d.ox[i] += d.vx[i]; d.oy[i] += d.vy[i];
            var j = Math.sin(t * 1.6 + d.fase[i]) * 0.45 * d.amp[i];
            var jn = Math.cos(t * 1.3 + d.fase[i] * 1.7) * 0.45 * d.amp[i];
            px = px0 + d.ox[i] + j; py = py0 + d.oy[i] + jn;
          }
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(px, py, 1.1, 0, TAU);
          ctx.fill();
        }
      });
    }

    var canvasLog = crearCanvas(log, "hilo-log-c");
    var canvasEnviar = crearCanvas(sendButton, "hilo-send-c");
    var canvasPanel = crearCanvas(panel, "hilo-panel-c");
    var burbujas = []; // {el, tono}

    function registrarBurbuja(el, from) {
      burbujas.push({ el: el, tono: from === "user" ? "accent" : "muted" });
    }

    // ── la tarjeta se arma con la misma nube: no es una animación CSS aparte
    // que coincide en el tiempo, es el mismo dibujo. Reusa perimetro() sobre
    // el panel entero (nada de assets ni curl 3D -eso vive en
    // particulas-transmutacion.tsx y necesita los .bin que este archivo no
    // puede cargar-, pero sí el mismo lenguaje: cada partícula arranca lejos
    // de su lugar, en una dirección al azar propia -no todas parejo hacia
    // afuera, que se leería como un aro creciendo y no como polvo
    // asentándose- y converge con la curva e3, la misma que usa el motor
    // real para todo lo que tiene que "acomodarse" en el lugar. -----------
    var apertura = null; // { t0, pts, desde, w, h, r } mientras arma; null en reposo
    function armar() {
      if (reducido) { apertura = null; return; }
      var rect = panel.getBoundingClientRect();
      var w = rect.width, h = rect.height;
      if (w < 1 || h < 1) { apertura = null; return; }
      var r = parseFloat(getComputedStyle(panel).borderRadius) || 14;
      var n = Math.max(70, Math.min(170, Math.round((w + h) / 6)));
      var pts = perimetro(w, h, r, r, r, r, n);
      var desde = pts.map(function () {
        var a = Math.random() * TAU, d = 42 + Math.random() * 64;
        return [Math.cos(a) * d, Math.sin(a) * d];
      });
      apertura = { t0: performance.now(), pts: pts, desde: desde, w: w, h: h };
    }
    function pintarApertura(ms) {
      var ctx = ajustar(canvasPanel);
      if (!apertura) { ctx.clearRect(0, 0, canvasPanel.width, canvasPanel.height); return; }
      var u = cl((ms - apertura.t0) / DUR_OPEN, 0, 1);
      var e = e3(u);
      // el giro se deshace a la par que la nube converge -es lo que pidió
      // ella, "un giro y expansión"-, y se acomoda a cero justo cuando la
      // tarjeta sólida ya está encima (ver hilo-materializar-contenido).
      var giro = -0.16 * (1 - e);
      var op = sm(0, 0.1, u) * (1 - sm(0.62, 1, u));
      ctx.clearRect(0, 0, apertura.w, apertura.h);
      if (op > 0.002) {
        ctx.save();
        ctx.translate(apertura.w / 2, apertura.h / 2);
        ctx.rotate(giro);
        ctx.translate(-apertura.w / 2, -apertura.h / 2);
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = op * 0.8;
        for (var i = 0; i < apertura.pts.length; i++) {
          var tx = apertura.pts[i][0] * apertura.w, ty = apertura.pts[i][1] * apertura.h;
          var px = tx + apertura.desde[i][0] * (1 - e);
          var py = ty + apertura.desde[i][1] * (1 - e);
          ctx.beginPath();
          ctx.arc(px, py, 1.3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      if (u >= 1) apertura = null;
    }

    var corriendo = false, cuadro = null;
    function frame(ms) {
      if (!corriendo) return;
      var t = ms / 1000;
      var ctxLog = ajustar(canvasLog);
      var rectLog = canvasLog.getBoundingClientRect();
      ctxLog.clearRect(0, 0, rectLog.width, rectLog.height);
      pintarItems(ctxLog, rectLog, burbujas, t);

      var ctxEnviar = ajustar(canvasEnviar);
      var rectEnviar = canvasEnviar.getBoundingClientRect();
      ctxEnviar.clearRect(0, 0, rectEnviar.width, rectEnviar.height);
      pintarItems(ctxEnviar, rectEnviar, [{ el: sendButton, tono: "accent" }], t);

      pintarApertura(ms);

      cuadro = requestAnimationFrame(frame);
    }
    function iniciar() {
      if (corriendo) return;
      corriendo = true;
      cuadro = requestAnimationFrame(frame);
    }
    function detener() {
      corriendo = false;
      if (cuadro) cancelAnimationFrame(cuadro);
    }

    return { registrarBurbuja: registrarBurbuja, iniciar: iniciar, detener: detener, armar: armar };
  })();

  // ── conversation ────────────────────────────────────────────────────────

  var session = null;
  var pollTimer = null;
  var typing = null;

  function post(path, body) {
    return fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (response) {
      if (!response.ok) {
        var error = new Error("HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      // The webhook answers the bare "ok" every webhook answers — it speaks
      // the same protocol as Meta and Twilio, not a private one for us. Only
      // the session and poll routes return JSON, so a missing body is normal
      // and must not be reported to the visitor as a failure.
      return response.text().then(function (text) {
        try {
          return JSON.parse(text);
        } catch (error) {
          return {};
        }
      });
    });
  }

  function bubble(from, text) {
    var node = document.createElement("div");
    node.className = "hilo-msg";
    node.setAttribute("data-from", from);
    node.textContent = text;
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    if (from !== "system") contorno.registrarBurbuja(node, from);
    return node;
  }

  function showTyping() {
    if (typing) return;
    typing = document.createElement("div");
    typing.className = "hilo-typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    typing.setAttribute("aria-label", "escribiendo");
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
  }

  function hideTyping() {
    if (typing) {
      typing.remove();
      typing = null;
    }
  }

  function ensureSession() {
    if (session) return Promise.resolve(session);

    var stored = null;
    try {
      stored = sessionStorage.getItem(STORAGE_KEY);
    } catch (error) {
      // Private mode, or storage disabled. A fresh session still works.
      stored = null;
    }
    if (stored) {
      session = stored;
      return Promise.resolve(session);
    }

    return post("/channels/web/session").then(function (data) {
      session = data.session_id;
      try {
        sessionStorage.setItem(STORAGE_KEY, session);
      } catch (error) {
        /* nothing to do; the id lives in memory for this page */
      }
      return session;
    });
  }

  // A session stored from a previous visit can outlive its server-side TTL
  // (24h) or survive a redeploy that reset it. That was showing up as "No
  // pudimos enviar el mensaje" for a visitor whose tab had simply been open
  // a while — indistinguishable, from the panel, from the server being down.
  function forgetSession() {
    session = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      /* nothing to do */
    }
  }

  function collect() {
    if (!session) return Promise.resolve([]);
    return post("/channels/web/poll", { session_id: session })
      .then(function (data) {
        var replies = data.replies || [];
        if (replies.length) hideTyping();
        replies.forEach(function (text) {
          bubble("agent", text);
        });
        return replies;
      })
      .catch(function () {
        // A dropped poll is not worth telling the visitor about; the next
        // one picks the replies up.
        return [];
      });
  }

  function pollBurst(remaining) {
    if (remaining <= 0) {
      hideTyping();
      return;
    }
    collect().then(function (replies) {
      if (replies.length) return;
      setTimeout(function () {
        pollBurst(remaining - 1);
      }, POLL_AFTER_SEND_MS);
    });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(collect, POLL_OPEN_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function open() {
    panel.setAttribute("data-open", "true");
    launcher.setAttribute("aria-expanded", "true");
    launcher.setAttribute("aria-label", "Cerrar el chat");
    contorno.armar();
    contorno.iniciar();

    ensureSession()
      .then(function () {
        if (GREETING && !log.childElementCount) bubble("agent", GREETING);
        startPolling();
        input.focus();
      })
      .catch(function () {
        bubble("system", "No pudimos abrir el chat. Probá de nuevo en un momento.");
      });
  }

  function close() {
    panel.setAttribute("data-open", "false");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Abrir el chat");
    stopPolling();
    contorno.detener();
    launcher.focus();
  }

  launcher.addEventListener("click", function () {
    if (panel.getAttribute("data-open") === "true") close();
    else open();
  });

  panel.querySelector(".hilo-close").addEventListener("click", close);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && panel.getAttribute("data-open") === "true") close();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;

    input.value = "";
    sendButton.disabled = true;
    bubble("user", text);
    showTyping();

    sendMessage(text, true).finally(function () {
      sendButton.disabled = false;
      input.focus();
    });
  });

  // retryOnRejectedSession: a 403 here almost always means the session id
  // this tab had (from sessionStorage, or the one already in memory) is one
  // the server no longer recognizes — expired or lost to a redeploy — not
  // that sending is broken. Forgetting it and minting a fresh one fixes that
  // silently; any other failure still surfaces the "no pudimos enviar" note.
  function sendMessage(text, retryOnRejectedSession) {
    return ensureSession()
      .then(function () {
        return post("/webhook/web", { session_id: session, text: text });
      })
      .then(function () {
        pollBurst(POLL_AFTER_SEND_TRIES);
      })
      .catch(function (error) {
        if (retryOnRejectedSession && error && error.status === 403) {
          forgetSession();
          return sendMessage(text, false);
        }
        hideTyping();
        bubble("system", "No pudimos enviar el mensaje. Probá de nuevo.");
      });
  }
})();
