# Field Reports — Developer Handbook

**Purpose:** If anything happens to Tanner Scheuermann or to Muse (his AI developer), this file gives a competent developer everything needed to take over Field Reports: what it is, what was decided, where everything lives, and what must never be done.

**Last updated:** 2026-09-21

---

## 1. What Field Reports is

Field Reports is a phone-first maintenance reporting app for conservation departments and small cities. Staff tap big icon buttons (tree, pothole, trail, animal rescue, storm damage, etc.), the phone GPS-locates the issue, they snap a photo, add voice-transcribed notes, hit send. It works offline in dead zones and syncs later. Reports flow through a loop: reported → triaged → assigned → fixed → Tanner verifies closed.

**The strategic purpose (Tanner's words):** every report is documented as a public record AND valued in dollars using standard rate frameworks — the dataset is meant to support changing legislation. The research report behind this is `workspace/research_notes/parks-maintenance-valuation-standards-20260920-2119/report.md`.

**Standing constraint:** Field Reports is secondary to Opossum Foot. It must never take development priority away from the trapping app.

---

## 2. Ownership & key people

- **Owner/driver:** Tanner Scheuermann, Greene County, Iowa Conservation Director. Personal dealings use his name only, never his title. Short directives, expects fast builds, re-pulls and cross-checks — never announce anything as done until he has seen it work on his iPhone.
- **Muse (AI developer):** Build labor at $0. Standing rules: act on clear instructions without asking again; confirm before destructive/ambiguous actions; approval required before seller messages/offers, purchases/charges, LLC filing, family communications, public posting, logo approval, sensitive prompts.
- **Eric Fisher ("Fisher" — no h):** Parks & Cemetery Superintendent, City of Jefferson (maintenance side, separate from Parks & Recreation; Park Maintenance Building, 104 N. Olive St., 515-386-4173). Tanner's close friend and the designated pilot tester for the City of Jefferson version.

---

## 3. Product laws (decided with Tanner — do not change unilaterally)

### White-label model
- One codebase. Each organization gets: logo, boundary maps (city/county/park limits), facility list, rate table. Most Iowa parks/conservation departments share ONE issue-category icon set — icon inventory is shared, not per-org.
- Each organization can toggle individual issue categories on/off (per-org configuration, not a custom build). **Disabling a category hides it from the Report screen only — historical records are never hidden.**
- Greene County Conservation first; Jefferson later. **No Jefferson tab in the Greene County app** — the Jefferson duplicate comes later as its own build.

### Map
- Frame Greene County (slight surrounding area OK). Street and satellite imagery (Esri). **No topo.** Map legend stays removed; boundary outlines and approximate dots stay. Precise pin coordinates parked until Tanner supplies labeled pin lists. TIGER/Line boundaries are references, never legal determinations.

### Brand
- Official Greene County Conservation shield logo (assets/greene-county-conservation-logo.jpg), brass #d19a2f palette matching Opossum Foot. Cream category silhouettes.

### Data & prototype stage
- Local-first, localStorage: no accounts, no shared backend, no phone-to-phone sync. Anyone holding the phone can open the wage screen — this is a known prototype caveat, stated plainly in-app.
- **Preserve all localStorage on every deploy:** reports, rates, wages, pins, settings. Never wipe user data with a cache bump.

### Triage loop
- Required priority on every report: Low (green) / Medium (yellow) / High (red — immediate phone-alert tier). Medium keeps due-date requirements. Board sorts by due date.
- Roles (queued): top admin → staff → campground host → volunteer. Staff can triage (priority/assignment/due date); admin can override; all changes get an audit history. First implementation is a "View as" interface prototype, NOT real access control.

### Naming rules
- "Fisher" = Eric Fisher, spelled without h. Never assume personal equipment belongs to Greene County. Never guess who "he"/"she" means; never merge Kody and Sawyer without confirmation. Trapping is never moralized.

---

## 4. Architecture

- **Live:** https://wspwoods-dotcom.github.io/field-reports/ — GitHub Pages, repo https://github.com/wspwoods-dotcom/field-reports (Google identity wspwoods@gmail.com).
- **Stack:** static PWA, no backend. Leaflet 1.9.4 (same as Opossum Foot) with Esri WorldStreetMap + WorldImagery(+ref labels) and a Street/Satellite switcher. Offline SVG map fallback when the CDN can't load; bounded tile cache.
- **Shell versioning:** `index.html` carries `field-reports-shell-vN`; `sw.js` cache is `field-reports-shell-vN`. Both must bump together.
- **Key files:** `index.html`, `css/styles.css`, `js/app.js`, `js/orgs.js` (per-org config: boundary, parks, rates, category toggles), `js/orgmap.js`, `js/trail.js` (RRVT geometry, OSM/Overpass source, ODbL), `sw.js`, `assets/cats/*.png` (cream silhouettes), `assets/greene-county-conservation-logo.jpg`.
- **Data model:** `DB.reports[]` (category, GPS, photos, notes, priority, dueDate, assignee, status, costing {labor:[{crewId,hours}], equipment, materials}); `DB.crew[]` (id, name, loaded wage $/hr); `DB.catOff[orgId]` (disabled categories); `DB.rates`, `DB.settings`, `DB.pins`.
- **24 Greene County areas** with coordinates in `js/orgs.js` (source: `workspace/research_notes/greene-county-park-coordinates-20260920.json`; 13 embedded, 6 approximate, 5 address-derived — never silently overwrite user-corrected coordinates). RRVT trail line in gold #d19a2f; the `p-rrvt` park record keeps the data while its duplicate dot is suppressed.
- **Costing:** per-person labor costing via Crew wages (More → "Crew wages (admin)"); "County cost by person" and savings views; in-house labor at real wages, industry comparison at published benchmark wage+fringe; legacy single-number laborHours records keep the generic rate (old data never rewritten). Removing a crew member keeps past hours at the generic rate ("Former staff").
- **Pin flow:** app opens on Map → 📍 → tap map to drop pin → drag to exact spot → "Looks right" opens categories → confirmed marker coordinates override live GPS.

### Deployment law (hard-won — follow exactly)
1. Finish and freeze ALL files before spawning the upload. The upload grants are digested at spawn time — a later local edit invalidates the grant and that file silently fails to deploy.
2. Deploy only through the authenticated parent live-browser route (upload grants to github.com). Never delegate to a generic subagent — no GitHub auth, no browser tasks, always comes back blocked.
3. After deploy: verify live `sw.js` cache name, send Tanner a fresh link, ask what he sees. Never claim iPhone success until HE confirms it.
4. If an update is absent: suspect Safari/service-worker caching first — force-quit and reopen, confirm expected build/cache — before any redeploy.

---

## 5. Version history

- **PM scheduling prototype (2026-09-21, LOCAL ONLY — not deployed):** More → "Maintenance schedules". Admin defines recurring work (title, category, park, weekly/biweekly/monthly/seasonal/yearly/custom N days, priority, assignee, notes). Scheduler runs on app load + when the app becomes visible on a new day; births one work order per schedule into triage (source:'pm', 🔁 scheduled badge) with due date set. Never duplicates: one open instance per schedule at a time; new schedules anchor their first due date one interval out. Each row has on/off toggle, ▶ run-now (births a work order immediately, honors the one-open rule), and delete. 3 demo schedules seed OFF. Deleting a schedule never deletes its work orders. Design decisions awaiting Tanner: (1) editing is delete + re-add (no edit form yet); (2) schedule-deleted reports keep working normally; (3) no push alert when a PM work order is born — that waits on the backend.
- **v11 (2026-09-21, deployed + verified):** 14 categories, per-org category toggles, required priority, Greene County framing, no map scroll, tab silhouettes. Tree report created during verification lives only in that browser's localStorage. Cache `field-reports-shell-v11`.
- **v12 (2026-09-21, frozen; deploy in flight):** Lighting → Storm damage (chainsaw/fuel mix/bar oil/loppers/rake/work gloves); added Facility cleaning (cleaning supplies/disinfectant/trash bags/mop & bucket/paper products/gloves); RRVT trail gold line + tooltip; headstone icon black-square fix; retired lighting.png from precache. 15 categories. Cache `field-reports-shell-v12`. **Do not edit frozen files until deploy handoff confirms.** Verification checklist in the build notes.

---

## 6. Roadmap (approved, not yet built)

- **Preventive maintenance scheduling** — PROTOTYPE BUILT 2026-09-21, local only, not deployed (see Version history). Remaining: edit-in-place for schedules, optional "notify me" when a PM work order is born (needs backend push).
- **Plumbing + Electrical** toggleable categories (icons ready: `assets/cats/plumbing.png`, `assets/cats/electrical.png`; tool lists pending Tanner's approval).
- **Natural Resources module** — not a flat category: a sub-page where the user picks a practice (prairie restoration, oak savanna, food plots, invasive removal, prescribed fire) and logs practice-specific fields. **Crew hours are the headline field** — grant match is the purpose. Icon ready: `assets/cats/natural.png` (oak leaf).
- **FEMA / Incident mode** — organization-toggleable tab with its own incident map. Turn on → create/select event (e.g. "June 2026 derecho") + declaration number → reports auto-tag → per-incident labor/equipment/materials summaries → one export package per incident. Spec: `docs/fema-export-spec.md` (FEMA 009-0 series: labor 009-0-123, fringe 009-0-128, equipment 009-0-127, rented equipment 009-0-125, materials 009-0-124; plus equipment purchases with lease-vs-purchase analysis, and Direct Administrative Costs logging). Never promise eligibility.
- **Role-tier dollar valuation:** research-backed default hourly value per tier (volunteer: Independent Sector 2026 Iowa $30.92/hr; staff: actual loaded wage, fallback Iowa BLS/OEWS groundskeeping wage + fringe per Iowa DOT LRTF model — exact rate still unresolved, do not guess); top admin can override tier defaults and individual rates; every costed record shows rate + source. FEMA equipment rates stay separate from Iowa DOT valuation rates.
- **"View as" role prototype** (interface testing only, no real access control until a shared backend exists).

---

## 7. File inventory (home = /home/hatch)

- `~/workspace/greene-county-maintenance-app/` — the full local codebase (index.html, css/, js/, assets/, sw.js).
- `~/workspace/greene-county-maintenance-app/docs/fema-export-spec.md` — the FEMA export specification.
- `~/workspace/greene-county-maintenance-app/DEVELOPER-HANDBOOK.md` — this file.
- `~/workspace/research_notes/parks-maintenance-valuation-standards-20260920-2119/report.md` — the dollar-valuation research (Iowa DOT LRTF Schedule of Labor and Equipment Rates FY2027; Iowa Admin Code 571 Ch. 33; Independent Sector volunteer rate).
- `~/workspace/research_notes/greene-county-park-coordinates-20260920.json` — 24-area coordinate source.
- Goal workspace: `~/workspace/goals/` tree-marking-deadline item (due Nov 1, 2026; reminder Oct 28, 2026 8:20 AM CT).

---

## 8. Costs & accounts

- Build labor $0 (Muse). Hosting $0 (GitHub Pages). No credentials in files or memory — service logins via Secure Vault / connector flows, never chat.

---

## 9. Hard rules

1. Preserve localStorage (reports, wages, rates, pins, settings) across every deploy.
2. Disabling a category never hides historical records.
3. Never promise FEMA eligibility — the app documents; FEMA decides.
4. Never guess a wage or equipment rate — unresolved rates stay unresolved until sourced.
5. No Jefferson content in the Greene County build.
6. Deployment law (Section 4) is followed exactly, every time.
7. Never announce a fix as done until Tanner has seen it work on his phone.
8. Opossum Foot stays the priority; Field Reports never takes away from it.

---

## 10. If you're the new developer: first three things

1. Read the valuation research report and `docs/fema-export-spec.md` — they explain WHY this app exists (legislative dollar data + FEMA pain).
2. Open the live site on your own phone, file a test report, and run the full pin flow in Section 4 — the field UX is the product.
3. Talk to Tanner before changing any Section 3 product law or starting the shared-backend work (roles, real access control, sync). Those decisions are his.
