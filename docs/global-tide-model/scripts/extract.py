"""Reduce crowd soundings (Open Waters GeoJSON or NOAA CSB *_pointData.csv) to one-minute medians per vessel.

Usage: python -I extract.py <data_dir> <out_dir>
Writes minutes.csv (vessel,minute,n,lon,lat,depth) and files.csv (file metadata,
including how many soundings were skipped as unreadable).

EXCLUDE_VESSEL_PREFIX leaves out vessels already counted in another source,
such as SIGNALK- vessels in NOAA's copy of Open Waters submissions.
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from multiprocessing import Pool
from statistics import median


EXCLUDE = os.environ.get("EXCLUDE_VESSEL_PREFIX")


def parse_time(s):
    """CSB times are UTC; one without an offset is read as UTC, not local time."""
    t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).timestamp()


def unnamed(path):
    """Without an id, a file stands alone rather than merging with other unnamed vessels."""
    return "?" + os.path.relpath(path, sys.argv[1])


def excluded(vessel):
    return bool(EXCLUDE) and vessel.startswith(EXCLUDE)


def offset_distance(sensors):
    try:
        gnss = next((s for s in sensors if s.get("type") == "GNSS"), None)
        sounder = next((s for s in sensors if s.get("type") == "Sounder"), None)
        if not gnss or not sounder:
            return None
        g, s = gnss.get("position") or [0, 0], sounder.get("position") or [0, 0]
        return math.hypot(g[0] - s[0], g[1] - s[1])
    except Exception:
        return None


def sounding(lon, lat, depth, time):
    """Validated (lon, lat, depth, t), or None for anything unreadable or a missing-depth sentinel."""
    try:
        lon, lat, depth, t = float(lon), float(lat), float(depth), parse_time(time)
    except Exception:
        return None
    if not (math.isfinite(lon) and math.isfinite(lat) and math.isfinite(depth) and 0 < depth < 1000):
        return None
    return lon, lat, depth, t


def lon_median(lons):
    """Median longitude that holds across the antimeridian: unwrap around the first value, then rewrap."""
    ref = lons[0]
    m = median(ref + (x - ref + 180) % 360 - 180 for x in lons)
    return (m + 180) % 360 - 180


def minute_rows(vessel, buckets):
    return [(vessel, m, len(v), lon_median([x[0] for x in v]), median(x[1] for x in v), median(x[2] for x in v))
            for m, v in buckets.items()]


def process_csv(path):
    """NOAA CSB CSV: UNIQUE_ID,FILE_UUID,LON,LAT,DEPTH,TIME,PLATFORM_NAME,PROVIDER."""
    buckets = defaultdict(lambda: defaultdict(list))
    skipped, provider = defaultdict(int), {}
    try:
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                vessel = r.get("UNIQUE_ID") or unnamed(path)
                if excluded(vessel):
                    continue
                s = sounding(r.get("LON"), r.get("LAT"), r.get("DEPTH"), r.get("TIME"))
                if s is None:
                    skipped[vessel] += 1
                    continue
                provider[vessel] = r.get("PROVIDER") or ""
                buckets[vessel][int(s[3] // 60)].append(s)
    except Exception as e:
        return [], [], f"{path}: {e}"
    metas, rows = [], []
    for vessel in set(buckets) | set(skipped):
        b = buckets.get(vessel, {})
        times = [x[3] for v in b.values() for x in v]
        metas.append({"file": os.path.relpath(path, sys.argv[1]), "vessel": vessel, "version": provider.get(vessel, ""),
                      "vref": "", "offset_m": "", "points": len(times), "skipped": skipped[vessel],
                      "tmin": min(times, default=""), "tmax": max(times, default="")})
        rows += minute_rows(vessel, b)
    return metas, rows, None


def process(path):
    if path.endswith(".csv"):
        return process_csv(path)
    try:
        with open(path) as f:
            d = json.load(f)
        if not isinstance(d, dict):
            raise ValueError("not a GeoJSON object")
    except Exception as e:
        return [], [], f"{path}: {e}"
    props = d.get("properties") or {}
    tn = props.get("trustedNode") or {}
    platform = props.get("platform") or {}
    vessel = tn.get("uniqueVesselID") or platform.get("uniqueID") or unnamed(path)
    if excluded(vessel):
        return [], [], None
    buckets, times, skipped = defaultdict(list), [], 0
    for feat in d.get("features") or []:
        try:
            lon, lat = feat["geometry"]["coordinates"][:2]
            s = sounding(lon, lat, feat["properties"]["depth"], feat["properties"]["time"])
        except Exception:
            s = None
        if s is None:
            skipped += 1
            continue
        times.append(s[3])
        buckets[int(s[3] // 60)].append(s)
    meta = {
        "file": os.path.relpath(path, sys.argv[1]),
        "vessel": vessel,
        "version": tn.get("providerLoggerVersion", ""),
        "vref": tn.get("verticalReferenceOfDepth", ""),
        "offset_m": offset_distance(platform.get("sensors") or []),
        "points": len(times),
        "skipped": skipped,
        "tmin": min(times, default=""),
        "tmax": max(times, default=""),
    }
    return [meta], minute_rows(vessel, buckets), None


def main():
    data_dir, out_dir = sys.argv[1], sys.argv[2]
    paths = [os.path.join(r, f) for r, _, fs in os.walk(data_dir) for f in fs if f.endswith((".geojson", "_pointData.csv"))]
    best = {}
    with Pool() as pool, open(os.path.join(out_dir, "files.csv"), "w", newline="") as ff:
        fw = None
        for metas, rows, err in pool.imap_unordered(process, paths, chunksize=8):
            if err:
                print(err, file=sys.stderr)
                continue
            for meta in metas:
                if fw is None:
                    fw = csv.DictWriter(ff, fieldnames=list(meta))
                    fw.writeheader()
                fw.writerow(meta)
            # Overlapping uploads repeat soundings; keep the fullest bucket per
            # vessel-minute, breaking ties by value so file order doesn't matter.
            for r in rows:
                k = (r[0], r[1])
                if k not in best or (r[2], r[3:]) > (best[k][2], best[k][3:]):
                    best[k] = r
    with open(os.path.join(out_dir, "minutes.csv"), "w", newline="") as mf:
        w = csv.writer(mf)
        w.writerow(["vessel", "minute", "n", "lon", "lat", "depth"])
        w.writerows(sorted(best.values()))
    print(f"{len(paths)} files, {len(best)} vessel-minutes", file=sys.stderr)


if __name__ == "__main__":
    main()
