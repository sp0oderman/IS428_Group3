import requests
import json
import sys
import re
import os
import time
import spotipy
import pandas as pd
from spotipy.oauth2 import SpotifyClientCredentials
from dotenv import load_dotenv, set_key

def get_spotify_url_from_name(song_name, verbose=True):
    """
    Searches for a song on Spotify and returns its URL.
    Asks for credentials and saves them to .env if not found.
    """
    load_dotenv()
    client_id = os.environ.get("SPOTIPY_CLIENT_ID")
    client_secret = os.environ.get("SPOTIPY_CLIENT_SECRET")
    
    env_file = ".env"
    
    if not client_id or not client_secret:
        print("Spotify API credentials not found.")
        print("You can get these from the Spotify Developer Dashboard (https://developer.spotify.com/dashboard)")
        client_id = input("Enter your Spotify Client ID: ").strip()
        client_secret = input("Enter your Spotify Client Secret: ").strip()
        
        # Save to .env
        if not os.path.exists(env_file):
            open(env_file, 'w').close()
            
        set_key(env_file, "SPOTIPY_CLIENT_ID", client_id)
        set_key(env_file, "SPOTIPY_CLIENT_SECRET", client_secret)
        print("Credentials saved to .env file for future use.\n")
        
    try:
        auth_manager = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
        sp = spotipy.Spotify(auth_manager=auth_manager)
        
        if verbose: print(f"Searching for '{song_name}' on Spotify...")
        results = sp.search(q=song_name, type='track', limit=1)
        tracks = results.get('tracks', {}).get('items', [])
        
        if not tracks:
            if verbose: print(f"No results found for '{song_name}'.")
            return None, None
            
        track = tracks[0]
        track_url = track['external_urls']['spotify']
        duration_ms = track.get('duration_ms')
        if verbose:
            print(f"Found match: {track['name']} by {track['artists'][0]['name']}")
            print(f"Track URL: {track_url}")
        return track_url, duration_ms
    except Exception as e:
        if verbose: print(f"Error searching Spotify: {e}")
        return None, None

def get_track_id_from_url(url):
    """
    Extracts the Spotify Track ID from a URL.
    """
    # Pattern to match spotify track URLs
    # e.g., https://open.spotify.com/track/5HiSc2ZCGn8L3cH3qSwzBT?si=...
    match = re.search(r'track/([a-zA-Z0-9]+)', url)
    if match:
        return match.group(1)
    return None

def get_reccobeats_info(track_url, verbose=True):
    """
    Retrieves song info using ReccoBeats API.
    """
    track_id = get_track_id_from_url(track_url)
    
    if not track_id:
        # Fallback: maybe the user passed just the ID
        if len(track_url) == 22 and '/' not in track_url:
             track_id = track_url
        else:
            if verbose: print("Error: Could not extract Track ID from URL.")
            return None
            
    if verbose: print(f"Fetching info for Track ID: {track_id}")

    # ReccoBeats API Endpoint
    # Based on research: GET /track?ids={id}
    api_url = "https://api.reccobeats.com/v1/track"
    params = {
        "ids": track_id
    }

    try:
        response = requests.get(api_url, params=params)
        response.raise_for_status() # Raise error for bad status codes

        data = response.json()
        
        # Check if we got valid data
        if not data or (isinstance(data, list) and not data):
             if verbose: print("No data found for this track.")
             return None

        if verbose: print(json.dumps(data, indent=4))
        
        # Extract ReccoBeats ID
        try:
            reccobeats_id = data['content'][0]['id']
            if verbose: print(f"\nReccoBeats ID: {reccobeats_id}")
            
            # Fetch Audio Features
            if verbose: print(f"Fetching audio features for ReccoBeats ID: {reccobeats_id}")
            audio_features_url = f"https://api.reccobeats.com/v1/track/{reccobeats_id}/audio-features"
            
            af_response = requests.get(audio_features_url)
            af_response.raise_for_status()
            
            af_data = af_response.json()
            if verbose:
                print("\nAudio Features:")
                print(json.dumps(af_data, indent=4))
            
            return data, af_data

        except (KeyError, IndexError) as e:
            if verbose: print(f"Error extracting ReccoBeats ID or fetching features: {e}")
            return data
            
        return data

    except requests.exceptions.RequestException as e:
        if verbose: print(f"Error fetching data from ReccoBeats: {e}")
        return None

