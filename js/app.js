/* Field Reports — Greene County Conservation maintenance reporter (prototype)
 *
 * DATA LAYER ARCHITECTURE (Phase 2 ready):
 * - All state lives in `DB` and persists to localStorage via Store.save().
 * - Every mutation goes through Store.mutate(fn), which applies the change,
 *   saves, then notifies Sync.enqueue() — the single choke point where a
 *   future backend sync will hook in.
 * - Sync is currently a local-only stub: Sync.mode === 'local-only', and
 *   every record carries syncState 'local'. Phase 2 replaces Sync.push()
 *   with fetch() calls to the shared backend and flips syncState to
 *   'synced'. No call sites need to change.
 * - Photos are downscaled dataURLs. Phase 2 will move these to object
 *   storage and keep only URLs here.
 */

'use strict';

var DB_KEY = 'field-reports-db-v1';

var CATEGORIES = [
  { id: 'tree',    label: 'Tree',          icon: '🌳' },
  { id: 'pothole', label: 'Pothole',       icon: '🕳️' },
  { id: 'trail',   label: 'Trail',         icon: '🥾' },
  { id: 'facility',label: 'Facility',      icon: '🏠' },
  { id: 'sign',    label: 'Sign',          icon: '🪧' },
  { id: 'trash',   label: 'Trash',         icon: '🗑️' },
  { id: 'water',   label: 'Water',         icon: '💧' },
  { id: 'animal',  label: 'Animal rescue', icon: '🦌' },
  { id: 'other',   label: 'Other',         icon: '📋' }
];

var PRIORITIES = {
  routine:  { label: 'Routine',  cls: 'routine' },
  high:     { label: 'High',     cls: 'high' },
  critical: { label: 'Critical', cls: 'critical' }
};

var STATUSES = ['reported', 'triaged', 'assigned', 'fixed', 'verified'];
var STATUS_LABEL = {
  reported: 'Reported',
  triaged: 'Triaged',
  assigned: 'Assigned',
  fixed: 'Fixed — awaiting verification',
  verified: 'Verified closed'
};

/* Park list: mycountyparks.com Greene County, 2026-09-20.
 * lat/lon known for a few anchors; null elsewhere. The park editor in
 * More lets Tanner add coordinates (and new areas) any time — the GPS
 * "nearest park" suggestion uses whichever parks have them. */
var DEFAULT_PARKS = [
  { id: 'p-adkins',     name: 'Adkins Bridge Access',               lat: null, lon: null },
  { id: 'p-dixon',      name: 'Bill and Vesta Dixon Wildlife Area', lat: null, lon: null },
  { id: 'p-bristol',    name: 'Bristol Wildlife Area',              lat: null, lon: null },
  { id: 'p-brown',      name: 'Brown Bridge Access',               lat: null, lon: null },
  { id: 'p-eureka',     name: 'Eureka Bridge Access',               lat: null, lon: null },
  { id: 'p-office',     name: 'Greene County Conservation Offices', lat: 42.07047, lon: -94.29170 },
  { id: 'p-henderson',  name: 'Henderson Park',                     lat: null, lon: null },
  { id: 'p-hobart',     name: 'Hobart Wildlife Area',               lat: null, lon: null },
  { id: 'p-horseshoe',  name: 'Horseshoe Bend Wildlife Area',        lat: null, lon: null },
  { id: 'p-hyde',       name: 'Hyde Park',                          lat: null, lon: null },
  { id: 'p-mcmahon',    name: 'McMahon Access',                     lat: null, lon: null },
  { id: 'p-depot',      name: 'Milwaukee Train Depot',              lat: null, lon: null },
  { id: 'p-pound',      name: 'Pound Pits Wildlife Area',           lat: null, lon: null },
  { id: 'p-rrvt',       name: 'Raccoon River Valley Trail',         lat: 41.93531, lon: -94.34319 },
  { id: 'p-rippey',     name: 'Rippey Railroad Right-of-Way',       lat: null, lon: null },
  { id: 'p-hanson',     name: 'Ruth Hanson Wildlife Area',          lat: null, lon: null },
  { id: 'p-prairie',    name: 'Scheuerman Prairie',                 lat: null, lon: null },
  { id: 'p-seven',      name: 'Seven Hills Park',                   lat: null, lon: null },
  { id: 'p-spring',     name: 'Spring Lake Park',                   lat: null, lon: null },
  { id: 'p-squirrel',   name: 'Squirrel Hollow Park',               lat: 41.95155, lon: -94.29076 },
  { id: 'p-squirrel-wa',name: 'Squirrel Hollow Wildlife Area',      lat: null, lon: null },
  { id: 'p-trailside',  name: 'Trailside Campground',               lat: null, lon: null },
  { id: 'p-waters',     name: 'Waters Wildlife Area',               lat: null, lon: null },
  { id: 'p-willow',     name: 'Willow Creek Wildlife Area',         lat: null, lon: null }
];

/* Rate table. Industry equipment rates: Iowa DOT Living Roadway Trust Fund
 * "Schedule of Labor and Equipment Rates", FY2027 (free, public).
 * In-house rates are editable placeholders — Tanner sets them to the
 * department's real loaded costs in More → Rate table. */
var DEFAULT_RATES = [
  { id: 'labor',   label: 'Crew labor',          unit: 'hr', industryRate: 48.00, inHouseRate: 30.00,
    note: 'Industry: BLS Iowa mean wage + fringe (edit to your figure). In-house: your loaded hourly cost.' },
  { id: 'skid',    label: 'Skid loader (<50 HP)', unit: 'hr', industryRate: 80.15, inHouseRate: 42.00,
    note: 'Industry: Iowa DOT FY2027 schedule.' },
  { id: 'tractor', label: 'Tractor & mower',     unit: 'hr', industryRate: 38.07, inHouseRate: 20.00,
    note: 'Industry: Iowa DOT FY2027 schedule.' },
  { id: 'chainsaw',label: 'Chainsaw',            unit: 'hr', industryRate: 1.97, inHouseRate: 1.00,
    note: 'Industry: midpoint of Iowa DOT $1.31–$2.62 range.' },
  { id: 'chipper', label: 'Brush chipper (≤7 in)', unit: 'hr', industryRate: 45.81, inHouseRate: 24.00,
    note: 'Industry: Iowa DOT FY2027 schedule.' }
];

