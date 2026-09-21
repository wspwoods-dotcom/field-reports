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
  { id: 'tree',    label: 'Tree',          icon: '🌳', img: 'assets/cats/tree.png',
    tools: ['Chainsaw', 'Fuel mix', 'Bar oil', 'Wedges', 'Rope', 'Loppers', 'Work gloves'] },
  { id: 'pothole', label: 'Pothole',       icon: '🕳️', img: 'assets/cats/pothole.png',
    tools: ['Cold patch', 'Tamper', 'Shovel', 'Broom'] },
  { id: 'trail',   label: 'Trail',         icon: '🥾', img: 'assets/cats/trail.png',
    tools: ['Loppers', 'Hand saw', 'Rake', 'Weed eater'] },
  { id: 'facility',label: 'Facility',      icon: '🏠', img: 'assets/cats/facility.png',
    tools: ['Tool kit', 'Drill', 'Ladder', 'Cleaning supplies'] },
  { id: 'sign',    label: 'Sign',          icon: '🪧', img: 'assets/cats/sign.png',
    tools: ['Post driver', 'Drill', 'Level', 'Concrete mix', 'Bolts'] },
  { id: 'trash',   label: 'Trash',         icon: '🗑️', img: 'assets/cats/trash.png',
    tools: ['Trash bags', 'Gloves', 'Grabber'] },
  { id: 'water',   label: 'Water',         icon: '💧', img: 'assets/cats/water.png',
    tools: ['Shovel', 'Waders', 'Pump', 'Culvert pipe'] },
  { id: 'animal',  label: 'Animal rescue', icon: '🦌', img: 'assets/cats/animal.png',
    tools: ['Catch pole', 'Live trap', 'Gloves', 'Carrier'] },
  /* 2026-09-20: five more from Tanner's research ask — parks + cemetery coverage.
   * 2026-09-21: Tanner swapped Lighting out for Storm damage; added Cleaning. */
  { id: 'vandalism', label: 'Vandalism',   icon: '🖌️', img: 'assets/cats/vandalism.png',
    tools: ['Paint & primer', 'Roller & brushes', 'Scraper', 'Graffiti remover'] },
  { id: 'mowing',  label: 'Mowing',        icon: '🌱', img: 'assets/cats/mowing.png',
    tools: ['Mower', 'Fuel', 'String trimmer', 'Blower'] },
  { id: 'storm',   label: 'Storm damage',  icon: '⛈️', img: 'assets/cats/storm.png',
    tools: ['Chainsaw', 'Fuel mix', 'Bar oil', 'Loppers', 'Rake', 'Work gloves'] },
  { id: 'fence',   label: 'Fence',         icon: '🧱', img: 'assets/cats/fence.png',
    tools: ['Post driver', 'Posts', 'Concrete mix', 'Level'] },
  { id: 'headstone', label: 'Headstone',   icon: '🪦', img: 'assets/cats/headstone.png',
    tools: ['Shovel', 'Gravel', 'Level', 'Lift straps', 'Stone epoxy'] },
  { id: 'cleaning', label: 'Facility cleaning', icon: '🧹', img: 'assets/cats/cleaning.png',
    tools: ['Cleaning supplies', 'Disinfectant', 'Trash bags', 'Mop & bucket', 'Paper products', 'Gloves'] },
  { id: 'other',   label: 'Other',         icon: '📋', img: 'assets/cats/other.png',
    tools: [] }
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

/* Traffic-light tiers (Tanner 2026-09-20): green / yellow / red. */
var PRIORITIES = {
  low:    { label: 'Low',    cls: 'low' },
  medium: { label: 'Medium', cls: 'medium' },
  high:   { label: 'High',   cls: 'high' }
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
  { id: 'p-mcmahon',    name: 'McMahon Access',                     lat: 42.03832,  lon: -94.47955 },
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
/* Per-org category toggles (Tanner 2026-09-20): More -> Issue categories.
 * DB.catOff = { orgId: [disabledIds] }. Absence means enabled — new
 * categories and old installs default to on. Only gates the Report tab;
 * existing reports for a disabled category stay visible everywhere. */
function catEnabled(id) {
  var off = (DB.catOff && DB.catOff[DB.orgId]) || [];
  return off.indexOf(id) === -1;
}
function setCatEnabled(id, on) {
  Store.mutate(function (db) {
    if (!db.catOff || typeof db.catOff !== 'object') db.catOff = {};
    var off = db.catOff[db.orgId] || (db.catOff[db.orgId] = []);
    var i = off.indexOf(id);
    if (on && i !== -1) off.splice(i, 1);
    if (!on && i === -1) off.push(id);
  });
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
    /* 2026-09-20: per-org category toggles — older DBs lack the map. */
    if (!DB.catOff || typeof DB.catOff !== 'object') DB.catOff = {};
    /* 2026-09-21: incident/FEMA mode — older DBs lack these tables. */
    if (!Array.isArray(DB.incidents)) DB.incidents = [];
    if (!Array.isArray(DB.incidentLogs)) DB.incidentLogs = [];
    if (DB.activeIncidentId === undefined) DB.activeIncidentId = '';
    if (Array.isArray(DB.reports)) {
      DB.reports.forEach(function (r) { if (r.incidentId === undefined) r.incidentId = ''; });
    }
    /* 2026-09-21: PM scheduling — older DBs lack the schedule table. */
    if (!Array.isArray(DB.schedules)) DB.schedules = [];
    if (DB.pmLastRun === undefined) DB.pmLastRun = '';
    /* 2026-09-20: priorities renamed routine/high/critical -> low/medium/high.
     * Map legacy values so existing reports keep their rank — never drop one. */
    var PRI_LEGACY = { routine: 'low', high: 'medium', critical: 'high' };
    if (Array.isArray(DB.reports)) {
      DB.reports.forEach(function (r) {
        if (PRI_LEGACY[r.priority]) r.priority = PRI_LEGACY[r.priority];
      });
    }
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
      crewUrgent: true, priority: 'high', createdAt: now - 2 * H }),
    mk({ category: 'pothole', reporter: 'Sam T. (demo crew)',
      note: 'Pothole opening up at the main entrance, about two feet across and getting bigger with rain.',
      parkId: 'p-spring', lat: 42.0680, lon: -94.2950,
      priority: 'medium', status: 'assigned', assignee: 'Sam T. (demo crew)',
      dueDate: isoTodayPlus(3), createdAt: now - 1 * D }),
    mk({ category: 'sign', reporter: 'Alex R. (demo crew)',
      note: 'Trailhead sign bent over at the base. Posts look solid — probably straighten and re-set.',
      parkId: 'p-rrvt', lat: 41.9353, lon: -94.3432,
      priority: 'low', status: 'triaged', createdAt: now - 2 * D }),
    mk({ category: 'trash', reporter: 'Sam T. (demo crew)',
      note: 'Trash overflowing at the shelter after Saturday rentals. Extra pickup needed.',
      parkId: 'p-squirrel', lat: 41.9516, lon: -94.2908,
      priority: 'low', status: 'fixed', assignee: 'Sam T. (demo crew)',
      createdAt: now - 3 * D,
      costing: { laborHours: 1.5, equipment: [], materials: 12, closedAt: now - 1 * D } }),
    mk({ category: 'water', reporter: 'Alex R. (demo crew)',
      note: 'Culvert cleared after the rain. Water flowing, ditch re-graded with the tractor.',
      parkId: 'p-seven', lat: 42.0100, lon: -94.3800,
      priority: 'medium', status: 'verified', assignee: 'Alex R. (demo crew)',
      dueDate: isoTodayPlus(-1), createdAt: now - 5 * D,
      costing: { laborHours: 3, equipment: [{ rateId: 'tractor', hours: 1.5 }], materials: 45, closedAt: now - 2 * D } })
  ];
  DB.parks = JSON.parse(JSON.stringify(DEFAULT_PARKS));
  DB.rates = JSON.parse(JSON.stringify(DEFAULT_RATES));
  /* PM demo schedules — all OFF, so a fresh install shows the feature in
   * More without birthing anything into a real crew's queue. Follow the
   * demo-report convention: demo:true, fictional everything. */
  DB.schedules = [
    { id: uid(), title: 'Mow campground loop', category: 'mowing',
      parkId: 'p-trailside', recurrence: 'weekly', intervalDays: 7,
      priority: 'low', assignee: '', notes: 'Demo schedule — switched off.',
      enabled: false, demo: true, lastRunAt: null, nextDue: null },
    { id: uid(), title: 'Inspect playground equipment', category: 'facility',
      parkId: 'p-squirrel', recurrence: 'monthly', intervalDays: 30,
      priority: 'medium', assignee: '', notes: 'Demo schedule — switched off.',
      enabled: false, demo: true, lastRunAt: null, nextDue: null },
    { id: uid(), title: 'Winterize drinking fountains', category: 'facility',
      parkId: 'p-spring', recurrence: 'seasonal', intervalDays: 90,
      priority: 'low', assignee: '', notes: 'Demo schedule — switched off.',
      enabled: false, demo: true, lastRunAt: null, nextDue: null }
  ];
}

/* ---------- preventive maintenance (PM) scheduling ----------
 * Tanner 2026-09-21: recurring work ("mow Kelso weekly", "inspect the
 * playground monthly") should birth its own work orders when due, landing
 * in triage like any other report. Offline-first and localStorage-only:
 * the scheduler runs on app load and whenever the app becomes visible on
 * a new day. No backend, no accounts, no network calls.
 *
 * DB.schedules[] entry:
 *   { id, title, category, parkId, recurrence, intervalDays, priority,
 *     assignee, notes, enabled, demo, lastRunAt, nextDue }
 * A generated report carries source:'pm' and scheduleId, status 'reported',
 * and behaves like a normal report afterward (triage, assign, cost, verify).
 * One open instance per schedule at a time — the scheduler never creates
 * a second while the first is still unverified, so it can never duplicate.
 */
