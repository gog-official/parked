const K = {
  SPOT: 'pd_spot', NOTE: 'pd_note', PHOTO: 'pd_photo', TAG: 'pd_tag',
  TIMER: 'pd_timer', HISTORY: 'pd_history',
  GARAGE: 'pd_garage', COST_RATE: 'pd_cost_rate', COST_FLAT: 'pd_cost_flat',
  ALT_END: 'pd_alt_end',
  VALET_TS: 'pd_valet_ts', VALET_PHOTO: 'pd_valet_photo', VALET_PHONE: 'pd_valet_phone',
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

let spot = { lat: null, lng: null, code: null, timestamp: null };
let map = null, marker = null, dot = null, accuracy = null;
let watchId = null, timerInterval = null;
let safetyInterval = null;
let valetInterval = null, costInterval = null, altInterval = null, compassInterval = null;

// ── Views ────────────────────────────────

function showUI(id) {
  $$('.ui').forEach(u => u.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Collapsible sections ────────────────

function initCollapse() {
  $$('.sg-h').forEach(h => {
    h.onclick = () => {
      const target = document.getElementById('sg-' + h.dataset.sg);
      if (!target) return;
      target.classList.toggle('open');
      h.querySelector('.sg-arrow').classList.toggle('open');
    };
  });
  // Open Spot section by default
  const spotH = document.querySelector('[data-sg="spot"]');
  const spotB = document.getElementById('sg-spot');
  if (spotH && spotB) {
    spotB.classList.add('open');
    spotH.querySelector('.sg-arrow').classList.add('open');
  }
}

// ── Sidebar toggle ──────────────────────

function initSidebar() {
  const sidebar = $('sidebar');
  const toggle = $('side-toggle');
  if (toggle) toggle.onclick = () => sidebar.classList.toggle('collapsed');
  if (window.innerWidth <= 700) sidebar.classList.add('collapsed');
}

// ── Sound Effects ──────────────────────────

let audioCtx = null;
function ac() { if (!audioCtx) audioCtx = new (AudioContext || webkitAudioContext)(); return audioCtx; }

function tone(f, dur, type, vol) {
  try {
    const ctx = ac(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(vol||0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  } catch {}
}

const SFX = {
  click() { tone(660,0.05,'square',0.04); },
  park() { tone(523,0.1,'sine',0.07); setTimeout(()=>tone(659,0.12,'sine',0.07),100); },
  alert() { tone(880,0.08,'square',0.05); setTimeout(()=>tone(880,0.08,'square',0.05),160); },
  toggle() { tone(300,0.06,'sine',0.03); setTimeout(()=>tone(520,0.06,'sine',0.03),70); },
  error() { tone(180,0.25,'sawtooth',0.04); },
  alarm() { for(let i=0;i<4;i++) setTimeout(()=>tone(1000,0.12,'square',0.06),i*200); },
};

// ── URL ──────────────────────────────────

function getCode() {
  const m = location.pathname.match(/^\/s\/([a-z0-9_-]+)/i);
  return m ? m[1] : new URLSearchParams(location.search).get('code') || null;
}
function getLL() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get('lat')), lng = parseFloat(p.get('lng'));
  if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  return null;
}
// ── Map ──────────────────────────────────

function initMap(lat, lng, zoom) {
  if (map) { map.setView([lat, lng], zoom || map.getZoom()); return; }
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([lat, lng], zoom || 17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}
function fly(lat, lng, z) { if (map) map.flyTo([lat, lng], z || 17, { duration: 0.5 }); }

function addPin(lat, lng) {
  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: '<div class="marker-pin">P</div>',
      className: '', iconSize: [32, 32], iconAnchor: [16, 16],
    }),
  }).addTo(map);
}

function addLiveDot(lat, lng) {
  if (dot) map.removeLayer(dot);
  dot = L.circleMarker([lat, lng], {
    radius: 6, color: '#3B82F6', fillColor: '#3B82F6', fillOpacity: 1, weight: 2,
  }).addTo(map);
}

// ── Geocode ──────────────────────────────

