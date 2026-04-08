# ⛵ KNRB Regatta Checker

Just a small weekend side-project to automate KNRB regatta eligibility checks. It pulls data directly from the FOYS API to quickly see if crews actually follow the rules for specific fields (like Development, Nieuweling, Eerstejaars, etc.). 

Saves everyone the hassle of manually checking points and race history for every single rower before the weekend!

## What it checks
- **Development (4- & 2x):** Point limits (max 10 or 5 total) and the "max 2 seasons" rule. *(For the points, it smartly excludes points won in the current running season to mimic the Jan 1st rule)*.
- **Nieuweling:** Average points < 2.0 (with a handy toggle for combined or sweep/scull-only points).
- **Gevorderde & Beginner:** Point limits per rower or crew average.
- **Eerstejaars & Junior:** Checks if they are actually first-years and verifies age limits.

## Running it locally

You just need Node.js installed.

```bash
# Install dependencies
npm install

# Start the server
npm start
```
Then open `http://localhost:3000` in your browser.

## Deploying with Docker

If you want to host it on a small VPS, a basic `docker-compose.yml` is included. 

```bash
docker-compose up --build -d
```
It spins up a lightweight Alpine-based container exposing port `3000`. Just stick an Nginx or Caddy reverse proxy in front of it and you're good to go.

---
*Built with basic Node/Express and vanilla JS. Based on the Reglement voor Roeiwedstrijden (versie 22 nov 2025).*
