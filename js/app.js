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
  { id: 'tree',    label: 'Tree',          icon: '🌳', img: 'assets/cats/tree.png' },
  { id: 'pothole', label: 'Pothole',       icon: '🕳️', img: 'assets/cats/pothole.png' },
  { id: 'trail',   label: 'Trail',         icon: '🥾', img: 'assets/cats/trail.png' },
  { id: 'facility',label: 'Facility',      icon: '🏠', img: 'assets/cats/facility.png' },
  { id: 'sign',    label: 'Sign',          icon: '🪧', img: 'assets/cats/sign.png' },
  { id: 'trash',   label: 'Trash',         icon: '🗑️', img: 'assets/cats/trash.png' },
  { id: 'water',   label: 'Water',         icon: '💧', img: 'assets/cats/water.png' },
  { id: 'animal',  label: 'Animal rescue', icon: '🦌', img: 'assets/cats/animal.png' },
  { id: 'other',   label: 'Other',         icon: '📋', img: 'assets/cats/other.png' }
];
/* Silhouette icon for the big buttons and thumbnails — falls back to the
 * emoji when the art file is missing, so text contexts stay readable. */
function catIcon(cat, cls) {
  if (cat && cat.img) {
    return '<img src="' + cat.img + '" class="' + (cls || 'cat-sil') + '" alt=""' +
      ' onerror="this.outerHTML=\'' + cat.icon + '\'">';
  }
  return (cat && cat.icon) || '';
}

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
/* All 24 Greene County areas. Coordinates researched 2026-09-20 from
 * mycountyparks.com pages, DNR Public Hunting Atlas polygons, named access
 * points, and published addresses — see
 * workspace/research_notes/greene-county-park-coordinates-20260920.json.
 * `approx: true` marks pins that are approximate (directions-derived or
 * representative points); the map tooltip says so. */
