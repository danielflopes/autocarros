#!/usr/bin/env python3
"""Gera v2/data/network.json a partir das duas fontes:

  - SMTUC: GTFS estático em dados.gov.pt (licença não especificada)
  - Metro Mondego: ficheiros do planeador https://planearviagem.metromondego.pt/
    (data/stops.json, data/route-shapes.json, data/trips-{DU,Sab,Dom}.json)

Só usa a biblioteca padrão. Uso:

    python3 v2/scripts/build_data.py            # descarrega e gera
    python3 v2/scripts/build_data.py --cache d  # reutiliza ficheiros já em d/

Formato de saída (tudo em segundos desde a meia-noite do dia de serviço;
podem passar de 86400 nas viagens que acabam depois da meia-noite):

  stops     [[nome, lat, lon, operador, código], ...]     operador 0=MM 1=SMTUC
  routes    [[curto, longo, cor, corTexto, operador, tipo], ...]
  services  ["mm:DU", "mm:Sab", "mm:Dom", "sm:<service_id>", ...]
  cal       {"YYYYMMDD": [índice de services SMTUC ativos nesse dia]}
  foot      {"idParagem": [[idVizinha, segundos a pé], ...]}  transbordos a pé reais
            (OSRM/FOSSGIS, perfil "foot"), só pares a menos de 300 m em linha reta
  patterns  [{r: rota, h: destino, s: [paragens], t: [[serviço, t0, d1..], ...]}]
            cada viagem: serviço, hora na 1.ª paragem, e o avanço (em s) de
            cada paragem seguinte relativamente à anterior.
"""
import argparse
import csv
import io
import json
import os
import math
import subprocess
import sys
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict

DADOS_API = ("https://dados.gov.pt/api/1/datasets/"
             "gtfs-estaticos-servicos-municipalizados-de-transportes-urbanos-de-coimbra/")
MM_BASE = "https://planearviagem.metromondego.pt/data/"
UA = {"User-Agent": "autocarros-v2-build/1.0"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "network.json")


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def curl(url):
    """O urllib falha o handshake TLS com este servidor (macOS/LibreSSL); o curl não."""
    return subprocess.run(["curl", "-sf", "-m", "30", "-A", UA["User-Agent"], url],
                          check=True, capture_output=True).stdout


