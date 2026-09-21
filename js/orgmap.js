/* Field Reports — OrgMap: dependency-free SVG boundary map.
 *
 * No map library, no tiles, no network: the org boundary polygon (from
 * ORGS config, TIGER/Line 2025, EPSG:4269 lon/lat degrees) is projected
 * with a simple equirectangular projection (cos-latitude corrected —
 * plenty accurate at county scale) and drawn as SVG. Park pins and report
 * dots plot on top. Pure functions throughout so they can be unit-tested
 * in node (see bottom export guard).
 */

'use strict';

var OrgMap = (function () {

  /* Bounding box of a lon/lat ring: {minLon,minLat,maxLon,maxLat} */
  function boundsOfRing(ring) {
    var b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    for (var i = 0; i < ring.length; i++) {
      var lon = ring[i][0], lat = ring[i][1];
      if (lon < b.minLon) b.minLon = lon;
      if (lon > b.maxLon) b.maxLon = lon;
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
    }
    return b;
  }

  /* Union of several bboxes, then padded by `padFrac` of the larger span. */
  function unionBounds(boxes, padFrac) {
    var b = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    boxes.forEach(function (x) {
      if (x.minLon < b.minLon) b.minLon = x.minLon;
      if (x.minLat < b.minLat) b.minLat = x.minLat;
      if (x.maxLon > b.maxLon) b.maxLon = x.maxLon;
      if (x.maxLat > b.maxLat) b.maxLat = x.maxLat;
    });
    var spanLon = (b.maxLon - b.minLon) || 0.01;
    var spanLat = (b.maxLat - b.minLat) || 0.01;
    var pad = Math.max(spanLon, spanLat) * (padFrac == null ? 0.06 : padFrac);
    return {
      minLon: b.minLon - pad, maxLon: b.maxLon + pad,
      minLat: b.minLat - pad, maxLat: b.maxLat + pad
    };
  }

  /* Projector: lon/lat -> [x, y] in an w×h box, y down. */
  function makeProjector(bbox, w, h) {
    var midLat = (bbox.minLat + bbox.maxLat) / 2 * Math.PI / 180;
    var kx = Math.cos(midLat); // shrink lon degrees to true scale
    var x0 = bbox.minLon * kx, x1 = bbox.maxLon * kx;
    var y0 = bbox.minLat, y1 = bbox.maxLat;
    var sx = w / ((x1 - x0) || 1e-9);
    var sy = h / ((y1 - y0) || 1e-9);
    var s = Math.min(sx, sy); // uniform scale: no distortion
    var ox = (w - (x1 - x0) * s) / 2;
    var oy = (h - (y1 - y0) * s) / 2;
    var proj = function (lon, lat) {
      return [ox + (lon * kx - x0) * s, oy + (y1 - lat) * s];
    };
    /* inverse: svg map coords -> [lon, lat] (for pin-drop on the fallback) */
    proj.unproject = function (x, y) {
      return [(x - ox) / s / kx + bbox.minLon, y1 - (y - oy) / s];
    };
    return proj;
  }

  function escXml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ringPath(ring, proj) {
    var d = '';
    for (var i = 0; i < ring.length; i++) {
      var p = proj(ring[i][0], ring[i][1]);
      d += (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }
    return d + 'Z';
  }

  var PRI_FILL = { critical: '#e05252', high: '#e8a020', routine: '#7fb069' };
  var PARK_FILL = '#9ecfff';

  var lastProjector = null, lastW = 720, lastH = 460;

  /* Render the full map SVG for an org.
   * org: ORGS entry. opts: { parks: [{name,lat,lon}], reports: [{lat,lon,priority,category label...}],
   *   width, height }. Returns an SVG string. Pins outside the boundary are
   *   still shown — the view fits boundary + pins together. */
  function render(org, opts) {
    opts = opts || {};
    var W = opts.width || 720, H = opts.height || 460;
    var ring = org.boundary.features[0].geometry.coordinates[0];
    var boxes = [boundsOfRing(ring)];
    var pins = [];
    (opts.parks || []).forEach(function (p) {
      if (p.lat == null || p.lon == null) return;
      if (opts.trail && p.id === 'p-rrvt') return; /* the trail line carries it */
      pins.push({ kind: 'park', lon: p.lon, lat: p.lat, type: p.type || 'park',
                  label: p.name + (p.approx ? ' (approximate location)' : '') });
      boxes.push({ minLon: p.lon, minLat: p.lat, maxLon: p.lon, maxLat: p.lat });
    });
    (opts.reports || []).forEach(function (r) {
      if (r.lat == null || r.lon == null) return;
      pins.push({ kind: 'report', lon: r.lon, lat: r.lat,
                  label: r.label || 'Report',
                  fill: PRI_FILL[r.priority] || '#8a8a7a' });
      boxes.push({ minLon: r.lon, minLat: r.lat, maxLon: r.lon, maxLat: r.lat });
    });
    var bbox = unionBounds(boxes, 0.06);
    var proj = makeProjector(bbox, W, H);

    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + escXml(org.mapLabel) + '">';
    s += '<g id="map-zoomlayer">';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" class="map-bg"/>';
    s += '<path d="' + ringPath(ring, proj) + '" class="map-boundary"/>';
    /* Raccoon River Valley Trail: gold line under the dots, same weight as
     * the Leaflet layer. Data is [lat, lon] pairs (see js/trail.js). */
    (opts.trail || []).forEach(function (seg) {
      var d = '';
      for (var i = 0; i < seg.length; i++) {
        var tp = proj(seg[i][1], seg[i][0]);
        d += (i === 0 ? 'M' : 'L') + tp[0].toFixed(1) + ' ' + tp[1].toFixed(1);
      }
      s += '<path d="' + d + '" class="map-trail"><title>Raccoon River Valley Trail</title></path>';
    });
    pins.forEach(function (pin) {
      var p = proj(pin.lon, pin.lat);
      var x = p[0].toFixed(1), y = p[1].toFixed(1);
      if (pin.kind === 'park') {
        /* area icons, same set as the Leaflet map (Tanner 2026-09-21) */
        var aImg = 'assets/cats/area-' + (pin.type || 'park') + '.png';
        s += '<g class="map-park"><image x="' + (parseFloat(x) - 14) + '" y="' + (parseFloat(y) - 14) +
             '" width="28" height="28" href="' + aImg + '"/>' +
             '<text x="' + (parseFloat(x) + 17) + '" y="' + (parseFloat(y) + 4) + '">' +
             escXml(pin.label) + '</text><title>' + escXml(pin.label) + '</title></g>';
      } else {
        s += '<circle cx="' + x + '" cy="' + y + '" r="7" class="map-report" fill="' + pin.fill + '">' +
             '<title>' + escXml(pin.label) + '</title></circle>';
      }
    });
    s += '</g></svg>';
    lastProjector = proj; lastW = W; lastH = H;
    return s;
  }

  /* frame(org, opts) — same inputs as render(), but returns
   * { svg, project, W, H } so the caller can pan/zoom the <g id="map-zoomlayer">
   * and plot extra points (e.g. the user's location) in the same coordinates. */
  function frame(org, opts) {
    var svg = render(org, opts);
    return { svg: svg, project: lastProjector, W: lastW, H: lastH };
  }

  return {
    boundsOfRing: boundsOfRing,
    unionBounds: unionBounds,
    makeProjector: makeProjector,
    render: render,
    frame: frame
  };
})();

/* node test hook — harmless in browsers */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OrgMap;
}
