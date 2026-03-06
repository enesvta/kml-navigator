window.onGoogleMapsLoaded = () => {
  window.__gmapsReady = true;
  setStatus("KML yükleyin");
  updateDateChip();
};

const els = {
  screenPick: document.getElementById("screenPick"),
  screenMain: document.getElementById("screenMain"),
  fileInput: document.getElementById("fileInput"),
  pickError: document.getElementById("pickError"),

  status: document.getElementById("status"),
  chipCount: document.getElementById("chipCount"),
  chipGps: document.getElementById("chipGps"),
  chipDate: document.getElementById("chipDate"),

  btnMe: document.getElementById("btnMe"),
  btnFit: document.getElementById("btnFit"),
  btnKml: document.getElementById("btnKml"),
  btnExport: document.getElementById("btnExport"),
  btnClear: document.getElementById("btnClear"),

  sheet: document.getElementById("sheet"),
  sheetHandle: document.getElementById("sheetHandle"),

  search: document.getElementById("search"),
  list: document.getElementById("list"),

  formOverlay: document.getElementById("formOverlay"),
  formTitle: document.getElementById("formTitle"),
  formPoint: document.getElementById("formPoint"),
  btnFormClose: document.getElementById("btnFormClose"),
  btnFormSave: document.getElementById("btnFormSave"),

  startFields: document.getElementById("startFields"),
  finishFields: document.getElementById("finishFields"),

  deviceName: document.getElementById("deviceName"),
  deviceHeight: document.getElementById("deviceHeight"),
  loadType: document.getElementById("loadType"),
  startTime: document.getElementById("startTime"),
  endTime: document.getElementById("endTime"),
  btnNowStart: document.getElementById("btnNowStart"),
  btnNowEnd: document.getElementById("btnNowEnd"),

  toast: document.getElementById("toast"),
};

let map = null;
let points = [];
let markers = [];
let markerByName = new Map();

let gpsMarker = null;
let lastPos = null;
let watchId = null;

let sheetExpanded = false;
let selectedPoint = null;
let formMode = null;

const STORAGE_PREFIX = "cm_saha_records_v2";

function toast(msg){
  els.toast.textContent = msg;
  els.toast.style.opacity = "1";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => els.toast.style.opacity = "0", 1400);
}

function setStatus(msg){
  els.status.textContent = msg;
}

function showError(msg){
  els.pickError.style.display = "block";
  els.pickError.textContent = msg;
}
function clearError(){
  els.pickError.style.display = "none";
  els.pickError.textContent = "";
}

function todayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function updateDateChip(){
  els.chipDate.textContent = todayKey();
}

function recordKey(pointName){
  return `${STORAGE_PREFIX}:${todayKey()}:${pointName}`;
}

function loadRecord(pointName){
  try{
    const raw = localStorage.getItem(recordKey(pointName));
    return raw ? JSON.parse(raw) : null;
  }catch(_){
    return null;
  }
}

function saveRecord(pointName, data){
  localStorage.setItem(recordKey(pointName), JSON.stringify(data));
}

function recordState(pointName){
  const r = loadRecord(pointName);
  if (!r) return "empty";
  if (r.startTime && r.endTime) return "done";
  if (r.startTime) return "started";
  return "empty";
}

function stateText(state, record){
  if (state === "done") return `Tamamlandı · Baş: ${record?.startTime || "-"} · Bit: ${record?.endTime || "-"}`;
  if (state === "started") return `Kuruldu · Baş: ${record?.startTime || "-"}`;
  return "Kayıt yok";
}

function nowHHMM(){
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function validateHHMM(v){
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test((v || "").trim());
}

function waitForGoogleMaps(timeoutMs = 12000){
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      const ok = window.__gmapsReady && typeof google !== "undefined" && google.maps;
      if (ok){
        clearInterval(t);
        resolve(true);
      } else if (Date.now() - start > timeoutMs){
        clearInterval(t);
        reject(new Error("Google Maps yüklenmedi. API key / internet / billing kontrol edin."));
      }
    }, 100);
  });
}

