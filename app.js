// --------------------- DOM ---------------------
const els = {
  screenPick: document.getElementById("screenPick"),
  screenMain: document.getElementById("screenMain"),
  fileInput: document.getElementById("fileInput"),

  status: document.getElementById("status"),
  chipCount: document.getElementById("chipCount"),
  chipGps: document.getElementById("chipGps"),

  btnReupload: document.getElementById("btnReupload"),
  btnFit: document.getElementById("btnFit"),
  btnMe: document.getElementById("btnMe"),
  btnClear: document.getElementById("btnClear"),

  search: document.getElementById("search"),
  list: document.getElementById("list"),
};

// --------------------- State ---------------------
let points = [];
let map = null;
let kmlLayer = null;
let meMarker = null;
let meAccuracy = null;
let lastPos = null;
let watchId = null;

// --------------------- Helpers ---------------------
function fmt(n){ return Number(n).toFixed(7); }
function setStatus(text){ if (els.status) els.status.textContent = text; }
function hardFail(msg){
  // Hem pick ekranında hem main ekranda kullanıcı görsün
  setStatus(msg);
  try { alert(msg); } catch(_) {}
}

function saveToDevice(){ localStorage.setItem("kmlnav_points", JSON.stringify(points)); }
function loadFromDevice(){
  try{
    const p = JSON.parse(localStorage.getItem("kmlnav_points") || "[]");
    if (Array.isArray(p) && p.length) { points = p; return true; }
  }catch(_){}
  return false;
}
function clearDevice(){ localStorage.removeItem("kmlnav_points"); points = []; }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// --------------------- KML parse ---------------------
function normalizeName(name, fallback){
  const t = (name || "").trim();
  return t ? t : fallback;
}

function parseKml(kmlText){
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("KML parse edilemedi (dosya bozuk olabilir).");

  const placemarks = Array.from(xml.getElementsByTagName("Placemark"));
  const out = [];
  let c = 0;

  for (const pm of placemarks){
    const nameEl = pm.getElementsByTagName("name")[0];
    const name = normalizeName(nameEl?.textContent, `Point ${c+1}`);

    const pointEl = pm.getElementsByTagName("Point")[0];
    let coordEl = null;
    if (pointEl) coordEl = pointEl.getElementsByTagName("coordinates")[0];
    if (!coordEl) coordEl = pm.getElementsByTagName("coordinates")[0];
    if (!coordEl) continue;

    const raw = (coordEl.textContent || "").trim();
    if (!raw) continue;

    const first = raw.replace(/\n/g," ").split(/\s+/).filter(Boolean)[0];
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

// --------------------- Map (Leaflet) ---------------------
function ensureLeafletLoaded(){
  // Leaflet CDN yüklenmediyse kullanıcıya net uyarı verelim
  if (typeof window.L === "undefined") {
    throw new Error("Harita kütüphanesi yüklenemedi. İnternet bağlantısı gerekli (veya CDN engelli).");
  }
}

function initMap(){
  ensureLeafletLoaded();
  if (map) return;

  map = L.map("map", { zoomControl: true, preferCanvas: true });

  // Uydu görüntüsü (Esri)
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles © Esri" }
  ).addTo(map);

  kmlLayer = L.layerGroup().addTo(map);

  map.setView([39.0, 35.0], 6);
}

function setKmlMarkers(){
  initMap();
  kmlLayer.clearLayers();

  const icon = L.divIcon({
    className: "kmlPin",
    html: `<div style="
      width:14px;height:14px;border-radius:999px;
      background: rgba(59,130,246,0.95);
      border: 2px solid rgba(255,255,255,0.9);
      box-shadow: 0 8px 16px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7],
  });

  for (let i=0; i<points.length; i++){
    const p = points[i];
    const m = L.marker([p.lat, p.lon], { icon });
    m.bindPopup(`<b>${escapeHtml(p.name)}</b><br/><span style="opacity:.8">${fmt(p.lat)}, ${fmt(p.lon)}</span>`);
    m.on("click", () => openNav(p.lat, p.lon));
    kmlLayer.addLayer(m);
  }

  fitToKml();
}

function fitToKml(){
  if (!map || !points.length) return;
  const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
  map.fitBounds(bounds.pad(0.20));
}

function ensureGeolocation(){
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
      if (els.chipGps) els.chipGps.textContent = `GPS: ±${Math.round(acc)} m`;

      // map yoksa sadece chip güncellensin
      if (!map) return;

      if (!meMarker){
        meMarker = L.circleMarker([lat, lon], {
          radius: 7, weight: 2, color: "white",
          fillColor: "#22c55e", fillOpacity: 0.95
        }).addTo(map).bindPopup("Konumum");
      } else {
        meMarker.setLatLng([lat, lon]);
      }

      if (!meAccuracy){
        meAccuracy = L.circle([lat, lon], {
          radius: acc, weight: 1, color: "#22c55e",
          fillColor: "#22c55e", fillOpacity: 0.12
        }).addTo(map);
      } else {
        meAccuracy.setLatLng([lat, lon]);
        meAccuracy.setRadius(acc);
      }
    },
    () => { if (els.chipGps) els.chipGps.textContent = "GPS: izin yok"; },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function panToMe(){
  if (!map || !lastPos) return;
  map.setView([lastPos.lat, lastPos.lon], Math.max(map.getZoom(), 16));
}

// --------------------- List ---------------------
function renderList(){
  const q = (els.search?.value || "").trim().toLowerCase();
  els.list.innerHTML = "";

  const filtered = points
    .map((p, i) => ({...p, i}))
    .filter(x => !q || x.name.toLowerCase().includes(q));

  for (const p of filtered){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(p.name)}</div>
        <div class="itemSub mono">${fmt(p.lat)}, ${fmt(p.lon)}</div>
      </div>
      <div class="badge">#${p.i + 1}</div>
    `;
    div.addEventListener("click", () => {
      openNav(p.lat, p.lon);
      if (map) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 16));
    });
    els.list.appendChild(div);
  }
}