/* ---------- utils ---------- */
function uid() {
  return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtMoney(n) {
  return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateTime(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
         d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function isoTodayPlus(days) {
  var d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function haversineKm(a, b, c, d) {
  var R = 6371, t = Math.PI / 180;
  var h = Math.sin((c - a) * t / 2) * Math.sin((c - a) * t / 2) +
          Math.cos(a * t) * Math.cos(c * t) *
          Math.sin((d - b) * t / 2) * Math.sin((d - b) * t / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
function catById(id) {
  for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
  return { id: 'other', label: 'Other', icon: '📋' };
}
function parkById(id) {
  for (var i = 0; i < DB.parks.length; i++) if (DB.parks[i].id === id) return DB.parks[i];
  return null;
}
function rateById(id) {
  for (var i = 0; i < DB.rates.length; i++) if (DB.rates[i].id === id) return DB.rates[i];
  return null;
}

var toastTimer = null;
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
}
function download(filename, content, mime) {
  var blob = new Blob([content], { type: mime || 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- store ---------- */
var DB = null;

var Store = {
  load: function () {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) { DB = JSON.parse(raw); return; }
    } catch (e) { /* corrupted — reseed below */ }
    DB = {
      version: 1,
      staffName: '',
      orgId: 'greene', // active org for the Map boundary overlay (see ORGS in orgs.js)
      parks: JSON.parse(JSON.stringify(DEFAULT_PARKS)),
      rates: JSON.parse(JSON.stringify(DEFAULT_RATES)),
      reports: []
    };
    seedDemo();
    Store.save();
  },
  /* Older DBs predate the org switcher — default them to Greene County. */
  ensureOrg: function () {
    if (!DB.orgId || !orgById(DB.orgId)) {
      DB.orgId = 'greene';
      Store.save();
    }
  },
  save: function () {
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
    catch (e) { toast('⚠️ Storage full — oldest photos may need deleting.'); }
  },
  /* Single choke point for every mutation. Phase 2: Sync.enqueue becomes a
   * real network queue here; nothing else changes. */
  mutate: function (fn) {
    fn(DB);
    Store.save();
    Sync.enqueueDirty();
    renderAll();
  }
};

/* ---------- sync stub (Phase 2 hook) ---------- */
var Sync = {
  mode: 'local-only', // Phase 2: 'shared-backend'
  /* Called after every mutation. Today: marks records local-only.
   * Phase 2: push dirty records to the backend, then mark 'synced'. */
  enqueueDirty: function () {
    DB.reports.forEach(function (r) { if (r.syncState !== 'synced') r.syncState = 'local'; });
    updateSyncPill();
  },
  /* Phase 2: replace body with fetch() to the shared backend. */
  push: function (report) {
    return Promise.resolve({ ok: false, reason: 'no-backend-in-prototype' });
  },
  pendingCount: function () {
    return DB.reports.filter(function (r) { return r.syncState !== 'synced'; }).length;
  }
};

function updateSyncPill() {
  var el = document.getElementById('sync-count');
  if (el) el.textContent = Sync.pendingCount();
}

/* ---------- demo seed (fictional everything) ---------- */
function seedDemo() {
  var now = Date.now(), H = 3600000, D = 24 * H;
  function mk(o) {
    o.id = o.id || uid();
    o.createdAt = o.createdAt || now;
    o.updatedAt = o.createdAt;
    o.syncState = 'local';
    o.demo = true;
    o.priority = o.priority || null;
    o.status = o.status || 'reported';
    o.crewUrgent = !!o.crewUrgent;
    o.photo = null;
    o.costing = o.costing || null;
    return o;
  }
  DB.reports = [
    mk({ category: 'tree', reporter: 'Alex R. (demo crew)',
      note: 'Tree down across the campground loop road, blocking both lanes. Needs a saw crew before the weekend.',
      parkId: 'p-trailside', lat: 42.0150, lon: -94.3700,
      crewUrgent: true, createdAt: now - 2 * H }),
    mk({ category: 'pothole', reporter: 'Sam T. (demo crew)',
      note: 'Pothole opening up at the main entrance, about two feet across and getting bigger with rain.',
      parkId: 'p-spring', lat: 42.0680, lon: -94.2950,
      priority: 'high', status: 'assigned', assignee: 'Sam T. (demo crew)',
      dueDate: isoTodayPlus(3), createdAt: now - 1 * D }),
    mk({ category: 'sign', reporter: 'Alex R. (demo crew)',
      note: 'Trailhead sign bent over at the base. Posts look solid — probably straighten and re-set.',
      parkId: 'p-rrvt', lat: 41.9353, lon: -94.3432,
      priority: 'routine', status: 'triaged', createdAt: now - 2 * D }),
    mk({ category: 'trash', reporter: 'Sam T. (demo crew)',
      note: 'Trash overflowing at the shelter after Saturday rentals. Extra pickup needed.',
      parkId: 'p-squirrel', lat: 41.9516, lon: -94.2908,
      priority: 'routine', status: 'fixed', assignee: 'Sam T. (demo crew)',
      createdAt: now - 3 * D,
      costing: { laborHours: 1.5, equipment: [], materials: 12, closedAt: now - 1 * D } }),
    mk({ category: 'water', reporter: 'Alex R. (demo crew)',
      note: 'Culvert cleared after the rain. Water flowing, ditch re-graded with the tractor.',
      parkId: 'p-seven', lat: 42.0100, lon: -94.3800,
      priority: 'high', status: 'verified', assignee: 'Alex R. (demo crew)',
      dueDate: isoTodayPlus(-1), createdAt: now - 5 * D,
      costing: { laborHours: 3, equipment: [{ rateId: 'tractor', hours: 1.5 }], materials: 45, closedAt: now - 2 * D } })
  ];
  DB.parks = JSON.parse(JSON.stringify(DEFAULT_PARKS));
  DB.rates = JSON.parse(JSON.stringify(DEFAULT_RATES));
}

/* ---------- costing ---------- */
function jobValue(costing, which) {
  // which: 'industry' | 'inhouse'
  if (!costing) return 0;
  var key = which === 'industry' ? 'industryRate' : 'inHouseRate';
  var labor = rateById('labor');
  var total = (parseFloat(costing.laborHours) || 0) * (labor ? parseFloat(labor[key]) || 0 : 0);
  (costing.equipment || []).forEach(function (line) {
    var r = rateById(line.rateId);
    if (r) total += (parseFloat(line.hours) || 0) * (parseFloat(r[key]) || 0);
  });
  total += parseFloat(costing.materials) || 0;
  return total;
}
function jobIndustry(r) { return jobValue(r.costing, 'industry'); }
function jobInHouse(r) { return jobValue(r.costing, 'inhouse'); }
function jobSavings(r) { return jobIndustry(r) - jobInHouse(r); }

/* ---------- GPS ---------- */
function getGPS() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) { resolve({ ok: false, error: 'no-geolocation' }); return; }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({ ok: true, lat: pos.coords.latitude, lon: pos.coords.longitude,
                  accuracy: Math.round(pos.coords.accuracy || 0) });
      },
      function (err) { resolve({ ok: false, error: err && err.message ? err.message : 'unavailable' }); },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
    );
  });
}
function nearestPark(lat, lon) {
  var best = null, bestD = Infinity;
  DB.parks.forEach(function (p) {
    if (p.lat == null || p.lon == null) return;
    var d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = p; }
  });
  return (best && bestD <= 8) ? { park: best, km: bestD } : null;
}