var PM_RECURRENCE = [
  { id: 'weekly',   label: 'Weekly',              days: 7 },
  { id: 'biweekly', label: 'Every 2 weeks',       days: 14 },
  { id: 'monthly',  label: 'Monthly',             days: 30 },
  { id: 'seasonal', label: 'Seasonal (3 months)', days: 90 },
  { id: 'yearly',   label: 'Yearly',              days: 365 },
  { id: 'custom',   label: 'Custom…',             days: 0 }
];
function pmPresetById(id) {
  for (var i = 0; i < PM_RECURRENCE.length; i++) if (PM_RECURRENCE[i].id === id) return PM_RECURRENCE[i];
  return null;
}
/* Add whole days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
function isoAddDays(iso, days) {
  var d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function todayISO() { return isoTodayPlus(0); }
function recurrenceLabel(s) {
  var p = pmPresetById(s.recurrence);
  if (p && p.id !== 'custom' && p.days === s.intervalDays) return p.label;
  return 'Every ' + s.intervalDays + ' day' + (s.intervalDays === 1 ? '' : 's');
}
function schedById(id) {
  if (!Array.isArray(DB.schedules)) return null;
  for (var i = 0; i < DB.schedules.length; i++) if (DB.schedules[i].id === id) return DB.schedules[i];
  return null;
}
/* Open (not yet verified closed) instance for a schedule — at most one. */
function pmOpenInstance(scheduleId) {
  for (var i = 0; i < DB.reports.length; i++) {
    var r = DB.reports[i];
    if (r.scheduleId === scheduleId && r.status !== 'verified') return r;
  }
  return null;
}
/* Normalize one schedule record (older installs / hand edits). */
function pmNormalize(s) {
  if (s.intervalDays == null || !(s.intervalDays > 0)) {
    var p = pmPresetById(s.recurrence);
    s.intervalDays = (p && p.days) || 30;
    if (!s.recurrence || s.recurrence === 'custom') s.recurrence = p ? p.id : 'monthly';
  }
  s.intervalDays = Math.max(1, Math.round(s.intervalDays));
  if (!PRIORITIES[s.priority]) s.priority = 'low';
  s.enabled = s.enabled !== false;
  s.demo = !!s.demo;
  s.assignee = s.assignee || '';
  s.notes = s.notes || '';
  return s;
}
/* Build the work order a schedule births. Mirrors sendReport()'s shape so
 * PM reports triage, cost, and verify exactly like field reports. */
function pmBuildReport(s) {
  var cat = catById(s.category);
  var park = parkById(s.parkId);
  var due = s.nextDue || todayISO();
  return {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reporter: DB.staffName || 'Crew member',
    category: s.category,
    note: '🔁 Scheduled ' + recurrenceLabel(s).toLowerCase() + ': ' + s.title +
          (s.notes ? ' — ' + s.notes : ''),
    parkId: s.parkId,
    lat: park ? park.lat : null,
    lon: park ? park.lon : null,
    gpsAccuracy: null,
    photo: null,
    crewUrgent: s.priority === 'high',
    priority: s.priority,
    tools: (cat.tools || []).slice(),
    status: 'reported',
    assignee: s.assignee || '',
    dueDate: due,
    costing: null,
    incidentId: '', /* scheduled upkeep is never incident work — never auto-tag */
    syncState: 'local',
    demo: !!s.demo,
    source: 'pm',
    scheduleId: s.id
  };
}
/* The scheduler. Idempotent: due-date arithmetic plus the one-open-instance
 * rule mean repeated runs can never duplicate. Runs on app load and when
 * the app becomes visible on a new day (the offline-first "daily"). */
function runPmScheduler() {
  if (!Array.isArray(DB.schedules)) DB.schedules = [];
  var today = todayISO();
  var created = 0;
  DB.schedules.forEach(function (s) {
    pmNormalize(s);
    if (!s.enabled) return;
    if (!s.nextDue) {
      /* New schedule: first instance falls due one full interval out, so
       * creating a schedule never floods the queue the same day. */
      s.nextDue = isoAddDays(today, s.intervalDays);
      s.lastRunAt = Date.now();
      return;
    }
    if (s.nextDue > today) return;
    if (pmOpenInstance(s.id)) return; /* one open instance at a time */
    DB.reports.unshift(pmBuildReport(s));
    s.nextDue = isoAddDays(today, s.intervalDays);
    s.lastRunAt = Date.now();
    created++;
  });
  DB.pmLastRun = today;
  Store.save();
  Sync.enqueueDirty();
  return created;
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
var currentView = 'view-map';
function showView(id) {
  currentView = id;
  document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== id; });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('active', t.getAttribute('data-view') === id);
  });
  if (id === 'view-board') renderBoard();
  if (id === 'view-map') renderMap();
  if (id === 'view-savings') renderSavings();
  if (id === 'view-incident') renderIncident();
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
  /* emergency SOS: visible only when the org has a number configured */
  var sos = document.getElementById('sos-btn');
  if (sos) sos.hidden = !(org.emergency && org.emergency.phone);
  /* incident/FEMA mode is org-toggleable — hide the tab when the org lacks it */
  var itab = document.querySelector('.tab[data-view="view-incident"]');
  if (itab) itab.hidden = !org.incidentModule;
  if (currentView === 'view-incident' && !org.incidentModule) showView('view-map');
}

/* ---------- emergency SOS ----------
 * Tanner 2026-09-20: guarded — tapping SOS opens a confirm sheet, never dials
 * directly, and the iPhone's own "Call?" prompt is a second guard. The 911 row
 * appears when the org sets emergency.show911 ("eventually 911"). */
function openSosSheet() {
  var org = currentOrg();
  var em = org.emergency || {};
  if (!em.phone) { toast('Emergency number is not set yet.'); return; }
  var digits = String(em.phone).replace(/[^\d+]/g, '');
  var ov = document.createElement('div');
  ov.className = 'sheet-backdrop';
  ov.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true">' +
    '<div class="sheet-handle"></div>' +
    '<h2>🚨 Emergency call</h2>' +
    '<p class="hint">This dials <b>' + esc(em.name || 'the ranger') + '</b> directly. Law-enforcement emergencies only.</p>' +
    '<a class="btn danger sos-call" href="tel:' + esc(digits) + '">📞 Call ' + esc(em.name || 'now') + '</a>' +
    (em.show911 ? '<a class="btn danger sos-call" href="tel:911">📞 Call 911</a>' : '') +
    '<button class="btn" id="sos-cancel" style="width:100%">Cancel</button></div>';
  document.body.appendChild(ov);
  var close = function () { ov.remove(); };
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  document.getElementById('sos-cancel').addEventListener('click', close);
}

/* ---------- directions with dead-zone handling ----------
 * Tanner 2026-09-20: online, the button routes current location → the logged
 * spot as before. With no signal it prompts for a nearby start point first
 * (defaulting to the report's own park — that's typically where the crew is),
 * since Maps can't route from an unknown current location offline.
 * Park coordinates ride as saddr so no geocoding — and no signal — is needed. */
function openDirections(r) {
  var dest = r.lat.toFixed(6) + ',' + r.lon.toFixed(6);
  var go = function (start) {
    window.open('https://maps.apple.com/?daddr=' + dest +
      (start ? '&saddr=' + encodeURIComponent(start) : ''), '_blank');
  };
  var done = false;
  var finish = function (online) {
    if (done) return; done = true;
    if (online) go(null); else showOfflineStart(r, go);
  };
  if (navigator.onLine === false) { finish(false); return; }
  try {
    /* navigator.onLine lies on iOS; probe a tiny Apple endpoint instead.
     * Cross-origin, outside the service-worker scope — a resolve means real net. */
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 2500);
    fetch('https://www.apple.com/library/test/success.html', { mode: 'no-cors', signal: ctl.signal })
      .then(function () { clearTimeout(timer); finish(true); })
      .catch(function () { clearTimeout(timer); finish(false); });
  } catch (e) { finish(true); }
}

