/* D&D Dynamic Sheet, Offline Cache (PWA)
   Cache version: 2026-02-22c
*/
const CACHE_NAME = "dnd-dynamic-sheet-2026-02-22c";
const ASSETS = [
  "./",
  "./Icons/Action.svg",
  "./Icons/Action_used.svg",
  "./Icons/Bonus.svg",
  "./Icons/Bonus_used.svg",
  "./Icons/Reaction.svg",
  "./Icons/Reaction_used.svg",
  "./Icons/app-icon-192.png",
  "./Icons/app-icon-512.png",
  "./battle.html",
  "./css/styles.css",
  "./data/backgrounds.json",
  "./data/class_features.json",
  "./data/classes.json",
  "./data/dice_images.json",
  "./data/races.json",
  "./data/spellcasting.json",
  "./data/spells.json",
  "./data/subclasses.json",
  "./data/traits_all_feats.json",
  "./index.html",
  "./js/app.js",
  "./js/config.js",
  "./js/engine/backgrounds.js",
  "./js/engine/character.js",
  "./js/engine/class_features.js",
  "./js/engine/cloud.js",
  "./js/engine/effects.js",
  "./js/engine/equipment.js",
  "./js/engine/ids.js",
  "./js/engine/progression.js",
  "./js/engine/races.js",
  "./js/engine/rest.js",
  "./js/engine/rules_5e2014.js",
  "./js/engine/spells_engine.js",
  "./js/engine/util.js",
  "./sw.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Navigation requests:
  // - Prefer the exact requested document (e.g. battle.html) from cache.
  // - Fall back to network.
  // - If offline and not cached, fall back to index.html as a last resort.
  // This avoids the bug where battle.html loads index.html (duplicate UI in the Battle tab).
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((resp) => {
            // Cache successful navigations so battle.html works offline.
            if (resp && resp.status === 200 && resp.type === "basic") {
              const copy = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return resp;
          })
          .catch(() => caches.match("./index.html"));
      })
    );
    return;
  }

  // Cache-first for static assets, with background refresh.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((resp) => {
        // Only cache successful basic responses.
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
