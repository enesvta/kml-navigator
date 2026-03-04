const els = {
  status: document.getElementById("status"),
  fileInput: document.getElementById("fileInput"),
  btnClear: document.getElementById("btnClear"),

  navCard: document.getElementById("navCard"),
  poiName: document.getElementById("poiName"),
  poiCoords: document.getElementById("poiCoords"),
  progress: document.getElementById("progress"),

  btnPrev: document.getElementById("btnPrev"),
  btnNext: document.getElementById("btnNext"),
  btnNav: document.getElementById("btnNav"),

  btnNearest: document.getElementById("btnNearest"),
  btnArrived: document.getElementById("btnArrived"),
  btnMyLoc: document.getElementById("btnMyLoc"),

  btnOpenMap: document.getElementById("btnOpenMap"),
  btnList: document.getElementById("btnList"),
  btnResetIndex: document.getElementById("btnResetIndex"),

  listCard: document.getElementById("listCard"),
  btnCloseList: document.getElementById("btnCloseList"),
  list: document.getElementById("list"),
  search: document.getElementById("search"),

  toggleAutoNav: document.getElementById("toggleAutoNav"),
  toggleWake: document.getElementById("toggleWake"),

  toast: document.getElementById("toast"),
};

// State
let points = [];
let idx = 0;
let wakeLock = null;

// --- UI helpers ---
function setStatus(text){ if (els.status) els.status.textContent = text; }
function fmt(n){ return Number(n).toFixed(7); }

let toastTimer = null;
function toast(msg){
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.style.opacity = "0"), 1800);
}

// --- Storage ---
function saveState(){
  localStorage.setItem("kmlnav_points", JSON.stringify(points));
  localStorage.setItem("kmlnav_idx", String(idx));
  localStorage.setItem("kmlnav_autonav", els.toggleAutoNav?.checked ? "1" : "0");
  localStorage.setItem("kmlnav_wake", els.toggleWake?.checked ? "1" : "0");
}
function loadState(){
  try{
    const p = JSON.parse(localStorage.getItem("kmlnav_points") || "[]");
    const i = parseInt(localStorage.getItem("kmlnav_idx") || "0", 10);
    if (Array.isArray(p) && p.length){
      points = p;
      idx = Number.isFinite(i) ? Math.min(Math.max(i,0), points.length-1) : 0;
    }
  }catch(_){}

  if (els.toggleAutoNav) els.toggleAutoNav.checked = (localStorage.getItem("kmlnav_autonav") === "1");
  if (els.toggleWake) els.toggleWake.checked = (localStorage.getItem("kmlnav_wake") === "1");
}
function clearState(){
  points = [];
  idx = 0;
  localStorage.removeItem("kmlnav_points");
  localStorage.removeItem("kmlnav_idx");
}

// --- KML parsing ---
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

    // Önce Point içindeki coordinates, yoksa ilk coordinates
    const pointEl = pm.getElementsByTagName("Point")[0];
    let coordEl = null;
    if (pointEl) coordEl = pointEl.getElementsByTagName("coordinates")[0];
    if (!coordEl) coordEl = pm.getElementsByTagName("coordinates")[0];
    if (!coordEl) continue;

    const raw = (coordEl.textContent || "").trim();
    if (!raw) continue;

    // Çoklu koordinat varsa ilkini al
    const first = raw.replace(/\n/g," ").split(/\s+/).filter(Boolean)[0];
    if (!first) continue;

    // KML: lon,lat,alt
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

// --- Render ---
function render(){
  const has = points.length > 0;

  if (els.btnClear) els.btnClear.disabled = !has;
  if (els.navCard) els.navCard.style.display = has ? "block" : "none";
  if (els.listCard) els.listCard.style.display = "none";

  if (!has){
    setStatus("KML yükleyin");
    return;
  }

  idx = Math.min(Math.max(idx, 0), points.length - 1);
  const p = points[idx];

  els.poiName.textContent = p.name;
  els.poiCoords.textContent = `${fmt(p.lat)}, ${fmt(p.lon)}`;
  els.progress.textContent = `${idx+1} / ${points.length}`;

  els.btnPrev.disabled = (idx === 0);
  els.btnNext.disabled = (idx === points.length - 1);

  setStatus(`Hazır: ${points.length} nokta`);
  saveState();
}