function initMap(){
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

function parseKml(text){
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("KML parse edilemedi.");

  const placemarks = [...xml.getElementsByTagName("Placemark")];
  const pts = [];
  let c = 0;

  for (const pm of placemarks){
    const name = (pm.getElementsByTagName("name")[0]?.textContent || `P${c+1}`).trim();

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

function markerSvgForState(state){
  let fill = "rgba(0,229,255,0.22)";
  let stroke = "rgba(0,229,255,0.35)";

  if (state === "started"){
    fill = "rgba(34,255,136,0.22)";
    stroke = "rgba(34,255,136,0.45)";
  } else if (state === "done"){
    fill = "rgba(0,229,255,0.24)";
    stroke = "rgba(0,229,255,0.55)";
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="58" viewBox="0 0 92 58">
  <defs>
    <filter id="s" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>

  <g filter="url(#s)">
    <rect x="10" y="8" rx="999" ry="999" width="72" height="24"
      fill="${fill}"
      stroke="${stroke}"
      stroke-width="1"/>
  </g>

  <line x1="46" y1="36" x2="46" y2="56" stroke="rgba(234,240,255,0.95)" stroke-width="2" stroke-linecap="round"/>
  <line x1="36" y1="48" x2="56" y2="48" stroke="rgba(234,240,255,0.95)" stroke-width="2" stroke-linecap="round"/>

  <circle cx="46" cy="48" r="4" fill="rgba(0,0,0,0.30)"/>
  <circle cx="46" cy="48" r="3" fill="rgba(234,240,255,0.98)"/>
</svg>`;
}

function makeMarkerIcon(state){
  const svg = markerSvgForState(state);
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(92, 58),
    anchor: new google.maps.Point(46, 48),
    labelOrigin: new google.maps.Point(46, 25),
  };
}

function refreshMarkerState(pointName){
  const m = markerByName.get(pointName);
  if (!m) return;
  const state = recordState(pointName);
  m.setIcon(makeMarkerIcon(state));
}

function clearMarkers(){
  markers.forEach(m => m.setMap(null));
  markers = [];
  markerByName.clear();
}

function setKmlMarkers(){
  initMap();
  clearMarkers();

  const labelStyle = {
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    fontSize: "11px",
    fontWeight: "900",
    color: "#EAF0FF",
  };

  points.forEach((p, i) => {
    const state = recordState(p.name);
    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lon },
      map,
      icon: makeMarkerIcon(state),
      label: { text: p.name, ...labelStyle },
      title: p.name,
      zIndex: 1000 + i,
    });

    m.addListener("click", () => openNav(p.lat, p.lon));
    markers.push(m);
    markerByName.set(p.name, m);
  });

  fitToKml(true);
}

function fitToKml(force = false){
  if (!map || !points.length) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach(p => bounds.extend({ lat: p.lat, lng: p.lon }));
  map.fitBounds(bounds, 60);

  if (force){
    google.maps.event.addListenerOnce(map, "idle", () => {
      map.fitBounds(bounds, 60);
    });
  }
}

function ensureGps(){
  if (!navigator.geolocation){
    els.chipGps.textContent = "GPS off";
    return;
  }
  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      lastPos = { lat, lon };
      els.chipGps.textContent = `±${Math.round(acc)}m`;

      if (!map) return;

      const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
  <defs>
    <filter id="s" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>
  <g filter="url(#s)">
    <circle cx="17" cy="17" r="12" fill="rgba(34,255,136,0.10)" stroke="rgba(34,255,136,0.90)" stroke-width="2"/>
  </g>
  <circle cx="17" cy="17" r="4.2" fill="rgba(34,255,136,0.95)" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>
  <path d="M17 6 L20 12 L17 11 L14 12 Z" fill="rgba(34,255,136,0.95)"/>
</svg>`;

      const icon = {
        url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
        scaledSize: new google.maps.Size(34, 34),
        anchor: new google.maps.Point(17, 17),
      };

      if (!gpsMarker){
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
    () => {
      els.chipGps.textContent = "GPS izin yok";
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function panToMe(){
  if (!map || !lastPos) return;
  map.setZoom(Math.max(map.getZoom(), 17));
  map.panTo({ lat: lastPos.lat, lng: lastPos.lon });
}

function openNav(lat, lon){
  const schemeUrl = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;
  const httpsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  const t = Date.now();
  window.location.href = schemeUrl;
  setTimeout(() => {
    if (Date.now() - t > 300) window.location.href = httpsUrl;
  }, 450);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[m]);
}

function openForm(mode, point){
  selectedPoint = point;
  formMode = mode;

  const rec = loadRecord(point.name) || {
    point: point.name,
    date: todayKey(),
    deviceName: "",
    deviceHeight: "",
    loadType: "Jalon",
    startTime: "",
    endTime: "",
    updatedAt: Date.now(),
  };

  els.formPoint.textContent = `${point.name} · ${todayKey()}`;

  if (mode === "start"){
    els.formTitle.textContent = "Kurulum Kaydı";
    els.startFields.style.display = "block";
    els.finishFields.style.display = "none";

    els.deviceName.value = rec.deviceName || "";
    els.deviceHeight.value = rec.deviceHeight || "";
    els.loadType.value = rec.loadType || "Jalon";
    els.startTime.value = rec.startTime || "";
  } else {
    els.formTitle.textContent = "Toplama Kaydı";
    els.startFields.style.display = "none";
    els.finishFields.style.display = "block";
    els.endTime.value = rec.endTime || "";
  }

  els.formOverlay.style.display = "flex";
}

function closeForm(){
  els.formOverlay.style.display = "none";
}

function saveForm(){
  if (!selectedPoint) return;

  const existing = loadRecord(selectedPoint.name) || {
    point: selectedPoint.name,
    date: todayKey(),
    deviceName: "",
    deviceHeight: "",
    loadType: "Jalon",
    startTime: "",
    endTime: "",
    updatedAt: Date.now(),
  };

  if (formMode === "start"){
    const dn = (els.deviceName.value || "").trim();
    const dh = (els.deviceHeight.value || "").trim();
    const lt = els.loadType.value || "Jalon";
    const st = (els.startTime.value || "").trim();

    if (!dn) return toast("Cihaz adı gerekli");
    if (!dh) return toast("Yükseklik gerekli");
    if (!validateHHMM(st)) return toast("Başlangıç saati HH:MM");

    existing.deviceName = dn;
    existing.deviceHeight = dh;
    existing.loadType = lt;
    existing.startTime = st;
    existing.updatedAt = Date.now();
  } else {
    const et = (els.endTime.value || "").trim();
    if (!validateHHMM(et)) return toast("Bitiş saati HH:MM");

    existing.endTime = et;
    existing.updatedAt = Date.now();
  }

  saveRecord(selectedPoint.name, existing);
  refreshMarkerState(selectedPoint.name);
  renderList();
  closeForm();
  toast("Kaydedildi");
}

function renderList(){
  const q = (els.search.value || "").trim().toLowerCase();
  els.list.innerHTML = "";

  const filtered = points
    .map((p, i) => ({ ...p, i }))
    .filter(x => !q || x.name.toLowerCase().includes(q));

  filtered.forEach((p) => {
    const rec = loadRecord(p.name);
    const st = recordState(p.name);

    const div = document.createElement("div");
    div.className = `item main-${st}`;

    div.innerHTML = `
<div class="itemInfo">
  <div class="itemTitle">${escapeHtml(p.name)}</div>
  <div class="itemSub">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
  <div class="itemState">
    <span class="stateDot ${st === "started" ? "started" : st === "done" ? "done" : ""}"></span>
    ${escapeHtml(stateText(st, rec))}
  </div>
</div>
<div class="itemActions">
  <div class="rowBtns">
    <button class="smallBtn nav" data-nav="${p.i}">Nav</button>
    <button class="smallBtn start" data-start="${p.i}" ${st === "done" ? "disabled" : ""}>Kurulum</button>
  </div>
  <div class="rowBtns">
    <button class="smallBtn finish" data-finish="${p.i}" ${!rec?.startTime ? "disabled" : ""}>Toplama</button>
  </div>
</div>
`;

    els.list.appendChild(div);
  });

  els.list.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(btn.getAttribute("data-nav"));
      const p = points[i];
      if (map){
        map.setZoom(Math.max(map.getZoom(), 17));
        map.panTo({ lat: p.lat, lng: p.lon });
      }
      openNav(p.lat, p.lon);
    });
  });

  els.list.querySelectorAll("[data-start]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(btn.getAttribute("data-start"));
      openForm("start", points[i]);
    });
  });

  els.list.querySelectorAll("[data-finish]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(btn.getAttribute("data-finish"));
      openForm("finish", points[i]);
    });
  });
}

