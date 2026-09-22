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
  var STORAGE_KEY = "hilo.session";

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
    background:var(--hilo-accent);color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.22);
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
  .hilo-panel[data-open="true"]{display:flex}
  .hilo-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
    padding:12px 14px;background:var(--hilo-accent);color:#fff;font-weight:600}
  .hilo-close{background:none;border:0;color:#fff;font-size:22px;line-height:1;
    cursor:pointer;padding:2px 6px;border-radius:6px}
  .hilo-close:focus-visible{outline:2px solid #fff;outline-offset:1px}
  .hilo-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
  .hilo-msg{max-width:82%;padding:9px 12px;border-radius:13px;white-space:pre-wrap;
    overflow-wrap:anywhere}
  .hilo-msg[data-from="user"]{align-self:flex-end;background:var(--hilo-accent);color:#fff;
    border-bottom-right-radius:4px}
  .hilo-msg[data-from="agent"]{align-self:flex-start;background:var(--hilo-bubble);
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
  .hilo-send{padding:0 15px;border:0;border-radius:9px;background:var(--hilo-accent);
    color:#fff;font:inherit;font-weight:600;cursor:pointer}
  .hilo-send:disabled{opacity:.5;cursor:default}
  .hilo-send:focus-visible{outline:3px solid var(--hilo-accent);outline-offset:2px}
  :root{--hilo-accent:${ACCENT};--hilo-bg:#fff;--hilo-fg:#16181d;--hilo-line:#e3e5ea;
    --hilo-bubble:#f1f3f6;--hilo-muted:#6b7280}
  @media (prefers-color-scheme:dark){
    :root{--hilo-bg:#16181d;--hilo-fg:#f2f3f5;--hilo-line:#2c3039;--hilo-bubble:#23262e;
      --hilo-muted:#9aa1ad}}
  @media (prefers-reduced-motion:reduce){
    .hilo-launcher{transition:none}.hilo-typing i{animation:none;opacity:.5}}
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
  launcher.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';

  var panel = document.createElement("div");
  panel.className = "hilo-panel";
  panel.setAttribute("data-open", "false");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", TITLE);
  panel.innerHTML =
    '<div class="hilo-head"><span></span>' +
    '<button class="hilo-close" type="button" aria-label="Cerrar el chat">&times;</button></div>' +
    '<div class="hilo-log" role="log" aria-live="polite" aria-atomic="false"></div>' +
    '<form class="hilo-form">' +
    '<label class="hilo-sr" for="hilo-input" hidden>Mensaje</label>' +
    '<input class="hilo-input" id="hilo-input" autocomplete="off" />' +
    '<button class="hilo-send" type="submit">Enviar</button>' +
    "</form>";

  panel.querySelector(".hilo-head span").textContent = TITLE;
  panel.querySelector(".hilo-input").placeholder = PLACEHOLDER;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var log = panel.querySelector(".hilo-log");
  var form = panel.querySelector(".hilo-form");
  var input = panel.querySelector(".hilo-input");
  var sendButton = panel.querySelector(".hilo-send");

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
      if (!response.ok) throw new Error("HTTP " + response.status);
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

    ensureSession()
      .then(function () {
        return post("/webhook/web", { session_id: session, text: text });
      })
      .then(function () {
        pollBurst(POLL_AFTER_SEND_TRIES);
      })
      .catch(function () {
        hideTyping();
        bubble("system", "No pudimos enviar el mensaje. Probá de nuevo.");
      })
      .finally(function () {
        sendButton.disabled = false;
        input.focus();
      });
  });
})();
