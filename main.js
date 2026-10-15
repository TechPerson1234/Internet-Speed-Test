(function () {
"use strict";

var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var now = function () {
  return (window.performance && performance.now) ? performance.now() : Date.now();
};

function el(tag, cls, html) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function toStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    var parts = [];
    for (var i = 0; i < v.length; i++) {
      var s = toStr(v[i]);
      if (s) parts.push(s);
    }
    return parts.join(", ");
  }
  if (typeof v === "object") {
    if (v.iata && typeof v.iata === "string") return v.iata;
    if (v.name && typeof v.name === "string") return v.name;
    if (v.code && typeof v.code === "string") return v.code;
    try {
      var keys = Object.keys(v);
      var pairs = [];
      for (var k = 0; k < keys.length && k < 3; k++) {
        pairs.push(keys[k] + "=" + toStr(v[keys[k]]));
      }
      return pairs.join(", ");
    } catch (e) { return ""; }
  }
  return String(v);
}

function fmtBytes(b) {
  if (!b || b < 1) return "0 B";
  var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (i === 0 ? b.toFixed(0) : b.toFixed(b < 10 ? 2 : 1)) + " " + u[i];
}

function fmtTime(ms) {
  if (ms < 1000) return Math.round(ms) + " ms";
  var s = ms / 1000;
  if (s < 60) return s.toFixed(1) + " s";
  return Math.floor(s / 60) + "m " + Math.round(s % 60) + "s";
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function withTimeout(promise, ms, onTimeout) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      if (onTimeout) { try { onTimeout(); } catch (e) {} }
      reject(new Error("Timeout"));
    }, ms);
    promise.then(function (v) {
      if (done) return; done = true; clearTimeout(t); resolve(v);
    }, function (e) {
      if (done) return; done = true; clearTimeout(t); reject(e);
    });
  });
}

var AbortCtor = (typeof AbortController !== "undefined") ? AbortController :
  function () { this.signal = undefined; this.abort = function () {}; };

var SUPPORTS_STREAM = (function () {
  try {
    if (typeof fetch !== "function") return false;
    if (typeof ReadableStream !== "function") return false;
    var rs = new ReadableStream({ start: function (c) { c.enqueue(new Uint8Array(1)); c.close(); } });
    var r = new Response(rs);
    return !!(r.body && typeof r.body.getReader === "function");
  } catch (e) { return false; }
})();

var SCHEMA = [
  {
    id: "test", title: "Test Parameters", icon: "⚡",
    items: [
      { key: "downloadDuration", label: "Download duration", type: "select", def: 10,
        options: [[5,"5 seconds"],[10,"10 seconds"],[15,"15 seconds"],[20,"20 seconds"],[30,"30 seconds"],[45,"45 seconds"],[60,"60 seconds"]],
        hint: "How long the download phase runs." },
      { key: "uploadDuration", label: "Upload duration", type: "select", def: 10,
        options: [[5,"5 seconds"],[10,"10 seconds"],[15,"15 seconds"],[20,"20 seconds"],[30,"30 seconds"],[45,"45 seconds"],[60,"60 seconds"]],
        hint: "How long the upload phase runs." },
      { key: "parallel", label: "Parallel connections", type: "range", def: 6, min: 1, max: 16, step: 1,
        hint: "More streams give a more accurate reading on fast links." },
      { key: "pingCount", label: "Ping samples", type: "range", def: 12, min: 4, max: 40, step: 1,
        hint: "Number of latency probes used for ping / jitter / loss." },
      { key: "testOrder", label: "Test sequence", type: "select", def: "full",
        options: [["full","Ping → Download → Upload"],["full-up","Ping → Upload → Download"],
                  ["download","Ping → Download only"],["upload","Ping → Upload only"],["ping","Ping only"]] },
      { key: "warmup", label: "Warm-up request", type: "toggle", def: true,
        hint: "Opens the TCP/TLS connection before measuring so latency isn't skewed." },
      { key: "measureLoss", label: "Measure packet loss", type: "toggle", def: true },
      { key: "adaptive", label: "Adaptive chunk sizing", type: "toggle", def: true,
        hint: "Automatically scales transfer chunk size to your connection speed." },
      { key: "minChunkKB", label: "Minimum chunk size (KB)", type: "number", def: 256, min: 16, max: 10240 },
      { key: "maxChunkMB", label: "Maximum chunk size (MB)", type: "number", def: 64, min: 1, max: 256 },
      { key: "timeout", label: "Request timeout (s)", type: "number", def: 20, min: 3, max: 120 },
      { key: "dataCapMB", label: "Data warning threshold (MB)", type: "number", def: 500, min: 0, max: 100000,
        hint: "Shows a warning in the status bar when transferred data exceeds this. Set 0 to disable." }
    ]
  },
  {
    id: "server", title: "Server & Engine", icon: "🌐",
    items: [
      { key: "serverPreset", label: "Test server", type: "select", def: "cloudflare",
        options: [["cloudflare","Cloudflare edge (automatic)"],["custom","Custom server"]],
        hint: "Cloudflare picks the closest edge automatically." },
      { key: "customBase", label: "Custom base URL", type: "text", def: "", placeholder: "https://example.com/speed",
        hint: "Must send CORS headers (Access-Control-Allow-Origin)." },
      { key: "customDownPath", label: "Download path", type: "text", def: "__down", placeholder: "__down",
        hint: "Called as <base>/<path>?bytes=N" },
      { key: "customUpPath", label: "Upload path", type: "text", def: "__up", placeholder: "__up" },
      { key: "customMetaPath", label: "Meta / info path", type: "text", def: "meta", placeholder: "meta",
        hint: "Should return JSON with ip / isp fields (optional)." },
      { key: "engine", label: "Transfer engine", type: "select", def: "auto",
        options: [["auto","Automatic (best available)"],["fetch","Fetch streams"],["xhr","XHR (legacy)"]],
        hint: "Fetch streams use less memory. XHR works on older browsers." },
      { key: "cacheBust", label: "Cache busting", type: "toggle", def: true }
    ]
  },
  {
    id: "display", title: "Display", icon: "🎨",
    items: [
      { key: "unit", label: "Speed unit", type: "select", def: "Auto",
        options: [["Auto","Auto (bits — Kbps/Mbps/Gbps)"],["AutoB","Auto (bytes — KB/s/MB/s/GB/s)"],
                  ["Mbps","Mbps — megabits per second"],["MBps","MB/s — megabytes per second"],
                  ["Gbps","Gbps — gigabits per second"],["Kbps","Kbps — kilobits per second"],
                  ["KBps","KB/s — kilobytes per second"]] },
      { key: "decimals", label: "Decimal places", type: "select", def: "auto",
        options: [["auto","Auto (adapts to unit)"],["0","0"],["1","1"],["2","2"],["3","3"]] },
      { key: "theme", label: "Theme", type: "select", def: "auto",
        options: [["auto","Follow system"],["dark","Dark"],["light","Light"]] },
      { key: "accent", label: "Accent colour", type: "color", def: "#22d3ee" },
      { key: "showGauge", label: "Analog gauge", type: "toggle", def: true },
      { key: "showChart", label: "Live throughput chart", type: "toggle", def: true },
      { key: "showAdvancedInfo", label: "Connection details panel", type: "toggle", def: true },
      { key: "showPresets", label: "Show quick preset buttons", type: "toggle", def: true },
      { key: "showFingerprint", label: "Device fingerprint panel", type: "toggle", def: true },
      { key: "reduceMotion", label: "Reduce motion", type: "toggle", def: false },
      { key: "compact", label: "Compact layout", type: "toggle", def: false }
    ]
  },
  {
    id: "data", title: "Data & Privacy", icon: "💾",
    items: [
      { key: "autoStart", label: "Auto-start test on page load", type: "toggle", def: false },
      { key: "saveHistory", label: "Save result history locally", type: "toggle", def: true },
      { key: "historyLimit", label: "History entries to keep", type: "range", def: 25, min: 5, max: 100, step: 5 },
      { key: "ipLookup", label: "Look up IP / ISP information", type: "toggle", def: true,
        hint: "Queries a public endpoint for your IPv4, IPv6, ISP and approximate location." },
      { key: "webrtcLocalIp", label: "Detect local IP (WebRTC)", type: "toggle", def: true,
        hint: "Discovers your LAN IP address using WebRTC ICE candidates. Disable for privacy." },
      { key: "platformInfo", label: "Detect browser & device info", type: "toggle", def: true,
        hint: "Adds your browser, OS, device type and screen size to the details panel." },
      { key: "fingerprint", label: "Collect device fingerprint", type: "toggle", def: true,
        hint: "Computes audio / WebGL / canvas fingerprint hashes and detection signals." },
      { key: "showGrade", label: "Show connection grade after test", type: "toggle", def: true,
        hint: "Displays an A+ to F grade based on speed, latency and jitter." },
      { key: "showCaps", label: "Show capability tags", type: "toggle", def: true,
        hint: "Displays tags like '4K Video' or 'Gaming' based on your results." },
      { key: "wakeLock", label: "Keep screen awake during test", type: "toggle", def: true },
      { key: "autoCopy", label: "Copy summary after test", type: "toggle", def: false }
    ]
  }
];

var DEFAULTS = (function () {
  var d = {};
  SCHEMA.forEach(function (sec) {
    sec.items.forEach(function (it) { d[it.key] = it.def; });
  });
  return d;
})();

var LS_KEY = "speedtest.pro.v1";

var Store = {
  settings: {},
  history: []
};

function loadStore() {
  var raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch (e) {}
  var parsed = {};
  if (raw) { try { parsed = JSON.parse(raw) || {}; } catch (e) { parsed = {}; } }

  Store.settings = {};
  for (var k in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) Store.settings[k] = DEFAULTS[k]; }
  if (parsed.settings) {
    for (var k2 in parsed.settings) {
      if (Object.prototype.hasOwnProperty.call(Store.settings, k2)) {
        Store.settings[k2] = parsed.settings[k2];
      }
    }
  }
  Store.history = Array.isArray(parsed.history) ? parsed.history : [];
}

function saveStore() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      settings: Store.settings,
      history: Store.history.slice(0, 100)
    }));
  } catch (e) {}
}

var S = Store.settings;

var dom = {
  gauge:        $("#gauge"),
  gaugeValue:   $("#gaugeValue"),
  gaugeUnit:    $("#gaugeUnit"),
  gaugePhase:   $("#gaugePhase"),
  gradeBadge:   $("#gradeBadge"),
  presetRow:    $("#presetRow"),
  btnStart:     $("#btnStart"),
  btnStartLbl:  $("#btnStartLabel"),
  btnStop:      $("#btnStop"),
  progress:     $("#progressFill"),
  stEngine:     $("#stEngine"),
  stStreams:    $("#stStreams"),
  stData:       $("#stData"),
  stTime:       $("#stTime"),
  vDown:        $("#vDown"),
  vUp:          $("#vUp"),
  vPing:        $("#vPing"),
  vJitter:      $("#vJitter"),
  vLoss:        $("#vLoss"),
  vStability:   $("#vStability"),
  uDown:        $("#uDown"),
  uUp:          $("#uUp"),
  sDown:        $("#sDown"),
  sUp:          $("#sUp"),
  sPing:        $("#sPing"),
  sJitter:      $("#sJitter"),
  sLoss:        $("#sLoss"),
  sStability:   $("#sStability"),
  mDown:        $("#mDown"),
  mUp:          $("#mUp"),
  mPing:        $("#mPing"),
  mJitter:      $("#mJitter"),
  mLoss:        $("#mLoss"),
  mStability:   $("#mStability"),
  chart:        $("#chart"),
  chartEmpty:   $("#chartEmpty"),
  infoGrid:     $("#infoGrid"),
  settingsPanel:$("#settingsPanel"),
  historyPanel: $("#historyPanel"),
  settingsBody: $("#settingsBody"),
  historyBody:  $("#historyBody"),
  scrim:        $("#scrim"),
  toasts:       $("#toasts"),
  chipIp:       $("#chipIp"),
  chipIp6:      $("#chipIp6"),
  chipIsp:      $("#chipIsp"),
  chipLoc:      $("#chipLoc"),
  chartCard:    $("#chartCard"),
  infoCard:     $("#infoCard"),
  fpCard:       $("#fpCard"),
  fpGroups:     $("#fpGroups")
};

var ctx = dom.chart ? dom.chart.getContext("2d") : null;

function toast(msg, kind, ms) {
  var t = el("div", "toast" + (kind ? " " + kind : ""), escapeHtml(msg));
  dom.toasts.appendChild(t);
  setTimeout(function () {
    t.style.transition = "opacity .3s, transform .3s";
    t.style.opacity = "0";
    t.style.transform = "translateY(10px)";
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
  }, ms || 2600);
}

function legacyCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function copyToClipboard(text) {
  return new Promise(function (resolve) {
    if (text == null) { resolve(false); return; }
    text = String(text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); },
          function () { resolve(legacyCopy(text)); });
      } else {
        resolve(legacyCopy(text));
      }
    } catch (e) { resolve(legacyCopy(text)); }
  });
}

function flashCopied(node, cls, ms) {
  if (!node) return;
  node.classList.add(cls || "copied");
  setTimeout(function () { node.classList.remove(cls || "copied"); }, ms || 900);
}

var UNIT_DEF = {
  Mbps: { fromBytes: 8 / 1e6,  label: "Mbps" },
  MBps: { fromBytes: 1 / 1e6,  label: "MB/s" },
  Gbps: { fromBytes: 8 / 1e9,  label: "Gbps" },
  Kbps: { fromBytes: 8 / 1e3,  label: "Kbps" },
  KBps: { fromBytes: 1 / 1e3,  label: "KB/s" },
  Tbps: { fromBytes: 8 / 1e12, label: "Tbps" },
  GBps: { fromBytes: 1 / 1e9,  label: "GB/s" }
};

function autoUnitFor(bps, mode) {
  var bits = bps * 8;
  var bytes = bps;
  if (mode === "AutoB") {
    if (bytes < 1e6) return UNIT_DEF.KBps;
    if (bytes < 1e9) return UNIT_DEF.MBps;
    return UNIT_DEF.GBps;
  }
  if (bits < 1e6) return UNIT_DEF.Kbps;
  if (bits < 1e9) return UNIT_DEF.Mbps;
  if (bits < 1e12) return UNIT_DEF.Gbps;
  return UNIT_DEF.Tbps;
}

function unitInfo(bps) {
  if (S.unit === "Auto" || S.unit === "AutoB") {
    if (bps == null) return UNIT_DEF[S.unit === "AutoB" ? "MBps" : "Mbps"];
    return autoUnitFor(bps, S.unit);
  }
  return UNIT_DEF[S.unit] || UNIT_DEF.Mbps;
}

function toDisplay(bps) {
  return bps * unitInfo(bps).fromBytes;
}

function decimalsFor(bps) {
  if (S.decimals === "auto" || S.decimals == null) {
    var v = toDisplay(bps);
    if (v >= 100) return 0;
    if (v >= 10) return 1;
    return 2;
  }
  var d = parseInt(S.decimals, 10);
  return isFinite(d) ? d : 2;
}

function fmtSpeed(bps) {
  var v = toDisplay(bps);
  if (!isFinite(v) || v < 0) v = 0;
  return v.toFixed(decimalsFor(bps));
}

function unitLabelFor(bps) { return unitInfo(bps).label; }

