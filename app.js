let map;

window.onGoogleMapsLoaded=function(){

console.log("maps ready")

}

document
.getElementById("fileInput")
.addEventListener("change",loadKML)


async function loadKML(e){

const file=e.target.files[0]

if(!file)return

const text=await file.text()

const parser=new DOMParser()

const xml=parser.parseFromString(text,"text/xml")

const coords=[...xml.getElementsByTagName("coordinates")]

const points=[]

coords.forEach(c=>{

const parts=c.textContent.trim().split(",")

const lon=parseFloat(parts[0])
const lat=parseFloat(parts[1])

points.push({lat,lon})

})


startMap(points)

}


function startMap(points){

document
.getElementById("screenPick")
.style.display="none"

document
.getElementById("screenMain")
.style.display="block"

map=new google.maps.Map(
document.getElementById("map"),
{
center:points[0],
zoom:16,
mapTypeId:"satellite"
}
)


points.forEach(p=>{

new google.maps.Marker({

position:p,
map

})

})

}