def process_csv_to_dataframe(csv_path, batch_size=1500):
    output_path = csv_path.replace(".csv", "_with_features.csv")
    
    print(f"Loading dataset from {csv_path}...")
    try:
        # Prevent pandas from reading the old index as 'Unnamed: 0'
        df = pd.read_csv(csv_path, index_col=False)
        if 'Unnamed: 0' in df.columns:
            df = df.drop(columns=['Unnamed: 0'])
            
        print(f"Loaded {len(df)} rows. Starting processing...")
        
        # Check if 'Title' column exists, otherwise create it
        if 'Title' not in df.columns:
            df['Title'] = None
            
        # Fill missing titles using "Artist and Title"
        for index, row in df.iterrows():
            # If Title is missing or empty
            if pd.isna(row.get('Title')) or str(row.get('Title')).strip() == "":
                song_query = row.get('Artist and Title', "")
                if isinstance(song_query, str) and " - " in song_query:
                    # Split on the first ' - '
                    title = song_query.split(" - ", 1)[1].strip()
                    df.at[index, 'Title'] = title
                elif isinstance(song_query, str):
                    df.at[index, 'Title'] = song_query
                    
    except FileNotFoundError:
        print(f"Error: Could not find file {csv_path}")
        return
        
    if os.path.exists(output_path):
        print(f"Found existing output at {output_path}. Resuming from there...")
        try:
            existing_df = pd.read_csv(output_path, index_col=False)
            # Update current df with the existing rows
            # Align by index assuming order hasn't changed
            for col in existing_df.columns:
                if col not in df.columns:
                    df[col] = None
                    
            for i in range(len(existing_df)):
                if i < len(df):
                    for col in existing_df.columns:
                        df.at[i, col] = existing_df.at[i, col]
        except Exception as e:
            print(f"Error loading existing output: {e}")
            return
            
    # Add a column to track processed rows if it doesn't exist
    if 'reccobeats_processed' not in df.columns:
        df['reccobeats_processed'] = False
        
    # Get indices of unprocessed rows
    unprocessed_indices = df[df['reccobeats_processed'] != True].index.tolist()
    
    if not unprocessed_indices:
        print("All rows have already been processed!")
        return
        
    print(f"Total rows remaining to process: {len(unprocessed_indices)}")
    
    # Take a batch
    batch_indices = unprocessed_indices[:min(batch_size, len(unprocessed_indices))]
    print(f"Processing a batch of {len(batch_indices)} rows...")
    
    for count, index in enumerate(batch_indices):
        row = df.loc[index]
        song_query = row.get('Artist and Title', None)
        if pd.isna(song_query):
            df.at[index, 'reccobeats_processed'] = True
            continue
            
        print(f"\nProcessing row {count + 1}/{len(batch_indices)} (Original Row #{index + 1}): {song_query}")
        
        spotify_res = get_spotify_url_from_name(song_query, verbose=False)
        if isinstance(spotify_res, tuple):
            spotify_url, duration_ms = spotify_res
        else:
            spotify_url, duration_ms = spotify_res, None
            
        feature_dict = {}
        if duration_ms is not None:
            feature_dict['duration_ms'] = duration_ms
        
        if spotify_url:
            print(f"  -> Found URL: {spotify_url}")
            result = get_reccobeats_info(spotify_url, verbose=False)
            if isinstance(result, tuple) and len(result) == 2:
                af_data = result[1]
                # Assuming af_data contains audio features like danceability, energy etc
                feature_dict.update(af_data)
        else:
            print("  -> No URL found.")
            
        # Update df with these features
        for key, value in feature_dict.items():
            if key not in df.columns:
                df[key] = None
            df.at[index, key] = value
            
        df.at[index, 'reccobeats_processed'] = True
        
        time.sleep(0.5) # Sleep to avoid rate limiting
        
    print(f"\nBatch processing complete! Saving progress...")
    df.to_csv(output_path, index=False)
    print(f"Saved to {output_path}")
    
    remaining = len(unprocessed_indices) - len(batch_indices)
    if remaining > 0:
        print(f"Run the script again to process the next batch. ({remaining} remaining)")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
    else:
        default_csv = "/Users/gin/Documents/Visual Analytics/Project/dataset/final/masterlist_lyrics.csv"
        query = input(f"Enter a CSV path (press Enter for default: {default_csv}): ").strip()
        if not query:
            query = default_csv
            
    if query.endswith(".csv"):
        process_csv_to_dataframe(query)
    elif query.startswith("http"):
        get_reccobeats_info(query)
    else:
        result = get_spotify_url_from_name(query)
        target_url = result[0] if isinstance(result, tuple) else result
        if target_url:
            get_reccobeats_info(target_url)
