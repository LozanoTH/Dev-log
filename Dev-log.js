// ==UserScript==
// @name         Black Background + Full Activity Logger Movable & Resizable
// @namespace    https://viayoo.com/nkhej1
// @version      0.4
// @description  Fondo negro y logger total, movible y redimensionable en la parte superior de la página
// @author       LozanoTH
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