var TICKS = [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
var G = { cx: 160, cy: 160, r: 116, start: 135, end: 405 };
var gaugeEls = { progress: null, needle: null };

function polar(cx, cy, r, deg) {
  var a = deg * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx, cy, r, a0, a1) {
  if (Math.abs(a1 - a0) < 0.2) return "";
  var p0 = polar(cx, cy, r, a0);
  var p1 = polar(cx, cy, r, a1);
  var large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  var sweep = a1 > a0 ? 1 : 0;
  return "M " + p0.x.toFixed(2) + " " + p0.y.toFixed(2) +
         " A " + r + " " + r + " 0 " + large + " " + sweep + " " +
         p1.x.toFixed(2) + " " + p1.y.toFixed(2);
}

function valueToFrac(v) {
  v = Math.max(0, v || 0);
  var last = TICKS[TICKS.length - 1];
  if (v >= last) return 1;
  for (var i = 0; i < TICKS.length - 1; i++) {
    if (v <= TICKS[i + 1]) {
      var t = (v - TICKS[i]) / (TICKS[i + 1] - TICKS[i]);
      return (i + t) / (TICKS.length - 1);
    }
  }
  return 1;
}

function buildGauge() {
  var svg = dom.gauge;
  if (!svg) return;
  var NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";

  var defs = document.createElementNS(NS, "defs");
  var gradId = "gaugeGrad";
  var grad = document.createElementNS(NS, "linearGradient");
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "0%"); grad.setAttribute("y1", "0%");
  grad.setAttribute("x2", "100%"); grad.setAttribute("y2", "100%");
  var s1 = document.createElementNS(NS, "stop");
  s1.setAttribute("offset", "0%"); s1.setAttribute("stop-color", "var(--accent)");
  var s2 = document.createElementNS(NS, "stop");
  s2.setAttribute("offset", "100%"); s2.setAttribute("stop-color", "var(--accent-2)");
  grad.appendChild(s1); grad.appendChild(s2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  var track = document.createElementNS(NS, "path");
  track.setAttribute("d", arcPath(G.cx, G.cy, G.r, G.start, G.end));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "var(--track)");
  track.setAttribute("stroke-width", "13");
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  var prog = document.createElementNS(NS, "path");
  prog.setAttribute("fill", "none");
  prog.setAttribute("stroke", "url(#" + gradId + ")");
  prog.setAttribute("stroke-width", "13");
  prog.setAttribute("stroke-linecap", "round");
  prog.style.filter = "drop-shadow(0 0 8px rgba(34,211,238,.45))";
  svg.appendChild(prog);
  gaugeEls.progress = prog;

  for (var i = 0; i < TICKS.length; i++) {
    var frac = i / (TICKS.length - 1);
    var ang = G.start + frac * (G.end - G.start);
    var p1 = polar(G.cx, G.cy, G.r - 15, ang);
    var p2 = polar(G.cx, G.cy, G.r - (i % 2 === 0 ? 26 : 22), ang);
    var tk = document.createElementNS(NS, "line");
    tk.setAttribute("x1", p1.x.toFixed(1)); tk.setAttribute("y1", p1.y.toFixed(1));
    tk.setAttribute("x2", p2.x.toFixed(1)); tk.setAttribute("y2", p2.y.toFixed(1));
    tk.setAttribute("stroke", "var(--text-faint)");
    tk.setAttribute("stroke-width", i % 2 === 0 ? "2" : "1.2");
    tk.setAttribute("stroke-linecap", "round");
    tk.setAttribute("opacity", i % 2 === 0 ? ".85" : ".45");
    svg.appendChild(tk);

    if (i % 2 === 0) {
      var lp = polar(G.cx, G.cy, G.r - 40, ang);
      var tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", lp.x.toFixed(1));
      tx.setAttribute("y", (lp.y + 4).toFixed(1));
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("font-size", "11");
      tx.setAttribute("font-weight", "700");
      tx.setAttribute("fill", "var(--text-faint)");
      tx.textContent = TICKS[i];
      svg.appendChild(tx);
    }
  }

  var needle = document.createElementNS(NS, "g");
  var poly = document.createElementNS(NS, "polygon");
  var cx = G.cx, cy = G.cy;
  poly.setAttribute("points",
    (cx - 5) + "," + (cy + 6) + " " +
    (cx + 5) + "," + (cy + 6) + " " +
    (cx + 2) + "," + (cy - G.r + 34) + " " +
    (cx - 2) + "," + (cy - G.r + 34));
  poly.setAttribute("fill", "var(--text)");
  poly.setAttribute("opacity", ".9");
  needle.appendChild(poly);
  var hub = document.createElementNS(NS, "circle");
  hub.setAttribute("cx", cx); hub.setAttribute("cy", cy); hub.setAttribute("r", "9");
  hub.setAttribute("fill", "var(--bg)");
  hub.setAttribute("stroke", "var(--accent)");
  hub.setAttribute("stroke-width", "3");
  needle.appendChild(hub);
  needle.setAttribute("transform", "rotate(" + (G.start - 270) + " " + cx + " " + cy + ")");
  svg.appendChild(needle);
  gaugeEls.needle = needle;

  updateGaugeNeedle(0);
}

var needleCurrent = 0;

function updateGaugeNeedle(displayValue) {
  if (!gaugeEls.needle) return;
  var frac = valueToFrac(displayValue);
  var target = G.start + frac * (G.end - G.start);

  if (S.reduceMotion) {
    needleCurrent = target;
  } else {
    needleCurrent += (target - needleCurrent) * 0.18;
    if (Math.abs(target - needleCurrent) < 0.15) needleCurrent = target;
  }

  gaugeEls.needle.setAttribute("transform",
    "rotate(" + (needleCurrent - 270).toFixed(2) + " " + G.cx + " " + G.cy + ")");

  if (gaugeEls.progress) {
    gaugeEls.progress.setAttribute("d", arcPath(G.cx, G.cy, G.r, G.start, needleCurrent));
  }
}

var chartPoints = [];
var chartStart = 0;
var chartTotalMs = 1;

function resizeChart() {
  if (!dom.chart || !ctx) return;
  var dpr = window.devicePixelRatio || 1;
  var rect = dom.chart.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  dom.chart.width = Math.round(rect.width * dpr);
  dom.chart.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}

function cssVar(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  } catch (e) { return fallback; }
}

function drawChart() {
  if (!ctx || !dom.chart) return;
  var w = dom.chart.clientWidth, h = dom.chart.clientHeight;
  if (!w || !h) return;

  ctx.save();

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  var accentDl = cssVar("--accent", "#22d3ee");
  var accentUl = cssVar("--accent-2", "#a855f7");
  var gridCol = cssVar("--text-faint", "#6b7a9c");

  var topPad = 16;
  var bottomPad = 10;
  var leftPad = 2;
  var rightPad = 2;

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = gridCol;
  ctx.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var yy = topPad + (h - topPad - bottomPad) * i / 4;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }
  ctx.restore();

  if (chartPoints.length < 2) {
    if (dom.chartEmpty) dom.chartEmpty.style.display = "";
    ctx.restore();
    return;
  }
  if (dom.chartEmpty) dom.chartEmpty.style.display = "none";

  var vals = [];
  for (var vi = 0; vi < chartPoints.length; vi++) vals.push(chartPoints[vi].v);
  vals.sort(function (a, b) { return a - b; });
  var pIdx = Math.floor(vals.length * 0.95);
  var pVal = vals[pIdx] || 0;
  var absMax = vals[vals.length - 1] || 0;
  var maxV = Math.max(pVal * 1.15, absMax * 0.85, 1);

  var t0 = chartStart;
  var t1 = chartStart + chartTotalMs;
  var span = Math.max(1, t1 - t0);

  var innerW = w - leftPad - rightPad;
  var innerH = h - topPad - bottomPad;

  function px(t) {
    return leftPad + clamp((t - t0) / span, 0, 1) * innerW;
  }
  function py(v) {
    var y = h - bottomPad - (v / maxV) * innerH;
    return clamp(y, topPad, h - bottomPad);
  }

  ctx.save();
  ctx.fillStyle = gridCol;
  ctx.globalAlpha = 0.8;
  ctx.font = "600 10px -apple-system,Segoe UI,Roboto,sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(unitLabelFor(maxV) + " " + fmtSpeed(maxV).replace(/\.00$/, ""), 6, 2);
  ctx.restore();

  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (var k = 1; k < chartPoints.length; k++) {
    var a = chartPoints[k - 1], b = chartPoints[k];
    var isUp = b.phase === "upload";
    ctx.strokeStyle = isUp ? accentUl : accentDl;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(px(a.t), py(a.v));
    ctx.lineTo(px(b.t), py(b.v));
    ctx.stroke();

    ctx.globalAlpha = 0.09;
    ctx.beginPath();
    ctx.moveTo(px(a.t), h - bottomPad);
    ctx.lineTo(px(a.t), py(a.v));
    ctx.lineTo(px(b.t), py(b.v));
    ctx.lineTo(px(b.t), h - bottomPad);
    ctx.closePath();
    ctx.fillStyle = isUp ? accentUl : accentDl;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  var lastP = chartPoints[chartPoints.length - 1];
  ctx.beginPath();
  ctx.arc(px(lastP.t), py(lastP.v), 3.4, 0, Math.PI * 2);
  ctx.fillStyle = lastP.phase === "upload" ? accentUl : accentDl;
  ctx.fill();

  ctx.restore();
}

function baseUrl() {
  if (S.serverPreset === "custom" && S.customBase) {
    return String(S.customBase).replace(/\/+$/, "");
  }
  return "https://speed.cloudflare.com";
}

function buildUrl(pathKey, bytes) {
  var isCustom = (S.serverPreset === "custom" && S.customBase);
  var base = baseUrl();
  var path = isCustom ? (S[pathKey] || (pathKey === "customDownPath" ? "__down" : "__up")) : (pathKey === "customDownPath" ? "__down" : "__up");
  path = String(path || "").replace(/^\/+/, "");
  var sep = path.indexOf("?") >= 0 ? "&" : "?";
  var url = base + "/" + path + sep + "bytes=" + bytes;
  if (S.cacheBust) url += "&r=" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return url;
}

function metaUrl() {
  var isCustom = (S.serverPreset === "custom" && S.customBase);
  if (isCustom) {
    var p = String(S.customMetaPath || "meta").replace(/^\/+/, "");
    return baseUrl() + "/" + p;
  }
  return baseUrl() + "/meta";
}

function useFetchEngine() {
  if (S.engine === "fetch") return SUPPORTS_STREAM;
  if (S.engine === "xhr") return false;
  return SUPPORTS_STREAM;
}

function fetchDownload(url, signal, onBytes) {
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
    signal: signal
  }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (!res.body || typeof res.body.getReader !== "function") {
      return res.arrayBuffer().then(function (buf) {
        onBytes(buf.byteLength);
        return buf.byteLength;
      });
    }
    var reader = res.body.getReader();
    var total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return total;
        total += r.value.byteLength;
        onBytes(r.value.byteLength);
        return pump();
      });
    }
    return pump();
  });
}

function xhrDownload(url, signal, onBytes, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    var last = 0, total = 0, settled = false;

    function cleanup() {
      if (signal && signal.removeEventListener) signal.removeEventListener("abort", onAbort);
    }
    function onAbort() { try { xhr.abort(); } catch (e) {} }

    try {
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.timeout = timeoutMs || 20000;
    } catch (e) { reject(e); return; }

    xhr.onprogress = function (e) {
      if (e.lengthComputable) {
        var d = e.loaded - last;
        if (d > 0) { last = e.loaded; total += d; onBytes(d); }
      }
    };
    xhr.onload = function () {
      if (settled) return; settled = true; cleanup();
      var rem = (xhr.response ? xhr.response.byteLength : 0) - last;
      if (rem > 0) { total += rem; onBytes(rem); }
      if (xhr.status >= 200 && xhr.status < 400) resolve(total);
      else reject(new Error("HTTP " + xhr.status));
    };
    xhr.onerror = function () { if (settled) return; settled = true; cleanup(); reject(new Error("Network error")); };
    xhr.ontimeout = function () { if (settled) return; settled = true; cleanup(); reject(new Error("Timeout")); };
    xhr.onabort = function () {
      if (settled) return; settled = true; cleanup();
      var err = new Error("Aborted"); err.name = "AbortError"; reject(err);
    };

    if (signal && signal.addEventListener) signal.addEventListener("abort", onAbort);
    try { xhr.send(); } catch (e) { cleanup(); reject(e); }
  });
}

var blobCache = null;
function makeUploadBlob(size) {
  if (blobCache && blobCache.size === size) return blobCache.blob;
  var seedLen = 65536;
  var seed = new Uint8Array(seedLen);
  try {
    if (window.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(seed);
    } else {
      for (var i = 0; i < seedLen; i++) seed[i] = (Math.random() * 256) | 0;
    }
  } catch (e) {
    for (var j = 0; j < seedLen; j++) seed[j] = (Math.random() * 256) | 0;
  }
  var parts = [];
  var remaining = size;
  while (remaining > 0) {
    var n = Math.min(remaining, seedLen);
    parts.push(seed.subarray(0, n));
    remaining -= n;
  }
  var blob = new Blob(parts);
  blobCache = { size: size, blob: blob };
  return blob;
}

function xhrUpload(url, blob, signal, onBytes, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    var last = 0, total = 0, settled = false;

    function cleanup() {
      if (signal && signal.removeEventListener) signal.removeEventListener("abort", onAbort);
    }
    function onAbort() { try { xhr.abort(); } catch (e) {} }

    try {
      xhr.open("POST", url, true);
      xhr.timeout = timeoutMs || 20000;
    } catch (e) { reject(e); return; }

    if (xhr.upload) {
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          var d = e.loaded - last;
          if (d > 0) { last = e.loaded; total += d; onBytes(d); }
        }
      };
    }

    xhr.onload = function () {
      if (settled) return; settled = true; cleanup();
      if (xhr.status >= 200 && xhr.status < 400) resolve(total);
      else reject(new Error("HTTP " + xhr.status));
    };
    xhr.onerror = function () { if (settled) return; settled = true; cleanup(); reject(new Error("Network error")); };
    xhr.ontimeout = function () { if (settled) return; settled = true; cleanup(); reject(new Error("Timeout")); };
    xhr.onabort = function () {
      if (settled) return; settled = true; cleanup();
      var err = new Error("Aborted"); err.name = "AbortError"; reject(err);
    };

    if (signal && signal.addEventListener) signal.addEventListener("abort", onAbort);
    try { xhr.send(blob); } catch (e) { cleanup(); reject(e); }
  });
}

function fetchJSON(url, signal, timeoutMs) {
  return withTimeout(
    fetch(url, { cache: "no-store", credentials: "omit", mode: "cors", signal: signal })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
    timeoutMs || 6000
  );
}

var meter = {
  total: 0,
  marks: [],
  t0: 0
};

function meterReset() {
  meter.total = 0;
  meter.t0 = now();
  meter.marks = [{ t: meter.t0, b: 0 }];
}

function meterAdd(n) {
  meter.total += n;
}

function meterTick() {
  var t = now();
  meter.marks.push({ t: t, b: meter.total });
  var cutoff = t - 4000;
  while (meter.marks.length > 2 && meter.marks[0].t < cutoff) meter.marks.shift();
}

function meterSpeed(windowMs) {
  var m = meter.marks;
  if (m.length < 2) return 0;
  var t = now();
  var i = m.length - 1;
  var limit = t - (windowMs || 1500);
  while (i > 0 && m[i - 1].t >= limit) i--;
  var a = m[i], b = m[m.length - 1];
  var dt = b.t - a.t;
  if (dt <= 0) return 0;
  return (b.b - a.b) / dt * 1000;
}

var running = false;
var aborted = false;
var phaseController = null;
var activeStreams = 0;
var lossCount = 0;
var requestCount = 0;
var currentResults = null;
var testStartTime = 0;
var phaseSamples = [];
var lastMarkTime = 0;
var rafId = null;
var wakeLockSentinel = null;
var expectedTotalMs = 1;
var currentPhaseIsSpeed = false;
var dataCapWarned = false;
var peakDown = 0;
var peakUp = 0;

function setPhaseLabel(txt) {
  if (dom.gaugePhase) dom.gaugePhase.textContent = txt;
}

function setProgress(p) {
  if (dom.progress) dom.progress.style.width = clamp(p * 100, 0, 100).toFixed(1) + "%";
}

