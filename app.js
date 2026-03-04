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
  btnOpenMap: document.getElementById("btnOpenMap"),
  btnResetIndex: document.getElementById("btnResetIndex"),

  btnList: document.getElementById("btnList"),
  listCard: document.getElementById("listCard"),
  btnCloseList: document.getElementById("btnCloseList"),
  list: document.getElementById("list"),
  search: document.getElementById("search"),
};

let points = [];
let idx = 0;

// --- Helpers ---
function setStatus(text){ els.status.textContent = text; }
function fmt(n){ return Number(n).toFixed(7); }

function saveState(){
  localStorage.setItem("kmlnav_points", JSON.stringify(points));
  localStorage.setItem("kmlnav_idx", String(idx));
}
function loadState(){
  try{
    const p = JSON.parse(localStorage.getItem("kmlnav_points") || "[]");
    const i = parseInt(localStorage.getItem("kmlnav_idx") || "0", 10);
    if (Array.isArray(p) && p.length){
      points = p;
      idx = Number.isFinite(i) ? Math.min(Math.max(i,0), points.length-1) : 0;
      return true;
    }
  }catch(_){}
  return false;
}

function clearState(){
  points = [];
  idx = 0;
  localStorage.removeItem("kmlnav_points");
  localStorage.removeItem("kmlnav_idx");
}

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

    // Sadece Point olanları almaya çalış (LineString/Polygon koordinatları çoklu olabilir)
    const pointEl = pm.getElementsByTagName("Point")[0];
    let coordEl = null;

    if (pointEl){
      coordEl = pointEl.getElementsByTagName("coordinates")[0];
    } else {
      // Bazı dosyalarda Point yok ama tek koordinat var; yine de ilk coordinates'i dene
      coordEl = pm.getElementsByTagName("coordinates")[0];
    }

    if (!coordEl) continue;

    const raw = (coordEl.textContent || "").trim();
    if (!raw) continue;

    // "lon,lat,alt lon,lat,alt" -> ilkini al
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

  // Eğer isimlerde N-1, N-2 gibi sıralı bir yapı varsa doğal sırayı korur.
  return out;
}

function render(){
  const has = points.length > 0;
  els.btnClear.disabled = !has;
  els.navCard.style.display = has ? "block" : "none";
  els.listCard.style.display = "none";

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

function openGoogleMapsNav(lat, lon){
  // En güvenlisi: HTTPS link (iOS/Android çalışır, CarPlay’de Maps açıksa devam eder)
  const httpsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;

  // iOS Google Maps yüklüyse comgooglemaps:// daha hızlı açılır; yoksa https'e düşer.
  const schemeUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;

  // Deneme: önce scheme, kısa süre sonra https fallback
  // (Bazı tarayıcılarda scheme bloklanabilir; fallback garanti)
  const t = Date.now();
  window.location.href = schemeUrl;

  setTimeout(() => {
    // Eğer hala aynı sayfadaysak https aç
    if (Date.now() - t > 300) window.location.href = httpsUrl;
  }, 400);
}

function openInMap(lat, lon){
  // Haritada göster (navigasyon değil)
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  window.location.href = url;
}

// --- List UI ---
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
        <div class="itemSub">${fmt(p.lat)}, ${fmt(p.lon)} · #${p.i+1}</div>
      </div>
      <div class="itemBtn">
        <button class="btn" data-go="${p.i}">Git</button>
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
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// --- Events ---
els.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  try{
    const text = await f.text();
    const parsed = parseKml(text);
    if (!parsed.length) throw new Error("KML içinde okunabilir nokta bulunamadı (Placemark/Point).");

    points = parsed;
    idx = 0;
    setStatus(`Yüklendi: ${points.length} nokta`);
    render();
  }catch(err){
    clearState();
    render();
    setStatus(`Hata: ${err.message || err}`);
  }finally{
    // Aynı dosyayı tekrar seçebilmek için input’u sıfırla
    els.fileInput.value = "";
  }
});

els.btnClear.addEventListener("click", () => { clearState(); render(); });

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

els.btnResetIndex.addEventListener("click", () => { idx = 0; render(); });

els.btnList.addEventListener("click", showList);
els.btnCloseList.addEventListener("click", hideList);
els.search.addEventListener("input", () => renderList(els.search.value));

// --- Init ---
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

if (loadState()){
  render();
} else {
  render();
}