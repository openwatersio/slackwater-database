"""Summarize at-rest episodes.

Usage: python -I summary.py <out_dir>   (reads episodes_tide.csv)

Location is reported by continent. Any cell with fewer than MIN_VESSELS
vessels is folded into "other", and "other" is left out if it is still that
small, so no row points at one boat's mooring.
"""
import sys

import numpy as np
import pandas as pd

MIN_VESSELS = 3

out = sys.argv[1]
# keep_default_na off for text columns, so Namibia's "NA" stays a country code.
e = pd.read_csv(f"{out}/episodes_tide.csv", dtype={"vessel": str, "country": str, "continent": str},
                keep_default_na=False, na_values={c: [""] for c in ["range_m", "tide_station_km", "tide_r2", "gain",
                                                                    "lag_min", "rms_m", "ref_km"]})
e["continent"] = e.continent.replace("", np.nan)

# Sites: each episode joins the first site whose first episode lies within
# 200 m, else starts a new one. This depends on episode order.
site, centers = np.empty(len(e), int), []
for i, (lo, la) in enumerate(zip(e.lon, e.lat)):
    for j, (clo, cla) in enumerate(centers):
        dlon = (lo - clo + 180) % 360 - 180  # across the antimeridian
        if np.hypot(dlon * 111320 * np.cos(np.radians(la)), (la - cla) * 111320) < 200:
            site[i] = j
            break
    else:
        centers.append((lo, la))
        site[i] = len(centers) - 1
e["site"] = site

e["length"] = pd.cut(e.duration_h, [1, 6, 13, 25, 72, 360, np.inf], right=False,
                     labels=["1–6 h", "6–13 h", "13–25 h", "1–3 d", "3–15 d", "15+ d"])
e["range"] = pd.cut(e.range_m, [0, 0.5, 1, 2, 4, np.inf], right=False,
                    labels=["< 0.5 m", "0.5–1 m", "1–2 m", "2–4 m", "4+ m"])
e["range"] = e["range"].cat.add_categories(["no tide reference", "no tide station"])
e.loc[e.range.isna(), "range"] = "no tide reference"
e.loc[e.tide_station_km.isna(), "range"] = "no tide station"
e["place"] = e.continent.fillna("no tide reference")
e.loc[e.tide_station_km.isna(), "place"] = "no tide station"
small = e.groupby("place").vessel.nunique() < MIN_VESSELS
e.loc[e.place.isin(small[small].index), "place"] = "other"
# "other" can itself be one boat; then it is left out of the location table.
if e.loc[e.place == "other", "vessel"].nunique() < MIN_VESSELS:
    e.loc[e.place == "other", "place"] = "suppressed"


def counts(g):
    return pd.Series({"episodes": len(g), "hours": round(g.duration_h.sum()), "vessels": g.vessel.nunique(),
                      "sites": g.site.nunique()})


def good_vessels(g):
    """Share of vessels whose own median tide R² is above 0.9, so a few prolific vessels can't dominate."""
    per_vessel = g.groupby("vessel").tide_r2.median()
    return f"{(per_vessel > 0.9).sum()} of {len(per_vessel)}"


def fits(g):
    return pd.Series({"fits": len(g), "good vessels": good_vessels(g), "tide R² median": g.tide_r2.median(),
                      "tide R² > 0.9": (g.tide_r2 > 0.9).mean(), "gain median": g.gain.median(),
                      "|lag| median (min)": g.lag_min.abs().median(), "RMS median (m)": g.rms_m.median()})


print("## Total\n", counts(e).to_dict(), "\n")
print("footprint p50/p90 m:", e.footprint_m.quantile([0.5, 0.9]).round(1).tolist(), "| minute coverage median:",
      round((e.minutes / (e.duration_h * 60)).median(), 2), "| hours with no tide station within 50 km:",
      f"{e[e.tide_station_km.isna()].duration_h.sum() / e.duration_h.sum():.0%}", "\n")
for col in ["length", "range", "place"]:
    table = e.groupby(col, observed=True).apply(counts, include_groups=False)
    if col == "place":
        table = table.drop("suppressed", errors="ignore").sort_values("hours", ascending=False)
    print(f"## By {col}\n", table.to_markdown(), "\n")
f = e[e.tide_r2.notna()]
print("## Fit by range\n", f.groupby("range", observed=True).apply(fits, include_groups=False).round(2).to_markdown(), "\n")
print("## Fit at 2 m or more, pooled\n", fits(f[f.range_m >= 2]).to_dict(), "\n")
print("## Fit by length\n", f.groupby("length", observed=True).apply(fits, include_groups=False).round(2).to_markdown(), "\n")
e.to_csv(f"{out}/episodes_final.csv", index=False)
