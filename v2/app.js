/* Interface do planeador. A lógica de rotas está em router.js. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var net = null;
  var state = { from: null, to: null, mode: 'now' };

  // ---- utilitários -----------------------------------------------------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(s) {
    s = Math.round(s / 60) * 60;
    var m = ((s % 86400) + 86400) % 86400;
    return pad(Math.floor(m / 3600)) + ':' + pad(Math.floor(m % 3600 / 60));
  }
  function dur(s) {
    var m = Math.max(1, Math.round(s / 60));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? pad(m % 60) + ' min' : '');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dateInputValue(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function textOn(hex) {   // preto ou branco, conforme o fundo
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111' : '#fff';
  }
  function pill(route) {
    var c = route.color;
    if (route.type === 7) c = '#5b9dff';
    return '<span class="chip" style="background:' + c + ';color:' + textOn(c) + '">' + esc(route.short) + '</span>';
  }
  // "m" amarelo numa bolinha: paragem do Metro Mondego (op 0), para distinguir das da SMTUC
  function mb(op) { return op === 0 ? '<span class="mb" title="Paragem Metro Mondego">m</span>' : ''; }
  function stopName(s) { return mb(s.op) + esc(s.name); }

  var WALK_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M8 22l3-8-2-3 4-3 3 4h3M11 14l4 2 1 6M9 11l-3 2"/></svg>';

  // ---- pesquisa de lugares (paragens locais + OpenStreetMap/Photon) ----
  var PHOTON = 'https://photon.komoot.io/api/';
  var BBOX = '-8.80,39.95,-8.00,40.50';    // zona de Coimbra e arredores

  function photonLabel(p) {
    var name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
    var sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '',
      p.district, p.city || p.county].filter(Boolean);
    return { name: name, sub: sub.filter(function (v, i) { return sub.indexOf(v) === i; }).join(', ') };
  }

  function photon(q, signal) {
    var url = PHOTON + '?q=' + encodeURIComponent(q) + '&limit=6&lat=40.2033&lon=-8.4103' +
      '&location_bias_scale=0.6&bbox=' + BBOX;
    return fetch(url, { signal: signal }).then(function (r) {
      if (!r.ok) throw new Error('photon ' + r.status);
      return r.json();
    }).then(function (j) {
      return (j.features || []).filter(function (f) {
        var p = f.properties;
        return p.osm_value !== 'bus_stop' && p.osm_value !== 'platform' && (p.name || p.street);
      }).map(function (f) {
        var l = photonLabel(f.properties);
        return { name: l.name, sub: l.sub, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: 'osm' };
      });
    });
  }

  function setupField(key) {
    var input = $(key === 'from' ? 'inFrom' : 'inTo');
    var box = $(key === 'from' ? 'sgFrom' : 'sgTo');
    var timer = null, ctrl = null, items = [], hl = -1;

    function close() { box.classList.remove('open'); box.innerHTML = ''; items = []; hl = -1; }

    function paint(local, remote, note) {
      items = local.map(function (p) { return { name: p.name, sub: 'Paragem', lat: p.lat, lon: p.lon, kind: 'stop', tag: true, mm: !!p.ops[0] }; })
        .concat(remote || []);
      var html = items.map(function (it, i) {
        return '<div class="it' + (i === hl ? ' hl' : '') + '" data-i="' + i + '"><div class="n">' + (it.mm ? mb(0) : '') + esc(it.name) +
          (it.tag ? '<span class="tag">PARAGEM</span>' : '') + '</div>' +
          (it.sub && !it.tag ? '<div class="s">' + esc(it.sub) + '</div>' : '') + '</div>';
      }).join('');
      if (note) html += '<div class="msg">' + note + '</div>';
      box.innerHTML = html;
      box.classList.toggle('open', !!html);
    }

    function pick(it) {
      state[key] = { name: it.name, lat: it.lat, lon: it.lon, kind: it.kind };
      input.value = it.name;
      close(); input.blur();
      save(); refreshGo();
    }

    input.addEventListener('input', function () {
      state[key] = null; refreshGo();
      var q = input.value.trim();
      if (ctrl) ctrl.abort();
      clearTimeout(timer);
      if (q.length < 2) { close(); return; }
      var local = net ? net.searchPlaces(q, 4) : [];
      paint(local, [], q.length >= 3 ? '<span class="spin"></span>a procurar moradas e sítios…' : '');
      if (q.length < 3) return;
      timer = setTimeout(function () {
        ctrl = new AbortController();
        photon(q, ctrl.signal).then(function (remote) {
          if (input.value.trim() !== q) return;
          paint(local, remote, remote.length || local.length ? '' : 'Sem resultados.');
        }).catch(function (e) {
          if (e.name === 'AbortError') return;
          if (input.value.trim() === q) paint(local, [], local.length ? 'Moradas indisponíveis de momento.' : 'Pesquisa de moradas indisponível.');
        });
      }, 350);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (items.length) pick(items[Math.max(hl, 0)]);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        Array.prototype.forEach.call(box.querySelectorAll('.it'), function (el, i) { el.classList.toggle('hl', i === hl); });
      } else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', function (e) { e.preventDefault(); });   // não perder o foco antes do clique
    box.addEventListener('click', function (e) {
      var el = e.target.closest('.it');
      if (el) pick(items[+el.dataset.i]);
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('focus', function () { input.select(); });
  }

  // ---- estado guardado --------------------------------------------------
  function save() {
    try { localStorage.setItem('aut2:last', JSON.stringify({ from: state.from, to: state.to })); } catch (e) { /* sem storage */ }
  }
  function restore() {
    try {
      var s = JSON.parse(localStorage.getItem('aut2:last') || 'null');
      if (s) {
        if (s.from) { state.from = s.from; $('inFrom').value = s.from.name; }
        if (s.to) { state.to = s.to; $('inTo').value = s.to.name; }
      }
    } catch (e) { /* ignorar */ }
  }

  function refreshGo() {
    var b = $('go');
    b.disabled = !(net && state.from && state.to);
    b.textContent = !net ? 'A carregar horários…' : 'Procurar itinerários';
  }

  // ---- data e hora ------------------------------------------------------
  function setMode(m) {
    state.mode = m;
    Array.prototype.forEach.call(document.querySelectorAll('#mode button'), function (b) {
      b.classList.toggle('on', b.dataset.m === m);
    });
    $('inDate').disabled = $('inTime').disabled = (m === 'now');
    if (m === 'now') fillNow();
  }
  function fillNow() {
    var d = new Date();
    $('inDate').value = dateInputValue(d);
    $('inTime').value = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ---- geolocalização ---------------------------------------------------
  function locate() {
    if (!navigator.geolocation) { alert('Este browser não dá acesso à localização.'); return; }
    var btn = $('gps'); btn.style.color = 'var(--amber)';
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.style.color = '';
      state.from = { name: 'A minha localização', lat: pos.coords.latitude, lon: pos.coords.longitude, kind: 'gps' };
      $('inFrom').value = state.from.name; save(); refreshGo();
    }, function () {
      btn.style.color = '';
      alert('Não consegui obter a localização. Verifica a permissão do browser.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  // ---- mapa -------------------------------------------------------------
  var map = null, layer = null;
  function ensureMap() {
    if (map || typeof L === 'undefined') return map;
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([40.2033, -8.4103], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    return map;
  }
  function drawJourney(j) {
    if (!ensureMap()) return;
    $('map').classList.add('show');
    map.invalidateSize();
    layer.clearLayers();
    var pts = [];
    j.legs.forEach(function (l) {
      if (l.type === 'walk') {
        var a = [l.from.lat, l.from.lon], b = [l.to.lat, l.to.lon];
        L.polyline([a, b], { color: '#9aa5a1', weight: 3, dashArray: '2 6', opacity: .9 }).addTo(layer);
        pts.push(a, b);
      } else {
        var line = l.stops.map(function (s) { return [s.lat, s.lon]; });
        var c = l.route.type === 7 ? '#5b9dff' : l.route.color;
        L.polyline(line, { color: '#000', weight: 8, opacity: .5 }).addTo(layer);
        L.polyline(line, { color: c, weight: 5 }).addTo(layer);
        [l.from, l.to].forEach(function (s) {
          var mk = s.op === 0
            ? L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<span class="mb mapb">m</span>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
            : L.circleMarker([s.lat, s.lon], { radius: 5, color: '#0b0f0e', weight: 2, fillColor: '#fff', fillOpacity: 1 });
          mk.bindTooltip(esc(s.name)).addTo(layer);
        });
        pts = pts.concat(line);
      }
    });
    var o = j.legs[0].from, d = j.legs[j.legs.length - 1].to;
    L.circleMarker([o.lat, o.lon], { radius: 8, color: '#0b0f0e', weight: 2, fillColor: '#34d1c0', fillOpacity: 1 }).addTo(layer);
    L.circleMarker([d.lat, d.lon], { radius: 8, color: '#0b0f0e', weight: 2, fillColor: '#ff7597', fillOpacity: 1 }).addTo(layer);
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 });
  }

  // ---- resultados -------------------------------------------------------
  function legHtml(l) {
    if (l.type === 'walk') {
      var to = l.to.dest ? esc(l.to.name) : stopName(l.to);
      return '<div class="leg"><div class="tm dim">' + hm(l.start) + '</div><div class="bd">' +
        '<div class="st" style="font-weight:500;color:var(--muted)">' + WALK_SVG + ' A pé ' + dur(l.secs) + ' · ' + l.m + ' m</div>' +
        '<div class="sm">' + (l.from.origin ? 'até à paragem ' : 'até ') + '<b style="color:var(--ink);font-weight:600">' + to + '</b></div></div></div>';
    }
    var n = l.stops.length - 1;
    var mid = l.stops.slice(1, -1).map(function (s) {
      return '<li><span class="mono">' + hm(s.time) + '</span><span>' + stopName(s) + '</span></li>';
    }).join('');
    return '<div class="leg"><div class="tm">' + hm(l.start) + '</div><div class="bd" style="border-left-color:' +
      (l.route.type === 7 ? '#5b9dff' : l.route.color) + '">' +
      '<div class="st">' + stopName(l.from) + '</div>' +
      '<div class="sm"><span class="line">' + pill(l.route) + '</span>direção <b style="color:var(--ink);font-weight:600">' + esc(l.head) + '</b> · ' +
      n + (n === 1 ? ' paragem' : ' paragens') + ' · ' + dur(l.end - l.start) + '</div>' +
      (mid ? '<button class="toggle" type="button" data-stops>ver paragens</button><ul class="stoplist" hidden>' + mid + '</ul>' : '') +
      '</div></div>' +
      '<div class="leg"><div class="tm">' + hm(l.end) + '</div><div class="bd" style="border-left-color:transparent;padding-bottom:0">' +
      '<div class="st">' + stopName(l.to) + '</div></div></div>';
  }

  // Links para abrir a rota nas apps de mapas, que têm o trânsito e os atrasos em tempo real.
  // Não dá para lhes passar a hora nem o itinerário exato: recalculam a partir de "agora".
  function shareRow(a, b) {
    var o = a.lat + ',' + a.lon, d = b.lat + ',' + b.lon;
    var g = 'https://www.google.com/maps/dir/?api=1&travelmode=transit&origin=' + o + '&destination=' + d;
    var ap = 'https://maps.apple.com/?dirflg=r&saddr=' + o + '&daddr=' + d;
    return '<div class="share"><span>Ver em tempo real</span>' +
      '<a href="' + g + '" target="_blank" rel="noopener">Google Maps</a>' +
      '<a href="' + ap + '" target="_blank" rel="noopener">Apple Maps</a></div>';
  }

  function renderJourneys(res, mode) {
    var box = $('results'), banner = $('banner'), html = '';
    banner.innerHTML = '';
    if (res.warnings.indexOf('smtuc-sem-dados') >= 0) {
      var f = net.smtucFeed;
      banner.innerHTML = '<div class="warn">A SMTUC não tem horários publicados para esta data (o ficheiro cobre ' +
        fmtYmd(f.start) + ' a ' + fmtYmd(f.end) + '). Só aparecem serviços do Metro Mondego.</div>';
    }
    if (!res.noStops) html += shareRow(state.from, state.to);
    if (res.walkOnly) {
      html += '<div class="walkonly">A pé: <b>' + dur(res.walkOnly.secs) + '</b> · ' + res.walkOnly.m + ' m</div>';
    }
    if (res.noStops) {
      html += '<div class="card empty">Não há paragens a menos de 2,5 km de um dos pontos.</div>';
    } else if (!res.journeys.length) {
      html += '<div class="card empty">Sem itinerários ' + (mode === 'arr' ? 'que cheguem a tempo' : 'a partir dessa hora') +
        '.<br>Tenta outra hora, ou outro dia (à noite quase não há serviço).</div>';
    }
    var fastest = -1, minDur = Infinity, tie = false;
    res.journeys.forEach(function (j, i) {
      var d = j.arr - j.dep;
      if (d < minDur) { minDur = d; fastest = i; tie = false; } else if (d === minDur) tie = true;
    });
    if (tie) fastest = -1;    // só destaca quando há mesmo um mais rápido
    res.journeys.forEach(function (j, i) {
      var chips = j.legs.map(function (l) {
        return l.type === 'walk'
          ? '<span class="chip w">' + WALK_SVG + Math.max(1, Math.round(l.secs / 60)) + '\'</span>'
          : pill(l.route);
      }).join('<span class="sep">›</span>');
      html += '<article class="jr" data-i="' + i + '"><button class="jr-head" type="button">' +
        '<div class="jr-times"><div class="t mono">' + hm(j.dep) + '<i>→</i>' + hm(j.arr) + '</div>' +
        '<div class="d"><b>' + dur(j.arr - j.dep) + '</b></div></div>' +
        '<div class="chips">' + chips + '</div>' +
        '<div class="jr-sub">' + (j.transfers === 0 ? 'Direto' : j.transfers + (j.transfers === 1 ? ' transbordo' : ' transbordos')) +
        ' · ' + Math.round(j.walk / 60) + ' min a pé' +
        (i === fastest && res.journeys.length > 1 ? '<span class="best">mais rápido</span>' : '') + '</div>' +
        '</button><div class="detail">' + j.legs.map(legHtml).join('') + '</div></article>';
    });
    box.innerHTML = html;
    state.journeys = res.journeys;
    if (res.journeys.length) select(0);
    else if (map) { $('map').classList.remove('show'); }
  }

  function fmtYmd(s) { return s.slice(6, 8) + '/' + s.slice(4, 6) + '/' + s.slice(0, 4); }

  function select(i) {
    Array.prototype.forEach.call(document.querySelectorAll('.jr'), function (el) {
      el.classList.toggle('sel', +el.dataset.i === i);
    });
    drawJourney(state.journeys[i]);
  }

  $('results').addEventListener('click', function (e) {
    var t = e.target.closest('[data-stops]');
    if (t) {
      var ul = t.nextElementSibling; ul.hidden = !ul.hidden;
      t.textContent = ul.hidden ? 'ver paragens' : 'esconder paragens';
      return;
    }
    var art = e.target.closest('.jr');
    if (art && e.target.closest('.jr-head')) select(+art.dataset.i);
  });

  // ---- pesquisar --------------------------------------------------------
  function search() {
    if (!net || !state.from || !state.to) return;
    if (state.mode === 'now') fillNow();
    var dv = $('inDate').value, tv = $('inTime').value;
    if (!dv || !tv) { alert('Escolhe a data e a hora.'); return; }
    var p = dv.split('-'), q = tv.split(':');
    var date = new Date(+p[0], +p[1] - 1, +p[2]);
    var mode = state.mode === 'arr' ? 'arr' : 'dep';
    $('go').disabled = true;
    setTimeout(function () {      // deixa o botão pintar antes do cálculo
      var res;
      try {
        res = net.plan({ from: state.from, to: state.to, date: date, time: +q[0] * 3600 + +q[1] * 60, mode: mode, max: 5 });
      } catch (err) {
        console.error(err);
        $('results').innerHTML = '<div class="card empty">Erro ao calcular o itinerário.</div>';
        refreshGo(); return;
      }
      renderJourneys(res, mode);
      refreshGo();
      (res.journeys.length ? $('map') : $('results')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 20);
  }

  // ---- arranque ---------------------------------------------------------
  function init() {
    setupField('from'); setupField('to');
    restore(); fillNow(); setMode('now');
    $('mode').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (b) setMode(b.dataset.m);
    });
    $('go').addEventListener('click', search);
    $('gps').addEventListener('click', locate);
    $('swap').addEventListener('click', function () {
      var t = state.from; state.from = state.to; state.to = t;
      var v = $('inFrom').value; $('inFrom').value = $('inTo').value; $('inTo').value = v;
      save(); refreshGo();
    });
    refreshGo();

    fetch('data/network.json').then(function (r) {
      if (!r.ok) throw new Error('network.json ' + r.status);
      return r.json();
    }).then(function (data) {
      net = new Router.Network(data);
      var f = net.smtucFeed;
      $('feedInfo').textContent = 'SMTUC até ' + fmtYmd(f.end).slice(0, 5);
      refreshGo();
    }).catch(function (e) {
      console.error(e);
      $('go').textContent = 'Erro a carregar os horários';
    });
  }
  init();
})();