function setStatus() {
  if (dom.stEngine) dom.stEngine.textContent = useFetchEngine() ? "Fetch" : "XHR";
  if (dom.stStreams) dom.stStreams.textContent = String(activeStreams);
  if (dom.stData) {
    dom.stData.textContent = fmtBytes(meter.total);
    var capMB = Number(S.dataCapMB) || 0;
    var capBytes = capMB * 1024 * 1024;
    if (capMB > 0 && meter.total >= capBytes) {
      dom.stData.classList.add("warn");
      if (!dataCapWarned) {
        dataCapWarned = true;
        toast("Data usage exceeded " + capMB + " MB warning threshold", "err", 4000);
      }
    } else {
      dom.stData.classList.remove("warn");
    }
  }
  if (dom.stTime) dom.stTime.textContent = ((now() - testStartTime) / 1000).toFixed(1) + "s";
}

function highlightMetric(which) {
  [dom.mDown, dom.mUp, dom.mPing, dom.mJitter, dom.mLoss, dom.mStability].forEach(function (n) {
    if (n) n.classList.remove("active");
  });
  if (which && which.classList) which.classList.add("active");
}

function resetMetricsUI() {
  if (dom.vDown) dom.vDown.innerHTML = "—<span class=\"m-unit\">" + unitLabelFor(0) + "</span>";
  if (dom.vUp) dom.vUp.innerHTML = "—<span class=\"m-unit\">" + unitLabelFor(0) + "</span>";
  if (dom.vPing) dom.vPing.innerHTML = "—<span class=\"m-unit\">ms</span>";
  if (dom.vJitter) dom.vJitter.innerHTML = "—<span class=\"m-unit\">ms</span>";
  if (dom.vLoss) dom.vLoss.innerHTML = "—<span class=\"m-unit\">%</span>";
  if (dom.vStability) dom.vStability.innerHTML = "—<span class=\"m-unit\"></span>";
  if (dom.sDown) dom.sDown.textContent = "Not tested";
  if (dom.sUp) dom.sUp.textContent = "Not tested";
  if (dom.sPing) dom.sPing.textContent = "Not tested";
  if (dom.sJitter) dom.sJitter.textContent = "Not tested";
  if (dom.sLoss) dom.sLoss.textContent = "Not tested";
  if (dom.sStability) dom.sStability.textContent = "Not tested";
  highlightMetric(null);
}

function hideGrade() {
  if (!dom.gradeBadge) return;
  dom.gradeBadge.className = "grade-badge";
  dom.gradeBadge.innerHTML = "";
}

function computeStability(samples) {
  if (!samples || samples.length < 4) return null;
  var vals = [];
  for (var i = 0; i < samples.length; i++) vals.push(samples[i].v);
  vals.sort(function (a, b) { return a - b; });
  var trimmed = vals.slice(0, Math.max(3, Math.floor(vals.length * 0.9)));
  var q1 = trimmed[Math.floor(trimmed.length * 0.25)];
  var q3 = trimmed[Math.floor(trimmed.length * 0.75)];
  var median = trimmed[Math.floor(trimmed.length * 0.5)];
  if (!median || median <= 0) return null;
  var iqr = q3 - q1;
  var cv = iqr / median;
  var label;
  if (cv < 0.10) label = "Excellent";
  else if (cv < 0.20) label = "Very Good";
  else if (cv < 0.35) label = "Good";
  else if (cv < 0.55) label = "Fair";
  else if (cv < 0.85) label = "Variable";
  else label = "Unstable";
  return { cv: cv, label: label };
}

function computeGrade(results) {
  if (!results) return null;

  var dl = results.download ? (results.download.bps * 8) / 1e6 : 0;
  var ul = results.upload ? (results.upload.bps * 8) / 1e6 : 0;
  var ping = (results.ping && results.ping.median) ? results.ping.median : 999;
  var jitter = (results.ping && results.ping.jitter) ? results.ping.jitter : 999;
  var score = 0;

  if (dl >= 500) score += 40;
  else if (dl >= 250) score += 39;
  else if (dl >= 100) score += 38;
  else if (dl >= 50) score += 37;
  else if (dl >= 25) score += 36;
  else if (dl >= 10) score += 32;
  else if (dl >= 5) score += 26;
  else if (dl >= 2) score += 18;
  else if (dl >= 1) score += 10;
  else if (dl > 0) score += 4;

  if (ul >= 250) score += 25;
  else if (ul >= 100) score += 24;
  else if (ul >= 50) score += 23;
  else if (ul >= 25) score += 22;
  else if (ul >= 10) score += 20;
  else if (ul >= 5) score += 16;
  else if (ul >= 2) score += 12;
  else if (ul >= 1) score += 7;
  else if (ul > 0) score += 3;

  if (ping <= 15) score += 20;
  else if (ping <= 30) score += 19;
  else if (ping <= 50) score += 18;
  else if (ping <= 80) score += 16;
  else if (ping <= 120) score += 14;
  else if (ping <= 200) score += 12;
  else if (ping <= 350) score += 10;
  else if (ping <= 600) score += 7;
  else score += 3;

  if (jitter <= 5) score += 15;
  else if (jitter <= 15) score += 14;
  else if (jitter <= 30) score += 13;
  else if (jitter <= 60) score += 12;
  else if (jitter <= 120) score += 10;
  else if (jitter <= 250) score += 8;
  else if (jitter <= 500) score += 6;
  else if (jitter <= 1000) score += 4;
  else score += 2;

  var grade, cls, label;
  if (score >= 88) { grade = "A+"; cls = "grade-a"; label = "Excellent — perfect for gaming, 4K streaming and large downloads."; }
  else if (score >= 76) { grade = "A"; cls = "grade-a"; label = "Great — smooth 4K streaming, video calls and online gaming."; }
  else if (score >= 62) { grade = "B"; cls = "grade-b"; label = "Good — reliable for HD streaming and video calls."; }
  else if (score >= 48) { grade = "C"; cls = "grade-c"; label = "Fair — fine for browsing, SD streaming and messaging."; }
  else if (score >= 34) { grade = "D"; cls = "grade-d"; label = "Basic — may struggle with HD video or large uploads."; }
  else { grade = "F"; cls = "grade-f"; label = "Slow — limited usability for modern web services."; }

  return { score: Math.round(score), grade: grade, cls: cls, label: label };
}

function getCapabilities(results) {
  if (!results) return [];
  var dl = results.download ? (results.download.bps * 8) / 1e6 : 0;
  var ul = results.upload ? (results.upload.bps * 8) / 1e6 : 0;
  var ping = (results.ping && results.ping.median) ? results.ping.median : 999;
  var jitter = (results.ping && results.ping.jitter) ? results.ping.jitter : 999;
  var caps = [];

  if (dl >= 25) caps.push({ label: "4K Video", ok: true });
  else if (dl >= 8) caps.push({ label: "HD Video", ok: true });
  else if (dl >= 3) caps.push({ label: "SD Video", ok: true });
  else caps.push({ label: "Video", ok: false });

  if (dl >= 25 && ul >= 10 && ping <= 100 && jitter <= 40) caps.push({ label: "Video Calls", ok: true });
  else caps.push({ label: "Video Calls", ok: false });

  if (dl >= 15 && ul >= 5 && ping <= 80 && jitter <= 30) caps.push({ label: "Gaming", ok: true });
  else caps.push({ label: "Gaming", ok: false });

  if (dl >= 100 && ul >= 20) caps.push({ label: "Cloud Backup", ok: true });
  else if (dl >= 50 && ul >= 10) caps.push({ label: "Cloud Sync", ok: true });

  return caps;
}

function showGrade(results) {
  if (!dom.gradeBadge || !S.showGrade) return;
  var g = computeGrade(results);
  if (!g) return;
  var caps = S.showCaps ? getCapabilities(results) : [];
  var capsHtml = "";
  if (caps.length) {
    capsHtml = '<div class="g-caps">';
    for (var i = 0; i < caps.length; i++) {
      capsHtml += '<span class="cap-tag' + (caps[i].ok ? "" : " no") + '">' +
        (caps[i].ok ? "✓ " : "✕ ") + escapeHtml(caps[i].label) + '</span>';
    }
    capsHtml += '</div>';
  }
  dom.gradeBadge.className = "grade-badge show " + g.cls;
  dom.gradeBadge.innerHTML =
    '<div class="g-score">' + g.grade + '</div>' +
    '<div class="g-info">' +
      '<div class="g-title">Connection Grade · ' + g.score + '/100</div>' +
      '<div class="g-label">' + escapeHtml(g.label) + '</div>' +
    '</div>' +
    capsHtml;
}

/* ==========================================================================
   Device fingerprint / detection suite
   ========================================================================== */

function hashStr(s) {
  s = String(s == null ? "" : s);
  var h1 = 0x811c9dc5 >>> 0;
  var h2 = 0xc2b2ae35 >>> 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 ^ c) >>> 0;
    h2 = (h2 * 0x85ebca6b) >>> 0;
  }
  function hx(v) { var x = (v >>> 0).toString(16); while (x.length < 8) x = "0" + x; return x; }
  return hx(h1) + hx(h2);
}

/* --- SIGNALS: fingerprint consistency heuristics --- */
function checkLeopard() {
  var ua = navigator.userAgent || "";
  var issues = [];

  var claimsChrome = /Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua);
  var hasChrome = typeof window.chrome === "object" && window.chrome !== null;
  if (claimsChrome && !hasChrome) issues.push("chrome-object-missing");

  var claimsSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua);
  if (claimsSafari && typeof window.safari === "undefined") issues.push("safari-object-missing");

  var claimsFirefox = /Firefox\/|FxiOS\//.test(ua);
  if (claimsFirefox) {
    if (typeof window.InstallTrigger === "undefined" &&
        typeof window.netscape === "undefined" &&
        typeof window.mozInnerScreenX === "undefined") {
      issues.push("firefox-object-missing");
    }
  }

  // UA claims mobile but no touch
  var uaMobile = /Mobile|Android|iPhone|iPad/.test(ua);
  var hasTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  if (uaMobile && !hasTouch) issues.push("mobile-ua-no-touch");

  return issues.length
    ? { label: "inconsistent (" + issues.join(", ") + ")", ok: false }
    : { label: "consistent", ok: true };
}

function checkBull() {
  var ua = navigator.userAgent || "";
  var platform = navigator.platform || "";
  var vendor = navigator.vendor || "";
  var issues = [];

  if (/Windows/.test(ua) && !/Win/.test(platform)) issues.push("platform-windows");
  if (/Mac OS X|Macintosh/.test(ua) && !/Mac/.test(platform)) issues.push("platform-mac");
  if (/CrOS/.test(ua) && !/Linux|X11/.test(platform)) issues.push("platform-cros");
  if (/Android/.test(ua) && !/Linux|Android|arm|aarch/.test(platform)) issues.push("platform-android");
  if (/Linux/.test(ua) && !/Linux|X11/.test(platform)) issues.push("platform-linux");

  var isChromish = /Chrome|Chromium|Edg|OPR/.test(ua);
  if (isChromish && vendor === "Apple Computer, Inc.") issues.push("vendor-safari-on-chrome");
  var isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua);
  if (isSafari && vendor && vendor !== "Apple Computer, Inc." && vendor !== "Google Inc.") {
    issues.push("vendor-mismatch");
  }

  if (navigator.webdriver === true) issues.push("webdriver");

  return issues.length
    ? { label: "inconsistent (" + issues.join(", ") + ")", ok: false }
    : { label: "consistent", ok: true };
}

/* --- HARDWARE --- */
function getAudioFingerprint() {
  return new Promise(function (resolve) {
    try {
      var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) { resolve(""); return; }
      var ctx = new OfflineCtx(1, 44100, 44100);
      var osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 10000;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50;
      comp.knee.value = 40;
      comp.ratio.value = 12;
      comp.attack.value = 0;
      comp.release.value = 0.25;
      osc.connect(comp);
      comp.connect(ctx.destination);
      try { osc.start(0); } catch (e) {}
      var finished = false;
      function done() { if (!finished) { finished = true; resolve(""); } }
      ctx.startRendering().then(function (buf) {
        if (finished) return;
        finished = true;
        var data = buf.getChannelData(0);
        var sum = 0;
        for (var i = 4500; i < 5000 && i < data.length; i++) sum += Math.abs(data[i]);
        resolve(hashStr(sum.toFixed(10)));
      }).catch(done);
      setTimeout(done, 3000);
    } catch (e) { resolve(""); }
  });
}

function getWebGLInfo() {
  try {
    var canvas = document.createElement("canvas");
    var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { hash: "", renderer: "", vendor: "" };
    var dbg = gl.getExtension("WEBGL_debug_renderer_info");
    var vendor = "";
    var renderer = "";
    if (dbg) {
      try {
        vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "";
        renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
      } catch (e) {}
    }
    if (!vendor) vendor = gl.getParameter(gl.VENDOR) || "";
    if (!renderer) renderer = gl.getParameter(gl.RENDERER) || "";
    var exts = [];
    try { exts = gl.getSupportedExtensions() || []; } catch (e) {}
    var params = [];
    try {
      params = [
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        (gl.getParameter(gl.MAX_VIEWPORT_DIMS) || []).join ? gl.getParameter(gl.MAX_VIEWPORT_DIMS).join("x") : "",
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        gl.getParameter(gl.MAX_VARYING_VECTORS),
        gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
        gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) ? "line" : ""
      ];
    } catch (e) {}
    var hash = hashStr(vendor + "|" + renderer + "|" + exts.join(",") + "|" + params.join(","));
    return { hash: hash, renderer: renderer, vendor: vendor };
  } catch (e) { return { hash: "", renderer: "", vendor: "" }; }
}

function getMediaDevicesList() {
  return new Promise(function (resolve) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { resolve(""); return; }
      navigator.mediaDevices.enumerateDevices().then(function (devs) {
        var kinds = {};
        for (var i = 0; i < devs.length; i++) {
          var k = devs[i].kind || "unknown";
          kinds[k] = (kinds[k] || 0) + 1;
        }
        var arr = Object.keys(kinds).sort();
        resolve(arr.join(", "));
      }).catch(function () { resolve(""); });
    } catch (e) { resolve(""); }
  });
}

function getStorageEstimate() {
  return new Promise(function (resolve) {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (est) {
          var gb = (est.quota || 0) / (1024 * 1024 * 1024);
          resolve(gb > 0 ? gb.toFixed(0) : "unavailable");
        }).catch(function () { resolve("unavailable"); });
      } else resolve("unavailable");
    } catch (e) { resolve("unavailable"); }
  });
}

function getHardwareArch() {
  var ua = navigator.userAgent || "";
  var platform = navigator.platform || "";
  var arch = "";
  if (/arm64|aarch64/i.test(ua)) arch = "arm64";
  else if (/armv7|arm/i.test(ua) && !/arm64/i.test(ua)) arch = "arm";
  else if (/x86_64|Win64|x64|amd64|CrOS x86_64/i.test(ua)) arch = "x86_64";
  else if (/x86|i686|i386|WOW64|Win32/i.test(platform)) arch = "x86";
  if (!arch) {
    if (/Win32|Win64/.test(platform)) arch = "x86";
    else if (/MacIntel/.test(platform)) arch = "x86_64";
    else if (/Linux/.test(platform)) arch = "x86_64";
    else arch = platform || "unknown";
  }
  // Report like sample: "x86" for typical desktop
  if (arch === "x86_64") return "x86";
  return arch;
}

/* --- SOFTWARE --- */
function getTimingResolution() {
  try {
    if (!window.performance || typeof performance.now !== "function") return "unavailable";
    var samples = [];
    for (var i = 0; i < 200; i++) {
      var a = performance.now();
      var b = performance.now();
      var d = b - a;
      if (d > 0) samples.push(d);
    }
    if (!samples.length) return "unavailable";
    samples.sort(function (x, y) { return x - y; });
    var r1 = samples[0];
    var r2 = samples[Math.floor(samples.length / 2)] || r1;
    return r1.toFixed(15) + ", " + r2.toFixed(15);
  } catch (e) { return "unavailable"; }
}

