/* =========================================================
   SANTARA — MapKit
   Satu API peta untuk dua backend: Google Maps (jika ada API key)
   dan Leaflet + OpenStreetMap (cadangan, tetap online & gratis)
   ========================================================= */
window.MapKit = (function () {
  let googleReady = false, googleLoading = null, googleFailed = false;

  const DARK = [
    { elementType: 'geometry', stylers: [{ color: '#0b1024' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5f6b8c' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1024' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a3566' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#182046' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0e1430' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2b3573' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#101636' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050a1c' }] }
  ];

  function loadGoogle(key) {
    if (googleReady) return Promise.resolve(true);
    if (googleFailed) return Promise.resolve(false);
    if (googleLoading) return googleLoading;
    googleLoading = new Promise((resolve) => {
      window.__santara_gm_cb = () => { googleReady = true; resolve(true); };
      window.gm_authFailure = () => { googleFailed = true; resolve(false); };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=__santara_gm_cb`;
      s.async = true;
      s.onerror = () => { googleFailed = true; resolve(false); };
      document.head.appendChild(s);
      setTimeout(() => { if (!googleReady) { googleFailed = true; resolve(false); } }, 9000);
    });
    return googleLoading;
  }

  function iconDataURI(type, heading) {
    const colors = { pickup: '#22E6FF', dest: '#FF3DC8', home: '#A8FF3E', les: '#FFC53D', driver: '#22E6FF' };
    const c = colors[type] || '#22E6FF';
    let svg;
    if (type === 'driver') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">
        <g transform="rotate(${heading || 0} 36 36)">
          <circle cx="36" cy="36" r="26" fill="rgba(34,230,255,.18)"/>
          <path d="M36 6 L44 22 L28 22 Z" fill="#22E6FF"/>
          <circle cx="36" cy="40" r="18" fill="#0B122E" stroke="#22E6FF" stroke-width="3"/>
          <g stroke="#22E6FF" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(27,31) scale(0.75)">
            <circle cx="5.8" cy="17.6" r="2.7"/><circle cx="18" cy="17.6" r="2.7"/>
            <path d="M8.5 17.6H15l2.4-8h-3.2"/><path d="M14.2 9.6 10.6 17.6"/><path d="M17.4 9.6H20l1 8"/>
          </g>
        </g></svg>`;
    } else {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="70" viewBox="0 0 56 70">
        <path d="M28 68C28 68 50 42 50 26A22 22 0 1 0 6 26C6 42 28 68 28 68Z" fill="${c}" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
        <circle cx="28" cy="25" r="8" fill="#05070F"/>
      </svg>`;
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function markerHTML(type) {
    if (type === 'driver') {
      return `<div class="mk-driver"><span class="ring"></span><span class="body">
        <svg class="ic"><use href="#i-scooter"/></svg></span><span class="arrow"></span></div>`;
    }
    return `<div class="mk ${type}"><span class="core"></span></div>`;
  }

  /* ------------------------------- factory ------------------------------- */
  function create(container, opts) {
    opts = opts || {};
    const center = opts.center || { lat: -7.8166, lng: 112.0117 };
    const zoom = opts.zoom || 15;
    const noop = function () { };
    const api = {
      provider: 'osm', markers: {}, routes: [], cbs: {}, el: container,
      setCenter: noop, getCenter: () => center, addMarker: noop, removeMarker: noop,
      clearMarkers: noop, drawRoute: noop, clearRoute: noop, fit: noop, panTo: noop,
      on: (ev, cb) => on(api, ev, cb), emit: (ev, d) => emit(api, ev, d),
      invalidate: noop, destroy: noop
    };

    try {
      if (opts.provider === 'google' && window.google && window.google.maps) googleImpl(api, container, center, zoom, opts);
      else leafletImpl(api, container, center, zoom, opts);
      // pelindung: semua operasi jadi no-op setelah map dihancurkan (hindari error Leaflet/_leaflet_pos)
      const origDestroy = api.destroy;
      Object.keys(api).forEach((k) => {
        const f = api[k];
        if (typeof f === 'function' && k !== 'destroy') {
          api[k] = function () { if (api._dead) return; try { return f.apply(api, arguments); } catch (e) { return undefined; } };
        }
      });
      api.destroy = function () { if (api._dead) return; api._dead = true; try { origDestroy(); } catch (e) { } };
      return api;
    } catch (e) {
      console.error('MAP ERROR ' + ((e && e.stack) || e));
      try { container.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#8E9BBE;font-size:12px;text-align:center;padding:20px">Peta tidak dapat dimuat<br><span style="opacity:.7">Periksa koneksi internet</span></div>'; } catch (_) { }
      return api; // stub aman agar layar tetap berfungsi
    }
  }

  function emit(api, ev, data) {
    if (api._dead) return;
    (api.cbs[ev] || []).forEach((f) => { try { f(data); } catch (e) { /* abaikan */ } });
  }
  function on(api, ev, cb) { (api.cbs[ev] = api.cbs[ev] || []).push(cb); return api; }

  /* -------------------------------- LEAFLET ------------------------------ */
  function leafletImpl(api, container, center, zoom, opts) {
    api.provider = 'osm';
    const L = window.L;
    const map = L.map(container, {
      center: [center.lat, center.lng], zoom, zoomControl: false, attributionControl: true,
      zoomAnimation: true, tap: true, dragging: opts.interactive !== false, scrollWheelZoom: opts.interactive !== false
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    api._map = map;

    api.setCenter = (lat, lng, z) => map.setView([lat, lng], z || map.getZoom(), { animate: true });
    api.getCenter = () => { try { const c = map.getCenter(); return c ? { lat: c.lat, lng: c.lng } : center; } catch (e) { return center; } };
    api.addMarker = (id, lat, lng, o) => {
      o = o || {};
      removeM(id);
      const isDriver = o.type === 'driver';
      const size = isDriver ? 52 : 44;
      const anchor = isDriver ? [26, 26] : [22, 44];
      const icon = L.divIcon({
        className: 'santara-marker', html: markerHTML(o.type), iconSize: [size, size], iconAnchor: anchor
      });
      const m = L.marker([lat, lng], { icon, zIndexOffset: isDriver ? 1000 : 500, interactive: !!o.clickable });
      if (o.title) m.bindTooltip(o.title, { direction: 'top', offset: isDriver ? [0, -26] : [0, -38], className: 'mk-tip' });
      m.addTo(map);
      api.markers[id] = m;
      return m;
    };
    api.removeMarker = removeM;
    api.clearMarkers = () => Object.keys(api.markers).forEach(removeM);
    api.clearRoute = () => { api.routes.forEach((r) => map.removeLayer(r)); api.routes = []; };
    api.drawRoute = (pts, o) => {
      api.clearRoute();
      if (!pts || pts.length < 2) return;
      const latlngs = pts.map((p) => [p.lat, p.lng]);
      const glow = L.polyline(latlngs, { color: '#7A5CFF', weight: 12, opacity: .30, lineCap: 'round' }).addTo(map);
      const core = L.polyline(latlngs, { color: (o && o.color) || '#22E6FF', weight: 5, opacity: .95, lineCap: 'round' }).addTo(map);
      api.routes = [glow, core];
    };
    api.fit = (pts, pad) => {
      if (!pts || !pts.length) return;
      const b = L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
      map.fitBounds(b, { padding: pad || [70, 90], animate: false, maxZoom: 16 });
    };
    api.panTo = (lat, lng) => map.panTo([lat, lng], { animate: true, duration: 0.6 });
    api.invalidate = () => { try { map.invalidateSize(); } catch (e) { } };
    api.destroy = () => {
      (api._timers || []).forEach(clearTimeout);
      try { if (map.stop) map.stop(); } catch (e) { }
      try { if (map._panAnim && map._panAnim.stop) map._panAnim.stop(); } catch (e) { }
      try { map.remove(); } catch (e) { }
    };
    map.on('moveend', () => { if (api._dead) return; emit(api, 'center', api.getCenter()); });
    map.on('zoomend', () => { if (api._dead) return; emit(api, 'center', api.getCenter()); });
    map.on('click', (e) => { if (api._dead) return; emit(api, 'click', { lat: e.latlng.lat, lng: e.latlng.lng }); });
    api._timers = [
      setTimeout(() => { try { map.invalidateSize(); } catch (e) { } }, 60),
      setTimeout(() => { try { map.invalidateSize(); } catch (e) { } }, 400)
    ];
    function removeM(id) { if (api.markers[id]) { try { map.removeLayer(api.markers[id]); } catch (e) { } delete api.markers[id]; } }
    return api;
  }

  /* -------------------------------- GOOGLE ------------------------------- */
  function googleImpl(api, container, center, zoom, opts) {
    api.provider = 'google';
    const g = window.google.maps;
    const map = new g.Map(container, {
      center, zoom, disableDefaultUI: true, gestureHandling: 'greedy',
      clickableIcons: false, styles: DARK,
      disableDoubleClickZoom: false, keyboardShortcuts: false
    });
    api._map = map;
    api.setCenter = (lat, lng, z) => map.setCenter({ lat, lng }) || (z && map.setZoom(z));
    api.getCenter = () => { try { const c = map.getCenter(); return c ? { lat: c.lat(), lng: c.lng() } : center; } catch (e) { return center; } };
    api.addMarker = (id, lat, lng, o) => {
      o = o || {};
      removeM(id);
      const m = new g.Marker({
        position: { lat, lng }, map,
        icon: { url: iconDataURI(o.type, o.heading), scaledSize: o.type === 'driver' ? new g.Size(56, 56) : new g.Size(46, 58), anchor: o.type === 'driver' ? new g.Point(28, 28) : new g.Point(23, 56) },
        zIndex: o.type === 'driver' ? 1000 : 500, title: o.title || ''
      });
      api.markers[id] = m;
      return m;
    };
    api.removeMarker = removeM;
    api.clearMarkers = () => Object.keys(api.markers).forEach(removeM);
    api.clearRoute = () => { api.routes.forEach((r) => r.setMap(null)); api.routes = []; };
    api.drawRoute = (pts, o) => {
      api.clearRoute();
      if (!pts || pts.length < 2) return;
      const path = pts.map((p) => ({ lat: p.lat, lng: p.lng }));
      const glow = new g.Polyline({ path, strokeColor: '#7A5CFF', strokeOpacity: .35, strokeWeight: 12, map });
      const core = new g.Polyline({ path, strokeColor: (o && o.color) || '#22E6FF', strokeOpacity: .95, strokeWeight: 5, map });
      api.routes = [glow, core];
    };
    api.fit = (pts) => {
      if (!pts || !pts.length) return;
      const b = new g.LatLngBounds();
      pts.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(b, { top: 90, bottom: 240, left: 60, right: 60 });
    };
    api.panTo = (lat, lng) => map.panTo({ lat, lng });
    api.invalidate = () => { try { g.event.trigger(map, 'resize'); } catch (e) { } };
    api.destroy = () => { api.clearMarkers(); api.clearRoute(); };
    map.addListener('idle', () => { if (api._dead) return; emit(api, 'center', api.getCenter()); });
    map.addListener('click', (e) => { if (api._dead) return; emit(api, 'click', { lat: e.latLng.lat(), lng: e.latLng.lng() }); });
    api._timers = [setTimeout(() => { try { g.event.trigger(map, 'resize'); } catch (e) { } }, 200)];
    function removeM(id) { if (api.markers[id]) { api.markers[id].setMap(null); delete api.markers[id]; } }
    return api;
  }

  /* --------------------------- heading update helper ---------------------- */
  function rotate(instance, id, heading) {
    const m = instance && instance.markers && instance.markers[id];
    if (!m || heading == null) return;
    if (instance.provider === 'google') {
      const ic = m.getIcon();
      ic.url = iconDataURI('driver', heading);
      m.setIcon(ic);
    } else {
      const el = m.getElement();
      if (el) {
        const wrap = el.querySelector('.mk-driver') || el;
        wrap.style.transform = `rotate(${heading}deg)`;
        const arrow = wrap.querySelector('.arrow');
        if (arrow) arrow.style.display = 'none';
      }
    }
  }

  return { create, loadGoogle, rotate, isGoogle: () => googleReady };
})();
