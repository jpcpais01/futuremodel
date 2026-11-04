# Oazy Research for Windows

One window with both portfolios, Core v1.0 and the Council. Switch between them with the button next to the Oazy logo.

The app only reads the indexes from GitHub (`https://raw.githubusercontent.com/jpcpais01/futuremodel/main/index/`). It keeps a copy on disk, so it opens instantly and still shows the last state when offline. It has no keys, no accounts and no settings.

## Run and build

You need Node.js 20 or newer.

```powershell
npm install
npm start          # opens the app
npm run dist       # dist\OazyResearch.exe (portable) and dist\OazyResearchSetup.exe (installs and updates the Start menu app)
```

The file names never change, so the Oazy launcher always finds the app. Run `OazyResearchSetup.exe` once after a new build to update the installed app.

`F11` toggles full screen. To look at a local `index/` folder instead of GitHub, start it with `OAZY_INDEX_DIR=..\index`.

## Files

```
main.js, preload.js      the window and the read-only connection to the repository
app/index.html, app.js   the pages: Home, Holdings, Performance, and for the Council the chamber (replays) and Sessions
app/app.css              their look, on top of app/oazy.css and app/oazy-kit.js (the shared look, sky and chart)
app/cx/                  ticker logos
tools/                   the artwork and the Oazy launcher entry
```