function getStackOverflowCount() {
  try {
    var count = 0;
    function recurse() { count++; recurse(); }
    try { recurse(); } catch (e) { return count; }
    return count;
  } catch (e) { return 0; }
}

function getPluginsFp() {
  try {
    var arr = [];
    var pls = navigator.plugins || [];
    for (var i = 0; i < pls.length; i++) {
      arr.push(pls[i].name + "::" + (pls[i].filename || ""));
    }
    if (!arr.length) return "none";
    return hashStr(arr.join("|"));
  } catch (e) { return "unavailable"; }
}

function getCanvasFp() {
  try {
    var canvas = document.createElement("canvas");
    canvas.width = 280; canvas.height = 60;
    var c = canvas.getContext("2d");
    if (!c) return "unavailable";
    c.textBaseline = "top";
    c.font = "14px 'Arial'";
    c.textBaseline = "alphabetic";
    c.fillStyle = "#f60";
    c.fillRect(125, 1, 62, 20);
    c.fillStyle = "#069";
    c.fillText("DonutFingerprint, 😀", 2, 15);
    c.fillStyle = "rgba(102,204,0,0.7)";
    c.fillText("DonutFingerprint, 😀", 4, 17);
    c.beginPath();
    c.arc(50, 50, 20, 0, Math.PI * 2, true);
    c.closePath();
    c.fillStyle = "rgba(255,0,255,0.5)";
    c.fill();
    var data = canvas.toDataURL();
    return hashStr(data);
  } catch (e) { return "unavailable"; }
}

/* --- NETWORK --- */
function parseUAInfo() {
  var ua = navigator.userAgent || "";
  var out = { name: "Unknown", os: "Unknown", arch: "unknown", version: "" };

  if (/Edg\//.test(ua)) { out.name = "Edge"; out.version = (ua.match(/Edg\/([\d.]+)/) || [])[1] || ""; }
  else if (/OPR\/|Opera/.test(ua)) { out.name = "Opera"; out.version = (ua.match(/(?:OPR|Opera)\/([\d.]+)/) || [])[1] || ""; }
  else if (/SamsungBrowser\//.test(ua)) { out.name = "Samsung Internet"; out.version = (ua.match(/SamsungBrowser\/([\d.]+)/) || [])[1] || ""; }
  else if (/CriOS\//.test(ua)) { out.name = "Chrome iOS"; out.version = (ua.match(/CriOS\/([\d.]+)/) || [])[1] || ""; }
  else if (/FxiOS\//.test(ua)) { out.name = "Firefox iOS"; out.version = (ua.match(/FxiOS\/([\d.]+)/) || [])[1] || ""; }
  else if (/Chrome\//.test(ua)) { out.name = "Chrome"; out.version = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || ""; }
  else if (/Firefox\//.test(ua)) { out.name = "Firefox"; out.version = (ua.match(/Firefox\/([\d.]+)/) || [])[1] || ""; }
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) { out.name = "Safari"; out.version = (ua.match(/Version\/([\d.]+)/) || [])[1] || ""; }

  if (/Windows NT 10/.test(ua)) out.os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) out.os = "Windows";
  else if (/Mac OS X/.test(ua)) out.os = "macOS";
  else if (/CrOS/.test(ua)) out.os = "Chrome OS";
  else if (/Android/.test(ua)) out.os = "Android " + ((ua.match(/Android ([\d.]+)/) || [])[1] || "");
  else if (/iPhone|iPad|iPod/.test(ua)) out.os = "iOS";
  else if (/Linux/.test(ua)) out.os = "Linux x86_64";

  if (/x86_64|Win64|x64|amd64|CrOS x86_64/i.test(ua)) out.arch = "amd64";
  else if (/arm64|aarch64/i.test(ua)) out.arch = "arm64";
  else if (/armv7|arm/i.test(ua)) out.arch = "arm";
  else if (/WOW64|Win32|x86/i.test(ua)) out.arch = "x86";

  return out;
}

function getWebRTCIPs() {
  return new Promise(function (resolve) {
    var out = { local: [], public: [], all: [] };
    try {
      var PC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
      if (!PC) { resolve(out); return; }
      var pc = new PC({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try { pc.close(); } catch (e) {}
        resolve(out);
      }
      pc.onicecandidate = function (e) {
        if (!e) return;
        if (!e.candidate) { finish(); return; }
        var cand = e.candidate;
        var ip = cand.address || "";
        var typ = cand.type || "";
        if (!ip) {
          var m = (cand.candidate || "").match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})|([a-f0-9]{1,4}(?::[a-f0-9]{0,4}){2,7})/i);
          if (m) ip = m[0];
        }
        if (!ip) return;
        if (out.all.indexOf(ip) < 0) out.all.push(ip);
        var isLocalV4 = ip.indexOf(".") > 0 && (
          ip.indexOf("192.168.") === 0 ||
          ip.indexOf("10.") === 0 ||
          ip.indexOf("127.") === 0 ||
          ip.indexOf("169.254") === 0 ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
        );
        var isLocalV6 = ip.indexOf(":") > 0 && (ip.indexOf("fe80") === 0 || ip.indexOf("fd") === 0 || ip.indexOf("fc") === 0);
        if (isLocalV4 || isLocalV6 || typ === "host") {
          if (out.local.indexOf(ip) < 0) out.local.push(ip);
        } else {
          if (out.public.indexOf(ip) < 0) out.public.push(ip);
        }
      };
      try { pc.createDataChannel("donut-probe"); } catch (e) {}
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () { finish(); });
      setTimeout(finish, 3500);
    } catch (e) { resolve(out); }
  });
}

/* --- BROWSER --- */
function getTimezoneText() {
  try {
    var d = new Date();
    var s = d.toLocaleString("en-US", { timeZoneName: "long" });
    var m = s.match(/, ([^,]+)$/);
    return m ? m[1] : "";
  } catch (e) { return ""; }
}

function getTimezoneOffsetStr() {
  try {
    var d = new Date();
    var s = d.toLocaleString("en-US", { timeZoneName: "short" });
    var m = s.match(/\s([A-Z]{2,5}[+-]?\d*)$/);
    if (m) return m[1];
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    var hh = Math.floor(Math.abs(off) / 60);
    var mm = Math.abs(off) % 60;
    return "UTC" + sign + (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  } catch (e) { return ""; }
}

function getDomTagsFp() {
  try {
    var tags = document.getElementsByTagName("*");
    var names = [];
    var limit = Math.min(tags.length, 4000);
    for (var i = 0; i < limit; i++) names.push(tags[i].tagName);
    return hashStr(names.join(","));
  } catch (e) { return "unavailable"; }
}

function getClientRectsFp() {
  try {
    var div = document.createElement("div");
    div.style.cssText = "position:absolute;left:-9999px;top:0;width:100px;height:50px;padding:5px;border:2px solid #000;font:14px Arial;line-height:1.4;visibility:hidden";
    div.textContent = "Donut Fingerprint Probe — 12345 ABCDEF";
    document.body.appendChild(div);
    var rects = [];
    var list = div.getClientRects();
    for (var i = 0; i < list.length; i++) {
      rects.push([list[i].x, list[i].y, list[i].width, list[i].height].join(","));
    }
    var bb = div.getBoundingClientRect();
    var all = rects.join(";") + "|bb:" + [bb.width, bb.height, bb.top, bb.left].join(",");
    document.body.removeChild(div);
    return hashStr(all);
  } catch (e) { return "unavailable"; }
}

function getSVGComputedStyle() {
  try {
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden";
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><text x="10" y="30" font-family="Arial" font-size="16">Donut SVF</text></svg>';
    document.body.appendChild(wrap);
    var text = wrap.querySelector("text");
    var cs = getComputedStyle(text);
    var bbox = 0;
    try { bbox = text.getBBox().width; } catch (e) {}
    var val = bbox || parseFloat(cs.fontSize) || 0;
    document.body.removeChild(wrap);
    return String(val);
  } catch (e) { return "unavailable"; }
}

function getMimeTypesFp() {
  try {
    var arr = [];
    var mt = navigator.mimeTypes || [];
    for (var i = 0; i < mt.length; i++) arr.push(mt[i].type);
    if (!arr.length) return "none";
    return hashStr(arr.join(","));
  } catch (e) { return "unavailable"; }
}

function getMXScore() {
  try {
    if (!window.performance) return "unavailable";
    var t0 = performance.now();
    var x = 0;
    for (var i = 0; i < 100000; i++) {
      x += Math.sqrt(i * 3.14) + Math.sin(i) * Math.cos(i / 7);
    }
    var dt = performance.now() - t0;
    var opsPerMs = 100000 / Math.max(0.01, dt);
    var score = Math.round(Math.min(100, opsPerMs / 800));
    return String(Math.max(0, Math.min(100, score)));
  } catch (e) { return "unavailable"; }
}

/* --- BOT --- */
function detectBotSignals() {
  var r = {};
  try { r.hasWebdriver = !!navigator.webdriver; } catch (e) { r.hasWebdriver = false; }
  r.hasCDP = false;
  try {
    var err = new Error();
    var hit = false;
    Object.defineProperty(err, "stack", {
      get: function () { hit = true; return ""; }
    });
    try { console.debug(err); } catch (e2) {}
    r.hasCDP = hit;
  } catch (e) { r.hasCDP = false; }
  try { r.hasUserAgent = typeof navigator.userAgent === "string" && navigator.userAgent.length > 0; }
  catch (e) { r.hasUserAgent = false; }
  try { r.hasNavigator = typeof navigator !== "undefined" && navigator !== null; }
  catch (e) { r.hasNavigator = false; }
  return r;
}

/* --- LOCATION (from public IP lookup) --- */
function fetchFpLocation() {
  return withTimeout(fetchJSON("https://ipwho.is/", null, 7000), 7500)
    .then(function (r) {
      if (!r || r.success === false) return null;
      var out = {
        ip: toStr(r.ip || ""),
        countryCode: toStr(r.country_code || ""),
        country: toStr(r.country || ""),
        state: toStr(r.region || ""),
        city: toStr(r.city || ""),
        timezone: toStr((r.timezone && r.timezone.id) || ""),
        timezoneOffset: toStr((r.timezone && r.timezone.abbr) || ""),
        geolocation: (r.latitude != null && r.longitude != null)
          ? (Number(r.latitude).toFixed(4) + "," + Number(r.longitude).toFixed(4))
          : "",
        isp: toStr((r.connection && r.connection.isp) || ""),
        asn: (r.connection && r.connection.asn) ? "AS" + r.connection.asn : "",
        org: toStr((r.connection && r.connection.org) || ""),
        domain: toStr((r.connection && r.connection.domain) || "")
      };

      var ispLc = (out.isp + " " + out.org + " " + out.domain).toLowerCase();
      var dcKeywords = ["amazon", "aws", "google cloud", "microsoft azure",
                        "digitalocean", "linode", "vultr", "ovh", "hetzner",
                        "cloudflare", "googleusercontent", "azure"];
      out.datacenter = dcKeywords.some(function (k) { return ispLc.indexOf(k) >= 0; }) ? "true" : "false";
      out.amazonAws = (ispLc.indexOf("amazon") >= 0 || /\baws\b/.test(ispLc)) ? "true" : "false";
      out.google = (ispLc.indexOf("google") >= 0) ? "true" : "false";
      out.appleIcloud = (ispLc.indexOf("icloud") >= 0 || ispLc.indexOf("apple") >= 0) ? "true" : "false";
      out.blacklisted = "unavailable";
      out.vpn = "unavailable";
      out.riskScore = "0";
      out.risk = "low";
      out.ispRiskScore = "0";
      out.ispRisk = "low";
      return out;
    })
    .catch(function () { return null; });
}

/* --- collection & rendering --- */
var fpCollecting = false;

function collectFingerprint() {
  if (fpCollecting) return Promise.resolve(null);
  fpCollecting = true;
  if (dom.fpGroups) {
    dom.fpGroups.innerHTML = '<div class="empty-state">Collecting fingerprint…</div>';
  }

  var webgl = getWebGLInfo();
  var uaInfo = parseUAInfo();
  var leopard = checkLeopard();
  var bull = checkBull();

  var jobs = [
    getAudioFingerprint(),
    getMediaDevicesList(),
    getStorageEstimate(),
    getWebRTCIPs(),
    fetchFpLocation()
  ];

  return Promise.all(jobs).then(function (results) {
    var audio = results[0] || "";
    var media = results[1] || "";
    var storage = results[2] || "";
    var rtc = results[3] || { local: [], public: [], all: [] };
    var loc = results[4] || {};

    var webrtcIpList = (rtc.public && rtc.public.length) ? rtc.public
                      : (rtc.all && rtc.all.length ? rtc.all : []);
    var webrtcIp = webrtcIpList.join(", ");

    var canvasHash = getCanvasFp();
    var pluginsHash = getPluginsFp();
    var mimeHash = getMimeTypesFp();
    var domTagsHash = getDomTagsFp();
    var rectsHash = getClientRectsFp();
    var svgStyle = getSVGComputedStyle();
    var mxScore = getMXScore();
    var timingRes = getTimingResolution();
    var stackCount = getStackOverflowCount();
    var bot = detectBotSignals();

    var data = {
      signals: [
        { k: "Browser (leopard)", v: leopard.label, badge: leopard.ok ? "ok" : "bad", wide: true },
        { k: "Browser (bull)",    v: bull.label,    badge: bull.ok ? "ok" : "bad",    wide: true }
      ],
      hardware: [
        { k: "Audio",                 v: audio, mono: true },
        { k: "WebGL",                 v: webgl.hash, mono: true },
        { k: "Resolution",            v: (screen.width && screen.height) ? (screen.width + "x" + screen.height) : "unavailable" },
        { k: "GPU",                   v: webgl.renderer || webgl.vendor || "unavailable", wide: true },
        { k: "Device Memory",         v: (navigator.deviceMemory != null) ? String(navigator.deviceMemory) : "unavailable" },
        { k: "Hardware Concurrency",  v: (navigator.hardwareConcurrency != null) ? String(navigator.hardwareConcurrency) : "unavailable" },
        { k: "Architecture",          v: getHardwareArch() },
        { k: "Media Devices",         v: media || "unavailable" },
        { k: "Storage",               v: storage || "unavailable" }
      ],
      software: [
        { k: "Timing Resolution",     v: timingRes, mono: true, wide: true },
        { k: "Stack Overflow Counter",v: String(stackCount) },
        { k: "Plugins",               v: pluginsHash, mono: true },
        { k: "Canvas",                v: canvasHash, mono: true }
      ],
      network: [
        { k: "User Agent",            v: navigator.userAgent || "unavailable", wide: true },
        { k: "Name",                  v: uaInfo.name },
        { k: "OS",                    v: uaInfo.os },
        { k: "Architecture",          v: uaInfo.arch },
        { k: "Version",               v: uaInfo.version || "unavailable" },
        { k: "WebRTC IP",             v: webrtcIp || "unavailable", mono: true },
        { k: "Accept Language",       v: (navigator.languages && navigator.languages.length)
                                        ? navigator.languages.join(",")
                                        : (navigator.language || "unavailable"), wide: true }
      ],
      browser: [
        { k: "User Agent",            v: navigator.userAgent || "unavailable", wide: true },
        { k: "Name",                  v: uaInfo.name },
        { k: "OS",                    v: uaInfo.os },
        { k: "Languages",             v: (navigator.languages && navigator.languages.length)
                                        ? navigator.languages.join(", ")
                                        : (navigator.language || "unavailable"), wide: true },
        { k: "Language Tag",          v: navigator.language || "unavailable" },
        { k: "Timezone",              v: (function () {
            try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "unavailable"; }
            catch (e) { return "unavailable"; }
          })() },
        { k: "Timezone Offset",       v: getTimezoneOffsetStr() },
        { k: "Timezone Text",         v: getTimezoneText() },
        { k: "Dom Tags Snapshot",     v: domTagsHash, mono: true },
        { k: "Client Rects",          v: rectsHash, mono: true },
        { k: "SVG Computed Style",    v: svgStyle, mono: true },
        { k: "Mime Types",            v: mimeHash, mono: true },
        { k: "MX Score",              v: mxScore }
      ],
      location: [
        { k: "IP",                    v: loc.ip || "unavailable", mono: true },
        { k: "Country Code",          v: loc.countryCode || "unavailable" },
        { k: "Country",               v: loc.country || "unavailable" },
        { k: "State",                 v: loc.state || "unavailable" },
        { k: "City",                  v: loc.city || "unavailable" },
        { k: "Timezone",              v: loc.timezone || "unavailable" },
        { k: "Timezone Offset",       v: loc.timezoneOffset || "unavailable" },
        { k: "Geolocation",           v: loc.geolocation || "unavailable", mono: true },
        { k: "ISP",                   v: loc.isp || "unavailable" },
        { k: "ASN",                   v: loc.asn || "unavailable" },
        { k: "Risk Score",            v: loc.riskScore || "unavailable" },
        { k: "Risk",                  v: loc.risk || "unavailable" },
        { k: "ISP Risk",              v: loc.ispRisk || "unavailable" },
        { k: "ISP Risk Score",        v: loc.ispRiskScore || "unavailable" },
        { k: "Datacenter",            v: loc.datacenter || "unavailable" },
        { k: "VPN",                   v: loc.vpn || "unavailable" },
        { k: "Blacklisted External",  v: loc.blacklisted || "unavailable" },
        { k: "Amazon AWS",            v: loc.amazonAws || "unavailable" },
        { k: "Apple iCloud Private Relay", v: loc.appleIcloud || "unavailable" },
        { k: "Google",                v: loc.google || "unavailable" }
      ],
      bot: [
        { k: "hasCDP",       v: String(bot.hasCDP),       badge: bot.hasCDP ? "bad" : "ok" },
        { k: "hasWebdriver", v: String(bot.hasWebdriver), badge: bot.hasWebdriver ? "bad" : "ok" },
        { k: "hasUserAgent", v: String(bot.hasUserAgent), badge: bot.hasUserAgent ? "ok" : "bad" },
        { k: "hasNavigator", v: String(bot.hasNavigator), badge: bot.hasNavigator ? "ok" : "bad" }
      ]
    };

    renderFpGroups(data);
    fpCollecting = false;
    return data;
  }).catch(function (e) {
    fpCollecting = false;
    if (dom.fpGroups) {
      dom.fpGroups.innerHTML = '<div class="empty-state">Fingerprint unavailable</div>';
    }
    return null;
  });
}

var FP_GROUP_ORDER = [
  { id: "signals",  title: "SIGNALS"  },
  { id: "hardware", title: "HARDWARE" },
  { id: "software", title: "SOFTWARE" },
  { id: "network",  title: "NETWORK"  },
  { id: "browser",  title: "BROWSER"  },
  { id: "location", title: "LOCATION" },
  { id: "bot",      title: "BOT"      }
];

function renderFpGroups(data) {
  if (!dom.fpGroups) return;
  var html = "";
  for (var gi = 0; gi < FP_GROUP_ORDER.length; gi++) {
    var grp = FP_GROUP_ORDER[gi];
    var rows = data[grp.id];
    if (!rows || !rows.length) continue;

    var rowHtml = "";
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      if (r.v == null || r.v === "") continue;
      var cls = "fp-row";
      if (r.wide) cls += " wide";
      if (r.mono) cls += " mono";
      var safeV = escapeHtml(String(r.v));
      var valHtml;
      if (r.badge) {
        valHtml = '<span class="fp-badge ' + r.badge + '">' + safeV + '</span>';
      } else {
        valHtml = safeV;
      }
      rowHtml += '<div class="' + cls + '" data-copy="' + safeV + '" title="Click to copy">' +
                   '<span class="fp-k">' + escapeHtml(r.k) + '</span>' +
                   '<span class="fp-v" title="' + safeV + '">' + valHtml + '</span>' +
                 '</div>';
    }
    if (!rowHtml) continue;

    html += '<div class="fp-group">' +
              '<div class="fp-group-title">' + escapeHtml(grp.title) + '</div>' +
              '<div class="fp-rows">' + rowHtml + '</div>' +
            '</div>';
  }
  dom.fpGroups.innerHTML = html || '<div class="empty-state">No fingerprint data available</div>';
}

