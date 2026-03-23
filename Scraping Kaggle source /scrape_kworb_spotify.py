"""
scrape_kworb_spotify.py
-----------------------
Scrapes kworb.net for Spotify most-streamed songs by release year,
matching the field structure of the Kaggle dataset by irynatokarchuk:
    Artist and Title | Artist | Title | Streams | Daily | Year

── Standard scrape ──────────────────────────────────────────────────────────
Scrapes the specified years and writes a standalone CSV.

    pip install requests beautifulsoup4 pandas
    python scrape_kworb_spotify.py --years 2024 2025 --output new_data.csv

── Merge mode ───────────────────────────────────────────────────────────────
Updates Streams/Daily for existing rows in the Kaggle CSV (2010–2023) and
appends the 2024/2025 rows. Pass --merge with the path to the Kaggle CSV.

    python scrape_kworb_spotify.py \\
        --years 2010 2011 2012 2013 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 \\
        --merge kaggle_spotify_2010_2023.csv \\
        --output spotify_streams_2010_2025.csv

Merge behaviour
    - Streams and Daily are overwritten with fresh kworb values for every
      row where Artist and Title + Year matches between the Kaggle CSV and
      the scraped data.
    - All other Kaggle columns (genre etc.) are preserved unchanged.
    - Scraped rows with no match in the Kaggle CSV are treated as NEW songs.
      By default they are EXCLUDED (new songs lack genre data). Pass
      --include-new to append them anyway with blank genre columns.
    - A reconciliation summary is printed after merging.
"""

import argparse
import time
import sys

import requests
from bs4 import BeautifulSoup
import pandas as pd

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    )
}

BASE_URL = "https://kworb.net/spotify/songs_{year}.html"
JOIN_KEYS = ["Artist and Title", "Year"]


# ── Scraping ──────────────────────────────────────────────────────────────────

def scrape_year(year: int, delay: float = 2.0) -> pd.DataFrame:
    """Fetch and parse the kworb page for a single release year."""
    url = BASE_URL.format(year=year)
    print(f"  Fetching {url} ...", end=" ", flush=True)

    for attempt in range(2):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            break
        except requests.RequestException as exc:
            if attempt == 0:
                print(f"\n    Warning: {exc} — retrying in 5 s ...")
                time.sleep(5)
            else:
                print(f"\n    Error: could not fetch {url}: {exc}")
                return pd.DataFrame()

    soup = BeautifulSoup(r.content, "html.parser")
    table = soup.find("table")
    if table is None:
        print(f"\n    No table found for year {year}.")
        return pd.DataFrame()

    rows = []
    for tr in table.find_all("tr")[1:]:
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(cells) < 3:
            continue
        artist_title = cells[0]
        streams_raw  = cells[1].replace(",", "")
        daily_raw    = cells[2].replace(",", "")

        if " - " in artist_title:
            artist, title = artist_title.split(" - ", 1)
        else:
            artist, title = artist_title, ""

        try:
            streams = int(streams_raw)
            daily   = int(daily_raw)
        except ValueError:
            continue

        rows.append({
            "Artist and Title": artist_title,
            "Artist":  artist.strip(),
            "Title":   title.strip(),
            "Streams": streams,
            "Daily":   daily,
            "Year":    year,
        })

    print(f"  {len(rows)} rows.")
    time.sleep(delay)
    return pd.DataFrame(rows)


