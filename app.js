const els = {
  status: document.getElementById("status"),
  fileInput: document.getElementById("fileInput"),
  btnClear: document.getElementById("btnClear"),

  controlsCard: document.getElementById("controlsCard"),
  listCard: document.getElementById("listCard"),
  list: document.getElementById("list"),
  search: document.getElementById("search"),

  countPill: document.getElementById("countPill"),

  btnNearest: document.getElementById("btnNearest"),
  btnMyLoc: document.getElementById("btnMyLoc"),
  btnListTop: document.getElementById("btnListTop"),

  toggleAutoNav: document.getElementById("toggleAutoNav"),

  selectedName: document.getElementById("selectedName"),
  selectedCoords: document.getElementById("selectedCoords"),
  btnArrived: document.getElementById("btnArrived"),
  btnNavSelected: document.getElementById("btnNavSelected"),

  toast: document.getElementById("toast"),
};

let points = [];
let idx = 0;

// ---------- UI ----------
function setStatus(text){ els.status.textContent = text; }
function fmt(n){ return Number(n).toFixed(7); }

let toastTimer = null;
function toast(msg){
  els.toast.textContent = msg;
  els.toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.style.opacity = "0"), 1700);
}

function showUI(has){
  els.btnClear.disabled = !has;
  els.controlsCard.style.display = has ? "block" : "none";
  els.listCard.style.display = has ? "block" : "none";
}

// ---------- Storage ----------
function saveState(){
  localStorage.setItem("kmlnav_points", JSON.stringify(points));
  localStorage.setItem("kmlnav_idx", String(idx));
  localStorage.setItem("kmlnav_autonav", els.toggleAutoNav.checked ? "1" : "0");
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

  els.toggleAutoNav.checked = (localStorage.getItem("kmlnav_autonav") === "1");
}

function clearState(){
  points = [];
  idx = 0;
  localStorage.removeItem("kmlnav_points");
  localStorage.removeItem("kmlnav_idx");
}

// ---------- KML parse ----------
function normalizeName(name, fallback){
  const t = (name || "").trim();
  return t ? t : fallback;
}

function parseKml(kmlText){
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("KML parse edilemedi.");

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

// ---------- Maps ----------
function navUrl(lat, lon){
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}
function fromToUrl(fromLat, fromLon, toLat, toLon){
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${toLat},${toLon}&travelmode=driving`;
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

// ---------- Geo / nearest ----------
function getCurrentPosition(){
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Konum desteklenmiyor."));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000
    });
  });
}

function distMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2)**2;
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

    let bestI = 0, bestD = Infinity;
    for (let i=0; i<points.length; i++){
      const p = points[i];
      const d = distMeters(myLat, myLon, p.lat, p.lon);
      if (d < bestD){ bestD = d; bestI = i; }
    }
    idx = bestI;
    renderSelected();
    scrollToIndex(idx);
    toast(`En yakın: ~${Math.round(bestD)} m`);
  }catch(err){
    toast(err.message || "Konum alınamadı.");
  }
}

async function openFromMyLoc(){
  if (!points.length) return;
  const p = points[idx];
  try{
    toast("Konum alınıyor…");
    const pos = await getCurrentPosition();
    const myLat = pos.coords.latitude;
    const myLon = pos.coords.longitude;
    window.location.href = fromToUrl(myLat, myLon, p.lat, p.lon);
  }catch(err){
    toast(err.message || "Konum alınamadı.");
  }
}

// ---------- Render ----------
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function renderSelected(){
  if (!points.length){
    els.selectedName.textContent = "-";
    els.selectedCoords.textContent = "-";
    return;
  }
  idx = Math.min(Math.max(idx,0), points.length-1);
  const p = points[idx];
  els.selectedName.textContent = p.name;
  els.selectedCoords.textContent = `${fmt(p.lat)}, ${fmt(p.lon)} · #${idx+1}/${points.length}`;
  saveState();
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
    div.dataset.index = String(p.i);
    div.innerHTML = `
      <div>
        <div class="itemTitle">${escapeHtml(p.name)}</div>
        <div class="itemSub mono">${fmt(p.lat)}, ${fmt(p.lon)} · #${p.i+1}</div>
      </div>
      <div class="itemBtns">
        <button class="btn small primary" data-nav="${p.i}">Nav</button>
      </div>
    `;
    els.list.appendChild(div);
  }

  // Kart tıkla: seç + navigasyon
  els.list.querySelectorAll(".item").forEach(card => {
    card.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (btn) return;

      const i = parseInt(card.dataset.index, 10);
      idx = i;
      renderSelected();
      openNav(points[idx].lat, points[idx].lon);
    });
  });

  // Nav butonu
  els.list.querySelectorAll("button[data-nav]").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const i = parseInt(btn.getAttribute("data-nav"), 10);
      idx = i;
      renderSelected();
      openNav(points[idx].lat, points[idx].lon);
    });
  });
}

function scrollToIndex(i){
  const el = els.list.querySelector(`.item[data-index="${i}"]`);
  if (el) el.scrollIntoView({behavior:"smooth", block:"center"});
}

function renderAll(){
  const has = points.length > 0;
  showUI(has);

  if (!has){
    setStatus("KML yükleyin");
    return;
  }

  setStatus(`Hazır: ${points.length} nokta`);
  els.countPill.textContent = `${points.length} nokta`;
  renderSelected();
  renderList(els.search.value || "");
  saveState();
}

// ---------- Actions ----------
function arrivedNext(){
  if (!points.length) return;
  if (idx < points.length - 1){
    idx++;
    renderSelected();
    scrollToIndex(idx);
    toast("Sonraki nokta seçildi.");
    if (els.toggleAutoNav.checked){
      const p = points[idx];
      openNav(p.lat, p.lon);
    }
  } else {
    toast("Son noktadasınız.");
  }
}

// ---------- Events ----------
els.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  try{
    const text = await f.text();
    const parsed = parseKml(text);
    if (!parsed.length) throw new Error("KML içinde nokta bulunamadı.");

    points = parsed;
    idx = 0;
    toast(`Yüklendi: ${points.length} nokta`);
    renderAll();
  }catch(err){
    clearState();
    renderAll();
    toast(err.message || "Hata");
  }finally{
    els.fileInput.value = "";
  }
});

els.btnClear.addEventListener("click", () => {
  clearState();
  renderAll();
  toast("Temizlendi.");
});

els.search.addEventListener("input", () => renderList(els.search.value));

els.btnNearest.addEventListener("click", goNearest);
els.btnMyLoc.addEventListener("click", openFromMyLoc);

els.btnListTop.addEventListener("click", () => {
  els.list.scrollTo({top: 0, behavior: "smooth"});
});

els.btnArrived.addEventListener("click", arrivedNext);

els.btnNavSelected.addEventListener("click", () => {
  if (!points.length) return;
  const p = points[idx];
  openNav(p.lat, p.lon);
});

els.toggleAutoNav.addEventListener("change", saveState);

// ---------- Service Worker ----------
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ---------- Init ----------
loadState();
renderAll();
