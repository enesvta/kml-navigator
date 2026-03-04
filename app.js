// Google Maps callback
window.onGoogleMapsLoaded = () => {
  window.__gmapsReady = true;
  tryInitFromStorage();
};

const els = {
  screenPick: document.getElementById("screenPick"),
  screenMain: document.getElementById("screenMain"),
  fileInput: document.getElementById("fileInput"),
  pickError: document.getElementById("pickError"),

  status: document.getElementById("status"),
  chipCount: document.getElementById("chipCount"),
  chipGps: document.getElementById("chipGps"),

  btnReupload: document.getElementById("btnReupload"),
  btnFit: document.getElementById("btnFit"),
  btnMe: document.getElementById("btnMe"),
  btnClear: document.getElementById("btnClear"),

  search: document.getElementById("search"),
  list: document.getElementById("list"),

  toast: document.getElementById("toast"),
};

let points = [];
let map = null;
let markers = [];

let meMarker = null;
let meAccuracyCircle = null;
let lastPos = null;
let watchId = null;

function toast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.style.opacity = "1";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => (els.toast.style.opacity = "0"), 1600);
}

function setStatus(t) {
  if (els.status) els.status.textContent = t;
}

function showPickError(msg) {
  if (!els.pickError) return;
  els.pickError.style.display = "block";
  els.pickError.textContent = msg;
}
function hidePickError() {
  if (!els.pickError) return;
  els.pickError.style.display = "none";
  els.pickError.textContent = "";
}

function goMainScreen() {
  els.screenPick.style.display = "none";
  els.screenMain.style.display = "flex";
}
function goPickScreen() {
  els.screenMain.style.display = "none";
  els.screenPick.style.display = "flex";
}

// ---------- Storage ----------
function savePoints() {
  localStorage.setItem("kmlnav_points", JSON.stringify(points));
}
function loadPoints() {
  try {
    const p = JSON.parse(localStorage.getItem("kmlnav_points") || "[]");
    if (Array.isArray(p) && p.length) {
      points = p;
      return true;
    }
  } catch (_) {}
  return false;
}
function clearAll() {
  localStorage.removeItem("kmlnav_points");
  points = [];
}

// ---------- KML parse ----------
function normalizeName(name, fallback) {
  const t = (name || "").trim();
  return t ? t : fallback;
}

function parseKml(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("KML parse edilemedi (dosya bozuk olabilir).");

  const placemarks = Array.from(xml.getElementsByTagName("Placemark"));
  const out = [];
  let c = 0;

  for (const pm of placemarks) {
    const nameEl = pm.getElementsByTagName("name")[0];
    const name = normalizeName(nameEl?.textContent, `Point ${c + 1}`);

    const pointEl = pm.getElementsByTagName("Point")[0];
    let coordEl = null;
    if (pointEl) coordEl = pointEl.getElementsByTagName("coordinates")[0];
    if (!coordEl) coordEl = pm.getElementsByTagName("coordinates")[0];
    if (!coordEl) continue;

    const raw = (coordEl.textContent || "").trim();
    if (!raw) continue;

    const first = raw
      .replace(/\n/g, " ")
      .split(/\s+/)
      .filter(Boolean)[0];
    if (!first) continue;

    const parts = first.split(",");
    if (parts.length < 2) continue;

    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    out.push({ name, lat, lon });
    c++;
  }

  return out;
}

// ---------- Google Maps init ----------
function ensureGMaps() {
  if (!window.__gmapsReady || typeof google === "undefined" || !google.maps) {
    throw new Error("Google Maps yüklenmedi. API key / billing / internet kontrol edin.");
  }
}

function initMap() {
  ensureGMaps();
  if (map) return;

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 39.0, lng: 35.0 },
    zoom: 6,
    mapTypeId: "satellite",
    fullscreenControl: false,
    streetViewControl: false,
    mapTypeControl: false,
    clickableIcons: false,
  });
}

function clearMarkers() {
  for (const m of markers) m.setMap(null);
  markers = [];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[m]);
}