var DEFAULT_PARKS = [
  { id: 'p-adkins',     name: 'Adkins Bridge Access',               lat: 41.912484, lon: -94.275242 },
  { id: 'p-dixon',      name: 'Bill and Vesta Dixon Wildlife Area', lat: 42.16637,  lon: -94.24602, approx: true },
  { id: 'p-bristol',    name: 'Bristol Wildlife Area',              lat: 42.05435,  lon: -94.48696 },
  { id: 'p-brown',      name: 'Brown Bridge Access',               lat: 42.0676,   lon: -94.5377,  approx: true },
  { id: 'p-eureka',     name: 'Eureka Bridge Access',               lat: 42.01193,  lon: -94.42858, approx: true },
  { id: 'p-office',     name: 'Greene County Conservation Offices', lat: 42.07047,  lon: -94.29170 },
  { id: 'p-henderson',  name: 'Henderson Park',                     lat: 41.98922,  lon: -94.37736 },
  { id: 'p-hobart',     name: 'Hobart Wildlife Area',               lat: 42.09642,  lon: -94.57594 },
  { id: 'p-horseshoe',  name: 'Horseshoe Bend Wildlife Area',       lat: 42.11482,  lon: -94.60101 },
  { id: 'p-hyde',       name: 'Hyde Park',                          lat: 42.11303,  lon: -94.57273 },
  { id: 'p-mcmahon',    name: 'McMahon Access',                     lat: 42.02233,  lon: -94.47510 },
  { id: 'p-depot',      name: 'Milwaukee Train Depot',              lat: 42.01493,  lon: -94.36824 },
  { id: 'p-pound',      name: 'Pound Pits Wildlife Area',           lat: 42.07379,  lon: -94.24635 },
  { id: 'p-rrvt',       name: 'Raccoon River Valley Trail',         lat: 42.01475,  lon: -94.36788, approx: true },
  { id: 'p-rippey',     name: 'Rippey Railroad Right-of-Way',       lat: 41.91626,  lon: -94.18133 },
  { id: 'p-hanson',     name: 'Ruth Hanson Wildlife Area',          lat: 41.88666,  lon: -94.26602 },
  { id: 'p-prairie',    name: 'Scheuerman Prairie',                 lat: 42.10555,  lon: -94.31107 },
  { id: 'p-seven',      name: 'Seven Hills Park',                   lat: 41.98935,  lon: -94.39323, approx: true },
  { id: 'p-spring',     name: 'Spring Lake Park',                   lat: 42.07047,  lon: -94.29170 },
  { id: 'p-squirrel',   name: 'Squirrel Hollow Park',               lat: 41.95155,  lon: -94.29076 },
  { id: 'p-squirrel-wa',name: 'Squirrel Hollow Wildlife Area',      lat: 41.94981,  lon: -94.29201 },
  { id: 'p-trailside',  name: 'Trailside Campground',               lat: 42.01478,  lon: -94.36414 },
  { id: 'p-waters',     name: 'Waters Wildlife Area',               lat: 42.03,     lon: -94.30,    approx: true },
  { id: 'p-willow',     name: 'Willow Creek Wildlife Area',         lat: 41.90633,  lon: -94.61707 }
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
function crewById(id) {
  for (var i = 0; i < DB.crew.length; i++) if (DB.crew[i].id === id) return DB.crew[i];
  return null;
}
/* A person's loaded hourly cost. A crew line pointing at a removed member
 * falls back to the generic in-house labor rate so old jobs keep valuing. */
function wageFor(crewId) {
  var c = crewById(crewId);
  if (c) return parseFloat(c.wage) || 0;
  var l = rateById('labor');
  return l ? parseFloat(l.inHouseRate) || 0 : 0;
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
      if (raw) { DB = JSON.parse(raw); }
    } catch (e) { /* corrupted — reseed below */ }
    if (!DB || typeof DB !== 'object') {
      DB = {
        version: 1,
        staffName: '',
        orgId: 'greene', // active org for the Map boundary overlay (see ORGS in orgs.js)
        parks: JSON.parse(JSON.stringify(DEFAULT_PARKS)),
        rates: JSON.parse(JSON.stringify(DEFAULT_RATES)),
        reports: []
      };
      seedDemo();
    }
    /* 2026-09-20: crew wages landed after existing installs — older DBs lack it. */
    if (!Array.isArray(DB.crew)) DB.crew = [];
    /* 2026-09-20: real park coordinates researched (see DEFAULT_PARKS).
     * Older installs have nulls. Fill blanks from the researched defaults —
     * never touch a park that already has coordinates, which the user may
     * have placed or corrected themselves. */
    if (Array.isArray(DB.parks)) {
      DB.parks.forEach(function (p) {
        if (p.lat != null && p.lon != null) return;
        var d = null;
        DEFAULT_PARKS.forEach(function (x) { if (x.id === p.id) d = x; });
        if (d && d.lat != null) {
          p.lat = d.lat;
          p.lon = d.lon;
          if (d.approx) p.approx = true;
        }
      });
    }
    Store.save();
  },
  /* Older DBs predate the org switcher — default them to Greene County.
   * 2026-09-20: Tanner parked the City of Jefferson tab; any saved
   * 'jefferson' org resets to Greene County. The Jefferson boundary config
   * stays in orgs.js for the later duplicate. */
  ensureOrg: function () {
    if (DB.orgId === 'jefferson' || !DB.orgId || !orgById(DB.orgId)) {
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
/* Labor model: `costing.labor` is an array of { crewId, hours } lines valued at
 * each person's actual wage for in-house cost. Older records (and demo seeds)
 * carry the legacy single `costing.laborHours` number, valued at the generic
 * 'labor' rate-table row. Both shapes stay readable forever — never silently
 * rewrite a saved record's shape. */
function laborHoursOf(costing) {
  if (!costing) return 0;
  if (Array.isArray(costing.labor)) {
    return costing.labor.reduce(function (s, l) { return s + (parseFloat(l.hours) || 0); }, 0);
  }
  return parseFloat(costing.laborHours) || 0;
}
/* Actual county labor cost: each person's hours at their own wage. A line
 * pointing at a deleted crew member falls back to the generic in-house rate. */
function laborCostOf(costing) {
  if (!costing) return 0;
  if (!Array.isArray(costing.labor)) return 0;
  return costing.labor.reduce(function (s, l) {
    return s + (parseFloat(l.hours) || 0) * wageFor(l.crewId);
  }, 0);
}
/* One-line-per-person description for CSV / detail views. */
function laborDesc(costing) {
  if (!costing) return '';
  if (Array.isArray(costing.labor)) {
    return costing.labor.map(function (l) {
      var c = crewById(l.crewId);
      var nm = c ? c.name : 'Former staff';
      return nm + ' ' + l.hours + 'h (' + fmtMoney((parseFloat(l.hours) || 0) * (c ? (parseFloat(c.wage) || 0) : 0)) + ')';
    }).join('; ');
  }
  return (parseFloat(costing.laborHours) || 0) + 'h (generic labor rate)';
}
function jobValue(costing, which) {
  // which: 'industry' | 'inhouse'
  if (!costing) return 0;
  var key = which === 'industry' ? 'industryRate' : 'inHouseRate';
  var labor = rateById('labor');
  var total;
  if (which === 'inhouse' && Array.isArray(costing.labor)) {
    total = laborCostOf(costing); // actual wages
  } else {
    // Industry labor is the published benchmark wage+fringe for every job;
    // legacy single-number labor values at the generic row on both sides.
    total = laborHoursOf(costing) * (labor ? parseFloat(labor[key]) || 0 : 0);
  }
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
/* ---------- map: Leaflet tile map (street + satellite), SVG sketch fallback ----------
 * Tanner 2026-09-20: frame on Greene County (a little beyond is fine), offer
 * Street and Satellite layers — no topo layer. Esri tiles are keyless, same
 * as Opossum Foot. If the Leaflet CDN can't load (dead zones / offline), the
 * old OrgMap SVG sketch renders instead so the map never goes blank. */
var frMap = null, frOverlay = null, frYouDot = null, frMapOrg = null;

function renderMap() {
  updateOrgChrome();
  if (typeof L === 'undefined') { renderSvgMap(); return; }
  var org = currentOrg();
  initFieldMap(org);
  refreshFieldMap(org);
}

function fieldMapBounds(org) {
  var ring = org.boundary.features[0].geometry.coordinates[0];
  var b = OrgMap.boundsOfRing(ring);
  return L.latLngBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]]);
}

