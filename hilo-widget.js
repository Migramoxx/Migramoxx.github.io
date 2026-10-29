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
 * Dos Hilo en una misma página (ítem 78): las claves de sessionStorage llevan
 * el servidor ("hilo.session@" + data-api), así el agente de un sitio y el
 * café de la demo no se borran la sesión uno al otro; y un 429 al mandar
 * dice que se llegó al límite de mensajes de la hora, no «no pudimos enviar».
 *
 * Replies are collected by polling rather than a socket. For the message
 * volume a small business sees, a poll every two seconds while the panel is
 * open costs less than keeping a connection per visitor alive, and it
 * survives the proxies and captive networks a socket does not.
 *
 * Opcional: data-sugerencias="¿Cuánto sale?|¿Agenda turnos?" muestra esas
 * preguntas como botones debajo del saludo hasta que el visitante escribe.
 *
 * Opcional: data-tema="clase" hace que el panel siga sólo la clase "dark"
 * (o data-theme="dark") de <html>, para sitios con su propio botón de tema.
 * Sin el atributo sigue al sistema, salvo que <html> marque uno.
 *
 * Incrustado: la página puede meter el MISMO panel (misma sesión, mismo
 * historial) adentro de un elemento suyo, siempre abierto y sin lanzador:
 *
 *   window.hiloWidget.incrustar(document.querySelector("#chat"));
 *   window.hiloWidget.soltar();   // vuelve a flotante, cerrado
 *
 * Si el elemento desaparece sin llamar a soltar() (una navegación del lado
 * del cliente), el panel vuelve solo a flotante.
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
  // Preguntas listas para tocar, separadas por "|". Con tope: es una ayuda
  // para arrancar, no un menú.
  var SUGERENCIAS = (script.getAttribute("data-sugerencias") || "")
    .split("|")
    .map(function (s) { return s.trim(); })
    .filter(Boolean)
    .slice(0, 6);
  // Las claves llevan el servidor: con una fija ("hilo.session"), dos Hilo
  // en el mismo origen (el agente de Milagros y el café de la demo, en un
  // iframe del mismo sitio) se pisaban la sesión, y cada uno le borraba la
  // conversación al otro. El que tenía una pestaña abierta con la clave vieja
  // empieza una sesión nueva una vez.
  var STORAGE_KEY = "hilo.session@" + API;
  // Marca de que en esta pestaña el visitante ya escribió algo. Sin eso no
  // hay nada que sondear: el agente sólo contesta mensajes, así que una
  // sesión recién abierta no puede tener respuestas en cola.
  var CHARLO_KEY = "hilo.charlo@" + API;
  // Un 429 no es una falla: el servidor llegó a su tope de la hora (el del
  // widget entero o el de sesiones por dirección). Decir «no pudimos enviar»
  // invita a reintentar enseguida, que es justo lo que no sirve.
  var AVISO_LIMITE = "Llegamos al límite de mensajes de esta hora. Probá de nuevo en un rato.";

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

  // El anillo de foco de la caja de escritura: el acento, transparente.
  function hexAlfa(hex, alfa) {
    var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
    if (!m) return "rgba(0,0,0," + alfa + ")";
    return "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," +
      parseInt(m[3], 16) + "," + alfa + ")";
  }

  // De dónde sale el tema claro u oscuro. "auto" (el default): una clase o un
  // data-theme explícito en <html> manda, y si no hay, el del sistema.
  // "clase": sólo la clase "dark" o data-theme="dark" en <html>, para sitios
  // con su propio botón de tema que marcan el oscuro y nunca el claro (el de
  // Milagros): con "auto", un visitante con el sistema en oscuro que eligió
  // el sitio en claro veía el panel oscuro sobre una página clara.
  var TEMA = script.getAttribute("data-tema") === "clase" ? "clase" : "auto";

  // Cuánto tarda la tarjeta en formarse cuando se abre: lo comparten el CSS
  // (la revelación del contenido sólido) y el canvas (la convergencia de las
  // partículas), para que sean la misma animación y no dos que coinciden por
  // casualidad.
  var DUR_OPEN = 460;

  var POLL_OPEN_MS = 2500;
  var POLL_AFTER_SEND_MS = 700;
  var POLL_AFTER_SEND_TRIES = 12;
  // Con el chat abierto se pregunta cada 2,5 s. Una pestaña olvidada con el
  // chat abierto eran ~1.400 pedidos por hora al servidor, para siempre. Se
  // corta al ocultar la pestaña y tras 10 minutos sin que la persona escriba;
  // vuelve sola al mostrar la pestaña o al escribir.
  var POLL_IDLE_MS = 10 * 60 * 1000;

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
    display:grid;place-items:center;
    transition:transform .15s ease,opacity .35s ease,visibility .35s}
  .hilo-launcher:hover{transform:translateY(-2px)}
  .hilo-launcher[data-oculto="true"]{opacity:0;visibility:hidden;pointer-events:none;
    transform:translateY(10px)}
  .hilo-launcher:focus-visible{outline:3px solid var(--hilo-accent);outline-offset:3px}
  /* El panel (29/10/2026): el patrón de los asistentes actuales (Claude,
     Intercom). Cabecera neutra con avatar y estado, el agente escribe sobre
     el fondo sin burbuja, el visitante en una burbuja suave, y una caja de
     escritura que crece con el texto. El acento queda para lo que se toca:
     avatar, enviar, foco y los tres puntos. */
  .hilo-panel{position:fixed;right:20px;bottom:88px;z-index:2147483000;
    width:min(390px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));
    display:none;flex-direction:column;overflow:hidden;box-sizing:border-box;
    background:var(--hilo-bg);color:var(--hilo-fg);
    border:1px solid var(--hilo-line);border-radius:20px;
    box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 28px -6px rgba(0,0,0,.18),
      0 32px 64px -16px rgba(0,0,0,.24);
    font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;text-align:left}
  .hilo-panel *,.hilo-panel *::before{box-sizing:border-box}
  .hilo-panel[data-open="true"]{display:flex;
    animation:hilo-materializar ${DUR_OPEN}ms ease-out both}
  .hilo-panel[data-open="true"] .hilo-panel-cont{
    animation:hilo-materializar-contenido ${DUR_OPEN}ms ease-out both}
  @keyframes hilo-materializar{0%{opacity:0}100%{opacity:1}}
  @keyframes hilo-materializar-contenido{0%,35%{opacity:0;transform:translateY(8px)}
    92%{opacity:1;transform:none}}
  .hilo-panel-c{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .hilo-panel-cont{display:flex;flex-direction:column;min-height:0;flex:1}

  .hilo-head{flex:none;display:flex;align-items:center;gap:10px;
    padding:12px 10px 12px 14px;border-bottom:1px solid var(--hilo-line)}
  .hilo-av{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;
    background:var(--hilo-accent);color:var(--hilo-accent-fg)}
  .hilo-av svg{width:17px;height:17px;display:block}
  .hilo-head-txt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
  .hilo-title{font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis}
  .hilo-estado{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--hilo-muted)}
  .hilo-estado::before{content:"";width:7px;height:7px;border-radius:50%;
    background:var(--hilo-ok);box-shadow:0 0 0 3px var(--hilo-ok-halo)}
  .hilo-estado[data-caido]::before{background:var(--hilo-muted);box-shadow:none}
  .hilo-icon-b{flex:none;width:32px;height:32px;display:grid;place-items:center;padding:0;
    border:0;border-radius:10px;background:none;color:var(--hilo-muted);cursor:pointer;
    transition:background .15s,color .15s}
  .hilo-icon-b:hover{background:var(--hilo-bubble);color:var(--hilo-fg)}
  .hilo-icon-b:focus-visible{outline:2px solid var(--hilo-accent);outline-offset:1px}
  .hilo-icon-b svg{width:18px;height:18px;display:block}

  .hilo-log{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;
    padding:18px 16px 10px;display:flex;flex-direction:column;gap:16px;
    scrollbar-width:thin;scrollbar-color:var(--hilo-line) transparent}
  .hilo-row{display:flex;gap:10px;align-items:flex-start;
    animation:hilo-entra .32s cubic-bezier(.2,.8,.2,1) both}
  .hilo-row[data-from="user"]{justify-content:flex-end}
  .hilo-row[data-seguido]{margin-top:-8px}
  .hilo-row[data-seguido] .hilo-av{visibility:hidden}
  .hilo-row .hilo-av{width:26px;height:26px}
  .hilo-row .hilo-av svg{width:14px;height:14px}
  .hilo-msg{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
  .hilo-row[data-from="agent"] .hilo-msg{flex:1;padding-top:2px}
  .hilo-row[data-from="user"] .hilo-msg{max-width:85%;padding:9px 14px;
    background:var(--hilo-bubble);border-radius:18px 18px 6px 18px}
  .hilo-msg a{color:inherit;text-decoration:underline;text-decoration-thickness:2px;
    text-decoration-color:var(--hilo-accent);text-underline-offset:3px}
  .hilo-aviso{align-self:center;max-width:92%;padding:6px 12px;border-radius:12px;
    background:var(--hilo-bubble);color:var(--hilo-muted);font-size:12.5px;
    line-height:1.4;text-align:center;animation:hilo-entra .32s ease-out both}
  @keyframes hilo-entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

  /* Los tres puntos: una ola, no un parpadeo. */
  .hilo-typing{display:flex;align-items:center;gap:5px;height:26px;padding-left:2px}
  .hilo-typing i{width:7px;height:7px;border-radius:50%;background:var(--hilo-accent);
    animation:hilo-ola 1.3s ease-in-out infinite}
  .hilo-typing i:nth-child(2){animation-delay:.16s}
  .hilo-typing i:nth-child(3){animation-delay:.32s}
  @keyframes hilo-ola{0%,60%,100%{transform:translateY(0);opacity:.35}
    30%{transform:translateY(-5px);opacity:1}}

  .hilo-sug{display:flex;flex-direction:column;align-items:flex-start;gap:6px;
    padding-left:36px;margin-top:-4px}
  .hilo-sug-b{display:inline-flex;align-items:center;gap:8px;min-height:36px;
    padding:7px 13px;border:1px solid var(--hilo-line);border-radius:12px;
    background:var(--hilo-bg);color:var(--hilo-fg);font:inherit;font-size:13.5px;
    line-height:1.3;text-align:left;cursor:pointer;
    animation:hilo-entra .32s cubic-bezier(.2,.8,.2,1) both;
    transition:border-color .15s,background .15s,transform .15s}
  .hilo-sug-b::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;
    background:var(--hilo-accent)}
  .hilo-sug-b:hover{border-color:var(--hilo-accent);background:var(--hilo-raise)}
  .hilo-sug-b:active{transform:scale(.98)}
  .hilo-sug-b:focus-visible{outline:2px solid var(--hilo-accent);outline-offset:2px}

  .hilo-form{flex:none;margin:0;padding:6px 12px 10px}
  .hilo-caja{display:flex;align-items:flex-end;gap:8px;padding:5px 5px 5px 14px;
    border:1px solid var(--hilo-line);border-radius:18px;background:var(--hilo-raise);
    transition:border-color .15s,box-shadow .15s}
  .hilo-caja:focus-within{border-color:var(--hilo-accent);box-shadow:0 0 0 3px var(--hilo-anillo)}
  .hilo-input{flex:1;min-width:0;height:34px;max-height:132px;margin:0;padding:6px 0;
    border:0;outline:0;resize:none;background:none;color:var(--hilo-fg);
    font:inherit;line-height:1.45;overflow-y:auto}
  .hilo-input::placeholder{color:var(--hilo-muted);opacity:1}
  .hilo-send{flex:none;width:34px;height:34px;padding:0;border:0;border-radius:50%;
    display:grid;place-items:center;background:var(--hilo-accent);color:var(--hilo-accent-fg);
    cursor:pointer;transition:transform .15s,background .15s,color .15s}
  .hilo-send svg{width:18px;height:18px;display:block}
  .hilo-send:hover:not(:disabled){transform:scale(1.06)}
  .hilo-send:active:not(:disabled){transform:scale(.94)}
  .hilo-send:disabled{background:var(--hilo-line);color:var(--hilo-muted);cursor:default}
  .hilo-send:focus-visible{outline:2px solid var(--hilo-accent);outline-offset:2px}
  .hilo-pie{margin:7px 0 0;font-size:11px;line-height:1.3;color:var(--hilo-muted);
    text-align:center}

  /* Incrustado: ocupa la caja que le da la página. El !important le gana al
     bottom en línea que le pone el ícono campana; con position:relative ese
     bottom lo correría hacia arriba. border-box: con width:100% y el borde,
     en una página sin box-sizing global el panel se pasaba 2 px de su caja
     (medido en la demo del café, 09/10/2026). */
  .hilo-panel[data-modo="incrustado"]{position:relative;inset:auto!important;z-index:auto;
    width:100%;height:100%;box-shadow:none;box-sizing:border-box}
  .hilo-panel[data-modo="incrustado"] .hilo-close{display:none}
  /* En el teléfono, flotante, ocupa la pantalla: un panel de 390 px en una
     de 375 deja dos tiras de página que no se pueden tocar. 16 px en el
     campo para que iOS no haga zoom al enfocarlo. */
  @media (max-width:520px){
    .hilo-panel:not([data-modo="incrustado"]){inset:0!important;width:100%;height:100%;
      height:100dvh;border:0;border-radius:0}
    .hilo-input{font-size:16px}}

  :root{--hilo-accent:${ACCENT};--hilo-accent-fg:${ACCENT_FG}}
  .hilo-panel{--hilo-bg:#fff;--hilo-fg:#1a1b1f;--hilo-muted:#6b6e78;--hilo-line:#e6e6e9;
    --hilo-bubble:#f2f1ee;--hilo-raise:#fafaf9;--hilo-ok:#1f9d55;
    --hilo-ok-halo:rgba(31,157,85,.16);--hilo-anillo:${hexAlfa(ACCENT, 0.2)}}
  .hilo-panel[data-tema="oscuro"]{--hilo-bg:#18191c;--hilo-fg:#ececee;--hilo-muted:#9b9ea8;
    --hilo-line:#2e2f35;--hilo-bubble:#26272c;--hilo-raise:#1f2024;--hilo-ok:#3ccf7a;
    --hilo-ok-halo:rgba(60,207,122,.16);--hilo-anillo:${hexAlfa(ACCENT, 0.28)}}
  @media (prefers-reduced-motion:reduce){
    .hilo-launcher{transition:none}.hilo-typing i{animation:none;opacity:.6}
    .hilo-row,.hilo-aviso,.hilo-sug-b{animation:none}
    .hilo-panel[data-open="true"],.hilo-panel[data-open="true"] .hilo-panel-cont{animation:none}}
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

  // El avatar del agente: la campanita si el sitio la eligió como lanzador,
  // si no, el mismo globo de diálogo del lanzador estándar.
  var AVATAR = '<span class="hilo-av" aria-hidden="true">' + (ICON === "campana"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v1.6"/>' +
      '<path d="M6.6 16.5 7.4 10a4.6 4.6 0 0 1 9.2 0l.8 6.5"/><path d="M4.8 16.8h14.4"/>' +
      '<circle cx="12" cy="19.6" r="1.5" fill="currentColor" stroke="none"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9' +
      ' 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>') +
    "</span>";
  var SVG = ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

  var panel = document.createElement("div");
  panel.className = "hilo-panel";
  panel.setAttribute("data-open", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", TITLE);
  panel.innerHTML =
    '<div class="hilo-panel-cont">' +
    '<div class="hilo-head">' + AVATAR +
    '<div class="hilo-head-txt"><span class="hilo-title"></span>' +
    '<span class="hilo-estado">Responde al instante</span></div>' +
    '<button class="hilo-icon-b hilo-reset" type="button" title="Conversación nueva"' +
    ' aria-label="Empezar una conversación nueva"><svg' + SVG + '>' +
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>' +
    '<button class="hilo-icon-b hilo-close" type="button" title="Cerrar"' +
    ' aria-label="Cerrar el chat"><svg' + SVG + '><path d="M18 6 6 18M6 6l12 12"/></svg>' +
    "</button></div>" +
    '<div class="hilo-log" role="log" aria-live="polite" aria-atomic="false"></div>' +
    '<form class="hilo-form"><div class="hilo-caja">' +
    '<textarea class="hilo-input" rows="1" autocomplete="off" aria-label="Mensaje"></textarea>' +
    '<button class="hilo-send" type="submit" aria-label="Enviar" disabled><svg' + SVG +
    '><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button></div>' +
    '<p class="hilo-pie">Te contesta una IA: puede equivocarse.</p>' +
    "</form></div>";

  panel.querySelector(".hilo-title").textContent = TITLE;
  panel.querySelector(".hilo-input").placeholder = PLACEHOLDER;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  function temaOscuro() {
    var html = document.documentElement;
    var marca = html.getAttribute("data-theme");
    if (html.classList.contains("dark") || marca === "dark") return true;
    if (TEMA === "clase") return false;
    if (html.classList.contains("light") || marca === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function aplicarTema() {
    panel.setAttribute("data-tema", temaOscuro() ? "oscuro" : "claro");
  }
  aplicarTema();
  new MutationObserver(aplicarTema).observe(document.documentElement,
    { attributes: true, attributeFilter: ["class", "data-theme"] });
  if (TEMA === "auto" && window.matchMedia) {
    var sistema = window.matchMedia("(prefers-color-scheme: dark)");
    if (sistema.addEventListener) sistema.addEventListener("change", aplicarTema);
    else if (sistema.addListener) sistema.addListener(aplicarTema);
  }

  // La página puede pedir que el lanzador se corra un rato: poniendo
  // data-hilo-lanzador="oculto" en <html> (el sitio de Milagros lo hace
  // mientras corre la animación de la campana, que ocupa la misma esquina).
  // Sin ese atributo no cambia nada. Con el chat abierto nunca se esconde,
  // salvo que el panel esté incrustado en la página: ahí el lanzador sobra.
  var incrustado = false;
  function sincronizarOculto() {
    var pide = document.documentElement.getAttribute("data-hilo-lanzador") === "oculto";
    var abierto = panel.getAttribute("data-open") === "true";
    launcher.setAttribute("data-oculto", (pide && !abierto) || incrustado ? "true" : "false");
  }
  new MutationObserver(sincronizarOculto).observe(document.documentElement,
    { attributes: true, attributeFilter: ["data-hilo-lanzador"] });
  new MutationObserver(sincronizarOculto).observe(panel,
    { attributes: true, attributeFilter: ["data-open"] });
  sincronizarOculto();

  // ── ícono opcional: la mascota-campana en vez de la burbuja ──────────────
  // El badajo de fuego de la tarjeta Hilo (cv/tarjeta hilo/generar.py): la
  // campana es el sombrerito y el fuego es la cara. Mismos trazos de campana,
  // mismo ruido y mismo pulso de vela que la animación del sitio
  // (components/campana/geometria.ts), portados sin dependencias porque este
  // archivo es el que se le entrega a cada cliente tal cual. Sin placa ni
  // fondo: la animación va directo sobre la página. Por eso la tinta toma el
  // color del texto del sitio (oscura en claro, clara en oscuro) y el brillo
  // se mezcla normal: en modo "screen" sobre un fondo claro desaparece, el
  // mismo motivo por el que la vela de la portada tampoco lo usa.
  if (ICON === "campana") {
    (function (launcher, panel) {
      var TAU = Math.PI * 2;
      var lim = function (v, a, b) { return v < a ? a : v > b ? b : v; };
      var mez = function (a, b, t) { return a + (b - a) * t; };
      var suavizar = function (t) { return t * t * (3 - 2 * t); };

      // Coordenadas de la tarjeta (508×587). La placa recorta la zona de la
      // campana y la cara, con la misma proporción que el recorte de la tarjeta.
      var VB = [160, 32, 188, 250];
      var ANCHO = 60, ALTO = Math.round(ANCHO * VB[3] / VB[2]);
      var ABAJO = 20;   // misma altura que la burbuja estándar

      launcher.style.background = "none";
      launcher.style.borderRadius = "0";
      launcher.style.boxShadow = "none";
      launcher.style.width = ANCHO + "px";
      launcher.style.height = ALTO + "px";
      launcher.style.bottom = ABAJO + "px";
      launcher.style.filter = "none";
      // El panel se apoya en la altura real del lanzador: si cambia, se acomoda solo.
      panel.style.bottom = (ABAJO + ALTO + 14) + "px";

      var NS = "http://www.w3.org/2000/svg";
      function crear(tag, attrs, padre) {
        var e = document.createElementNS(NS, tag);
        for (var k in attrs) e.setAttribute(k, attrs[k]);
        padre.appendChild(e);
        return e;
      }
      function radial(id, stops) {
        return '<radialGradient id="' + id + '">' + stops.map(function (s) {
          return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '" stop-opacity="' + s[2] + '"/>';
        }).join("") + "</radialGradient>";
      }

      launcher.innerHTML =
        '<svg viewBox="' + VB.join(" ") + '" width="' + ANCHO + '" height="' + ALTO + '"' +
        ' preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="display:block;overflow:visible">' +
        "<defs>" +
        radial("hf-velo", [[0, "#eeac28", .34], [.5, "#eaa70b", .1], [1, "#eaa70b", 0]]) +
        radial("hf-nucleo", [[0, "#ffeeba", .85], [.22, "#face58", .55], [.55, "#e8a616", .2], [1, "#e29e0a", 0]]) +
        radial("hf-cuerpo", [[0, "#fff3cf", 1], [.55, "#ffd978", .96], [.8, "#f4b73a", .55], [1, "#eaa70b", 0]]) +
        radial("hf-corazon", [[0, "#fffbe8", 1], [.35, "#fff0c0", .8], [.7, "#f7c53a", .35], [1, "#eaa70b", 0]]) +
        radial("hf-sombrero", [[0, "#ffd98a", .55], [1, "#eaa70b", 0]]) +
        "</defs>" +
        '<g id="hf-badajo"></g><g id="hf-campana"></g>' +
        "</svg>";

      var svg = launcher.querySelector("svg");
      var gBadajo = svg.querySelector("#hf-badajo");
      var gCampana = svg.querySelector("#hf-campana");

      // -- la escena, en las mismas medidas que la tarjeta --
      var ESC = 0.34, TX = 254 - 507 * ESC, TY = 40 - 210 * ESC;
      var BOCA = [506 * ESC + TX, 622 * ESC + TY];
      var CARA = [BOCA[0], BOCA[1] + 44];
      var BASE = 58;



      // -- el fuego: velo, cinco núcleos que derivan, cuerpo denso y corazón --
      var pantalla = {};
      function circ(fill, extra) {
        var a = { cx: CARA[0], cy: CARA[1], r: 1, fill: "url(#" + fill + ")" };
        for (var k in extra) a[k] = extra[k];
        return crear("circle", a, gBadajo);
      }
      var velo = circ("hf-velo", pantalla);
      var nucleos = [];
      for (var n = 0; n < 5; n++) nucleos.push(circ("hf-nucleo", pantalla));
      var cuerpo = circ("hf-cuerpo", {});
      var corazon = circ("hf-corazon", pantalla);

      // -- los ojos: brasas oscuras, un poco ladeadas; miran y parpadean --
      var gOjos = crear("g", {}, gBadajo);
      var ojos = [-1, 1].map(function (s) {
        var cx = CARA[0] + s * 17, cy = CARA[1] - 2;
        var g = crear("g", { transform: "translate(" + cx + " " + cy + ")" }, gOjos);
        var e = crear("ellipse", { cx: 0, cy: 0, rx: 6.6, ry: 9.4, fill: "#3b1a04",
          transform: "rotate(" + (s * -8) + ")" }, g);
        return { g: g, e: e, cx: cx, cy: cy };
      });

      // -- el sombrerito: el mismo contorno de components/campana, en tinta cálida --
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
      var luzSombrero = crear("ellipse", { cx: BOCA[0], cy: BOCA[1] - 30, rx: 58, ry: 52,
        fill: "url(#hf-sombrero)" }, gCampana);
      var gTrazos = crear("g", { transform: "translate(" + TX + " " + TY + ") scale(" + ESC + ")" }, gCampana);
      CAMPANA.forEach(function (t) {
        crear("path", { d: t.d, fill: "none", stroke: "currentColor",
          "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": t.w }, gTrazos);
      });

      // La tinta es el color del texto de la página, y se vuelve a leer si el sitio cambia de tema.
      function tomarTinta() { launcher.style.color = getComputedStyle(document.body).color; }
      tomarTinta();
      new MutationObserver(tomarTinta).observe(document.documentElement,
        { attributes: true, attributeFilter: ["class", "data-theme", "style"] });

      // -- ruido y vela: los del sitio, con la misma tabla --
      var RED = (function () {
        var s = 0x2f6e2b1, out = [];
        for (var i = 0; i < 256; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out.push(s / 0x7fffffff); }
        return out;
      })();
      function ruido(x) {
        var i0 = Math.floor(x), f = suavizar(x - i0);
        return mez(RED[i0 & 255], RED[(i0 + 1) & 255], f);
      }
      function vela(ms) {
        var t = ms / 1000;
        var v = 0.72 + 0.16 * Math.sin(t * 2.1 * TAU) + 0.09 * Math.sin(t * 5.3 * TAU + 1.7) +
          0.05 * Math.sin(t * 11.7 * TAU + 4.1);
        var r = ruido(t * 1.1);
        if (r > 0.74) v -= (r - 0.74) * 2.2;
        return lim(v, 0.14, 1);
      }

      // -- mirada: el puntero si es mouse y se movió hace poco; si no, un barrido propio --
      var gx = 0, gy = 0, objX = 0, objY = 0, apuntando = false, ultimoMouse = -1e9;
      function puntoEnPantalla(x, y) {
        var m = svg.getScreenCTM();
        return m ? new DOMPoint(x, y).matrixTransform(m) : { x: x, y: y };
      }
      window.addEventListener("pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        var c = puntoEnPantalla(CARA[0], CARA[1]);
        var dx = e.clientX - c.x, dy = e.clientY - c.y;
        var d = Math.hypot(dx, dy) || 1, mag = Math.tanh(d / 220);
        objX = (dx / d) * mag; objY = (dy / d) * mag * .6;
        apuntando = true; ultimoMouse = performance.now();
      }, { passive: true });

      var quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var proximoParpadeo = 2600, parpadeoDesde = -1;

      function pintar(ms) {
        var t = ms / 1000;
        var luz = vela(ms);
        // un destello de vez en cuando: el fuego se aviva un instante
        var rr0 = ruido(t * .5), guino = rr0 > .88 ? (rr0 - .88) / .12 : 0;
        var r = BASE * mez(0.93, 1.07, luz) * (1 + guino * .1);

        velo.setAttribute("r", (r * 1.9).toFixed(1));
        velo.setAttribute("opacity", mez(.75, 1, luz).toFixed(3));
        for (var i = 0; i < 5; i++) {
          var giro = ruido(ms / (1300 + i * 290) + i * 9.7) * TAU;
          var lejos = r * 0.4 * ruido(ms / (940 + i * 210) + i * 4.1);
          var rr = r * mez(0.5, 1.05, ruido(ms / (780 + i * 160) + i * 2.3));
          nucleos[i].setAttribute("cx", (CARA[0] + Math.cos(giro) * lejos).toFixed(1));
          nucleos[i].setAttribute("cy", (CARA[1] + Math.sin(giro) * lejos * 1.25 - r * 0.1).toFixed(1));
          nucleos[i].setAttribute("r", Math.max(rr, 1).toFixed(1));
        }
        cuerpo.setAttribute("r", (r * 0.78).toFixed(1));
        corazon.setAttribute("r", (r * 0.62).toFixed(1));
        corazon.setAttribute("opacity", lim(mez(.8, 1, luz) + guino * .3, 0, 1).toFixed(3));
        luzSombrero.setAttribute("opacity", mez(.7, 1, luz).toFixed(3));

        // se mece colgado de la boca, como el badajo del sitio
        var meceo = quieto ? 0 : Math.sin(t * 1.15) * 2.1;
        gBadajo.setAttribute("transform", "rotate(" + meceo.toFixed(2) + " " + BOCA[0].toFixed(1) + " " + BOCA[1].toFixed(1) + ")");

        // mirada
        var tx, ty;
        if (!quieto && apuntando && ms - ultimoMouse < 3500) { tx = objX; ty = objY; }
        else { tx = quieto ? 0 : Math.sin((t / 4.4) * TAU) * .8; ty = quieto ? 0 : .2 * Math.sin((t / 4.4) * TAU * 1.7 + 1.1); apuntando = false; }
        var inercia = quieto ? 1 : .085;
        gx += (tx - gx) * inercia; gy += (ty - gy) * inercia;

        // parpadeo: cada 3 a 6 segundos, 150 ms
        var cierre = 1;
        if (!quieto) {
          if (parpadeoDesde < 0 && ms > proximoParpadeo) parpadeoDesde = ms;
          if (parpadeoDesde >= 0) {
            var p = (ms - parpadeoDesde) / 150;
            if (p >= 1) { parpadeoDesde = -1; proximoParpadeo = ms + 3000 + ruido(t) * 3000; }
            else cierre = 1 - Math.sin(p * Math.PI) * .9;
          }
        }
        ojos.forEach(function (o) {
          o.g.setAttribute("transform", "translate(" + (o.cx + gx * 4.5).toFixed(2) + " " +
            (o.cy + gy * 3).toFixed(2) + ") scale(1 " + cierre.toFixed(3) + ")");
        });
      }

      if (quieto) { pintar(1300); return; }
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

  // ── la nube que arma el panel ──────────────────────────────────────────
  // Hasta el 29/10/2026 este módulo también dibujaba un contorno de
  // partículas alrededor de cada burbuja y del botón Enviar, con un cuadro
  // por frame mientras el chat estuviera abierto. Con el panel nuevo (el
  // agente sin burbuja, enviar redondo) ese contorno no tenía dónde ir y se
  // fue; queda la apertura, que es la firma: el panel sale de la campana.
  var nube = (function () {
    var TAU = Math.PI * 2;
    var cl = function (x, a, b) { return x < a ? a : x > b ? b : x; };
    // Las dos curvas del motor real (particulas-transmutacion.tsx): sm es la
    // meseta suave para las mezclas de opacidad, e3 es el acomodado -entra
    // rápido, se asienta despacio- para todo lo que converge en el lugar.
    var sm = function (a, b, x) { var t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    var e3 = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    var reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var canvasPanel = document.createElement("canvas");
    canvasPanel.className = "hilo-panel-c";
    panel.appendChild(canvasPanel);

    // ── la tarjeta se arma con el MISMO motor que particulas-transmutacion.tsx
    // (la pieza de /servicios/landing), no una imitación en ctx.arc(): cada
    // partícula es un píxel crudo escrito a mano en un ImageData fuera de
    // pantalla, sumado -no pintado- sobre los vecinos, con el mismo motion
    // blur por sub-pasos y el mismo lienzo que nunca se limpia del todo (una
    // estela oscura se pinta encima cada cuadro). Es lo único que hace que
    // miles de partículas salgan gratis y que la nube lea como polvo denso y
    // no como puntos sueltos. Lo que SÍ es nuevo -no existe en la pieza
    // real, que siempre viaja de una silueta a la otra- es que acá las
    // partículas nacen en la campana y viajan en espiral hasta rellenar la
    // silueta del panel: un campo de velocidad propio sobre la misma técnica
    // de pintado.
    function relleno(w, h, r, n) {
      var cols = Math.max(1, Math.ceil(Math.sqrt(n * (w / h))));
      var rows = Math.max(1, Math.ceil(n / cols));
      var cw = w / cols, ch = h / rows, pts = [];
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var x = (i + 0.5) * cw + (Math.random() - 0.5) * cw * 0.9;
          var y = (j + 0.5) * ch + (Math.random() - 0.5) * ch * 0.9;
          var qx = Math.max(Math.abs(x - w / 2) - (w / 2 - r), 0);
          var qy = Math.max(Math.abs(y - h / 2) - (h / 2 - r), 0);
          if (qx * qx + qy * qy <= r * r) pts.push([x, y]);
        }
      }
      return pts;
    }
    function mez(a, b, t) { return a + (b - a) * t; }
    function hexRGB(hex) {
      var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || "");
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [240, 180, 28];
    }

    var apertura = null; // datos de la nube mientras arma; null en reposo
    function armar() {
      if (reducido) { apertura = null; return; }
      var rectPanel = panel.getBoundingClientRect();
      if (rectPanel.width < 1 || rectPanel.height < 1) { apertura = null; return; }

      // Buffer en píxeles de dispositivo, no en los px CSS que usan los otros
      // canvas: acá se escribe directo al array de la imagen, así que el
      // tamaño real del lienzo importa, no una transformación por cuadro.
      var esc = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = Math.max(1, Math.round(rectPanel.width * esc));
      var h = Math.max(1, Math.round(rectPanel.height * esc));
      var tope = 500000, tot = w * h;
      if (tot > tope) { var k = Math.sqrt(tope / tot); w = Math.round(w * k); h = Math.round(h * k); }
      canvasPanel.width = w; canvasPanel.height = h;
      canvasPanel.getContext("2d").setTransform(1, 0, 0, 1, 0, 0);

      // Un solo buffer, escrito directo sobre el canvas visible con
      // putImageData: nada de globalCompositeOperation. La alfa de cada
      // píxel la decide este código, no cómo el navegador compone "lighter"
      // -que fuerza opacidad total apenas hay una sola partícula encima-.
      var ctxPanel = canvasPanel.getContext("2d");
      var imgData = ctxPanel.createImageData(w, h);
      var buf = imgData.data;
      var img32 = new Uint32Array(buf.buffer);

      var r = (parseFloat(getComputedStyle(panel).borderRadius) || 14) * esc;
      var nParticulas = Math.max(1500, Math.min(9000, Math.round((w * h) / 70)));
      var destinos = relleno(w, h, r, nParticulas);
      var n = destinos.length;

      // Origen: el centro de la campana, en el espacio del panel. Lanzador y
      // panel son hermanos position:fixed -una resta de rects alcanza-.
      var rectLanzador = launcher.getBoundingClientRect();
      var origenX = ((rectLanzador.left + rectLanzador.width * 0.5) - rectPanel.left) * esc;
      var origenY = ((rectLanzador.top + rectLanzador.height * 0.42) - rectPanel.top) * esc;

      var cx = w / 2, cy = h / 2;
      var angO = Math.atan2(origenY - cy, origenX - cx);
      var radO = Math.hypot(origenX - cx, origenY - cy);
      // Todas las partículas giran para el mismo lado y "desenrollan" el
      // mismo número de vueltas: así el conjunto se lee como un solo
      // remolino, no como cada una tomando su propio atajo.
      var dir = Math.random() < 0.5 ? -1 : 1;
      var vueltas = 1.2 + Math.random() * 0.6;

      var angD = new Float32Array(n), radD = new Float32Array(n);
      var psx = new Float32Array(n), psy = new Float32Array(n);
      var retraso = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var dx = destinos[i][0] - cx, dy = destinos[i][1] - cy;
        var a = Math.atan2(dy, dx);
        while ((a - angO) * dir < 0) a += dir * TAU;
        angD[i] = a + dir * vueltas * TAU;
        radD[i] = Math.hypot(dx, dy);
        psx[i] = origenX; psy[i] = origenY;
        retraso[i] = Math.random() * 0.15; // sale en chorro, no todas juntas
      }

      var rgb = hexRGB(ACCENT);
      apertura = {
        t0: performance.now(), w: w, h: h, cx: cx, cy: cy,
        angO: angO, radO: radO, angD: angD, radD: radD,
        psx: psx, psy: psy, retraso: retraso, n: n,
        imgData: imgData, buf: buf, img32: img32,
        r: rgb[0], g: rgb[1], b: rgb[2]
      };
    }

    function pintarApertura(ms) {
      if (!apertura) return;
      var A = apertura;
      var ctx = canvasPanel.getContext("2d");
      var u = cl((ms - A.t0) / DUR_OPEN, 0, 1);

      // Todo -la oscuridad de fondo Y las partículas- se calcula en el MISMO
      // buffer y se planta con putImageData, sin globalCompositeOperation:
      // así la alfa de cada píxel es exactamente la que dice este código, no
      // lo que "lighter" decide (que fuerza opacidad total apenas hay UNA
      // partícula encima, sin importar cuán tenue sea la curva de fondo).
      //
      // Fondo: mucho más tenue que la pieza real -acá es un widget chico de
      // esquina, no una escena de página completa- y se redibuja entero cada
      // cuadro (no se acumula sobre el anterior), así el tope real es 0.5.
      var alfaFondo = Math.round(255 * 0.50 * sm(0, 0.12, u) * (1 - sm(0.42, 1, u)));
      var base = ((alfaFondo << 24) | (15 << 16) | (9 << 8) | 8) >>> 0;
      A.img32.fill(base);

      // El polvo se queda MUCHO más tiempo que antes -su cola se estira hasta
      // el final- y su color migra de ámbar a blanco a medida que se asienta:
      // así lo último que se ve del polvo ya es del mismo color que la
      // tarjeta que queda debajo, y no hay un corte entre "nube" y "sólido".
      // Esto es lo que hace que la tarjeta misma se sienta como la animación,
      // no una animación que termina y una tarjeta que aparece después.
      var intensidad = sm(0, 0.08, u) * (1 - sm(0.86, 1, u));
      if (intensidad > 0.002) {
        var ganancia = 9 * intensidad;
        var blanquear = sm(0.45, 0.95, u);
        var pr = mez(A.r, 255, blanquear), pg = mez(A.g, 255, blanquear), pb = mez(A.b, 255, blanquear);
        for (var i = 0; i < A.n; i++) {
          var ui = cl((u - A.retraso[i]) / (1 - A.retraso[i]), 0, 1);
          var ei = e3(ui);
          var ang = A.angO + (A.angD[i] - A.angO) * ei;
          var rad = A.radO + (A.radD[i] - A.radO) * ei;
          var sx = A.cx + Math.cos(ang) * rad;
          var sy = A.cy + Math.sin(ang) * rad;

          // Motion blur real: si se movió poco este cuadro, un paso alcanza;
          // si voló, se reparte en varios sub-pasos a lo largo del tramo, y
          // eso es lo que convierte un punto en una voluta, no un filtro.
          var dxs = sx - A.psx[i], dys = sy - A.psy[i];
          var dd = Math.abs(dxs) + Math.abs(dys);
          var pasos = dd < 220 ? Math.min(6, 1 + ((dd * 0.55) | 0)) : 1;
          var inv = ganancia / pasos;
          var rr = pr * inv, gg = pg * inv, bb = pb * inv;
          for (var q = 0; q < pasos; q++) {
            var f = (q + 1) / pasos;
            var X = (A.psx[i] + dxs * f) | 0, Y = (A.psy[i] + dys * f) | 0;
            if (X >= 0 && X < A.w && Y >= 0 && Y < A.h) {
              var o = (Y * A.w + X) << 2;
              A.buf[o] += rr; A.buf[o + 1] += gg; A.buf[o + 2] += bb;
              A.buf[o + 3] = 255; // donde toca una partícula, opaco del todo
            }
          }
          A.psx[i] = sx; A.psy[i] = sy;
        }
      }
      ctx.putImageData(A.imgData, 0, 0);

      if (u >= 1) {
        apertura = null;
        ctx.clearRect(0, 0, canvasPanel.width, canvasPanel.height);
      }
    }

    // El lazo corre sólo mientras la nube arma: en reposo, cero cuadros.
    var corriendo = false, cuadro = null;
    function frame(ms) {
      if (!corriendo) return;
      pintarApertura(ms);
      if (!apertura) { corriendo = false; cuadro = null; return; }
      cuadro = requestAnimationFrame(frame);
    }
    function iniciar() {
      if (corriendo || !apertura) return;
      corriendo = true;
      cuadro = requestAnimationFrame(frame);
    }
    function detener() {
      corriendo = false;
      if (cuadro) cancelAnimationFrame(cuadro);
      cuadro = null;
    }

    return { iniciar: iniciar, detener: detener, armar: armar };
  })();

  // ── conversation ────────────────────────────────────────────────────────

  var session = null;
  var sesionEnCurso = null;
  var pollTimer = null;
  var typing = null;
  var charlo = false;
  try {
    charlo = sessionStorage.getItem(CHARLO_KEY) === "1";
  } catch (error) {
    charlo = false;
  }

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

  function bajar() {
    log.scrollTop = log.scrollHeight;
  }

  // Las direcciones que manda el agente se pueden tocar. Se arma con nodos y
  // textContent, nunca con innerHTML: el texto viene de un modelo, y un
  // modelo al que le hicieron decir "<img onerror>" no tiene que poder correr
  // nada acá. Sólo http y https; la puntuación del final queda afuera.
  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  function pintarTexto(nodo, texto) {
    var desde = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(texto))) {
      var url = m[0].replace(/[.,;:!?)»]+$/, "");
      if (m.index > desde) nodo.appendChild(document.createTextNode(texto.slice(desde, m.index)));
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = url;
      nodo.appendChild(a);
      desde = m.index + url.length;
      URL_RE.lastIndex = desde;
    }
    if (desde < texto.length) nodo.appendChild(document.createTextNode(texto.slice(desde)));
  }

  // Una fila del agente lleva su avatar; si sigue a otra del agente, el
  // avatar queda oculto y la fila se acerca: se leen como un solo turno.
  function fila(from) {
    var row = document.createElement("div");
    row.className = "hilo-row";
    row.setAttribute("data-from", from);
    if (from === "agent") {
      var previa = log.lastElementChild;
      if (previa && previa.classList.contains("hilo-row") &&
          previa.getAttribute("data-from") === "agent") {
        row.setAttribute("data-seguido", "");
      }
      row.innerHTML = AVATAR;
    }
    return row;
  }

  function bubble(from, text) {
    if (from === "system") {
      var aviso = document.createElement("div");
      aviso.className = "hilo-aviso";
      aviso.textContent = text;
      log.appendChild(aviso);
      bajar();
      return aviso;
    }
    var row = fila(from);
    var node = document.createElement("div");
    node.className = "hilo-msg";
    if (from === "agent") pintarTexto(node, text);
    else node.textContent = text;
    row.appendChild(node);
    log.appendChild(row);
    bajar();
    return row;
  }

  // Los tres puntos van en la fila del agente, con su avatar, en el lugar
  // exacto donde va a aparecer la respuesta.
  function showTyping() {
    if (typing) return;
    typing = fila("agent");
    var puntos = document.createElement("div");
    puntos.className = "hilo-typing";
    puntos.setAttribute("role", "status");
    puntos.setAttribute("aria-label", "Escribiendo");
    puntos.innerHTML = "<i></i><i></i><i></i>";
    typing.appendChild(puntos);
    log.appendChild(typing);
    bajar();
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

    // Un solo pedido a la vez: con el saludo al instante, el visitante puede
    // tocar una sugerencia antes de que vuelva el primero, y sin esto salían
    // dos sesiones para la misma pestaña.
    if (sesionEnCurso) return sesionEnCurso;
    sesionEnCurso = post("/channels/web/session").then(function (data) {
      sesionEnCurso = null;
      session = data.session_id;
      try {
        sessionStorage.setItem(STORAGE_KEY, session);
      } catch (error) {
        /* nothing to do; the id lives in memory for this page */
      }
      return session;
    }, function (error) {
      sesionEnCurso = null;
      throw error;
    });
    return sesionEnCurso;
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

  var lastActivity = Date.now();

  function abierto() {
    return panel.getAttribute("data-open") === "true";
  }

  // Un solo intervalo (siempre se corta el anterior), y sólo si hay algo que
  // esperar: con el panel incrustado, cada visita a la página lo tendría
  // abierto, y sondear una sesión donde nadie escribió eran ~240 pedidos por
  // visitante para nada.
  function startPolling() {
    stopPolling();
    if (!charlo) return;
    lastActivity = Date.now();
    pollTimer = setInterval(function () {
      if (document.hidden || !abierto() || Date.now() - lastActivity > POLL_IDLE_MS) {
        stopPolling();
        return;
      }
      collect();
    }, POLL_OPEN_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && session && charlo && abierto()) {
      collect();
      startPolling();
    }
  });

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ── saludo y sugerencias ────────────────────────────────────────────────
  // El saludo se dibuja apenas se abre, sin esperar al servidor. Antes iba
  // adentro del .then de la sesión y, además, preguntaba por
  // log.childElementCount: el log tenía adentro el canvas del contorno, así
  // que esa cuenta nunca daba cero y el saludo no salía nunca.
  var saludado = false;
  var sugerencias = null;

  function saludar() {
    if (saludado) return;
    saludado = true;
    if (GREETING) bubble("agent", GREETING);
    if (SUGERENCIAS.length && !charlo) mostrarSugerencias();
  }

  function mostrarSugerencias() {
    sugerencias = document.createElement("div");
    sugerencias.className = "hilo-sug";
    sugerencias.setAttribute("role", "group");
    sugerencias.setAttribute("aria-label", "Preguntas sugeridas");
    SUGERENCIAS.forEach(function (texto, i) {
      var boton = document.createElement("button");
      boton.type = "button";
      boton.className = "hilo-sug-b";
      boton.textContent = texto;
      // Entran de a una, un poco después del saludo.
      boton.style.animationDelay = (120 + i * 60) + "ms";
      boton.addEventListener("click", function () {
        // El botón desaparece al mandar: el foco pasa al campo, no al vacío.
        input.focus();
        enviar(texto);
      });
      sugerencias.appendChild(boton);
    });
    log.appendChild(sugerencias);
    bajar();
  }

  function quitarSugerencias() {
    if (sugerencias) {
      sugerencias.remove();
      sugerencias = null;
    }
  }

  // El aviso de que no se pudo abrir va debajo del saludo, una sola vez, y
  // se va solo si un intento siguiente sale bien.
  var avisoApertura = null;

  // El punto verde dice «Responde al instante» sólo si el servidor contestó;
  // si no se pudo abrir la sesión, pasa a gris y lo dice.
  var estado = panel.querySelector(".hilo-estado");
  function marcarEstado(anda) {
    if (anda) estado.removeAttribute("data-caido");
    else estado.setAttribute("data-caido", "");
    estado.textContent = anda ? "Responde al instante" : "Sin conexión";
  }

  function open(enfocar) {
    var yaAbierto = abierto();
    panel.setAttribute("data-open", "true");
    launcher.setAttribute("aria-expanded", "true");
    launcher.setAttribute("aria-label", "Cerrar el chat");
    // La nube de partículas sale de la campana: incrustado, la campana no está.
    if (!yaAbierto && !incrustado) nube.armar();
    nube.iniciar();
    saludar();
    if (enfocar) input.focus();

    ensureSession()
      .then(function () {
        marcarEstado(true);
        if (avisoApertura) {
          avisoApertura.remove();
          avisoApertura = null;
        }
        // Puede volver después de un soltar(): cerrado no se sondea.
        if (abierto()) startPolling();
      })
      .catch(function () {
        marcarEstado(false);
        if (avisoApertura && avisoApertura.isConnected) return;
        avisoApertura = bubble("system", "No pudimos abrir el chat. Probá de nuevo en un momento.");
      });
  }

  function close(devolverFoco) {
    panel.setAttribute("data-open", "false");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Abrir el chat");
    stopPolling();
    nube.detener();
    if (devolverFoco) launcher.focus();
  }

  launcher.addEventListener("click", function () {
    if (abierto()) close(true);
    else open(true);
  });

  panel.querySelector(".hilo-close").addEventListener("click", function () {
    close(true);
  });

  // Conversación nueva: se olvida la sesión (el servidor da otra, sin
  // llamar al modelo), se vacía el historial y vuelven el saludo y las
  // sugerencias. Una respuesta de la sesión vieja que llegue tarde no
  // aparece: el sondeo pregunta por la sesión nueva.
  panel.querySelector(".hilo-reset").addEventListener("click", function () {
    stopPolling();
    hideTyping();
    forgetSession();
    charlo = false;
    try {
      sessionStorage.removeItem(CHARLO_KEY);
    } catch (error) {
      /* nothing to do */
    }
    sugerencias = null;
    avisoApertura = null;
    log.textContent = "";
    saludado = false;
    open(true);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && abierto() && !incrustado) close(true);
  });

  // Fuera de pantalla (incrustado más abajo en la página, o la pestaña en
  // otro lado) la nube de la apertura no pinta.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entradas) {
      if (entradas[0].isIntersecting && abierto()) nube.iniciar();
      else nube.detener();
    }).observe(panel);
  }

  function enviar(text) {
    text = (text || "").trim();
    if (!text) return;

    quitarSugerencias();
    if (!charlo) {
      charlo = true;
      try {
        sessionStorage.setItem(CHARLO_KEY, "1");
      } catch (error) {
        /* queda en memoria para esta página */
      }
    }

    enviando = true;
    actualizarEnviar();
    bubble("user", text);
    showTyping();

    if (!pollTimer) startPolling();
    lastActivity = Date.now();

    sendMessage(text, true).finally(function () {
      enviando = false;
      actualizarEnviar();
      input.focus();
    });
  }

  // La flecha se prende cuando hay algo escrito y no hay un envío en curso.
  // Con el <input> de antes, el botón deshabilitado frenaba también el Enter;
  // con el textarea el Enter lo maneja este código, así que mira lo mismo.
  var enviando = false;
  function actualizarEnviar() {
    sendButton.disabled = enviando || !input.value.trim();
  }

  // La caja crece con el texto hasta ~5 renglones; después scrollea adentro.
  function ajustarAlto() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 132) + "px";
  }

  input.addEventListener("input", function () {
    ajustarAlto();
    actualizarEnviar();
  });

  // Enter manda, Shift+Enter baja de renglón. isComposing: con un teclado
  // que compone (japonés, chino, acentos en algunos sistemas) el Enter
  // confirma la letra, no el mensaje.
  input.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (sendButton.disabled) return;
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { cancelable: true }));
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || enviando) return;
    input.value = "";
    ajustarAlto();
    enviar(text);
  });

  // ── incrustado ──────────────────────────────────────────────────────────
  // Se mueve el mismo nodo, no se arma otro: la sesión, el historial y el
  // único intervalo de sondeo siguen siendo los mismos.
  var vigia = null;

  function incrustar(elemento) {
    if (!elemento || elemento.nodeType !== 1) return false;
    if (incrustado && panel.parentNode === elemento) return true;
    incrustado = true;
    panel.setAttribute("data-modo", "incrustado");
    panel.setAttribute("role", "region");
    elemento.appendChild(panel);
    sincronizarOculto();
    // Una página que navega del lado del cliente puede tirar el contenedor
    // sin avisar. Mientras dure, se mira sólo si el panel sigue en la página.
    if (!vigia && "MutationObserver" in window) {
      vigia = new MutationObserver(function () {
        if (incrustado && !panel.isConnected) soltar();
      });
      vigia.observe(document.body, { childList: true, subtree: true });
    }
    // Sin foco: robarlo al cargar movería la página y abriría el teclado.
    open(false);
    return true;
  }

  function soltar() {
    if (!incrustado) return;
    incrustado = false;
    if (vigia) {
      vigia.disconnect();
      vigia = null;
    }
    panel.removeAttribute("data-modo");
    panel.setAttribute("role", "dialog");
    document.body.appendChild(panel);
    close(false);
    sincronizarOculto();
  }

  window.hiloWidget = { incrustar: incrustar, soltar: soltar };

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
        if (error && error.status === 429) {
          bubble("system", AVISO_LIMITE);
          return;
        }
        bubble("system", "No pudimos enviar el mensaje. Probá de nuevo.");
      });
  }
})();