// ---------- Minimalist “pill” marker + KML adı ----------
function setKmlMarkers() {
  initMap();
  clearMarkers();

  const labelStyle = {
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    fontSize: "11px",
    fontWeight: "900",
    color: "#ffffff",
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const labelText = (p.name || `${i + 1}`).trim();

    // Minimalist pill (tek parça)
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="78" height="34" viewBox="0 0 78 34">
        <defs>
          <filter id="s" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="rgba(0,0,0,0.35)"/>
          </filter>
        </defs>
        <g filter="url(#s)">
          <rect x="6" y="6" rx="999" ry="999" width="66" height="22"
                fill="rgba(37,99,235,0.95)"/>
          <rect x="6" y="6" rx="999" ry="999" width="66" height="22"
                fill="none" stroke="rgba(255,255,255,0.18)"/>
        </g>
      </svg>
    `;

    const icon = {
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(78, 34),
      anchor: new google.maps.Point(39, 17), // merkez
      labelOrigin: new google.maps.Point(39, 21), // yazı ortası
    };

    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lon },
      map,
      icon,
      label: { text: labelText, ...labelStyle },
      title: labelText,
      zIndex: 1000 + i,
    });

    const info = new google.maps.InfoWindow({
      content: `<b>${escapeHtml(labelText)}</b><br><span style="opacity:.8">${p.lat.toFixed(
        7
      )}, ${p.lon.toFixed(7)}</span>`,
    });

    m.addListener("click", () => {
      info.open({ anchor: m, map });
      openNav(p.lat, p.lon);
    });

    markers.push(m);
  }

  fitToKml();
}

function fitToKml() {
  if (!map || !points.length) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
  map.fitBounds(bounds, 60);
}

// ---------- Geolocation ----------
function ensureGeolocation() {
  if (!navigator.geolocation) {
    els.chipGps.textContent = "GPS: desteklenmiyor";
    return;
  }
  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      lastPos = { lat, lon };
      els.chipGps.textContent = `GPS: ±${Math.round(acc)} m`;

      if (!map) return;
      const meLatLng = { lat, lng: lon };

      if (!meMarker) {
        meMarker = new google.maps.Marker({
          position: meLatLng,
          map,
          title: "Konumum",
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 999999,
        });
      } else {
        meMarker.setPosition(meLatLng);
      }

      if (!meAccuracyCircle) {
        meAccuracyCircle = new google.maps.Circle({
          map,
          center: meLatLng,
          radius: acc,
          fillColor: "#22c55e",
          fillOpacity: 0.12,
          strokeColor: "#22c55e",
          strokeOpacity: 0.45,
          strokeWeight: 1,
        });
      } else {
        meAccuracyCircle.setCenter(meLatLng);
        meAccuracyCircle.setRadius(acc);
      }
    },
    () => {
      els.chipGps.textContent = "GPS: izin yok";
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function panToMe() {
  if (!map || !lastPos) return;
  map.setZoom(Math.max(map.getZoom(), 17));
  map.panTo({ lat: lastPos.lat, lng: lastPos.lon });
}

// ---------- List ----------
function renderList() {
  const q = (els.search.value || "").trim().toLowerCase();
  els.list.innerHTML = "";

  const filtered = points
    .map((p, i) => ({ ...p, i }))
    .filter((x) => !q || x.name.toLowerCase().includes(q));

  for (const p of filtered) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(p.name)}</div>
        <div class="itemSub mono">${p.lat.toFixed(7)}, ${p.lon.toFixed(7)}</div>
      </div>
      <div class="badge">#${p.i + 1}</div>
    `;
    div.addEventListener("click", () => {
      if (map) {
        map.setZoom(Math.max(map.getZoom(), 17));
        map.panTo({ lat: p.lat, lng: p.lon });
      }
      openNav(p.lat, p.lon);
    });
    els.list.appendChild(div);
  }
}

// ---------- CarPlay uyumlu nav ----------
function navUrl(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}

function openNav(lat, lon) {
  const schemeUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;
  const httpsUrl = navUrl(lat, lon);

  const t = Date.now();
  window.location.href = schemeUrl;
  setTimeout(() => {
    if (Date.now() - t > 300) window.location.href = httpsUrl;
  }, 450);
}

// ---------- Flow ----------
async function handleKmlFile(file) {
  hidePickError();
  setStatus("KML okunuyor…");

  const text = await file.text();
  const parsed = parseKml(text);
  if (!parsed.length) throw new Error("KML içinde nokta bulunamadı (Placemark/Point).");

  points = parsed;
  savePoints();

  initMap();
  setKmlMarkers();
  ensureGeolocation();

  els.chipCount.textContent = `${points.length} nokta`;
  setStatus(`Hazır: ${points.length} nokta`);
  renderList();
  goMainScreen();
  toast("Yüklendi");
}

function tryInitFromStorage() {
  if (!window.__gmapsReady) return;

  const has = loadPoints();
  if (!has) {
    setStatus("KML yükleyin");
    return;
  }

  try {
    initMap();
    setKmlMarkers();
    ensureGeolocation();
    els.chipCount.textContent = `${points.length} nokta`;
    setStatus(`Hazır: ${points.length} nokta`);
    renderList();
    goMainScreen();
  } catch (err) {
    showPickError(err.message || "Google Maps yüklenemedi.");
    goPickScreen();
  }
}

// ---------- Events ----------
els.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    await handleKmlFile(f);
  } catch (err) {
    showPickError(err.message || "Hata");
  } finally {
    els.fileInput.value = "";
  }
});

els.btnReupload?.addEventListener("click", () => els.fileInput.click());
els.btnFit?.addEventListener("click", () => fitToKml());
els.btnMe?.addEventListener("click", () => panToMe());
els.btnClear?.addEventListener("click", () => {
  clearAll();
  clearMarkers();
  if (meMarker) meMarker.setMap(null), (meMarker = null);
  if (meAccuracyCircle) meAccuracyCircle.setMap(null), (meAccuracyCircle = null);

  els.search.value = "";
  els.list.innerHTML = "";
  els.chipCount.textContent = "0 nokta";
  els.chipGps.textContent = "GPS: -";
  setStatus("KML yükleyin");
  goPickScreen();
});

els.search?.addEventListener("input", renderList);

// Service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

setStatus("KML yükleyin");
