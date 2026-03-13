import pandas as pd
import os

def clean_dataset(input_path, output_path):
    print(f"Loading dataset from: {input_path}")
    try:
        df = pd.read_csv(input_path, engine='python', on_bad_lines='skip')
    except Exception as e:
        print(f"Error loading dataset: {e}")
        return

    initial_len = len(df)
    print(f"Initial shape: {df.shape}")

    # 1. Remove rows with missing lyrics or missing audio features
    features_to_check = [
        'Lyrics', 'acousticness', 'danceability', 'energy', 'instrumentalness', 
        'key', 'liveness', 'loudness', 'mode', 'speechiness', 'tempo', 'valence'
    ]
    
    print("\n--- 1. Handling Missing Data ---")
    df = df.dropna(subset=features_to_check)
    print(f"Shape after dropping missing features: {df.shape}")
    print(f"Dropped {initial_len - len(df)} rows due to missing data.")

    # 2. Remove exact duplicates
    print("\n--- 2. Removing Exact Duplicates ---")
    len_before_exact = len(df)
    df = df.drop_duplicates()
    print(f"Shape after dropping exact duplicates: {df.shape}")
    print(f"Dropped {len_before_exact - len(df)} exact duplicate rows.")

    # 3. Deduplicate by Artist and Title, keeping highest Streams
    print("\n--- 3. Removing Artist & Title Duplicates ---")
    len_before_title = len(df)
    
    # Sort by 'Streams' descending so that the first occurrence has the highest streams
    # (Assuming 'Streams' column is numeric, but let's ensure it handles correctly)
    df['Streams'] = pd.to_numeric(df['Streams'], errors='coerce').fillna(0)
    df = df.sort_values('Streams', ascending=False)
    
    # Drop duplicates keeping the first (which has the highest Streams)
    df = df.drop_duplicates(subset=['Artist', 'Title'], keep='first')
    
    # 4. Drop unwanted columns
    print("\n--- 4. Dropping Unwanted Columns ---")
    columns_to_drop = ['genres', 'main_genre', 'first_genre', 'second_genre', 'third_genre', 'reccobeats_processed']
    existing_cols_to_drop = [col for col in columns_to_drop if col in df.columns]
    if existing_cols_to_drop:
        df = df.drop(columns=existing_cols_to_drop)
        print(f"Dropped columns: {existing_cols_to_drop}")
        
    # 5. Sort by Year (ascending) and Streams (descending)
    print("\n--- 5. Sorting Dataset ---")
    if 'Year' in df.columns and 'Streams' in df.columns:
        df = df.sort_values(by=['Year', 'Streams'], ascending=[True, False])
        print("Sorted by Year (ascending) and Streams (descending).")
    
    print(f"Shape after dropping Artist+Title duplicates: {df.shape}")
    print(f"Dropped {len_before_title - len(df)} Artist+Title duplicate rows.")

    # 6. Retain Top 300 Songs per Year
    print("\n--- 6. Retaining Top 300 Songs per Year ---")
    len_before_top300 = len(df)
    if 'Year' in df.columns:
        df = df.groupby('Year').head(300)
        df = df.reset_index(drop=True)
        print(f"Shape after retaining top 300 per year: {df.shape}")
        print(f"Dropped {len_before_top300 - len(df)} rows.")

    print(f"\nFinal dataset shape: {df.shape}")
    print(f"Total rows removed: {initial_len - len(df)}")

    # 7. Final Validation Check
    print("\n=== FINAL VALIDATION SUMMARY ===")
    
    # Check Missing Values
    missing_counts = df.isnull().sum()
    total_missing = missing_counts.sum()
    if total_missing > 0:
        print(f"[!] WARNING: Found missing values in the final dataset:")
        print(missing_counts[missing_counts > 0])
    else:
        print("[✓] No missing values found.")
        
    # Check Exact Duplicates
    exact_duplicates = df.duplicated().sum()
    if exact_duplicates > 0:
        print(f"[!] WARNING: Found {exact_duplicates} exact duplicate rows.")
    else:
        print("[✓] No exact duplicates found.")
        
    # Check Artist & Title Duplicates
    if 'Artist' in df.columns and 'Title' in df.columns:
        artist_title_dupes = df.duplicated(subset=['Artist', 'Title']).sum()
        if artist_title_dupes > 0:
            print(f"[!] WARNING: Found {artist_title_dupes} Artist & Title duplicates.")
        else:
            print("[✓] No Artist & Title duplicates found.")
    else:
        print("[?] Could not check Artist & Title duplicates (columns missing).")
        
    print("================================")

    # Save cleaned dataset
    print(f"\nSaving cleaned dataset to: {output_path}")
    df.to_csv(output_path, index=False)
    print("Done!")

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(current_dir, "masterlist_lyrics_with_features.csv")
    output_file = os.path.join(current_dir, "masterlist_lyrics_with_features_cleaned.csv")
    
    clean_dataset(input_file, output_file)