def secs(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


class Net:
    def __init__(self):
        self.stops, self.routes, self.services, self.patterns = [], [], [], []
        self.cal = defaultdict(list)
        self._svc = {}
        self._route = {}

    def service(self, key):
        if key not in self._svc:
            self._svc[key] = len(self.services)
            self.services.append(key)
        return self._svc[key]

    def route(self, key, row):
        if key not in self._route:
            self._route[key] = len(self.routes)
            self.routes.append(row)
        return self._route[key]


def add_pattern(net, pat_index, route, headsign, stops, svc, times):
    """Junta uma viagem ao padrão (rota + sequência de paragens)."""
    key = (route, tuple(stops))
    p = pat_index.get(key)
    if p is None:
        p = {"r": route, "h": Counter(), "s": list(stops), "t": []}
        pat_index[key] = p
        net.patterns.append(p)
    p["h"][headsign] += 1
    deltas = [times[i] - times[i - 1] for i in range(1, len(times))]
    p["t"].append([svc, times[0]] + deltas)


def build_mm(net, cache):
    def load(name):
        return json.loads(cache(MM_BASE + name))

    mm_stops = load("stops.json")
    shapes = load("route-shapes.json")
    color = {s["line"]: s["color"].lstrip("#").upper() for s in shapes}

    idx = {}
    for s in mm_stops:
        idx[s["name"]] = len(net.stops)
        net.stops.append([s["name"], round(s["coords"]["lat"], 6),
                          round(s["coords"]["lng"], 6), 0, s["code"]])

    pat_index = {}
    for day in ("DU", "Sab", "Dom"):
        svc = net.service("mm:" + day)
        for t in load("trips-%s.json" % day):
            line = t["line"]
            r = net.route(("mm", line), [
                line, "Metrobus %s" % line, color.get(line, "FFCC00"),
                "000000", 0, 3])
            stops = [idx[s["name"]] for s in t["stops"]]
            times = [secs(s["time"]) for s in t["stops"]]
            add_pattern(net, pat_index, r, t["finalDestination"], stops, svc, times)


def build_smtuc(net, zbytes):
    z = zipfile.ZipFile(io.BytesIO(zbytes))

    def rows(name):
        with z.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))

    feed = rows("feed_info.txt")[0]
    net.smtuc_feed = {"start": feed["feed_start_date"], "end": feed["feed_end_date"],
                      "version": feed["feed_version"]}

    # rotas de recolha (deslocações para a garagem) não são serviço ao público
    routes = {}
    skipped = set()
    for r in rows("routes.txt"):
        if "recolha" in r["route_long_name"].lower():
            skipped.add(r["route_id"])
            continue
        routes[r["route_id"]] = net.route(("sm", r["route_id"]), [
            r["route_short_name"], r["route_long_name"], r["route_color"] or "FFC425",
            r["route_text_color"] or "FFFFFF", 1, int(r["route_type"])])

    stop_idx = {}
    for s in rows("stops.txt"):
        stop_idx[s["stop_id"]] = len(net.stops)
        net.stops.append([s["stop_name"], round(float(s["stop_lat"]), 6),
                          round(float(s["stop_lon"]), 6), 1, s["stop_code"]])

    trips = {t["trip_id"]: t for t in rows("trips.txt") if t["route_id"] in routes}

    for c in rows("calendar_dates.txt"):
        if c["exception_type"] == "1":
            net.cal[c["date"]].append(net.service("sm:" + c["service_id"]))
    # calendar.txt vem vazio neste feed; só há calendar_dates
    if len(rows("calendar.txt")):
        print("AVISO: calendar.txt tem linhas e é ignorado", file=sys.stderr)

    by_trip = defaultdict(list)
    for st in rows("stop_times.txt"):
        if st["trip_id"] in trips:
            by_trip[st["trip_id"]].append(st)

    pat_index = {}
    for tid, lst in by_trip.items():
        t = trips[tid]
        lst.sort(key=lambda s: int(s["stop_sequence"]))
        stops = [stop_idx[s["stop_id"]] for s in lst]
        times = [secs(s["arrival_time"]) for s in lst]
        svc = net.service("sm:" + t["service_id"])
        add_pattern(net, pat_index, routes[t["route_id"]], t["trip_headsign"].strip("* "),
                    stops, svc, times)
    return len(skipped)


# ---- transbordos a pé com percursos reais ----------------------------------
FOOT_API = "https://routing.openstreetmap.de/routed-foot/table/v1/foot/"
FOOT_STRAIGHT_M = 300      # só considera pares a menos disto em linha reta
FOOT_KEEP_S = 480          # e descarta os que a pé demorem mais de 8 min
FOOT_SRC, FOOT_DST = 30, 70  # origens × destinos por pedido (máx. 100 coordenadas)
FOOT_PAUSE = 1.0           # s entre pedidos: servidor público, e responde 429 se abusarmos