const gCache = {};
async function addr(lat, lng) {
  const k = `${lat},${lng}`;
  if (gCache[k]) return gCache[k];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
    const d = await r.json();
    return gCache[k] = d.display_name || null;
  } catch { return null; }
}

// ── Elapsed timer ────────────────────────

function startElapsed(ts) {
  clearInterval(timerInterval);
  const el = $('elapsed');
  if (!el) return;
  const tick = () => {
    const m = Math.floor((Date.now() - ts) / 60000);
    el.textContent = m < 1 ? 'Just now' : m < 60 ? m + ' min ago' : Math.floor(m/60) + 'h ' + (m%60) + 'm';
  };
  tick();
  timerInterval = setInterval(tick, 30000);
}

// ── Garage Mode ──────────────────────────

function initGarage() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(K.GARAGE)); } catch {}
  if (saved) {
    if ($('garage-level')) $('garage-level').value = saved.level || '';
    if ($('garage-section')) $('garage-section').value = saved.section || '';
    if ($('garage-row')) $('garage-row').value = saved.row || '';
    if ($('garage-spot')) $('garage-spot').value = saved.spot || '';
    updateGarageBadge();
    $('garage-fields').classList.remove('hidden');
  }

  const btn = $('garage-toggle');
  if (btn) btn.onclick = () => $('garage-fields').classList.toggle('hidden');

  ['garage-level','garage-section','garage-row','garage-spot'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', saveGarage);
  });
}

function saveGarage() {
  const data = {
    level: $('garage-level') ? $('garage-level').value : '',
    section: $('garage-section') ? $('garage-section').value : '',
    row: $('garage-row') ? $('garage-row').value : '',
    spot: $('garage-spot') ? $('garage-spot').value : '',
  };
  localStorage.setItem(K.GARAGE, JSON.stringify(data));
  updateGarageBadge();
}

function updateGarageBadge() {
  const parts = [];
  if ($('garage-level') && $('garage-level').value) parts.push('L' + $('garage-level').value);
  if ($('garage-section') && $('garage-section').value) parts.push($('garage-section').value);
  if ($('garage-row') && $('garage-row').value) parts.push('R' + $('garage-row').value);
  if ($('garage-spot') && $('garage-spot').value) parts.push('#' + $('garage-spot').value);
  const badge = $('garage-badge');
  if (!badge) return;
  if (parts.length) {
    badge.textContent = parts.join(' - ');
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Safety Walk ──────────────────────────

async function startSafetyWalk(lat, lng) {
  if ($('safety-active')) $('safety-active').classList.remove('hidden');
  if ($('safety-btn')) $('safety-btn').textContent = 'Walking...';

  if (safetyInterval) clearInterval(safetyInterval);

  const update = () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const clat = pos.coords.latitude, clng = pos.coords.longitude;
      const dist = haversine(clat, clng, lat, lng);
      const bearing = calcBearing(clat, clng, lat, lng);
      if ($('safety-dist')) $('safety-dist').textContent = dist < 10 ? 'At your car!' : dist < 1000 ? Math.round(dist) + ' m' : (dist/1000).toFixed(1) + ' km';
      if ($('safety-dir')) $('safety-dir').textContent = cardinal(bearing);
      if (dist < 10) SFX.alert();
    }, () => {}, { enableHighAccuracy: true, timeout: 5000 });
  };

  update();
  safetyInterval = setInterval(update, 3000);
  if ($('safety-stop')) $('safety-stop').onclick = stopSafetyWalk;
  SFX.alert();
}

function stopSafetyWalk() {
  clearInterval(safetyInterval);
  safetyInterval = null;
  if ($('safety-active')) $('safety-active').classList.add('hidden');
  if ($('safety-btn')) $('safety-btn').textContent = 'Safety Walk';
}

// ── Valet Mode ───────────────────────────