def scrape_all(years: list[int], delay: float) -> pd.DataFrame:
    frames = []
    for year in years:
        df = scrape_year(year, delay=delay)
        if not df.empty:
            frames.append(df)
    if not frames:
        print("No data scraped — exiting.")
        sys.exit(1)
    return pd.concat(frames, ignore_index=True)


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge(kaggle_path: str, scraped: pd.DataFrame, include_new: bool) -> pd.DataFrame:
    """
    Update Streams/Daily in the Kaggle CSV using freshly scraped values.
    Optionally append new songs not present in the Kaggle data.
    """
    print(f"\nLoading Kaggle CSV: {kaggle_path}")
    kaggle = pd.read_csv(kaggle_path, encoding="utf-8-sig")
    print(f"  {len(kaggle)} rows loaded.")

    # Normalise join key types
    kaggle["Year"]   = kaggle["Year"].astype(int)
    scraped["Year"]  = scraped["Year"].astype(int)

    # Identify scraped years that overlap with the Kaggle data
    kaggle_years  = set(kaggle["Year"].unique())
    scraped_years = set(scraped["Year"].unique())
    update_years  = kaggle_years & scraped_years
    new_years     = scraped_years - kaggle_years

    print(f"  Years in Kaggle CSV:  {sorted(kaggle_years)}")
    print(f"  Years scraped:        {sorted(scraped_years)}")
    print(f"  Years to update:      {sorted(update_years)}")
    if new_years:
        print(f"  Years appended whole: {sorted(new_years)}")

    # ── Step 1: update Streams/Daily for matching rows ────────────────────────
    scraped_update = scraped[scraped["Year"].isin(update_years)][
        JOIN_KEYS + ["Streams", "Daily"]
    ].copy()

    # Inner join: only keep Kaggle rows that have a kworb match.
    # Unmatched rows (no longer on kworb) are dropped entirely.
    merged = kaggle.merge(
        scraped_update,
        on=JOIN_KEYS,
        how="inner",
        suffixes=("_old", "_new"),
    )

    merged["Streams"] = merged["Streams_new"].astype(int)
    merged["Daily"]   = merged["Daily_new"].astype(int)
    merged.drop(columns=["Streams_old", "Daily_old", "Streams_new", "Daily_new"],
                errors="ignore", inplace=True)

    n_updated   = len(merged)
    n_unmatched = len(kaggle[kaggle["Year"].isin(update_years)]) - n_updated

    print(f"\n  Kaggle rows updated (Streams/Daily refreshed): {n_updated}")
    print(f"  Kaggle rows dropped (no kworb match):          {n_unmatched}")

    # ── Step 2: identify new songs within update_years ────────────────────────
    kaggle_keys = set(zip(kaggle["Artist and Title"], kaggle["Year"]))
    scraped_in_update_years = scraped[scraped["Year"].isin(update_years)]
    new_songs_in_update = scraped_in_update_years[
        ~scraped_in_update_years.apply(
            lambda r: (r["Artist and Title"], r["Year"]) in kaggle_keys, axis=1
        )
    ]
    print(f"  New songs found within update years:           {len(new_songs_in_update)}")

    # ── Step 3: rows from entirely new years (e.g. 2024, 2025) ───────────────
    scraped_new_years = scraped[scraped["Year"].isin(new_years)]
    print(f"  Rows from entirely new years:                  {len(scraped_new_years)}")

    # ── Step 4: combine ───────────────────────────────────────────────────────
    parts = [merged]

    if include_new:
        if not new_songs_in_update.empty:
            parts.append(new_songs_in_update)
        if not scraped_new_years.empty:
            parts.append(scraped_new_years)
        print(f"\n  --include-new set: appending all new rows.")
    else:
        # Always append entirely new years (2024, 2025) — these have no
        # corresponding Kaggle rows at all, so excluding them would defeat
        # the purpose of extending the dataset.
        if not scraped_new_years.empty:
            parts.append(scraped_new_years)
        if not new_songs_in_update.empty:
            print(f"\n  {len(new_songs_in_update)} new song(s) within existing years "
                  f"excluded (no genre data). Use --include-new to append them.")

    result = pd.concat(parts, ignore_index=True)
    result["Year"] = result["Year"].astype(int)
    result.sort_values(["Year", "Streams"], ascending=[True, False], inplace=True)
    result.reset_index(drop=True, inplace=True)
    return result


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scrape Spotify stream data from kworb.net and optionally merge with Kaggle CSV.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--years", nargs="+", type=int, default=[2024, 2025],
        help="Release years to scrape (default: 2024 2025).",
    )
    parser.add_argument(
        "--output", default="spotify_streams_updated.csv",
        help="Output CSV filename (default: spotify_streams_updated.csv).",
    )
    parser.add_argument(
        "--merge", metavar="KAGGLE_CSV", default=None,
        help=(
            "Path to the Kaggle 2010–2023 CSV. When supplied, Streams/Daily "
            "are updated in-place and new-year rows are appended."
        ),
    )
    parser.add_argument(
        "--include-new", action="store_true",
        help=(
            "When merging, also append songs newly appearing on kworb within "
            "existing years (2010–2023). These rows will have blank genre columns."
        ),
    )
    parser.add_argument(
        "--delay", type=float, default=2.0,
        help="Seconds to wait between requests (default: 2.0).",
    )
    args = parser.parse_args()

    print("=== Scraping kworb.net ===")
    scraped = scrape_all(args.years, args.delay)
    print(f"\nTotal rows scraped: {len(scraped)}")

    if args.merge:
        print("\n=== Merging with Kaggle CSV ===")
        result = merge(args.merge, scraped, args.include_new)
    else:
        result = scraped

    result.to_csv(args.output, index=False, encoding="utf-8-sig")
    print(f"\n=== Done — {len(result)} rows saved to '{args.output}' ===")
    print(result.head(5).to_string(index=False))


if __name__ == "__main__":
    main()
