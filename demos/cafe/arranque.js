/**
 * Arranque del chat del café (public/demos/cafe/chat.html).
 *
 * Dos cosas, y nada más:
 *
 * 1. Incrusta el panel del widget en #chat, siempre abierto y sin lanzador.
 * 2. Llena el cuadro «Esto es lo que le llega a tu recepción» con los avisos
 *    de ESTA sesión (POST /cafe/channels/web/avisos, ítem 78 de Hilo).
 *
 * El cuadro no consulta solo cada tantos segundos. Pide UNA vez, un rato
 * después de cada respuesta del agente (el aviso se arma después de mandar la
 * respuesta), o cuando el visitante toca «Ver qué le llegó a la recepción».
 * Nunca hay un intervalo: si nadie escribe, no sale ningún pedido.
 *
 * Por qué no se tocó el widget: es el archivo que se le entrega a cada cliente
 * tal cual, y esta es la única página que necesita el cuadro. Lo que se lee de
 * él es lo que ya está escrito en su encabezado: la sesión en sessionStorage,
 * con la clave "hilo.session@" + data-api, y las burbujas del agente con
 * data-from="agent". Si eso cambiara, el botón sigue andando igual.
 *
 * Sin guiones en línea a propósito: la CSP de chat.html es script-src 'self'.
 */
(function () {
  "use strict";

  var etiqueta = document.querySelector('script[src*="hilo-widget"][data-api]');
  var API = etiqueta ? (etiqueta.getAttribute("data-api") || "").replace(/\/$/, "") : "";
  var CLAVE_SESION = "hilo.session@" + API;

  // Cuánto esperar después de una respuesta para pedir los avisos. El aviso
  // se guarda cuando la respuesta ya salió; con esto, en la práctica, ya está.
  var ESPERA_TRAS_RESPUESTA_MS = 1500;
  var TIEMPO_MAXIMO_MS = 10000;

  var lista = document.getElementById("avisos");
  var estado = document.getElementById("estado");
  var boton = document.getElementById("ver");
  var caja = document.getElementById("chat");

  // ── 1. El panel ─────────────────────────────────────────────────────────
  var widget = window.hiloWidget;
  if (!widget || !caja || !widget.incrustar(caja)) {
    if (caja) {
      var falta = document.createElement("p");
      falta.className = "estado";
      falta.textContent = "El chat no cargó. Probá recargar la página.";
      caja.appendChild(falta);
    }
  }

  // ── 2. El cuadro ────────────────────────────────────────────────────────
  if (!API || !lista || !estado || !boton) return;

  function decir(texto) {
    estado.textContent = texto;
    estado.hidden = !texto;
  }

  function sesion() {
    try {
      return sessionStorage.getItem(CLAVE_SESION);
    } catch (error) {
      return null;
    }
  }

  // La hora llega en UTC (ISO). Se muestra en la del café, Buenos Aires.
  function hora(iso) {
    var fecha = new Date(iso);
    if (isNaN(fecha.getTime())) return "";
    try {
      return fecha.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Argentina/Buenos_Aires",
      });
    } catch (error) {
      return "";
    }
  }

  // Todo con textContent: el aviso trae lo que escribió el visitante, y eso
  // nunca se interpreta como HTML.
  function mostrar(avisos) {
    while (lista.firstChild) lista.removeChild(lista.firstChild);
    avisos.forEach(function (aviso) {
      if (!aviso || typeof aviso.texto !== "string") return;
      var item = document.createElement("li");
      var texto = document.createElement("p");
      texto.textContent = aviso.texto;
      item.appendChild(texto);
      var cuando = hora(aviso.hora);
      if (cuando) {
        var marca = document.createElement("time");
        marca.setAttribute("datetime", String(aviso.hora));
        marca.textContent = "Llegó a las " + cuando;
        item.appendChild(marca);
      }
      lista.appendChild(item);
    });
    decir(lista.childElementCount
      ? ""
      : "Todavía no le llegó nada. El aviso sale cuando pedís o hacés una reserva.");
  }

  var enCurso = false;

  function pedirAvisos() {
    if (enCurso) return;
    var id = sesion();
    if (!id) {
      decir("Todavía no hay conversación en esta pestaña. Escribile al café y volvé a mirar.");
      return;
    }
    enCurso = true;
    boton.disabled = true;
    decir("Mirando…");

    var control = "AbortController" in window ? new AbortController() : null;
    var corte = control ? setTimeout(function () { control.abort(); }, TIEMPO_MAXIMO_MS) : null;

    fetch(API + "/channels/web/avisos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: id }),
      signal: control ? control.signal : undefined,
    })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          var error = new Error("HTTP " + respuesta.status);
          error.status = respuesta.status;
          throw error;
        }
        return respuesta.json();
      })
      .then(function (datos) {
        mostrar(datos && Array.isArray(datos.avisos) ? datos.avisos : []);
      })
      .catch(function (error) {
        var status = error && error.status;
        if (status === 403) {
          decir("No pudimos leer los avisos de esta conversación. Si la empezaste hace más de un día, escribile de nuevo al café: arranca una nueva.");
        } else if (status === 404) {
          decir("La demo del café está apagada en este momento.");
        } else if (status === 429) {
          decir("Demasiados pedidos seguidos. Probá de nuevo en un rato.");
        } else {
          decir("No pudimos conectarnos para mirar. Probá de nuevo en un momento.");
        }
      })
      .then(function () {
        if (corte) clearTimeout(corte);
        enCurso = false;
        boton.disabled = false;
      });
  }

  boton.addEventListener("click", pedirAvisos);

  // Una vez por respuesta del agente. Si llegan varias juntas (el agente a
  // veces contesta en dos burbujas), sale un solo pedido.
  var registro = document.querySelector(".hilo-log");
  if (registro && "MutationObserver" in window) {
    var espera = null;
    new MutationObserver(function (cambios) {
      var contesto = cambios.some(function (cambio) {
        return Array.prototype.some.call(cambio.addedNodes, function (nodo) {
          return nodo.nodeType === 1 && nodo.getAttribute("data-from") === "agent";
        });
      });
      if (!contesto) return;
      clearTimeout(espera);
      espera = setTimeout(pedirAvisos, ESPERA_TRAS_RESPUESTA_MS);
    }).observe(registro, { childList: true });
  }
})();
