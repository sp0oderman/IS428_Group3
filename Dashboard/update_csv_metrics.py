import csv
import os

source_path = "/Users/gin/Documents/Visual Analytics/Project/IS428_Group3/Dashboard/data/old/masterlist_lyrics_with_features_newMetrics_top300_updated.csv"
target_path = "/Users/gin/Documents/Visual Analytics/Project/IS428_Group3/Dashboard/data/masterlist_lyrics_with_features_cleaned_top300_final.csv"

# Load source data into a mapping: Artist and Title -> {col: val}
source_data = {}
cols_to_update = ["Flesch_Kincaid_Grade", "Lexical_Diversity", "Avg_Word_Length"]

print(f"Reading source: {source_path}")
with open(source_path, mode='r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        key = row.get("Artist and Title")
        if key:
            source_data[key] = {col: row.get(col) for col in cols_to_update}

print(f"Loaded {len(source_data)} entries from source.")

# Update target data
updated_rows = []
fieldnames = []
update_count = 0
not_found = []

print(f"Reading target: {target_path}")
with open(target_path, mode='r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        key = row.get("Artist and Title")
        if key in source_data:
            # Check for column existence in target before updating
            for col in cols_to_update:
                if col in row:
                    row[col] = source_data[key][col]
            update_count += 1
        else:
            not_found.append(key)
        updated_rows.append(row)

print(f"Updated {update_count} rows in target.")
if not_found:
    print(f"Notice: {len(not_found)} rows in target were NOT found in source (e.g., {not_found[:3]})")

# Write back to target
temp_path = target_path + ".tmp"
with open(temp_path, mode='w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(updated_rows)

# Atomically replace
os.replace(temp_path, target_path)
print("Update complete. Target file overwritten.")
