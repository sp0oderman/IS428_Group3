# Spotify Audio Features Dashboard

Welcome to the Spotify Audio Features Dashboard project from IS428 Group 3. This interactive dashboard allows you to explore and visualise various audio features of Spotify hit songs.

## Getting Started

To run the dashboard locally, please follow these steps:

1.  **Open your terminal** and navigate to the project root directory.
2.  **Change directory** to the `Dashboard` folder:
    ```bash
    cd Dashboard
    ```
3.  **Start a local HTTP server** using Python:
    ```bash
    python -m http.server 8000
    ```
4.  **Open your web browser** and go to:
    [http://localhost:8000/](http://localhost:8000/)

---

### Project Structure

- `Dashboard/`: Contains the core dashboard implementation (HTML, CSS, D3.js).
    - `data/masterlist_lyrics_with_features_cleaned_top300_final.csv`: Main consolidated dataset with audio features, lyrics and themes.
    - `data/wordcloud_data_by_year_updated.csv`: Data for the yearly word cloud visualisation and categories.