function refreshFingerprint() {
  if (!S.fingerprint) {
    if (dom.fpGroups) {
      dom.fpGroups.innerHTML = '<div class="empty-state">Fingerprint collection is disabled in settings</div>';
    }
    return;
  }
  collectFingerprint();
}

function getLocalIPs() {
  return getWebRTCIPs().then(function (r) {
    return { v4: r.local.filter(function (x) { return x.indexOf(".") >= 0; }),
             v6: r.local.filter(function (x) { return x.indexOf(":") >= 0; }) };
  });
}

function getPlatformInfo() {
  var p = parseUAInfo();
  var out = {
    browser: p.name + (p.version ? " " + p.version.split(".")[0] : ""),
    os: p.os
  };

  var ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) out.device = "Tablet";
  else if (/Mobile|iPhone|iPod/.test(ua)) out.device = "Mobile";
  else out.device = "Desktop";

  try {
    if (screen && screen.width && screen.height) {
      out.screen = screen.width + " × " + screen.height + (screen.colorDepth ? " @ " + screen.colorDepth + "-bit" : "");
    }
  } catch (e) {}
  if (window.innerWidth && window.innerHeight) {
    out.viewport = window.innerWidth + " × " + window.innerHeight;
  }
  try {
    if (navigator.language) out.language = navigator.language + (navigator.languages && navigator.languages.length > 1 ? " (+" + (navigator.languages.length - 1) + ")" : "");
  } catch (e) {}
  return out;
}

function renderInfo(info) {
  if (!dom.infoGrid) return;
  var rows = [];
  function add(k, v, cls) {
    if (v == null || v === "" || v === "—") return;
    var safe = escapeHtml(v);
    rows.push('<div class="info-row' + (cls ? " " + cls : "") + '" data-copy="' + safe + '" title="Tap to copy">' +
              '<span class="k">' + escapeHtml(k) + '</span>' +
              '<span class="v" title="' + safe + '">' + safe + "</span></div>");
  }
  add("IPv4 address", info.ipv4, "v4");
  add("IPv6 address", info.ipv6, "v6");
  add("Local IPv4 (LAN)", info.localV4);
  add("Local IPv6 (LAN)", info.localV6);
  add("Primary IP", info.ip);
  add("ISP", info.isp);
  add("ASN", info.asn ? "AS" + info.asn : "");
  add("City", info.city);
  add("Region", info.region);
  add("Country", info.country);
  add("Edge node", info.colo);
  add("Protocol", info.protocol);
  add("Timezone", info.tz);
  add("Server", info.server || "Cloudflare edge");
  add("Test engine", useFetchEngine() ? "Fetch streams" : "XHR");
  add("Streams", String(S.parallel));
  add("Data used (last test)", info.dataUsed);

  add("Browser", info.browser);
  add("Operating system", info.os);
  add("Device type", info.device);
  add("Screen", info.screen);
  add("Viewport", info.viewport);
  add("Language", info.language);

  try {
    var nc = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (nc) {
      if (nc.effectiveType) add("Effective type", String(nc.effectiveType).toUpperCase());
      if (nc.downlink) add("Browser estimate ↓", nc.downlink + " Mbps");
      if (nc.rtt) add("Browser RTT", nc.rtt + " ms");
      if (nc.saveData) add("Data saver", nc.saveData ? "On" : "Off");
    }
  } catch (e) {}

  if (navigator.hardwareConcurrency) add("CPU threads", navigator.hardwareConcurrency);
  if (navigator.deviceMemory) add("Device memory", navigator.deviceMemory + " GB");

  dom.infoGrid.innerHTML = rows.length ? rows.join("") :
    '<div class="empty-state">No connection details available</div>';
}

function updateChips(info) {
  function setChip(chip, label, value, cls) {
    if (!chip) return;
    chip.classList.remove("loading");
    var safe = escapeHtml(value);
    chip.innerHTML = '<i class="dot"></i>' + label + ': <b class="' + (cls || "") + '">' + safe + "</b>";
    chip.setAttribute("data-copy", value == null ? "" : String(value));
  }
  setChip(dom.chipIp, "IPv4", info.ipv4 || info.ip || "unavailable", "v4");
  setChip(dom.chipIp6, "IPv6", info.ipv6 || "unavailable", "v6");
  setChip(dom.chipIsp, "ISP", info.isp || "unknown");

  if (dom.chipLoc) {
    var loc = [info.city, info.country].filter(Boolean).join(", ") || "unknown";
    dom.chipLoc.classList.remove("loading");
    dom.chipLoc.innerHTML = 'Location: <b>' + escapeHtml(loc) + "</b>";
    dom.chipLoc.setAttribute("data-copy", loc);
  }
}

function fetchConnectionInfo() {
  var out = {};

  var ipv4P = withTimeout(fetchJSON("https://api.ipify.org?format=json", null, 5000), 5500)
    .then(function (r) { return (r && r.ip) || ""; })
    .catch(function () { return ""; });

  var ipv6P = withTimeout(fetchJSON("https://api6.ipify.org?format=json", null, 5000), 5500)
    .then(function (r) { return (r && r.ip) || ""; })
    .catch(function () { return ""; });

  return fetchJSON(metaUrl(), null, 6000).then(function (m) {
    out.ip = toStr(m.clientIp || m.ip || m.query || "");
    out.isp = toStr(m.asOrganization || m.isp || m.org || "");
    out.asn = toStr(m.asn || "");
    out.city = toStr(m.city || "");
    out.region = toStr(m.region || m.regionName || "");
    out.country = toStr(m.country || "");
    out.colo = toStr(m.colo || m.coloCode || m.edge || "");
    out.protocol = toStr(m.httpProtocol || "");
    out.tz = toStr(m.timezone || "");
    out.server = "Cloudflare edge";
    return out;
  }).catch(function () { return out; }).then(function (info) {
    var chain = Promise.resolve(info);

    if (!info.ip) {
      chain = chain.then(function (o) {
        return withTimeout(fetchJSON("https://api.ipify.org?format=json", null, 5000), 5500)
          .then(function (r) { o.ip = toStr(r.ip); return o; })
          .catch(function () { return o; });
      });
    }

    if (!info.isp && info.ip) {
      chain = chain.then(function (o) {
        return withTimeout(fetchJSON("https://ipwho.is/", null, 6000), 6500)
          .then(function (r) {
            if (r && r.success !== false) {
              o.isp = toStr(o.isp || (r.connection && r.connection.isp) || r.isp || "");
              o.asn = toStr(o.asn || (r.connection && r.connection.asn) || "");
              o.city = toStr(o.city || r.city || "");
              o.region = toStr(o.region || r.region || "");
              o.country = toStr(o.country || r.country || "");
              o.tz = toStr(o.tz || (r.timezone && r.timezone.id) || "");
            }
            return o;
          })
          .catch(function () { return o; });
      });
    }

    return chain.then(function (o) {
      return Promise.all([ipv4P, ipv6P]).then(function (ips) {
        o.ipv4 = ips[0] || "";
        o.ipv6 = ips[1] || "";
        if (!o.ip) o.ip = o.ipv4 || o.ipv6 || "";
        return o;
      });
    });
  }).then(function (o) {
    if (!S.webrtcLocalIp) return o;
    return getLocalIPs().then(function (local) {
      if (local.v4.length) o.localV4 = local.v4.join(", ");
      if (local.v6.length) o.localV6 = local.v6.join(", ");
      return o;
    });
  }).then(function (o) {
    if (S.platformInfo) {
      var p = getPlatformInfo();
      if (p.browser) o.browser = p.browser;
      if (p.os) o.os = p.os;
      if (p.device) o.device = p.device;
      if (p.screen) o.screen = p.screen;
      if (p.viewport) o.viewport = p.viewport;
      if (p.language) o.language = p.language;
    }
    return o;
  });
}

function pingOnce(signal) {
  var url = buildUrl("customDownPath", 0);
  var t0 = now();
  return withTimeout(
    fetch(url, { cache: "no-store", credentials: "omit", mode: "cors", signal: signal })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      }),
    (Number(S.timeout) || 20) * 1000
  ).then(function () {
    return now() - t0;
  });
}

function runPingPhase(signal, onProgress) {
  var samples = [];
  var fails = 0;
  var total = Number(S.pingCount) || 12;
  var chain = Promise.resolve();

  if (S.warmup) {
    chain = chain.then(function () {
      return pingOnce(signal).catch(function () {});
    });
  }

  for (var i = 0; i < total; i++) {
    (function (idx) {
      chain = chain.then(function () {
        if (aborted) return;
        setPhaseLabel("Ping " + (idx + 1) + "/" + total);
        onProgress(idx / total);
        return pingOnce(signal).then(function (rtt) {
          samples.push(rtt);
          requestCount++;
          var avg = samples.reduce(function (a, b) { return a + b; }, 0) / samples.length;
          if (dom.vPing) dom.vPing.innerHTML = avg.toFixed(1) + '<span class="m-unit">ms</span>';
          updateGaugeNeedle(0);
          if (dom.gaugeValue) dom.gaugeValue.textContent = avg.toFixed(1);
          if (dom.gaugeUnit) dom.gaugeUnit.textContent = "ms";
        }).catch(function (e) {
          if (e && e.name === "AbortError") return;
          if (aborted) return;
          fails++;
          requestCount++;
        }).then(function () {
          return sleep(35);
        });
      });
    })(i);
  }

  return chain.then(function () {
    onProgress(1);
    var res = { samples: samples, fails: fails, total: total };
    if (samples.length) {
      var sorted = samples.slice().sort(function (a, b) { return a - b; });
      res.min = sorted[0];
      res.max = sorted[sorted.length - 1];
      res.median = sorted[Math.floor(sorted.length / 2)];
      res.avg = samples.reduce(function (a, b) { return a + b; }, 0) / samples.length;

      var diffs = [];
      for (var i = 1; i < samples.length; i++) diffs.push(Math.abs(samples[i] - samples[i - 1]));
      res.jitter = diffs.length ? diffs.reduce(function (a, b) { return a + b; }, 0) / diffs.length : 0;
    } else {
      res.min = res.max = res.median = res.avg = res.jitter = 0;
    }
    res.loss = total > 0 ? (fails / total) * 100 : 0;
    return res;
  });
}

function initialChunkBytes() {
  var minB = (Number(S.minChunkKB) || 256) * 1024;
  return Math.max(minB, 512 * 1024);
}

function maxChunkBytes() {
  return (Number(S.maxChunkMB) || 64) * 1024 * 1024;
}

function minChunkBytes() {
  return (Number(S.minChunkKB) || 256) * 1024;
}

function downloadWorker(deadline, signal, onBytes) {
  var chunk = initialChunkBytes();
  var useFetch = useFetchEngine();
  var timeoutMs = (Number(S.timeout) || 20) * 1000;
  var consecutiveErrors = 0;

  function step() {
    if (aborted) return Promise.resolve();
    var t = now();
    if (t >= deadline) return Promise.resolve();
    var remaining = deadline - t;
    if (remaining < 600) return Promise.resolve();

    var url = buildUrl("customDownPath", chunk);
    var t0 = now();
    var got = 0;

    function collect(n) {
      got += n;
      if (now() <= deadline) onBytes(n);
    }

    activeStreams++;
    setStatus();

    var p = useFetch
      ? fetchDownload(url, signal, collect)
      : xhrDownload(url, signal, collect, timeoutMs);

    return p.then(function () {
      activeStreams--;
      setStatus();
      consecutiveErrors = 0;
      if (S.adaptive) {
        var dt = Math.max(1, now() - t0);
        var bps = got / (dt / 1000);
        var target = clamp(bps * 1.6, minChunkBytes(), maxChunkBytes());
        chunk = Math.round(target);
      }
      return step();
    }).catch(function (err) {
      activeStreams--;
      setStatus();
      if (aborted || (err && err.name === "AbortError")) return;
      lossCount++;
      consecutiveErrors++;
      chunk = Math.max(minChunkBytes(), Math.floor(chunk / 2));
      if (consecutiveErrors > 8) return;
      return sleep(Math.min(800, 120 * consecutiveErrors)).then(step);
    });
  }

  return step();
}

