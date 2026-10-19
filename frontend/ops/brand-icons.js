/* Bundled Lucide / Feather license notices.
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
/* Hui Xiao Zhao icons; Lucide 1.59.0; see LICENSE.txt */
(function(global){
"use strict";
const registry=Object.freeze({"workspace":"<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" />\n  <rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />\n","city-library":"<path d=\"M12 5v16\" />\n  <path d=\"M16 13h2\" />\n  <path d=\"M16 9h2\" />\n  <path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\" />\n  <path d=\"M6 13h2\" />\n  <path d=\"M6 9h2\" />\n","industry-analysis":"<path d=\"M12 16v5\" />\n  <path d=\"M16 14.639V21\" />\n  <path d=\"M20 10.656V21\" />\n  <path d=\"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15\" />\n  <path d=\"M4 18.463V21\" />\n  <path d=\"M8 14.656V21\" />\n","investment-docking":"<path d=\"m11 17 2 2a1 1 0 1 0 3-3\" />\n  <path d=\"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4\" />\n  <path d=\"m21 3 1 11h-2\" />\n  <path d=\"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3\" />\n  <path d=\"M3 4h8\" />\n","research-workbench":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M3 9h18\" />\n  <path d=\"M9 21V9\" />\n","knowledge-library":"<rect width=\"8\" height=\"18\" x=\"3\" y=\"3\" rx=\"1\" />\n  <path d=\"M7 3v18\" />\n  <path d=\"M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z\" />\n","project-board":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M9 3v18\" />\n  <path d=\"M15 3v18\" />\n","favorites":"<path d=\"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z\" />\n","city":"<path d=\"M10 12h4\" />\n  <path d=\"M10 8h4\" />\n  <path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" />\n  <path d=\"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\" />\n  <path d=\"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16\" />\n","industrial-park":"<path d=\"M12 16h.01\" />\n  <path d=\"M16 16h.01\" />\n  <path d=\"M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z\" />\n  <path d=\"M8 16h.01\" />\n","district":"<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\" />\n  <path d=\"M15 5.764v15\" />\n  <path d=\"M9 3.236v15\" />\n","location":"<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\" />\n  <circle cx=\"12\" cy=\"10\" r=\"3\" />\n","site-map":"<path d=\"M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 01-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0112 0\" />\n  <path d=\"M4.474 15h-.197a1 1 0 00-.969.753l-1.097 4.35a1.5 1.5 0 001.444 1.898L20.344 22a1.5 1.5 0 001.446-1.897l-1.098-4.35a1 1 0 00-.969-.753h-.197\" />\n  <circle cx=\"12\" cy=\"8\" r=\"2\" />\n","land":"<path d=\"m12 8 6-3-6-3v10\" />\n  <path d=\"m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12\" />\n  <path d=\"m6.49 12.85 11.02 6.3\" />\n  <path d=\"M17.51 12.85 6.5 19.15\" />\n","transportation":"<circle cx=\"6\" cy=\"19\" r=\"3\" />\n  <path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\" />\n  <circle cx=\"18\" cy=\"5\" r=\"3\" />\n","public-service":"<path d=\"M10 18v-7\" />\n  <path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\" />\n  <path d=\"M14 18v-7\" />\n  <path d=\"M18 18v-7\" />\n  <path d=\"M3 22h18\" />\n  <path d=\"M6 18v-7\" />\n","industry":"<path d=\"M12 16h.01\" />\n  <path d=\"M16 16h.01\" />\n  <path d=\"M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z\" />\n  <path d=\"M8 16h.01\" />\n","industry-chain":"<rect x=\"16\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\" />\n  <rect x=\"2\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\" />\n  <rect x=\"9\" y=\"2\" width=\"6\" height=\"6\" rx=\"1\" />\n  <path d=\"M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3\" />\n  <path d=\"M12 12V8\" />\n","upstream":"<path d=\"M15 6a9 9 0 0 0-9 9V3\" />\n  <circle cx=\"18\" cy=\"6\" r=\"3\" />\n  <circle cx=\"6\" cy=\"18\" r=\"3\" />\n","downstream":"<circle cx=\"18\" cy=\"18\" r=\"3\" />\n  <circle cx=\"6\" cy=\"6\" r=\"3\" />\n  <path d=\"M6 21V9a9 9 0 0 0 9 9\" />\n","cluster":"<path d=\"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z\" />\n  <path d=\"m7 16.5-4.74-2.85\" />\n  <path d=\"m7 16.5 5-3\" />\n  <path d=\"M7 16.5v5.17\" />\n  <path d=\"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z\" />\n  <path d=\"m17 16.5-5-3\" />\n  <path d=\"m17 16.5 4.74-2.85\" />\n  <path d=\"M17 16.5v5.17\" />\n  <path d=\"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z\" />\n  <path d=\"M12 8 7.26 5.15\" />\n  <path d=\"m12 8 4.74-2.85\" />\n  <path d=\"M12 13.5V8\" />\n","technology":"<path d=\"M12 20v2\" />\n  <path d=\"M12 2v2\" />\n  <path d=\"M17 20v2\" />\n  <path d=\"M17 2v2\" />\n  <path d=\"M2 12h2\" />\n  <path d=\"M2 17h2\" />\n  <path d=\"M2 7h2\" />\n  <path d=\"M20 12h2\" />\n  <path d=\"M20 17h2\" />\n  <path d=\"M20 7h2\" />\n  <path d=\"M7 20v2\" />\n  <path d=\"M7 2v2\" />\n  <rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\" />\n  <rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1\" />\n","application":"<path d=\"M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z\" />\n  <path d=\"M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z\" />\n  <path d=\"M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z\" />\n  <path d=\"M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z\" />\n","market":"<path d=\"M13 17V9\" />\n  <path d=\"M18 17V5\" />\n  <path d=\"M3 3v16a2 2 0 0 0 2 2h16\" />\n  <path d=\"M8 17v-3\" />\n","research":"<path d=\"m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44\" />\n  <path d=\"m13.56 11.747 4.332-.924\" />\n  <path d=\"m16 21-3.105-6.21\" />\n  <path d=\"M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z\" />\n  <path d=\"m6.158 8.633 1.114 4.456\" />\n  <path d=\"m8 21 3.105-6.21\" />\n  <circle cx=\"12\" cy=\"13\" r=\"2\" />\n","source":"<path d=\"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8\" />\n  <path d=\"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z\" />\n  <path d=\"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1\" />\n","quotation":"<path d=\"M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\" />\n  <path d=\"M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z\" />\n","analysis":"<path d=\"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z\" />\n  <path d=\"M9 13a4.5 4.5 0 0 0 3-4\" />\n  <path d=\"M6.003 5.125A3 3 0 0 0 6.401 6.5\" />\n  <path d=\"M3.477 10.896a4 4 0 0 1 .585-.396\" />\n  <path d=\"M6 18a4 4 0 0 1-1.967-.516\" />\n  <path d=\"M12 13h4\" />\n  <path d=\"M12 18h6a2 2 0 0 1 2 2v1\" />\n  <path d=\"M12 8h8\" />\n  <path d=\"M16 8V5a2 2 0 0 1 2-2\" />\n  <circle cx=\"16\" cy=\"13\" r=\".5\" />\n  <circle cx=\"18\" cy=\"3\" r=\".5\" />\n  <circle cx=\"20\" cy=\"21\" r=\".5\" />\n  <circle cx=\"20\" cy=\"8\" r=\".5\" />\n","evidence":"<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" />\n  <path d=\"M17 3h2a2 2 0 0 1 2 2v2\" />\n  <path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" />\n  <path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" />\n  <path d=\"M7 8h8\" />\n  <path d=\"M7 12h10\" />\n  <path d=\"M7 16h6\" />\n","citation":"<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" />\n  <path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />\n","compare":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M12 3v18\" />\n","traceability":"<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" />\n  <path d=\"M3 3v5h5\" />\n  <path d=\"M12 7v5l4 2\" />\n","demand":"<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" />\n  <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" />\n  <path d=\"M12 11h4\" />\n  <path d=\"M12 16h4\" />\n  <path d=\"M8 11h.01\" />\n  <path d=\"M8 16h.01\" />\n","project":"<path d=\"M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z\" />\n  <path d=\"M8 10v4\" />\n  <path d=\"M12 10v2\" />\n  <path d=\"M16 10v6\" />\n","opportunity":"<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\" />\n  <path d=\"M9 18h6\" />\n  <path d=\"M10 22h4\" />\n","target":"<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <circle cx=\"12\" cy=\"12\" r=\"6\" />\n  <circle cx=\"12\" cy=\"12\" r=\"2\" />\n","matching":"<path d=\"M14 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1\" />\n  <path d=\"M19 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1\" />\n  <path d=\"m7 15 3 3\" />\n  <path d=\"m7 21 3-3H5a2 2 0 0 1-2-2v-2\" />\n  <rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\" />\n  <rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\" />\n","milestone":"<path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\" />\n","schedule":"<path d=\"M8 2v3\" />\n  <path d=\"M16 2v3\" />\n  <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" />\n  <path d=\"M3 9h18\" />\n  <path d=\"M8 13h.01\" />\n  <path d=\"M12 13h.01\" />\n  <path d=\"M16 13h.01\" />\n  <path d=\"M8 17h.01\" />\n  <path d=\"M12 17h.01\" />\n  <path d=\"M16 17h.01\" />\n","progress":"<path d=\"M13 5h8\" />\n  <path d=\"M13 12h8\" />\n  <path d=\"M13 19h8\" />\n  <path d=\"m3 17 2 2 4-4\" />\n  <path d=\"m3 7 2 2 4-4\" />\n","enterprise":"<path d=\"M12 10h.01\" />\n  <path d=\"M12 14h.01\" />\n  <path d=\"M12 6h.01\" />\n  <path d=\"M16 10h.01\" />\n  <path d=\"M16 14h.01\" />\n  <path d=\"M16 6h.01\" />\n  <path d=\"M8 10h.01\" />\n  <path d=\"M8 14h.01\" />\n  <path d=\"M8 6h.01\" />\n  <path d=\"M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3\" />\n  <rect x=\"4\" y=\"2\" width=\"16\" height=\"20\" rx=\"2\" />\n","enterprise-profile":"<path d=\"M16 2v2\" />\n  <path d=\"M17.915 21a6 6 0 10-12 0\" />\n  <path d=\"M8 2v2\" />\n  <circle cx=\"12\" cy=\"11\" r=\"4\" />\n  <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" />\n","contact":"<path d=\"M16 2v2\" />\n  <path d=\"M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2\" />\n  <path d=\"M8 2v2\" />\n  <circle cx=\"12\" cy=\"10\" r=\"3\" />\n  <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" />\n","team":"<path d=\"M18 21a8 8 0 0 0-16 0\" />\n  <circle cx=\"10\" cy=\"8\" r=\"5\" />\n  <path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\" />\n","resource":"<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\" />\n  <path d=\"M3 5V19A9 3 0 0 0 21 19V5\" />\n  <path d=\"M3 12A9 3 0 0 0 21 12\" />\n","product":"<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\" />\n  <path d=\"M12 22V12\" />\n  <polyline points=\"3.29 7 12 12 20.71 7\" />\n  <path d=\"m7.5 4.27 9 5.15\" />\n","capability":"<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\" />\n","funding":"<path d=\"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\" />\n  <path d=\"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4\" />\n","verification-request":"<rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" />\n  <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" />\n  <path d=\"M9 14h6\" />\n  <path d=\"M12 17v-6\" />\n","verification-pending":"<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\" />\n  <line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\" />\n  <circle cx=\"12\" cy=\"14\" r=\"8\" />\n","verified":"<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\" />\n  <path d=\"m16 9-5.5 5.5L8 12\" />\n","verification-rejected":"<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\" />\n  <line x1=\"15\" x2=\"9\" y1=\"9\" y2=\"15\" />\n  <line x1=\"9\" x2=\"15\" y1=\"9\" y2=\"15\" />\n","review":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" />\n  <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" />\n  <path d=\"m9 15 2 2 4-4\" />\n","collaborate":"<path d=\"M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\" />\n  <path d=\"M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1\" />\n","assign":"<path d=\"M2 21a8 8 0 0 1 13.292-6\" />\n  <circle cx=\"10\" cy=\"8\" r=\"5\" />\n  <path d=\"m16 19 2 2 4-4\" />\n","comment":"<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\" />\n  <path d=\"M7 11h10\" />\n  <path d=\"M7 15h6\" />\n  <path d=\"M7 7h8\" />\n","document":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" />\n  <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" />\n  <path d=\"M10 9H8\" />\n  <path d=\"M16 13H8\" />\n  <path d=\"M16 17H8\" />\n","report":"<path d=\"M2 6h4\" />\n  <path d=\"M2 10h4\" />\n  <path d=\"M2 14h4\" />\n  <path d=\"M2 18h4\" />\n  <rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" />\n  <path d=\"M9.5 8h5\" />\n  <path d=\"M9.5 12H16\" />\n  <path d=\"M9.5 16H14\" />\n","attachment":"<path d=\"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551\" />\n","folder":"<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\" />\n","upload":"<path d=\"M12 3v12\" />\n  <path d=\"m17 8-5-5-5 5\" />\n  <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />\n","download":"<path d=\"M12 15V3\" />\n  <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />\n  <path d=\"m7 10 5 5 5-5\" />\n","file-search":"<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" />\n  <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" />\n  <circle cx=\"11.5\" cy=\"14.5\" r=\"2.5\" />\n  <path d=\"M13.3 16.3 15 18\" />\n","archive":"<rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\" />\n  <path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\" />\n  <path d=\"M10 12h4\" />\n","account":"<path d=\"M17.925 20.056a6 6 0 0 0-11.851.001\" />\n  <circle cx=\"12\" cy=\"11\" r=\"4\" />\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n","organization":"<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M7 11v4a2 2 0 0 0 2 2h4\" />\n  <rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\" />\n","role":"<path d=\"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z\" />\n","permissions":"<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\" />\n  <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />\n","security":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />\n  <path d=\"m9 12 2 2 4-4\" />\n","settings":"<path d=\"M14 17H5\" />\n  <path d=\"M19 7h-9\" />\n  <circle cx=\"17\" cy=\"17\" r=\"3\" />\n  <circle cx=\"7\" cy=\"7\" r=\"3\" />\n","login":"<path d=\"m10 17 5-5-5-5\" />\n  <path d=\"M15 12H3\" />\n  <path d=\"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4\" />\n","logout":"<path d=\"m16 17 5-5-5-5\" />\n  <path d=\"M21 12H9\" />\n  <path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />\n","search":"<path d=\"m21 21-4.34-4.34\" />\n  <circle cx=\"11\" cy=\"11\" r=\"8\" />\n","filter":"<path d=\"M2 5h20\" />\n  <path d=\"M6 12h12\" />\n  <path d=\"M9 19h6\" />\n","add":"<path d=\"M5 12h14\" />\n  <path d=\"M12 5v14\" />\n","edit":"<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" />\n  <path d=\"m15 5 4 4\" />\n","save":"<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\" />\n  <path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\" />\n  <path d=\"M7 3v4a1 1 0 0 0 1 1h7\" />\n","delete":"<path d=\"M10 11v6\" />\n  <path d=\"M14 11v6\" />\n  <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" />\n  <path d=\"M3 6h18\" />\n  <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />\n","copy":"<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" />\n  <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />\n","refresh":"<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" />\n  <path d=\"M21 3v5h-5\" />\n  <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" />\n  <path d=\"M8 16H3v5\" />\n","back":"<path d=\"m12 19-7-7 7-7\" />\n  <path d=\"M19 12H5\" />\n","next":"<path d=\"M5 12h14\" />\n  <path d=\"m12 5 7 7-7 7\" />\n","expand":"<path d=\"m6 9 6 6 6-6\" />\n","collapse":"<path d=\"m18 15-6-6-6 6\" />\n","external":"<path d=\"M15 3h6v6\" />\n  <path d=\"M10 14 21 3\" />\n  <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" />\n","maximize":"<path d=\"M15 3h6v6\" />\n  <path d=\"m21 3-7 7\" />\n  <path d=\"m3 21 7-7\" />\n  <path d=\"M9 21H3v-6\" />\n","sidebar":"<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M9 3v18\" />\n","more":"<circle cx=\"12\" cy=\"12\" r=\"1\" />\n  <circle cx=\"19\" cy=\"12\" r=\"1\" />\n  <circle cx=\"5\" cy=\"12\" r=\"1\" />\n","notification":"<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" />\n  <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />\n","info":"<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"M12 16v-4\" />\n  <path d=\"M12 8h.01\" />\n","success":"<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m16 9-5.5 5.5L8 12\" />\n","warning":"<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" />\n  <path d=\"M12 9v4\" />\n  <path d=\"M12 17h.01\" />\n","error":"<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m15 9-6 6\" />\n  <path d=\"m9 9 6 6\" />\n","help":"<circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" />\n  <path d=\"M12 17h.01\" />\n","loading":"<path d=\"M21 12a9 9 0 1 1-6.219-8.56\" />\n","empty":"<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\" />\n  <path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\" />\n"});
const manifest=Object.freeze([{"category":"主导航与工作区","key":"workspace","label":"工作空间","sourceIcon":"layout-dashboard","description":"进入团队工作空间"},{"category":"主导航与工作区","key":"city-library","label":"城市智库","sourceIcon":"book-open-text","description":"城市研究资料与知识入口"},{"category":"主导航与工作区","key":"industry-analysis","label":"产业分析","sourceIcon":"chart-no-axes-combined","description":"查看产业结构与发展分析"},{"category":"主导航与工作区","key":"investment-docking","label":"招商对接","sourceIcon":"handshake","description":"进入招商线索与对接流程"},{"category":"主导航与工作区","key":"research-workbench","label":"研究工作区","sourceIcon":"panels-top-left","description":"编辑研究内容与核对证据"},{"category":"主导航与工作区","key":"knowledge-library","label":"知识资料库","sourceIcon":"library-big","description":"管理可复用研究资料"},{"category":"主导航与工作区","key":"project-board","label":"项目看板","sourceIcon":"columns-3","description":"按阶段浏览工作项目"},{"category":"主导航与工作区","key":"favorites","label":"我的收藏","sourceIcon":"bookmark","description":"查看已收藏的资料与项目"},{"category":"城市与园区","key":"city","label":"城市","sourceIcon":"building-2","description":"城市实体与城市概况"},{"category":"城市与园区","key":"industrial-park","label":"产业园区","sourceIcon":"factory","description":"园区空间与配套概况"},{"category":"城市与园区","key":"district","label":"行政区域","sourceIcon":"map","description":"行政区与研究范围"},{"category":"城市与园区","key":"location","label":"地理位置","sourceIcon":"map-pin","description":"标记城市或企业位置"},{"category":"城市与园区","key":"site-map","label":"园区分布","sourceIcon":"map-pinned","description":"查看园区空间分布"},{"category":"城市与园区","key":"land","label":"土地载体","sourceIcon":"land-plot","description":"土地与项目载体信息"},{"category":"城市与园区","key":"transportation","label":"交通区位","sourceIcon":"route","description":"交通连接与区位条件"},{"category":"城市与园区","key":"public-service","label":"公共服务","sourceIcon":"landmark","description":"公共机构与园区服务"},{"category":"产业与链条","key":"industry","label":"产业","sourceIcon":"factory","description":"产业门类与产业实体"},{"category":"产业与链条","key":"industry-chain","label":"产业链","sourceIcon":"network","description":"关联上游下游与关键节点"},{"category":"产业与链条","key":"upstream","label":"上游环节","sourceIcon":"git-branch","description":"产业链的上游分支"},{"category":"产业与链条","key":"downstream","label":"下游环节","sourceIcon":"git-merge","description":"产业链的下游汇聚"},{"category":"产业与链条","key":"cluster","label":"产业集群","sourceIcon":"boxes","description":"查看关联企业与产业集聚"},{"category":"产业与链条","key":"technology","label":"核心技术","sourceIcon":"cpu","description":"技术能力与关键工艺"},{"category":"产业与链条","key":"application","label":"应用场景","sourceIcon":"component","description":"产品与需求的应用关联"},{"category":"产业与链条","key":"market","label":"市场观察","sourceIcon":"chart-column-increasing","description":"市场变化与趋势观察"},{"category":"研究与证据","key":"research","label":"研究课题","sourceIcon":"telescope","description":"发起或查看专题研究"},{"category":"研究与证据","key":"source","label":"原始来源","sourceIcon":"files","description":"引用的原始文档与材料"},{"category":"研究与证据","key":"quotation","label":"来源摘录","sourceIcon":"quote","description":"直接摘录并保留来源语境"},{"category":"研究与证据","key":"analysis","label":"分析判断","sourceIcon":"brain-circuit","description":"研究员形成的分析与推断"},{"category":"研究与证据","key":"evidence","label":"关联证据","sourceIcon":"scan-text","description":"核对支撑观点的原文证据"},{"category":"研究与证据","key":"citation","label":"引用链接","sourceIcon":"link","description":"连接研究内容与原始来源"},{"category":"研究与证据","key":"compare","label":"对比研究","sourceIcon":"columns-2","description":"并排比较研究对象"},{"category":"研究与证据","key":"traceability","label":"研究溯源","sourceIcon":"history","description":"查看来源与修改记录"},{"category":"需求与项目","key":"demand","label":"招商需求","sourceIcon":"clipboard-list","description":"收集并整理招商需求"},{"category":"需求与项目","key":"project","label":"项目","sourceIcon":"folder-kanban","description":"项目资料与阶段管理"},{"category":"需求与项目","key":"opportunity","label":"机会线索","sourceIcon":"lightbulb","description":"有待验证的招商机会"},{"category":"需求与项目","key":"target","label":"目标方向","sourceIcon":"target","description":"明确研究或对接目标"},{"category":"需求与项目","key":"matching","label":"需求匹配","sourceIcon":"combine","description":"匹配需求与资源条件"},{"category":"需求与项目","key":"milestone","label":"项目里程碑","sourceIcon":"flag","description":"项目阶段的重要节点"},{"category":"需求与项目","key":"schedule","label":"日程计划","sourceIcon":"calendar-days","description":"安排调研与对接日程"},{"category":"需求与项目","key":"progress","label":"工作进度","sourceIcon":"list-checks","description":"查看计划事项完成情况"},{"category":"企业与资源","key":"enterprise","label":"企业","sourceIcon":"building","description":"企业实体与基础信息"},{"category":"企业与资源","key":"enterprise-profile","label":"企业档案","sourceIcon":"contact-round","description":"企业画像与结构化档案"},{"category":"企业与资源","key":"contact","label":"联系人","sourceIcon":"contact","description":"企业或园区联系信息"},{"category":"企业与资源","key":"team","label":"团队资源","sourceIcon":"users-round","description":"企业与服务团队资源"},{"category":"企业与资源","key":"resource","label":"资源库","sourceIcon":"database","description":"统一管理可调用资源"},{"category":"企业与资源","key":"product","label":"产品服务","sourceIcon":"package","description":"企业产品与服务能力"},{"category":"企业与资源","key":"capability","label":"服务能力","sourceIcon":"wrench","description":"技术与专业服务能力"},{"category":"企业与资源","key":"funding","label":"资金资源","sourceIcon":"wallet","description":"金融服务与资金资源"},{"category":"核验与协作","key":"verification-request","label":"申请核验","sourceIcon":"clipboard-plus","description":"发起核验请求，尚未通过"},{"category":"核验与协作","key":"verification-pending","label":"等待核验","sourceIcon":"timer","description":"核验已进入等待处理状态"},{"category":"核验与协作","key":"verified","label":"已核验","sourceIcon":"badge-check","description":"仅用于已完成并通过核验"},{"category":"核验与协作","key":"verification-rejected","label":"核验未通过","sourceIcon":"badge-x","description":"核验未通过或需重新补充"},{"category":"核验与协作","key":"review","label":"人工复核","sourceIcon":"file-check","description":"研究员复核内容与证据"},{"category":"核验与协作","key":"collaborate","label":"团队协作","sourceIcon":"messages-square","description":"开展项目协作沟通"},{"category":"核验与协作","key":"assign","label":"指派任务","sourceIcon":"user-round-check","description":"指定事项责任人"},{"category":"核验与协作","key":"comment","label":"评论批注","sourceIcon":"message-square-text","description":"对研究资料发表批注"},{"category":"材料与文件","key":"document","label":"文档材料","sourceIcon":"file-text","description":"打开一般文本材料"},{"category":"材料与文件","key":"report","label":"研究报告","sourceIcon":"notebook-text","description":"查看完整研究报告"},{"category":"材料与文件","key":"attachment","label":"附件","sourceIcon":"paperclip","description":"添加或查看附属材料"},{"category":"材料与文件","key":"folder","label":"文件夹","sourceIcon":"folder-open","description":"打开材料分组目录"},{"category":"材料与文件","key":"upload","label":"上传材料","sourceIcon":"upload","description":"从本地上传资料"},{"category":"材料与文件","key":"download","label":"下载材料","sourceIcon":"download","description":"保存资料到本地"},{"category":"材料与文件","key":"file-search","label":"检索文档","sourceIcon":"file-search","description":"在文档资料中检索"},{"category":"材料与文件","key":"archive","label":"归档材料","sourceIcon":"archive","description":"将完成的材料归档"},{"category":"账号与组织","key":"account","label":"个人账号","sourceIcon":"circle-user-round","description":"进入个人账号信息"},{"category":"账号与组织","key":"organization","label":"组织架构","sourceIcon":"workflow","description":"团队组织关系与架构"},{"category":"账号与组织","key":"role","label":"成员角色","sourceIcon":"badge","description":"显示组织内的职责身份"},{"category":"账号与组织","key":"permissions","label":"权限管理","sourceIcon":"key-round","description":"设置资料与操作权限"},{"category":"账号与组织","key":"security","label":"账号安全","sourceIcon":"shield-check","description":"管理账号安全设置"},{"category":"账号与组织","key":"settings","label":"工作设置","sourceIcon":"settings-2","description":"配置个人与团队偏好"},{"category":"账号与组织","key":"login","label":"登录","sourceIcon":"log-in","description":"进入账号登录流程"},{"category":"账号与组织","key":"logout","label":"退出登录","sourceIcon":"log-out","description":"退出当前账号会话"},{"category":"常用操作","key":"search","label":"搜索","sourceIcon":"search","description":"检索当前范围的内容"},{"category":"常用操作","key":"filter","label":"筛选","sourceIcon":"list-filter","description":"按条件筛选结果"},{"category":"常用操作","key":"add","label":"新建","sourceIcon":"plus","description":"创建新的内容或记录"},{"category":"常用操作","key":"edit","label":"编辑","sourceIcon":"pencil","description":"修改当前内容"},{"category":"常用操作","key":"save","label":"保存","sourceIcon":"save","description":"保存当前修改"},{"category":"常用操作","key":"delete","label":"删除","sourceIcon":"trash-2","description":"删除前需结合业务确认"},{"category":"常用操作","key":"copy","label":"复制","sourceIcon":"copy","description":"复制文本或内容"},{"category":"常用操作","key":"refresh","label":"刷新","sourceIcon":"refresh-cw","description":"重新载入当前数据"},{"category":"导航辅助","key":"back","label":"返回","sourceIcon":"arrow-left","description":"返回上一位置"},{"category":"导航辅助","key":"next","label":"下一步","sourceIcon":"arrow-right","description":"进入流程下一步"},{"category":"导航辅助","key":"expand","label":"展开","sourceIcon":"chevron-down","description":"展开隐藏的内容"},{"category":"导航辅助","key":"collapse","label":"收起","sourceIcon":"chevron-up","description":"收起已展开的内容"},{"category":"导航辅助","key":"external","label":"外部链接","sourceIcon":"external-link","description":"在外部位置打开链接"},{"category":"导航辅助","key":"maximize","label":"放大视图","sourceIcon":"maximize-2","description":"扩大当前内容展示区域"},{"category":"导航辅助","key":"sidebar","label":"侧边栏","sourceIcon":"panel-left","description":"展开或收起侧边导航"},{"category":"导航辅助","key":"more","label":"更多操作","sourceIcon":"ellipsis","description":"展开次要操作菜单"},{"category":"状态与提醒","key":"notification","label":"消息提醒","sourceIcon":"bell","description":"查看通知与消息"},{"category":"状态与提醒","key":"info","label":"信息说明","sourceIcon":"info","description":"显示中性提示与说明"},{"category":"状态与提醒","key":"success","label":"操作成功","sourceIcon":"circle-check","description":"表示一般操作完成，不表示核验通过"},{"category":"状态与提醒","key":"warning","label":"注意事项","sourceIcon":"triangle-alert","description":"提示需要关注的事项"},{"category":"状态与提醒","key":"error","label":"操作失败","sourceIcon":"circle-x","description":"提示错误或无法完成"},{"category":"状态与提醒","key":"help","label":"帮助说明","sourceIcon":"circle-help","description":"打开上下文帮助"},{"category":"状态与提醒","key":"loading","label":"正在加载","sourceIcon":"loader-circle","description":"表示正在处理或加载"},{"category":"状态与提醒","key":"empty","label":"暂无内容","sourceIcon":"inbox","description":"表示列表当前没有内容"}].map(item=>Object.freeze(item)));

const escapeAttr=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const bounded=(value,fallback,min,max)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
function hxzIcon(key,options={}){
  if(typeof key!=='string'||!Object.prototype.hasOwnProperty.call(registry,key))throw new RangeError('Unknown Hui Xiao Zhao icon: '+String(key));
  const opts=options&&typeof options==='object'?options:{};
  const size=bounded(opts.size,24,12,96),strokeWidth=bounded(opts.strokeWidth,1.75,0.75,3);
  const label=typeof opts.label==='string'?opts.label.slice(0,512):'';
  const className=typeof opts.className==='string'?opts.className.slice(0,512):'';
  const accessible=label?' role="img" aria-label="'+escapeAttr(label)+'"':' aria-hidden="true"';
  return '<svg xmlns="http://www.w3.org/2000/svg" class="hxz-icon'+(className?' '+escapeAttr(className):'')+'" data-hxz-icon="'+key+'" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+strokeWidth+'" stroke-linecap="round" stroke-linejoin="round" focusable="false"'+accessible+'>'+registry[key]+'</svg>';
}
global.hxzIcon=hxzIcon;
global.hxzIcons=Object.freeze({version:'1.0.0',sourceVersion:'1.59.0',manifest,keys:Object.freeze(Object.keys(registry)),has:key=>typeof key==='string'&&Object.prototype.hasOwnProperty.call(registry,key)});
})(typeof window!=='undefined'?window:globalThis);

