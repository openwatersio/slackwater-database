"""Find at-rest episodes in one-minute vessel tracks.

Usage: python -I episodes.py <out_dir>   (reads minutes.csv; writes episodes.csv)

A minute is still when the vessel is within STILL_M of where it was WINDOW_MIN
minutes before and after (whichever neighbours exist). Where a track has no
sample inside the window, as in a simplified track, the adjacent samples
within MAX_GAP_MIN stand in. Still minutes form an
episode until a moving minute or a gap longer than MAX_GAP_MIN. Episodes
shorter than MIN_EPISODE_MIN or with a footprint (95th percentile distance
from the median position) over MAX_FOOTPRINT_M are dropped as drifting.
"""
import csv
import os
import sys
from collections import defaultdict

import numpy as np

STILL_M = 50
WINDOW_MIN = 5
MAX_GAP_MIN = int(os.environ.get("MAX_GAP_MIN", 30))
MIN_EPISODE_MIN = 60
MAX_FOOTPRINT_M = 150
FIELDS = ["vessel", "start", "end", "duration_h", "minutes", "lon", "lat", "footprint_m",
          "depth_median", "depth_p5", "depth_p95"]


def meters(lon1, lat1, lon2, lat2):
    k = 111_320.0
    dlon = (np.asarray(lon2) - lon1 + 180) % 360 - 180  # across the antimeridian
    return np.hypot(dlon * k * np.cos(np.radians((lat1 + lat2) / 2)), (lat2 - lat1) * k)


def lon_median(lons):
    """Median longitude that holds across the antimeridian."""
    ref = lons[0]
    return float((np.median(ref + (lons - ref + 180) % 360 - 180) + 180) % 360 - 180)


def still_mask(t, lon, lat):
    n = len(t)
    still = np.zeros(n, bool)
    back = np.searchsorted(t, t - WINDOW_MIN, side="left")
    fwd = np.searchsorted(t, t + WINDOW_MIN, side="right") - 1
    for i in range(n):
        b, f = back[i], fwd[i]
        if b == i and i > 0 and t[i] - t[i - 1] <= MAX_GAP_MIN:
            b = i - 1
        if f == i and i < n - 1 and t[i + 1] - t[i] <= MAX_GAP_MIN:
            f = i + 1
        ds = []
        if b < i:
            ds.append(meters(lon[i], lat[i], lon[b], lat[b]))
        if f > i:
            ds.append(meters(lon[i], lat[i], lon[f], lat[f]))
        still[i] = bool(ds) and max(ds) < STILL_M
    return still


def main():
    out = sys.argv[1]
    tracks = defaultdict(list)
    with open(os.path.join(out, "minutes.csv")) as f:
        for r in csv.DictReader(f):
            tracks[r["vessel"]].append((int(r["minute"]), float(r["lon"]), float(r["lat"]), float(r["depth"])))

    rows, totals = [], defaultdict(int)
    for vessel, pts in tracks.items():
        a = np.array(sorted(pts))
        t, lon, lat, depth = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
        still = still_mask(t, lon, lat)
        totals["minutes"] += len(t)
        totals["still_minutes"] += int(still.sum())
        start = None
        for i in range(len(t) + 1):
            breaks = i == len(t) or not still[i] or (start is not None and t[i] - t[i - 1] > MAX_GAP_MIN)
            if start is not None and breaks:
                s = slice(start, i)
                dur = t[i - 1] - t[start] + 1
                if dur >= MIN_EPISODE_MIN:
                    clon, clat = lon_median(lon[s]), np.median(lat[s])
                    foot = float(np.percentile(meters(clon, clat, lon[s], lat[s]), 95))
                    if foot <= MAX_FOOTPRINT_M:
                        rows.append({
                            "vessel": vessel,
                            "start": int(t[start]) * 60,
                            "end": int(t[i - 1]) * 60 + 60,
                            "duration_h": round(dur / 60, 2),
                            "minutes": i - start,
                            "lon": round(float(clon), 6),
                            "lat": round(float(clat), 6),
                            "footprint_m": round(foot, 1),
                            "depth_median": round(float(np.median(depth[s])), 2),
                            "depth_p5": round(float(np.percentile(depth[s], 5)), 2),
                            "depth_p95": round(float(np.percentile(depth[s], 95)), 2),
                        })
                start = None
            if i < len(t) and still[i] and start is None:
                start = i
    with open(os.path.join(out, "episodes.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(dict(totals), len(rows), "episodes", file=sys.stderr)


if __name__ == "__main__":
    main()