// --- Maps launching ---
function googleMapsNavUrl(lat, lon){
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}
function googleMapsSearchUrl(lat, lon){
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}
function googleMapsFromToUrl(fromLat, fromLon, toLat, toLon){
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${toLat},${toLon}&travelmode=driving`;
}

function openGoogleMapsNav(lat, lon){
  const httpsUrl = googleMapsNavUrl(lat, lon);

  // iOS’ta Google Maps yüklüyse hızlı açılır; yoksa https fallback
  const schemeUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;

  const t = Date.now();
  window.location.href = schemeUrl;
  setTimeout(() => {
    if (Date.now() - t > 300) window.location.href = httpsUrl;
  }, 450);
}

function openInMap(lat, lon){
  window.location.href = googleMapsSearchUrl(lat, lon);
}

// --- Geolocation / nearest ---
function getCurrentPosition(opts = {}){
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Konum servisi desteklenmiyor."));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000,
      ...opts
    });
  });
}

// Haversine (meters)
function distMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function goNearest(){
  if (!points.length) return;

  try{
    toast("Konum alınıyor…");
    const pos = await getCurrentPosition();
    const myLat = pos.coords.latitude;
    const myLon = pos.coords.longitude;

    let bestI = 0;
    let bestD = Infinity;
    for (let i=0; i<points.length; i++){
      const p = points[i];
      const d = distMeters(myLat, myLon, p.lat, p.lon);
      if (d < bestD){ bestD = d; bestI = i; }
    }

    idx = bestI;
    render();
    toast(`En yakın: ~${Math.round(bestD)} m`);
  }catch(err){
    toast(err.message || "Konum alınamadı (izin verin).");
  }
}

async function openFromMyLocationToTarget(){
  if (!points.length) return;
  const p = points[idx];

  try{
    toast("Konum alınıyor…");
    const pos = await getCurrentPosition();
    const myLat = pos.coords.latitude;
    const myLon = pos.coords.longitude;
    window.location.href = googleMapsFromToUrl(myLat, myLon, p.lat, p.lon);
  }catch(err){
    toast(err.message || "Konum alınamadı (izin verin).");
  }
}

function arrivedNext(){
  if (!points.length) return;

  if (idx < points.length - 1){
    idx++;
    render();
    toast("Sonraki nokta seçildi.");
    if (els.toggleAutoNav?.checked){
      const p = points[idx];
      openGoogleMapsNav(p.lat, p.lon);
    }
  } else {
    toast("Son noktadasınız.");
  }
}

// --- List UI ---
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function showList(){
  els.listCard.style.display = "block";
  els.search.value = "";
  renderList("");
  els.search.focus();
}
function hideList(){
  els.listCard.style.display = "none";
}

function renderList(query){
  const q = (query || "").trim().toLowerCase();
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
        <div class="itemSub mono">${fmt(p.lat)}, ${fmt(p.lon)} · #${p.i+1}</div>
      </div>
      <div class="itemBtns">
        <button class="btn small ghost" data-nav="${p.i}">Nav</button>
        <button class="btn small" data-go="${p.i}">Seç</button>
      </div>
    `;
    els.list.appendChild(div);
  }

  els.list.querySelectorAll("button[data-go]").forEach(btn => {
    btn.addEventListener("click", () => {
      idx = parseInt(btn.getAttribute("data-go"), 10);
      hideList();
      render();
    });
  });

  els.list.querySelectorAll("button[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.getAttribute("data-nav"), 10);
      const p = points[i];
      idx = i;
      render();
      openGoogleMapsNav(p.lat, p.lon);
    });
  });
}

// --- Wake Lock ---
async function enableWakeLock(){
  try{
    if (!("wakeLock" in navigator)) {
      toast("Wake Lock desteklenmiyor.");
      return;
    }
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {});
    toast("Ekran kapanma engeli açık.");
  }catch(_){
    toast("Wake Lock açılamadı.");
  }
}
async function disableWakeLock(){
  try{
    if (wakeLock) await wakeLock.release();
    wakeLock = null;
    toast("Ekran kapanma engeli kapalı.");
  }catch(_){}
}
async function syncWakeLock(){
  if (!els.toggleWake) return;
  if (els.toggleWake.checked) await enableWakeLock();
  else await disableWakeLock();
}

// --- Events ---
els.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  try{
    const text = await f.text();
    const parsed = parseKml(text);
    if (!parsed.length) throw new Error("KML içinde okunabilir nokta (Placemark/Point) bulunamadı.");

    points = parsed;
    idx = 0;
    toast(`Yüklendi: ${points.length} nokta`);
    render();
  }catch(err){
    clearState();
    render();
    toast(err.message || "Hata");
  }finally{
    els.fileInput.value = "";
  }
});

els.btnClear.addEventListener("click", async () => {
  clearState();
  await disableWakeLock();
  render();
  toast("Temizlendi.");
});

els.btnPrev.addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
els.btnNext.addEventListener("click", () => { if (idx < points.length-1) { idx++; render(); } });

els.btnNav.addEventListener("click", () => {
  const p = points[idx];
  openGoogleMapsNav(p.lat, p.lon);
});

els.btnOpenMap.addEventListener("click", () => {
  const p = points[idx];
  openInMap(p.lat, p.lon);
});

els.btnResetIndex.addEventListener("click", () => { idx = 0; render(); toast("Başa alındı."); });

els.btnList.addEventListener("click", showList);
els.btnCloseList.addEventListener("click", hideList);
els.search.addEventListener("input", () => renderList(els.search.value));

els.btnNearest.addEventListener("click", goNearest);
els.btnArrived.addEventListener("click", arrivedNext);
els.btnMyLoc.addEventListener("click", openFromMyLocationToTarget);

els.toggleAutoNav.addEventListener("change", saveState);
els.toggleWake.addEventListener("change", async () => { saveState(); await syncWakeLock(); });

// Wake lock iOS’ta sayfa görünürlüğü değişince düşebilir, tekrar dene
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") await syncWakeLock();
});

// --- Service Worker ---
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// --- Init ---
loadState();
render();
syncWakeLock();