function exportCSV(){
  const date = todayKey();
  const rows = [];
  rows.push(["Tarih","Nokta","CihazAdı","CihazYüksekliği","YükTipi","Başlangıç","Bitiş"].join(","));

  for (const p of points){
    const r = loadRecord(p.name);
    if (!r) continue;
    rows.push([
      date,
      r.point || p.name,
      (r.deviceName || "").replaceAll(","," "),
      (r.deviceHeight || "").replaceAll(","," "),
      (r.loadType || "").replaceAll(","," "),
      r.startTime || "",
      r.endTime || ""
    ].join(","));
  }

  if (rows.length === 1) return toast("Kayıt yok");

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `CENTRAL_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast("CSV indirildi");
}

function setSheetState(expanded){
  sheetExpanded = expanded;
  if (expanded) els.sheet.classList.add("expanded");
  else els.sheet.classList.remove("expanded");
}

function toggleSheet(){
  setSheetState(!sheetExpanded);
}

function enableSheetDrag(){
  let startY = 0;
  let dragging = false;

  const onStart = (y) => {
    dragging = true;
    startY = y;
  };
  const onMove = (y) => {
    if (!dragging) return;
    const dy = y - startY;
    if (dy < -35) setSheetState(true);
    if (dy > 35) setSheetState(false);
  };
  const onEnd = () => {
    dragging = false;
  };

  els.sheetHandle.addEventListener("click", toggleSheet);

  els.sheetHandle.addEventListener("touchstart", e => onStart(e.touches[0].clientY), { passive: true });
  els.sheetHandle.addEventListener("touchmove", e => onMove(e.touches[0].clientY), { passive: true });
  els.sheetHandle.addEventListener("touchend", onEnd, { passive: true });

  els.sheet.addEventListener("touchstart", e => {
    if (e.touches[0].clientY < 160) onStart(e.touches[0].clientY);
  }, { passive: true });
  els.sheet.addEventListener("touchmove", e => onMove(e.touches[0].clientY), { passive: true });
  els.sheet.addEventListener("touchend", onEnd, { passive: true });
}

async function handleKmlFile(file){
  clearError();
  setStatus("Yükleniyor…");
  updateDateChip();
  await waitForGoogleMaps();

  const text = await file.text();
  points = parseKml(text);
  if (!points.length) throw new Error("KML içinde nokta bulunamadı.");

  initMap();
  setKmlMarkers();
  ensureGps();
  renderList();

  els.chipCount.textContent = String(points.length);
  setStatus(`Hazır: ${points.length} nokta`);

  els.screenPick.style.display = "none";
  els.screenMain.style.display = "flex";
  toast("Yüklendi");
}

els.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try{
    await handleKmlFile(f);
  }catch(err){
    console.error(err);
    showError(err.message || "Hata");
  }finally{
    els.fileInput.value = "";
  }
});

els.btnKml.addEventListener("click", () => els.fileInput.click());
els.btnMe.addEventListener("click", panToMe);
els.btnFit.addEventListener("click", () => fitToKml(true));
els.btnExport.addEventListener("click", exportCSV);

els.btnClear.addEventListener("click", () => {
  clearMarkers();
  if (gpsMarker) gpsMarker.setMap(null), gpsMarker = null;
  if (watchId != null) navigator.geolocation.clearWatch(watchId), watchId = null;

  points = [];
  els.list.innerHTML = "";
  els.search.value = "";
  els.chipCount.textContent = "0";
  els.chipGps.textContent = "GPS";
  setStatus("KML yükleyin");

  els.screenMain.style.display = "none";
  els.screenPick.style.display = "flex";
});

els.search.addEventListener("input", renderList);

els.btnFormClose.addEventListener("click", closeForm);
els.formOverlay.addEventListener("click", (e) => {
  if (e.target === els.formOverlay) closeForm();
});

els.btnNowStart.addEventListener("click", () => {
  els.startTime.value = nowHHMM();
});
els.btnNowEnd.addEventListener("click", () => {
  els.endTime.value = nowHHMM();
});
els.btnFormSave.addEventListener("click", saveForm);

enableSheetDrag();
setSheetState(false);
setStatus("KML yükleyin");
updateDateChip();

if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