/* Admin-only presentation adapter. Call after rendering a UI container.
 * Only decorative UI nodes are changed; source content and form values are not.
 * This deliberately has no observer, network dependency, or render callback. */
(function(global){
  'use strict';
  var symbolKeys = Object.freeze({
    '◫':'workspace','▤':'report','◎':'demand','⌖':'city','▥':'city-library',
    '◇':'permissions','♙':'account','▦':'resource',
    '📚':'knowledge-library','📄':'document','📋':'demand','🧾':'report',
    '🏙':'city','📍':'location','📌':'location','🏭':'industry','🏢':'enterprise',
    '🏛':'public-service','🏗':'land','🗺':'district','🧭':'site-map',
    '📦':'resource','🗂':'folder','📁':'folder','📂':'folder','📎':'attachment',
    '🔍':'search','🔎':'search','🔄':'refresh','↻':'refresh','⟳':'refresh',
    '＋':'add','+':'add','➕':'add','✎':'edit','✏':'edit','📝':'edit',
    '📥':'download','⬇':'download','↓':'download','📤':'upload','⬆':'upload','↑':'upload',
    '💾':'save','🗑':'delete','📸':'traceability','🔗':'citation',
    '✅':'success','✓':'success','✔':'success','🟢':'success',
    '⚠':'warning','🟡':'warning','❌':'error','✕':'error','×':'error','🔴':'error',
    'ℹ':'info','ⓘ':'info','❓':'help','?':'help',
    '⏳':'loading','⌛':'loading','◔':'loading','🕐':'traceability','⏱':'verification-pending',
    '🤝':'investment-docking','🎯':'target','💡':'opportunity','⚡':'opportunity',
    '📊':'industry-analysis','📈':'market','📉':'market','🔬':'research','🧠':'analysis',
    '👤':'account','👥':'team','📇':'contact','🔒':'security','🔐':'permissions',
    '⚙':'settings','🔔':'notification','💬':'comment','📅':'schedule','🗓':'schedule',
    '💰':'funding','⚓':'enterprise','🚀':'progress','📡':'notification',
    '←':'back','‹':'back','↩':'back','→':'next','➜':'next','›':'next',
    '↗':'external','▾':'expand','▴':'collapse','⋯':'more','⋮':'more'
  });
  var navKeys = Object.freeze({
    '运营总览':'workspace','报告任务':'report','招商项目':'demand',
    '城市画像':'city','城市智库':'city-library','邀请码':'permissions',
    '注册用户':'account','企业资源库':'resource'
  });
  var protectedSelector = [
    'script','style','textarea','input','select','option','pre','code','svg',
    '[contenteditable]','[data-user-content]','[data-business-value]','[data-ops-preserve]',
    '.report-document','.report-body','.markdown-body','.markdown','.prose',
    '.detail-copy','.rag-answer','.rag-chat-message','.message-content'
  ].join(',');
  /* Native select labels can contain user-authored city/topic names. Leave all
   * options exactly as rendered, including explicit-value options. */
  var uiSelector = 'i.i,.ops-ui-nav-icon,[data-ops-icon],button,h1,h2,h3,h4';
  var manifestLabels = {};
  global.hxzIcons.manifest.forEach(function(item){manifestLabels[item.key]=item.label;});
  var prefixSymbols = Object.keys(symbolKeys).sort(function(a,b){return b.length-a.length;});

  function normalizedSymbol(value){return String(value||'').replace(/[\ufe0e\ufe0f]/g,'').trim();}
  function hasKey(key){return global.hxzIcons.has(key);}
  function eligible(element){return !element.closest(protectedSelector);}
  function childrenAreText(element){
    return Array.prototype.every.call(element.childNodes,function(node){return node.nodeType===3;});
  }
  function iconNode(document,key,size){
    var holder=document.createElement('span');
    holder.innerHTML=global.hxzIcon(key,{size:size||18,className:'ops-brand-icon'});
    var svg=holder.firstElementChild;
    svg.style.display='inline-block';
    svg.style.verticalAlign='-0.18em';
    svg.style.flexShrink='0';
    return svg;
  }
  function firstContentNode(element){
    for(var i=0;i<element.childNodes.length;i++){
      var node=element.childNodes[i];
      if(node.nodeType===3&&!node.nodeValue.trim())continue;
      return node;
    }
    return null;
  }
  function prefixMatch(value){
    var leading=(value.match(/^\s*/)||[''])[0];
    var rest=value.slice(leading.length);
    for(var i=0;i<prefixSymbols.length;i++){
      var symbol=prefixSymbols[i];
      if(rest.slice(0,symbol.length)!==symbol)continue;
      var end=symbol.length;
      if(/[\ufe0e\ufe0f]/.test(rest.charAt(end)))end++;
      /* ASCII punctuation is only decorative when separated from a label.
       * This keeps values such as +86 and question-like names intact. */
      if(/^[+?×]$/.test(symbol)&&rest.slice(end)&&!/^\s/.test(rest.slice(end)))continue;
      return {key:symbolKeys[symbol],symbol:symbol,leading:leading,end:leading.length+end};
    }
    return null;
  }
  function ensureIconButtonName(element,key,symbol){
    var button=element.closest('button');
    if(!button||button.textContent.trim())return;
    /* Existing accessible names and tooltips remain authoritative. */
    if((button.getAttribute('aria-label')||'').trim()||
       (button.getAttribute('aria-labelledby')||'').trim()||
       (button.getAttribute('title')||'').trim())return;
    var label=/^[✕×]$/.test(symbol)?'关闭':manifestLabels[key];
    if(label)button.setAttribute('aria-label',label);
  }
  function decorateIcon(element){
    if(!childrenAreText(element))return false;
    var symbol=normalizedSymbol(element.textContent);
    var key=element.getAttribute('data-ops-icon');
    if(!key&&element.classList.contains('ops-ui-nav-icon')){
      var button=element.closest('button');
      var label=button?button.textContent.replace(element.textContent,'').trim():'';
      key=navKeys[label];
    }
    if(!key)key=symbolKeys[symbol];
    if(!hasKey(key))return false;
    var parsedSize=Number(element.getAttribute('data-ops-icon-size'));
    var size=parsedSize>=12&&parsedSize<=96?parsedSize:element.classList.contains('ops-ui-nav-icon')?19:18;
    element.textContent='';
    element.appendChild(iconNode(element.ownerDocument,key,size));
    if(element.tagName!=='BUTTON')element.setAttribute('aria-hidden','true');
    ensureIconButtonName(element,key,symbol);
    return true;
  }
  function decoratePrefix(element){
    var node=firstContentNode(element);
    if(!node||node.nodeType!==3)return false;
    var match=prefixMatch(node.nodeValue);
    if(!match)return false;
    var remainder=node.nodeValue.slice(match.end);
    var icon=iconNode(element.ownerDocument,match.key,18);
    /* Preserve the existing button element, handlers, attributes, and nodes. */
    element.insertBefore(icon,node);
    node.nodeValue=match.leading+(remainder||'');
    ensureIconButtonName(element,match.key,match.symbol);
    return true;
  }

  global.opsDecorateBrand=function(root){
    root=root||global.document;
    if(!root||!root.querySelectorAll)return 0;
    var elements=[];
    if(root.nodeType===1&&root.matches(uiSelector))elements.push(root);
    Array.prototype.push.apply(elements,root.querySelectorAll(uiSelector));
    var changed=0;
    elements.forEach(function(element){
      if(!eligible(element))return;
      if(element.matches('i.i,.ops-ui-nav-icon,[data-ops-icon]')){
        if(decorateIcon(element))changed++;
      }else if(element.tagName==='BUTTON'){
        /* Record/filename buttons carry business labels, not UI copy. */
        if(element.matches('.ops-ui-recent-row,[data-file],[data-business-value]'))return;
        if(decoratePrefix(element))changed++;
      }else{
        /* Only fixed UI headings are eligible. Entity names and report headings
         * in tables/detail content must remain exactly as supplied. */
        if(!element.closest('.ops-ui-pagehead,.ops-ui-card-head,.modal > header,[data-ops-ui-heading]'))return;
        if(element.closest('.ops-ui-table,.ops-ui-detail-grid,.ops-ui-recent'))return;
        if(decoratePrefix(element))changed++;
      }
    });
    return changed;
  };
})(typeof window!=='undefined'?window:globalThis);