function showOfflineStart(r, go) {
  var park = parkById(r.parkId);
  var withCoords = DB.parks.filter(function (p) { return p.lat != null && p.lon != null; });
  var ov = document.createElement('div');
  ov.className = 'sheet-backdrop';
  ov.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true">' +
    '<div class="sheet-handle"></div>' +
    '<h2>📵 No signal detected</h2>' +
    '<p class="hint">Maps can\u2019t route from your current location offline. Start from a nearby spot instead — saved coordinates need no signal to look up.</p>' +
    (park && park.lat != null ?
      '<button class="btn primary" id="os-park" style="width:100%;margin:6px 0">📍 ' +
      esc(park.name) + ' (this report\u2019s area)</button>' : '') +
    '<label class="field-label" for="os-select">Another park / area</label>' +
    '<select id="os-select">' + withCoords.map(function (p) {
      return '<option value="' + p.lat.toFixed(6) + ',' + p.lon.toFixed(6) + '"' +
        (park && p.id === park.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('') + '</select>' +
    '<label class="field-label" for="os-text">Or type a nearby place</label>' +
    '<input type="text" id="os-text" placeholder="e.g. park office, Hwy 30" autocomplete="off">' +
    '<div class="btn-row" style="margin-top:14px">' +
    '<button class="btn primary" id="os-go">Get directions</button>' +
    '<button class="btn" id="os-cancel">Cancel</button></div></div>';
  document.body.appendChild(ov);
  var close = function () { ov.remove(); };
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  var pk = document.getElementById('os-park');
  if (pk) pk.addEventListener('click', function () {
    var s = park.lat.toFixed(6) + ',' + park.lon.toFixed(6); close(); go(s);
  });
  document.getElementById('os-go').addEventListener('click', function () {
    var t = document.getElementById('os-text').value.trim();
    close(); go(t || document.getElementById('os-select').value);
  });
  document.getElementById('os-cancel').addEventListener('click', close);
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

/* Tanner 2026-09-20: open at the full-county fit (he picked this exact extent
 * on 2026-09-20 from his iPhone screenshot — boundary near the frame edges). */
function frameCounty(org) {
  frMap.fitBounds(fieldMapBounds(org).pad(0.02));
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
  frMap.on('click', function (e) {
    if (frPinArmed && e && e.latlng) frStartPlacePin(e.latlng.lat, e.latlng.lng);
  });
  frameCounty(org);
  frMapOrg = org.id;
}

var PRI_FILL = { high: '#e05252', medium: '#f2c230', low: '#7fb069' };

/* Tanner 2026-09-21: area markers are icons, not dots — swing set for parks,
 * tree for wildlife areas, flower for prairies, boat ramp for accesses. The type is derived from the
 * name so areas Tanner adds later work too, with no stored field to migrate. */
var AREA_ICONS = {
  park: 'assets/cats/area-park.png',
  wildlife: 'assets/cats/area-wildlife.png',
  prairie: 'assets/cats/area-prairie.png',
  access: 'assets/cats/area-access.png'
};
function areaType(p) {
  var n = (p.name || '').toLowerCase();
  if (n.indexOf('access') !== -1) return 'access';
  if (n.indexOf('wildlife area') !== -1) return 'wildlife';
  if (n.indexOf('prairie') !== -1) return 'prairie';
  return 'park';
}

/* ---------- park parcel boundaries (Beacon/assessor, reference only) ----------
 * Tanner 2026-09-21: parcel outlines for parks managed by the department, baked
 * in as a static GeoJSON (assets/park-boundaries.geojson) so they render
 * offline. Beacon lines are assessment-grade, NOT a survey — every popup says
 * so, same stance as the TIGER/Line boundary overlays. If the file is missing
 * or the phone is offline on first load, the map simply renders without it. */
var parkBoundsGeo = null, parkBoundsLoading = false;

function parkParcelPopup(p) {
  var name = esc((p && p.name) || 'Park parcel');
  return '<b>' + name + '</b><br><span class="hint">Parcel lines approximate — ' +
    'assessment-grade, not a survey.</span>';
}

function loadParkBoundaries() {
  if (parkBoundsGeo || parkBoundsLoading || typeof fetch === 'undefined') return;
  parkBoundsLoading = true;
  fetch('assets/park-boundaries.geojson').then(function (resp) {
    if (!resp.ok) throw new Error('no parcel layer');
    return resp.json();
  }).then(function (gj) {
    if (gj && gj.features && gj.features.length) {
      parkBoundsGeo = gj;
      if (frMap) refreshFieldMap(currentOrg()); /* re-render with the new layer */
    }
  }).catch(function () { /* offline or not baked in yet — map works without it */ });
}

function addParkBoundaries() {
  if (!frOverlay || !parkBoundsGeo) return;
  frOverlay.addLayer(L.geoJSON(parkBoundsGeo, {
    style: { color: '#d19a2f', weight: 2, opacity: 0.9, dashArray: '5 4', fillColor: '#d19a2f', fillOpacity: 0.05 },
    onEachFeature: function (f, layer) { layer.bindPopup(parkParcelPopup(f.properties)); }
  }));
}

function refreshFieldMap(org) {
  if (!frMap || !frOverlay) return;
  if (frMapOrg !== org.id) { /* org changed -> reframe on its boundary */
    frMapOrg = org.id;
    frameCounty(org);
  }
  frOverlay.clearLayers();
  /* Greene County boundary outline (TIGER/Line 2025 - overlay only) */
  frOverlay.addLayer(L.geoJSON(org.boundary, {
    style: { color: '#d19a2f', weight: 2.5, opacity: 0.9, fillColor: '#d19a2f', fillOpacity: 0.06 }
  }));
  /* park parcel outlines (Beacon/assessor — assessment-grade, reference only) */
  loadParkBoundaries();
  addParkBoundaries();
  /* park area icons (Tanner 2026-09-21: icons replace the dots) */
  var nParks = 0;
  /* Tanner 2026-09-21: draw the actual Raccoon River Valley Trail line, gold
   * like the boundary, instead of only a representative dot. The p-rrvt park
   * record stays in the list (nearest-park still uses it); the line carries
   * its identity on the map so the dot would just double-label it. */
  var showTrail = (org.id === 'greene' && typeof RRVT_TRAIL !== 'undefined');
  if (showTrail) {
    RRVT_TRAIL.forEach(function (seg) {
      frOverlay.addLayer(L.polyline(seg, { color: '#d19a2f', weight: 4, opacity: 0.9 })
        .bindTooltip('Raccoon River Valley Trail'));
    });
  }
  DB.parks.forEach(function (p) {
    if (p.lat == null || p.lon == null) return;
    if (showTrail && p.id === 'p-rrvt') return;
    nParks++;
    /* Tanner 2026-09-21: cream glyphs wash out on the light street basemap, so
     * each area icon rides on a dark disc with a brass ring — readable on
     * both street and satellite. */
    var aIcon = L.divIcon({
      className: 'area-badge-wrap',
      html: '<span class="area-badge"><img src="' + AREA_ICONS[areaType(p)] + '" alt=""></span>',
      iconSize: [34, 34], iconAnchor: [17, 17]
    });
    frOverlay.addLayer(L.marker([p.lat, p.lon], { icon: aIcon })
      .bindTooltip(p.name + (p.approx ? ' (approximate location)' : '')));
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

/* ---------- drop-a-pin, Opossum Foot style ----------
 * Tap 📍, tap the map to drop the pin, then DRAG the pin onto the exact
 * spot — cold or dirty hands rarely land the first tap — then "Looks right".
 * The confirmed location rides on pendingPin into the next report sheet.
 * On the offline SVG fallback there is no drag: tapping the map while the
 * confirm bar is up repositions the pin. */
var frPinArmed = false;
var frPinMarker = null;  /* Leaflet placement marker (draggable) */
var frPlacing = false;   /* confirm bar up: pin dropped, not yet confirmed */
var pendingPin = null;   /* {lat, lon} — consumed by the next report sheet */

function frPinButton() { return document.getElementById('map-pin'); }
function frPinHint() { return document.getElementById('pin-hint'); }
function frPlaceBar() { return document.getElementById('place-bar'); }

function frSetPinArmed(on) {
  frPinArmed = on;
  if (on) frCancelPlace(); /* arming discards any unconfirmed pin */
  var b = frPinButton(); if (b) b.classList.toggle('active-mode', on);
  var h = frPinHint(); if (h) h.classList.toggle('show', on);
}

/* Drop the placement pin and show the confirm bar. */
function frStartPlacePin(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return;
  frSetPinArmed(false);
  frRemovePinMarker();
  pendingPin = null;
  if (typeof L !== 'undefined' && frMap) {
    frPinMarker = L.marker([lat, lon], {
      draggable: true,
      title: 'Drag me onto the exact spot',
      icon: L.divIcon({ className: 'fr-pin-div', html: '📍', iconSize: [30, 30], iconAnchor: [15, 28] })
    }).addTo(frMap);
    frMap.panTo([lat, lon]);
  } else {
    MapNav.pin = { lat: lat, lon: lon };
    mapDrawPin();
  }
  frPlacing = true;
  var bar = frPlaceBar(); if (bar) bar.classList.add('show');
}

/* "Looks right" — confirm the pin's current spot, head to the categories. */
function frConfirmPin() {
  var lat = null, lon = null;
  if (frPinMarker && frPinMarker.getLatLng) {
    var ll = frPinMarker.getLatLng(); lat = ll.lat; lon = ll.lng;
  } else if (MapNav.pin) { lat = MapNav.pin.lat; lon = MapNav.pin.lon; }
  if (lat == null || lon == null) return;
  pendingPin = { lat: lat, lon: lon };
  frPlacing = false;
  var bar = frPlaceBar(); if (bar) bar.classList.remove('show');
  /* the marker stays on the map until the report is sent — a visual receipt */
  showView('view-report');
  toast('Pin dropped — pick the issue.');
}

/* ✕ on the confirm bar, or re-arming: throw the unconfirmed pin away. */
function frCancelPlace() {
  frPlacing = false;
  pendingPin = null;
  var bar = frPlaceBar(); if (bar) bar.classList.remove('show');
  frRemovePinMarker();
}

function frRemovePinMarker() {
  if (frPinMarker) { try { frPinMarker.remove(); } catch (e) {} frPinMarker = null; }
  MapNav.pin = null;
  var old = document.getElementById('map-pin-dot');
  if (old && old.parentNode) old.parentNode.removeChild(old);
}

function frClearPin() {
  pendingPin = null;
  frPlacing = false;
  var bar = frPlaceBar(); if (bar) bar.classList.remove('show');
  frRemovePinMarker();
}

/* Plot the dropped pin on the offline SVG fallback. */
function mapDrawPin() {
  var old = document.getElementById('map-pin-dot');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (!MapNav.pin || !MapNav.project) return;
  var g = mapZoomLayer();
  if (!g) return;
  var p = MapNav.project(MapNav.pin.lon, MapNav.pin.lat);
  var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('id', 'map-pin-dot');
  t.setAttribute('x', p[0].toFixed(1));
  t.setAttribute('y', p[1].toFixed(1));
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('font-size', '26');
  t.textContent = '📍';
  g.appendChild(t);
}

/* One fresh fix from the follow-mode watch: move the dot on every fix, and
 * recenter the map only once the dot drifts out of the inner view — no glide
 * animation, so the map tracks instead of lagging behind. Transient GPS
 * errors never kill follow; only a permission denial does. */
var frFollowErrs = 0;
function frOnFollowFix(pos) {
  var c = pos.coords || {};
  if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return;
  var ageMs = Date.now() - (pos.timestamp || 0);
  if (ageMs > 30000 || ageMs < 0) return; /* stale cached fix — ignore it */
  frFollowErrs = 0;
  frDrawYou(c.latitude, c.longitude);
  if (typeof L !== 'undefined' && frMap) {
    var pt = frMap.latLngToContainerPoint([c.latitude, c.longitude]);
    var size = frMap.getSize();
    if (Math.abs(pt.x - size.x / 2) > size.x * 0.28 ||
        Math.abs(pt.y - size.y / 2) > size.y * 0.28) {
      frMap.panTo([c.latitude, c.longitude], { animate: false });
    }
  } else if (MapNav.project) {
    var p = MapNav.project(c.longitude, c.latitude);
    var cx = p[0] * MapNav.k + MapNav.tx, cy = p[1] * MapNav.k + MapNav.ty;
    if (Math.abs(cx - MapNav.W / 2) > MapNav.W * 0.28 ||
        Math.abs(cy - MapNav.H / 2) > MapNav.H * 0.28) {
      MapNav.tx = MapNav.W / 2 - p[0] * MapNav.k;
      MapNav.ty = MapNav.H / 2 - p[1] * MapNav.k;
      mapApply();
    }
  }
}
function frOnFollowError(err) {
  if (frLocateState !== 'following') return;
  if (err && err.code === 1) {
    frStopFollow(true);
    toast('Location permission denied — follow stopped.');
    return;
  }
  /* iOS fires transient timeouts under tree cover and in dips — ride them out */
  frFollowErrs++;
  if (frFollowErrs >= 3) { frFollowErrs = 0; toast('GPS signal weak — still trying.'); }
}

/* Acquisition: watch the GPS for up to 45 seconds (a cold iPhone radio often
   needs 30-60 s for its first high-accuracy fix — 20 s was giving up early),
   throw away stale cached fixes, and settle on the most accurate fresh fix.
   Transient errors while the radio warms up are ignored; only a permission
   denial ends the attempt early. */
function frStartAcquire() {
  frLocateState = 'acquiring';
  var best = null, finished = false, lastToast = 0;
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
      var now = Date.now();
      if (now - lastToast > 2500) {
        lastToast = now;
        toast('Acquiring GPS… ±' + acc + ' m' + (acc > 50 ? ' — still settling' : ''));
      }
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

  frLocateTimer = setTimeout(finish, 45000);
  try {
    frLocateWatch = navigator.geolocation.watchPosition(function (pos) {
      consider(pos);
      if (best && best.acc <= 8) finish(); /* good enough — stop early */
    }, function (err) {
      /* transient iOS timeouts while the radio warms up are normal — keep
       * waiting; only a permission denial ends the attempt early. */
      if (err && err.code === 1 && !finished) {
        finished = true; frClearLocateWatch(); frLocateState = 'idle';
        toast('Location permission denied. Allow it in Settings and try again.');
      }
    }, { enableHighAccuracy: true, timeout: 45000, maximumAge: 0 });
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
    frLocateWatch = navigator.geolocation.watchPosition(frOnFollowFix, frOnFollowError,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
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
  var parks = DB.parks.filter(function (p) { return p.lat != null && p.lon != null; })
    .map(function (p) { return { id: p.id, name: p.name, lat: p.lat, lon: p.lon, approx: p.approx, type: areaType(p) }; });
  var reports = DB.reports.map(function (r) {
    var cat = catById(r.category);
    var park = parkById(r.parkId);
    return {
      lat: r.lat, lon: r.lon, priority: r.priority,
      label: cat.icon + ' ' + cat.label + ' — ' + (park ? park.name : 'Unknown area') +
             (r.priority ? ' (' + r.priority + ')' : '')
    };
  });
  var f = OrgMap.frame(org, { parks: parks, reports: reports,
    trail: (org.id === 'greene' && typeof RRVT_TRAIL !== 'undefined') ? RRVT_TRAIL : null });
  MapNav.project = f.project; MapNav.W = f.W; MapNav.H = f.H;
  if (MapNav.orgId !== org.id) { // new org → reset to full view
    MapNav.orgId = org.id; MapNav.k = 1; MapNav.tx = 0; MapNav.ty = 0;
  }
  holder.innerHTML = f.svg;
  mapApply();
  mapDrawYou();
  mapBindGestures();
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
  function endPt(e) {
    var down = svg['_down_' + e.pointerId];
    var ids = Object.keys(pts);
    delete pts[e.pointerId]; delete svg['_down_' + e.pointerId]; pinchD0 = 0;
    /* single-finger tap (not a drag/pinch): drop the pin, or — while the
     * confirm bar is up on the fallback — tap again to reposition it */
    if (down && ids.length === 1 && (frPinArmed || frPlacing) && MapNav.project && MapNav.project.unproject) {
      var r = svg.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        var x = (e.clientX - r.left) * (MapNav.W / r.width);
        var y = (e.clientY - r.top) * (MapNav.H / r.height);
        if (Math.hypot(x - down.x, y - down.y) < 12) {
          var mx = (x - MapNav.tx) / MapNav.k, my = (y - MapNav.ty) / MapNav.k;
          var ll = MapNav.project.unproject(mx, my); /* [lon, lat] */
          if (frPinArmed) frStartPlacePin(ll[1], ll[0]);
          else { MapNav.pin = { lat: ll[1], lon: ll[0] }; mapDrawPin(); }
        }
      }
    }
  }
  svg.addEventListener('pointerup', endPt);
  svg.addEventListener('pointercancel', endPt);
}

/* ---------- report view ---------- */
function renderCategoryGrid() {
  var grid = document.getElementById('category-grid');
  grid.innerHTML = '';
  var shown = CATEGORIES.filter(function (c) { return catEnabled(c.id); });
  if (!shown.length) {
    grid.innerHTML = '<p class="hint" style="grid-column:1/-1">Every issue category is turned off. Switch some back on under More → Issue categories.</p>';
    return;
  }
  shown.forEach(function (c) {
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
  /* priority picker: nothing selected until the crew taps one (required) */
  document.querySelectorAll('#sr-pri-row .sr-pri-btn').forEach(function (b) { b.classList.remove('on'); });
  /* tool suggestions for this category — tap to mark what you're bringing */
  var toolsWrap = document.getElementById('sr-tools-wrap');
  var toolsBox = document.getElementById('sr-tools');
  toolsBox.innerHTML = '';
  var sug = cat.tools || [];
  toolsWrap.hidden = !sug.length;
  sug.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tool-chip'; b.textContent = t;
    b.addEventListener('click', function () { b.classList.toggle('on'); });
    toolsBox.appendChild(b);
  });
  document.getElementById('sr-photo-preview').hidden = true;
  document.getElementById('sr-photo-preview').removeAttribute('src');
  var st = document.getElementById('sr-gps-status');
  st.className = 'gps-status'; st.textContent = '📍 Locating…';
  document.getElementById('sr-gps-coords').textContent = '';
  var mic = document.getElementById('sr-mic');
  mic.hidden = !voiceSupported();
  document.getElementById('sr-mic-status').hidden = true;

  document.getElementById('sheet-report').hidden = false;

  /* A map pin was dropped first — its location wins over live GPS. */
  if (pendingPin) {
    var pin = pendingPin; pendingPin = null;
    sheetState.pinned = true; /* so canceling the sheet clears the pin marker */
    sheetState.lat = pin.lat; sheetState.lon = pin.lon;
    sheetState.accuracy = null; sheetState.gpsTried = true;
    st.className = 'gps-status ok';
    st.textContent = '📍 Pinned location';
    document.getElementById('sr-gps-coords').textContent =
      pin.lat.toFixed(5) + ', ' + pin.lon.toFixed(5);
    var nearPin = nearestPark(pin.lat, pin.lon);
    if (nearPin) {
      sel.value = nearPin.park.id;
      var hintPin = document.getElementById('sr-park-hint');
      hintPin.textContent = 'Nearest area: ' + nearPin.park.name + ' (' + nearPin.km.toFixed(1) + ' km) — change it if that’s wrong.';
      hintPin.hidden = false;
    }
    return;
  }

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
  if (sheetState && sheetState.pinned) frClearPin(); /* pin served no report */
  sheetState = null;
}

function sendReport() {
  if (!sheetState) return;
  var parkId = document.getElementById('sr-park').value;
  var notes = document.getElementById('sr-notes').value.trim();
  /* Tanner 2026-09-20: traffic-light priority is required — the crew must tap one. */
  var priBtn = document.querySelector('#sr-pri-row .sr-pri-btn.on');
  if (!priBtn) { toast('Pick a priority first — low, medium, or high.'); return; }
  var pri = priBtn.getAttribute('data-pri');
  var tools = [];
  document.querySelectorAll('#sr-tools .tool-chip.on').forEach(function (b) { tools.push(b.textContent); });
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
    crewUrgent: pri === 'high',
    priority: pri,
    tools: tools,
    status: 'reported',
    assignee: '', dueDate: '',
    costing: null,
    incidentId: DB.activeIncidentId || '', /* 2026-09-21: auto-tag to the active incident */
    syncState: 'local',
    demo: false
  };
  Store.mutate(function (db) { db.reports.unshift(r); });
  closeReportSheet();
  frClearPin(); /* the dropped pin served its report */
  var ai = activeIncident();
  toast(r.incidentId && ai ? 'Report saved — tagged to “' + ai.name + '”.'
    : pri === 'high' ? '🔴 High-priority report saved on this phone.' : 'Report saved on this phone.');
}

/* ---------- board (dashboard) ---------- */
var PRI_ORDER = { high: 0, medium: 1, low: 2 };

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
/* PM-born work orders carry a scheduled badge so the crew can tell them
 * from field-filed reports at a glance. */
function pmBadge(r) {
  return r.source === 'pm' ? '<span class="badge status">🔁 scheduled</span>' : '';
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
        pmBadge(r) +
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
       pmBadge(r) +
       (r.demo ? '<span class="badge">demo data</span>' : '') + '</div>';
  h += statusTimeline(r);

  if (r.priority === 'high') {
    h += '<div class="critical-note">🔴 HIGH — this is the phone-alert tier. If the crew hasn\u2019t called it in, call them.</div>';
  }

  if (r.photo) h += '<img class="detail-photo" src="' + r.photo + '" alt="Report photo">';
  h += '<div class="kv"><span class="k">Park / area</span><span class="v">' + esc(park ? park.name : '—') + '</span></div>';
  h += '<div class="kv"><span class="k">Location</span><span class="v">' +
       ((r.lat != null) ? r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) : 'No GPS captured') + '</span></div>';
  h += '<div class="kv"><span class="k">Reported by</span><span class="v">' + esc(r.reporter) + '</span></div>';
  h += '<div class="kv"><span class="k">Reported</span><span class="v">' + fmtDateTime(r.createdAt) + '</span></div>';
  if (r.note) h += '<div class="kv"><span class="k">Notes</span><span class="v">' + esc(r.note) + '</span></div>';
  if (r.tools && r.tools.length) h += '<div class="kv"><span class="k">Tools</span><span class="v">🧰 ' + esc(r.tools.join(', ')) + '</span></div>';
  if (r.assignee) h += '<div class="kv"><span class="k">Assigned to</span><span class="v">' + esc(r.assignee) + '</span></div>';
  if (r.dueDate) h += '<div class="kv"><span class="k">Due</span><span class="v">' + esc(r.dueDate) + '</span></div>';

  /* Triage controls */
  h += '<h2 style="margin-top:18px">Triage</h2>';
  h += '<label class="field-label">Priority</label>';
  h += '<div class="pri-row" id="d-pri-row">' + ['low', 'medium', 'high'].map(function (p) {
    return '<button class="pri-btn' + (r.priority === p ? ' on' : '') + '" data-pri="' + p + '">' + PRIORITIES[p].label + '</button>';
  }).join('') + '</div>';
  h += '<label class="field-label" for="d-assignee">Assignee</label>';
  h += '<input type="text" id="d-assignee" value="' + esc(r.assignee || '') + '" placeholder="Who owns this job?" autocomplete="off">';
  h += '<label class="field-label" for="d-duedate">Due date' + (r.priority === 'medium' ? ' (required for Medium priority)' : '') + '</label>';
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
  if (r.lat != null && r.lon != null) {
    /* Dead-zone aware: online it routes current location → the logged spot;
     * offline it prompts for a nearby start point first (openDirections). */
    h += '<button class="btn" id="d-directions">🧭 Directions</button>';
  }
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
  var dir = document.getElementById('d-directions');
  if (dir) dir.addEventListener('click', function () { openDirections(r); });
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
  if (r.status === 'reported' && !r.priority) problems.push('Set a priority first (Low, Medium, or High).');
  if (r.status === 'triaged' && !t.assignee) problems.push('Name an assignee before assigning.');
  if (r.status === 'triaged' && r.priority === 'medium' && !t.dueDate) problems.push('Medium priority jobs need a due date.');
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

/* ---------- incident / FEMA mode ----------
 * Tanner 2026-09-21: incident tab. Create/select an incident (name,
 * declaration number, date range); the active incident auto-tags new
 * reports; labor / equipment / materials / contract / admin-time (DAC) /
 * equipment-purchase costs log against it. Org-toggleable via
 * org.incidentModule. The formal FEMA export package ships after current
 * federal forms are verified — the CSV here is a plain summary, not a
 * FEMA form. */
var incSelId = '';
var incPane = 'reports';
var incFormOpen = false;
var incEditId = '';
var incCostKind = 'labor';
var incidentMap = null;

var INCIDENT_KINDS = {
  labor: 'Labor',
  equipment: 'Equipment',
  materials: 'Materials',
  contract: 'Contract',
  admin: 'Admin time (DAC)',
  purchase: 'Equipment purchase'
};
var DAC_TASKS = ['Surveying damage sites', 'Damage descriptions', 'Worksheet review', 'Correspondence', 'Filing claim documents', 'Other'];

function incidentById(id) {
  for (var i = 0; i < DB.incidents.length; i++) if (DB.incidents[i].id === id) return DB.incidents[i];
  return null;
}
function activeIncident() { return incidentById(DB.activeIncidentId); }
function incidentReports(incId) {
  return DB.reports.filter(function (r) { return r.incidentId === incId; });
}
function incidentLogs(incId) {
  return DB.incidentLogs.filter(function (l) { return l.incidentId === incId; });
}
function crewWageByName(name) {
  name = String(name || '').trim().toLowerCase();
  if (!name) return null;
  for (var i = 0; i < DB.crew.length; i++) {
    if (String(DB.crew[i].name).trim().toLowerCase() === name) return DB.crew[i].wage;
  }
  return null;
}
function incNum(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function incSel() {
  var inc = incidentById(incSelId) || activeIncident() || DB.incidents[0] || null;
  incSelId = inc ? inc.id : '';
  return inc;
}
function incVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

function renderIncident() {
  if (incidentMap) { try { incidentMap.remove(); } catch (e) {} incidentMap = null; }
  var body = document.getElementById('incident-body');
  if (!body) return;
  if (!DB.incidents.length) {
    body.innerHTML =
      '<div class="card"><h2>No incidents yet</h2>' +
      '<p class="hint">When a storm or disaster hits, create an incident here. Reports filed while it is active get tagged to it automatically, and every cost you log lands on the incident.</p>' +
      '<div class="btn-row"><button class="btn" data-act="inc-new">＋ New incident</button></div>' +
      (incFormOpen ? incFormHtml(null) : '') + '</div>';
    return;
  }
  var inc = incSel();
  var h = '<div class="card"><div class="btn-row">' +
    '<select id="inc-select" data-chg="inc-select" aria-label="Incident">' +
    DB.incidents.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === inc.id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('') + '</select>' +
    '<button class="btn" data-act="inc-new">＋ New</button></div>' +
    (incFormOpen ? incFormHtml(incEditId ? incidentById(incEditId) : null) : '') + '</div>';

  var isActive = DB.activeIncidentId === inc.id;
  h += '<div class="card"><h2>' + esc(inc.name) + '</h2>' +
    '<p class="hint">' +
    (inc.declNo ? 'Declaration <b>' + esc(inc.declNo) + '</b> · ' : '') +
    (inc.startDate ? esc(inc.startDate) : '?') + ' to ' + (inc.endDate ? esc(inc.endDate) : '?') +
    (inc.notes ? '<br>' + esc(inc.notes) : '') + '</p>' +
    '<div class="btn-row">' +
    (isActive ? '<span class="badge high">Active — new reports tag here</span>'
              : '<button class="btn small" data-act="inc-activate">Set active</button>') +
    '<button class="btn small" data-act="inc-edit">Edit</button>' +
    '<button class="btn small danger" data-act="inc-delete">Delete</button></div></div>';

  var reps = incidentReports(inc.id);
  var logs = incidentLogs(inc.id);
  var laborHrs = 0, total = 0;
  logs.forEach(function (l) {
    total += incNum(l.amount);
    if (l.kind === 'labor') laborHrs += incNum(l.regHrs) + incNum(l.otHrs);
    if (l.kind === 'admin') laborHrs += incNum(l.hours);
  });
  h += '<div class="stat-cards">' +
    '<div class="stat-card"><span class="stat-label">Reports tagged</span><span class="stat-value">' + reps.length + '</span></div>' +
    '<div class="stat-card"><span class="stat-label">Labor hours</span><span class="stat-value">' + (Math.round(laborHrs * 10) / 10) + '</span></div>' +
    '<div class="stat-card"><span class="stat-label">Cost lines</span><span class="stat-value">' + logs.length + '</span></div>' +
    '<div class="stat-card highlight"><span class="stat-label">Total cost</span><span class="stat-value">' + fmtMoney(total) + '</span></div></div>';

  h += '<div class="subnav">' +
    ['reports', 'costs', 'map'].map(function (p) {
      return '<button class="btn small' + (incPane === p ? ' on' : '') + '" data-act="inc-pane" data-pane="' + p + '">' +
        (p === 'reports' ? 'Reports' : p === 'costs' ? 'Log costs' : 'Map') + '</button>';
    }).join('') + '</div>';

  if (incPane === 'reports') h += incReportsHtml(inc, reps);
  else if (incPane === 'costs') h += incCostsHtml(inc, logs);
  else h += '<div class="card"><div id="incident-map" class="incident-map"></div>' +
    '<p class="hint">Damage sites tagged to this incident.' + (reps.length ? '' : ' None tagged yet.') + '</p></div>';

  body.innerHTML = h;
  if (incPane === 'map') setTimeout(function () { incDrawMap(inc); }, 30);
}

function incFormHtml(inc) {
  inc = inc || {};
  return '<div class="incident-form-grid" style="margin-top:10px">' +
    '<input type="text" id="inc-f-name" class="full" placeholder="Incident name — e.g. July windstorm" value="' + esc(inc.name || '') + '">' +
    '<input type="text" id="inc-f-decl" placeholder="Declaration # (optional)" value="' + esc(inc.declNo || '') + '">' +
    '<input type="text" id="inc-f-notes" class="full" placeholder="Notes (optional)" value="' + esc(inc.notes || '') + '">' +
    '<label class="field-label">Start date<input type="date" id="inc-f-start" value="' + esc(inc.startDate || '') + '"></label>' +
    '<label class="field-label">End date<input type="date" id="inc-f-end" value="' + esc(inc.endDate || '') + '"></label>' +
    '</div><div class="btn-row" style="margin-top:8px">' +
    '<button class="btn small" data-act="inc-save">' + (inc.id ? 'Save' : 'Create incident') + '</button>' +
    '<button class="btn small" data-act="inc-cancel">Cancel</button></div>';
}

function incReportsHtml(inc, reps) {
  var h = '<div class="card"><h2>Tagged reports</h2>';
  if (!reps.length) {
    h += '<p class="hint">No reports tagged yet. File reports while this incident is active and they land here automatically.</p>';
  } else {
    h += '<div class="board-list">' + reps.map(function (r) {
      var cat = catById(r.category);
      var park = r.parkId ? parkById(r.parkId) : null;
      return '<div class="log-row"><div class="log-main">' +
        '<div class="log-title">' + esc(cat ? cat.label : r.category) + '</div>' +
        '<div class="log-sub">' + esc(park ? park.name : 'No park') + ' · ' + fmtDate(r.createdAt) +
        (r.note ? ' · ' + esc(r.note.slice(0, 80)) : '') + '</div></div>' +
        '<button class="btn small log-del" data-act="inc-untag" data-id="' + r.id + '">Untag</button></div>';
    }).join('') + '</div>';
  }
  var untagged = DB.reports.filter(function (r) { return !r.incidentId; }).slice(0, 60);
  if (untagged.length) {
    h += '<div class="add-row" style="margin-top:10px"><select id="inc-tag-sel" aria-label="Report to tag">' +
      untagged.map(function (r) {
        var cat = catById(r.category);
        return '<option value="' + r.id + '">' + esc((cat ? cat.label : '?') + ' · ' + fmtDate(r.createdAt)) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn small" data-act="inc-tag">Tag report</button></div>';
  }
  return h + '</div>';
}

function incCostFields() {
  var k = incCostKind;
  function fld(id, label, type, ph) {
    return '<label class="field-label">' + label + '<input type="' + (type || 'text') + '" id="' + id + '"' +
      (ph ? ' placeholder="' + ph + '"' : '') + (type === 'number' ? ' step="any" min="0"' : '') + '></label>';
  }
  var h = '<label class="field-label full">Date<input type="date" id="inc-c-date" value="' + new Date().toISOString().slice(0, 10) + '"></label>';
  if (k === 'labor') {
    h += fld('inc-c-person', 'Person', 'text', 'Name') +
      fld('inc-c-reg', 'Regular hours', 'number') + fld('inc-c-ot', 'Overtime hours', 'number') +
      fld('inc-c-rate', '$/hr loaded rate', 'number') +
      fld('inc-c-task', 'Work done', 'text', 'e.g. cleared downed limbs');
  } else if (k === 'equipment') {
    h += fld('inc-c-label', 'Equipment', 'text', 'e.g. JD 5075E w/ loader') +
      fld('inc-c-hours', 'Hours', 'number') + fld('inc-c-rate', '$/hr', 'number') +
      fld('inc-c-operator', 'Operator', 'text', 'Name');
  } else if (k === 'materials') {
    h += fld('inc-c-desc', 'Material', 'text', 'e.g. gravel') +
      fld('inc-c-qty', 'Quantity', 'number') + fld('inc-c-unit', '$/unit', 'number');
  } else if (k === 'contract') {
    h += fld('inc-c-vendor', 'Vendor', 'text') + fld('inc-c-amount', 'Amount $', 'number') +
      fld('inc-c-desc', 'Work performed', 'text') + fld('inc-c-ref', 'Invoice ref (optional)', 'text');
  } else if (k === 'admin') {
    h += fld('inc-c-person', 'Person', 'text', 'Name') +
      '<label class="field-label">Task<select id="inc-c-task">' +
      DAC_TASKS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></label>' +
      fld('inc-c-hours', 'Hours', 'number') + fld('inc-c-rate', '$/hr loaded rate', 'number') +
      fld('inc-c-position', 'Position/skill (optional)', 'text');
  } else if (k === 'purchase') {
    h += fld('inc-c-item', 'Item', 'text', 'e.g. 16" chainsaw') +
      fld('inc-c-vendor', 'Vendor', 'text') + fld('inc-c-price', 'Price $', 'number') +
      fld('inc-c-lease', 'Lease quote for comparison $', 'number') +
      '<label class="field-label">In service date<input type="date" id="inc-c-inservice"></label>';
  }
  return h;
}

function incCostsHtml(inc, logs) {
  var h = '<div class="card"><h2>Log a cost</h2>' +
    '<label class="field-label">Type<select id="inc-cost-kind" data-chg="inc-cost-kind">' +
    Object.keys(INCIDENT_KINDS).map(function (k) {
      return '<option value="' + k + '"' + (k === incCostKind ? ' selected' : '') + '>' + INCIDENT_KINDS[k] + '</option>';
    }).join('') + '</select></label>' +
    '<div class="incident-form-grid" id="inc-cost-fields">' + incCostFields() + '</div>' +
    '<div class="btn-row" style="margin-top:8px"><button class="btn small" data-act="inc-add-cost">Add to incident</button></div></div>';
  h += '<div class="card"><h2>Cost lines</h2>';
  if (!logs.length) {
    h += '<p class="hint">Nothing logged yet.</p>';
  } else {
    var sorted = logs.slice().sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; });
    h += '<div class="board-list">' + sorted.map(function (l) {
      return '<div class="log-row"><div class="log-main">' +
        '<div class="log-title">' + esc(l.title) + '</div>' +
        '<div class="log-sub">' + esc(INCIDENT_KINDS[l.kind] || l.kind) + ' · ' + esc(l.sub || '') +
        (l.date ? ' · ' + esc(l.date) : '') + '</div></div>' +
        '<span class="log-amt">' + fmtMoney(l.amount) + '</span>' +
        '<button class="btn small danger log-del" data-act="inc-del-cost" data-id="' + l.id + '">✕</button></div>';
    }).join('') + '</div>';
  }
  h += '<div class="btn-row" style="margin-top:10px"><button class="btn small" data-act="inc-csv">⬇ Incident summary CSV</button></div>' +
    '<p class="hint">Plain summary for your records — not a FEMA form. The formal FEMA export package is still to come.</p></div>';
  return h;
}

function incBuildCost(inc) {
  var k = incCostKind;
  var date = incVal('inc-c-date') || new Date().toISOString().slice(0, 10);
  var base = { id: uid(), incidentId: inc.id, kind: k, date: date, createdAt: Date.now() };
  function rate(id) {
    var r = incNum(incVal(id));
    if (!r) {
      var w = crewWageByName(incVal('inc-c-person'));
      if (w != null) r = w;
    }
    return r;
  }
  if (k === 'labor') {
    var person = incVal('inc-c-person'), reg = incNum(incVal('inc-c-reg')), ot = incNum(incVal('inc-c-ot'));
    var rt = rate('inc-c-rate');
    if (!person || !(reg + ot)) { toast('⚠️ Person and hours are required.'); return null; }
    if (!rt) { toast('⚠️ Enter an hourly rate (or add them under Crew wages).'); return null; }
    base.person = person; base.regHrs = reg; base.otHrs = ot; base.rate = rt; base.task = incVal('inc-c-task');
    base.title = person;
    base.sub = 'Labor · ' + reg + ' reg' + (ot ? ' + ' + ot + ' OT' : '') + ' hrs' + (base.task ? ' · ' + base.task : '');
    base.amount = (reg + ot) * rt;
  } else if (k === 'equipment') {
    var label = incVal('inc-c-label'), hrs = incNum(incVal('inc-c-hours')), er = incNum(incVal('inc-c-rate'));
    if (!label || !hrs) { toast('⚠️ Equipment and hours are required.'); return null; }
    if (!er) { toast('⚠️ Enter an hourly rate.'); return null; }
    base.label = label; base.hours = hrs; base.rate = er; base.operator = incVal('inc-c-operator');
    base.title = label;
    base.sub = 'Equipment · ' + hrs + ' hrs' + (base.operator ? ' · Op: ' + base.operator : '');
    base.amount = hrs * er;
  } else if (k === 'materials') {
    var desc = incVal('inc-c-desc'), qty = incNum(incVal('inc-c-qty')), up = incNum(incVal('inc-c-unit'));
    if (!desc || !qty) { toast('⚠️ Material and quantity are required.'); return null; }
    base.desc = desc; base.qty = qty; base.unitPrice = up;
    base.title = desc;
    base.sub = 'Materials · ' + qty + ' × ' + fmtMoney(up);
    base.amount = qty * up;
  } else if (k === 'contract') {
    var vendor = incVal('inc-c-vendor'), amt = incNum(incVal('inc-c-amount'));
    if (!vendor || !amt) { toast('⚠️ Vendor and amount are required.'); return null; }
    base.vendor = vendor; base.amount = amt; base.desc = incVal('inc-c-desc'); base.ref = incVal('inc-c-ref');
    base.title = vendor + (base.desc ? ' — ' + base.desc : '');
    base.sub = 'Contract' + (base.ref ? ' · ' + base.ref : '');
  } else if (k === 'admin') {
    var ap = incVal('inc-c-person'), ah = incNum(incVal('inc-c-hours')), ar = rate('inc-c-rate');
    if (!ap || !ah) { toast('⚠️ Person and hours are required.'); return null; }
    if (!ar) { toast('⚠️ Enter an hourly rate (or add them under Crew wages).'); return null; }
    base.person = ap; base.position = incVal('inc-c-position'); base.task = incVal('inc-c-task');
    base.hours = ah; base.rate = ar;
    base.title = ap;
    base.sub = 'Admin (DAC) · ' + base.task + ' · ' + ah + ' hrs';
    base.amount = ah * ar;
  } else if (k === 'purchase') {
    var item = incVal('inc-c-item'), price = incNum(incVal('inc-c-price'));
    if (!item || !price) { toast('⚠️ Item and price are required.'); return null; }
    base.item = item; base.vendor = incVal('inc-c-vendor'); base.price = price;
    base.leaseQuote = incNum(incVal('inc-c-lease')); base.inService = incVal('inc-c-inservice');
    base.title = item;
    base.sub = 'Purchase' + (base.vendor ? ' · ' + base.vendor : '') +
      (base.inService ? ' · in service ' + base.inService : '');
    base.amount = price;
  }
  return base;
}

function incDrawMap(inc) {
  var el = document.getElementById('incident-map');
  if (!el || !window.L) return;
  if (!incidentMap) {
    incidentMap = L.map(el, { zoomControl: true }).setView([42.04, -94.39], 10);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri', maxZoom: 19
    }).addTo(incidentMap);
  }
  var pts = [];
  incidentReports(inc.id).forEach(function (r) {
    if (r.lat == null || r.lon == null) return;
    pts.push([r.lat, r.lon]);
    var cat = catById(r.category);
    L.circleMarker([r.lat, r.lon], {
      radius: 7, color: '#10140c', weight: 1.5,
      fillColor: PRI_FILL[r.priority] || '#9aa0a6', fillOpacity: 1
    }).addTo(incidentMap)
      .bindTooltip(esc(cat ? cat.label : r.category) + ' · ' + fmtDate(r.createdAt));
  });
  if (pts.length) incidentMap.fitBounds(pts, { padding: [24, 24] });
  incidentMap.invalidateSize();
}

function incExportCSV(inc) {
  var rows = [['type', 'date', 'description', 'detail', 'hours_or_qty', 'rate', 'amount']];
  incidentReports(inc.id).forEach(function (r) {
    var cat = catById(r.category);
    var park = r.parkId ? parkById(r.parkId) : null;
    rows.push(['report', fmtDate(r.createdAt), cat ? cat.label : r.category,
      (park ? park.name : '') + (r.note ? ' — ' + r.note : ''), '', '', '']);
  });
  incidentLogs(inc.id).forEach(function (l) {
    rows.push([l.kind, l.date || '', l.title || '', l.sub || '', '', '', Math.round(l.amount * 100) / 100]);
  });
  var csv = rows.map(function (row) {
    return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var slug = inc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'incident';
  download('incident-' + slug + '-summary.csv', csv, 'text/csv');
  toast('Incident summary CSV downloaded.');
}

function incOnClick(e) {
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.getAttribute('data-act');
  var inc = incSel();
  if (act === 'inc-new') { incFormOpen = true; incEditId = ''; renderIncident(); }
  else if (act === 'inc-edit') { incFormOpen = true; incEditId = inc ? inc.id : ''; renderIncident(); }
  else if (act === 'inc-cancel') { incFormOpen = false; incEditId = ''; renderIncident(); }
  else if (act === 'inc-save') {
    var name = incVal('inc-f-name');
    if (!name) { toast('⚠️ Give the incident a name.'); return; }
    var data = {
      name: name, declNo: incVal('inc-f-decl'), notes: incVal('inc-f-notes'),
      startDate: incVal('inc-f-start'), endDate: incVal('inc-f-end')
    };
    var wasEdit = !!incEditId;
    Store.mutate(function (db) {
      if (incEditId) {
        var x = null;
        db.incidents.forEach(function (i) { if (i.id === incEditId) x = i; });
        if (x) Object.keys(data).forEach(function (k) { x[k] = data[k]; });
      } else {
        data.id = uid(); data.createdAt = Date.now();
        db.incidents.unshift(data);
        db.activeIncidentId = data.id;
      }
    });
    incFormOpen = false; incEditId = '';
    toast(wasEdit ? 'Incident updated.' : 'Incident created and set active — new reports tag to it.');
  }
  else if (act === 'inc-activate') {
    if (!inc) return;
    Store.mutate(function (db) { db.activeIncidentId = inc.id; });
    toast('“' + inc.name + '” is now the active incident.');
  }
  else if (act === 'inc-delete') {
    if (!inc) return;
    if (!confirm('Delete “' + inc.name + '”? Its cost lines are removed; tagged reports stay but lose the tag.')) return;
    Store.mutate(function (db) {
      db.incidents = db.incidents.filter(function (x) { return x.id !== inc.id; });
      db.incidentLogs = db.incidentLogs.filter(function (l) { return l.incidentId !== inc.id; });
      db.reports.forEach(function (r) { if (r.incidentId === inc.id) r.incidentId = ''; });
      if (db.activeIncidentId === inc.id) db.activeIncidentId = '';
    });
    incSelId = '';
    toast('Incident deleted.');
  }
  else if (act === 'inc-pane') { incPane = t.getAttribute('data-pane'); renderIncident(); }
  else if (act === 'inc-untag') {
    var rid = t.getAttribute('data-id');
    Store.mutate(function (db) {
      db.reports.forEach(function (r) { if (r.id === rid) r.incidentId = ''; });
    });
  }
  else if (act === 'inc-tag') {
    var sel = document.getElementById('inc-tag-sel');
    if (!sel || !inc) return;
    var tagId = sel.value;
    Store.mutate(function (db) {
      db.reports.forEach(function (r) { if (r.id === tagId) r.incidentId = inc.id; });
    });
    toast('Report tagged to “' + inc.name + '”.');
  }
  else if (act === 'inc-add-cost') {
    if (!inc) return;
    var entry = incBuildCost(inc);
    if (!entry) return;
    Store.mutate(function (db) { db.incidentLogs.unshift(entry); });
    toast(INCIDENT_KINDS[entry.kind] + ' logged: ' + fmtMoney(entry.amount) + '.');
  }
  else if (act === 'inc-del-cost') {
    var lid = t.getAttribute('data-id');
    Store.mutate(function (db) {
      db.incidentLogs = db.incidentLogs.filter(function (l) { return l.id !== lid; });
    });
  }
  else if (act === 'inc-csv') { if (inc) incExportCSV(inc); }
}

function incOnChange(e) {
  var t = e.target.closest('[data-chg]');
  if (!t) return;
  var chg = t.getAttribute('data-chg');
  if (chg === 'inc-select') { incSelId = t.value; renderIncident(); }
  else if (chg === 'inc-cost-kind') {
    incCostKind = t.value;
    var f = document.getElementById('inc-cost-fields');
    if (f) f.innerHTML = incCostFields();
  }
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

  /* issue category toggles — per-org, Report tab only */
  var tl = document.getElementById('cat-toggle-list');
  tl.innerHTML = '';
  CATEGORIES.forEach(function (c) {
    var row = document.createElement('label');
    row.className = 'cat-toggle-row';
    var on = catEnabled(c.id);
    row.innerHTML = '<span class="cat-toggle-icon">' + catIcon(c) + '</span>' +
      '<span class="nm">' + esc(c.label) + '</span>' +
      '<input type="checkbox" data-cat-toggle="' + c.id + '"' + (on ? ' checked' : '') + ' aria-label="Show ' + esc(c.label) + ' on the Report tab">';
    tl.appendChild(row);
  });
  tl.querySelectorAll('[data-cat-toggle]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      setCatEnabled(inp.getAttribute('data-cat-toggle'), inp.checked);
      renderCategoryGrid();
      toast(inp.checked ? 'Category switched on.' : 'Category switched off.');
    });
  });
  document.getElementById('btn-cats-enable-all').onclick = function () {
    Store.mutate(function (db) { db.catOff[db.orgId] = []; });
    renderMore();
    renderCategoryGrid();
    toast('All categories switched on.');
  };

  /* maintenance schedules — recurring work orders */
  /* park select follows the live park list (areas can be added any time) */
  (function () {
    var sp = document.getElementById('new-sched-park');
    var keep = sp.value;
    sp.innerHTML = '';
    DB.parks.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      sp.appendChild(o);
    });
    if (keep) sp.value = keep;
  })();
  document.getElementById('schedule-count').textContent =
    (DB.schedules || []).length + ((DB.schedules || []).length === 1 ? ' schedule' : ' schedules');
  var sl = document.getElementById('schedule-list');
  sl.innerHTML = '';
  if (!(DB.schedules || []).length) {
    sl.innerHTML = '<p class="hint" style="margin:4px 0">No schedules yet — add the first one below.</p>';
  }
  (DB.schedules || []).forEach(function (s) {
    pmNormalize(s);
    var cat = catById(s.category);
    var park = parkById(s.parkId);
    var pri = PRIORITIES[s.priority] || PRIORITIES.low;
    var row = document.createElement('div');
    row.className = 'sched-row' + (s.enabled ? '' : ' sched-off');
    row.innerHTML =
      '<span class="nm">' + catIcon(cat) + ' <strong>' + esc(s.title) + '</strong>' +
      '<span class="sub">' + esc(recurrenceLabel(s)) + ' · ' + esc(park ? park.name : 'Unknown area') +
      ' · <span class="badge ' + pri.cls + '">' + pri.label + '</span>' +
      (s.nextDue ? ' · next due ' + esc(s.nextDue) : '') +
      (s.assignee ? ' · ' + esc(s.assignee) : '') +
      (s.demo ? ' · demo' : '') + '</span></span>' +
      '<span class="ctl">' +
      '<label class="hint" style="margin:0" title="Switch schedule on or off">' +
      '<input type="checkbox" data-sched-toggle="' + s.id + '"' + (s.enabled ? ' checked' : '') +
      ' aria-label="Switch schedule on or off"></label>' +
      '<button class="btn small" data-sched-run="' + s.id + '" title="Create its work order right now">▶</button>' +
      '<button class="btn small danger" data-sched-del="' + s.id + '" aria-label="Delete schedule">✕</button>' +
      '</span>';
    sl.appendChild(row);
  });
  sl.querySelectorAll('[data-sched-toggle]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var id = inp.getAttribute('data-sched-toggle');
      Store.mutate(function (db) {
        db.schedules.forEach(function (x) {
          if (x.id === id) {
            x.enabled = inp.checked;
            /* Re-enabling a schedule that never ran anchors its first due
             * date one interval out instead of backfilling. */
            if (x.enabled && !x.nextDue) x.nextDue = isoAddDays(todayISO(), pmNormalize(x).intervalDays);
          }
        });
      });
      renderMore();
      toast(inp.checked ? 'Schedule switched on.' : 'Schedule switched off — no new work orders until it’s back on.');
    });
  });
  sl.querySelectorAll('[data-sched-del]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-sched-del');
      var s = schedById(id);
      if (!confirm('Delete the “' + (s ? s.title : 'schedule') + '” schedule? Work orders it already created stay on the board.')) return;
      Store.mutate(function (db) {
        db.schedules = db.schedules.filter(function (x) { return x.id !== id; });
      });
      renderMore();
      toast('Schedule deleted — its past work orders are untouched.');
    });
  });
  /* run-now: birth this schedule's work order immediately (still honors the
   * one-open-instance rule). For trying the feature and for doing a job early. */
  sl.querySelectorAll('[data-sched-run]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-sched-run');
      if (pmOpenInstance(id)) { toast('It already has an open work order — nothing created.'); return; }
      Store.mutate(function (db) {
        var x = null;
        db.schedules.forEach(function (y) { if (y.id === id) x = y; });
        if (!x) return;
        pmNormalize(x);
        var rpt = pmBuildReport(x);
        rpt.dueDate = todayISO(); /* born now, due now */
        db.reports.unshift(rpt);
        x.nextDue = isoAddDays(todayISO(), x.intervalDays);
        x.lastRunAt = Date.now();
      });
      renderMore();
      toast('🔁 Work order created in triage.');
    });
  });
}

