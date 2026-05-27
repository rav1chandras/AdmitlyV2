#!/usr/bin/env python3
"""
extract_colleges.py
────────────────────────────────────────────────────────────────────────────────
Extracts all US colleges from the College Scorecard API into a CSV file.

Usage (PowerShell):
    $env:SCORECARD_API_KEY = "your_key_here"
    python scripts/extract_colleges.py

    MacOS:
    export SCORECARD_API_KEY="JoRWTvc604MXHg0Zdnw6SD8OidIK3v4clckT71aO"
    python scripts/extract_colleges.py --debug

Output: data/colleges_master.csv  ← commit this to the repo
────────────────────────────────────────────────────────────────────────────────
"""

import os, sys, csv, time, requests
from datetime import date
from pathlib import Path

API_KEY   = os.environ.get("SCORECARD_API_KEY")
BASE_URL  = "https://api.data.gov/ed/collegescorecard/v1/schools"
PER_PAGE  = 100
DELAY_SEC = 0.65
OUT_DIR   = Path(__file__).parent.parent / "data"
OUT_FILE  = OUT_DIR / "colleges_master.csv"

if not API_KEY:
    print("ERROR: Set SCORECARD_API_KEY")
    print("  PowerShell: $env:SCORECARD_API_KEY = 'your_key_here'")
    sys.exit(1)

# ── Filters ───────────────────────────────────────────────────────────────────
FILTER_STR = "school.operating=1&school.main_campus=1&school.degrees_awarded.predominant__range=2..4"

# ── API fields ────────────────────────────────────────────────────────────────
# Ordered to mirror CSV_COLUMNS for easy auditing.
# sat_range / act_range are COMPUTED in map_row — no API field needed.
# net_price requires both public + private keys; one will be null per school.
FIELDS = ",".join([
    # school info
    "ope6_id",
    "school.name",
    "school.city",
    "school.state",
    "school.zip",
    "school.school_url",
    "school.ownership",
    "school.locale",
    "school.carnegie_basic",
    # admissions
    "latest.admissions.admission_rate.overall",
    "latest.admissions.sat_scores.25th_percentile.math",
    "latest.admissions.sat_scores.75th_percentile.math",
    "latest.admissions.sat_scores.25th_percentile.critical_reading",
    "latest.admissions.sat_scores.75th_percentile.critical_reading",
    "latest.admissions.sat_scores.average.overall",
    # sat_range → computed, no field
    "latest.admissions.act_scores.25th_percentile.cumulative",
    "latest.admissions.act_scores.75th_percentile.cumulative",
    "latest.admissions.act_scores.midpoint.cumulative",
    # act_range → computed, no field
    # students
    "latest.student.size",
    "latest.student.retention_rate.four_year.full_time",
    "latest.student.demographics.student_faculty_ratio",
    # demographics (order matches CSV_COLUMNS)
    "latest.student.demographics.men",
    "latest.student.demographics.women",
    "latest.student.demographics.race_ethnicity.white",
    "latest.student.demographics.race_ethnicity.black",
    "latest.student.demographics.race_ethnicity.hispanic",
    "latest.student.demographics.race_ethnicity.asian",
    "latest.student.demographics.race_ethnicity.two_or_more",
    # cost (order matches CSV_COLUMNS)
    "latest.cost.tuition.in_state",
    "latest.cost.tuition.out_of_state",
    "latest.cost.avg_net_price.public",
    "latest.cost.avg_net_price.private",
    "latest.cost.attendance.academic_year",
    # aid
    "latest.aid.median_debt.completers.overall",
    "latest.aid.pell_grant_rate",
    "latest.aid.federal_loan_rate",
    # outcomes
    "latest.completion.rate_suppressed.four_year",
    "latest.earnings.6_yrs_after_entry.working_not_enrolled.mean_earnings",
    "latest.earnings.8_yrs_after_entry.median_earnings",
    "latest.earnings.10_yrs_after_entry.median",
])