function uploadWorker(deadline, signal, onBytes) {
  var chunk = Math.max(minChunkBytes(), 256 * 1024);
  var timeoutMs = (Number(S.timeout) || 20) * 1000;
  var consecutiveErrors = 0;

  function step() {
    if (aborted) return Promise.resolve();
    var t = now();
    if (t >= deadline) return Promise.resolve();
    if (deadline - t < 600) return Promise.resolve();

    var url = buildUrl("customUpPath", chunk);
    var blob = makeUploadBlob(chunk);
    var t0 = now();
    var got = 0;

    function collect(nb) {
      got += nb;
      if (now() <= deadline) onBytes(nb);
    }

    activeStreams++;
    setStatus();

    return xhrUpload(url, blob, signal, collect, timeoutMs).then(function () {
      activeStreams--;
      setStatus();
      consecutiveErrors = 0;
      if (S.adaptive) {
        var dt = Math.max(1, now() - t0);
        var bps = got / (dt / 1000);
        var target = clamp(bps * 1.6, minChunkBytes(), Math.min(maxChunkBytes(), 32 * 1024 * 1024));
        chunk = Math.round(target);
      }
      return step();
    }).catch(function (err) {
      activeStreams--;
      setStatus();
      if (aborted || (err && err.name === "AbortError")) return;
      lossCount++;
      consecutiveErrors++;
      chunk = Math.max(64 * 1024, Math.floor(chunk / 2));
      if (consecutiveErrors > 8) return;
      return sleep(Math.min(800, 120 * consecutiveErrors)).then(step);
    });
  }

  return step();
}

function runTransferPhase(kind, durationSec, signal, onProgress) {
  var durationMs = Math.max(2000, (Number(durationSec) || 10) * 1000);
  var deadline = now() + durationMs;
  var n = Math.max(1, Math.min(16, Number(S.parallel) || 6));

  var workers = [];
  for (var i = 0; i < n; i++) {
    workers.push(
      kind === "download"
        ? downloadWorker(deadline, signal, meterAdd)
        : uploadWorker(deadline, signal, meterAdd)
    );
  }

  return Promise.all(workers).then(function () {
    onProgress(1);
  });
}

function computeFinalSpeed(samples) {
  if (!samples || samples.length < 3) {
    if (samples && samples.length) {
      return samples[samples.length - 1].v;
    }
    return 0;
  }
  var t0 = samples[0].t;
  var t1 = samples[samples.length - 1].t;
  var skipUntil = t0 + (t1 - t0) * 0.22;

  var arr = [];
  for (var i = 0; i < samples.length; i++) {
    if (samples[i].t >= skipUntil) arr.push(samples[i].v);
  }
  if (arr.length < 4) arr = samples.map(function (s) { return s.v; });

  arr.sort(function (a, b) { return a - b; });
  var lo = Math.floor(arr.length * 0.15);
  var hi = Math.ceil(arr.length * 0.9);
  var slice = arr.slice(lo, hi);
  if (!slice.length) slice = arr;

  var sum = 0;
  for (var j = 0; j < slice.length; j++) sum += slice[j];
  return sum / slice.length;
}

function startLoop() {
  lastMarkTime = 0;
  function frame() {
    if (!running) return;
    var t = now();
    if (t - lastMarkTime > 100) {
      meterTick();
      lastMarkTime = t;
    }
    var spd = meterSpeed(1500);
    var disp = toDisplay(spd);

    if (dom.gaugeValue && currentPhaseIsSpeed) {
      dom.gaugeValue.textContent = fmtSpeed(spd);
      if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(spd);
      updateGaugeNeedle(disp);
    }

    setStatus();

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function sampleTick(phase) {
  var v = meterSpeed(1200);
  chartPoints.push({ t: now(), v: v, phase: phase });
  if (chartPoints.length > 1200) chartPoints.shift();
  phaseSamples.push({ t: now(), v: v });
  if (phase === "download" && v > peakDown) peakDown = v;
  if (phase === "upload" && v > peakUp) peakUp = v;
  if (phase === "download" && dom.sDown) {
    dom.sDown.textContent = "peak " + fmtSpeed(peakDown) + " " + unitLabelFor(peakDown);
  } else if (phase === "upload" && dom.sUp) {
    dom.sUp.textContent = "peak " + fmtSpeed(peakUp) + " " + unitLabelFor(peakUp);
  }
  drawChart();
}

function requestWakeLock() {
  if (!S.wakeLock) return Promise.resolve();
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      return navigator.wakeLock.request("screen").then(function (s) {
        wakeLockSentinel = s;
      }).catch(function () {});
    }
  } catch (e) {}
  return Promise.resolve();
}

function releaseWakeLock() {
  try {
    if (wakeLockSentinel) {
      wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (e) {}
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && running && S.wakeLock) {
    requestWakeLock();
  }
});

var sampleTimer = null;

function startTest() {
  if (running) return;
  running = true;
  aborted = false;
  lossCount = 0;
  requestCount = 0;
  currentResults = null;
  chartPoints = [];
  phaseSamples = [];
  meterReset();
  resetMetricsUI();
  hideGrade();
  blobCache = null;
  dataCapWarned = false;
  peakDown = 0;
  peakUp = 0;

  dom.btnStart.disabled = true;
  dom.btnStartLbl.textContent = "Testing…";
  dom.btnStop.hidden = false;
  setPhaseLabel("Starting…");
  setProgress(0);
  if (dom.gaugeValue) dom.gaugeValue.textContent = "0.00";
  if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(0);
  if (dom.chartEmpty) dom.chartEmpty.style.display = "none";

  testStartTime = now();
  chartStart = testStartTime;

  var order = S.testOrder;
  var phases = [];
  phases.push("ping");
  if (order === "full") { phases.push("download"); phases.push("upload"); }
  else if (order === "full-up") { phases.push("upload"); phases.push("download"); }
  else if (order === "download") { phases.push("download"); }
  else if (order === "upload") { phases.push("upload"); }

  var pingEst = (Number(S.pingCount) || 12) * 120 + 400;
  var dlEst = phases.indexOf("download") >= 0 ? (Number(S.downloadDuration) || 10) * 1000 : 0;
  var ulEst = phases.indexOf("upload") >= 0 ? (Number(S.uploadDuration) || 10) * 1000 : 0;
  expectedTotalMs = pingEst + dlEst + ulEst + 1200;
  chartTotalMs = expectedTotalMs;

  var weights = { ping: 0.12, download: 0.44, upload: 0.44 };
  var totalWeight = phases.reduce(function (a, p) { return a + weights[p]; }, 0);

  var results = {
    timestamp: Date.now(),
    ping: null,
    download: null,
    upload: null,
    connection: null,
    server: S.serverPreset === "custom" ? (S.customBase || "custom") : "Cloudflare edge",
    unit: S.unit,
    userAgent: navigator.userAgent,
    parallel: S.parallel,
    preset: getActivePreset()
  };

  var metaPromise = S.ipLookup ? fetchConnectionInfo() : Promise.resolve(null);

  requestWakeLock();
  startLoop();

  var completedWeight = 0;

  function phaseProgress(p) {
    setProgress((completedWeight + p * weights[currentPhaseName]) / totalWeight);
  }

  var currentPhaseName = "ping";

  metaPromise.then(function (info) {
    if (info) {
      results.connection = info;
      renderInfo(info);
      updateChips(info);
      if (!running) return;
    }
  });

  function runNext(index) {
    if (aborted || index >= phases.length) return Promise.resolve();

    var phase = phases[index];
    currentPhaseName = phase;
    phaseController = new AbortCtor();
    var signal = phaseController.signal;

    if (phase !== "ping") {
      phaseSamples = [];
      meterReset();
      meter.marks = [{ t: now(), b: 0 }];
    }

    if (phase === "ping") {
      currentPhaseIsSpeed = false;
      highlightMetric(dom.mPing);
      setPhaseLabel("Measuring latency…");
      if (dom.gaugeUnit) dom.gaugeUnit.textContent = "ms";

      return runPingPhase(signal, phaseProgress).then(function (res) {
        results.ping = res;
        if (res.samples.length) {
          if (dom.vPing) dom.vPing.innerHTML = res.median.toFixed(1) + '<span class="m-unit">ms</span>';
          if (dom.sPing) dom.sPing.textContent = "min " + res.min.toFixed(1) + " · max " + res.max.toFixed(1) + " · avg " + res.avg.toFixed(1);
          if (dom.vJitter) dom.vJitter.innerHTML = res.jitter.toFixed(1) + '<span class="m-unit">ms</span>';
          if (dom.sJitter) {
            var jt = res.jitter < 5 ? "Excellent" : res.jitter < 15 ? "Good" : res.jitter < 40 ? "Fair" : res.jitter < 100 ? "Variable" : "Poor";
            dom.sJitter.textContent = jt;
          }
          if (dom.vLoss) dom.vLoss.innerHTML = res.loss.toFixed(res.loss === 0 ? 0 : 1) + '<span class="m-unit">%</span>';
          if (dom.sLoss) {
            var lt = res.loss === 0 ? "No loss detected" : res.loss < 1 ? "Very low" : res.loss < 3 ? "Moderate" : "High";
            dom.sLoss.textContent = lt;
          }
        } else {
          if (dom.sPing) dom.sPing.textContent = "Failed";
          if (dom.vPing) dom.vPing.innerHTML = "N/A";
        }
        if (dom.gaugeValue) dom.gaugeValue.textContent = res.median ? res.median.toFixed(1) : "—";
        completedWeight += weights.ping;
        setProgress(completedWeight / totalWeight);
        return runNext(index + 1);
      });
    }

    currentPhaseIsSpeed = true;
    var isDown = (phase === "download");
    highlightMetric(isDown ? dom.mDown : dom.mUp);
    setPhaseLabel(isDown ? "Testing download…" : "Testing upload…");
    if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(0);
    updateGaugeNeedle(0);

    var dur = isDown ? S.downloadDuration : S.uploadDuration;
    var deadline = now() + dur * 1000;

    if (sampleTimer) clearInterval(sampleTimer);
    sampleTimer = setInterval(function () {
      if (!running) return;
      sampleTick(phase);
    }, 180);

    return runTransferPhase(phase, dur, signal, phaseProgress).then(function () {
      if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
      sampleTick(phase);

      var finalBps = computeFinalSpeed(phaseSamples);
      var elapsed = (now() - (deadline - dur * 1000)) / 1000;
      var stability = computeStability(phaseSamples);
      var entry = {
        bps: finalBps,
        bytes: meter.total,
        seconds: elapsed,
        requests: requestCount,
        peak: isDown ? peakDown : peakUp,
        stability: stability ? stability.label : null,
        cv: stability ? stability.cv : null
      };

      if (isDown) {
        results.download = entry;
        if (dom.vDown) dom.vDown.innerHTML = fmtSpeed(finalBps) + '<span class="m-unit">' + unitLabelFor(finalBps) + "</span>";
        if (dom.sDown) dom.sDown.textContent = fmtBytes(meter.total) + " · peak " + fmtSpeed(peakDown) + " " + unitLabelFor(peakDown);
        if (dom.gaugeValue) dom.gaugeValue.textContent = fmtSpeed(finalBps);
        if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(finalBps);
        updateGaugeNeedle(toDisplay(finalBps));
        if (dom.vStability && stability) {
          dom.vStability.innerHTML = escapeHtml(stability.label) + '<span class="m-unit"></span>';
          if (dom.sStability) dom.sStability.textContent = "download variance";
        }
      } else {
        results.upload = entry;
        if (dom.vUp) dom.vUp.innerHTML = fmtSpeed(finalBps) + '<span class="m-unit">' + unitLabelFor(finalBps) + "</span>";
        if (dom.sUp) dom.sUp.textContent = fmtBytes(meter.total) + " · peak " + fmtSpeed(peakUp) + " " + unitLabelFor(peakUp);
        if (dom.gaugeValue) dom.gaugeValue.textContent = fmtSpeed(finalBps);
        if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(finalBps);
        updateGaugeNeedle(toDisplay(finalBps));
        if (dom.vStability && stability && (!results.download || !results.download.stability)) {
          dom.vStability.innerHTML = escapeHtml(stability.label) + '<span class="m-unit"></span>';
          if (dom.sStability) dom.sStability.textContent = "upload variance";
        }
      }

      completedWeight += weights[phase];
      setProgress(completedWeight / totalWeight);

      return sleep(120).then(function () { return runNext(index + 1); });
    });
  }

  runNext(0).then(function () {
    finishTest(results);
  }).catch(function (err) {
    if (aborted) return;
    console.error(err);
    toast("Test error: " + (err && err.message ? err.message : "unknown"), "err");
    finishTest(results);
  });
}

function finishTest(results) {
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  stopLoop();
  releaseWakeLock();

  running = false;
  dom.btnStart.disabled = false;
  dom.btnStartLbl.textContent = "Test Again";
  dom.btnStop.hidden = true;
  currentPhaseIsSpeed = false;
  highlightMetric(null);

  if (aborted) {
    setPhaseLabel("Cancelled");
  } else {
    setPhaseLabel("Complete");
  }
  setProgress(1);
  setStatus();

  if (results && results.connection) {
    results.connection.dataUsed = fmtBytes(meter.total);
  } else if (results) {
    results.connection = { dataUsed: fmtBytes(meter.total) };
  }
  if (results && (results.download || results.upload || results.ping) && S.saveHistory) {
    results.connection = results.connection || {};
    Store.history.unshift(results);
    var limit = Number(S.historyLimit) || 25;
    if (Store.history.length > limit) Store.history.length = limit;
    saveStore();
    renderHistory();
  }

  currentResults = results;

  if (!aborted) {
    var showBps = 0;
    if (results.download) showBps = results.download.bps;
    else if (results.upload) showBps = results.upload.bps;
    if (showBps) {
      if (dom.gaugeValue) dom.gaugeValue.textContent = fmtSpeed(showBps);
      if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(showBps);
    }
    setPhaseLabel("Complete");
    showGrade(results);
    toast("Test complete", "ok");
  } else {
    toast("Test cancelled");
  }

  if (S.autoCopy && currentResults && !aborted) {
    copySummary(true);
  }
}

function abortTest() {
  if (!running) return;
  aborted = true;
  if (phaseController) {
    try { phaseController.abort(); } catch (e) {}
  }
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  setPhaseLabel("Cancelling…");
}

var PRESETS = {
  quick:    { downloadDuration: 5,  uploadDuration: 5,  pingCount: 6,  parallel: 4 },
  standard: { downloadDuration: 10, uploadDuration: 10, pingCount: 12, parallel: 6 },
  thorough: { downloadDuration: 30, uploadDuration: 30, pingCount: 20, parallel: 8 }
};

function getActivePreset() {
  for (var k in PRESETS) {
    if (!PRESETS.hasOwnProperty(k)) continue;
    var p = PRESETS[k];
    if (Number(S.downloadDuration) === p.downloadDuration &&
        Number(S.uploadDuration) === p.uploadDuration &&
        Number(S.pingCount) === p.pingCount &&
        Number(S.parallel) === p.parallel) return k;
  }
  return "custom";
}

function applyPreset(name) {
  var p = PRESETS[name];
  if (!p) return;
  S.downloadDuration = p.downloadDuration;
  S.uploadDuration = p.uploadDuration;
  S.pingCount = p.pingCount;
  S.parallel = p.parallel;
  saveStore();
  syncPresetButtons();
  toast("Preset applied: " + name, "ok", 1600);
}

