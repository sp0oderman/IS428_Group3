@echo off
REM Create venv if it doesn't exist
IF not exist venv python -m venv venv

REM Activate venv and run the script
call venv\Scripts\activate.bat
call pip install git+https://github.com/johnwmillr/LyricsGenius.git
call pip install dotenv

python lyrics_extraction.py
deactivate

rmdir /s /q venv
echo Virtual environment 'venv' has been removed.