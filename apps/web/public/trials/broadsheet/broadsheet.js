/* Direction B - Broadsheet: ~11s annotator loop */
/* global document, window, requestAnimationFrame */
(function () {
  "use strict";

  var LOOP = 11000;

  var $ = function (id) { return document.getElementById(id); };
  var platesEl = $("plates");
  var plateData = $("plateData");
  var plateFind = $("plateFind");
  var plateRep = $("plateRep");
  var vrule = $("vrule");
  var strike = $("bsStrike");
  var ring = $("bsRing");
  var flagDup = $("bsFlagDup");
  var flagBlank = $("bsFlagBlank");
  var dupRow = $("bsDup");
  var blankCell = $("bsBlank");
  var rowCount = $("rowCount");
  var delta = $("bsDelta");
  var orders = $("bsOrders");
  var fChart = $("fChart");
  var fBarFill = $("fBarFill");
  var fBarVal = $("fBarVal");
  var fTarget = $("fTarget");
  var fRticks = $("fRticks");
  var sTitle = $("sTitle");
  var sChart = $("sChart");
  var sNote = $("sNote");
  var sFoot = $("sFoot");
  var wbStrip = $("wbStrip");
  var replayBtn = $("replayBtn");
  var loopFade = $("loopFade");
  var marks = [].slice.call(document.querySelectorAll(".rmark"));

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var t = 0;
  var last = null;
  var playing = !reduced;
  var autoPaused = false;
  var meas = null;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function eo(p) { return 1 - Math.pow(1 - p, 3); }
  function seg(tt, a, b) { return eo(clamp01((tt - a) / (b - a))); }
  function lin(tt, a, b) { return clamp01((tt - a) / (b - a)); }
  function lerp(a, b, p) { return a + (b - a) * p; }

  function relTo(el, container) {
    var x = 0, y = 0;
    while (el && el !== container) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return { x: x, y: y };
  }
  function measure() {
    if (meas) return meas;
    if (dupRow.offsetTop <= 0) return null;
    var body = plateData.querySelector(".plate-body");
    var d = relTo(dupRow, body);
    var b = relTo(blankCell, body);
    meas = {
      dupTop: d.y, dupH: dupRow.offsetHeight,
      blankTop: b.y, blankLeft: b.x,
      blankW: blankCell.offsetWidth, blankH: blankCell.offsetHeight,
      tableW: plateData.clientWidth
    };
    return meas;
  }

  function render(tt) {
    var m = measure();

    // ---- plate settle: 12px rise + fade, 120ms stagger ----
    var p1 = seg(tt, 0, 700);
    var p2 = seg(tt, 120, 820);
    var p3 = seg(tt, 240, 940);
    plateData.style.opacity = p1;
    plateData.style.transform = "translateY(" + (12 * (1 - p1)) + "px)";
    plateFind.style.opacity = p2;
    plateFind.style.transform = "translateY(" + (12 * (1 - p2)) + "px)";
    plateRep.style.opacity = p3;
    plateRep.style.transform = "translateY(" + (12 * (1 - p3)) + "px)";

    // ---- rail marks ----
    var fills = [seg(tt, 400, 900), seg(tt, 3600, 4000), seg(tt, 6600, 7000)];
    for (var i = 0; i < marks.length; i++) {
      marks[i].style.setProperty("--fill", fills[i]);
      marks[i].classList.toggle("on", fills[i] > 0.02);
    }

    // ---- DATA beat ----
    var sweep = lin(tt, 1100, 2400);
    var vrOn = tt >= 1100 && tt <= 2700;
    vrule.style.opacity = vrOn ? (tt < 2400 ? 1 : (1 - lin(tt, 2400, 2700))) : 0;
    if (m) {
      var body = plateData.querySelector(".plate-body");
      var bw = body.clientWidth;
      vrule.style.left = (14 + sweep * (bw - 28)) + "px";
      vrule.style.top = "14px";
      vrule.style.bottom = "10px";
    }

    var sp = seg(tt, 2400, 2750);
    strike.style.transform = "scaleX(" + sp + ")";
    strike.style.opacity = sp > 0 ? 1 : 0;
    if (m) {
      strike.style.left = "20px";
      strike.style.top = (m.dupTop + m.dupH / 2) + "px";
      strike.style.width = "calc(100% - 40px)";
    }

    var rp = seg(tt, 2500, 2850);
    ring.style.opacity = rp;
    if (m) {
      ring.style.left = (m.blankLeft + 4) + "px";
      ring.style.top = (m.blankTop + 1) + "px";
      ring.style.width = (m.blankW - 8) + "px";
      ring.style.height = (m.blankH - 2) + "px";
      ring.style.transform = "scale(" + lerp(1.2, 1, rp) + ")";
    }

    var f1 = seg(tt, 2550, 2950);
    flagDup.style.opacity = f1;
    flagDup.style.transform = "translateY(" + (5 * (1 - f1)) + "px)";
    if (m) { var fr = platesEl.clientWidth < 620 ? "12px" : "18px"; flagDup.style.right = fr; flagDup.style.top = (m.dupTop + m.dupH / 2 - 9) + "px"; }
    var f2 = seg(tt, 2650, 3050);
    flagBlank.style.opacity = f2;
    flagBlank.style.transform = "translateY(" + (5 * (1 - f2)) + "px)";
    if (m) { var frb = platesEl.clientWidth < 620 ? "12px" : "18px"; flagBlank.style.right = frb; flagBlank.style.top = (m.blankTop + m.blankH - 14) + "px"; }

    rowCount.textContent = tt >= 2800 ? "2,417 \u2192 2,400 rows" : "2,417 rows read";

    // ---- FINDINGS beat ----
    var barP = seg(tt, 3400, 4000);
    var barH = 88.1 * barP;
    fBarFill.style.height = barH + "%";
    fBarVal.style.opacity = seg(tt, 3900, 4200);
    fBarVal.style.bottom = (barH - 2) + "%";
    fTarget.style.opacity = seg(tt, 3900, 4100);
    fTarget.style.transform = "scaleX(" + seg(tt, 3900, 4150) + ")";
    fTarget.style.transformOrigin = "right center";

    var dv = -11.9 * seg(tt, 4100, 4700);
    delta.textContent = (Math.round(dv * 10) / 10).toFixed(1) + "%";
    delta.style.opacity = tt >= 4100 ? 1 : 0;

    var oc = seg(tt, 4700, 4900);
    orders.style.opacity = oc;
    var ap = orders.querySelector(".arr path");
    if (ap) {
      var len = 20;
      ap.style.strokeDasharray = String(len);
      ap.style.strokeDashoffset = String(len * (1 - lin(tt, 4700, 5100)));
    }

    var rts = fRticks.querySelectorAll("i");
    for (var ri = 0; ri < rts.length; ri++) {
      rts[ri].style.opacity = seg(tt, 4400 + ri * 90, 4600 + ri * 90);
    }
    fRticks.querySelector("b").style.opacity = seg(tt, 4800, 5000);
    fRticks.style.opacity = seg(tt, 4300, 4600);

    // findings chart crossfades into report (same chart, same geometry)
    var xfade = lin(tt, 6400, 7100);
    fChart.style.opacity = 1 - xfade * 0.85;
    fChart.style.transform = "translateY(" + (-6 * xfade) + "px)";

    // ---- REPORT beat ----
    var stamp = seg(tt, 6500, 6700);
    sTitle.style.opacity = stamp;
    sTitle.style.transform = "scale(" + lerp(1.12, 1, stamp) + ")";
    sChart.style.opacity = seg(tt, 6500, 7200);
    var sBar = sChart.querySelector(".s-bar i");
    sBar.style.opacity = seg(tt, 6600, 7000);
    sChart.querySelector(".s-target").style.opacity = seg(tt, 6700, 7100);
    sChart.querySelector(".s-bar-val").style.opacity = seg(tt, 6800, 7200);
    sNote.style.opacity = seg(tt, 6900, 7300);
    sFoot.style.opacity = seg(tt, 7100, 7500);
    var wu = seg(tt, 7000, 7600);
    wbStrip.style.transform = "translateY(" + (100 * (1 - wu)) + "%)";

    replayBtn.style.opacity = seg(tt, 9600, 10000);

    // ---- loop fade to settled frame ----
    loopFade.style.opacity = lin(tt, 10600, 11000);
  }

  function renderStill() {
    // finished spread, all flags visible
    measure();
    [plateData, plateFind, plateRep].forEach(function (p) { p.style.opacity = 1; p.style.transform = ""; });
    marks.forEach(function (mk) { mk.style.setProperty("--fill", 1); mk.classList.add("on"); });
    vrule.style.opacity = 0;
    strike.style.opacity = 1; strike.style.transform = "scaleX(1)";
    ring.style.opacity = 1;
    flagDup.style.opacity = 1; flagDup.style.transform = "";
    flagBlank.style.opacity = 1; flagBlank.style.transform = "";
    if (meas) {
      strike.style.left = "20px"; strike.style.top = (meas.dupTop + meas.dupH / 2) + "px"; strike.style.width = "calc(100% - 40px)";
      ring.style.left = (meas.blankLeft + 4) + "px"; ring.style.top = (meas.blankTop + 1) + "px";
      ring.style.width = (meas.blankW - 8) + "px"; ring.style.height = (meas.blankH - 2) + "px";
      var frs = platesEl.clientWidth < 620 ? "12px" : "18px";
      flagDup.style.right = frs; flagDup.style.top = (meas.dupTop + meas.dupH / 2 - 9) + "px";
      flagBlank.style.right = frs; flagBlank.style.top = (meas.blankTop + meas.blankH - 14) + "px";
    }
    rowCount.textContent = "2,417 \u2192 2,400 rows";
    fBarFill.style.height = "88.1%";
    fBarVal.style.opacity = 1; fBarVal.style.bottom = "86%";
    fTarget.style.opacity = 1; fTarget.style.transform = "";
    delta.textContent = "-11.9%"; delta.style.opacity = 1;
    orders.style.opacity = 1;
    var ap = orders.querySelector(".arr path");
    if (ap) { ap.style.strokeDasharray = "none"; ap.style.strokeDashoffset = "0"; }
    fRticks.style.opacity = 1;
    [].forEach.call(fRticks.querySelectorAll("i,b"), function (e) { e.style.opacity = 1; });
    fChart.style.opacity = 1; fChart.style.transform = "";
    sTitle.style.opacity = 1; sTitle.style.transform = "";
    sChart.style.opacity = 1;
    sChart.querySelector(".s-bar i").style.opacity = 1;
    sChart.querySelector(".s-target").style.opacity = 1;
    sChart.querySelector(".s-bar-val").style.opacity = 1;
    sNote.style.opacity = 1;
    sFoot.style.opacity = 1;
    wbStrip.style.transform = "translateY(0)";
    replayBtn.style.opacity = 1;
    loopFade.style.opacity = 0;
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
  }

  platesEl.addEventListener("click", function () { if (!reduced) setPlaying(!playing); });
  platesEl.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!reduced) setPlaying(!playing); }
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === " " || e.key === "Enter") && (e.target === document.body)) {
      e.preventDefault(); if (!reduced) setPlaying(!playing);
    }
  });
  replayBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    t = 0;
    if (reduced) { renderStill(); } else { setPlaying(true); render(0); }
  });
  marks.forEach(function (mk) {
    mk.addEventListener("click", function (e) {
      e.stopPropagation();
      t = parseFloat(mk.getAttribute("data-t"));
      if (reduced) { renderStill(); return; }
      render(t);
      if (!playing) setPlaying(true);
    });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (playing) { playing = false; autoPaused = true; }
    } else if (autoPaused && !reduced) {
      setPlaying(true);
    }
  });
  window.addEventListener("resize", function () {
    meas = null;
    if (reduced) renderStill(); else render(t);
  });

  if (reduced) {
    renderStill();
  } else {
    render(0);
    requestAnimationFrame(frame);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { meas = null; if (reduced) renderStill(); else render(t); });
  }

  window.__trial = {
    seek: function (v) { t = v; if (reduced) renderStill(); else render(t); },
    pause: function () { setPlaying(false); },
    play: function () { setPlaying(true); },
    isPlaying: function () { return playing; }
  };
})();
