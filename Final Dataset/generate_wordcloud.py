import pandas as pd
import re
from collections import Counter
import nltk
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer, WordNetLemmatizer

# Ensure required NLTK resources are downloaded
nltk.download('stopwords', quiet=True)
nltk.download('wordnet', quiet=True)

# Initialize stemmer and lemmatizer
stemmer = PorterStemmer()
lemmatizer = WordNetLemmatizer()

# Define a broad set of English stopwords including typical lyric fillers and song structure markers
CUSTOM_STOPWORDS = set([
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

# Combine custom stopwords with NLTK stopwords
STOPWORDS = CUSTOM_STOPWORDS.union(set(stopwords.words('english')))

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
    # Process words: remove stopwords/short words, lemmatize, and stem
    processed_words = []
    for w in words:
        if w not in STOPWORDS and len(w) > 2:
            # Lemmatize first
            lem = lemmatizer.lemmatize(w)
            # Stem next
            stem = stemmer.stem(lem)
            # Store tuple of (stemmed_word, original_word)
            processed_words.append((stem, w))
            
    return processed_words

def main():
    input_file = "masterlist_lyrics_with_features_cleaned_top300.csv"
    output_file = "wordcloud_data_by_year_updated.csv"
    
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
            
        # Count frequencies of each stem
        stem_counter = Counter(stem for stem, original in all_words)
        
        # Keep track of which original words correspond to which stem
        stem_to_original = {}
        for stem, original in all_words:
            if stem not in stem_to_original:
                stem_to_original[stem] = Counter()
            stem_to_original[stem][original] += 1
            
        # Keep top 100 words per year for the word cloud based on stems
        top_stems = stem_counter.most_common(100)
        
        for stem, count in top_stems:
            # Get the most common original word for this stem
            best_original = stem_to_original[stem].most_common(1)[0][0]
            
            word_counts_by_year.append({
                'Year': year,
                'Word': best_original,
                'Frequency': count
            })
            
    out_df = pd.DataFrame(word_counts_by_year)
    out_df.to_csv(output_file, index=False)
    print(f"Successfully generated {output_file} with {len(out_df)} total rows.")

if __name__ == "__main__":
    main()
