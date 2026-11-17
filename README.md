# Weather

A personal weather web app: National Weather Service point forecasts, observations, alerts and forecast discussions for U.S. locations; Open-Meteo for everywhere else. Live radar (NEXRAD), 12-hour future radar (HRRR model), sun and moon times, UV, air quality and tides.

No build step, no API keys. Hosted on GitHub Pages.

## Files
- `index.html`, `style.css`, `app.js` — the app
- `summaries/<OFFICE>.json` — plain-English forecast-discussion summaries, written by a scheduled Claude task
- `config.json` — which NWS offices get summaries (`summary_offices`) and which areas each summary should emphasize (`office_focus`)

## Summary file format
```json
{
  "office": "SGX", "office_name": "San Diego",
  "afd_id": "<api.weather.gov product id>", "afd_issued": "<ISO time of the AFD summarized>",
  "generated": "<ISO time>",
  "headline": "One-sentence takeaway",
  "sections": [{ "title": "Today & tonight", "text": "..." }],
  "coast": "Coastal/beach/marine notes (optional)",
  "watch_for": ["..."],
  "confidence": "..."
}
```

Data: NWS (api.weather.gov), Open-Meteo, NOAA Tides & Currents, Iowa Environmental Mesonet, RainViewer, CARTO/OpenStreetMap.