function initFieldMap(org) {
  if (frMap) {
    /* holder was display:none while another tab was up — re-measure */
    setTimeout(function () { frMap.invalidateSize(); }, 60);
    return;
  }
  frMap = L.map('map-holder', { zoomControl: true, attributionControl: true, maxZoom: 19 });
  var street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 19, attribution: '\u00a9 Esri, HERE, Garmin, \u00a9 OpenStreetMap contributors' });
  var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 19, attribution: 'Imagery \u00a9 Esri' });
  /* road + place labels drawn over the imagery so Satellite stays readable */
  var refRoads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 19, attribution: '\u00a9 Esri' });
  var refLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 19, attribution: '\u00a9 Esri' });
  var streetL = L.layerGroup([street]);
  var satL = L.layerGroup([satellite, refRoads, refLabels]);
  streetL.addTo(frMap);
  L.control.layers({ 'Street': streetL, 'Satellite': satL }, null, { position: 'topright' }).addTo(frMap);
  frOverlay = L.layerGroup().addTo(frMap);
  frMap.fitBounds(fieldMapBounds(org).pad(0.08));
  frMapOrg = org.id;
}

var PRI_FILL = { critical: '#e05252', high: '#e8a020', routine: '#7fb069' };

function refreshFieldMap(org) {
  if (!frMap || !frOverlay) return;
  if (frMapOrg !== org.id) { /* org changed -> reframe on its boundary */
    frMapOrg = org.id;
    frMap.fitBounds(fieldMapBounds(org).pad(0.08));
  }
  frOverlay.clearLayers();
  /* Greene County boundary outline (TIGER/Line 2025 - overlay only) */
  frOverlay.addLayer(L.geoJSON(org.boundary, {
    style: { color: '#d19a2f', weight: 2.5, opacity: 0.9, fillColor: '#d19a2f', fillOpacity: 0.06 }
  }));
  /* park area dots */
  var nParks = 0;
  DB.parks.forEach(function (p) {
    if (p.lat == null || p.lon == null) return;
    nParks++;
    frOverlay.addLayer(L.circleMarker([p.lat, p.lon], {
      radius: 6, color: '#0d1008', weight: 1.5, fillColor: '#9ecfff', fillOpacity: 0.95
    }).bindTooltip(p.name + (p.approx ? ' (approximate location)' : '')));
  });
  /* report dots, colored by priority */
  var n = 0;
  DB.reports.forEach(function (r) {
    if (r.lat == null || r.lon == null) return;
    n++;
    var cat = catById(r.category);
    var park = parkById(r.parkId);
    var label = cat.icon + ' ' + cat.label + ' \u2014 ' + (park ? park.name : 'Unknown area') +
      (r.priority ? ' (' + r.priority + ')' : '');
    frOverlay.addLayer(L.circleMarker([r.lat, r.lon], {
      radius: 7, color: '#0d1008', weight: 1.5,
      fillColor: PRI_FILL[r.priority] || '#8a8a7a', fillOpacity: 0.95
    }).bindTooltip(label));
  });
  document.getElementById('map-counts').textContent =
    nParks + ' areas with coordinates \u00b7 ' + n + ' reports with GPS';
}

