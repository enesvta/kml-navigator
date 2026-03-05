window.onGoogleMapsLoaded = () => {
  window.__gmapsReady = true;
  tryInitFromStorage();
};

const els = {
  screenPick: document.getElementById("screenPick"),
  screenMain: document.getElementById("screenMain"),
  fileInput: document.getElementById("fileInput"),
  pickError: document.getElementById("pickError"),
  pickBtn: document.getElementById("pickBtn"),

  status: document.getElementById("status"),
  chipCount: document.getElementById("chipCount"),
  chipGps: document.getElementById("chipGps"),

  btnMenu: document.getElementById("btnMenu"),
  menu: document.getElementById("menu"),
  btnFit: document.getElementById("btnFit"),
  btnClear: document.getElementById("btnClear"),

  fabMe: document.getElementById("fabMe"),
  fabKml: document.getElementById("fabKml"),

  sheet: document.getElementById("sheet"),
  sheetHandle: document.getElementById("sheetHandle"),

  search: document.getElementById("search"),
  list: document.getElementById("list"),

  toast: document.getElementById("toast"),
};

let map = null;
let points = [];
let markers = [];

let gpsMarker = null;
let lastPos = null;
let watchId = null;

function toast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.style.opacity = "1";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => (els.toast.style.opacity = "0"), 1500);
}

function setStatus(t) {
  if (els.status) els.status.textContent = t;
}

function showPickError(msg) {
  if (!els.pickError) return alert(msg);
  els.pickError.style.display = "block";
  els.pickError.textContent = msg;
}

function hidePickError() {
  if (!els.pickError) return;
  els.pickError.style.display = "none";
  els.pickError.textContent = "";
}

function waitForGoogleMaps(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      const ok = window.__gmapsReady && typeof google !== "undefined" && google.maps;
      if (ok) { clearInterval(t); resolve(true); }
      else if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        reject(new Error("Google Maps yüklenmedi. API key / internet / billing kontrol edin."));
      }
    }, 100);
  });
}

function initMap() {
  if (map) return;

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 39, lng: 35 },
    zoom: 6,
    mapTypeId: "satellite",
    fullscreenControl: false,
    streetViewControl: false,
    mapTypeControl: false,
    clickableIcons: false,
  });
}

function parseKml(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("KML parse edilemedi (dosya bozuk olabilir).");

  const placemarks = [...xml.getElementsByTagName("Placemark")];
  const pts = [];
  let c = 0;

  for (const pm of placemarks) {
    const name = (pm.getElementsByTagName("name")[0]?.textContent || `P${c + 1}`).trim();

    const pointEl = pm.getElementsByTagName("Point")[0];
    let coordEl = null;
    if (pointEl) coordEl = pointEl.getElementsByTagName("coordinates")[0];
    if (!coordEl) coordEl = pm.getElementsByTagName("coordinates")[0];
    if (!coordEl) continue;

    const raw = (coordEl.textContent || "").trim();
    if (!raw) continue;

    const first = raw.replace(/\n/g, " ").split(/\s+/).filter(Boolean)[0];
    if (!first) continue;

    const parts = first.split(",");
    if (parts.length < 2) continue;

    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    pts.push({ name, lat, lon });
    c++;
  }

  return pts;
}

function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
}