// --------------------- Google Maps Navigation ---------------------
function navUrl(lat, lon){
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}
function openNav(lat, lon){
  const httpsUrl = navUrl(lat, lon);
  const schemeUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;

  const t = Date.now();
  window.location.href = schemeUrl;
  setTimeout(() => {
    if (Date.now() - t > 300) window.location.href = httpsUrl;
  }, 450);
}

// --------------------- UI flow ---------------------
function goMainScreen(){
  els.screenPick.style.display = "none";
  els.screenMain.style.display = "flex";
}

function resetToPick(){
  clearDevice();
  points = [];
  if (els.search) els.search.value = "";
  if (els.list) els.list.innerHTML = "";
  setStatus("KML yükleyin");
  if (els.chipCount) els.chipCount.textContent = "0 nokta";
  if (kmlLayer) kmlLayer.clearLayers();

  els.screenMain.style.display = "none";
  els.screenPick.style.display = "flex";
}

async function handleKmlFile(file){
  setStatus("KML okunuyor…");
  const text = await file.text();
  const parsed = parseKml(text);
  if (!parsed.length) throw new Error("KML içinde nokta bulunamadı (Placemark/Point).");

  points = parsed;
  saveToDevice();

  // Harita kur
  initMap();
  setKmlMarkers();
  ensureGeolocation();

  if (els.chipCount) els.chipCount.textContent = `${points.length} nokta`;
  setStatus(`Hazır: ${points.length} nokta`);
  renderList();
  goMainScreen();
}

// --------------------- Events ---------------------
els.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  try{
    await handleKmlFile(f);
  }catch(err){
    hardFail(err.message || "Hata oluştu");
  }finally{
    els.fileInput.value = "";
  }
});

els.btnReupload?.addEventListener("click", () => els.fileInput.click());
els.btnFit?.addEventListener("click", () => fitToKml());
els.btnMe?.addEventListener("click", () => panToMe());
els.btnClear?.addEventListener("click", () => resetToPick());
els.search?.addEventListener("input", renderList);

// SW
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// Init: kayıtlı noktalar varsa
(function init(){
  const has = loadFromDevice();
  if (has){
    try{
      initMap();
      setKmlMarkers();
      ensureGeolocation();
      if (els.chipCount) els.chipCount.textContent = `${points.length} nokta`;
      setStatus(`Hazır: ${points.length} nokta`);
      renderList();
      goMainScreen();
    }catch(err){
      // Leaflet yüklenemediyse pick ekranında kalsın
      resetToPick();
      hardFail(err.message || "Harita yüklenemedi");
    }
  } else {
    setStatus("KML yükleyin");
  }
})();
