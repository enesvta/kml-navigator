const fileInput = document.getElementById("fileInput");
const screenPick = document.getElementById("screenPick");
const screenMain = document.getElementById("screenMain");
const list = document.getElementById("list");
const chipCount = document.getElementById("chipCount");
const chipGps = document.getElementById("chipGps");

let map;
let markers=[];
let points=[];

fileInput.addEventListener("change", async e=>{
const file=e.target.files[0];
if(!file)return;

const text=await file.text();
points=parseKml(text);

screenPick.style.display="none";
screenMain.style.display="block";

initMap();
renderPoints();
renderList();
});

function initMap(){
map=L.map("map").setView([39,35],6);

L.tileLayer(
"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
{maxZoom:19}
).addTo(map);

navigator.geolocation.watchPosition(pos=>{
const lat=pos.coords.latitude;
const lon=pos.coords.longitude;

chipGps.innerText="GPS ±"+Math.round(pos.coords.accuracy)+"m";

L.circleMarker([lat,lon],{radius:6,color:"white",fillColor:"lime"}).addTo(map);

});
}

function parseKml(text){
const parser=new DOMParser();
const xml=parser.parseFromString(text,"text/xml");

const placemarks=[...xml.getElementsByTagName("Placemark")];
const pts=[];

placemarks.forEach((pm,i)=>{
const name=pm.getElementsByTagName("name")[0]?.textContent||"Point "+(i+1);
const coord=pm.getElementsByTagName("coordinates")[0]?.textContent.trim();

if(!coord)return;

const parts=coord.split(",");
pts.push({
name,
lat:parseFloat(parts[1]),
lon:parseFloat(parts[0])
});
});

return pts;
}

function renderPoints(){
markers.forEach(m=>map.removeLayer(m));
markers=[];

points.forEach(p=>{
const m=L.marker([p.lat,p.lon]).addTo(map);
m.on("click",()=>navigate(p));
markers.push(m);
});

chipCount.innerText=points.length+" nokta";

const bounds=L.latLngBounds(points.map(p=>[p.lat,p.lon]));
map.fitBounds(bounds);
}

function renderList(){
list.innerHTML="";

points.forEach((p,i)=>{
const div=document.createElement("div");
div.className="item";
div.innerText=p.name;

div.onclick=()=>navigate(p);

list.appendChild(div);
});
}

function navigate(p){
const url=`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
window.location.href=url;
}