/* ---------- voice dictation ---------- */
var recog = null, recognizing = false;
function voiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function toggleVoice(textarea, statusEl, btn) {
  if (recognizing) { try { recog.stop(); } catch (e) {} return; }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { statusEl.textContent = 'Voice dictation is not available in this browser — typing works fine.'; statusEl.hidden = false; return; }
  recog = new SR();
  recog.lang = 'en-US';
  recog.interimResults = false;
  recog.onstart = function () {
    recognizing = true;
    btn.classList.add('listening');
    statusEl.textContent = '🎙️ Listening… speak your notes, then pause.';
    statusEl.hidden = false;
  };
  recog.onend = function () {
    recognizing = false;
    btn.classList.remove('listening');
    statusEl.hidden = true;
  };
  recog.onerror = function (ev) {
    recognizing = false;
    btn.classList.remove('listening');
    statusEl.textContent = 'Mic had trouble (' + (ev.error || 'unknown') + '). Your typed notes are kept.';
    statusEl.hidden = false;
  };
  recog.onresult = function (ev) {
    var text = '';
    for (var i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
    }
    if (text) {
      textarea.value = (textarea.value ? textarea.value.replace(/\s+$/, '') + ' ' : '') + text.trim();
    }
  };
  try { recog.start(); } catch (e) {
    statusEl.textContent = 'Could not start the microphone. Typing works fine.';
    statusEl.hidden = false;
  }
}

/* ---------- photo (downscaled, local only) ---------- */
function downscalePhoto(file) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      var max = 800;
      var w = img.width, h = img.height;
      var scale = Math.min(1, max / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad-image')); };
    img.src = url;
  });
}

/* ---------- tabs ---------- */
var currentView = 'view-report';
function showView(id) {
  currentView = id;
  document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== id; });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('active', t.getAttribute('data-view') === id);
  });
  if (id === 'view-board') renderBoard();
  if (id === 'view-map') renderMap();
  if (id === 'view-savings') renderSavings();
  if (id === 'view-more') renderMore();
  window.scrollTo(0, 0);
}

/* ---------- org switcher + map view ----------
 * White-label model: one shared codebase, per-org config in ORGS (orgs.js).
 * The switcher swaps the boundary overlay on the map and the header branding
 * line. Facilities and rates stay on the shared Greene County defaults until
 * per-org lists are defined with Tanner (see ORGS slots). */
function currentOrg() {
  return orgById(DB.orgId) || ORGS[0];
}
function setOrg(id) {
  var org = orgById(id);
  if (!org || DB.orgId === org.id) return;
  DB.orgId = org.id;
  Store.save(); // setting, not a report — don't mark reports dirty
  updateOrgChrome();
  renderAll();
  toast('Map: ' + org.shortName + '.');
}
function updateOrgChrome() {
  var org = currentOrg();
  var sub = document.getElementById('org-subtitle');
  if (sub) sub.textContent = org.name + ' · prototype';
  document.querySelectorAll('.org-btn').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-org') === org.id);
  });
  var cap = document.getElementById('map-org-caption');
  if (cap) cap.textContent = org.mapLabel + ' — TIGER/Line 2025, for overlay only (not a legal boundary).';
}
function renderMap() {
  updateOrgChrome();
  var org = currentOrg();
  var holder = document.getElementById('map-holder');
  var parks = DB.parks.filter(function (p) { return p.lat != null && p.lon != null; });
  var reports = DB.reports.map(function (r) {
    var cat = catById(r.category);
    var park = parkById(r.parkId);
    return {
      lat: r.lat, lon: r.lon, priority: r.priority,
      label: cat.icon + ' ' + cat.label + ' — ' + (park ? park.name : 'Unknown area') +
             (r.priority ? ' (' + r.priority + ')' : '')
    };
  });
  holder.innerHTML = OrgMap.render(org, { parks: parks, reports: reports });
  var n = reports.filter(function (r) { return r.lat != null; }).length;
  document.getElementById('map-counts').textContent =
    parks.length + ' areas with coordinates · ' + n + ' reports with GPS';
}

/* ---------- report view ---------- */
function renderCategoryGrid() {
  var grid = document.getElementById('category-grid');
  grid.innerHTML = '';
  CATEGORIES.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'cat-btn';
    b.innerHTML = '<span class="cat-icon">' + c.icon + '</span><span>' + esc(c.label) + '</span>';
    b.addEventListener('click', function () { openReportSheet(c); });
    grid.appendChild(b);
  });
}

