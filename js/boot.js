/* boot.js - start-up loader.
   1. Builds the SVG icon sprite from assets/icons/*.svg (each file is one icon; icons.json lists them).
      If the files cannot be fetched (e.g. index.html opened straight from disk), the built-in copy in icons-fallback.js is used.
   2. Loads the application scripts one after another, in dependency order.
   The scripts are plain (non-module) scripts that share one global scope, so ORDER MATTERS: a file may only run code at load
   time that references things defined in files listed before it. */
(function () {
  'use strict';
  var ICON_DIR = 'assets/icons/';
  var APP_SCRIPTS = [
    'js/state.js',
    'js/platform.js',
    'js/utils.js',
    'js/documents.js',
    'js/pages.js',
    'js/overlay.js',
    'js/tools.js',
    'js/properties.js',
    'js/dialogs.js',
    'js/export.js',
    'js/ui.js',
    'js/markups-list.js',
    'js/bookmarks.js',
    'js/forms.js',
    'js/flatten.js',
    'js/layout.js',
    'js/layout-dialog.js',
    'js/protect.js',
    'js/protect-ui.js',
    'js/ocr.js',
    'js/text.js',
    'js/detect.js',
    'js/core.js',
    'js/worker-api.js',
    'js/shell.js',
    'js/touch.js',
    'js/tips.js',
    'js/init.js'
  ];

  function parseSvg(text) {
    var svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    var ser = new XMLSerializer();
    return { viewBox: svg.getAttribute('viewBox') || '0 0 24 24', inner: Array.prototype.map.call(svg.childNodes, function (n) { return ser.serializeToString(n); }).join('') };
  }

  function loadIcons() {
    return fetch(ICON_DIR + 'icons.json')
      .then(function (r) { if (!r.ok) throw new Error('icons.json ' + r.status); return r.json(); })
      .then(function (names) {
        return Promise.all(names.map(function (n) {
          return fetch(ICON_DIR + n + '.svg').then(function (r) { if (!r.ok) throw new Error(n + '.svg ' + r.status); return r.text(); }).then(function (t) { return [n, parseSvg(t)]; });
        }));
      })
      .then(function (pairs) { var o = {}; pairs.forEach(function (p) { o[p[0]] = p[1]; }); return o; })
      .catch(function (e) {
        console.warn('Icon files could not be loaded (' + e.message + '); using the built-in icon set. Serve this folder over http(s) to use assets/icons/.');
        return window.ICON_FALLBACK || {};
      });
  }

  function injectIcons(icons) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.style.position = 'absolute';
    var defs = document.createElementNS(NS, 'defs'); svg.appendChild(defs);
    Object.keys(icons).forEach(function (name) {
      var sym = document.createElementNS(NS, 'symbol');
      sym.id = 'i-' + name; sym.setAttribute('viewBox', icons[name].viewBox); sym.innerHTML = icons[name].inner;
      defs.appendChild(sym);
    });
    document.body.insertBefore(svg, document.body.firstChild);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = resolve; s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.body.appendChild(s);
    });
  }

  loadIcons().then(injectIcons).then(function () {
    return APP_SCRIPTS.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve());
  }).catch(function (e) {
    console.error(e);
    var m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#1b1c1f;color:#dcdde1;font:14px system-ui;text-align:center;padding:24px';
    m.textContent = 'The editor could not start: ' + e.message;
    document.body.appendChild(m);
  });
})();