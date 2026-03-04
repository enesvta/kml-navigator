window.onGoogleMapsLoaded = () => {
  window.__gmapsReady = true;
  tryInitFromStorage();
};

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
  list: document.getElementById("list")
};

let map = null;
let points = [];
let markers = [];

let gpsMarker = null;
let lastPos = null;
let watchId = null;


function initMap(){

  if(map) return;

  map = new google.maps.Map(document.getElementById("map"),{
    center:{lat:39,lng:35},
    zoom:6,
    mapTypeId:"satellite",
    fullscreenControl:false,
    streetViewControl:false,
    mapTypeControl:false
  });

}

function parseKml(text){

  const xml = new DOMParser().parseFromString(text,"text/xml");
  const placemarks=[...xml.getElementsByTagName("Placemark")];

  const pts=[];

  placemarks.forEach((pm,i)=>{

    const name=pm.getElementsByTagName("name")[0]?.textContent || `P${i+1}`;
    const coord=pm.getElementsByTagName("coordinates")[0]?.textContent.trim();

    if(!coord) return;

    const parts=coord.split(",");
    pts.push({
      name:name,
      lat:parseFloat(parts[1]),
      lon:parseFloat(parts[0])
    });

  });

  return pts;

}

function clearMarkers(){

  markers.forEach(m=>m.setMap(null));
  markers=[];

}

function setKmlMarkers(){

  initMap();
  clearMarkers();

  const labelStyle={
    fontFamily:"system-ui",
    fontSize:"11px",
    fontWeight:"900",
    color:"#fff"
  };

  points.forEach((p,i)=>{

    const svg=`
<svg xmlns="http://www.w3.org/2000/svg" width="92" height="58" viewBox="0 0 92 58">

<defs>
<filter id="s" x="-40%" y="-40%" width="180%" height="180%">
<feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="rgba(0,0,0,0.35)"/>
</filter>
</defs>

<g filter="url(#s)">
<rect x="10" y="8" rx="999" ry="999" width="72" height="24"
fill="rgba(20,184,166,0.40)"
stroke="rgba(255,255,255,0.35)"
stroke-width="1"/>
</g>

<line x1="46" y1="36" x2="46" y2="56" stroke="white" stroke-width="2"/>
<line x1="36" y1="48" x2="56" y2="48" stroke="white" stroke-width="2"/>

<circle cx="46" cy="48" r="4" fill="black" opacity="0.3"/>
<circle cx="46" cy="48" r="3" fill="white"/>

</svg>
`;

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
      label:{text:p.name,...labelStyle}
    });

    m.addListener("click",()=>{
      openNav(p.lat,p.lon);
    });

    markers.push(m);

  });

  fitToKml();

}

function fitToKml(){

  if(!points.length) return;

  const bounds=new google.maps.LatLngBounds();

  points.forEach(p=>{
    bounds.extend({lat:p.lat,lng:p.lon});
  });

  map.fitBounds(bounds,60);

}

function ensureGps(){

  if(!navigator.geolocation) return;

  if(watchId) return;

  watchId=navigator.geolocation.watchPosition(pos=>{

    const lat=pos.coords.latitude;
    const lon=pos.coords.longitude;

    lastPos={lat,lon};

    if(!map) return;

    const svg=`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">

<line x1="12" y1="0" x2="12" y2="24" stroke="white" stroke-width="2"/>
<line x1="0" y1="12" x2="24" y2="12" stroke="white" stroke-width="2"/>

<circle cx="12" cy="12" r="4" fill="white"/>

</svg>
`;

    const icon={
      url:"data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(svg),
      scaledSize:new google.maps.Size(24,24),
      anchor:new google.maps.Point(12,12)
    };

    if(!gpsMarker){

      gpsMarker=new google.maps.Marker({
        position:{lat,lng:lon},
        map,
        icon
      });

    }else{

      gpsMarker.setPosition({lat,lng:lon});

    }

  },{
    enableHighAccuracy:true
  });

}

function openNav(lat,lon){

  const url=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

  window.location.href=url;

}

function renderList(){

  els.list.innerHTML="";

  points.forEach((p,i)=>{

    const div=document.createElement("div");

    div.className="item";

    div.innerHTML=`
<div>
<div class="itemTitle">${p.name}</div>
<div class="itemSub">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
</div>
<div class="badge">${i+1}</div>
`;

    div.onclick=()=>{
      map.setZoom(17);
      map.panTo({lat:p.lat,lng:p.lon});
      openNav(p.lat,p.lon);
    };

    els.list.appendChild(div);

  });

}

async function handleKmlFile(file){

  const text=await file.text();

  points=parseKml(text);

  initMap();

  setKmlMarkers();

  ensureGps();

  renderList();

  els.chipCount.textContent=points.length+" nokta";

  els.screenPick.style.display="none";
  els.screenMain.style.display="flex";

}

els.fileInput.addEventListener("change",async e=>{

  const f=e.target.files[0];

  if(!f) return;

  await handleKmlFile(f);

});

els.btnFit.onclick=fitToKml;

els.btnMe.onclick=()=>{

  if(!lastPos) return;

  map.setZoom(17);
  map.panTo({lat:lastPos.lat,lng:lastPos.lon});

};

els.btnClear.onclick=()=>{

  clearMarkers();

  if(gpsMarker) gpsMarker.setMap(null);

  points=[];

  els.list.innerHTML="";

  els.screenMain.style.display="none";
  els.screenPick.style.display="flex";

};

function tryInitFromStorage(){

  initMap();

}
