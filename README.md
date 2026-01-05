# League of Legends Scrim Data Pipeline

Automated data collection script that pulls professional League of Legends practice match data from the GRID API into Google Sheets. 

## Background

Professional League teams play practice matches (called "scrims") almost daily, but getting this data into a usable format was tedious. Coaches were manually inputting stats, which took hours and was error-prone. I built this to automate the entire process.

For context: each scrim generates player stats (kills, deaths, gold earned), team objectives (dragons, towers, barons), and draft picks/bans. This script fetches all of that and organizes it into three separate sheets for easy analysis.

## What it does

Connects to GRID's API (they aggregate esports data) and pulls:
- **Player stats** - individual performance metrics like KDA, CS, damage dealt, vision score
- **Team objectives** - which team got first drake, how many grubs, baron control, etc
- **Draft data** - the pick/ban sequence for each game

The script can run on a schedule (daily updates) or be pointed at specific date ranges to backfill historical data. It handles API rate limiting and automatically creates the necessary sheet structure if it doesn't exist.

## Example output structure

**Player Data sheet:**
```
game_id | date | champion | kills | deaths | assists | gold_8min | cs_14min | ...
```

**Team Data sheet:**
```
game_id | side | grubs_taken | first_drake | herald | baron_kills | towers | ...
```

**Draft Data sheet:**
```
game_id | blue_ban1 | red_ban1 | blue_pick1 | red_pick1 | red_pick2 | ...
```

Once the data is in sheets, you can analyze things like win rates by champion, gold differentials at 8/14 minutes, or which draft patterns perform best.

## Technical details

Written in Google Apps Script (JavaScript). Makes requests to three different APIs:
- GRID's GraphQL endpoint to find scrims in a date range
- Riot's match summary API for game stats
- GRID's draft API for pick/ban sequences

Had to deal with paginating through result sets, handling 429 rate limit responses with exponential backoff, and parsing timeline data to extract stats at specific minute marks (8 and 14 minutes for early game analysis).

The data comes from multiple endpoints so there's some reconciliation logic to match team IDs across different API responses.

## Setup

Get an API key from [grid.gg](https://grid.gg/), paste the script into Google Apps Script, add your key, and run it. You can set it up to run automatically with a time-based trigger or manually specify date ranges.

## Why I built this

I was helping a team with their scrim review process and realized most of their time was spent on data entry, not actual analysis. This solved that. It's a decent example of taking a manual workflow and automating it with a simple data pipeline.

The code could be cleaner (the draft parsing is a bit hacky) but it works reliably and saved them a ton of time.