function syncPresetButtons() {
  if (!dom.presetRow) return;
  var active = getActivePreset();
  $$(".preset-btn", dom.presetRow).forEach(function (b) {
    b.classList.toggle("active", b.getAttribute("data-preset") === active);
  });
}

function summaryText(r) {
  if (!r) return "";
  var lines = [];
  lines.push("Donut Internet Speed Test — " + new Date(r.timestamp).toLocaleString());
  lines.push("-------------------------------------------------");
  if (r.download) lines.push("Download : " + fmtSpeed(r.download.bps) + " " + unitLabelFor(r.download.bps) +
    (r.download.peak ? " (peak " + fmtSpeed(r.download.peak) + ")" : ""));
  if (r.upload)   lines.push("Upload   : " + fmtSpeed(r.upload.bps) + " " + unitLabelFor(r.upload.bps) +
    (r.upload.peak ? " (peak " + fmtSpeed(r.upload.peak) + ")" : ""));
  if (r.ping) {
    lines.push("Ping     : " + r.ping.median.toFixed(1) + " ms (min " + r.ping.min.toFixed(1) + ", max " + r.ping.max.toFixed(1) + ")");
    lines.push("Jitter   : " + r.ping.jitter.toFixed(1) + " ms");
    lines.push("Loss     : " + r.ping.loss.toFixed(1) + " %");
  }
  var grade = computeGrade(r);
  if (grade) lines.push("Grade    : " + grade.grade + " (" + grade.score + "/100)");
  var c = r.connection || {};
  if (c.ipv4) lines.push("IPv4     : " + c.ipv4);
  if (c.ipv6) lines.push("IPv6     : " + c.ipv6);
  if (c.localV4) lines.push("Local v4 : " + c.localV4);
  if (c.localV6) lines.push("Local v6 : " + c.localV6);
  if (c.ip && !c.ipv4 && !c.ipv6) lines.push("IP       : " + c.ip);
  if (c.isp) lines.push("ISP      : " + c.isp);
  if (c.city || c.country) lines.push("Location : " + [c.city, c.region, c.country].filter(Boolean).join(", "));
  if (c.browser) lines.push("Browser  : " + c.browser + (c.os ? " on " + c.os : ""));
  if (c.device) lines.push("Device   : " + c.device);
  if (c.dataUsed) lines.push("Data     : " + c.dataUsed);
  lines.push("Server   : " + (r.server || "Cloudflare edge"));
  return lines.join("\n");
}

function copySummary(silent) {
  var txt = summaryText(currentResults || (Store.history[0] || null));
  if (!txt) { if (!silent) toast("No results to copy"); return; }
  copyToClipboard(txt).then(function (ok) {
    if (!silent && ok) toast("Result copied to clipboard", "ok");
    else if (!silent) toast("Copy failed", "err");
  });
}

function download(filename, content, mime) {
  try {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
    return true;
  } catch (e) {
    toast("Download failed", "err");
    return false;
  }
}

function saveChart() {
  if (!dom.chart) { toast("No chart to save"); return; }
  try {
    if (!chartPoints.length) { toast("Run a test first"); return; }
    var rect = dom.chart.getBoundingClientRect();
    if (!rect.width || !rect.height) { toast("Chart not visible"); return; }
    var scale = 2;
    var exportW = Math.round(rect.width * scale);
    var exportH = Math.round(rect.height * scale);
    var off = document.createElement("canvas");
    off.width = exportW;
    off.height = exportH;
    var octx = off.getContext("2d");

    octx.fillStyle = cssVar("--bg", "#070b14");
    octx.fillRect(0, 0, exportW, exportH);

    var w = exportW, h = exportH;
    var accentDl = cssVar("--accent", "#22d3ee");
    var accentUl = cssVar("--accent-2", "#a855f7");
    var gridCol = cssVar("--text-faint", "#6b7a9c");

    var topPad = 32;
    var bottomPad = 20;
    var leftPad = 4;
    var rightPad = 4;

    octx.save();
    octx.globalAlpha = 0.16;
    octx.strokeStyle = gridCol;
    octx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var yy = topPad + (h - topPad - bottomPad) * i / 4;
      octx.beginPath();
      octx.moveTo(0, yy);
      octx.lineTo(w, yy);
      octx.stroke();
    }
    octx.restore();

    if (chartPoints.length >= 2) {
      var vals = [];
      for (var vi = 0; vi < chartPoints.length; vi++) vals.push(chartPoints[vi].v);
      vals.sort(function (a, b) { return a - b; });
      var pIdx = Math.floor(vals.length * 0.95);
      var pVal = vals[pIdx] || 0;
      var absMax = vals[vals.length - 1] || 0;
      var maxV = Math.max(pVal * 1.15, absMax * 0.85, 1);

      var t0 = chartStart;
      var t1 = chartStart + chartTotalMs;
      var span = Math.max(1, t1 - t0);
      var innerW = w - leftPad - rightPad;
      var innerH = h - topPad - bottomPad;

      function px(t) { return leftPad + clamp((t - t0) / span, 0, 1) * innerW; }
      function py(v) { return clamp(h - bottomPad - (v / maxV) * innerH, topPad, h - bottomPad); }

      octx.lineWidth = 4;
      octx.lineJoin = "round";
      octx.lineCap = "round";
      for (var k = 1; k < chartPoints.length; k++) {
        var a = chartPoints[k - 1], b = chartPoints[k];
        var isUp = b.phase === "upload";
        octx.strokeStyle = isUp ? accentUl : accentDl;
        octx.globalAlpha = 0.95;
        octx.beginPath();
        octx.moveTo(px(a.t), py(a.v));
        octx.lineTo(px(b.t), py(b.v));
        octx.stroke();

        octx.globalAlpha = 0.09;
        octx.beginPath();
        octx.moveTo(px(a.t), h - bottomPad);
        octx.lineTo(px(a.t), py(a.v));
        octx.lineTo(px(b.t), py(b.v));
        octx.lineTo(px(b.t), h - bottomPad);
        octx.closePath();
        octx.fillStyle = isUp ? accentUl : accentDl;
        octx.fill();
      }
      octx.globalAlpha = 1;

      var lastP = chartPoints[chartPoints.length - 1];
      octx.beginPath();
      octx.arc(px(lastP.t), py(lastP.v), 6, 0, Math.PI * 2);
      octx.fillStyle = lastP.phase === "upload" ? accentUl : accentDl;
      octx.fill();

      octx.fillStyle = gridCol;
      octx.globalAlpha = 0.8;
      octx.font = "600 20px -apple-system,Segoe UI,Roboto,sans-serif";
      octx.textAlign = "left";
      octx.textBaseline = "top";
      octx.fillText(unitLabelFor(maxV) + " " + fmtSpeed(maxV).replace(/\.00$/, ""), 12, 6);
      octx.globalAlpha = 1;
    }

    var dataUrl = off.toDataURL("image/png");
    var a2 = document.createElement("a");
    a2.href = dataUrl;
    a2.download = "donut-speedtest-chart-" + Date.now() + ".png";
    document.body.appendChild(a2);
    a2.click();
    document.body.removeChild(a2);
    toast("Chart saved as PNG", "ok");
  } catch (e) {
    toast("Failed to save chart", "err");
  }
}

