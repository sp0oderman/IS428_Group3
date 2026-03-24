import pandas as pd
import re
from collections import Counter

# Define a broad set of English stopwords including typical lyric fillers and song structure markers
STOPWORDS = set([
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", 
    "yours", "yourself", "yourselves", "he", "him", "his", "himself", "she", 
    "her", "hers", "herself", "it", "its", "itself", "they", "them", "their", 
    "theirs", "themselves", "what", "which", "who", "whom", "this", "that", 
    "these", "those", "am", "is", "are", "was", "were", "be", "been", "being", 
    "have", "has", "had", "having", "do", "does", "did", "doing", "a", "an", 
    "the", "and", "but", "if", "or", "because", "as", "until", "while", "of", 
    "at", "by", "for", "with", "about", "against", "between", "into", "through", 
    "during", "before", "after", "above", "below", "to", "from", "up", "down", 
    "in", "out", "on", "off", "over", "under", "again", "further", "then", 
    "once", "here", "there", "when", "where", "why", "how", "all", "any", 
    "both", "each", "few", "more", "most", "other", "some", "such", "no", 
    "nor", "not", "only", "own", "same", "so", "than", "too", "very", "s", 
    "t", "can", "will", "just", "don", "should", "now", "im", "like", "oh", 
    "yeah", "know", "got", "get", "cause", "let", "make", "see", "go", 
    "right", "say", "one", "never", "come", "time", "way", "want", "take",
    "love", "baby", "girl", "boy", "tell", "need", "feel", "let", "now", "aint",
    "wanna", "gonna", "gotta", "ooh", "na", "la", "uh", "ya", "da", "ah", "hey",
    "chorus", "verse", "intro", "outro", "bridge", "pre", "post", "hook"
])

def clean_text(text):
    if pd.isna(text):
        return []
    # Lowercase
    text = str(text).lower()
    # Remove markers like [Chorus], [Verse]
    text = re.sub(r'\[.*?\]', ' ', text)
    # Remove punctuation 
    text = re.sub(r'[^\w\s]', ' ', text)
    # Split into words
    words = text.split()
    # Remove stopwords and short words (length 1 or 2 often are meaningless)
    words = [w for w in words if w not in STOPWORDS and len(w) > 2]
    return words

def main():
    input_file = "masterlist_lyrics_with_features_cleaned_top300.csv"
    output_file = "wordcloud_data_by_year.csv"
    
    print(f"Reading {input_file}...")
    df = pd.read_csv(input_file)
    
    word_counts_by_year = []
    
    # Check if 'Year' and 'Lyrics' columns exist
    if 'Year' not in df.columns or 'Lyrics' not in df.columns:
        print("Required columns 'Year' or 'Lyrics' not found in the dataset.")
        return

    # Filter to only english if language column exists to avoid messy multilingual overlaps in word clouds
    if 'language' in df.columns:
        df = df[df['language'] == 'en']
        
    # Group by year
    for year, group in df.groupby('Year'):
        print(f"Processing Year: {year}...")
        all_words = []
        for text in group['Lyrics']:
            all_words.extend(clean_text(text))
            
        counter = Counter(all_words)
        
        # Keep top 100 words per year for the word cloud
        top_words = counter.most_common(100)
        
        for word, count in top_words:
            word_counts_by_year.append({
                'Year': year,
                'Word': word,
                'Frequency': count
            })
            
    out_df = pd.DataFrame(word_counts_by_year)
    out_df.to_csv(output_file, index=False)
    print(f"Successfully generated {output_file} with {len(out_df)} total rows.")

if __name__ == "__main__":
    main()