var sheetState = null;

function fillParkSelect(sel, selectedId) {
  sel.innerHTML = '';
  var parks = DB.parks.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  parks.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    if (p.id === selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

function openReportSheet(cat) {
  sheetState = {
    category: cat.id,
    lat: null, lon: null, accuracy: null, gpsTried: false,
    photo: null
  };
  document.getElementById('sr-title').textContent = cat.icon + ' ' + cat.label;
  var sel = document.getElementById('sr-park');
  fillParkSelect(sel, null);
  document.getElementById('sr-park-hint').hidden = true;
  document.getElementById('sr-notes').value = '';
  document.getElementById('sr-urgent').checked = false;
  document.getElementById('sr-photo-preview').hidden = true;
  document.getElementById('sr-photo-preview').removeAttribute('src');
  var st = document.getElementById('sr-gps-status');
  st.className = 'gps-status'; st.textContent = '📍 Locating…';
  document.getElementById('sr-gps-coords').textContent = '';
  var mic = document.getElementById('sr-mic');
  mic.hidden = !voiceSupported();
  document.getElementById('sr-mic-status').hidden = true;

  document.getElementById('sheet-report').hidden = false;

  getGPS().then(function (g) {
    sheetState.gpsTried = true;
    if (g.ok) {
      sheetState.lat = g.lat; sheetState.lon = g.lon; sheetState.accuracy = g.accuracy;
      st.className = 'gps-status ok';
      st.textContent = '📍 Location captured';
      document.getElementById('sr-gps-coords').textContent =
        g.lat.toFixed(5) + ', ' + g.lon.toFixed(5) + ' (±' + g.accuracy + ' m)';
      var near = nearestPark(g.lat, g.lon);
      if (near) {
        sel.value = near.park.id;
        var hint = document.getElementById('sr-park-hint');
        hint.textContent = 'Nearest area: ' + near.park.name + ' (' + near.km.toFixed(1) + ' km) — change it if that’s wrong.';
        hint.hidden = false;
      }
    } else {
      st.className = 'gps-status bad';
      st.textContent = '📍 GPS unavailable — you can still send this report.';
    }
  });
}

function closeReportSheet() {
  document.getElementById('sheet-report').hidden = true;
  if (recognizing) { try { recog.stop(); } catch (e) {} }
  sheetState = null;
}

function sendReport() {
  if (!sheetState) return;
  var parkId = document.getElementById('sr-park').value;
  var notes = document.getElementById('sr-notes').value.trim();
  var urgent = document.getElementById('sr-urgent').checked;
  var cat = catById(sheetState.category);
  var r = {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reporter: DB.staffName || 'Crew member',
    category: sheetState.category,
    note: notes || cat.label + ' reported',
    parkId: parkId,
    lat: sheetState.lat, lon: sheetState.lon, gpsAccuracy: sheetState.accuracy,
    photo: sheetState.photo,
    crewUrgent: urgent,
    priority: null,
    status: 'reported',
    assignee: '', dueDate: '',
    costing: null,
    syncState: 'local',
    demo: false
  };
  Store.mutate(function (db) { db.reports.unshift(r); });
  closeReportSheet();
  toast(urgent ? '🚨 Urgent report saved on this phone.' : 'Report saved on this phone.');
}

/* ---------- board (dashboard) ---------- */
var PRI_ORDER = { critical: 0, high: 1, routine: 2 };

function fillFilterParks(sel, keepVal) {
  var val = keepVal !== undefined ? keepVal : sel.value;
  sel.innerHTML = '<option value="">All parks &amp; areas</option>';
  DB.parks.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = val || '';
}

function filteredReports() {
  var park = document.getElementById('f-park').value;
  var pri = document.getElementById('f-priority').value;
  var status = document.getElementById('f-status').value;
  var sort = document.getElementById('f-sort').value;
  var list = DB.reports.filter(function (r) {
    if (park && r.parkId !== park) return false;
    if (status && r.status !== status) return false;
    if (pri === 'none' && r.priority) return false;
    if (pri && pri !== 'none' && r.priority !== pri) return false;
    return true;
  });
  list.sort(function (a, b) {
    if (sort === 'priority') {
      var pa = a.priority ? PRI_ORDER[a.priority] : 9, pb = b.priority ? PRI_ORDER[b.priority] : 9;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    }
    if (sort === 'due') {
      var da = a.dueDate || '9999', db = b.dueDate || '9999';
      if (da !== db) return da < db ? -1 : 1;
      return b.createdAt - a.createdAt;
    }
    return b.createdAt - a.createdAt;
  });
  return list;
}

function priBadge(r) {
  if (r.priority && PRIORITIES[r.priority]) {
    return '<span class="badge ' + PRIORITIES[r.priority].cls + '">' + PRIORITIES[r.priority].label + '</span>';
  }
  if (r.crewUrgent) return '<span class="badge high">Crew flagged urgent</span>';
  return '<span class="badge">Priority not set</span>';
}

function renderBoard() {
  fillFilterParks(document.getElementById('f-park'));
  var list = filteredReports();
  var el = document.getElementById('board-list');
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<div class="empty">No reports match. Tap Report to log the first one.</div>';
    return;
  }
  list.forEach(function (r) {
    var cat = catById(r.category);
    var park = parkById(r.parkId);
    var card = document.createElement('button');
    card.className = 'report-card' + (r.priority ? ' ' + r.priority : '');
    var thumb = r.photo
      ? '<img class="report-thumb" src="' + r.photo + '" alt="">'
      : '<span class="report-thumb">' + cat.icon + '</span>';
    var coords = (r.lat != null) ? r.lat.toFixed(4) + ', ' + r.lon.toFixed(4) : 'no GPS';
    card.innerHTML =
      thumb +
      '<span class="report-main">' +
        '<span class="report-title">' + cat.icon + ' ' + esc(cat.label) + ' — ' + esc(park ? park.name : 'Unknown area') + '</span>' +
        '<span class="report-meta">' + esc(r.reporter) + ' · ' + fmtDateTime(r.createdAt) + ' · ' + esc(coords) + '</span>' +
        (r.note ? '<span class="report-note">' + esc(r.note) + '</span>' : '') +
        '<span class="badges">' + priBadge(r) + '<span class="badge status">' + STATUS_LABEL[r.status] + '</span>' +
        (r.dueDate ? '<span class="badge">Due ' + esc(r.dueDate) + '</span>' : '') +
        (r.demo ? '<span class="badge">demo</span>' : '') + '</span>' +
      '</span>';
    card.addEventListener('click', function () { openDetail(r.id); });
    el.appendChild(card);
  });
}

/* ---------- detail sheet: triage, status flow, costing ---------- */
var detailId = null;
var detailCosting = null; // working copy while marking fixed

function openDetail(id) {
  detailId = id;
  detailCosting = null;
  renderDetail();
  document.getElementById('sheet-detail').hidden = false;
}
function closeDetail() {
  document.getElementById('sheet-detail').hidden = true;
  detailId = null; detailCosting = null;
}
function getDetail() {
  for (var i = 0; i < DB.reports.length; i++) if (DB.reports[i].id === detailId) return DB.reports[i];
  return null;
}

function statusTimeline(r) {
  var idx = STATUSES.indexOf(r.status);
  return '<div class="timeline">' + STATUSES.map(function (s, i) {
    var cls = 'tstep' + (i < idx ? ' done' : '') + (i === idx ? ' now' : '');
    var short = { reported: 'Reported', triaged: 'Triaged', assigned: 'Assigned', fixed: 'Fixed', verified: 'Verified' }[s];
    return '<div class="' + cls + '">' + short + '</div>';
  }).join('') + '</div>';
}

function renderDetail() {
  var r = getDetail();
  if (!r) { closeDetail(); return; }
  var cat = catById(r.category);
  var park = parkById(r.parkId);
  var body = document.getElementById('detail-body');
  var h = '';

  h += '<h2>' + cat.icon + ' ' + esc(cat.label) + '</h2>';
  h += '<div class="badges">' + priBadge(r) + '<span class="badge status">' + STATUS_LABEL[r.status] + '</span>' +
       (r.demo ? '<span class="badge">demo data</span>' : '') + '</div>';
  h += statusTimeline(r);

  if (r.priority === 'critical') {
    h += '<div class="critical-note">🚨 CRITICAL — this is the phone-alert tier. If the crew hasn’t called it in, call them.</div>';
  }

  if (r.photo) h += '<img class="detail-photo" src="' + r.photo + '" alt="Report photo">';
  h += '<div class="kv"><span class="k">Park / area</span><span class="v">' + esc(park ? park.name : '—') + '</span></div>';
  h += '<div class="kv"><span class="k">Location</span><span class="v">' +
       ((r.lat != null) ? r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) : 'No GPS captured') + '</span></div>';
  h += '<div class="kv"><span class="k">Reported by</span><span class="v">' + esc(r.reporter) + '</span></div>';
  h += '<div class="kv"><span class="k">Reported</span><span class="v">' + fmtDateTime(r.createdAt) + '</span></div>';
  if (r.note) h += '<div class="kv"><span class="k">Notes</span><span class="v">' + esc(r.note) + '</span></div>';
  if (r.assignee) h += '<div class="kv"><span class="k">Assigned to</span><span class="v">' + esc(r.assignee) + '</span></div>';
  if (r.dueDate) h += '<div class="kv"><span class="k">Due</span><span class="v">' + esc(r.dueDate) + '</span></div>';

  /* Triage controls */
  h += '<h2 style="margin-top:18px">Triage</h2>';
  h += '<label class="field-label">Priority</label>';
  h += '<div class="pri-row" id="d-pri-row">' + ['routine', 'high', 'critical'].map(function (p) {
    return '<button class="pri-btn' + (r.priority === p ? ' on' : '') + '" data-pri="' + p + '">' + PRIORITIES[p].label + '</button>';
  }).join('') + '</div>';
  h += '<label class="field-label" for="d-assignee">Assignee</label>';
  h += '<input type="text" id="d-assignee" value="' + esc(r.assignee || '') + '" placeholder="Who owns this job?" autocomplete="off">';
  h += '<label class="field-label" for="d-duedate">Due date' + (r.priority === 'high' ? ' (required for High priority)' : '') + '</label>';
  h += '<input type="date" id="d-duedate" value="' + esc(r.dueDate || '') + '">';

  /* Costing — shown once the job is being closed */
  if (r.status === 'assigned' || r.status === 'fixed' || r.status === 'verified') {
    h += '<h2 style="margin-top:18px">Job costing</h2>';
    h += '<p class="hint">Log what the fix actually took. The Savings view values it at industry rates vs. your in-house cost.</p>';
    h += costingFormHTML(r);
  }
  if (r.status === 'verified' && r.costing) {
    h += '<div class="cost-total"><span>Industry value</span><span>' + fmtMoney(jobIndustry(r)) + '</span></div>';
    h += '<div class="cost-total"><span>In-house cost</span><span>' + fmtMoney(jobInHouse(r)) + '</span></div>';
    h += '<div class="cost-total"><span>County savings</span><span>' + fmtMoney(jobSavings(r)) + '</span></div>';
  }

  /* Advance / actions */
  h += '<div class="btn-row" style="margin-top:18px">';
  var next = nextStatus(r.status);
  if (next) h += '<button class="btn primary" id="d-advance">' + esc(advanceLabel(r.status)) + '</button>';
  h += '<button class="btn danger" id="d-delete">Delete</button>';
  h += '</div>';

  body.innerHTML = h;

  /* wire up */
  body.querySelectorAll('#d-pri-row .pri-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      Store.mutate(function (db) {
        var rr = findReport(db, r.id);
        rr.priority = b.getAttribute('data-pri');
        rr.updatedAt = Date.now();
      });
    });
  });
  /* persist assignee / due date as typed so re-renders never lose them */
  ['d-assignee', 'd-duedate'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', function () {
      Store.mutate(function (db) {
        var rr = findReport(db, r.id);
        rr.assignee = document.getElementById('d-assignee').value.trim();
        rr.dueDate = document.getElementById('d-duedate').value;
        rr.updatedAt = Date.now();
      });
    });
  });
  var adv = document.getElementById('d-advance');
  if (adv) adv.addEventListener('click', advanceStatus);
  document.getElementById('d-delete').addEventListener('click', function () {
    if (confirm('Delete this report? This cannot be undone.')) {
      Store.mutate(function (db) {
        db.reports = db.reports.filter(function (x) { return x.id !== r.id; });
      });
      closeDetail();
      toast('Report deleted.');
    }
  });
  wireCostingForm(r);
}

