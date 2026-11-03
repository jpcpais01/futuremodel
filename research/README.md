# Oazy Research (desktop)

The Windows app. One frameless window, two portfolios:

- **Core v1.0** (`app/index.html`): the live Hyperliquid book. Home rail, Holdings, Performance, Market, Outlook.
- **Council** (`app/council.html`): the AI council's paper portfolio. Home rail, Holdings, Performance, the Council chamber (live sessions and replays), Sessions, Settings.

The council engine runs in the main process (`main.js`), on the same data folder the council has always used (`%APPDATA%\Oazy Council\data`). The Anthropic key and the sync token are encrypted with Windows' own protection (`safeStorage`) and never leave the PC.

## Run and build

You need Node.js 20 or newer, and `../council` next to this folder (the engine is copied from there).

```powershell
npm install
npm start                 # copies ../council/engine, builds the pages, opens the app
npm run dist              # dist\OazyResearch.exe (portable) and dist\OazyResearchSetup.exe (installs and updates the Start menu app)
```

`F11` toggles full screen. `Tab` moves between pages, `1` to `5` jump to one.

## Files

```
main.js, preload.js        the window, tray, the council's schedule and its IPC
app/index.html             Core v1.0, built from tools/index.src.html and tools/plan.js (plan.js and this page stay on the PC, not in git)
app/oazy.css, oazy-kit.js  the shared look, sky and chart (built from tools/index.src.html)
app/council.*              the Council portfolio's pages
app/cx/                    ticker logos for the council's 155 names
tools/build_app.js         builds app/index.html, oazy.css and oazy-kit.js
tools/plan.example.js      Core's book without the tracked wallet address, used when tools/plan.js is absent
tools/sync_engine.js       copies ../council/engine into engine/
```
