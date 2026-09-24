/* Planeador de rotas (RAPTOR) para a rede Metro Mondego + SMTUC.
 *
 * Corre inteiro no browser, sem backend. Lê data/network.json (ver
 * scripts/build_data.py) e devolve itinerários com horários e transbordos.
 * Também funciona em Node (module.exports) — é assim que é testado.
 *
 * Simplificações assumidas:
 *  - a pé: distância em linha reta × 1,3 a 1,2 m/s (sem motor de percursos);
 *  - o horário é o programado; não há tempo real;
 *  - um transbordo pede 60 s de margem quando é na mesma paragem.
 */
(function (root) {
  'use strict';

  var INF = 1e9;
  var WALK_SPEED = 1.2;        // m/s
  var DETOUR = 1.3;            // linha reta → percurso real
  var FOOT_MAX_M = 300;        // transbordo a pé entre paragens (linha reta)
  var FOOT_BUFFER = 20;        // s de margem em cada transbordo a pé
  var RIDE_SLACK = 60;         // s de margem ao trocar de autocarro na mesma paragem
  var ACCESS_M = 800;          // raio de procura de paragens junto à origem/destino
  var ACCESS_MAX = 30;         // máx. de paragens candidatas de cada lado
  var MAX_ROUNDS = 5;          // 1 a 5 viagens (até 4 transbordos)
  var DAY = 86400;

  function rad(d) { return d * Math.PI / 180; }
  function dist(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function walkSecs(m) { return Math.round(m * DETOUR / WALK_SPEED); }

  function norm(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---- calendário ------------------------------------------------------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }

  function easter(y) {  // algoritmo de Meeus/Jones/Butcher
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function isHoliday(d) {
    var y = d.getFullYear(), key = pad(d.getMonth() + 1) + pad(d.getDate());
    var fixed = ['0101', '0425', '0501', '0610', '0815', '1005', '1101', '1201', '1208', '1225',
      '0704'];  // 4 de julho: feriado municipal de Coimbra
    if (fixed.indexOf(key) >= 0) return true;
    var e = easter(y);
    return [-2, 0, 60].some(function (o) { return ymd(addDays(e, o)) === ymd(d); });
  }
  function dayType(d) {
    if (isHoliday(d) || d.getDay() === 0) return 'Dom';
    return d.getDay() === 6 ? 'Sab' : 'DU';
  }

  // ---- rede ------------------------------------------------------------
  function Network(data) {
    var self = this;
    this.built = data.built;
    this.smtucFeed = data.smtucFeed;
    this.cal = data.cal;
    this._footData = data.foot || null;
    this.serviceKeys = data.services;
    this.stops = data.stops.map(function (s, i) {
      return { id: i, name: s[0], lat: s[1], lon: s[2], op: s[3], code: s[4], norm: norm(s[0]) };
    });
    this.routes = data.routes.map(function (r) {
      return { short: r[0], long: r[1], color: '#' + r[2], text: '#' + r[3], op: r[4], type: r[5] };
    });
    this.patterns = data.patterns.map(function (p) {
      var n = p.s.length;
      var trips = p.t.map(function (t) {
        var times = new Int32Array(n);
        times[0] = t[1];
        for (var i = 1; i < n; i++) times[i] = times[i - 1] + t[i + 1];
        return { svc: t[0], times: times };
      });
      return { route: p.r, head: p.h, stops: Int32Array.from(p.s), trips: trips };
    });

    this.stopPatterns = this.stops.map(function () { return []; });
    this.patterns.forEach(function (p, pi) {
      for (var i = 0; i < p.stops.length; i++) self.stopPatterns[p.stops[i]].push([pi, i]);
    });

    this._buildFootpaths();
    this._buildPlaces();
  }

  Network.prototype._grid = function () {
    var g = {};
    this.stops.forEach(function (s) {
      var k = Math.floor(s.lat / 0.003) + ',' + Math.floor(s.lon / 0.004);
      (g[k] = g[k] || []).push(s.id);
    });
    return g;
  };

  Network.prototype._buildFootpaths = function () {
    var self = this, g = this._grid();
    this.foot = this.stops.map(function () { return []; });
    this._gridCache = g;
    if (this._footData) {     // tempos reais a pé (build_data.py), que já contornam rio, linha férrea, etc.
      Object.keys(this._footData).forEach(function (id) {
        self._footData[id].forEach(function (f) { self.foot[id].push([f[0], f[1] + FOOT_BUFFER]); });
      });
      return;
    }
    this.stops.forEach(function (s) {
      var cy = Math.floor(s.lat / 0.003), cx = Math.floor(s.lon / 0.004);
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        (g[(cy + dy) + ',' + (cx + dx)] || []).forEach(function (id) {
          if (id === s.id) return;
          var o = self.stops[id], d = dist(s.lat, s.lon, o.lat, o.lon);
          if (d <= FOOT_MAX_M) self.foot[s.id].push([id, walkSecs(d) + FOOT_BUFFER]);
        });
      }
    });
    this._gridCache = g;
  };

  // paragens candidatas a pé de um ponto: [{stop, secs, m}]
  Network.prototype.nearby = function (lat, lon) {
    var self = this;
    function within(r) {
      var out = [];
      var dLat = r / 111000, dLon = r / (111000 * Math.cos(rad(lat)));
      var y0 = Math.floor((lat - dLat) / 0.003), y1 = Math.floor((lat + dLat) / 0.003);
      var x0 = Math.floor((lon - dLon) / 0.004), x1 = Math.floor((lon + dLon) / 0.004);
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        (self._gridCache[y + ',' + x] || []).forEach(function (id) {
          var s = self.stops[id], d = dist(lat, lon, s.lat, s.lon);
          if (d <= r) out.push({ stop: id, m: d, secs: walkSecs(d) });
        });
      }
      return out.sort(function (a, b) { return a.m - b.m; });
    }
    var res = within(ACCESS_M);
    if (!res.length) res = within(2500);
    return res.slice(0, ACCESS_MAX);
  };

  // paragens candidatas (linha reta) a que se vai pedir o tempo real a pé
  Network.prototype.candidates = function (lat, lon) {
    var self = this, r = 1000, out = [];
    var dLat = r / 111000, dLon = r / (111000 * Math.cos(rad(lat)));
    var y0 = Math.floor((lat - dLat) / 0.003), y1 = Math.floor((lat + dLat) / 0.003);
    var x0 = Math.floor((lon - dLon) / 0.004), x1 = Math.floor((lon + dLon) / 0.004);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      (self._gridCache[y + ',' + x] || []).forEach(function (id) {
        var s = self.stops[id], d = dist(lat, lon, s.lat, s.lon);
        if (d <= r) out.push({ stop: id, d: d });
      });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, 40).map(function (o) { return o.stop; });
  };

  // ---- pesquisa de paragens por nome ------------------------------------
  // Junta as paragens do mesmo nome (os dois lados da rua, os dois operadores)
  // num só "lugar", posicionado no centro.
  Network.prototype._buildPlaces = function () {
    var byName = {};
    this.stops.forEach(function (s) { (byName[s.norm] = byName[s.norm] || []).push(s); });
    var places = [];
    Object.keys(byName).forEach(function (k) {
      var list = byName[k], clusters = [];
      list.forEach(function (s) {
        var c = clusters.find(function (c) { return dist(c.lat, c.lon, s.lat, s.lon) < 500; });
        if (!c) { c = { name: s.name, norm: k, lat: 0, lon: 0, ids: [], ops: {} }; clusters.push(c); }
        c.ids.push(s.id); c.ops[s.op] = 1;
        c.lat = (c.lat * (c.ids.length - 1) + s.lat) / c.ids.length;
        c.lon = (c.lon * (c.ids.length - 1) + s.lon) / c.ids.length;
      });
      clusters.forEach(function (c) { places.push(c); });
    });
    this.places = places;
  };

  Network.prototype.searchPlaces = function (q, limit) {
    var n = norm(q);
    if (n.length < 2) return [];
    var words = n.split(' ');
    var scored = [];
    this.places.forEach(function (p) {
      if (!words.every(function (w) { return p.norm.indexOf(w) >= 0; })) return;
      var score = p.norm === n ? 0 : p.norm.indexOf(n) === 0 ? 1 :
        p.norm.split(' ').some(function (w) { return w.indexOf(words[0]) === 0; }) ? 2 : 3;
      scored.push([score, p.norm.length, p]);
    });
    scored.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return scored.slice(0, limit || 6).map(function (x) { return x[2]; });
  };

  // ---- serviços ativos num dia -----------------------------------------
  Network.prototype.smtucCovers = function (d) {
    var f = this.smtucFeed, k = ymd(d);
    return k >= f.start && k <= f.end;
  };

  Network.prototype.activeServices = function (d) {
    var active = {}, keys = this.serviceKeys, cal = this.cal[ymd(d)] || [];
    cal.forEach(function (i) { active[i] = 1; });
    // tipo de dia do Metro Mondego: o calendário da SMTUC manda quando é claro
    var type = null;
    cal.forEach(function (i) {
      var k = keys[i];
      if (k.indexOf('sm:Domingos e Feriados') === 0) type = 'Dom';
      else if (k.indexOf('sm:Sábados') === 0) type = 'Sab';
      else if (k.indexOf('sm:Dias Úteis') === 0) type = 'DU';
    });
    type = type || dayType(d);
    keys.forEach(function (k, i) { if (k === 'mm:' + type) active[i] = 1; });
    return active;
  };

  // viagens de um dia, prontas para pesquisar (inclui as de ontem que passam da meia-noite)
  Network.prototype._instances = function (d) {
    var today = this.activeServices(d), yest = this.activeServices(addDays(d, -1));
    var all = [];
    this.patterns.forEach(function (p, pi) {
      var list = [];
      p.trips.forEach(function (t) {
        if (today[t.svc]) list.push({ times: t.times, pattern: pi });
        if (yest[t.svc] && t.times[t.times.length - 1] >= DAY) {
          var shifted = new Int32Array(t.times.length);
          for (var i = 0; i < shifted.length; i++) shifted[i] = t.times[i] - DAY;
          list.push({ times: shifted, pattern: pi });
        }
      });
      list.sort(function (a, b) { return a.times[0] - b.times[0]; });
      list.forEach(function (t, i) { t.idx = i; });
      all.push(list);
    });
    return all;
  };

  function findTrip(list, pos, ready) {   // 1.ª viagem que passa em `pos` às `ready` ou depois
    var lo = 0, hi = list.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].times[pos] >= ready) hi = mid; else lo = mid + 1;
    }
    // recuar caso haja ultrapassagens entre viagens
    while (lo > 0 && list[lo - 1].times[pos] >= ready) lo--;
    return lo < list.length ? list[lo] : null;
  }

  // ---- RAPTOR ----------------------------------------------------------
  // access/egress: [{stop, secs, m}]. Devolve os itinerários pareto (nº de viagens × chegada).
  Network.prototype._run = function (inst, access, egress, depTime) {
    var self = this, n = this.stops.length, K = MAX_ROUNDS;
    var egressSecs = new Float64Array(n).fill(-1);
    egress.forEach(function (e) { egressSecs[e.stop] = e.secs; });

    var tau = [], pType = [], pPat = [], pTrip = [], pBoard = [], pFrom = [], byRide = [];
    function layer(k) {
      if (k === 0) {
        tau[0] = new Int32Array(n).fill(INF); pType[0] = new Uint8Array(n);
        pPat[0] = new Int32Array(n); pTrip[0] = new Int32Array(n); pBoard[0] = new Int32Array(n);
        pFrom[0] = new Int32Array(n); byRide[0] = new Uint8Array(n);
      } else {
        tau[k] = tau[k - 1].slice(); pType[k] = pType[k - 1].slice(); pPat[k] = pPat[k - 1].slice();
        pTrip[k] = pTrip[k - 1].slice(); pBoard[k] = pBoard[k - 1].slice();
        pFrom[k] = pFrom[k - 1].slice(); byRide[k] = byRide[k - 1].slice();
      }
    }
    // pType: 0 nada · 1 acesso a pé · 2 viagem · 3 transbordo a pé
    layer(0);
    var best = new Int32Array(n).fill(INF), marked = [];
    access.forEach(function (a) {
      var t = depTime + a.secs;
      tau[0][a.stop] = t; best[a.stop] = t; pType[0][a.stop] = 1; marked.push(a.stop);
    });

    var results = [], bestDest = INF;
    for (var k = 1; k <= K && marked.length; k++) {
      layer(k);
      var Q = {};
      marked.forEach(function (s) {
        self.stopPatterns[s].forEach(function (pp) {
          if (Q[pp[0]] === undefined || pp[1] < Q[pp[0]]) Q[pp[0]] = pp[1];
        });
      });
      var rideMarked = {};
      Object.keys(Q).forEach(function (pk) {
        var pi = +pk, list = inst[pi], stops = self.patterns[pi].stops;
        if (!list.length) return;
        var cur = null, boardPos = 0;
        for (var i = Q[pk]; i < stops.length; i++) {
          var s = stops[i];
          if (cur) {
            var a = cur.times[i];
            if (a < best[s] && a < bestDest) {
              tau[k][s] = a; best[s] = a; pType[k][s] = 2; pPat[k][s] = pi;
              pTrip[k][s] = cur.idx; pBoard[k][s] = boardPos; byRide[k][s] = 1;
              rideMarked[s] = 1;
            }
          }
          var prev = tau[k - 1][s];
          if (prev < INF) {
            var ready = prev + (byRide[k - 1][s] ? RIDE_SLACK : 0);
            if (!cur || ready <= cur.times[i]) {
              var t = findTrip(list, i, ready);
              if (t && (!cur || t.times[i] < cur.times[i])) { cur = t; boardPos = i; }
            }
          }
        }
      });
      var next = Object.keys(rideMarked).map(Number), footMarked = {};
      next.forEach(function (s) {
        self.foot[s].forEach(function (f) {
          var a = tau[k][s] + f[1];
          if (a < best[f[0]] && a < bestDest) {
            tau[k][f[0]] = a; best[f[0]] = a; pType[k][f[0]] = 3; pFrom[k][f[0]] = s;
            byRide[k][f[0]] = 0; footMarked[f[0]] = 1;
          }
        });
      });
      Object.keys(footMarked).forEach(function (s) { if (!rideMarked[s]) next.push(+s); });
      marked = next;

      // melhor chegada ao destino nesta ronda
      var bestArr = INF, bestStop = -1;
      for (var s2 = 0; s2 < n; s2++) {
        if (egressSecs[s2] >= 0 && tau[k][s2] < INF && pType[k][s2] >= 2) {
          var arr = tau[k][s2] + egressSecs[s2];
          if (arr < bestArr) { bestArr = arr; bestStop = s2; }
        }
      }
      if (bestStop >= 0 && bestArr < bestDest) {
        bestDest = bestArr;
        results.push(this._backtrack(inst, k, bestStop, bestArr, depTime, access, egress,
          { tau: tau, pType: pType, pPat: pPat, pTrip: pTrip, pBoard: pBoard, pFrom: pFrom }));
      }
    }
    return results;
  };

  Network.prototype._backtrack = function (inst, k, stop, arr, depTime, access, egress, L) {
    var self = this, legs = [], s = stop, round = k;
    var eg = egress.filter(function (e) { return e.stop === stop; })[0];
    var trailingWalk = eg;
    while (round >= 0) {
      var t = L.pType[round][s];
      if (t === 2) {
        var pi = L.pPat[round][s], pat = self.patterns[pi], trip = inst[pi][L.pTrip[round][s]];
        var b = L.pBoard[round][s], alight = pat.stops.indexOf(s, b + 1);
        // a paragem pode repetir-se (circulares): procurar a posição certa
        var pos = -1;
        for (var i = b + 1; i < pat.stops.length; i++) {
          if (pat.stops[i] === s && trip.times[i] === L.tau[round][s]) { pos = i; break; }
        }
        if (pos < 0) pos = alight;
        legs.unshift({ type: 'ride', pattern: pi, route: pat.route, head: pat.head,
          board: b, alight: pos, times: trip.times, stops: pat.stops });
        s = pat.stops[b]; round--;
      } else if (t === 3) {
        var from = L.pFrom[round][s];
        legs.unshift({ type: 'walk', fromStop: from, toStop: s,
          secs: L.tau[round][s] - L.tau[round][from] });
        s = from;
      } else if (t === 1) {
        var ac = access.filter(function (a) { return a.stop === s; })[0];
        legs.unshift({ type: 'walk', fromOrigin: true, toStop: s, secs: ac.secs, m: ac.m });
        break;
      } else break;
    }
    if (trailingWalk) legs.push({ type: 'walk', fromStop: stop, toDest: true,
      secs: trailingWalk.secs, m: trailingWalk.m });
    return legs;
  };

  // converte as pernas cruas num itinerário com horas de cada troço
  Network.prototype._journey = function (legs, from, to) {
    var self = this, out = [], firstRide = legs.filter(function (l) { return l.type === 'ride'; })[0];
    var boardT = firstRide.times[firstRide.board];
    // a pé até à 1.ª paragem: sair o mais tarde possível
    var t = boardT;
    var pre = [];
    for (var i = 0; i < legs.length && legs[i] !== firstRide; i++) pre.push(legs[i]);
    var preSecs = pre.reduce(function (a, l) { return a + l.secs; }, 0);
    t = boardT - preSecs;
    var dep = t;
    legs.forEach(function (l) {
      if (l.type === 'walk') {
        var a = l.fromOrigin ? { name: from.name, lat: from.lat, lon: from.lon, origin: true } : self._pt(l.fromStop);
        var b = l.toDest ? { name: to.name, lat: to.lat, lon: to.lon, dest: true } : self._pt(l.toStop);
        out.push({ type: 'walk', from: a, to: b, start: t, end: t + l.secs, secs: l.secs,
          m: l.m ? Math.round(l.m) : Math.round(Math.max(0, l.secs - FOOT_BUFFER) * WALK_SPEED) });
        t += l.secs;
      } else {
        var r = self.routes[l.route], stops = [];
        for (var i = l.board; i <= l.alight; i++) {
          var st = self._pt(l.stops[i]); st.time = l.times[i]; stops.push(st);
        }
        out.push({ type: 'ride', route: r, head: l.head, from: stops[0], to: stops[stops.length - 1],
          start: l.times[l.board], end: l.times[l.alight], stops: stops,
          key: l.pattern + ':' + l.times[l.board] });
        t = l.times[l.alight];
      }
    });
    // junta a pé + a pé seguidos e tira caminhadas de menos de meio minuto
    var merged = [];
    out.forEach(function (l) {
      var last = merged[merged.length - 1];
      if (l.type === 'walk' && last && last.type === 'walk') {
        last.to = l.to; last.end = l.end; last.secs += l.secs; last.m += l.m;
      } else merged.push(l);
    });
    out = merged.filter(function (l) { return l.type !== 'walk' || l.secs >= 30 || l.from.origin || l.to.dest; });
    var rides = out.filter(function (l) { return l.type === 'ride'; });
    return { dep: dep, arr: t, legs: out, transfers: rides.length - 1,
      walk: out.reduce(function (a, l) { return a + (l.type === 'walk' ? l.secs : 0); }, 0),
      sig: rides.map(function (l) { return l.key; }).join('|') };
  };

  Network.prototype._pt = function (id) {
    var s = this.stops[id];
    return { id: id, name: s.name, lat: s.lat, lon: s.lon, op: s.op, code: s.code };
  };

  function dominated(a, b) {   // b domina a?
    return b !== a && b.dep >= a.dep && b.arr <= a.arr && b.transfers <= a.transfers &&
      (b.dep > a.dep || b.arr < a.arr || b.transfers < a.transfers);
  }

  /* opts: { from:{lat,lon,name}, to:{lat,lon,name}, date:Date, time:segundos,
   *         mode:'dep'|'arr', max:nº de opções }
   * Devolve { journeys, walkOnly, covered, warnings } */
  Network.prototype.plan = function (opts) {
    var max = opts.max || 5, mode = opts.mode || 'dep';
    var access = opts.access || this.nearby(opts.from.lat, opts.from.lon);
    var egress = opts.egress || this.nearby(opts.to.lat, opts.to.lon);
    var inst = this._instances(opts.date);
    var res = { journeys: [], walkOnly: null, warnings: [],
      covered: this.smtucCovers(opts.date) };
    if (!res.covered) res.warnings.push('smtuc-sem-dados');

    var direct = dist(opts.from.lat, opts.from.lon, opts.to.lat, opts.to.lon);
    if (opts.direct) { if (opts.direct.secs <= 1800) res.walkOnly = opts.direct; }
    else if (direct * DETOUR / WALK_SPEED <= 1800) res.walkOnly = { secs: walkSecs(direct), m: Math.round(direct * DETOUR) };
    res.noStops = !access.length || !egress.length;
    if (res.noStops) return res;

    var self = this, found = {}, list = [];
    var t = mode === 'arr' ? opts.time - 3 * 3600 : opts.time;
    var limit = mode === 'arr' ? opts.time : opts.time + 5 * 3600;
    for (var iter = 0; iter < 200 && t <= limit; iter++) {
      var runs = this._run(inst, access, egress, t);
      if (!runs.length) break;
      var minDep = INF;
      runs.forEach(function (legs) {
        var j = self._journey(legs, opts.from, opts.to);
        if (j.dep < minDep) minDep = j.dep;
        if (!found[j.sig]) { found[j.sig] = 1; list.push(j); }
      });
      t = Math.max(t, minDep) + 60;
      if (mode === 'dep') {
        var good = list.filter(function (j) { return !list.some(function (o) { return dominated(j, o); }); });
        if (good.length >= max + 2) break;
      }
    }
    list = list.filter(function (j) { return !list.some(function (o) { return dominated(j, o); }); });
    if (mode === 'arr') {
      list = list.filter(function (j) { return j.arr <= opts.time; });
      list.sort(function (a, b) { return a.dep - b.dep || a.arr - b.arr; });
      list = list.slice(-max);
    } else {
      list = list.filter(function (j) { return j.dep >= opts.time - 60; });
      list.sort(function (a, b) { return a.dep - b.dep || a.arr - b.arr; });
      list = list.slice(0, max);
    }
    res.journeys = list;
    return res;
  };

  var api = { Network: Network, dist: dist, norm: norm, dayType: dayType, isHoliday: isHoliday,
    walkSecs: walkSecs, ymd: ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Router = api;
})(typeof self !== 'undefined' ? self : this);
