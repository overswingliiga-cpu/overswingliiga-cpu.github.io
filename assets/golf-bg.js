/* Overswing Firmaliiga – vierityksellä etenevä bunkkerilyönti taustalla.
   Ei ulkoisia kirjastoja. Kaikki piirretään canvasiin; kuva on puhdas funktio
   vierityksen edistymisestä (0–1), joten ylös rullaaminen kelaa lyönnin taaksepäin. */
(function () {
  "use strict";
  var doc = document.documentElement;
  var canvas = document.createElement("canvas");
  var layer = document.createElement("div");
  layer.className = "golf-bg";
  layer.setAttribute("aria-hidden", "true");
  layer.appendChild(canvas);
  document.body.insertBefore(layer, document.body.firstChild);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  // mobiilin pieni versio yläpalkissa (näkyy vain kapeilla näytöillä, ks. site.css .golf-mini)
  var miniCanvas = null, bar = document.querySelector(".topbar-inner");
  if (bar) {
    miniCanvas = document.createElement("canvas");
    miniCanvas.className = "golf-mini";
    miniCanvas.setAttribute("aria-hidden", "true");
    var nav = bar.querySelector(".sitenav");
    bar.insertBefore(miniCanvas, nav || null);
  }

  var reduceMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var STATIC_P = 0.64;               // pysäytyskuva: osuma, hiekkapöllähdys ja pallo ilmassa
  var W = 0, H = 0, dpr = 1, L = null, bgCache = null, TK = 1, MINI = false;
  var cur = 0, target = 0, raf = 0;

  /* ---------- apufunktiot ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function rad(d) { return d * Math.PI / 180; }
  function dir(deg) { var r = rad(deg); return [Math.sin(r), Math.cos(r)]; } // 0° = suoraan alas
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* ---------- svingin avainasennot (yksikkö = golfarin pituus) ----------
     hx,hy lantio pallosta · sx,sy hartiakeskus lantiosta · sw hartioiden puolileveys
     th käsien kulma hartiakeskuksen ympäri · hg ranteen kulma · heel takakantapää · hu pää ylös */
  var KEYS = [
    { p: 0.00, hx: -0.010, hy: -0.470, sx: -0.030, sy: -0.270, sw: 0.100, th:    6, hg:   -5, heel: 0,   hu: 0 },
    { p: 0.08, hx: -0.010, hy: -0.470, sx: -0.030, sy: -0.270, sw: 0.100, th:    9, hg:   -8, heel: 0,   hu: 0 },
    { p: 0.24, hx: -0.022, hy: -0.470, sx: -0.040, sy: -0.270, sw: 0.074, th:  -72, hg:  -52, heel: 0,   hu: 0 },
    { p: 0.39, hx: -0.030, hy: -0.474, sx: -0.046, sy: -0.266, sw: 0.058, th: -142, hg:  -96, heel: 0,   hu: 0 },
    { p: 0.44, hx: -0.004, hy: -0.470, sx: -0.044, sy: -0.268, sw: 0.062, th: -118, hg: -112, heel: 0,   hu: 0 },
    { p: 0.495,hx:  0.012, hy: -0.468, sx: -0.032, sy: -0.270, sw: 0.080, th:  -42, hg:  -74, heel: 0.1, hu: 0 },
    { p: 0.52, hx:  0.020, hy: -0.470, sx: -0.020, sy: -0.270, sw: 0.090, th:    6, hg:   -6, heel: 0.2, hu: 0 },
    { p: 0.58, hx:  0.040, hy: -0.482, sx: -0.002, sy: -0.282, sw: 0.072, th:   84, hg:   42, heel: 0.6, hu: 0.01 },
    { p: 0.70, hx:  0.052, hy: -0.500, sx:  0.026, sy: -0.300, sw: 0.060, th:  150, hg:   86, heel: 1,   hu: 0.025 },
    { p: 1.00, hx:  0.052, hy: -0.500, sx:  0.026, sy: -0.300, sw: 0.060, th:  150, hg:   86, heel: 1,   hu: 0.025 }
  ];
  var PARAMS = ["hx", "hy", "sx", "sy", "sw", "th", "hg", "heel", "hu"];
  var R_ARM = 0.30, CLUB = 0.44, P_IMPACT = 0.52, FLY0 = 0.53, FLY1 = 0.88, ROLL1 = 0.95;

  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function pose(p) {
    p = clamp(p, 0, 1);
    var i = 0;
    while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
    var a = KEYS[Math.max(0, i - 1)], b = KEYS[i], c = KEYS[i + 1], d = KEYS[Math.min(KEYS.length - 1, i + 2)];
    var t = (p - b.p) / (c.p - b.p || 1);
    var o = {};
    for (var k = 0; k < PARAMS.length; k++) { var n = PARAMS[k]; o[n] = catmull(a[n], b[n], c[n], d[n], t); }
    return o;
  }
  // nivelpisteet paikallisissa yksiköissä (pallo origossa, y alaspäin)
  function joints(p) {
    var q = pose(p);
    var hip = [q.hx, q.hy];
    var S = [hip[0] + q.sx, hip[1] + q.sy];
    var ad = dir(q.th);
    var hands = [S[0] + R_ARM * ad[0], S[1] + R_ARM * ad[1]];
    var cd = dir(q.th + q.hg);
    var head = [hands[0] + CLUB * cd[0], hands[1] + CLUB * cd[1]];
    return { q: q, hip: hip, S: S, hands: hands, club: head, cd: cd };
  }
  // kaksiniveltä IK: kyynärpää / polvi
  function ik(a, b, l1, l2, bendSign) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var dd = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    var d = Math.min(dd, l1 + l2 - 1e-4);
    var x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    var ux = dx / dd, uy = dy / dd;
    return [a[0] + ux * x - uy * h * bendSign, a[1] + uy * x + ux * h * bendSign];
  }

  /* ---------- asettelu näkymän koon mukaan ---------- */
  function layout() {
    var portrait = H > W * 1.05;
    var o = { portrait: portrait };
    o.gy = H * (portrait ? 0.885 : 0.90);                       // hiekan pinta jalkojen kohdalla
    o.s = portrait ? Math.min(H * 0.34, W * 0.74) : Math.min(H * 0.50, W * 0.31); // golfarin pituus px
    o.bx = portrait ? W * 0.34 : W * 0.70;                      // pallon x
    o.gx = portrait ? W * 0.86 : W * 0.915;                     // lipun x
    o.gyG = portrait ? H * 0.70 : H * 0.735;                    // viheriön pinta
    o.ball = [o.bx + 0.0 * o.s, o.gy];
    o.land = [o.gx - (portrait ? 0.06 : 0.035) * W, o.gyG + 2];
    o.hole = [o.gx - 4, o.gyG + 3];
    var apex = portrait ? H * 0.10 : H * 0.02;
    o.ctrl = [lerp(o.ball[0], o.land[0], 0.42), apex - (o.gyG - apex) * 0.55];
    o.horizon = H * (portrait ? 0.70 : 0.74);
    return o;
  }

  /* ---------- staattinen tausta välimuistiin ---------- */
  function hills(c, baseY, amp, seed, fill, rim) {
    var r = rng(seed), ph = r() * 6.28, f1 = 1.5 + r() * 1.5, f2 = 4 + r() * 3;
    c.beginPath(); c.moveTo(0, H);
    var pts = [];
    for (var x = 0; x <= W + 8; x += 8) {
      var y = baseY - amp * (0.6 * Math.sin(x / W * f1 * 3.14 + ph) + 0.25 * Math.sin(x / W * f2 * 3.14 + ph * 2));
      pts.push([x, y]); c.lineTo(x, y);
    }
    c.lineTo(W, H); c.closePath(); c.fillStyle = fill; c.fill();
    if (rim) {
      c.beginPath();
      for (var i = 0; i < pts.length; i++) i ? c.lineTo(pts[i][0], pts[i][1]) : c.moveTo(pts[i][0], pts[i][1]);
      c.strokeStyle = rim; c.lineWidth = 1; c.stroke();
    }
  }
  function buildBg() {
    bgCache = document.createElement("canvas");
    bgCache.width = Math.round(W * dpr); bgCache.height = Math.round(H * dpr);
    var c = bgCache.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var o = L, s = o.s;

    // taivas
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#050505"); g.addColorStop(0.55, "#0b0a0a"); g.addColorStop(1, "#140b0c");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // punainen hehku viheriön takana ja oikeassa yläkulmassa (SGT-henkinen)
    var rg = c.createRadialGradient(o.gx, o.horizon, 0, o.gx, o.horizon, Math.max(W, H) * 0.75);
    rg.addColorStop(0, "rgba(214,40,57,.42)"); rg.addColorStop(0.35, "rgba(214,40,57,.14)"); rg.addColorStop(1, "rgba(214,40,57,0)");
    c.fillStyle = rg; c.fillRect(0, 0, W, H);
    var tg = c.createRadialGradient(W * 0.85, -H * 0.15, 0, W * 0.85, -H * 0.15, W * 0.7);
    tg.addColorStop(0, "rgba(214,40,57,.18)"); tg.addColorStop(1, "rgba(214,40,57,0)");
    c.fillStyle = tg; c.fillRect(0, 0, W, H);
    // hento simulaattoriruudukko taivaalla
    c.strokeStyle = "rgba(255,255,255,.028)"; c.lineWidth = 1;
    var step = Math.max(48, Math.round(W / 22));
    for (var x = (W % step) / 2; x < W; x += step) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, o.horizon); c.stroke(); }
    for (var y = step; y < o.horizon; y += step) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }

    // kaukaiset kumpareet ja puurivi
    hills(c, o.horizon - H * 0.02, H * 0.035, 7, "#0f0d0d", "rgba(255,107,122,.10)");
    hills(c, o.horizon + H * 0.03, H * 0.025, 19, "#0b0b0a", null);
    // viheriö
    var gw = o.portrait ? W * 0.30 : W * 0.15;
    c.save();
    c.beginPath(); c.ellipse(o.gx - gw * 0.1, o.gyG + 4, gw * 0.62, Math.max(7, gw * 0.075), 0, 0, Math.PI * 2);
    var gg = c.createLinearGradient(0, o.gyG - 8, 0, o.gyG + 18);
    gg.addColorStop(0, "#1c2a22"); gg.addColorStop(1, "#0b100d");
    c.fillStyle = gg; c.fill();
    c.strokeStyle = "rgba(255,107,122,.30)"; c.lineWidth = 1; c.stroke();
    c.restore();
    // reikä
    c.beginPath(); c.ellipse(o.hole[0], o.hole[1], 3.2, 1.3, 0, 0, Math.PI * 2); c.fillStyle = "#000"; c.fill();
    // lähempi väylä/kumpare
    hills(c, o.gyG + H * 0.06, H * 0.02, 31, "#090909", "rgba(255,255,255,.04)");
    // maan perspektiiviviivat
    c.strokeStyle = "rgba(255,255,255,.035)";
    var vp = [o.gx, o.horizon];
    for (var k = -10; k <= 10; k++) {
      c.beginPath(); c.moveTo(vp[0], vp[1] + H * 0.08); c.lineTo(vp[0] + k * W * 0.16, H); c.stroke();
    }
    for (var j = 1; j < 7; j++) {
      var yy = o.gyG + H * 0.08 + Math.pow(j / 7, 1.8) * (H - o.gyG);
      c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke();
    }

    // bunkkeri: hiekka
    var bcx = o.bx - 0.08 * s, bcy = o.gy + 0.03 * s, brx = o.portrait ? Math.max(W * 0.42, 0.95 * s) : 1.05 * s, bry = 0.17 * s;
    c.save();
    c.beginPath(); c.ellipse(bcx, bcy, brx, bry, 0, 0, Math.PI * 2);
    var sg = c.createRadialGradient(o.bx + 0.15 * s, o.gy - 0.05 * s, 0, bcx, bcy, brx);
    sg.addColorStop(0, "#5e5344"); sg.addColorStop(0.45, "#3a3229"); sg.addColorStop(1, "#141210");
    c.fillStyle = sg; c.fill();
    c.clip();
    // haravanjäljet
    c.strokeStyle = "rgba(0,0,0,.12)"; c.lineWidth = 1;
    for (var m = -6; m <= 6; m++) {
      c.beginPath(); c.ellipse(bcx, bcy + m * bry * 0.16, brx * 0.95, bry * 0.25, 0, 0, Math.PI); c.stroke();
    }
    c.restore();
    // bunkkerin reunus (lippu-puolella korkea nurmireuna)
    c.beginPath();
    var lx0 = o.bx + 0.30 * s, ly0 = o.gy + 0.17 * s;
    c.moveTo(lx0, ly0);
    c.bezierCurveTo(o.bx + 0.52 * s, o.gy + 0.10 * s, o.bx + 0.56 * s, o.gy - 0.16 * s, o.bx + 0.74 * s, o.gy - 0.19 * s);
    c.bezierCurveTo(o.bx + 1.0 * s, o.gy - 0.22 * s, W + 40, o.gy - 0.20 * s, W + 40, o.gy - 0.14 * s);
    c.lineTo(W + 40, H + 10); c.lineTo(lx0 - 20, H + 10); c.closePath();
    var lg = c.createLinearGradient(0, o.gy - 0.22 * s, 0, H);
    lg.addColorStop(0, "#121513"); lg.addColorStop(1, "#050505");
    c.fillStyle = lg; c.fill();
    c.beginPath();
    c.moveTo(lx0, ly0);
    c.bezierCurveTo(o.bx + 0.52 * s, o.gy + 0.10 * s, o.bx + 0.56 * s, o.gy - 0.16 * s, o.bx + 0.74 * s, o.gy - 0.19 * s);
    c.bezierCurveTo(o.bx + 1.0 * s, o.gy - 0.22 * s, W + 40, o.gy - 0.20 * s, W + 40, o.gy - 0.14 * s);
    c.strokeStyle = "rgba(255,107,122,.55)"; c.lineWidth = 1.5; c.stroke();
    // etualan reuna alhaalla
    c.beginPath(); c.moveTo(-10, H + 10);
    c.lineTo(-10, o.gy + 0.16 * s);
    c.quadraticCurveTo(bcx, bcy + bry * 1.35, lx0 + 10, H - 2);
    c.lineTo(lx0 + 10, H + 10); c.closePath();
    c.fillStyle = "#060606"; c.fill();
  }

  function layoutMini() {
    var o = { portrait: false, mini: true };
    o.gy = H * 0.90;
    o.s = H * 0.60;
    o.bx = W * 0.36;
    o.gx = W * 0.86;
    o.gyG = H * 0.80;
    o.ball = [o.bx, o.gy];
    o.land = [o.gx - W * 0.07, o.gyG + 1];
    o.hole = [o.gx - 2, o.gyG + 1.5];
    var peak = H * 0.10;
    o.ctrl = [lerp(o.ball[0], o.land[0], 0.45), (peak - 0.25 * o.gy - 0.25 * o.land[1]) / 0.5];
    o.horizon = H * 0.80;
    return o;
  }
  function buildBgMini() {
    bgCache = document.createElement("canvas");
    bgCache.width = Math.round(W * dpr); bgCache.height = Math.round(H * dpr);
    var c = bgCache.getContext("2d"), o = L, s = o.s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a0909"); g.addColorStop(1, "#1a0c0e");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var rg = c.createRadialGradient(o.gx, o.horizon, 0, o.gx, o.horizon, W * 0.8);
    rg.addColorStop(0, "rgba(214,40,57,.55)"); rg.addColorStop(0.45, "rgba(214,40,57,.16)"); rg.addColorStop(1, "rgba(214,40,57,0)");
    c.fillStyle = rg; c.fillRect(0, 0, W, H);
    // horisontti
    c.beginPath(); c.moveTo(0, H);
    for (var x = 0; x <= W; x += 4) c.lineTo(x, o.horizon - 2 - 2.5 * Math.sin(x / W * 5 + 1));
    c.lineTo(W, H); c.closePath(); c.fillStyle = "#0e0d0d"; c.fill();
    // viheriö
    c.beginPath(); c.ellipse(o.gx - 2, o.gyG + 1.5, W * 0.13, 2.4, 0, 0, Math.PI * 2);
    c.fillStyle = "#1c2a22"; c.fill(); c.strokeStyle = "rgba(255,107,122,.35)"; c.lineWidth = 0.8; c.stroke();
    // bunkkeri
    c.beginPath(); c.ellipse(o.bx - 0.05 * s, o.gy + 1.5, W * 0.30, H * 0.12, 0, 0, Math.PI * 2);
    var sg = c.createRadialGradient(o.bx + 6, o.gy - 2, 0, o.bx, o.gy, W * 0.3);
    sg.addColorStop(0, "#6a5d4b"); sg.addColorStop(1, "#2a241d");
    c.fillStyle = sg; c.fill();
    // bunkkerin reuna lipun puolella (matala kumpare, viheriö jää näkyviin)
    c.beginPath(); c.moveTo(o.bx + 0.40 * s, H + 1);
    c.quadraticCurveTo(o.bx + 0.62 * s, o.gy - 0.20 * s, o.bx + 0.95 * s, o.gy - 0.10 * s);
    c.quadraticCurveTo(o.bx + 1.25 * s, o.gy - 0.02 * s, o.bx + 1.45 * s, H + 1);
    c.closePath();
    c.fillStyle = "#0b0d0c"; c.fill();
    c.strokeStyle = "rgba(255,107,122,.55)"; c.lineWidth = 0.8; c.stroke();
  }

  /* ---------- dynaamiset osat ---------- */
  function toW(pt) { return [L.bx + pt[0] * L.s, L.gy + pt[1] * L.s]; }
  function limb(c, a, b, m, w) {
    c.lineWidth = w * TK;
    c.beginPath(); c.moveTo(a[0], a[1]);
    if (m) c.lineTo(m[0], m[1]);
    c.lineTo(b[0], b[1]); c.stroke();
  }
  function drawGolfer(c, p, ox, oy, color, extra, main) {
    var s = L.s, J = joints(p), q = J.q;
    var off = function (pt) { var w = toW(pt); return [w[0] + ox, w[1] + oy]; };
    var hip = J.hip, S = J.S;
    var sw = q.sw, hw = 0.052;
    var lSh = [S[0] + sw, S[1] + 0.012], tSh = [S[0] - sw, S[1] - 0.004];
    var lHip = [hip[0] + hw, hip[1]], tHip = [hip[0] - hw, hip[1]];
    var lFoot = [0.15, 0], tFoot = [-0.17, 0];
    var tFootUp = [lerp(-0.17, -0.10, q.heel), lerp(0, -0.035, q.heel)];
    var lKnee = ik(lHip, lFoot, 0.25, 0.235, -1);
    var tKnee = ik(tHip, tFootUp, 0.25, 0.235, 1);
    var hands = J.hands;
    var lElb = ik(lSh, hands, 0.17, 0.165, 1);
    var tElb = ik(tSh, hands, 0.17, 0.165, q.th < -20 ? 1 : -1);
    var headC = [S[0] + 0.012 + q.hu * 1.2, S[1] - 0.115 - q.hu];
    var e = extra * 2;
    c.strokeStyle = color; c.fillStyle = color; c.lineCap = "round"; c.lineJoin = "round";
    // jalat
    limb(c, off(tHip), off(tFootUp), off(tKnee), (0.072 * s) + e);
    limb(c, off(lHip), off(lFoot), off(lKnee), (0.075 * s) + e);
    // kengät
    limb(c, off([lFoot[0] - 0.01, -0.006]), off([lFoot[0] + 0.05, -0.004]), null, 0.04 * s + e);
    limb(c, off([tFootUp[0] - 0.03 * (1 - q.heel), tFootUp[1] - 0.006]), off([tFootUp[0] + 0.04, tFootUp[1] + 0.02 * q.heel - 0.004]), null, 0.04 * s + e);
    // vartalo
    c.beginPath();
    var a1 = off(tHip), a2 = off(lHip), a3 = off(lSh), a4 = off(tSh);
    c.moveTo(a1[0], a1[1]); c.lineTo(a2[0], a2[1]); c.lineTo(a3[0], a3[1]); c.lineTo(a4[0], a4[1]); c.closePath();
    c.lineWidth = (0.045 * s + e) * TK; c.fill(); c.stroke();
    // kaula + pää + lippis
    limb(c, off([S[0] + 0.005, S[1]]), off(headC), null, 0.05 * s + e);
    var hc = off(headC);
    c.beginPath(); c.arc(hc[0], hc[1], 0.066 * s + extra, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(hc[0] + 0.01 * s, hc[1] - 0.03 * s, 0.075 * s + extra, 0.035 * s + extra, 0, Math.PI, 0); c.fill();
    // kädet (päärenderöinnissä hento ääriviiva erottaa ne vartalosta)
    if (main) {
      c.strokeStyle = "#2c2828";
      limb(c, off(tSh), off(hands), off(tElb), 0.05 * s + (MINI ? 0.8 : 2.2));
      limb(c, off(lSh), off(hands), off(lElb), 0.052 * s + (MINI ? 0.8 : 2.2));
      c.strokeStyle = color;
    }
    limb(c, off(tSh), off(hands), off(tElb), 0.05 * s + e);
    limb(c, off(lSh), off(hands), off(lElb), 0.052 * s + e);
    var hw2 = off(hands);
    if (main) {
      // maila: metallinharmaa varsi ja tumma pää
      var ch = off(J.club), cd = J.cd, nx = -cd[1], ny = cd[0];
      c.strokeStyle = "#8E8A87";
      limb(c, hw2, ch, null, Math.max(MINI ? 0.9 : 1.5, 0.010 * s) / TK);
      c.strokeStyle = "#7A7673";
      c.beginPath(); c.moveTo(ch[0], ch[1]);
      c.lineTo(ch[0] + nx * 0.05 * s + cd[0] * 0.012 * s, ch[1] + ny * 0.05 * s + cd[1] * 0.012 * s);
      c.lineWidth = Math.max(MINI ? 1.6 : 2.5, 0.02 * s); c.stroke();
    }
    return { hands: hw2, belt: [off(tHip), off(lHip)], hip: off(hip) };
  }
  function drawFigure(c, p) {
    var s = L.s;
    // punainen reunavalo valon (viheriön hehkun) suunnasta
    c.save();
    c.globalAlpha = 0.85;
    drawGolfer(c, p, 0.007 * s, -0.004 * s, "#D62839", 0.004 * s);
    c.restore();
    c.save();
    c.globalAlpha = 0.25;
    drawGolfer(c, p, -0.008 * s, 0.0, "#3a3636", 0.004 * s);
    c.restore();
    var sh = toW([-0.01, 0.004]);
    c.save(); c.fillStyle = "rgba(0,0,0,.45)";
    c.beginPath(); c.ellipse(sh[0], sh[1], 0.26 * s, 0.03 * s, 0, 0, Math.PI * 2); c.fill(); c.restore();
    var info = drawGolfer(c, p, 0, 0, "#070707", 0, true);
    // vyö ja hanska: pienet punaiset korostukset
    c.lineCap = "round";
    c.strokeStyle = "#D62839"; c.lineWidth = Math.max(MINI ? 1 : 1.5, 0.013 * s);
    c.beginPath(); c.moveTo(info.belt[0][0], info.belt[0][1] - 0.012 * s); c.lineTo(info.belt[1][0], info.belt[1][1] - 0.012 * s); c.stroke();
    c.fillStyle = "#E8394A";
    c.beginPath(); c.arc(info.hands[0], info.hands[1], Math.max(MINI ? 1.3 : 2, 0.022 * s), 0, Math.PI * 2); c.fill();
  }
  function drawSwoosh(c, p) {
    if (p < 0.43 || p > 0.66) return;
    var a = Math.max(0.43, p - 0.075);
    if (p - a < 0.004) return;
    var n = 22, pts = [];
    for (var i = 0; i <= n; i++) pts.push(toW(joints(lerp(a, p, i / n)).club));
    var fade = p > 0.6 ? 1 - (p - 0.6) / 0.06 : 1;
    for (var k = 1; k < pts.length; k++) {
      var t = k / n;
      c.strokeStyle = "rgba(255," + Math.round(90 + 140 * t) + "," + Math.round(105 + 125 * t) + "," + (0.5 * t * fade).toFixed(3) + ")";
      c.lineWidth = Math.max(MINI ? 0.6 : 1, 0.03 * L.s * t);
      c.beginPath(); c.moveTo(pts[k - 1][0], pts[k - 1][1]); c.lineTo(pts[k][0], pts[k][1]); c.stroke();
    }
  }
  var SAND = null;
  function sandParticles() {
    var r = rng(4048), arr = [];
    for (var i = 0; i < 380; i++) {
      var ang = rad(lerp(18, 128, Math.pow(r(), 0.9)));   // 0° = oikealle, 90° = ylös
      var sp = lerp(0.35, 2.1, Math.pow(r(), 1.6));
      arr.push({ vx: Math.cos(ang) * sp, vy: -Math.sin(ang) * sp * 1.15, sz: lerp(1, 4, r() * r()), life: lerp(0.55, 1, r()), tone: r() });
    }
    return arr;
  }
  function drawSand(c, p) {
    if (p < P_IMPACT - 0.012) return;
    var t = clamp((p - P_IMPACT + 0.012) / 0.26, 0, 1);
    if (t >= 1) return;
    var s = L.s, o = toW([0.02, -0.005]);
    if (!SAND) SAND = sandParticles();
    // pölypilvi
    for (var k = 0; k < 5; k++) {
      var rr = (0.08 + k * 0.05 + t * 0.35) * s;
      var cx = o[0] + (k * 0.06 + t * 0.25) * s, cy = o[1] - (0.03 + k * 0.03 + t * 0.12) * s;
      var gr = c.createRadialGradient(cx, cy, 0, cx, cy, rr);
      var al = 0.34 * Math.pow(1 - t, 1.3) * (1 - k * 0.12) * Math.min(1, t * 12);
      gr.addColorStop(0, "rgba(150,132,105," + al.toFixed(3) + ")"); gr.addColorStop(1, "rgba(150,132,105,0)");
      c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.fill();
    }
    var g = 2.6;
    for (var i = 0; i < SAND.length; i++) {
      var P = SAND[i], lt = t / P.life;
      if (lt >= 1) continue;
      var tt = lt * 0.85;
      var x = o[0] + P.vx * tt * s, y = o[1] + (P.vy * tt + 0.5 * g * tt * tt) * s;
      if (y > o[1] + 0.02 * s) continue;
      var al2 = Math.pow(1 - lt, 1.1) * Math.min(1, lt * 20 + 0.2);
      c.fillStyle = P.tone > 0.9 ? "rgba(255,107,122," + al2.toFixed(3) + ")" : "rgba(" + Math.round(170 + P.tone * 50) + "," + Math.round(150 + P.tone * 40) + "," + Math.round(115 + P.tone * 30) + "," + al2.toFixed(3) + ")";
      var z = MINI ? Math.max(0.8, P.sz * 0.45) : P.sz * Math.max(1, s / 300);
      c.fillRect(x - z / 2, y - z / 2, z, z);
    }
  }
  function bez(t) {
    var a = L.ball, b = L.ctrl, d = L.land, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * d[0], u * u * a[1] + 2 * u * t * b[1] + t * t * d[1]];
  }
  function ballState(p) {
    if (p < FLY0) return { pos: L.ball, f: 0, r: 0 };
    if (p < FLY1) {
      var u = (p - FLY0) / (FLY1 - FLY0);
      var f = 1 - Math.pow(1 - u, 1.35);
      return { pos: bez(f), f: f, r: 0 };
    }
    var v = clamp((p - FLY1) / (ROLL1 - FLY1), 0, 1), e = 1 - Math.pow(1 - v, 2.2);
    var hop = Math.sin(Math.min(1, v * 2.2) * Math.PI) * (MINI ? 3 : 9) * (1 - v);
    return { pos: [lerp(L.land[0], L.hole[0] - (MINI ? 3 : 9), e), L.land[1] - hop], f: 1, r: v };
  }
  function drawFlag(c, p) {
    var poleH = L.s * (MINI ? 0.5 : L.portrait ? 0.36 : 0.30);
    var x = L.hole[0], y = L.hole[1];
    c.strokeStyle = "#BDB9B6"; c.lineWidth = MINI ? 1 : 1.6; c.lineCap = "round";
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - poleH); c.stroke();
    var fw = poleH * 0.42, fh = poleH * 0.24, ph = p * 26;
    c.beginPath(); c.moveTo(x, y - poleH);
    for (var i = 1; i <= 8; i++) {
      var t = i / 8; c.lineTo(x + fw * t, y - poleH + fh * 0.5 * t + Math.sin(ph + t * 4) * (MINI ? 1 : 3) * t);
    }
    for (var j = 8; j >= 0; j--) {
      var t2 = j / 8; c.lineTo(x + fw * t2, y - poleH + fh - fh * 0.5 * t2 + Math.sin(ph + t2 * 4) * (MINI ? 1 : 3) * t2);
    }
    c.closePath(); c.fillStyle = "#D62839"; c.fill();
  }
  function drawBall(c, p) {
    var b = ballState(p);
    var s = L.s;
    if (b.f > 0) {
      var n = Math.max(2, Math.round(60 * b.f)), pts = [];
      for (var i = 0; i <= n; i++) pts.push(bez(b.f * i / n));
      if (b.r > 0) pts.push(b.pos);
      var fade = p > ROLL1 ? 0.75 : 1;
      c.save();
      c.lineCap = "round"; c.lineJoin = "round";
      c.shadowColor = "rgba(214,40,57,.9)"; c.shadowBlur = MINI ? 4 : 14;
      for (var k = 1; k < pts.length; k++) {
        var t = k / (pts.length - 1);
        c.strokeStyle = "rgba(255," + Math.round(60 + 60 * t) + "," + Math.round(75 + 55 * t) + "," + (fade * (0.18 + 0.82 * t)).toFixed(3) + ")";
        c.lineWidth = MINI ? lerp(0.6, 1.4, t) : lerp(1.4, Math.max(3, 0.009 * s), t);
        c.beginPath(); c.moveTo(pts[k - 1][0], pts[k - 1][1]); c.lineTo(pts[k][0], pts[k][1]); c.stroke();
      }
      c.restore();
    }
    var r = MINI ? lerp(1.5, 1.1, b.f) : Math.max(2.2, lerp(0.017 * s, 0.008 * s, b.f));
    c.save();
    c.shadowColor = "rgba(255,255,255,.8)"; c.shadowBlur = b.f > 0 && b.f < 1 ? 10 : 4;
    c.fillStyle = "#fff";
    c.beginPath(); c.arc(b.pos[0], b.pos[1] - r * 0.6, r, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  /* ---------- näkymät: koko sivun tausta + mobiilin pieni versio ---------- */
  var scenes = [
    { el: layer, canvas: canvas, ctx: ctx, mini: false, W: 0, H: 0, dpr: 1, L: null, bg: null }
  ];
  if (miniCanvas && miniCanvas.getContext) {
    var mctx = miniCanvas.getContext("2d");
    if (mctx) scenes.push({ el: miniCanvas, canvas: miniCanvas, ctx: mctx, mini: true, W: 0, H: 0, dpr: 1, L: null, bg: null });
  }
  function use(sc) { W = sc.W; H = sc.H; dpr = sc.dpr; L = sc.L; bgCache = sc.bg; MINI = sc.mini; TK = sc.mini ? 1.45 : 1; }
  function drawScene(sc, p) {
    if (!sc.W || !sc.H || !sc.bg) return;
    use(sc);
    var c = sc.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, sc.canvas.width, sc.canvas.height);
    c.drawImage(sc.bg, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFlag(c, p);
    drawSwoosh(c, p);
    drawFigure(c, p);
    drawBall(c, p);
    drawSand(c, p);
  }
  function draw(p) { for (var i = 0; i < scenes.length; i++) drawScene(scenes[i], p); }

  /* ---------- vieritys, koko ja liikkeen vähennys ---------- */
  function reduced() { return !!(reduceMq && reduceMq.matches); }
  function progress() {
    var range = Math.max(doc.scrollHeight, document.body.scrollHeight) - window.innerHeight;
    if (range < 120) return STATIC_P;                 // lyhyt sivu: pysäytyskuva
    return clamp((window.pageYOffset || doc.scrollTop) / range, 0, 1);
  }
  function tick() {                                   // yksi yhteinen rAF-silmukka molemmille näkymille
    raf = 0;
    var d = target - cur;
    cur = Math.abs(d) < 0.0006 ? target : cur + d * 0.2;
    draw(cur);
    if (cur !== target) raf = requestAnimationFrame(tick);
  }
  function onScroll() {
    if (reduced()) return;
    target = progress();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function sizeScene(sc, force) {
    var rect = sc.el.getBoundingClientRect();
    var w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) { sc.W = sc.H = 0; return false; }   // piilossa (esim. pieni versio työpöydällä)
    var nd = Math.min(sc.mini ? 3 : 2, window.devicePixelRatio || 1);
    if (!force && w === sc.W && h === sc.H && nd === sc.dpr && sc.bg) return false;
    sc.W = W = w; sc.H = H = h; sc.dpr = dpr = nd; MINI = sc.mini;
    sc.canvas.width = Math.round(w * nd); sc.canvas.height = Math.round(h * nd);
    if (sc.mini) { sc.L = L = layoutMini(); buildBgMini(); }
    else { sc.L = L = layout(); buildBg(); }
    sc.bg = bgCache;
    return true;
  }
  function resize(force) {
    for (var i = 0; i < scenes.length; i++) sizeScene(scenes[i], force);
    if (reduced()) { cur = target = STATIC_P; }
    else { target = progress(); cur = target; }
    draw(cur);
  }
  var rz = 0;
  function onResize() { if (rz) cancelAnimationFrame(rz); rz = requestAnimationFrame(function () { rz = 0; resize(false); onScroll(); }); }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("load", onResize);
  if (reduceMq) {
    var mqh = function () { resize(true); };
    if (reduceMq.addEventListener) reduceMq.addEventListener("change", mqh); else if (reduceMq.addListener) reduceMq.addListener(mqh);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  resize(true);
})();
