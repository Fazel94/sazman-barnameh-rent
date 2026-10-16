"use strict";
// Written by build_site.py. VERSION changes with every build of the pages, so each weekly snapshot gets a fresh cache.
const VERSION = "f3548dcb";
const PRECACHE = ["/", "/app.js?v=f399b76b", "/style.css?v=9e32c113", "/fonts/vazirmatn-subset.woff2", "/manifest.webmanifest", "/icons/icon-192.png"];
const CACHE = `rent-${VERSION}`;
self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("rent-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function fromNetwork(req) {
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}
self.addEventListener("fetch", ev => {
  const req = ev.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.searchParams.has("v") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/")) {  // immutable
    ev.respondWith(caches.match(req).then(hit => hit || fromNetwork(req)));
    return;
  }
  // a page is the same file for every query string: /estimate/result/?… is fetched and cached as /estimate/result/,
  // so every flat shares one HTTP-cache entry (max-age 600) and one offline copy
  const key = req.mode === "navigate" && url.search && url.pathname.endsWith("/") ? url.pathname : req;
  ev.respondWith(fromNetwork(key).catch(() => caches.match(key).then(hit => hit || Response.error())));
});
