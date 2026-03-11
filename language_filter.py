import csv
import re
from pathlib import Path
from langdetect import detect, LangDetectException
from langdetect import DetectorFactory

# Make detection deterministic
DetectorFactory.seed = 42

INPUT_CSV = Path('spotify_2010_2025.csv')
OUTPUT_CSV = Path('lyrics labelled.csv')

STRIP_PATTERN = re.compile(r'\[.*?\]')  # Remove section labels like [Chorus], [Verse 1]


def get_lyrics_language(lyrics: str) -> str:
    """Return detected language code, or 'en' if lyrics are missing/too short."""
    if not lyrics or lyrics.strip() in ('', '0'):
        return 'en'

    # Strip structural annotations to get cleaner text for detection
    clean = STRIP_PATTERN.sub('', lyrics).strip()
    if len(clean) < 30:
        return 'en'

    try:
        return detect(clean)
    except LangDetectException:
        return 'en'


def main() -> None:
    with INPUT_CSV.open('r', encoding='utf-8', newline='') as infile:
        reader = csv.DictReader(infile)
        fieldnames = list(reader.fieldnames) + ['language']

        rows = []
        lang_counts: dict[str, int] = {}

        for row in reader:
            lang = get_lyrics_language(row.get('Lyrics', ''))
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
            row['language'] = lang
            rows.append(row)

        total = len(rows)
        print(f"Total rows processed : {total}")
        print(f"\nLanguage breakdown:")
        for lang, count in sorted(lang_counts.items(), key=lambda x: -x[1]):
            print(f"  {lang:>6} : {count}")

    with OUTPUT_CSV.open('w', encoding='utf-8', newline='') as outfile:
        writer = csv.DictWriter(outfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nOutput file written: {OUTPUT_CSV}")


if __name__ == '__main__':
    main()