/* Crosshair locate, Opossum Foot concept: tap to locate, tap again to
 * follow, tap again to stop. Dragging the map also stops follow — the
 * user has taken the wheel. Works on both the Leaflet map and the
 * offline SVG fallback. */
var frLocateState = 'idle'; /* idle | acquiring | following */
var frLocateWatch = null, frLocateTimer = null, frFollowLastPan = 0;
var frLastFix = null; /* { lat, lon, at } — a fresh fix under ~2 min old */

function frClearLocateWatch() {
  if (frLocateWatch !== null) { try { navigator.geolocation.clearWatch(frLocateWatch); } catch (e) {} frLocateWatch = null; }
  if (frLocateTimer) { clearTimeout(frLocateTimer); frLocateTimer = null; }
}

function frLocateButton() { return document.getElementById('map-locate'); }

/* Dragging the live map breaks follow mode. */
function hookFrFollowDrag() {
  if (frMap && !frMap._frFollowDragHooked) {
    frMap._frFollowDragHooked = true;
    frMap.on('dragstart', function () { if (frLocateState === 'following') frStopFollow(true); });
  }
}

function frStopFollow(silent) {
  frClearLocateWatch();
  frLocateState = 'idle';
  var b = frLocateButton(); if (b) b.classList.remove('active-mode');
  frLastFix = null; /* next tap takes a fresh fix, not follow */
  if (!silent) toast('Follow off.');
}

/* Draw the blue "you" dot on whichever map is showing. */
function frDrawYou(lat, lon) {
  if (typeof L !== 'undefined' && frMap) {
    var ll = [lat, lon];
    if (frYouDot) frYouDot.setLatLng(ll);
    else {
      frYouDot = L.circleMarker(ll, {
        radius: 8, color: '#ffffff', weight: 2.5, fillColor: '#2f7fe0', fillOpacity: 1
      }).bindTooltip('You are here');
      frYouDot.addTo(frMap);
    }
  } else {
    MapNav.you = { lat: lat, lon: lon };
    mapDrawYou();
  }
}

/* One fresh fix from the follow-mode watch: move the dot, glide the map. */
function frOnFollowFix(pos) {
  var c = pos.coords || {};
  if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return;
  var ageMs = Date.now() - (pos.timestamp || 0);
  if (ageMs > 30000 || ageMs < 0) return; /* stale cached fix — ignore it */
  frDrawYou(c.latitude, c.longitude);
  var now = Date.now();
  if (typeof L !== 'undefined' && frMap) {
    if (now - frFollowLastPan > 1500) { frFollowLastPan = now; frMap.panTo([c.latitude, c.longitude], { animate: true }); }
  } else if (MapNav.project) {
    if (now - frFollowLastPan > 1500) {
      frFollowLastPan = now;
      var p = MapNav.project(c.longitude, c.latitude);
      MapNav.tx = MapNav.W / 2 - p[0] * MapNav.k;
      MapNav.ty = MapNav.H / 2 - p[1] * MapNav.k;
      mapApply();
    }
  }
}

/* Acquisition: watch the GPS for up to 20 seconds, throw away stale cached
   fixes (a phone will happily hand back the last fix from somewhere you
   used to be), and settle on the most accurate fresh fix. */
