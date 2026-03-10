import asyncio
import lyricsgenius
from pathlib import Path
import os
from dotenv import load_dotenv
import csv
from requests.exceptions import HTTPError
import re

load_dotenv()
CLIENT_ACCESS_TOKEN = os.environ["client_access_token"]
YEAR_EXTRACTION = 2010
LyricsGenius = lyricsgenius.Genius(CLIENT_ACCESS_TOKEN)

# Note that songs that are not in Genius will be indicated in the csv as '0'...
http_error_song_length = 0

INPUT_CSV = Path('spotify_2010_2025.csv')
TEMP_CSV = INPUT_CSV.with_suffix('.tmp')


async def fetch_song_lyrics(song_name: str, artist_name: str, retries: int = 3, backoff_sec: float = 1.0) -> str:
    """Fetch lyrics for a song, retrying on transient errors.

    Returns '0' if lyrics are unavailable or if the request repeatedly fails.
    """

    global http_error_song_length

    for attempt in range(1, retries + 1):
        try:
            song = await asyncio.to_thread(LyricsGenius.search_song, song_name, artist_name)
            if song and getattr(song, 'lyrics', None):
                return song.lyrics
            return '0'
        except HTTPError:
            # Rate limiting or temporary server error; retry with backoff.
            if attempt < retries:
                await asyncio.sleep(backoff_sec * attempt)
                continue
            http_error_song_length += 1
            return ''
        except Exception:
            # Any other issue (e.g. parsing) should not stop processing.
            return ''


async def main() -> None:
    global http_error_song_length

    with INPUT_CSV.open('r', encoding='utf-8', newline='') as infile, TEMP_CSV.open('w', encoding='utf-8', newline='') as outfile:
        reader = csv.reader(infile)
        writer = csv.writer(outfile, quoting=csv.QUOTE_MINIMAL)

        header = next(reader)
        lower_header = [h.lower() for h in header]
        if 'lyrics' not in lower_header:
            header.append('lyrics')
            lyrics_idx = len(header) - 1
        else:
            lyrics_idx = lower_header.index('lyrics')

        writer.writerow(header)

        for row in reader:
            if not row:
                continue

            # Ensure row has enough columns to hold lyrics
            if len(row) < len(header):
                row += [''] * (len(header) - len(row))

            # Skip if lyrics already present
            if row[lyrics_idx].strip():
                writer.writerow(row)
                continue

            song_name = row[1].strip() if len(row) > 1 else ''
            artist_name = row[2].strip() if len(row) > 2 else ''
            year = int(row[3].strip()) if len(row) > 3 and row[3].strip().isdigit() else None

            lyrics = ''
            if song_name and artist_name and year == YEAR_EXTRACTION:
                lyrics = await fetch_song_lyrics(song_name, artist_name)
                # Avoid hitting the Genius API too quickly
                await asyncio.sleep(1)

            lyrics = re.sub(r'[\r\n]+', ' ', lyrics)
            row[lyrics_idx] = lyrics
            writer.writerow(row)

    if http_error_song_length != 0:
        print(f"Encountered HTTPError for {http_error_song_length} songs. Rerun script.")

    # Replace the original CSV with the updated temp CSV
    TEMP_CSV.replace(INPUT_CSV)

    print(f"Completed: updated {INPUT_CSV} with lyrics.")


if __name__ == '__main__':
    asyncio.run(main())
