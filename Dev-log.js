
// ==UserScript==
// @name         Black Background + Full Activity Logger Movable & Resizable
// @namespace    https://viayoo.com/nkhej1
// @version      0.4
// @description  Fondo negro y logger total, movible y redimensionable en la parte superior de la página
// @author       You
// @run-at       document-start
// @match        https://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- Forzar fondo negro ---
    let style = document.createElement("style");
    style.innerHTML = `
        body {
            background-color: #000 !important;
            color: #fff !important;
        }
        #logger-panel {
            position: fixed;
            top: 0;
            left: 0;
            width: 400px;
            height: 200px;
            overflow-y: auto;
            background: rgba(0,0,0,0.9);
            color: #0f0;
            font-family: monospace;
            font-size: 12px;
            border: 1px solid #333;
            padding: 5px;
            z-index: 999999;
            resize: both;
            overflow: auto;
            cursor: move;
        }
        #logger-panel div {
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);

    // --- Crear panel ---
    let panel = document.createElement("div");
    panel.id = "logger-panel";
    panel.innerHTML = "<b>LOG:</b><br>";
    document.addEventListener("DOMContentLoaded", () => {
        document.body.appendChild(panel);
    });

    // --- Función para registrar ---
    function log(msg) {
        let entry = document.createElement("div");
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        panel.appendChild(entry);
        panel.scrollTop = panel.scrollHeight;
    }

    // --- Registrar recursos cargados ---
    try {
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach(entry => {
                log(entry.name);
            });
        });
        observer.observe({ entryTypes: ["resource", "navigation"] });
    } catch (e) {}

    // --- Registrar errores ---
    window.addEventListener("error", e => {
        log("ERROR: " + e.message + " en " + e.filename + ":" + e.lineno);
    });

    // --- Registrar fetch ---
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
        log("FETCH: " + args[0]);
        return origFetch.apply(this, args);
    };

    // --- Registrar XHR ---
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        log("XHR: " + method + " " + url);
        return origOpen.call(this, method, url, ...rest);
    };

    // --- Registrar console.log / warn / error ---
    ["log","warn","error"].forEach(fn => {
        const orig = console[fn];
        console[fn] = function(...args) {
            log("CONSOLE " + fn.toUpperCase() + ": " + args.join(" "));
            return orig.apply(console, args);
        };
    });

    // --- Hacer el panel movible (drag & drop) ---
    let isDragging = false, offsetX, offsetY;

    panel.addEventListener("mousedown", function(e) {
        if (e.target === panel) { // solo si se hace click en el panel, no en scrollbars
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            panel.style.cursor = "grabbing";
        }
    });

    document.addEventListener("mousemove", function(e) {
        if (isDragging) {
            panel.style.left = (e.clientX - offsetX) + "px";
            panel.style.top = (e.clientY - offsetY) + "px";
        }
    });

    document.addEventListener("mouseup", function() {
        isDragging = false;
        panel.style.cursor = "move";
    });

})();
