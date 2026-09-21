(function () {
  "use strict";

  var LOOP = 10000;
  var CAPTIONS = ["Your spreadsheet, checked", "Charts tied to source rows", "An editable report"];
  var BEAT_T = [1200, 3200, 5800];

  var field = document.getElementById("field");
  var stage = document.getElementById("stage");
  var sheet = document.getElementById("sheetPlate");
  var chart = document.getElementById("chartPlate");
  var spine = document.getElementById("spinePlate");
  var plot = document.getElementById("chartPlot");
  var chartUi = document.getElementById("chartUi");
  var slideUi = document.getElementById("slideUi");
  var scanline = document.getElementById("scanline");
  var strike = document.getElementById("strike");
  var ring = document.getElementById("ring");
  var dupRow = document.getElementById("dupRow");
  var blankCell = document.getElementById("blankCell");
  var flagDup = document.getElementById("flagDup");
  var flagBlank = document.getElementById("flagBlank");
  var counter = document.getElementById("counter");
  var barFill = document.getElementById("barFill");
  var barVal = document.getElementById("barVal");
  var targetRule = document.getElementById("targetRule");
  var deltaChip = document.getElementById("deltaChip");
  var ordersChip = document.getElementById("ordersChip");
  var rticks = document.getElementById("rticks");
  var dlChips = document.getElementById("dlChips");
  var replayBtn = document.getElementById("replayBtn");
  var dim = document.getElementById("dim");
  var caption = document.getElementById("beatCaption");
  var ppBtn = document.getElementById("ppBtn");
  var dotsBox = document.getElementById("dots");
  var ticks = Array.prototype.slice.call(document.querySelectorAll(".tick"));
  var fileChip = document.querySelector(".filechip");
  var barGhost = document.getElementById("barGhost");
  var slideTitle = document.querySelector(".s-title");

  for (var i = 0; i < 10; i++) { var d = document.createElement("i"); dotsBox.appendChild(d); }
  var dots = Array.prototype.slice.call(dotsBox.children);

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var t = 0;
  var playing = !reduced;
  var autoPaused = false;
  var last = null;
  var m = null;
  var meas = null;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function eo(p) { return 1 - Math.pow(1 - p, 3); }
  function seg(tt, a, b) { return eo(clamp01((tt - a) / (b - a))); }
  function lin(tt, a, b) { return clamp01((tt - a) / (b - a)); }
  function lerp(a, b, p) { return a + (b - a) * p; }

  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }
  function mixRect(a, b, p) {
    return rect(lerp(a.x, b.x, p), lerp(a.y, b.y, p), lerp(a.w, b.w, p), lerp(a.h, b.h, p));
  }
  function setRect(el, r, scale, op, k) {
    k = k || 1;
    el.style.left = r.x * k + "px";
    el.style.top = r.y * k + "px";
    el.style.width = r.w + "px";
    el.style.height = r.h + "px";
    el.style.transform = scale * k !== 1 ? "scale(" + scale * k + ")" : "";
    el.style.opacity = op;
  }
  function setRectF(el, r, plateW, plateH) {
    el.style.left = r.x * plateW + "px";
    el.style.top = r.y * plateH + "px";
    el.style.width = r.w * plateW + "px";
    el.style.height = r.h * plateH + "px";
  }

  function geom() {
    var fw = field.clientWidth;
    var fh = field.clientHeight;
    if (m && m.fw === fw && m.fh === fh) return m;
    var mobile = fw < 620;
    var g = { fw: fw, fh: fh, mobile: mobile, k: mobile ? 1 : fw / 960 };

    if (!mobile) {
      g.sheet0 = rect(210, 76, 540, 388);
      g.sheet1 = rect(8, 106, 540, 388);
      g.sheet2 = rect(-18, 118, 540, 388);
      g.sheetS = [1, 0.85, 0.78];
      g.sheetO = [1, 1, 0.45];
      g.chartIn = rect(1040, 70, 430, 400);
      g.chartOn = rect(520, 70, 430, 400);
      g.slide = rect(440, 58, 360, 404);
      g.spineIn = rect(1040, 64, 140, 392);
      g.spineOn = rect(812, 64, 140, 392);
      g.dl = rect(505, 466, 0, 0);
      g.replay = rect(866, 494, 0, 0);
      g.plotChart = rect(0.037, 0.25, 0.926, 0.36);
      g.plotSlide = rect(0.05, 0.30, 0.90, 0.42);
      // static triptych (reduced motion)
      g.stillSheet = rect(8, 74, 296, 388);
      g.stillChart = rect(332, 74, 296, 388);
      g.stillSlide = rect(656, 74, 296, 388);
    } else {
      g.sheet0 = rect(16, 34, fw - 32, fh - 44);
      g.sheetStrip = rect(16, 32, fw - 32, 24);
      g.chartIn = rect(fw + 20, 64, fw - 32, fh - 74);
      g.chartOn = rect(16, 64, fw - 32, fh - 74);
      g.slide = rect(16, 64, fw - 32, fh - 64 - 58);
      g.spineIn = rect(fw + 20, fh - 30, fw - 32, 22);
      g.spineOn = rect(16, fh - 30, fw - 32, 22);
      g.dl = rect(16, fh - 58, 0, 0);
      g.replay = rect(fw - 92, fh - 64, 0, 0);
      g.plotChart = rect(0.04, 0.40, 0.92, 0.45);
      g.plotSlide = rect(0.05, 0.40, 0.90, 0.34);
      g.stillSheet = null;
    }
    // measure row geometry inside the sheet plate (post-layout); skip while stripped
    if (!sheet.classList.contains("as-strip") && dupRow.offsetTop > 0) {
      var body = dupRow.parentNode;
      meas = {
        dupTop: dupRow.offsetTop, dupH: dupRow.offsetHeight,
        blankTop: blankCell.offsetTop, blankLeft: blankCell.offsetLeft,
        blankW: blankCell.offsetWidth, blankH: blankCell.offsetHeight,
        tableTop: body.offsetTop, tableH: body.offsetHeight
      };
    }
    if (meas) {
      g.dupTop = meas.dupTop; g.dupH = meas.dupH; g.blankTop = meas.blankTop;
      g.blankLeft = meas.blankLeft; g.blankW = meas.blankW; g.blankH = meas.blankH;
      g.tableTop = meas.tableTop; g.tableH = meas.tableH;
    } else {
      g.dupTop = 0; g.dupH = 0; g.blankTop = 0; g.blankLeft = 0;
      g.blankW = 0; g.blankH = 0; g.tableTop = 0; g.tableH = 0;
    }
    m = g;
    return g;
  }

  function beatIndex(tt) {
    if (tt < BEAT_T[1]) return 0;
    if (tt < BEAT_T[2]) return 1;
    return 2;
  }

  var capShown = -1;
  function render(tt) {
    var g = geom();

    // stage intro fade-up
    var up = seg(tt, 0, 900);
    stage.style.opacity = up;
    stage.style.transform = "translateY(" + (12 * (1 - up)) + "px)";

    // ---- sheet plate position ----
    var sr, ss, so;
    var pA = seg(tt, 2600, 3300);
    var pB = seg(tt, 5900, 6600);
    if (g.mobile) {
      sr = mixRect(g.sheet0, g.sheetStrip, pA);
      so = lerp(1, 0.9, pB);
      ss = 1;
    } else {
      var s01 = mixRect(g.sheet0, g.sheet1, pA);
      sr = mixRect(s01, g.sheet2, pB);
      ss = lerp(lerp(g.sheetS[0], g.sheetS[1], pA), g.sheetS[2], pB);
      so = lerp(lerp(g.sheetO[0], g.sheetO[1], pA), g.sheetO[2], pB);
    }
    var intro = seg(tt, 350, 1100);
    var introY = 16 * (1 - intro);
    var introS = lerp(0.96, 1, intro);
    setRect(sheet, rect(sr.x, sr.y + introY, sr.w, sr.h), ss * introS, so * intro, g.k);
    sheet.classList.toggle("as-strip", g.mobile && pA > 0.6);

    // filename chip pop
    var fc = seg(tt, 850, 1300);
    fileChip.style.transform = "scale(" + lerp(0.8, 1, fc) + ")";
    fileChip.style.opacity = fc;

    // ---- check beat internals ----
    var sweep = lin(tt, 1300, 2400);
    var scanOn = tt >= 1300 && tt <= 2650;
    scanline.style.opacity = scanOn ? (tt < 2400 ? 0.85 : (1 - lin(tt, 2400, 2650)) * 0.85) : 0;
    var scanY = g.tableTop + sweep * g.tableH;
    scanline.style.top = scanY + "px";

    var sp = seg(tt, 2400, 2750);
    strike.style.transform = "scaleX(" + sp + ")";
    strike.style.opacity = sp > 0 ? 1 : 0;
    strike.style.left = "18px";
    strike.style.top = (g.dupTop + g.dupH / 2) + "px";
    strike.style.width = "calc(100% - 36px)";

    var rp = seg(tt, 2500, 2850);
    ring.style.opacity = rp;
    ring.style.left = (g.blankLeft + 8) + "px";
    ring.style.top = (g.blankTop + 2) + "px";
    ring.style.width = (g.blankW - 16) + "px";
    ring.style.height = (g.blankH - 4) + "px";
    ring.style.transform = "scale(" + lerp(1.25, 1, rp) + ")";

    var f1 = seg(tt, 2550, 2950);
    flagDup.style.opacity = f1;
    flagDup.style.transform = "translateY(" + (6 * (1 - f1)) + "px)";
    flagDup.style.right = "12px";
    flagDup.style.top = (g.dupTop - 6) + "px";

    var f2 = seg(tt, 2650, 3050);
    flagBlank.style.opacity = f2;
    flagBlank.style.transform = "translateY(" + (6 * (1 - f2)) + "px)";
    flagBlank.style.right = "12px";
    flagBlank.style.top = (g.blankTop + g.blankH - 20) + "px";

    var kept = Math.round(lerp(2417, 2400, seg(tt, 2650, 3200)));
    counter.textContent = kept.toLocaleString("en-US") + " of 2,417 rows kept";

    // ---- chart plate position ----
    var cin = seg(tt, 3200, 3750);
    var morph = seg(tt, 5800, 6500);
    var cr;
    if (g.mobile) {
      var c0 = mixRect(g.chartIn, g.chartOn, cin);
      cr = mixRect(c0, g.slide, morph);
    } else {
      var c1 = mixRect(g.chartIn, g.chartOn, cin);
      cr = mixRect(c1, g.slide, morph);
    }
    setRect(chart, cr, 1, cin, g.k);
    chart.classList.toggle("is-slide", morph > 0.55);

    // plot region morph (fractions of plate)
    var pr = mixRect(g.plotChart, g.plotSlide, morph);
    setRectF(plot, pr, cr.w, cr.h);

    // chrome swap
    chartUi.style.opacity = clamp01(cin * (1 - morph));
    var sIn = seg(tt, 6150, 6800);
    slideUi.style.opacity = sIn;

    // slide title stamp
    var stamp = seg(tt, 6300, 6500);
    slideTitle.style.opacity = stamp;
    slideTitle.style.transform = "scale(" + lerp(1.14, 1, stamp) + ")";

    // ---- chart beat internals ----
    var draw = seg(tt, 3700, 4200);
    barFill.style.width = draw * 80.09 + "%";
    barVal.style.opacity = clamp01((draw - 0.35) / 0.4);
    var valPct = draw * 80.09;
    barVal.style.left = valPct + "%";
    barVal.style.transform = "translate(calc(-100% - 8px), -50%)";
    barGhost.style.opacity = 0.35 + 0.65 * seg(tt, 3600, 3900);

    var tgt = seg(tt, 4250, 4450);
    targetRule.style.opacity = tgt;
    targetRule.style.transform = "scaleY(" + lerp(0.4, 1, tgt) + ")";
    targetRule.style.transformOrigin = "center bottom";

    var dv = seg(tt, 4300, 4900);
    deltaChip.textContent = "-" + (11.9 * dv).toFixed(1) + "% vs plan";

    var ord = seg(tt, 4900, 5300);
    ordersChip.style.opacity = ord;
    var apath = ordersChip.querySelector("path");
    if (apath) {
      var len = 22;
      apath.style.strokeDasharray = String(len);
      apath.style.strokeDashoffset = String(len * (1 - ord));
    }

    var rts = rticks.querySelectorAll("i");
    for (var ri = 0; ri < rts.length; ri++) {
      rts[ri].style.opacity = seg(tt, 4350 + ri * 90, 4650 + ri * 90);
    }
    rticks.querySelector(".rticks-target").style.opacity = seg(tt, 4350, 4600);

    // ---- spine + download chips ----
    var spIn = seg(tt, 6600, 7300);
    var spr = g.mobile ? mixRect(g.spineIn, g.spineOn, spIn) : mixRect(g.spineIn, g.spineOn, spIn);
    setRect(spine, spr, 1, spIn, g.k);
    spine.classList.toggle("as-strip", g.mobile);

    var dIn = seg(tt, 7600, 8000);
    var pulse = tt >= 8500 && tt < 8800 ? 1 + 0.06 * Math.sin((tt - 8500) / 300 * Math.PI) : 1;
    if (g.mobile) {
      dlChips.style.left = "50%";
      dlChips.style.right = "auto";
      dlChips.style.top = g.dl.y + "px";
      dlChips.style.transform = "translate(-50%, " + (8 * (1 - dIn)) + "px) scale(" + pulse + ")";
    } else {
      dlChips.style.left = g.dl.x * g.k + "px";
      dlChips.style.right = "auto";
      dlChips.style.top = g.dl.y * g.k + "px";
      dlChips.style.transform = "translateY(" + (8 * (1 - dIn)) + "px) scale(" + pulse + ")";
    }
    dlChips.style.opacity = dIn;

    var rp2 = seg(tt, 8800, 9200);
    replayBtn.style.opacity = rp2;
    if (!g.mobile) { replayBtn.style.left = g.replay.x * g.k + "px"; replayBtn.style.top = g.replay.y * g.k + "px"; replayBtn.style.right = "auto"; replayBtn.style.bottom = "auto"; }
    else { replayBtn.style.left = "auto"; replayBtn.style.bottom = "auto"; replayBtn.style.right = "12px"; replayBtn.style.top = "10px"; }

    // ---- caption ----
    var bi = beatIndex(tt);
    if (bi !== capShown) { capShown = bi; caption.textContent = CAPTIONS[bi]; }
    var capBase = bi === 0 ? 1200 : BEAT_T[bi];
    caption.style.opacity = 0.35 + 0.65 * seg(tt, capBase, capBase + 400);

    // ---- controls ----
    var sec = Math.floor(tt / 1000);
    for (var di = 0; di < dots.length; di++) dots[di].classList.toggle("on", di < sec);
    for (var ti = 0; ti < ticks.length; ti++) {
      var t0 = parseFloat(ticks[ti].getAttribute("data-t"));
      var t1 = ti + 1 < ticks.length ? parseFloat(ticks[ti + 1].getAttribute("data-t")) : LOOP;
      ticks[ti].classList.toggle("on", tt >= t0 - 1200 && tt < t1);
    }

    // ---- loop dim ----
    dim.style.opacity = lin(tt, 9600, 10000) * 0.6;
  }

  // static triptych for prefers-reduced-motion
  function renderStill() {
    var g = geom();
    stage.style.opacity = 1;
    stage.style.transform = "";
    if (g.mobile || !g.stillSheet) {
      render(8400);
      dim.style.opacity = 0;
      return;
    }
    setRect(sheet, g.stillSheet, 1, 1, g.k);
    sheet.classList.remove("as-strip");
    fileChip.style.transform = "";
    fileChip.style.opacity = 1;
    scanline.style.opacity = 0;
    strike.style.transform = "scaleX(1)";
    strike.style.opacity = 1;
    strike.style.left = "18px";
    strike.style.top = (g.dupTop + g.dupH / 2) + "px";
    strike.style.width = "calc(100% - 36px)";
    ring.style.opacity = 1;
    ring.style.left = (g.blankLeft + 8) + "px";
    ring.style.top = (g.blankTop + 2) + "px";
    ring.style.width = (g.blankW - 16) + "px";
    ring.style.height = (g.blankH - 4) + "px";
    flagDup.style.opacity = 1; flagDup.style.transform = "";
    flagDup.style.right = "12px"; flagDup.style.top = (g.dupTop - 6) + "px";
    flagBlank.style.opacity = 1; flagBlank.style.transform = "";
    flagBlank.style.right = "12px"; flagBlank.style.top = (g.blankTop + g.blankH - 20) + "px";
    counter.textContent = "2,400 of 2,417 rows kept";

    var stillCard = document.getElementById("stillCard");
    stillCard.classList.add("on");
    setRect(stillCard, g.stillSlide, 1, 1, g.k);

    setRect(chart, g.stillChart, 1, 1, g.k);
    chart.classList.remove("is-slide");
    chartUi.style.opacity = 1;
    slideUi.style.opacity = 0;
    setRectF(plot, rect(0.05, 0.3, 0.9, 0.55), g.stillChart.w, g.stillChart.h);
    barFill.style.width = "80.09%";
    barVal.style.opacity = 1;
    barVal.style.left = "80.09%";
    barVal.style.transform = "translate(calc(-100% - 8px), -50%)";
    barGhost.style.opacity = 1;
    targetRule.style.opacity = 1;
    deltaChip.textContent = "-11.9% vs plan";
    ordersChip.style.opacity = 1;
    var apath = ordersChip.querySelector("path");
    if (apath) { apath.style.strokeDasharray = "none"; apath.style.strokeDashoffset = "0"; }
    var rts = rticks.querySelectorAll("i");
    for (var ri = 0; ri < rts.length; ri++) rts[ri].style.opacity = 1;
    rticks.querySelector(".rticks-target").style.opacity = 1;

    var sp2 = document.getElementById("spinePlate");
    setRect(sp2, rect(0, 0, 0, 0), 1, 0, g.k);
    dlChips.style.left = 738 * g.k + "px";
    dlChips.style.top = 470 * g.k + "px";
    dlChips.style.opacity = 1;
    dlChips.style.transform = "";
    replayBtn.style.opacity = 1;
    replayBtn.style.left = 866 * g.k + "px";
    replayBtn.style.top = 494 * g.k + "px";
    dim.style.opacity = 0;
    caption.style.opacity = 0;
    for (var di = 0; di < dots.length; di++) dots[di].classList.add("on");
    for (var ti = 0; ti < ticks.length; ti++) ticks[ti].classList.add("on");
  }

  function frame(now) {
    if (last === null) last = now;
    var dt = now - last;
    last = now;
    if (playing) {
      t = (t + dt) % LOOP;
      render(t);
    }
    requestAnimationFrame(frame);
  }

  function setPlaying(v) {
    playing = v;
    autoPaused = false;
    ppBtn.classList.toggle("paused", !v);
    ppBtn.setAttribute("aria-pressed", String(!v));
    ppBtn.setAttribute("aria-label", v ? "Pause demo" : "Play demo");
  }

  ppBtn.addEventListener("click", function (e) { e.stopPropagation(); setPlaying(!playing); });
  field.addEventListener("click", function () { if (!reduced) setPlaying(!playing); });
  field.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!reduced) setPlaying(!playing); }
  });
  replayBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    t = 0; capShown = -1;
    if (reduced) { renderStill(); } else { setPlaying(true); render(0); }
  });
  ticks.forEach(function (tk) {
    tk.addEventListener("click", function (e) {
      e.stopPropagation();
      t = parseFloat(tk.getAttribute("data-t"));
      capShown = -1;
      if (reduced) { return; }
      render(t);
    });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (playing) { playing = false; autoPaused = true; ppBtn.classList.add("paused"); }
    } else if (autoPaused && !reduced) {
      setPlaying(true);
    }
  });
  window.addEventListener("resize", function () {
    m = null; meas = null;
    sheet.classList.remove("as-strip");
    if (reduced) renderStill(); else render(t);
  });

  if (reduced) {
    ppBtn.classList.add("paused");
    renderStill();
  } else {
    render(0);
    requestAnimationFrame(frame);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { m = null; meas = null; if (reduced) renderStill(); else render(t); });
  }

  window.__trial = {
    seek: function (v) { t = v; capShown = -1; if (reduced) renderStill(); else render(t); },
    pause: function () { setPlaying(false); },
    play: function () { setPlaying(true); },
    isPlaying: function () { return playing; }
  };
})();
