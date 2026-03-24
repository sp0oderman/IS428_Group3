import pandas as pd
import re
import subprocess
import sys

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
except ImportError:
    print("Installing vaderSentiment...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "vaderSentiment"])
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

def clean_text(text):
    if pd.isna(text):
        return ""
    # Remove markers like [Chorus], [Verse]
    text = re.sub(r'\[.*?\]', ' ', str(text))
    return text

def main():
    input_file = "masterlist_lyrics_with_features_cleaned_top300.csv"
    output_file = input_file  # Overwriting the same CSV file as requested
    
    print(f"Reading {input_file}...")
    df = pd.read_csv(input_file)
    
    if 'Sentiment_Score' in df.columns:
        print("Recalculating Sentiment_Score using VADER...")
    else:
        print("Calculating sentiment scores using VADER...")
    
    # Initialize VADER sentiment analyzer
    sia = SentimentIntensityAnalyzer()
    
    # Generate temporary cleaned lyrics for sentiment analysis
    print("Cleaning lyrics and calculating VADER compound scores... This may take a minute.")
    cleaned_lyrics = df['Lyrics'].apply(clean_text)
    
    # Calculate compound sentiment score (-1.0 to 1.0)
    def get_vader_score(text):
        if not text.strip():
            return 0.0
        return sia.polarity_scores(text)['compound']
        
    df['Sentiment_Score'] = cleaned_lyrics.apply(get_vader_score)
    
    # Save back to the same CSV file
    df.to_csv(output_file, index=False)
    print(f"Successfully added VADER 'Sentiment_Score' column and updated {output_file}.")

if __name__ == "__main__":
    main()