function renderAll() {
  updateSyncPill();
  var hasDemo = DB.reports.some(function (r) { return r.demo; }) ||
    (DB.schedules || []).some(function (s) { return s.demo; });
  document.getElementById('demo-banner').hidden = !hasDemo;
  if (currentView === 'view-board') renderBoard();
  if (currentView === 'view-map') renderMap();
  if (currentView === 'view-savings') renderSavings();
  if (currentView === 'view-incident') renderIncident();
  if (currentView === 'view-more') renderMore();
  if (detailId) renderDetail();
}

/* ---------- init & wiring ---------- */
function init() {
  Store.load();
  Store.ensureOrg();
  /* PM scheduler: births due work orders into the triage queue. Idempotent —
   * repeated runs can never duplicate (one open instance per schedule). */
  var pmCreated = runPmScheduler();
  renderCategoryGrid();
  updateSyncPill();
  updateOrgChrome();
  /* The offline-first "daily": if the app sat open (or suspended) across
   * midnight, re-run the scheduler when it becomes visible again. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && DB && DB.pmLastRun !== todayISO()) {
      var n = runPmScheduler();
      if (n > 0) {
        renderAll();
        toast('🔁 ' + n + ' scheduled work order' + (n === 1 ? '' : 's') + ' created.');
      }
    }
  });
  if (pmCreated > 0) {
    toast('🔁 ' + pmCreated + ' scheduled work order' + (pmCreated === 1 ? '' : 's') + ' created.');
  }
  var hasDemo = DB.reports.some(function (r) { return r.demo; }) ||
    (DB.schedules || []).some(function (s) { return s.demo; });
  document.getElementById('demo-banner').hidden = !hasDemo;

  /* tabs */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
  });

  /* map: org switcher */
  document.querySelectorAll('.org-btn').forEach(function (b) {
    b.addEventListener('click', function () { setOrg(b.getAttribute('data-org')); });
  });

  /* emergency SOS (guarded — tap opens a confirm sheet, never dials directly) */
  document.getElementById('sos-btn').addEventListener('click', openSosSheet);

  /* map: find-me control (Leaflet supplies its own +/− zoom) */
  document.getElementById('map-locate').addEventListener('click', mapLocateMe);

  /* map: drop-a-pin — arm, then the next map tap drops the pin */
  document.getElementById('map-pin').addEventListener('click', function () {
    frSetPinArmed(!frPinArmed);
  });
  document.getElementById('btn-place-ok').addEventListener('click', frConfirmPin);
  document.getElementById('btn-place-cancel').addEventListener('click', frCancelPlace);

  /* report sheet */
  document.getElementById('sr-cancel').addEventListener('click', closeReportSheet);
  document.getElementById('sheet-report').addEventListener('click', function (e) {
    if (e.target.id === 'sheet-report') closeReportSheet();
  });
  document.getElementById('sr-send').addEventListener('click', sendReport);
  /* traffic-light priority picker: one tap selects, required before send */
  document.querySelectorAll('#sr-pri-row .sr-pri-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#sr-pri-row .sr-pri-btn').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    });
  });

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
  /* incident tab: one delegated listener pair for its dynamic content */
  document.getElementById('incident-body').addEventListener('click', incOnClick);
  document.getElementById('incident-body').addEventListener('change', incOnChange);  document.getElementById('btn-json').addEventListener('click', function () {
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

  /* more: maintenance schedules — fill the form selects once (static markup,
   * so values survive renderMore re-renders while typing) */
  (function () {
    var catSel = document.getElementById('new-sched-cat');
    CATEGORIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.icon + ' ' + c.label;
      catSel.appendChild(o);
    });
    catSel.value = 'mowing';
    var recurSel = document.getElementById('new-sched-recur');
    PM_RECURRENCE.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.label + (p.days ? ' (' + p.days + ' days)' : '');
      recurSel.appendChild(o);
    });
    recurSel.value = 'weekly';
    var daysInp = document.getElementById('new-sched-days');
    recurSel.addEventListener('change', function () {
      var p = pmPresetById(recurSel.value);
      if (p && p.days) daysInp.value = p.days;
    });
    document.getElementById('btn-add-schedule').addEventListener('click', function () {
      var title = document.getElementById('new-sched-title').value.trim();
      if (!title) { toast('⚠️ Give the schedule a title first.'); return; }
      var days = parseInt(daysInp.value, 10);
      if (!(days >= 1)) { toast('⚠️ "Every N days" needs to be at least 1.'); return; }
      var parkSel = document.getElementById('new-sched-park');
      Store.mutate(function (db) {
        var s = pmNormalize({
          id: uid(),
          title: title,
          category: catSel.value,
          parkId: parkSel.value,
          recurrence: recurSel.value === 'custom' ? 'custom' : recurSel.value,
          intervalDays: days,
          priority: document.getElementById('new-sched-pri').value,
          assignee: document.getElementById('new-sched-assignee').value.trim(),
          notes: document.getElementById('new-sched-notes').value.trim(),
          enabled: true,
          demo: false,
          lastRunAt: null,
          nextDue: null /* scheduler anchors the first due date one interval out */
        });
        /* If the day count doesn't match the named preset, it's custom. */
        var p = pmPresetById(s.recurrence);
        if (s.recurrence !== 'custom' && (!p || p.days !== s.intervalDays)) s.recurrence = 'custom';
        db.schedules.push(s);
      });
      document.getElementById('new-sched-title').value = '';
      document.getElementById('new-sched-assignee').value = '';
      document.getElementById('new-sched-notes').value = '';
      renderMore();
      toast('Schedule added — first work order lands in triage when it’s due.');
    });
  })();

  /* more: reset demo / wipe */
  document.getElementById('btn-reset-demo').addEventListener('click', function () {
    if (!confirm('Reset demo data? Your real reports stay; the fictional demo reports are replaced.')) return;
    Store.mutate(function (db) {
      var keepReports = db.reports.filter(function (r) { return !r.demo; });
      var keepParks = db.parks, keepRates = db.rates, keepName = db.staffName, keepCrew = db.crew;
      var keepSchedules = (db.schedules || []).filter(function (s) { return !s.demo; });
      seedDemo();
      db.reports = db.reports.concat(keepReports);
      db.schedules = db.schedules.concat(keepSchedules);
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

  showView('view-map');
}

document.addEventListener('DOMContentLoaded', init);