function findReport(db, id) {
  for (var i = 0; i < db.reports.length; i++) if (db.reports[i].id === id) return db.reports[i];
  return null;
}
function nextStatus(s) {
  var i = STATUSES.indexOf(s);
  return i >= 0 && i < STATUSES.length - 1 ? STATUSES[i + 1] : null;
}
function advanceLabel(s) {
  return { reported: 'Mark triaged →', triaged: 'Assign →', assigned: 'Mark fixed →', fixed: 'Verify closed ✓' }[s] || 'Advance →';
}

function readTriageInputs() {
  return {
    assignee: document.getElementById('d-assignee').value.trim(),
    dueDate: document.getElementById('d-duedate').value
  };
}

function advanceStatus() {
  var r = getDetail();
  if (!r) return;
  var t = readTriageInputs();
  var problems = [];
  if (r.status === 'reported' && !r.priority) problems.push('Set a priority first (Routine, High, or Critical).');
  if (r.status === 'triaged' && !t.assignee) problems.push('Name an assignee before assigning.');
  if (r.status === 'triaged' && r.priority === 'high' && !t.dueDate) problems.push('High priority jobs need a due date.');
  if (r.status === 'assigned') {
    var c = readCostingForm();
    if (!c) problems.push('Fill in the job costing (labor hours at least) before marking fixed.');
  }
  if (problems.length) { toast('⚠️ ' + problems[0]); return; }

  Store.mutate(function (db) {
    var rr = findReport(db, r.id);
    rr.assignee = t.assignee;
    rr.dueDate = t.dueDate;
    if (rr.status === 'assigned') {
      rr.costing = readCostingForm();
      rr.costing.closedAt = Date.now();
    }
    rr.status = nextStatus(rr.status);
    rr.updatedAt = Date.now();
  });
  var nr = getDetail();
  toast(nr.status === 'verified' ? '✓ Verified closed. Costing saved.' : 'Moved to ' + STATUS_LABEL[nr.status] + '.');
}

