# D4 Co-op Companion

A phone-first Diablo 4 Season 14 companion for two players: leveling guide, per-character build & gear trackers, Helltide node counter, farming targets, session log — all synced live between devices.

## Stack & how sync works

- **Frontend:** plain HTML/CSS/JS, no build step. `content.json` holds ALL guide/build content — adding a build or a new season is a content edit, not a code change.
- **Data & sync:** [Supabase](https://supabase.com) free tier (project `d4-companion`). Three tables: `ticks` (every checkbox/level/counter as a key-value row — field-level last-write-wins), `sessions`, `targets`. Clients subscribe to Postgres realtime changes over websocket, so a tick on one phone appears on the other in under a second. On reconnect/wake the app refetches everything (missed realtime events are not replayed).
- **No login:** a shared **party code** namespaces all rows. Default code is baked in; share via the "Copy invite link" button (`?party=...`). Anyone with the app URL + key could technically read/write — accepted trade-off for a two-person tracker.
- **Hosting:** GitHub Pages (static). Supabase's free tier can't serve HTML, so it does data only.

## Running locally

Any static server works (ES modules won't load from `file://`):

```
cd d4-companion
python -m http.server 8123     # or: npx serve
# open http://localhost:8123
```

## Deploying

Push to the `main` branch of the GitHub repo — Pages serves the site from `/`. That's it.

## Care & feeding

- **"Database is napping" toast / nothing saves:** Supabase free projects pause after ~7 days of inactivity. Open the [Supabase dashboard](https://supabase.com/dashboard) → project `d4-companion` → **Restore**. Takes a minute; reload the app.
- **New season / fresh characters:** Sessions tab → **Reset season…** (wipes + re-seeds from `content.json`), then edit `content.json` for the new builds and push.
- **Editing content:** everything the app shows lives in `content.json` (guide sections, builds, gear ladders, resources, roadmap, seed state). Checklist item `id`s are stable keys — keep them unchanged unless you want ticks to reset for that item.
