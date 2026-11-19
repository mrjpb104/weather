# Weather

A personal weather web app: National Weather Service point forecasts, observations, alerts and forecast discussions for U.S. locations; Open-Meteo for everywhere else. Live radar (NEXRAD), 12-hour future radar (HRRR model), sun and moon times, UV, air quality and tides.

No build step, no API keys. Hosted on GitHub Pages.

## Files
- `index.html`, `style.css`, `themes.css`, `fonts.css`, `app.js`, `fx.js` (Live sky animation), `icons.js` — the app. When you change any of these, bump the `?v=` stamp on their links in `index.html` so phones load the new copy instead of a cached one.
- `summaries/<OFFICE>.json` — plain-English forecast-discussion summaries, written by a scheduled Claude task
- `discussions/<OFFICE>.json` — the latest original NWS forecast discussion for each summary office, saved hourly by GitHub Actions (`.github/workflows/save-discussions.yml`); the summary task reads these instead of fetching from the web
- `config.json` — which NWS offices get summaries (`summary_offices`) and which areas each summary should emphasize (`office_focus`)
- `scripts/` — helpers the workflows run
- `locations.json` — your saved locations, tab names and tab order, shared by every device and browser you open the app in (written by the app itself; see below)

## Rainfall & records
Each U.S. location shows rain-season totals (since Oct 1, vs. normal), records for today's date and all-time records from the nearest long-record station, using NOAA's ACIS climate data service (the source behind NWS NOWData). Where an airport has an official threaded NWS city record (e.g. San Diego since 1850), that's used by default; a picker switches stations. Links go to the office's storm rainfall totals and newly-set record reports.

## Turning on summaries for a new forecast area
When a location is in an NWS office that doesn't have summaries yet, the app shows a **Turn on summaries** button. If a GitHub token is saved in Settings → Summaries for new areas (fine-grained, this repo only, Actions: read and write), the button runs `enable-summaries.yml` directly in one tap. Otherwise it opens a prefilled GitHub issue titled `Enable summaries: <OFFICE>`; when the repo owner submits it, `.github/workflows/enable-summaries.yml` adds the office to `config.json` (focused on that location), saves its discussion, and closes the issue. The next hourly summary run writes the first summary. You can also run that workflow by hand from the Actions tab.

## Tabs with several places
A tab can be a single place or a named group of places (e.g. **Los Angeles**: Westside, Downtown, Valley). Inside a group, swipe left/right (or tap the dots) to flip between places; everything on the page follows the place you're on. Make a group from Settings → a place's **Move to…** → **New tab…**, then move other places into it. When adding a place, pick which tab it goes in. Home can join a group; Current location stays its own tab.

## Locations that follow you across devices
Saved locations, groups, renamed tabs and tab order live in `locations.json` in this repo, so every device and browser shows the same tabs. Every device reads it (no setup). A device with a GitHub token saved in Settings → GitHub access (fine-grained, this repo only, **Contents: read and write** plus Actions: read and write) also writes changes back; devices without one keep their own edits on top of the shared list. Edits merge, so adding a place on one device and deleting another elsewhere both stick. The repo is public, so `locations.json` (names and coordinates) is publicly visible.

## Summary file format
```json
{
  "office": "SGX", "office_name": "San Diego",
  "afd_id": "<product id or null>", "afd_issued": "<the \"issued\" time from discussions/<OFFICE>.json>",
  "generated": "<ISO time>",
  "headline": "One-sentence takeaway",
  "sections": [{ "title": "Today & tonight", "text": "..." }],
  "coast": "Coastal/beach/marine notes (optional)",
  "watch_for": ["..."],
  "confidence": "..."
}
```

Data: NWS (api.weather.gov), NOAA Regional Climate Centers (ACIS), Open-Meteo, NOAA Tides & Currents, Iowa Environmental Mesonet, RainViewer, CARTO/OpenStreetMap.