function historyToCsv() {
  var rows = [["Date", "Download", "Download unit", "Upload", "Upload unit", "Ping (ms)", "Jitter (ms)", "Loss (%)", "Grade", "Score", "IPv4", "IPv6", "Local IPv4", "Local IPv6", "ISP", "City", "Country", "Browser", "OS", "Device", "Data", "Server", "Preset"]];
  Store.history.forEach(function (r) {
    var c = r.connection || {};
    var g = computeGrade(r);
    rows.push([
      new Date(r.timestamp).toISOString(),
      r.download ? fmtSpeed(r.download.bps) : "",
      r.download ? unitLabelFor(r.download.bps) : "",
      r.upload ? fmtSpeed(r.upload.bps) : "",
      r.upload ? unitLabelFor(r.upload.bps) : "",
      r.ping ? r.ping.median.toFixed(1) : "",
      r.ping ? r.ping.jitter.toFixed(1) : "",
      r.ping ? r.ping.loss.toFixed(1) : "",
      g ? g.grade : "",
      g ? g.score : "",
      c.ipv4 || "", c.ipv6 || "", c.localV4 || "", c.localV6 || "",
      c.isp || "", c.city || "", c.country || "",
      c.browser || "", c.os || "", c.device || "",
      c.dataUsed || "",
      r.server || "",
      r.preset || ""
    ]);
  });
  return rows.map(function (row) {
    return row.map(function (cell) {
      var s = String(cell == null ? "" : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }).join("\n");
}

function renderSettings() {
  var root = dom.settingsBody;
  if (!root) return;
  root.innerHTML = "";

  SCHEMA.forEach(function (sec) {
    var wrap = el("div", "settings-section");
    wrap.appendChild(el("h3", null, sec.title));

    sec.items.forEach(function (item) {
      var row = el("div", "setting");
      var val = S[item.key];

      if (item.type === "toggle") {
        var txt = el("div", "setting-text");
        txt.appendChild(el("label", null, escapeHtml(item.label)));
        if (item.hint) txt.appendChild(el("div", "hint", escapeHtml(item.hint)));
        row.appendChild(txt);

        var sw = el("label", "switch");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!val;
        cb.setAttribute("data-key", item.key);
        cb.setAttribute("data-type", "toggle");
        sw.appendChild(cb);
        sw.appendChild(el("span", "slider"));
        row.appendChild(sw);

      } else if (item.type === "select") {
        var txt2 = el("div", "setting-text");
        txt2.appendChild(el("label", null, escapeHtml(item.label)));
        if (item.hint) txt2.appendChild(el("div", "hint", escapeHtml(item.hint)));
        row.appendChild(txt2);

        var sel = document.createElement("select");
        sel.setAttribute("data-key", item.key);
        sel.setAttribute("data-type", "select");
        item.options.forEach(function (opt) {
          var o = document.createElement("option");
          o.value = String(opt[0]);
          o.textContent = opt[1];
          if (String(val) === String(opt[0])) o.selected = true;
          sel.appendChild(o);
        });
        row.appendChild(sel);

      } else if (item.type === "range") {
        row.className = "setting col";
        var head = el("div", "range-row");
        var lbl = el("label", null, escapeHtml(item.label));
        head.appendChild(lbl);
        var vspan = el("span", "range-val", String(val));
        head.appendChild(vspan);
        row.appendChild(head);

        var rng = document.createElement("input");
        rng.type = "range";
        rng.min = item.min; rng.max = item.max; rng.step = item.step || 1;
        rng.value = val;
        rng.setAttribute("data-key", item.key);
        rng.setAttribute("data-type", "range");
        rng.setAttribute("data-valtarget", "1");
        row.appendChild(rng);
        if (item.hint) row.appendChild(el("div", "hint", escapeHtml(item.hint)));

      } else if (item.type === "number") {
        var txt3 = el("div", "setting-text");
        txt3.appendChild(el("label", null, escapeHtml(item.label)));
        if (item.hint) txt3.appendChild(el("div", "hint", escapeHtml(item.hint)));
        row.appendChild(txt3);

        var num = document.createElement("input");
        num.type = "number";
        num.value = val;
        if (item.min != null) num.min = item.min;
        if (item.max != null) num.max = item.max;
        num.setAttribute("data-key", item.key);
        num.setAttribute("data-type", "number");
        row.appendChild(num);

      } else if (item.type === "text") {
        row.className = "setting col";
        var lbl2 = el("label", null, escapeHtml(item.label));
        row.appendChild(lbl2);
        var inp = document.createElement("input");
        inp.type = "text";
        inp.value = val || "";
        inp.placeholder = item.placeholder || "";
        inp.setAttribute("data-key", item.key);
        inp.setAttribute("data-type", "text");
        inp.style.width = "100%";
        row.appendChild(inp);
        if (item.hint) row.appendChild(el("div", "hint", escapeHtml(item.hint)));

      } else if (item.type === "color") {
        var txt4 = el("div", "setting-text");
        txt4.appendChild(el("label", null, escapeHtml(item.label)));
        if (item.hint) txt4.appendChild(el("div", "hint", escapeHtml(item.hint)));
        row.appendChild(txt4);

        var col = document.createElement("input");
        col.type = "color";
        col.value = val;
        col.setAttribute("data-key", item.key);
        col.setAttribute("data-type", "color");
        row.appendChild(col);
      }

      wrap.appendChild(row);
    });

    root.appendChild(wrap);
  });

  var act = el("div", "settings-section");
  act.appendChild(el("h3", null, "Actions"));
  var actRow = el("div", "setting");
  actRow.style.flexWrap = "wrap";
  var b1 = el("button", "btn btn-ghost btn-sm", "Copy result");
  b1.addEventListener("click", function () { copySummary(false); });
  var b2 = el("button", "btn btn-ghost btn-sm", "Share result");
  b2.addEventListener("click", shareResult);
  var b3 = el("button", "btn btn-ghost btn-sm", "Save chart");
  b3.addEventListener("click", saveChart);
  var b4 = el("button", "btn btn-ghost btn-sm", "Export CSV");
  b4.addEventListener("click", function () {
    if (!Store.history.length) { toast("No history to export"); return; }
    download("donut-speedtest-history.csv", historyToCsv(), "text/csv;charset=utf-8");
  });
  var b5 = el("button", "btn btn-ghost btn-sm", "Refresh fingerprint");
  b5.addEventListener("click", function () { refreshFingerprint(); });
  actRow.appendChild(b1); actRow.appendChild(b2); actRow.appendChild(b3);
  actRow.appendChild(b4); actRow.appendChild(b5);
  act.appendChild(actRow);
  root.appendChild(act);
}

function shareResult() {
  var txt = summaryText(currentResults || Store.history[0] || null);
  if (!txt) { toast("No result to share"); return; }
  if (navigator.share) {
    navigator.share({ title: "Donut Internet Speed Test result", text: txt })
      .catch(function () { copySummary(false); });
  } else {
    copySummary(false);
  }
}

function handleSettingChange(e) {
  var target = e.target;
  if (!target || !target.getAttribute) return;
  var key = target.getAttribute("data-key");
  if (!key) return;
  var type = target.getAttribute("data-type");
  var val;

  if (type === "toggle") val = target.checked;
  else if (type === "range" || type === "number") {
    val = parseFloat(target.value);
    if (!isFinite(val)) return;
  } else val = target.value;

  S[key] = val;

  if (target.getAttribute("data-valtarget")) {
    var row = target.closest(".setting");
    if (row) {
      var vs = row.querySelector(".range-val");
      if (vs) vs.textContent = String(val);
    }
  }

  saveStore();
  applySettings();

  if (key === "unit" || key === "decimals") {
    updateUnitsEverywhere();
  }
  if (key === "serverPreset" || key === "customBase" || key === "engine") {
    renderInfo(currentResults && currentResults.connection ? currentResults.connection : {});
  }
  if (key === "showGrade" || key === "showCaps") {
    if (!S.showGrade) hideGrade();
    else if (currentResults) showGrade(currentResults);
  }
  if (key === "fingerprint") {
    refreshFingerprint();
  }
  if (key === "downloadDuration" || key === "uploadDuration" || key === "pingCount" || key === "parallel") {
    syncPresetButtons();
  }
  if (key === "showPresets") {
    if (dom.presetRow) dom.presetRow.style.display = S.showPresets ? "" : "none";
  }
}

function updateUnitsEverywhere() {
  if (currentResults) {
    if (currentResults.download && dom.vDown) dom.vDown.innerHTML = fmtSpeed(currentResults.download.bps) + '<span class="m-unit">' + unitLabelFor(currentResults.download.bps) + "</span>";
    if (currentResults.upload && dom.vUp) dom.vUp.innerHTML = fmtSpeed(currentResults.upload.bps) + '<span class="m-unit">' + unitLabelFor(currentResults.upload.bps) + "</span>";
    if (dom.gaugeUnit && currentResults.download) dom.gaugeUnit.textContent = unitLabelFor(currentResults.download.bps);
  } else {
    if (dom.vDown) dom.vDown.innerHTML = "—<span class=\"m-unit\">" + unitLabelFor(0) + "</span>";
    if (dom.vUp) dom.vUp.innerHTML = "—<span class=\"m-unit\">" + unitLabelFor(0) + "</span>";
  }
  drawChart();
}

var mq = null;

function resolveTheme() {
  if (S.theme === "auto") {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch (e) { return "dark"; }
  }
  return S.theme;
}

function applySettings() {
  document.documentElement.setAttribute("data-theme", resolveTheme());
  document.documentElement.style.setProperty("--accent", S.accent || "#22d3ee");

  document.body.classList.toggle("compact", !!S.compact);
  document.body.classList.toggle("hide-gauge", !S.showGauge);
  document.body.classList.toggle("hide-chart", !S.showChart);
  document.body.classList.toggle("hide-info", !S.showAdvancedInfo);
  document.body.classList.toggle("hide-presets", !S.showPresets);
  document.body.classList.toggle("hide-fingerprint", !S.fingerprint);

  if (dom.presetRow) dom.presetRow.style.display = S.showPresets ? "" : "none";

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolveTheme() === "light" ? "#eef2fa" : "#070b14");

  updateUnitsEverywhere();
  requestAnimationFrame(resizeChart);
}

function toggleTheme() {
  var cur = resolveTheme();
  S.theme = cur === "dark" ? "light" : "dark";
  saveStore();
  applySettings();
  syncThemeButton();
}

function syncThemeButton() {
  var btn = $("#btnTheme");
  if (!btn) return;
  var cur = resolveTheme();
  btn.classList.toggle("on", S.theme === "auto");
  btn.innerHTML = cur === "dark"
    ? '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
}

function renderHistory() {
  var root = dom.historyBody;
  if (!root) return;

  if (!Store.history.length) {
    root.innerHTML = '<div class="empty-state">' +
      '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>' +
      "<div>No tests saved yet</div></div>";
    return;
  }

  var html = "";
  Store.history.forEach(function (r, idx) {
    var d = new Date(r.timestamp);
    var dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" }) +
                  "<br>" + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var dl = r.download ? fmtSpeed(r.download.bps) + " " + unitLabelFor(r.download.bps) : "—";
    var ul = r.upload ? fmtSpeed(r.upload.bps) + " " + unitLabelFor(r.upload.bps) : "—";
    var pg = r.ping ? r.ping.median.toFixed(0) : "—";
    var g = computeGrade(r);

    html += '<div class="hist-item" data-idx="' + idx + '">' +
      '<div class="h-date">' + dateStr + "</div>" +
      '<div class="h-stats">' +
        '<div class="h-stat" style="color:var(--accent)"><small>Down</small>' + dl + "</div>" +
        '<div class="h-stat" style="color:var(--accent-2)"><small>Up</small>' + ul + "</div>" +
        '<div class="h-stat"><small>Ping</small>' + pg + " ms</div>" +
        (g ? '<div class="h-stat"><small>Grade</small>' + escapeHtml(g.grade) + "</div>" : "") +
      "</div>" +
      '<button class="hist-del" data-del="' + idx + '" aria-label="Delete entry">' +
        '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
      "</button>" +
    "</div>";
  });
  root.innerHTML = html;
}

function openPanel(id) {
  var p = document.getElementById(id);
  if (!p) return;
  p.classList.add("open");
  p.setAttribute("aria-hidden", "false");
  dom.scrim.classList.add("show");
  document.body.classList.add("no-scroll");
}

function closePanels() {
  $$(".panel").forEach(function (p) {
    p.classList.remove("open");
    p.setAttribute("aria-hidden", "true");
  });
  dom.scrim.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

function fingerprintToText() {
  if (!dom.fpGroups) return "";
  var lines = [];
  lines.push("Donut Internet Speed Test — Device Fingerprint");
  lines.push(new Date().toLocaleString());
  lines.push("-------------------------------------------------");
  $$(".fp-group", dom.fpGroups).forEach(function (g) {
    var title = g.querySelector(".fp-group-title");
    if (title) lines.push("");
    if (title) lines.push(title.textContent);
    $$(".fp-row", g).forEach(function (r) {
      var k = r.querySelector(".fp-k");
      var v = r.querySelector(".fp-v");
      if (k && v) lines.push(k.textContent + ": " + v.textContent);
    });
  });
  return lines.join("\n");
}

function bindEvents() {
  dom.btnStart.addEventListener("click", startTest);
  dom.btnStop.addEventListener("click", abortTest);

  if (dom.presetRow) {
    dom.presetRow.addEventListener("click", function (e) {
      var b = e.target.closest(".preset-btn");
      if (!b) return;
      var name = b.getAttribute("data-preset");
      applyPreset(name);
    });
  }

  $("#btnSettings").addEventListener("click", function () {
    renderSettings();
    openPanel("settingsPanel");
  });
  $("#btnHistory").addEventListener("click", function () {
    renderHistory();
    openPanel("historyPanel");
  });
  $("#btnTheme").addEventListener("click", toggleTheme);

  dom.scrim.addEventListener("click", closePanels);

  $$("[data-close]").forEach(function (b) {
    b.addEventListener("click", closePanels);
  });

  dom.settingsBody.addEventListener("input", handleSettingChange);
  dom.settingsBody.addEventListener("change", handleSettingChange);

  dom.infoGrid.addEventListener("click", function (e) {
    var row = e.target.closest(".info-row[data-copy]");
    if (!row) return;
    var val = row.getAttribute("data-copy");
    if (!val) return;
    copyToClipboard(val).then(function (ok) {
      if (!ok) return;
      flashCopied(row, "copied", 900);
      var disp = val.length > 46 ? val.slice(0, 44) + "…" : val;
      toast("Copied: " + disp, "ok", 1500);
    });
  });

  // Fingerprint rows - click to copy
  if (dom.fpGroups) {
    dom.fpGroups.addEventListener("click", function (e) {
      var row = e.target.closest(".fp-row[data-copy]");
      if (!row) return;
      var val = row.getAttribute("data-copy");
      if (!val) return;
      copyToClipboard(val).then(function (ok) {
        if (!ok) return;
        flashCopied(row, "copied", 900);
        var disp = val.length > 46 ? val.slice(0, 44) + "…" : val;
        toast("Copied: " + disp, "ok", 1500);
      });
    });
  }

  var refreshFpBtn = $("#btnRefreshFp");
  if (refreshFpBtn) refreshFpBtn.addEventListener("click", refreshFingerprint);

  var copyFpBtn = $("#btnCopyFp");
  if (copyFpBtn) {
    copyFpBtn.addEventListener("click", function () {
      var txt = fingerprintToText();
      if (!txt) { toast("Nothing to copy"); return; }
      copyToClipboard(txt).then(function (ok) {
        if (!ok) { toast("Copy failed", "err"); return; }
        copyFpBtn.classList.add("copied");
        var prev = copyFpBtn.textContent;
        copyFpBtn.textContent = "Copied!";
        setTimeout(function () {
          copyFpBtn.classList.remove("copied");
          copyFpBtn.textContent = prev;
        }, 1400);
        toast("Fingerprint copied", "ok");
      });
    });
  }

  var copyAllBtn = $("#btnCopyAllInfo");
  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", function () {
      var rows = $$(".info-row", dom.infoGrid);
      if (!rows.length) { toast("Nothing to copy"); return; }
      var lines = [];
      rows.forEach(function (r) {
        var k = r.querySelector(".k");
        var v = r.querySelector(".v");
        if (k && v) lines.push(k.textContent + ": " + v.textContent);
      });
      var txt = "Donut Internet Speed Test — Connection Details\n" +
                new Date().toLocaleString() + "\n" +
                "-----------------------------------------------\n" +
                lines.join("\n");
      copyToClipboard(txt).then(function (ok) {
        if (!ok) { toast("Copy failed", "err"); return; }
        copyAllBtn.classList.add("copied");
        var prev = copyAllBtn.textContent;
        copyAllBtn.textContent = "Copied!";
        setTimeout(function () {
          copyAllBtn.classList.remove("copied");
          copyAllBtn.textContent = prev;
        }, 1400);
        toast("All " + rows.length + " details copied", "ok");
      });
    });
  }

  var saveChartBtn = $("#btnSaveChart");
  if (saveChartBtn) {
    saveChartBtn.addEventListener("click", saveChart);
  }

  var chips = [dom.chipIp, dom.chipIp6, dom.chipIsp, dom.chipLoc];
  chips.forEach(function (chip) {
    if (!chip) return;
    chip.addEventListener("click", function () {
      var v = chip.getAttribute("data-copy") || "";
      if (!v || v === "unavailable" || v === "unknown") { toast("No value to copy"); return; }
      copyToClipboard(v).then(function (ok) {
        if (!ok) return;
        flashCopied(chip, "copied", 900);
        var disp = v.length > 34 ? v.slice(0, 32) + "…" : v;
        toast("Copied: " + disp, "ok", 1500);
      });
    });
  });

  $$(".metric").forEach(function (m) {
    m.addEventListener("click", function () {
      var labelEl = m.querySelector(".m-label");
      var valueEl = m.querySelector(".m-value");
      if (!labelEl || !valueEl) return;
      var label = labelEl.textContent.trim();
      var val = valueEl.textContent.trim();
      if (!val || val.replace(/—/g, "").trim() === "" || val.indexOf("—") === 0) {
        toast("No value to copy yet");
        return;
      }
      copyToClipboard(label + ": " + val).then(function (ok) {
        if (!ok) return;
        flashCopied(m, "copied", 800);
        toast("Copied: " + label + " = " + val, "ok", 1500);
      });
    });
  });

  dom.historyBody.addEventListener("click", function (e) {
    var del = e.target.closest("[data-del]");
    if (del) {
      var i = parseInt(del.getAttribute("data-del"), 10);
      Store.history.splice(i, 1);
      saveStore();
      renderHistory();
      return;
    }
    var item = e.target.closest(".hist-item");
    if (item) {
      var idx = parseInt(item.getAttribute("data-idx"), 10);
      var r = Store.history[idx];
      if (r) {
        currentResults = r;
        if (r.download && dom.vDown) dom.vDown.innerHTML = fmtSpeed(r.download.bps) + '<span class="m-unit">' + unitLabelFor(r.download.bps) + "</span>";
        if (r.upload && dom.vUp) dom.vUp.innerHTML = fmtSpeed(r.upload.bps) + '<span class="m-unit">' + unitLabelFor(r.upload.bps) + "</span>";
        if (r.ping) {
          if (dom.vPing) dom.vPing.innerHTML = r.ping.median.toFixed(1) + '<span class="m-unit">ms</span>';
          if (dom.vJitter) dom.vJitter.innerHTML = r.ping.jitter.toFixed(1) + '<span class="m-unit">ms</span>';
          if (dom.vLoss) dom.vLoss.innerHTML = r.ping.loss.toFixed(1) + '<span class="m-unit">%</span>';
          if (dom.sPing) dom.sPing.textContent = "min " + r.ping.min.toFixed(1) + " · max " + r.ping.max.toFixed(1);
        }
        if (r.connection) {
          renderInfo(r.connection);
          updateChips(r.connection);
        }
        var bp = r.download ? r.download.bps : (r.upload ? r.upload.bps : 0);
        if (dom.gaugeValue) dom.gaugeValue.textContent = fmtSpeed(bp);
        if (dom.gaugeUnit) dom.gaugeUnit.textContent = unitLabelFor(bp);
        updateGaugeNeedle(toDisplay(bp));
        showGrade(r);
        setPhaseLabel("Loaded from history");
        closePanels();
        toast("Loaded result from history", "ok");
      }
    }
  });

  $("#btnClearHistory").addEventListener("click", function () {
    if (!Store.history.length) { toast("History is already empty"); return; }
    if (window.confirm("Delete all saved test results?")) {
      Store.history = [];
      saveStore();
      renderHistory();
      toast("History cleared", "ok");
    }
  });

  $("#btnExportCsv").addEventListener("click", function () {
    if (!Store.history.length) { toast("No history to export"); return; }
    download("donut-speedtest-history.csv", historyToCsv(), "text/csv;charset=utf-8");
  });

  $("#btnExportJson").addEventListener("click", function () {
    if (!Store.history.length) { toast("No history to export"); return; }
    download("donut-speedtest-history.json", JSON.stringify(Store.history, null, 2), "application/json");
  });

  $("#btnResetSettings").addEventListener("click", function () {
    if (!window.confirm("Reset all settings to their defaults?")) return;
    for (var k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) S[k] = DEFAULTS[k];
    }
    saveStore();
    applySettings();
    syncThemeButton();
    syncPresetButtons();
    renderSettings();
    refreshFingerprint();
    toast("Settings reset", "ok");
  });

  $("#btnExportCfg").addEventListener("click", function () {
    download("donut-speedtest-config.json", JSON.stringify(S, null, 2), "application/json");
  });

  $("#btnImportCfg").addEventListener("click", function () {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.addEventListener("change", function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var obj = JSON.parse(reader.result);
          for (var k in DEFAULTS) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) S[k] = obj[k];
          }
          saveStore();
          applySettings();
          syncThemeButton();
          syncPresetButtons();
          renderSettings();
          refreshFingerprint();
          toast("Configuration imported", "ok");
        } catch (e) {
          toast("Invalid configuration file", "err");
        }
      };
      reader.readAsText(file);
    });
    inp.click();
  });

  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (running) abortTest(); else startTest();
    } else if (e.key === "Escape") {
      closePanels();
    } else if (e.key === "s" || e.key === "S") {
      renderSettings();
      openPanel("settingsPanel");
    } else if (e.key === "h" || e.key === "H") {
      renderHistory();
      openPanel("historyPanel");
    } else if (e.key === "t" || e.key === "T") {
      toggleTheme();
    } else if (e.key === "f" || e.key === "F") {
      refreshFingerprint();
    } else if (e.key === "c" || e.key === "C") {
      if (e.shiftKey) copySummary(false);
    }
  });

  window.addEventListener("resize", function () {
    resizeChart();
  });

  window.addEventListener("orientationchange", function () {
    setTimeout(resizeChart, 250);
    setTimeout(resizeChart, 600);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      resizeChart();
    });
  }

  try {
    mq = window.matchMedia("(prefers-color-scheme: light)");
    var handler = function () {
      if (S.theme === "auto") { applySettings(); syncThemeButton(); }
    };
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
  } catch (e) {}

  window.addEventListener("beforeunload", function (e) {
    if (running) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  });
}

function init() {
  loadStore();
  S = Store.settings;

  buildGauge();
  applySettings();
  syncThemeButton();
  syncPresetButtons();
  resetMetricsUI();
  bindEvents();
  resizeChart();

  if (dom.stEngine) dom.stEngine.textContent = useFetchEngine() ? "Fetch" : "XHR";
  if (dom.stStreams) dom.stStreams.textContent = "0";

  if (S.ipLookup) {
    fetchConnectionInfo().then(function (info) {
      renderInfo(info);
      updateChips(info);
      if (currentResults) currentResults.connection = info;
    });
  } else {
    if (dom.chipIp) dom.chipIp.innerHTML = '<i class="dot"></i>IPv4: <b>lookup disabled</b>';
    if (dom.chipIp6) dom.chipIp6.innerHTML = '<i class="dot"></i>IPv6: <b>lookup disabled</b>';
    if (dom.chipIsp) dom.chipIsp.innerHTML = "ISP: <b>lookup disabled</b>";
    if (dom.chipLoc) dom.chipLoc.innerHTML = "Location: <b>lookup disabled</b>";
    renderInfo({ "Test engine": useFetchEngine() ? "Fetch streams" : "XHR", "Streams": String(S.parallel) });
  }

  renderHistory();

  // Kick off fingerprint collection asynchronously
  if (S.fingerprint) {
    setTimeout(function () { refreshFingerprint(); }, 100);
  }

  if (S.autoStart) {
    setTimeout(function () { startTest(); }, 800);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