/* Marker: saydam teal pill + crosshair, tam nokta belli */
function setKmlMarkers() {
  initMap();
  clearMarkers();

  const labelStyle = {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    fontSize: "11px",
    fontWeight: "900",
    color: "#fff",
  };

  points.forEach((p, i) => {
    const labelText = (p.name || `${i + 1}`).trim();

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="58" viewBox="0 0 92 58">
  <defs>
    <filter id="s" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="rgba(0,0,0,0.35)"/>
    </filter>
  </defs>

  <g filter="url(#s)">
    <rect x="10" y="8" rx="999" ry="999" width="72" height="24"
      fill="rgba(20,184,166,0.38)"
      stroke="rgba(255,255,255,0.28)"
      stroke-width="1"/>
  </g>

  <line x1="46" y1="36" x2="46" y2="56" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <line x1="36" y1="48" x2="56" y2="48" stroke="white" stroke-width="2" stroke-linecap="round"/>

  <circle cx="46" cy="48" r="4" fill="black" opacity="0.25"/>
  <circle cx="46" cy="48" r="3" fill="white"/>
</svg>`;

    const icon = {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(92, 58),
      anchor: new google.maps.Point(46, 48),
      labelOrigin: new google.maps.Point(46, 25),
    };

    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lon },
      map,
      icon,
      label: { text: labelText, ...labelStyle },
      title: labelText,
      zIndex: 1000 + i,
    });

    m.addListener("click", () => openNav(p.lat, p.lon));
    markers.push(m);
  });

  fitToKml(true);
}

/* Otomatik kanava zoom */
function fitToKml(force = false) {
  if (!map || !points.length) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach(p => bounds.extend({ lat: p.lat, lng: p.lon }));
  map.fitBounds(bounds, 60);

  // Harita ilk kez render olunca bir kez daha (daha stabil)
  if (force) {
    google.maps.event.addListenerOnce(map, "idle", () => {
      map.fitBounds(bounds, 60);
    });
  }
}

/* GPS: çembersiz crosshair */
function ensureGps() {
  if (!navigator.geolocation) {
    if (els.chipGps) els.chipGps.textContent = "GPS: desteklenmiyor";
    return;
  }
  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      lastPos = { lat, lon };

      if (els.chipGps) els.chipGps.textContent = `GPS: ±${Math.round(acc)}m`;
      if (!map) return;

      const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
  <line x1="12" y1="0" x2="12" y2="24" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <line x1="0" y1="12" x2="24" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12" cy="12" r="4" fill="white"/>
</svg>`;

      const icon = {
        url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(24, 24),
        anchor: new google.maps.Point(12, 12),
      };

      if (!gpsMarker) {
        gpsMarker = new google.maps.Marker({
          position: { lat, lng: lon },
          map,
          icon,
          title: "Konumum",
          zIndex: 999999,
        });
      } else {
        gpsMarker.setPosition({ lat, lng: lon });
      }
    },
    () => { if (els.chipGps) els.chipGps.textContent = "GPS: izin yok"; },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function panToMe() {
  if (!map || !lastPos) return;
  map.setZoom(Math.max(map.getZoom(), 17));
  map.panTo({ lat: lastPos.lat, lng: lastPos.lon });
}

/* Nav: CarPlay için comgooglemaps dene, yoksa https */
function openNav(lat, lon) {
  const schemeUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;
  const httpsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  const t = Date.now();
  window.location.href = schemeUrl;
  setTimeout(() => {
    if (Date.now() - t > 300) window.location.href = httpsUrl;
  }, 450);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[m]);
}

function renderList() {
  if (!els.list) return;

  const q = (els.search?.value || "").trim().toLowerCase();
  els.list.innerHTML = "";

  const filtered = points
    .map((p, i) => ({ ...p, i }))
    .filter(x => !q || x.name.toLowerCase().includes(q));

  // küçük “stagger” animasyon hissi: her item’a gecikmeli opacity
  filtered.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "item";
    div.style.opacity = "0";
    div.style.transform = "translateY(6px)";
    div.style.transition = `opacity 220ms var(--ease) ${idx * 12}ms, transform 220ms var(--ease) ${idx * 12}ms`;

    div.innerHTML = `
<div>
  <div class="itemTitle">${escapeHtml(p.name)}</div>
  <div class="itemSub mono">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
</div>
<div class="badge">${p.i + 1}</div>`;

    div.onclick = () => {
      if (map) {
        map.setZoom(Math.max(map.getZoom(), 17));
        map.panTo({ lat: p.lat, lng: p.lon });
      }
      openNav(p.lat, p.lon);
    };

    els.list.appendChild(div);

    // animate in
    requestAnimationFrame(() => {
      div.style.opacity = "1";
      div.style.transform = "translateY(0)";
    });
  });
}

async function handleKmlFile(file) {
  hidePickError();
  setStatus("KML okunuyor…");
  await waitForGoogleMaps();

  const text = await file.text();
  points = parseKml(text);
  if (!points.length) throw new Error("KML içinde nokta bulunamadı (Placemark/Point).");

  initMap();
  setKmlMarkers();      // -> fitToKml(true) içeriyor
  ensureGps();
  renderList();

  if (els.chipCount) els.chipCount.textContent = `${points.length} nokta`;
  setStatus(`Hazır: ${points.length} nokta`);

  els.screenPick.style.display = "none";
  els.screenMain.style.display = "flex";
  toast("Yüklendi");
}

