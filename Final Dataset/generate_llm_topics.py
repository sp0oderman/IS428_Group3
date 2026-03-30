import asyncio
import pandas as pd
import sys
import os
from ollama import AsyncClient

MODEL_NAME = "qwen2.5:3b"

SONG_TOPICS = [
    # Love & Romance
    "Devoted Romantic Love",
    "Flirting and Early Dating",
    "Long Distance Love",
    "Destined Soulmate Love",
    "Unrequited Love",
    "Lust and Sexual Desire",

    # Heartbreak & Post-Relationship
    "Heartbreak and Breakup Pain",
    "Toxic Relationship Drama",
    "Cheating and Jealousy",
    "Revenge on an Ex",
    "Moving On After Breakup",
    "Missing Someone",
    "Regret and Apology",

    # Party & Nightlife
    "Party and Club Night",
    "Drinking and Getting Drunk",
    "Carefree Living in the Moment",
    "Dancing Anthem",

    # Hip-Hop & Street
    "Flexing Wealth and Status",
    "Street Life and Violence",
    "Hustle and Success Story",
    "Fashion and Personal Style",

    # Drugs & Substance
    "Drug and Substance Use",

    # Mental Health & Emotional
    "Anxiety and Depression",
    "Escapism and Emotional Numbness",
    "Grief and Loss",
    "Healing and Resilience",

    # Self & Identity
    "Female Empowerment",
    "Insecurity and Body Image",
    "Self Confidence and Affirmation",
    "Cultural Identity and Heritage",
    "Coming of Age",

    # Social & Political
    "Social and Political Commentary",
    "Resisting Societal Pressure",

    # Spirituality & Faith
    "Faith and Spirituality",
    "Existential Reflection",

    # Nostalgia & Memories
    "Nostalgia and Childhood Memories",
    "Friendship and Loyalty",

    # Lifestyle & Everyday
    "Country and Rural Life",
    "Travel and Adventure",
    "Cute Couple Everyday Life",
    "Holiday and Christmas",

    # Performance & Genre Meta
    "Kpop Idol Performance",
    "Electronic and Instrumental",
]

async def generate_topic(client, semaphore, idx, title, artist, lyrics, df):
    async with semaphore:
        prompt = f"""You are a music analyst. Categorize the following song based on its lyrics.
Title: {title}
Artist: {artist}

Lyrics:
{lyrics[:2500]}

Categorize the song into EXACTLY ONE of the following categories, and nothing else. Just output the category name. Do not include any other text or explanation.

Categories:
{", ".join(SONG_TOPICS)}

Category:"""

        try:
            response = await client.generate(model=MODEL_NAME, prompt=prompt, stream=False)
            topic = response.get("response", "").strip()
            
            # Simple cleanup
            topic = topic.strip("\'\"*.-[] ")
            
            # Enforce strict categorization
            matched_topic = topic
            for cat in SONG_TOPICS:
                if cat.lower() in topic.lower():
                    matched_topic = cat
                    break
                    
            print(f"[{idx}] {title} by {artist} -> {matched_topic}")
            df.loc[idx, 'Topic'] = matched_topic
        except Exception as e:
            print(f"[{idx}] Error parsing {title}: {e}")

async def async_main():
    input_file = "masterlist_lyrics_with_features_cleaned_top300.csv"
    output_file = "topic_masterlist_top_300.csv"
    
    if os.path.exists(output_file):
        print(f"Resuming from {output_file}...")
        df = pd.read_csv(output_file)
    elif os.path.exists(input_file):
        print(f"Reading fresh from {input_file}...")
        df = pd.read_csv(input_file)
        if 'Topic' not in df.columns:
            df['Topic'] = None
    else:
        print(f"Input file {input_file} not found.")
        sys.exit(1)

    client = AsyncClient(host='http://localhost:11434')
    
    # We will process in batches to save to CSV periodically
    BATCH_SIZE = 20
    
    # Allow 10 concurrent requests; adjustable depending on user machine constraints.
    semaphore = asyncio.Semaphore(10)

    # Find the last row with a valid Topic and resume from there
    last_processed_idx = -1
    for idx in range(len(df)):
        topic_val = str(df.loc[idx, 'Topic'])
        if not (pd.isna(df.loc[idx, 'Topic']) or topic_val.strip() == "" or topic_val == "nan"):
            last_processed_idx = idx
            
    indices_to_process = list(range(last_processed_idx + 1, len(df)))

    print(f"Found {len(indices_to_process)} rows to process.")
    
    for i in range(0, len(indices_to_process), BATCH_SIZE):
        batch_indices = indices_to_process[i:i+BATCH_SIZE]
        tasks = []
        for idx in batch_indices:
            title = df.loc[idx, 'Title']
            artist = df.loc[idx, 'Artist']
            lyrics = str(df.loc[idx, 'Lyrics'])
            
            if pd.isna(df.loc[idx, 'Lyrics']) or lyrics.strip() == "":
                df.loc[idx, 'Topic'] = "Other"
                continue
                
            tasks.append(generate_topic(client, semaphore, idx, title, artist, lyrics, df))
            
        print(f"Processing batch {i//BATCH_SIZE + 1} / {(len(indices_to_process)+BATCH_SIZE-1)//BATCH_SIZE}...")
        await asyncio.gather(*tasks)
        
        # Checkpoint after each batch
        df.to_csv(output_file, index=False)
        print(f"-> Checkpoint saved to {output_file} after batch {i//BATCH_SIZE + 1}.")

    print("\nAll rows processed.")

def main():
    asyncio.run(async_main())

if __name__ == "__main__":
    main()
