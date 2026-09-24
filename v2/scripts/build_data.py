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
  patterns  [{r: rota, h: destino, s: [paragens], t: [[serviço, t0, d1..], ...]}]
            cada viagem: serviço, hora na 1.ª paragem, e o avanço (em s) de
            cada paragem seguinte relativamente à anterior.
"""
import argparse
import csv
import io
import json
import os
import sys
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="pasta onde guardar/reutilizar os ficheiros descarregados")
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

    for p in net.patterns:
        p["h"] = p["h"].most_common(1)[0][0]
        p["t"].sort(key=lambda t: t[1])

    out = {
        "built": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "smtucFeed": net.smtuc_feed,
        "stops": net.stops, "routes": net.routes, "services": net.services,
        "cal": net.cal, "patterns": net.patterns,
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