def haversine(a, b):
    r = math.radians
    dlat, dlon = r(b[0] - a[0]), r(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def foot_table(url):
    for attempt in range(8):
        try:
            d = json.loads(curl(url))
            if d.get("code") == "Ok":
                return d
        except Exception:      # noqa: BLE001  (429, rede…)
            pass
        wait = 20 * (attempt + 1)
        print("  servidor ocupado, a esperar %d s…" % wait, flush=True)
        time.sleep(wait)
    raise SystemExit("o servidor de percursos a pé não respondeu")


def build_foot(net, cache_path):
    """Tempo real a pé entre paragens próximas. Um pedido por zona (muitas
    origens × muitos destinos), com cache por par de coordenadas: repetir a
    corrida só pede o que falta."""
    cache = {}
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)

    def key(a, b):
        return "%.6f,%.6f|%.6f,%.6f" % (a[0], a[1], b[0], b[1])

    def save():
        if cache_path:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(cache, f, separators=(",", ":"))

    st = [(s[1], s[2]) for s in net.stops]
    cells = defaultdict(list)
    for i, (la, lo) in enumerate(st):
        cells[(int(la / 0.003), int(lo / 0.004))].append(i)

    pairs = set()
    for i, (la, lo) in enumerate(st):
        cy, cx = int(la / 0.003), int(lo / 0.004)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in cells.get((cy + dy, cx + dx), []):
                    if j > i and haversine(st[i], st[j]) <= FOOT_STRAIGHT_M:
                        pairs.add((i, j))

    def missing(i, j):
        return key(st[i], st[j]) not in cache

    # O servidor público atrasa ~9 s cada pedido depois do primeiro, por isso
    # o que conta é o nº de pedidos, não o tamanho: blocos grandes por zona
    # (30 origens × 70 destinos = 100 coordenadas, o máximo aceite).
    jobs = []
    for (cy, cx), src in cells.items():
        dst = [j for dy in (-1, 0, 1) for dx in (-1, 0, 1) for j in cells.get((cy + dy, cx + dx), [])]
        need = [i for i in src if any((min(i, j), max(i, j)) in pairs and missing(i, j) for j in dst)]
        for a in range(0, len(need), FOOT_SRC):
            for b in range(0, len(dst), FOOT_DST):
                jobs.append((need[a:a + FOOT_SRC], dst[b:b + FOOT_DST]))
    print("transbordos a pé: %d pares, até %d pedidos" % (len(pairs), len(jobs)))

    done = 0
    for si, di in jobs:
        want = [(i, j) for i in si for j in di
                if (min(i, j), max(i, j)) in pairs and missing(i, j)]
        if not want:
            continue
        coords = [st[i] for i in si] + [st[j] for j in di]
        url = (FOOT_API + ";".join("%.6f,%.6f" % (lo, la) for la, lo in coords) +
               "?sources=" + ";".join(str(n) for n in range(len(si))) +
               "&destinations=" + ";".join(str(len(si) + n) for n in range(len(di))))
        d = foot_table(url)
        for a, i in enumerate(si):
            for b, j in enumerate(di):
                secs = d["durations"][a][b]
                if (min(i, j), max(i, j)) in pairs:
                    v = None if secs is None else round(secs)
                    cache[key(st[i], st[j])] = v
                    cache[key(st[j], st[i])] = v
        time.sleep(FOOT_PAUSE)
        done += 1
        if done % 20 == 0:
            print("  %d pedidos feitos" % done, flush=True)
            save()
    save()

    foot = defaultdict(list)
    dropped = 0
    for i, j in pairs:
        secs = cache.get(key(st[i], st[j]))
        if secs is None or secs > FOOT_KEEP_S:
            dropped += 1
            continue
        foot[i].append([j, secs])
        foot[j].append([i, secs])      # a pé é simétrico
    print("transbordos a pé guardados: %d (descartados %d, p. ex. do outro lado do rio)"
          % (len(pairs) - dropped, dropped))
    return foot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="pasta onde guardar/reutilizar os ficheiros descarregados")
    ap.add_argument("--no-foot", action="store_true",
                    help="não calcular transbordos a pé reais (usa linha reta na app)")
    args = ap.parse_args()

    def cached(url):
        if not args.cache:
            return get(url)
        os.makedirs(args.cache, exist_ok=True)
        path = os.path.join(args.cache, url.replace("://", "_").replace("/", "_"))
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(get(url))
        with open(path, "rb") as f:
            return f.read()

    print("SMTUC: a obter o GTFS…")
    meta = json.loads(cached(DADOS_API))
    res = [r for r in meta["resources"] if r["format"].lower() == "zip"][0]
    zbytes = cached(res["url"])

    net = Net()
    print("Metro Mondego: a obter horários…")
    build_mm(net, cached)
    n_skip = build_smtuc(net, zbytes)

    foot = {}
    if not args.no_foot:
        foot = build_foot(net, os.path.join(ROOT, "scripts", ".cache", "foot.json"))

    for p in net.patterns:
        p["h"] = p["h"].most_common(1)[0][0]
        p["t"].sort(key=lambda t: t[1])

    out = {
        "built": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "smtucFeed": net.smtuc_feed,
        "stops": net.stops, "routes": net.routes, "services": net.services,
        "cal": net.cal, "foot": foot, "patterns": net.patterns,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    n_trips = sum(len(p["t"]) for p in net.patterns)
    print("paragens %d · rotas %d · padrões %d · viagens %d · rotas de recolha ignoradas %d"
          % (len(net.stops), len(net.routes), len(net.patterns), n_trips, n_skip))
    print("%s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
