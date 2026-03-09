import lyricsgenius
from pathlib import Path
import time
import os
from dotenv import load_dotenv
import csv
from requests.exceptions import HTTPError

load_dotenv()
CLIENT_ACCESS_TOKEN = os.environ["client_access_token"]
YEAR_EXTRACTION = 2010
LyricsGenius = lyricsgenius.Genius(CLIENT_ACCESS_TOKEN)

# Note that songs that are not in Genius will be indicated in the csv as '0'...
http_error_song_length = 0

INPUT_CSV = Path('spotify_2010_2025.csv')
TEMP_CSV = INPUT_CSV.with_suffix('.tmp')

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

        if song_name and artist_name and year and year == YEAR_EXTRACTION:
            try:
                song = LyricsGenius.search_song(song_name, artist_name)
                time.sleep(1)
                if song and getattr(song, 'lyrics', None):
                    lyrics = song.lyrics
                else:
                    lyrics = '0'
            except HTTPError:
                http_error_song_length += 1
            except Exception as e:
                continue

        else:
            lyrics = ''

        row[lyrics_idx] = lyrics
        writer.writerow(row)

if http_error_song_length != 0:
    print(f"Encountered HTTPError for {http_error_song_length} songs. Rerun script.")

# Replace the original CSV with the updated temp CSV
TEMP_CSV.replace(INPUT_CSV)

print(f"Completed: updated {INPUT_CSV} with lyrics.")