function initValet() {
  const ts = localStorage.getItem(K.VALET_TS);
  if (ts) {
    if ($('valet-active')) $('valet-active').classList.remove('hidden');
    if ($('valet-btn')) $('valet-btn').textContent = 'Valet - Active';
    startValetTimer(parseInt(ts));
  }
  const savedPhoto = localStorage.getItem(K.VALET_PHOTO);
  if (savedPhoto && $('valet-img')) {
    $('valet-img').src = savedPhoto;
    if ($('valet-photo-wrap')) $('valet-photo-wrap').classList.remove('hidden');
  }

  const btn = $('valet-btn');
  if (btn) btn.onclick = () => {
    if (localStorage.getItem(K.VALET_TS)) return;
    const ts = Date.now();
    localStorage.setItem(K.VALET_TS, ts);
    if ($('valet-active')) $('valet-active').classList.remove('hidden');
    btn.textContent = 'Valet - Active';
    startValetTimer(ts);
    toast('Valet mode started');
  };

  const vInput = $('valet-input');
  if (vInput) vInput.onchange = e => {
    if (e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        localStorage.setItem(K.VALET_PHOTO, dataUrl);
        if ($('valet-img')) $('valet-img').src = dataUrl;
        if ($('valet-photo-wrap')) $('valet-photo-wrap').classList.remove('hidden');
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  if ($('valet-ticket-btn')) $('valet-ticket-btn').onclick = () => { if (vInput) vInput.click(); };
  if ($('valet-call-btn')) $('valet-call-btn').onclick = () => {
    const num = localStorage.getItem(K.VALET_PHONE) || prompt('Valet phone number:');
    if (num) {
      localStorage.setItem(K.VALET_PHONE, num);
      location.href = 'tel:' + num.replace(/\D/g, '');
    }
  };
  if ($('valet-end')) $('valet-end').onclick = () => {
    clearInterval(valetInterval);
    localStorage.removeItem(K.VALET_TS);
    localStorage.removeItem(K.VALET_PHOTO);
    localStorage.removeItem(K.VALET_PHONE);
    if ($('valet-active')) $('valet-active').classList.add('hidden');
    if ($('valet-btn')) $('valet-btn').textContent = 'Valet Mode';
    if ($('valet-photo-wrap')) $('valet-photo-wrap').classList.add('hidden');
    toast('Valet session ended');
  };
}

function startValetTimer(ts) {
  clearInterval(valetInterval);
  const tick = () => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if ($('valet-timer')) $('valet-timer').textContent = m < 1 ? '<1 min' : m < 60 ? m + ' min' : Math.floor(m/60) + 'h ' + (m%60) + 'm';
  };
  tick();
  valetInterval = setInterval(tick, 30000);
}

// ── Cost Tracker ─────────────────────────

function initCostTracker() {
  if ($('cost-rate')) $('cost-rate').value = localStorage.getItem(K.COST_RATE) || '';
  if ($('cost-flat')) $('cost-flat').value = localStorage.getItem(K.COST_FLAT) || '';

  const btn = $('cost-toggle');
  if (btn) btn.onclick = () => { if ($('cost-fields')) $('cost-fields').classList.toggle('hidden'); };

  if ($('cost-rate')) $('cost-rate').addEventListener('input', () => {
    localStorage.setItem(K.COST_RATE, $('cost-rate').value);
    updateCost();
  });
  if ($('cost-flat')) $('cost-flat').addEventListener('input', () => {
    localStorage.setItem(K.COST_FLAT, $('cost-flat').value);
    updateCost();
  });

  updateCost();
  if (costInterval) clearInterval(costInterval);
  costInterval = setInterval(updateCost, 10000);
}

function updateCost() {
  const rate = parseFloat($('cost-rate') ? $('cost-rate').value : 0) || 0;
  const flat = parseFloat($('cost-flat') ? $('cost-flat').value : 0) || 0;
  const total = $('cost-total');
  const amount = $('cost-amount');
  if (!total || !amount) return;
  if (!rate && !flat) { total.classList.add('hidden'); return; }
  const elapsed = spot.timestamp ? (Date.now() - spot.timestamp) / 3600000 : 0;
  amount.textContent = '$' + (rate * elapsed + flat).toFixed(2);
  total.classList.remove('hidden');
}

// ── Alt-Side Reminder ────────────────────

function initAltSide() {
  const savedEnd = localStorage.getItem(K.ALT_END);
  if (savedEnd && parseInt(savedEnd) > Date.now()) {
    if ($('alt-fields')) $('alt-fields').classList.remove('hidden');
    startAltCountdown(parseInt(savedEnd));
  }

  const btn = $('alt-toggle');
  if (btn) btn.onclick = () => { if ($('alt-fields')) $('alt-fields').classList.toggle('hidden'); };

  $$('#alt-presets .btn').forEach(b => {
    b.onclick = () => {
      const hours = parseInt(b.dataset.alt);
      const end = Date.now() + hours * 3600000;
      localStorage.setItem(K.ALT_END, end);
      startAltCountdown(end);
      if ($('alt-presets')) $('alt-presets').classList.add('hidden');
      if (Notification.permission === 'default') Notification.requestPermission();
      if (Notification.permission === 'granted') {
        setTimeout(() => {
          new Notification('Parked - Street Cleaning', {
            body: hours > 6 ? 'Move your car tomorrow morning' : 'Move your car soon',
            icon: 'icons/icon.svg',
          });
          SFX.alarm();
        }, Math.max((hours * 3600000 - 600000), 1000));
      }
    };
  });

  if ($('alt-cancel')) $('alt-cancel').onclick = () => {
    clearInterval(altInterval);
    localStorage.removeItem(K.ALT_END);
    if ($('alt-active')) $('alt-active').classList.add('hidden');
    if ($('alt-presets')) $('alt-presets').classList.remove('hidden');
  };
}

function startAltCountdown(endTs) {
  clearInterval(altInterval);
  if ($('alt-active')) $('alt-active').classList.remove('hidden');
  const tick = () => {
    const left = Math.max(0, endTs - Date.now());
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    if ($('alt-countdown')) $('alt-countdown').textContent = h > 0 ? h + 'h ' + m + 'm' : m + ' min';
    if (left <= 0 && $('alt-countdown')) { $('alt-countdown').textContent = 'OVERDUE'; }
  };
  tick();
  altInterval = setInterval(tick, 10000);
}

// ── Compass ──────────────────────────────

function startCompass(targetLat, targetLng) {
  const body = $('compass-result');
  const distEl = $('compass-dist');
  const dirEl = $('compass-dir');
  const btn = $('compass-btn');
  if (body) body.classList.remove('hidden');
  if (btn) btn.textContent = 'Updating...';
  const update = () => {
    navigator.geolocation.getCurrentPosition(pos => {
      const clat = pos.coords.latitude, clng = pos.coords.longitude;
      const dist = haversine(clat, clng, targetLat, targetLng);
      const bearing = calcBearing(clat, clng, targetLat, targetLng);
      if (distEl) distEl.textContent = dist < 10 ? 'Found it!' : dist < 1000 ? Math.round(dist) + ' m' : (dist/1000).toFixed(1) + ' km';
      if (dirEl) dirEl.textContent = cardinal(bearing);
    }, () => {}, { enableHighAccuracy: true, timeout: 5000 });
  };
  update();
  clearInterval(compassInterval);
  compassInterval = setInterval(update, 3000);
  if (btn) btn.onclick = () => {
    clearInterval(compassInterval);
    if (body) body.classList.add('hidden');
    btn.textContent = 'Find My Car';
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function cardinal(deg) {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
}

// ── Save ─────────────────────────────────

async function handleSave() {
  const btn = $('save-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Locating...';

  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
    );
    const lat = pos.coords.latitude, lng = pos.coords.longitude, ts = Date.now();
    spot = { lat, lng, timestamp: ts, code: null };
    spot.code = Math.random().toString(36).slice(2, 8);
    localStorage.setItem(K.SPOT, JSON.stringify(spot));

    const a = await addr(lat, lng);
    const tag = localStorage.getItem(K.TAG);
    addHistory({ lat, lng, timestamp: ts, code: spot.code, addr: a, tag });
    showResultView(spot);
    showUI('result-ui');
    if ($('save-btn')) $('save-btn').style.display = 'none';
    SFX.park();

  } catch (err) {
    showUI('error-ui');
    if ($('error-msg')) $('error-msg').textContent = err.code === 1 ? 'Location denied' : 'Could not get location';
    SFX.error();
  }
  btn.disabled = false;
  btn.textContent = 'Park Here';
}

// ── Show Result ──────────────────────────

async function showResultView(data) {
  const { lat, lng, code, timestamp } = data;
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  spot = data;

  initMap(lat, lng);
  addPin(lat, lng);
  fly(lat, lng);
  startElapsed(timestamp);

  if ($('result-addr')) {
    $('result-addr').textContent = 'Loading...';
    addr(lat, lng).then(a => { if ($('result-addr')) $('result-addr').textContent = a || lat.toFixed(6) + ', ' + lng.toFixed(6); });
  }

  // Auto-open Tools section so all features are visible
  const toolsH = document.querySelector('[data-sg="tools"]');
  const toolsB = document.getElementById('sg-tools');
  if (toolsH && toolsB) {
    toolsB.classList.add('open');
    toolsH.querySelector('.sg-arrow').classList.add('open');
  }

  if ($('note-input')) $('note-input').value = localStorage.getItem(K.NOTE) || '';

  initGarage();
  initValet();
  initCostTracker();
  initAltSide();

  if ($('safety-btn')) $('safety-btn').onclick = () => {
    if (safetyInterval) { stopSafetyWalk(); return; }
    startSafetyWalk(lat, lng);
  };

  const openDir = () => window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=walking', '_blank');
  if ($('dir-btn')) $('dir-btn').onclick = openDir;
  if ($('bb-walk')) $('bb-walk').onclick = openDir;
  const shareLink = () => {
    const url = location.origin + '?lat=' + lat.toFixed(6) + '&lng=' + lng.toFixed(6);
    navigator.clipboard.writeText(url).then(() => toast('Link copied'));
  };
  if ($('share-btn')) $('share-btn').onclick = shareLink;
  if ($('bb-share')) $('bb-share').onclick = shareLink;
  if ($('compass-btn')) $('compass-btn').onclick = () => startCompass(lat, lng);
  if ($('bb-compass')) $('bb-compass').onclick = () => startCompass(lat, lng);
  if ($('note-input')) $('note-input').oninput = () => localStorage.setItem(K.NOTE, $('note-input').value);
  if ($('clear-btn')) $('clear-btn').onclick = () => {
    clearInterval(timerInterval); clearInterval(safetyInterval); clearInterval(valetInterval);
    clearInterval(costInterval); clearInterval(altInterval); clearInterval(compassInterval);
    Object.values(K).forEach(k => localStorage.removeItem(k));
    location.reload();
  };
}

// ── Shared View ──────────────────────────

async function showShared(lat, lng) {
  initMap(lat, lng);
  addPin(lat, lng);
  fly(lat, lng);
  document.title = 'Parked - ' + lat.toFixed(4) + ', ' + lng.toFixed(4);
  if ($('shared-addr')) $('shared-addr').textContent = 'Loading...';
  showUI('shared-ui');
  addr(lat, lng).then(a => { if ($('shared-addr')) $('shared-addr').textContent = a || lat.toFixed(6) + ', ' + lng.toFixed(6); });
  if ($('shared-dir-btn')) $('shared-dir-btn').onclick = () => window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=walking', '_blank');
}

// ── History ──────────────────────────────

function getHistory() {
  try { return JSON.parse(localStorage.getItem(K.HISTORY)) || []; } catch { return []; }
}
function addHistory(entry) {
  const h = getHistory().filter(e => !(e.lat === entry.lat && e.lng === entry.lng));
  h.unshift(entry);
  localStorage.setItem(K.HISTORY, JSON.stringify(h.slice(0, 20)));
}
function renderHistory() {
  const list = $('history-list');
  if (!list) return;
  const h = getHistory();
  list.innerHTML = '';
  if (!h.length) { list.innerHTML = '<p style="color:var(--text3);font-size:0.78rem;padding:12px;">No past spots.</p>'; return; }
  h.forEach(s => {
    const d = new Date(s.timestamp);
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = '<span class="hi-dot"></span><div class="hi-info"><div class="hi-addr">' + (s.addr || s.lat.toFixed(4) + ', ' + s.lng.toFixed(4)) + '</div><div class="hi-time">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</div></div>' + (s.tag ? '<span class="hi-tag">' + s.tag + '</span>' : '');
    item.onclick = () => { showResultView(s); showUI('result-ui'); };
    list.appendChild(item);
  });
}

// ── Live Location ────────────────────────

function startWatch() {
  if (!navigator.geolocation) { if ($('save-addr')) $('save-addr').textContent = 'Geolocation unavailable'; return; }
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      initMap(latitude, longitude);
      addLiveDot(latitude, longitude);
      map.setView([latitude, longitude], map.getZoom());
      addr(latitude, longitude).then(a => { if (a && $('save-addr')) $('save-addr').textContent = a; });
    },
    () => { if ($('save-addr')) $('save-addr').textContent = 'Location unavailable'; },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// ── 3D Scene ─────────────────────────────

let sc3d = null, particles3d = null, car3d = null;
let mx3d = 0, my3d = 0;

function init3D() {
  if (typeof THREE === 'undefined' || !$('bg3d')) return;
  const container = $('bg3d');

  sc3d = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  cam.position.z = 35;

  const ren = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  ren.setSize(window.innerWidth, window.innerHeight);
  ren.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(ren.domElement);

  // Particles
  const geo = new THREE.BufferGeometry();
  const N = 600;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
  const pal = [
    new THREE.Color('#3B82F6'), new THREE.Color('#06B6D4'), new THREE.Color('#EC4899'),
    new THREE.Color('#F97316'), new THREE.Color('#FACC15'), new THREE.Color('#84CC16'),
    new THREE.Color('#8B5CF6'), new THREE.Color('#14B8A6'),
  ];
  for (let i = 0; i < N; i++) {
    pos[i*3] = (Math.random() - 0.5) * 80;
    pos[i*3+1] = (Math.random() - 0.5) * 60;
    pos[i*3+2] = (Math.random() - 0.5) * 50;
    const c = pal[Math.floor(Math.random() * pal.length)];
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    sz[i] = Math.random() * 3 + 0.5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));

  particles3d = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.25, vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending,
  }));
  sc3d.add(particles3d);

  // Floating shapes
  const shapes = [];
  const sColors = [0x3B82F6, 0x06B6D4, 0xEC4899, 0xF97316, 0xFACC15, 0x84CC16, 0x8B5CF6];
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Mesh(
      i % 3 === 0 ? new THREE.BoxGeometry(0.8,0.8,0.8) :
      i % 3 === 1 ? new THREE.SphereGeometry(0.5, 6, 6) :
      new THREE.TetrahedronGeometry(0.6),
      new THREE.MeshBasicMaterial({ color: sColors[i % sColors.length], transparent: true, opacity: 0.25 })
    );
    s.position.set((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 35, (Math.random() - 0.5) * 30);
    s.userData = { rotSpeed: { x: (Math.random() - 0.5) * 0.02, y: (Math.random() - 0.5) * 0.02 }, floatOffset: Math.random() * 100 };
    sc3d.add(s);
    shapes.push(s);
  }

  // Low-poly car
  car3d = new THREE.Group();
  const cm = new THREE.MeshBasicMaterial({ color: 0x3B82F6, transparent: true, opacity: 0.2 });
  const cw = new THREE.MeshBasicMaterial({ color: 0xEC4899, transparent: true, opacity: 0.12 });
  car3d.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 4), cm));
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 2), cw);
  cabin.position.set(0, 0.45, -0.3);
  car3d.add(cabin);
  // Wheels
  const wm = new THREE.MeshBasicMaterial({ color: 0x1E293B, transparent: true, opacity: 0.3 });
  [[-0.7, -0.2, 1.2], [0.7, -0.2, 1.2], [-0.7, -0.2, -1.2], [0.7, -0.2, -1.2]].forEach(p => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.15, 8), wm);
    w.rotation.x = Math.PI / 2; w.position.set(p[0], p[1], p[2]);
    car3d.add(w);
  });
  car3d.position.set(-6, -3, -8);
  sc3d.add(car3d);

  // Lines connecting nearby particles
  const lineGeo = new THREE.BufferGeometry();
  const linePos = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = pos[i*3] - pos[j*3], dy = pos[i*3+1] - pos[j*3+1], dz = pos[i*3+2] - pos[j*3+2];
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < 6 && Math.random() > 0.97) {
        linePos.push(pos[i*3], pos[i*3+1], pos[i*3+2], pos[j*3], pos[j*3+1], pos[j*3+2]);
      }
    }
  }
  if (linePos.length) {
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePos), 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3B82F6, transparent: true, opacity: 0.08 });
    sc3d.add(new THREE.LineSegments(lineGeo, lineMat));
  }

  // Resize
  window.addEventListener('resize', () => {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
    ren.setSize(window.innerWidth, window.innerHeight);
  });

  // Mouse
  document.addEventListener('mousemove', e => {
    mx3d = (e.clientX / window.innerWidth) * 2 - 1;
    my3d = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // Animate
  function anim() {
    requestAnimationFrame(anim);
    if (particles3d) {
      particles3d.rotation.y += 0.0003;
      particles3d.rotation.x += 0.0001;
      particles3d.rotation.x += (my3d * 0.03 - particles3d.rotation.x) * 0.005;
      particles3d.rotation.y += (mx3d * 0.03 - particles3d.rotation.y) * 0.005;
    }
    shapes.forEach(s => {
      s.rotation.x += s.userData.rotSpeed.x;
      s.rotation.y += s.userData.rotSpeed.y;
      s.position.y += Math.sin(Date.now() * 0.001 + s.userData.floatOffset) * 0.002;
    });
    if (car3d) {
      car3d.userData.a = (car3d.userData.a || 0) + 0.004;
      car3d.position.x = Math.cos(car3d.userData.a) * 9;
      car3d.position.z = Math.sin(car3d.userData.a) * 6 - 4;
      car3d.rotation.y = -car3d.userData.a + Math.PI / 2;
    }
    ren.render(sc3d, cam);
  }
  anim();
}

// ── Init ─────────────────────────────────

async function init() {
  initCollapse();
  initSidebar();
  init3D();

  // Check for history expansion on load
  const historyH = document.querySelector('[data-sg="history"]');
  if (historyH) {
    historyH.onclick = () => {
      const target = document.getElementById('sg-history');
      if (target) {
        target.classList.toggle('open');
        historyH.querySelector('.sg-arrow').classList.toggle('open');
        if (target.classList.contains('open')) renderHistory();
      }
    };
  }

  const hidePark = () => { if ($('save-btn')) $('save-btn').style.display = 'none'; };

  const code = getCode();
  if (code) {
    hidePark();
    const spots = getHistory().filter(s => s.code === code);
    if (spots.length) { showShared(spots[0].lat, spots[0].lng); } else { showUI('error-ui'); if ($('error-msg')) $('error-msg').textContent = 'Spot not found on this device'; }
    return;
  }

  const ll = getLL();
  if (ll) { hidePark(); showShared(ll.lat, ll.lng); return; }

  const saved = localStorage.getItem(K.SPOT);
  if (saved) {
    hidePark();
    spot = JSON.parse(saved);
    await showResultView(spot);
    showUI('result-ui');
    return;
  }

  initMap(0, 0, 2);
  startWatch();
  if ($('save-btn')) $('save-btn').onclick = handleSave;
  if ($('retry-btn')) $('retry-btn').onclick = () => location.reload();
  // Bottom bar fallbacks (overridden by showResultView after parking)
  ['bb-compass','bb-share','bb-walk'].forEach(id => {
    const el = $(id);
    if (el) el.onclick = () => toast('Save a spot first');
  });
  // bb-apk is an <a> in HTML with direct download link
}

// Global button SFX
document.addEventListener('click', e => {
  const b = e.target.closest('.btn');
  if (b && !b.classList.contains('btn-ghost')) SFX.click();
});

document.addEventListener('DOMContentLoaded', init);
