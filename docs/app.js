/* PostiExplorer docs site logic — platform detection, download matrix, version. No deps. */
(function () {
  "use strict";

  var REPO = "JohnGrubba/postiexplorer";
  var LATEST = "https://github.com/" + REPO + "/releases/latest";
  var DL = LATEST + "/download/";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/main/screenshots/";

  var ASSETS = {
    winX64Setup: { file: "PostiExplorer_x64-setup.exe", label: "Installer (x64)", desc: "Guided setup for Windows 10/11 64-bit.", kind: "exe", size: "~3 MB" },
    winX64Port: { file: "postiexplorer.exe", label: "Portable (.exe)", desc: "Single file, no install. Needs WebView2 (preinstalled).", kind: "exe", size: "~13 MB" },
    winArmSetup: { file: "PostiExplorer_arm64-setup.exe", label: "Installer (ARM64)", desc: "For Snapdragon / Surface Pro X and newer.", kind: "exe", size: "~3 MB" },
    linuxApp: { file: "PostiExplorer_amd64.AppImage", label: "AppImage (x64)", desc: "Single file. chmod +x to run.", kind: "appimage", size: "~90 MB" },
    linuxDeb: { file: "PostiExplorer_amd64.deb", label: ".deb (x64)", desc: "For Debian / Ubuntu / Pop!_OS.", kind: "deb", size: "~90 MB" },
    macDmg: { file: "PostiExplorer_aarch64.dmg", label: ".dmg (Apple Silicon)", desc: "For M1/M2/M3/M4 Macs. Drag to Applications.", kind: "dmg", size: "~90 MB" }
  };

  var OS_GROUPS = {
    windows: [
      { h: "Windows x64 — recommended", asset: "winX64Setup", primary: true, install: "Run the installer, then launch PostiExplorer." },
      { h: "Windows x64 — portable", asset: "winX64Port", install: "Download, double-click, connect. No install." },
      { h: "Windows ARM64", asset: "winArmSetup", install: "Installer for ARM64 devices (installer-only)." }
    ],
    linux: [
      { h: "Linux x64 — recommended", asset: "linuxApp", primary: true, install: "chmod +x PostiExplorer_amd64.AppImage && ./PostiExplorer_amd64.AppImage" },
      { h: "Linux x64 — .deb", asset: "linuxDeb", install: "sudo dpkg -i PostiExplorer_amd64.deb" }
    ],
    macos: [
      { h: "macOS Apple Silicon — recommended", asset: "macDmg", primary: true, install: "Open the .dmg and drag PostiExplorer to Applications." }
    ]
  };

  var SHOTS = [
    { f: "app-02-connected.png", t: "Connected data grid" },
    { f: "app-11-er-diagram.png", t: "Interactive ER diagram" },
    { f: "app-03-query.png", t: "Multi-statement SQL editor" },
    { f: "app-12-row-editor.png", t: "Row editor (PK-optional)" },
    { f: "app-13-structure.png", t: "Structure / DDL editing" },
    { f: "app-09-db-picker.png", t: "Database picker" }
  ];

  function detectOS() {
    var ua = navigator.userAgent || "";
    var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var p = (plat + " " + ua).toLowerCase();
    var isArm = /arm|aarch64/.test(p) && !/x86_64|x64|wow64|win64/.test(ua.toLowerCase());
    // Apple Silicon Macs report x86_64-less UAs; treat modern Macs correctly either way.
    if (/mac|darwin/.test(p)) return { os: "macos", arch: /intel/.test(p) ? "x64" : "arm64", label: "macOS (Apple Silicon)" };
    if (/win/.test(p)) return { os: "windows", arch: isArm ? "arm64" : "x64", label: isArm ? "Windows (ARM64)" : "Windows (64-bit)" };
    if (/linux|android/.test(p)) return { os: "linux", arch: isArm ? "arm64" : "x64", label: "Linux (64-bit)" };
    return { os: "windows", arch: "x64", label: "Windows (64-bit)" };
  }

  function primaryAsset(det) {
    if (det.os === "windows") return det.arch === "arm64" ? "winArmSetup" : "winX64Setup";
    if (det.os === "linux") return "linuxApp";
    return "macDmg";
  }

  function heroOsLabel(det) {
    if (det.os === "windows") return det.arch === "arm64" ? "Windows ARM64" : "Windows";
    if (det.os === "linux") return "Linux";
    return "macOS";
  }

  // ── Smart download card ──
  var det = detectOS();
  var key = primaryAsset(det);
  var asset = ASSETS[key];
  var url = DL + asset.file;

  var osName = document.getElementById("osName");
  var smart = document.getElementById("smartDownload");
  var smartSub = document.getElementById("smartSub");
  var heroDownload = document.getElementById("heroDownload");
  var heroOs = document.getElementById("heroOs");
  var heroSub = document.getElementById("heroSub");

  if (osName) osName.textContent = det.label;
  if (heroOs) heroOs.textContent = heroOsLabel(det);
  if (smart) { smart.textContent = "Download · " + asset.label; smart.href = url; }
  if (smartSub) smartSub.textContent = asset.file + " · " + asset.size + " · free";
  if (heroDownload) heroDownload.href = url;
  if (heroSub) heroSub.textContent = "Recommended for " + det.label + ": " + asset.file + ". All formats below.";
  document.querySelectorAll('[data-dl="primary-nav"], [data-dl="primary-cta"]').forEach(function (a) { a.href = url; });

  // ── Download matrix with tabs ──
  var grid = document.getElementById("dlGrid");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".os-tab"));

  function renderGroup(os) {
    if (!grid) return;
    grid.innerHTML = "";
    OS_GROUPS[os].forEach(function (item) {
      var a = ASSETS[item.asset];
      var card = document.createElement("div");
      card.className = "dl-item" + (item.primary ? " reco" : "");
      var h = document.createElement("h3");
      h.textContent = item.h;
      if (item.primary) { var t = document.createElement("span"); t.className = "tag"; t.textContent = "Recommended"; h.appendChild(t); }
      var d = document.createElement("p"); d.textContent = a.desc;
      var f = document.createElement("p"); f.className = "file fine";
      var code = document.createElement("code"); code.textContent = a.file;
      f.appendChild(code); f.appendChild(document.createTextNode(" · " + a.size));
      var row = document.createElement("div"); row.className = "dl-row";
      var btn = document.createElement("a"); btn.className = "btn primary sm"; btn.href = DL + a.file; btn.textContent = "Download " + a.label;
      var cmd = document.createElement("button"); cmd.className = "btn ghost sm"; cmd.textContent = "Copy link";
      cmd.addEventListener("click", function () {
        var link = DL + a.file;
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { cmd.textContent = "Copied ✓"; });
      });
      row.appendChild(btn); row.appendChild(cmd);
      var inst = document.createElement("p"); inst.className = "fine";
      var ic = document.createElement("code"); ic.textContent = item.install;
      inst.appendChild(ic);
      card.appendChild(h); card.appendChild(d); card.appendChild(f); card.appendChild(row); card.appendChild(inst);
      grid.appendChild(card);
    });
  }

  function selectTab(os) {
    tabs.forEach(function (b) {
      var on = b.getAttribute("data-os") === os;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderGroup(os);
  }
  tabs.forEach(function (b) { b.addEventListener("click", function () { selectTab(b.getAttribute("data-os")); }); });
  selectTab(OS_GROUPS[det.os] ? det.os : "windows");

  // ── Screenshots ──
  var shots = document.getElementById("shots");
  var box = document.getElementById("lightbox");
  if (shots) {
    SHOTS.forEach(function (s) {
      var fig = document.createElement("figure");
      fig.className = "shot";
      var img = document.createElement("img");
      img.src = RAW + s.f; img.alt = s.t; img.loading = "lazy";
      img.onerror = function () { fig.style.display = "none"; };
      var cap = document.createElement("figcaption"); cap.textContent = s.t;
      fig.appendChild(img); fig.appendChild(cap);
      fig.addEventListener("click", function () {
        if (!box) return;
        box.querySelector("img").src = RAW + s.f;
        box.querySelector("img").alt = s.t;
        box.classList.add("open"); box.setAttribute("aria-hidden", "false");
      });
      shots.appendChild(fig);
    });
  }
  if (box) {
    box.addEventListener("click", function () { box.classList.remove("open"); box.setAttribute("aria-hidden", "true"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") box.classList.remove("open"); });
  }

  // ── Mobile menu + copy buttons ──
  var burger = document.getElementById("burger");
  var menu = document.getElementById("mobileMenu");
  if (burger && menu) {
    burger.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { menu.classList.remove("open"); }); });
  }
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.getAttribute("data-copy"));
      if (!el) return;
      var txt = el.innerText;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { btn.textContent = "copied ✓"; });
    });
  });
})();