/* ---------- costing form ---------- */
function costingFormHTML(r) {
  var c = detailCosting || r.costing || { laborHours: '', equipment: [], materials: '' };
  if (!detailCosting) detailCosting = JSON.parse(JSON.stringify(c));
  var h = '<label class="field-label" for="c-labor">Labor hours</label>';
  h += '<input type="number" id="c-labor" min="0" step="0.25" inputmode="decimal" value="' + esc(detailCosting.laborHours) + '" placeholder="0">';
  h += '<label class="field-label">Equipment</label><div id="c-eq-rows">';
  detailCosting.equipment.forEach(function (line, i) {
    h += eqRowHTML(line, i);
  });
  h += '</div>';
  h += '<button class="btn small" id="c-add-eq" style="margin-top:6px">+ Add equipment</button>';
  h += '<label class="field-label" for="c-mat">Materials ($)</label>';
  h += '<input type="number" id="c-mat" min="0" step="0.01" inputmode="decimal" value="' + esc(detailCosting.materials) + '" placeholder="0.00">';
  h += '<div id="c-preview"></div>';
  return h;
}
function eqRowHTML(line, i) {
  var opts = DB.rates.filter(function (x) { return x.id !== 'labor'; }).map(function (x) {
    return '<option value="' + x.id + '"' + (x.id === line.rateId ? ' selected' : '') + '>' +
           esc(x.label) + ' (' + fmtMoney(x.industryRate) + '/hr)</option>';
  }).join('');
  return '<div class="cost-row" data-i="' + i + '">' +
    '<select class="c-eq-id">' + opts + '</select>' +
    '<input type="number" class="c-eq-hrs" min="0" step="0.25" inputmode="decimal" placeholder="hrs" value="' + esc(line.hours) + '">' +
    '<button class="btn small danger c-eq-del" aria-label="Remove">✕</button></div>';
}
function wireCostingForm(r) {
  var addBtn = document.getElementById('c-add-eq');
  if (!addBtn) return;
  var eqRates = DB.rates.filter(function (x) { return x.id !== 'labor'; });
  addBtn.addEventListener('click', function () {
    if (!eqRates.length) { toast('No equipment in the rate table yet.'); return; }
    syncCostingFromDOM();
    detailCosting.equipment.push({ rateId: eqRates[0].id, hours: '' });
    renderDetail();
  });
  document.getElementById('detail-body').querySelectorAll('.c-eq-del').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = parseInt(b.closest('.cost-row').getAttribute('data-i'), 10);
      syncCostingFromDOM();
      detailCosting.equipment.splice(i, 1);
      renderDetail();
    });
  });
  ['c-labor', 'c-mat'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCostPreview);
  });
  document.getElementById('detail-body').querySelectorAll('.c-eq-id, .c-eq-hrs').forEach(function (el) {
    el.addEventListener('input', updateCostPreview);
  });
  updateCostPreview();
}
function updateCostPreview() {
  var c = readCostingForm();
  var prev = document.getElementById('c-preview');
  if (!c || !prev) return;
  prev.innerHTML =
    '<div class="cost-total"><span>Industry value</span><span>' + fmtMoney(jobValue(c, 'industry')) + '</span></div>' +
    '<div class="cost-total"><span>In-house cost</span><span>' + fmtMoney(jobValue(c, 'inhouse')) + '</span></div>';
}
/* Sync the costing working copy from the visible form before any re-render. */
function syncCostingFromDOM() {
  var c = readCostingForm();
  if (c) detailCosting = c;
}
function readCostingForm() {
  var laborEl = document.getElementById('c-labor');
  if (!laborEl) return null;
  var labor = parseFloat(laborEl.value);
  var mat = parseFloat(document.getElementById('c-mat').value);
  var equipment = [];
  document.getElementById('detail-body').querySelectorAll('.cost-row').forEach(function (row) {
    equipment.push({
      rateId: row.querySelector('.c-eq-id').value,
      hours: parseFloat(row.querySelector('.c-eq-hrs').value) || 0
    });
  });
  // Require at least some recorded effort: labor hours entered (0 allowed explicitly)
  if (laborEl.value === '' && !equipment.length && (document.getElementById('c-mat').value === '')) return null;
  return {
    laborHours: isNaN(labor) ? 0 : labor,
    equipment: equipment,
    materials: isNaN(mat) ? 0 : mat
  };
}

