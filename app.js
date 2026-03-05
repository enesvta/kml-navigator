window.onGoogleMapsLoaded = () => {
  window.__gmapsReady = true;
  setStatus("KML yükleyin");
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

  btnMe: document.getElementById("btnMe"),
  btnFit: document.getElementById("btnFit"),
  btnKml: document.getElementById("btnKml"),
  btnClear: document.getElementById("btnClear"),

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

let sheetExpanded = false;

function toast(msg){
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.style.opacity = "1";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => els.toast.style.opacity = "0", 1400);
}

function setStatus(msg){
  if (els.status) els.status.textContent = msg;
}

function showError(msg){
  if (!els.pickError) return alert(msg);
  els.pickError.style.display = "block";
  els.pickError.textContent = msg;
}
function clearError(){
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

function initMap(){
  if (map) return;
  map = new google.maps.Map(document.getElementById("map"),{
    center:{lat:39,lng:35},
    zoom:6,
    mapTypeId:"satellite",
    fullscreenControl:false,
    streetViewControl:false,
    mapTypeControl:false,
    clickableIcons:false
  });
}

/* KML parse */
function parseKml(text){
  const xml = new DOMParser().parseFromString(text,"application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("KML parse edilemedi.");

  const placemarks=[...xml.getElementsByTagName("Placemark")];
  const pts=[];
  let c=0;

  for(const pm of placemarks){
    const name=(pm.getElementsByTagName("name")[0]?.textContent || `P${c+1}`).trim();

    const pointEl=pm.getElementsByTagName("Point")[0];
    let coordEl=null;
    if (pointEl) coordEl=pointEl.getElementsByTagName("coordinates")[0];
    if (!coordEl) coordEl=pm.getElementsByTagName("coordinates")[0];
    if (!coordEl) continue;

    const raw=(coordEl.textContent||"").trim();
    if (!raw) continue;

    const first=raw.replace(/\n/g," ").split(/\s+/).filter(Boolean)[0];
    if (!first) continue;

    const parts=first.split(",");
    if (parts.length<2) continue;

    const lon=Number(parts[0]);
    const lat=Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    pts.push({name,lat,lon});
    c++;
  }
  return pts;
}

function clearMarkers(){
  markers.forEach(m=>m.setMap(null));
  markers=[];
}

/* Neon minimalist KML marker: pill + crosshair exact point */
function setKmlMarkers(){
  initMap();
  clearMarkers();

  const labelStyle = {
    fontFamily:"ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    fontSize:"11px",
    fontWeight:"900",
    color:"#EAF0FF"
  };

  points.forEach((p,i)=>{
    const labelText=(p.name || `${i+1}`).trim();

    const svg=`
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="58" viewBox="0 0 92 58">
  <defs>
    <filter id="s" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>

  <g filter="url(#s)">
    <rect x="10" y="8" rx="999" ry="999" width="72" height="24"
      fill="rgba(0,229,255,0.22)"
      stroke="rgba(0,229,255,0.35)"
      stroke-width="1"/>
  </g>

  <line x1="46" y1="36" x2="46" y2="56" stroke="rgba(234,240,255,0.95)" stroke-width="2" stroke-linecap="round"/>
  <line x1="36" y1="48" x2="56" y2="48" stroke="rgba(234,240,255,0.95)" stroke-width="2" stroke-linecap="round"/>

  <circle cx="46" cy="48" r="4" fill="rgba(0,0,0,0.30)"/>
  <circle cx="46" cy="48" r="3" fill="rgba(234,240,255,0.98)"/>
</svg>`;

    const icon={
      url:"data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(svg),
      scaledSize:new google.maps.Size(92,58),
      anchor:new google.maps.Point(46,48),
      labelOrigin:new google.maps.Point(46,25)
    };

    const m=new google.maps.Marker({
      position:{lat:p.lat,lng:p.lon},
      map,
      icon,
      label:{text:labelText,...labelStyle},
      title: labelText,
      zIndex: 1000+i
    });

    m.addListener("click",()=>openNav(p.lat,p.lon));
    markers.push(m);
  });

  fitToKml(true);
}

/* Auto zoom to KML */
function fitToKml(force=false){
  if (!map || !points.length) return;
  const bounds=new google.maps.LatLngBounds();
  points.forEach(p=>bounds.extend({lat:p.lat,lng:p.lon}));
  map.fitBounds(bounds,60);

  if (force){
    google.maps.event.addListenerOnce(map,"idle",()=>{
      map.fitBounds(bounds,60);
    });
  }
}

/* GPS marker (distinct neon ring + pointer), NO accuracy circle */
function ensureGps(){
  if (!navigator.geolocation){
    els.chipGps.textContent="GPS off";
    return;
  }
  if (watchId!=null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos)=>{
      const lat=pos.coords.latitude;
      const lon=pos.coords.longitude;
      const acc=pos.coords.accuracy;
      lastPos={lat,lon};
      els.chipGps.textContent = `±${Math.round(acc)}m`;

      if (!map) return;

      const svg=`
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

      const icon={
        url:"data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(svg),
        scaledSize:new google.maps.Size(34,34),
        anchor:new google.maps.Point(17,17)
      };

      if (!gpsMarker){
        gpsMarker=new google.maps.Marker({
          position:{lat,lng:lon},
          map,
          icon,
          title:"Konumum",
          zIndex: 999999
        });
      } else {
        gpsMarker.setPosition({lat,lng:lon});
      }
    },
    ()=>{
      els.chipGps.textContent="GPS izin yok";
    },
    { enableHighAccuracy:true, maximumAge:3000, timeout:12000 }
  );
}

function panToMe(){
  if (!map || !lastPos) return;
  map.setZoom(Math.max(map.getZoom(),17));
  map.panTo({lat:lastPos.lat,lng:lastPos.lon});
}

/* Navigation */
function openNav(lat,lon){
  const schemeUrl=`comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`;
  const httpsUrl=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  const t=Date.now();
  window.location.href=schemeUrl;
  setTimeout(()=>{
    if (Date.now()-t>300) window.location.href=httpsUrl;
  },450);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* List render with subtle stagger animation */
function renderList(){
  const q=(els.search.value||"").trim().toLowerCase();
  els.list.innerHTML="";

  const filtered = points
    .map((p,i)=>({...p,i}))
    .filter(x=>!q || x.name.toLowerCase().includes(q));

  filtered.forEach((p,idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.style.opacity="0";
    div.style.transform="translateY(6px)";
    div.style.transition=`opacity 220ms var(--ease) ${idx*10}ms, transform 220ms var(--ease) ${idx*10}ms`;

    div.innerHTML=`
<div>
  <div class="itemTitle">${escapeHtml(p.name)}</div>
  <div class="itemSub">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
</div>
<div class="badge">${p.i+1}</div>
`;

    div.onclick=()=>{
      if (map){
        map.setZoom(Math.max(map.getZoom(),17));
        map.panTo({lat:p.lat,lng:p.lon});
      }
      openNav(p.lat,p.lon);
    };

    els.list.appendChild(div);

    requestAnimationFrame(()=>{
      div.style.opacity="1";
      div.style.transform="translateY(0)";
    });
  });
}

/* Sheet toggle + drag (can shrink back) */
function setSheetState(expanded){
  sheetExpanded = expanded;
  if (expanded) els.sheet.classList.add("expanded");
  else els.sheet.classList.remove("expanded");
}

function toggleSheet(){
  setSheetState(!sheetExpanded);
}

function enableSheetDrag(){
  let startY=0;
  let dragging=false;

  const onStart=(y)=>{ dragging=true; startY=y; };
  const onMove=(y)=>{
    if (!dragging) return;
    const dy=y-startY;
    if (dy<-35) setSheetState(true);
    if (dy>35) setSheetState(false);
  };
  const onEnd=()=>{ dragging=false; };

  els.sheetHandle.addEventListener("click", toggleSheet);

  els.sheetHandle.addEventListener("touchstart", e=>onStart(e.touches[0].clientY), {passive:true});
  els.sheetHandle.addEventListener("touchmove", e=>onMove(e.touches[0].clientY), {passive:true});
  els.sheetHandle.addEventListener("touchend", onEnd, {passive:true});

  els.sheet.addEventListener("touchstart", e=>{
    if (e.touches[0].clientY < 160) onStart(e.touches[0].clientY);
  }, {passive:true});
  els.sheet.addEventListener("touchmove", e=>onMove(e.touches[0].clientY), {passive:true});
  els.sheet.addEventListener("touchend", onEnd, {passive:true});
}

/* Main flow */
async function handleKmlFile(file){
  clearError();
  setStatus("Yükleniyor…");
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

  els.screenPick.style.display="none";
  els.screenMain.style.display="flex";
  toast("Yüklendi");
}

/* Events */
els.fileInput.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0];
  if (!f) return;
  try{
    await handleKmlFile(f);
  }catch(err){
    console.error(err);
    showError(err.message || "Hata");
  }finally{
    els.fileInput.value="";
  }
});

els.btnKml.addEventListener("click", ()=>els.fileInput.click());
els.btnMe.addEventListener("click", ()=>panToMe());
els.btnFit.addEventListener("click", ()=>fitToKml(true));
els.btnClear.addEventListener("click", ()=>{
  clearMarkers();
  if (gpsMarker) gpsMarker.setMap(null), gpsMarker=null;
  if (watchId!=null) navigator.geolocation.clearWatch(watchId), watchId=null;
  points=[];
  els.list.innerHTML="";
  els.search.value="";
  els.chipCount.textContent="0";
  els.chipGps.textContent="GPS";
  setStatus("KML yükleyin");
  els.screenMain.style.display="none";
  els.screenPick.style.display="flex";
});
els.search.addEventListener("input", renderList);

/* Init */
enableSheetDrag();
setSheetState(false);
setStatus("KML yükleyin");

/* Service worker */
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