/* --- Ripple helper --- */
function enableRipples() {
  const all = document.querySelectorAll(".btn, .fab, .pickBtn, .sheetHandle");
  all.forEach(el => {
    el.addEventListener("pointerdown", (e) => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      el.style.setProperty("--rx", `${x}%`);
      el.style.setProperty("--ry", `${y}%`);
      el.classList.remove("rippling");
      void el.offsetWidth;
      el.classList.add("rippling");
      setTimeout(() => el.classList.remove("rippling"), 550);
    });
  });
}

/* --- Sheet toggle + drag --- */
let sheetExpanded = false;
function setSheetState(expanded) {
  sheetExpanded = expanded;
  if (expanded) els.sheet.classList.add("expanded");
  else els.sheet.classList.remove("expanded");
}
function toggleSheet() {
  setSheetState(!sheetExpanded);
}

function enableSheetDrag() {
  let startY = 0;
  let startExpanded = false;
  let dragging = false;

  const handle = els.sheetHandle;
  if (!handle) return;

  const onStart = (y) => {
    dragging = true;
    startY = y;
    startExpanded = sheetExpanded;
  };
  const onMove = (y) => {
    if (!dragging) return;
    const dy = y - startY;
    // yukarı sürükle -> expand, aşağı -> collapse
    if (dy < -22) setSheetState(true);
    if (dy > 22) setSheetState(false);
  };
  const onEnd = () => { dragging = false; };

  handle.addEventListener("click", toggleSheet);
  handle.addEventListener("touchstart", (e) => onStart(e.touches[0].clientY), { passive: true });
  handle.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
  handle.addEventListener("touchend", onEnd, { passive: true });

  // sheet üst kısmında da sürüklenebilsin
  els.sheet.addEventListener("touchstart", (e) => {
    if (e.touches[0].clientY < 120) onStart(e.touches[0].clientY);
  }, { passive: true });
  els.sheet.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
  els.sheet.addEventListener("touchend", onEnd, { passive: true });
}

/* Menu toggle */
function toggleMenu() {
  const open = els.menu.style.display !== "none";
  els.menu.style.display = open ? "none" : "flex";
}

function closeMenu() {
  els.menu.style.display = "none";
}

/* Init from storage (opsiyonel: önceki noktaları tutmak istersen) */
function tryInitFromStorage() {
  // İstersen burada localStorage’dan points yükleyip direkt açtırabilirsin.
  // Şu an: KML seçilmeden bir şey yapmıyoruz.
  setStatus("KML yükleyin");
}

els.fileInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try { await handleKmlFile(f); }
  catch (err) { console.error(err); showPickError(err.message || "Hata"); }
  finally { els.fileInput.value = ""; }
});

els.fabKml?.addEventListener("click", () => els.fileInput.click());
els.fabMe?.addEventListener("click", panToMe);

els.btnMenu?.addEventListener("click", toggleMenu);
document.addEventListener("click", (e) => {
  // menü dışına tıklayınca kapat
  if (!els.menu) return;
  const insideMenu = els.menu.contains(e.target) || els.btnMenu.contains(e.target);
  if (!insideMenu) closeMenu();
});

els.btnFit?.addEventListener("click", () => { closeMenu(); fitToKml(true); });
els.btnClear?.addEventListener("click", () => {
  closeMenu();
  clearMarkers();
  if (gpsMarker) gpsMarker.setMap(null), gpsMarker = null;
  if (watchId != null) navigator.geolocation.clearWatch(watchId), watchId = null;

  points = [];
  if (els.list) els.list.innerHTML = "";
  if (els.search) els.search.value = "";
  if (els.chipCount) els.chipCount.textContent = "0 nokta";
  if (els.chipGps) els.chipGps.textContent = "GPS: -";
  setStatus("KML yükleyin");

  els.screenMain.style.display = "none";
  els.screenPick.style.display = "flex";
});

els.search?.addEventListener("input", renderList);

/* Service worker */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

enableRipples();
enableSheetDrag();
setSheetState(false);
setStatus("KML yükleyin");