/* ---------- savings view ---------- */
function savingsJobs() {
  var park = document.getElementById('s-park').value;
  var from = document.getElementById('s-from').value;
  var to = document.getElementById('s-to').value;
  return DB.reports.filter(function (r) {
    if (!r.costing) return false;
    if (park && r.parkId !== park) return false;
    var d = new Date(r.costing.closedAt || r.updatedAt).toISOString().slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}
function renderSavings() {
  fillFilterParks(document.getElementById('s-park'));
  var jobs = savingsJobs();
  var ind = 0, inh = 0;
  jobs.forEach(function (r) { ind += jobIndustry(r); inh += jobInHouse(r); });
  document.getElementById('stat-industry').textContent = fmtMoney(ind);
  document.getElementById('stat-inhouse').textContent = fmtMoney(inh);
  document.getElementById('stat-savings').textContent = fmtMoney(ind - inh);
  var el = document.getElementById('savings-list');
  el.innerHTML = '';
  if (!jobs.length) {
    el.innerHTML = '<div class="empty">No closed jobs in this range yet. Close a job with costing and it will show up here.</div>';
    return;
  }
  var t = '<table class="savings-table"><tr><th>Job</th><th>Industry</th><th>In-house</th><th>Saved</th></tr>';
  jobs.slice().sort(function (a, b) { return (b.costing.closedAt || 0) - (a.costing.closedAt || 0); }).forEach(function (r) {
    var cat = catById(r.category);
    var park = parkById(r.parkId);
    t += '<tr><td>' + cat.icon + ' ' + esc(cat.label) + '<br><span style="color:var(--muted);font-size:12px">' +
         esc(park ? park.name : '') + ' · ' + fmtDate(r.costing.closedAt || r.updatedAt) + '</span></td>' +
         '<td>' + fmtMoney(jobIndustry(r)) + '</td><td>' + fmtMoney(jobInHouse(r)) + '</td>' +
         '<td><strong>' + fmtMoney(jobSavings(r)) + '</strong></td></tr>';
  });
  el.innerHTML = t + '</table>';
}
function exportJobsCSV() {
  var jobs = savingsJobs();
  var rows = [['Job', 'Category', 'Park', 'Priority', 'Status', 'Reporter', 'Assignee', 'Created', 'Closed',
               'Labor hours', 'Equipment', 'Materials $', 'Industry value $', 'In-house cost $', 'Savings $']];
  jobs.forEach(function (r) {
    var cat = catById(r.category);
    var park = parkById(r.parkId);
    var eq = (r.costing.equipment || []).map(function (l) {
      var rt = rateById(l.rateId);
      return (rt ? rt.label : l.rateId) + ' ' + l.hours + 'h';
    }).join('; ');
    rows.push([
      (r.note || '').slice(0, 80), cat.label, park ? park.name : '', r.priority || '',
      STATUS_LABEL[r.status], r.reporter, r.assignee || '',
      new Date(r.createdAt).toISOString().slice(0, 10),
      new Date(r.costing.closedAt || r.updatedAt).toISOString().slice(0, 10),
      r.costing.laborHours, eq, r.costing.materials,
      jobIndustry(r).toFixed(2), jobInHouse(r).toFixed(2), jobSavings(r).toFixed(2)
    ]);
  });
  var csv = rows.map(function (row) {
    return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  download('field-reports-jobs.csv', csv, 'text/csv');
  toast('Jobs CSV downloaded.');
}

/* ---------- more view ---------- */
function renderMore() {
  document.getElementById('staff-name').value = DB.staffName || '';
  document.getElementById('park-count').textContent = DB.parks.length + ' areas';

  var pl = document.getElementById('park-list');
  pl.innerHTML = '';
  DB.parks.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
    var row = document.createElement('div');
    row.className = 'park-row';
    row.innerHTML = '<span class="nm">' + esc(p.name) + '</span>' +
      '<span class="co">' + ((p.lat != null) ? p.lat.toFixed(4) + ', ' + p.lon.toFixed(4) : 'no coords') + '</span>';
    pl.appendChild(row);
  });

  var rl = document.getElementById('rate-list');
  rl.innerHTML = '';
  DB.rates.forEach(function (rt) {
    var row = document.createElement('div');
    row.className = 'rate-row';
    row.innerHTML =
      '<span class="nm">' + esc(rt.label) + '<br><span class="rate-note">' + esc(rt.note || '') + '</span></span>' +
      '<span class="nums">$<input type="number" data-rate="' + rt.id + '" data-which="industry" value="' + rt.industryRate + '" step="any" min="0" aria-label="Industry rate"> ' +
      '$<input type="number" data-rate="' + rt.id + '" data-which="inhouse" value="' + rt.inHouseRate + '" step="any" min="0" aria-label="In-house rate"></span>';
    rl.appendChild(row);
  });
  rl.querySelectorAll('input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      var key = inp.getAttribute('data-which') === 'industry' ? 'industryRate' : 'inHouseRate';
      var rt0 = rateById(inp.getAttribute('data-rate'));
      if (isNaN(v) || v < 0) { inp.value = rt0 ? rt0[key] : ''; return; }
      Store.mutate(function (db) {
        var rt = null;
        db.rates.forEach(function (x) { if (x.id === inp.getAttribute('data-rate')) rt = x; });
        if (rt) rt[key] = v;
      });
      toast('Rate saved.');
    });
  });
}