function frStartAcquire() {
  frLocateState = 'acquiring';
  var best = null, finished = false;
  toast('Acquiring GPS… hold still a moment.');
  hookFrFollowDrag();

  function consider(pos) {
    var c = pos.coords || {};
    if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return;
    var ageMs = Date.now() - (pos.timestamp || 0);
    if (ageMs > 30000 || ageMs < 0) return;
    var acc = (typeof c.accuracy === 'number' && isFinite(c.accuracy)) ? Math.round(c.accuracy) : 9999;
    if (!best || acc < best.acc) {
      best = { lat: c.latitude, lon: c.longitude, acc: acc };
      frDrawYou(best.lat, best.lon);
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    frClearLocateWatch();
    frLocateState = 'idle';
    if (!best) { toast('No fresh GPS fix — move into open sky and try again.'); return; }
    frDrawYou(best.lat, best.lon);
    if (typeof L !== 'undefined' && frMap) {
      frMap.setView([best.lat, best.lon], Math.max(frMap.getZoom(), 14));
    } else if (MapNav.project) {
      var p = MapNav.project(best.lon, best.lat);
      var k2 = Math.max(MapNav.k, 3.5);
      MapNav.k = k2;
      MapNav.tx = MapNav.W / 2 - p[0] * k2;
      MapNav.ty = MapNav.H / 2 - p[1] * k2;
      mapApply();
    }
    frLastFix = { lat: best.lat, lon: best.lon, at: Date.now() };
    toast('Located (±' + best.acc + ' m). Tap the crosshair again to follow.');
  }

  frLocateTimer = setTimeout(finish, 20000);
  try {
    frLocateWatch = navigator.geolocation.watchPosition(function (pos) {
      consider(pos);
      if (best && best.acc <= 8) finish(); /* good enough — stop early */
    }, function () {
      if (!best && !finished) {
        finished = true; frClearLocateWatch(); frLocateState = 'idle';
        toast('Could not get a GPS fix. Check location permission.');
      }
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  } catch (e) { finish(); }
}

function frStartFollow() {
  hookFrFollowDrag();
  frLocateState = 'following';
  var b = frLocateButton(); if (b) b.classList.add('active-mode');
  frFollowLastPan = 0;
  frClearLocateWatch();
  toast('Following you — tap the crosshair again to stop.');
  try {
    frLocateWatch = navigator.geolocation.watchPosition(frOnFollowFix, function () {
      if (frLocateState === 'following') { frStopFollow(true); toast('Lost GPS signal.'); }
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  } catch (e) { frStopFollow(true); }
}

function mapLocateMe() {
  if (!('geolocation' in navigator)) { toast('Location is not available on this device.'); return; }
  if (typeof L === 'undefined' || !frMap) { svgLocateMe(); return; }
  if (frLocateState === 'following') { frStopFollow(); return; }
  if (frLocateState === 'acquiring') {
    frClearLocateWatch(); frLocateState = 'idle'; toast('Cancelled.'); return;
  }
  if (frLastFix && (Date.now() - frLastFix.at < 120000)) { frStartFollow(); return; }
  frStartAcquire();
}

/* ---------- offline fallback: the original OrgMap SVG sketch ----------
 * Used only when the Leaflet CDN fails to load. Pinch/drag/double-tap
 * gestures still work; the +/\u2212 buttons are Leaflet's job in the live map. */
function renderSvgMap() {
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
  var f = OrgMap.frame(org, { parks: parks, reports: reports });
  MapNav.project = f.project; MapNav.W = f.W; MapNav.H = f.H;
  if (MapNav.orgId !== org.id) { // new org → reset to full view
    MapNav.orgId = org.id; MapNav.k = 1; MapNav.tx = 0; MapNav.ty = 0;
  }
  holder.innerHTML = f.svg;
  mapApply();
  mapDrawYou();
  mapBindGestures();
  var n = reports.filter(function (r) { return r.lat != null; }).length;
  document.getElementById('map-counts').textContent =
    parks.length + ' areas with coordinates · ' + n + ' reports with GPS';
}

/* ----- offline fallback: SVG sketch gestures (Leaflet failed to load) -----
 * Pinch to zoom, drag to pan, double-tap to zoom in; +/− buttons and the
 * crosshair button work the same. The "you" dot is plotted in map coordinates
 * so it rides along with pan/zoom, Opossum Foot style. */
var MapNav = { k: 1, tx: 0, ty: 0, project: null, W: 720, H: 460, orgId: null, you: null };
function mapZoomLayer() {
  return document.querySelector('#map-holder #map-zoomlayer');
}
function mapApply() {
  var g = mapZoomLayer();
  if (g) g.setAttribute('transform',
    'translate(' + MapNav.tx.toFixed(1) + ' ' + MapNav.ty.toFixed(1) + ') scale(' + MapNav.k.toFixed(3) + ')');
}
function mapZoomAt(k2, cx, cy) {
  k2 = Math.max(1, Math.min(10, k2));
  var r = k2 / MapNav.k;
  MapNav.tx = cx - (cx - MapNav.tx) * r;
  MapNav.ty = cy - (cy - MapNav.ty) * r;
  MapNav.k = k2;
  mapApply();
}
function mapDrawYou() {
  var old = document.getElementById('map-you-dot');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (!MapNav.you || !MapNav.project) return;
  var g = mapZoomLayer();
  if (!g) return;
  var p = MapNav.project(MapNav.you.lon, MapNav.you.lat);
  var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('id', 'map-you-dot');
  c.setAttribute('cx', p[0].toFixed(1));
  c.setAttribute('cy', p[1].toFixed(1));
  c.setAttribute('r', '8');
  c.setAttribute('class', 'map-you');
  g.appendChild(c);
}
function svgLocateMe() {
  if (!('geolocation' in navigator)) { toast('Location is not available on this device.'); return; }
  if (!MapNav.project) { toast('Open the Map tab first.'); return; }
  if (frLocateState === 'following') { frStopFollow(); return; }
  if (frLocateState === 'acquiring') {
    frClearLocateWatch(); frLocateState = 'idle'; toast('Cancelled.'); return;
  }
  if (frLastFix && (Date.now() - frLastFix.at < 120000)) { frStartFollow(); return; }
  frStartAcquire();
}
function mapBindGestures() {
  var holder = document.getElementById('map-holder');
  var svg = holder ? holder.querySelector('svg') : null;
  if (!svg || svg._mapBound) return;
  svg._mapBound = true;
  var pts = {};            /* pointerId -> {x,y} in svg coords */
  var pinchD0 = 0, pinchK0 = 1, pinchCx = 0, pinchCy = 0;
  var lastTap = 0;
  function toSvg(e) {
    var r = svg.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (MapNav.W / r.width),
      y: (e.clientY - r.top) * (MapNav.H / r.height)
    };
  }
  svg.addEventListener('pointerdown', function (e) {
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    var start = toSvg(e);
    pts[e.pointerId] = start;
    e._svgStart = start; /* drag threshold start, per pointer */
    svg['_down_' + e.pointerId] = start;
    var ids = Object.keys(pts);
    if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]];
      pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
      pinchK0 = MapNav.k;
      pinchCx = (a.x + b.x) / 2; pinchCy = (a.y + b.y) / 2;
    }
    var now = Date.now();
    if (ids.length === 1 && now - lastTap < 300) {
      mapZoomAt(MapNav.k * 2, pts[e.pointerId].x, pts[e.pointerId].y);
      lastTap = 0;
    } else if (ids.length === 1) { lastTap = now; }
  });
  svg.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    var p = toSvg(e);
    var ids = Object.keys(pts);
    if (ids.length === 1) {
      var q = pts[e.pointerId];
      /* dragging the map breaks follow mode — the user has taken the wheel */
      if (frLocateState === 'following') {
        var down = svg['_down_' + e.pointerId];
        if (down && Math.hypot(p.x - down.x, p.y - down.y) > 10) frStopFollow(true);
      }
      MapNav.tx += (p.x - q.x);
      MapNav.ty += (p.y - q.y);
      mapApply();
    }
    pts[e.pointerId] = p;
    if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD0 > 0 && d > 0) mapZoomAt(pinchK0 * d / pinchD0, pinchCx, pinchCy);
    }
  });
  function endPt(e) { delete pts[e.pointerId]; delete svg['_down_' + e.pointerId]; pinchD0 = 0; }
  svg.addEventListener('pointerup', endPt);
  svg.addEventListener('pointercancel', endPt);
}

