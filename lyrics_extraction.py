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

# Note that songs that are not in Genius but part of the top 300 songs will be included with a '0'...
song_details = []
not_in_genius = [
    'Shakira - Waka Waka (This Time for Africa) [The Official 2010 FIFA World Cup (TM) Song]', # 2010
    'Bill Evans - Blue In Green', # 2010 - no lyrics song
    'Frédéric Chopin - Nocturne en Mi Bémol Majeur, Op. 9 No. 2' # 2010
]

# Read CSV file and extract song names and artists
with open('spotify_full_list_20102023.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    header = next(csv_reader)
    for row in csv_reader:
        if len(row) >= 6:
            idx, song_name, artist_name, streams, daily, year = row[:6]
            streams = int(float(streams))  # Handle potential float values
            year = int(float(year.strip()))
            if year == YEAR_EXTRACTION:
                song_details.append((song_name, artist_name, streams))

folder_path = Path(f"songs_lyrics/{YEAR_EXTRACTION}")
folder_path.mkdir(parents=True, exist_ok=True)


sorted_songs = sorted(song_details, key=lambda x: x[2], reverse=True)
# print(sorted_songs[301:])
# counter = 0
# From list, extract top 300 songs based on number of streams
# for s in sorted_songs:
# if counter >= 300:
#     break
#     try:
#         # Clean filename to avoid invalid characters
#         filename = f"{s[0]}.txt"
#         # Replace invalid filename characters
#         invalid_chars = '<>:"/\\|?*'
#         for char in invalid_chars:
#             filename = filename.replace(char, '')
#         # save lyrics in the songs_lyrics folder as txt file
#         filepath = folder_path / filename
#         if not filepath.exists() and filename not in not_in_genius:
#             song = LyricsGenius.search_song(s[0], s[1])
#             if song:
#                 with open(filepath, 'w', encoding='utf-8') as txt_file:
#                     txt_file.write(song.lyrics)
#             else:
#                 with open(filepath, 'w', encoding='utf-8') as txt_file:
#                     txt_file.write("0")
#                 print(f"Could not find lyrics for '{s[0]}' by '{s[1]}'")
#         else:
#             print(f"Lyrics for '{s[0]}' by '{s[1]}' already exist. Skipping...")
#         time.sleep(1)
#         counter += 1
#     except HTTPError as e:
#         if e.response.status_code == 429:
#             retry_after = int(e.response.headers.get('Retry-After', 60))
#             print(f"Rate limited. Waiting {retry_after}s...")
#             time.sleep(retry_after)
#             continue
#     except Exception as e:
#         print(f"Error fetching lyrics for '{s[0]}' by '{s[1]}': {e}")