function renderAll() {
  updateSyncPill();
  var hasDemo = DB.reports.some(function (r) { return r.demo; });
  document.getElementById('demo-banner').hidden = !hasDemo;
  if (currentView === 'view-board') renderBoard();
  if (currentView === 'view-map') renderMap();
  if (currentView === 'view-savings') renderSavings();
  if (currentView === 'view-more') renderMore();
  if (detailId) renderDetail();
}

/* ---------- init & wiring ---------- */
function init() {
  Store.load();
  Store.ensureOrg();
  renderCategoryGrid();
  updateSyncPill();
  updateOrgChrome();
  var hasDemo = DB.reports.some(function (r) { return r.demo; });
  document.getElementById('demo-banner').hidden = !hasDemo;

  /* tabs */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
  });

  /* map: org switcher */
  document.querySelectorAll('.org-btn').forEach(function (b) {
    b.addEventListener('click', function () { setOrg(b.getAttribute('data-org')); });
  });

  /* report sheet */
  document.getElementById('sr-cancel').addEventListener('click', closeReportSheet);
  document.getElementById('sheet-report').addEventListener('click', function (e) {
    if (e.target.id === 'sheet-report') closeReportSheet();
  });
  document.getElementById('sr-send').addEventListener('click', sendReport);

  /* photo */
  var photoInput = document.getElementById('sr-photo-input');
  document.getElementById('sr-photo-btn').addEventListener('click', function () { photoInput.click(); });
  photoInput.addEventListener('change', function () {
    var f = photoInput.files && photoInput.files[0];
    if (!f) return;
    downscalePhoto(f).then(function (url) {
      if (sheetState) sheetState.photo = url;
      var prev = document.getElementById('sr-photo-preview');
      prev.src = url;
      prev.hidden = false;
      toast('Photo attached.');
    }).catch(function () { toast('⚠️ Could not read that photo.'); });
    photoInput.value = '';
  });

  /* mic */
  document.getElementById('sr-mic').addEventListener('click', function () {
    toggleVoice(
      document.getElementById('sr-notes'),
      document.getElementById('sr-mic-status'),
      document.getElementById('sr-mic')
    );
  });

  /* detail sheet */
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('sheet-detail').addEventListener('click', function (e) {
    if (e.target.id === 'sheet-detail') closeDetail();
  });

  /* board filters */
  ['f-park', 'f-priority', 'f-status', 'f-sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', renderBoard);
  });
  /* savings filters */
  ['s-park', 's-from', 's-to'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', renderSavings);
  });
  document.getElementById('btn-csv').addEventListener('click', exportJobsCSV);
  document.getElementById('btn-json').addEventListener('click', function () {
    download('field-reports-all-data.json', JSON.stringify(DB, null, 2), 'application/json');
    toast('Full data JSON downloaded.');
  });

  /* more: staff name */
  document.getElementById('staff-name').addEventListener('change', function (e) {
    Store.mutate(function (db) { db.staffName = e.target.value.trim(); });
    toast('Name saved.');
  });

  /* more: add park */
  document.getElementById('btn-add-park').addEventListener('click', function () {
    var name = document.getElementById('new-park-name').value.trim();
    if (!name) { toast('⚠️ Give the area a name first.'); return; }
    var lat = parseFloat(document.getElementById('new-park-lat').value);
    var lon = parseFloat(document.getElementById('new-park-lon').value);
    Store.mutate(function (db) {
      db.parks.push({
        id: uid(), name: name,
        lat: isNaN(lat) ? null : lat,
        lon: isNaN(lon) ? null : lon
      });
    });
    document.getElementById('new-park-name').value = '';
    document.getElementById('new-park-lat').value = '';
    document.getElementById('new-park-lon').value = '';
    toast('“' + name + '” added to the park list.');
  });

  /* more: add rate */
  document.getElementById('btn-add-rate').addEventListener('click', function () {
    var label = document.getElementById('new-rate-label').value.trim();
    var ind = parseFloat(document.getElementById('new-rate-ind').value);
    var inh = parseFloat(document.getElementById('new-rate-in').value);
    if (!label) { toast('⚠️ Name the equipment first.'); return; }
    if (isNaN(ind) || isNaN(inh)) { toast('⚠️ Enter both hourly rates.'); return; }
    Store.mutate(function (db) {
      db.rates.push({ id: uid(), label: label, unit: 'hr', industryRate: ind, inHouseRate: inh, note: 'Added by staff.' });
    });
    document.getElementById('new-rate-label').value = '';
    document.getElementById('new-rate-ind').value = '';
    document.getElementById('new-rate-in').value = '';
    toast('Equipment rate added.');
  });

  /* more: reset demo / wipe */
  document.getElementById('btn-reset-demo').addEventListener('click', function () {
    if (!confirm('Reset demo data? Your real reports stay; the fictional demo reports are replaced.')) return;
    Store.mutate(function (db) {
      var keepReports = db.reports.filter(function (r) { return !r.demo; });
      var keepParks = db.parks, keepRates = db.rates, keepName = db.staffName;
      seedDemo();
      db.reports = db.reports.concat(keepReports);
      db.parks = keepParks;
      db.rates = keepRates;
      db.staffName = keepName;
    });
    toast('Demo data reset.');
  });
  document.getElementById('btn-wipe').addEventListener('click', function () {
    if (!confirm('Erase EVERYTHING on this phone — all reports, photos, parks, and rates? This cannot be undone.')) return;
    if (!confirm('Last chance: really erase it all?')) return;
    try { localStorage.removeItem(DB_KEY); } catch (e) {}
    location.reload();
  });

  showView('view-report');
}

document.addEventListener('DOMContentLoaded', init);