/* ---------- report view ---------- */
function renderCategoryGrid() {
  var grid = document.getElementById('category-grid');
  grid.innerHTML = '';
  CATEGORIES.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'cat-btn';
    b.innerHTML = '<span class="cat-icon">' + catIcon(c) + '</span><span>' + esc(c.label) + '</span>';
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
      : '<span class="report-thumb">' + catIcon(cat, 'thumb-sil') + '</span>';
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
    if (Array.isArray(r.costing.labor)) {
      r.costing.labor.forEach(function (l) {
        var cw = crewById(l.crewId);
        var w = wageFor(l.crewId);
        var hrs = parseFloat(l.hours) || 0;
        h += '<div class="cost-total" style="font-weight:400;font-size:14px"><span>' +
             esc(cw ? cw.name : 'Former staff') + ' — ' + l.hours + 'h × ' + fmtMoney(w) +
             '</span><span>' + fmtMoney(hrs * w) + '</span></div>';
      });
    }
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
    if (!c) problems.push('Fill in the job costing (labor, at least) before marking fixed.');
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
/* Per-person labor rows when the admin has set up crew wages and the record
 * isn't a legacy single-number labor record; otherwise the old single field. */
function costingUsesCrewLines(c) {
  if (Array.isArray(c.labor)) return true;
  var fresh = (c.laborHours === '' || c.laborHours == null);
  return fresh && DB.crew.length > 0;
}
function costingFormHTML(r) {
  var c = detailCosting || r.costing || { laborHours: '', equipment: [], materials: '' };
  if (!detailCosting) detailCosting = JSON.parse(JSON.stringify(c));
  var h = '';
  if (costingUsesCrewLines(detailCosting)) {
    h += '<label class="field-label">Who worked — hours each</label><div id="c-labor-rows">';
    var seenCrew = {};
    DB.crew.forEach(function (p) {
      seenCrew[p.id] = true;
      var line = (detailCosting.labor || []).filter(function (l) { return l.crewId === p.id; })[0];
      h += '<div class="cost-row">' +
        '<span class="nm">' + esc(p.name) + '<br><span class="rate-note">' + fmtMoney(p.wage) + '/hr</span></span>' +
        '<input type="number" class="c-lab-hrs" data-crew="' + p.id + '" min="0" step="0.25" inputmode="decimal" placeholder="hrs" value="' + esc(line ? line.hours : '') + '">' +
        '<span class="c-lab-line"></span></div>';
    });
    /* Orphan lines: hours logged for someone since removed from the crew —
     * keep them editable so re-saving the form never drops real hours. */
    (detailCosting.labor || []).forEach(function (l) {
      if (!seenCrew[l.crewId]) {
        h += '<div class="cost-row">' +
          '<span class="nm">Former staff<br><span class="rate-note">' + fmtMoney(wageFor(l.crewId)) + '/hr (generic)</span></span>' +
          '<input type="number" class="c-lab-hrs" data-crew="' + esc(l.crewId) + '" min="0" step="0.25" inputmode="decimal" placeholder="hrs" value="' + esc(l.hours) + '">' +
          '<span class="c-lab-line"></span></div>';
      }
    });
    h += '</div>';
  } else {
    h += '<label class="field-label" for="c-labor">Labor hours</label>';
    h += '<input type="number" id="c-labor" min="0" step="0.25" inputmode="decimal" value="' + esc(detailCosting.laborHours) + '" placeholder="0">';
  }
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
  document.getElementById('detail-body').querySelectorAll('.c-eq-id, .c-eq-hrs, .c-lab-hrs').forEach(function (el) {
    el.addEventListener('input', updateCostPreview);
  });
  updateCostPreview();
}
function updateCostPreview() {
  var c = readCostingForm();
  var prev = document.getElementById('c-preview');
  if (!c || !prev) return;
  /* per-person line totals */
  var rows = document.getElementById('c-labor-rows');
  if (rows) rows.querySelectorAll('.c-lab-hrs').forEach(function (inp) {
    var val = inp.parentElement.querySelector('.c-lab-line');
    var hrs = parseFloat(inp.value) || 0;
    if (val) val.textContent = hrs ? fmtMoney(hrs * wageFor(inp.getAttribute('data-crew'))) : '';
  });
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
  var matEl = document.getElementById('c-mat');
  if (!matEl) return null;
  var mat = parseFloat(matEl.value);
  var equipment = [];
  var eqRows = document.getElementById('c-eq-rows');
  if (eqRows) eqRows.querySelectorAll('.cost-row').forEach(function (row) {
    equipment.push({
      rateId: row.querySelector('.c-eq-id').value,
      hours: parseFloat(row.querySelector('.c-eq-hrs').value) || 0
    });
  });
  var out = { equipment: equipment, materials: isNaN(mat) ? 0 : mat };
  var laborRows = document.getElementById('c-labor-rows');
  if (laborRows) {
    /* per-person labor */
    var lines = [], anyEntered = false;
    laborRows.querySelectorAll('.c-lab-hrs').forEach(function (inp) {
      if (inp.value !== '') anyEntered = true;
      lines.push({ crewId: inp.getAttribute('data-crew'), hours: parseFloat(inp.value) || 0 });
    });
    // Require at least some recorded effort: somebody's hours, equipment, or materials
    if (!anyEntered && !equipment.length && matEl.value === '') return null;
    out.labor = lines;
    return out;
  }
  var laborEl = document.getElementById('c-labor');
  if (!laborEl) return null;
  var labor = parseFloat(laborEl.value);
  // Require at least some recorded effort: labor hours entered (0 allowed explicitly)
  if (laborEl.value === '' && !equipment.length && (document.getElementById('c-mat').value === '')) return null;
  out.laborHours = isNaN(labor) ? 0 : labor;
  return out;
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
  /* Cost to the county, person by person, across the filtered jobs. */
  var agg = {};
  jobs.forEach(function (r) {
    (r.costing.labor || []).forEach(function (l) {
      var cw = crewById(l.crewId);
      var key = l.crewId || 'former';
      if (!agg[key]) agg[key] = { name: cw ? cw.name : 'Former staff', hours: 0, cost: 0 };
      var hrs = parseFloat(l.hours) || 0;
      agg[key].hours += hrs;
      agg[key].cost += hrs * wageFor(l.crewId);
    });
  });
  var crewEl = document.getElementById('savings-crew');
  var keys = Object.keys(agg);
  if (keys.length) {
    var ct = '<div class="card"><h3 style="margin:0 0 4px;font-size:16px">Cost to the county by person</h3>';
    keys.sort(function (a, b) { return agg[b].cost - agg[a].cost; }).forEach(function (k) {
      ct += '<div class="cost-total" style="font-size:14px"><span>' + esc(agg[k].name) +
            ' — ' + agg[k].hours + 'h</span><span>' + fmtMoney(agg[k].cost) + '</span></div>';
    });
    ct += '</div>';
    crewEl.innerHTML = ct;
  } else {
    crewEl.innerHTML = '';
  }
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
               'Labor hours', 'Labor by person', 'Equipment', 'Materials $', 'Industry value $', 'In-house cost $', 'Savings $']];
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
      laborHoursOf(r.costing), laborDesc(r.costing), eq, r.costing.materials,
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
    row.innerHTML = '<span class="nm">' + esc(p.name) + (p.approx ? ' <span class="rate-note">(approx.)</span>' : '') + '</span>' +
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

  /* crew wages — the admin wage list */
  var cl = document.getElementById('crew-list');
  cl.innerHTML = '';
  if (!DB.crew.length) {
    cl.innerHTML = '<p class="hint" style="margin:4px 0">No crew yet. Add people below and the costing sheet will split labor hours per person.</p>';
  }
  DB.crew.forEach(function (p) {
    var row = document.createElement('div');
    row.className = 'rate-row';
    row.innerHTML = '<span class="nm">' + esc(p.name) + '</span>' +
      '<span class="nums">$<input type="number" data-crew="' + p.id + '" value="' + p.wage + '" step="any" min="0" aria-label="Wage for ' + esc(p.name) + '"> ' +
      '<button class="btn small danger" data-crew-del="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">✕</button></span>';
    cl.appendChild(row);
  });
  cl.querySelectorAll('input').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      var id = inp.getAttribute('data-crew');
      var p0 = crewById(id);
      if (isNaN(v) || v < 0) { inp.value = p0 ? p0.wage : ''; return; }
      Store.mutate(function (db) {
        db.crew.forEach(function (x) { if (x.id === id) x.wage = v; });
      });
      toast('Wage saved — every job they worked re-values at it.');
    });
  });
  cl.querySelectorAll('[data-crew-del]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-crew-del');
      var p = crewById(id);
      if (!confirm('Remove ' + (p ? p.name : 'this person') + ' from the crew list? Their past hours keep counting at the generic labor rate.')) return;
      Store.mutate(function (db) {
        db.crew = db.crew.filter(function (x) { return x.id !== id; });
      });
      renderMore();
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

  /* map: find-me control (Leaflet supplies its own +/− zoom) */
  document.getElementById('map-locate').addEventListener('click', mapLocateMe);

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

  /* more: add crew member */
  document.getElementById('btn-add-crew').addEventListener('click', function () {
    var name = document.getElementById('new-crew-name').value.trim();
    var wage = parseFloat(document.getElementById('new-crew-wage').value);
    if (!name) { toast('⚠️ Give the person a name first.'); return; }
    if (isNaN(wage) || wage < 0) { toast('⚠️ Enter their loaded hourly cost.'); return; }
    Store.mutate(function (db) {
      db.crew.push({ id: uid(), name: name, wage: wage });
    });
    document.getElementById('new-crew-name').value = '';
    document.getElementById('new-crew-wage').value = '';
    renderMore();
    toast(name + ' added at ' + fmtMoney(wage) + '/hr.');
  });

  /* more: reset demo / wipe */
  document.getElementById('btn-reset-demo').addEventListener('click', function () {
    if (!confirm('Reset demo data? Your real reports stay; the fictional demo reports are replaced.')) return;
    Store.mutate(function (db) {
      var keepReports = db.reports.filter(function (r) { return !r.demo; });
      var keepParks = db.parks, keepRates = db.rates, keepName = db.staffName, keepCrew = db.crew;
      seedDemo();
      db.reports = db.reports.concat(keepReports);
      db.parks = keepParks;
      db.rates = keepRates;
      db.staffName = keepName;
      db.crew = keepCrew;
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
