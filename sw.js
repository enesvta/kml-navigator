const CACHE="kml-nav-v10";

self.addEventListener("install",e=>{
self.skipWaiting();
});

self.addEventListener("activate",e=>{
self.clients.claim();
});