# ── CSV columns — must match map_row() output keys exactly, same order ────────
CSV_COLUMNS = [
    # school info
    "ope6_id", "name", "city", "state", "zip", "college_url",
    "ownership", "locale", "carnegie_basic",
    # admissions
    "acceptance_rate",
    "sat_25", "sat_75", "sat_math_25", "sat_math_75", "sat_cr_25", "sat_cr_75", "sat_avg", "sat_range",
    "act_25", "act_75", "act_mid", "act_range",
    # students
    "enrollment", "retention_rate", "student_faculty_ratio",
    # demographics
    "pct_men", "pct_women",
    "pct_white", "pct_black", "pct_hispanic", "pct_asian", "pct_two_or_more",
    # cost
    "tuition_in_state", "tuition_out_state", "net_price", "cost_attendance",
    # aid
    "median_debt", "pell_rate", "loan_rate",
    # outcomes
    "grad_rate", "earnings_6yr", "earnings_8yr", "earnings_10yr",
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def pct(v):
    """Convert 0–1 fraction → rounded percentage, or '' if missing."""
    if v is None or v == "PS": return ""
    try: return round(float(v) * 100, 1)
    except: return ""

def num(v):
    """Round numeric value, or '' if missing."""
    if v is None or v == "PS": return ""
    try: return round(float(v))
    except: return ""

def ownership_label(c):
    return {1: "Public", 2: "Private", 3: "For-Profit"}.get(c, "")

def locale_label(c):
    if c is None: return ""
    if 11 <= c <= 13: return "City"
    if 21 <= c <= 23: return "Suburb"
    if 31 <= c <= 32: return "Town"
    if 41 <= c <= 43: return "Rural"
    return ""

def map_row(r):
    """
    Map a flat Scorecard API result → CSV row dict.
    Keys must match CSV_COLUMNS exactly (same names, same order).
    """
    def g(key): return r.get(key)

    ownership_code = g("school.ownership")
    is_public      = ownership_code == 1

    # FIXED: cumulative composite (0–1600), not critical_reading (0–800)

    sat_math_25 = num(g("latest.admissions.sat_scores.25th_percentile.math"))
    sat_math_75 = num(g("latest.admissions.sat_scores.75th_percentile.math"))
    sat_cr_25   = num(g("latest.admissions.sat_scores.25th_percentile.critical_reading"))
    sat_cr_75   = num(g("latest.admissions.sat_scores.75th_percentile.critical_reading"))
    sat_25 = num(g("latest.admissions.sat_scores.25th_percentile.math")) + num(g("latest.admissions.sat_scores.25th_percentile.critical_reading"))
    sat_75 = num(g("latest.admissions.sat_scores.75th_percentile.math")) + num(g("latest.admissions.sat_scores.75th_percentile.critical_reading"))
    act_25 = num(g("latest.admissions.act_scores.25th_percentile.cumulative"))
    act_75 = num(g("latest.admissions.act_scores.75th_percentile.cumulative"))

    net_price_key = (
        "latest.cost.avg_net_price.public"
        if is_public else
        "latest.cost.avg_net_price.private"
    )

    return {
        # school info
        "ope6_id":          g("ope6_id") or "",
        "name":            g("school.name") or "",
        "city":            g("school.city") or "",
        "state":           g("school.state") or "",
        "zip":             g("school.zip") or "",
        "college_url":     g("school.school_url") or "",
        "ownership":       ownership_label(ownership_code),
        "locale":          locale_label(g("school.locale")),
        "carnegie_basic":  g("school.carnegie_basic") or "",
        # admissions
        "acceptance_rate": pct(g("latest.admissions.admission_rate.overall")),
        "sat_25":          sat_25,
        "sat_75":          sat_75,
        "sat_math_25":     sat_math_25,
        "sat_math_75":     sat_math_75,
        "sat_cr_25":       sat_cr_25,
        "sat_cr_75":       sat_cr_75,
        "sat_avg":         num(g("latest.admissions.sat_scores.average.overall")),
        "sat_range":       f"{sat_25}-{sat_75}" if sat_25 and sat_75 else "",
        "act_25":          act_25,
        "act_75":          act_75,
        "act_mid":         num(g("latest.admissions.act_scores.midpoint.cumulative")),
        "act_range":       f"{act_25}-{act_75}" if act_25 and act_75 else "",
        # students
        "enrollment":           num(g("latest.student.size")),
        "retention_rate":       pct(g("latest.student.retention_rate.four_year.full_time")),
        "student_faculty_ratio": num(g("latest.student.demographics.student_faculty_ratio")),
        # demographics (same order as CSV_COLUMNS)
        "pct_men":         pct(g("latest.student.demographics.men")),
        "pct_women":       pct(g("latest.student.demographics.women")),
        "pct_white":       pct(g("latest.student.demographics.race_ethnicity.white")),
        "pct_black":       pct(g("latest.student.demographics.race_ethnicity.black")),
        "pct_hispanic":    pct(g("latest.student.demographics.race_ethnicity.hispanic")),
        "pct_asian":       pct(g("latest.student.demographics.race_ethnicity.asian")),
        "pct_two_or_more": pct(g("latest.student.demographics.race_ethnicity.two_or_more")),
        # cost
        "tuition_in_state":  num(g("latest.cost.tuition.in_state")),
        "tuition_out_state": num(g("latest.cost.tuition.out_of_state")),
        "net_price":         num(g(net_price_key)),
        "cost_attendance":   num(g("latest.cost.attendance.academic_year")),
        # aid
        "median_debt":       num(g("latest.aid.median_debt.completers.overall")),
        "pell_rate":         pct(g("latest.aid.pell_grant_rate")),
        "loan_rate":         pct(g("latest.aid.federal_loan_rate")),
        # outcomes
        "grad_rate":         pct(g("latest.completion.rate_suppressed.four_year")),
        "earnings_6yr":      num(g("latest.earnings.6_yrs_after_entry.working_not_enrolled.mean_earnings")),
        "earnings_8yr":      num(g("latest.earnings.8_yrs_after_entry.median_earnings")),
        "earnings_10yr":     num(g("latest.earnings.10_yrs_after_entry.median")),
    }

# ── Sync guard — fails immediately at startup if map_row drifts from CSV_COLUMNS
def _assert_sync():
    dummy = {f: None for f in FIELDS.split(",")}
    dummy["id"] = 0
    row = map_row(dummy)
    row_keys = list(row.keys())
    assert row_keys == CSV_COLUMNS, (
        "map_row keys don't match CSV_COLUMNS!\n"
        f"  Extra in map_row : {set(row_keys) - set(CSV_COLUMNS)}\n"
        f"  Missing from map : {set(CSV_COLUMNS) - set(row_keys)}\n"
        f"  Order diff       : {[(a,b) for a,b in zip(row_keys, CSV_COLUMNS) if a != b]}"
    )

_assert_sync()

# ── API fetch ─────────────────────────────────────────────────────────────────
def fetch(page, fields=FIELDS, retries=3):
    encoded_fields = requests.utils.quote(fields, safe=",.")
    url = (f"{BASE_URL}?api_key={API_KEY}&{FILTER_STR}"
           f"&per_page={PER_PAGE}&page={page}&sort=school.name:asc"
           f"&fields={encoded_fields}")
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 429:
                print("\n  ⚠  Rate limited — waiting 65s..."); time.sleep(65); continue
            if r.status_code == 400:
                return None, r.text
            r.raise_for_status()
            return r.json(), None
        except requests.RequestException as e:
            if attempt == retries - 1: raise
            print(f"\n  Retry {attempt+1}: {e}"); time.sleep(5)

# ── Debug: print raw first result ─────────────────────────────────────────────
def debug_first_result():
    print("\n🔍 Debug — raw API response for first result\n")
    data, err = fetch(0)
    if err:
        print(f"❌ API error: {err}"); return
    results = data.get("results", [])
    if not results:
        print("No results returned"); return
    import json
    print(json.dumps(results[0], indent=2))
    print(f"\nTotal results: {data['metadata']['total']}")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if "--debug" in sys.argv:
        debug_first_result(); return

    print("\n🎓 Admitly — College Scorecard Extractor")
    print(f"   Output : {OUT_FILE}\n")

    print("📡 Probing API...")
    data, err = fetch(0)

    if err:
        print(f"\n❌  API error. Run with --debug to inspect the raw response:")
        print(f"    python scripts/extract_colleges.py --debug")
        print(f"\n    Raw error: {err[:300]}\n")
        sys.exit(1)

    total = data["metadata"]["total"]
    pages = (total + PER_PAGE - 1) // PER_PAGE
    print(f"   ✅ {total:,} colleges · {pages} pages · ~{round(pages * DELAY_SEC / 60, 1)} min\n")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = skipped = 0

    with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()

        for r in data.get("results", []):
            row = map_row(r)
            if not row["name"]: skipped += 1; continue
            writer.writerow(row); written += 1

        print(f"  Page   1/{pages}  ({written:,} written)", end="\r")

        for page in range(1, pages):
            time.sleep(DELAY_SEC)
            try:
                d, err = fetch(page)
                if err:
                    print(f"\n  ❌ page {page}: {err[:80]}"); continue
                for r in d.get("results", []):
                    row = map_row(r)
                    if not row["name"]: skipped += 1; continue
                    writer.writerow(row); written += 1
                print(f"  Page {page+1:3d}/{pages}  ({written:,} written)", end="\r")
            except Exception as e:
                print(f"\n  ❌ page {page}: {e}")

    print(f"\n\n✅  Done!")
    print(f"   Rows   : {written:,}  |  Skipped : {skipped}")
    if OUT_FILE.exists() and OUT_FILE.stat().st_size > 0:
        print(f"   Size   : {OUT_FILE.stat().st_size // 1024:,} KB")
        print(f"\n   Next steps:")
        print(f"   1. docker compose down -v")
        print(f"   2. docker compose up --build -d")
        print(f"   3. git add data/colleges_master.csv && git commit -m 'colleges {date.today()}'")
    else:
        print(f"\n   ⚠  File is empty — run with --debug to inspect:")
        print(f"   python scripts/extract_colleges.py --debug")
    print()

if __name__ == "__main__":
    main()