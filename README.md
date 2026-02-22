# Dynamic D&D Character Sheet (HTML, GitHub Pages)

This repository is a **single-page, HTML-based** dynamic character sheet that uses the data and engine files you supplied:

- Backgrounds apply proficiencies and background features automatically.
- Race packages (data/races.json) apply basic bonuses and traits automatically.
- Saving throws and skills auto-calculate (ability mod + proficiency).
- Spell lists, spell slots (Spellcasting vs Pact Magic), and prepared vs known behavior are handled by the provided rules data.
- BG3-style equipment slots with AC bonuses and an equipped weapon that can auto-fill weapon dice.
- Local-first storage (auto-saves to browser localStorage), with Import/Export.
- Optional Supabase cloud sync (disabled by default).

## Run locally

Because this uses ES modules, you need a small local web server (opening index.html directly with file:// will not work).

### Option A: Python (if installed)

```bash
python -m http.server 8000
```

Then open: http://localhost:8000

### Option B: VS Code Live Server

Open the folder in VS Code, then run the Live Server extension.

## Publish on GitHub Pages

1. Create a new GitHub repo and push these files.
2. In GitHub repo settings:
   - Pages
   - Source: Deploy from a branch
   - Branch: main (root)
3. Your sheet will be available at your GitHub Pages URL.

## Data files

- `data/backgrounds.json`  (background proficiencies and features)
- `data/races.json`        (race packages, you can expand this)
- `data/classes.json`
- `data/subclasses.json`
- `data/spellcasting.json` (spell lists and progressions)
- `data/spells.json`       (spell catalog)
- `data/traits_all_feats.json` (feat list, mostly descriptive text)
- `data/class_features.json` (per-class, per-level feature grants and choice points)

## Cloud sync (optional)

Edit `js/config.js`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Then create a Supabase table called `characters` with:

- `user_id` (text)
- `character_id` (text)
- `payload` (jsonb)
- `updated_at` (timestamptz)

Composite unique key: `(user_id, character_id)`.

If config values are blank, the UI disables the cloud buttons.

## Extending automation

Your feats file is primarily human-readable text, so the sheet tracks feats but does not automatically interpret most of them.
If you want deeper automation (BG3-like), the intended extension point is:

- Add structured `effects` objects to races/traits/feat picks (see `js/engine/effects.js`).

Example effect object:

```json
{ "type": "skillProficiency", "skillId": "perception", "level": 1 }
```


### Class features and level-up choices

The sheet can auto-grant class features and guide you through "choice points" (skill proficiencies, Fighting Style, Expertise, etc.) using:

- `data/class_features.json`

These are applied with stable keys into `state.features` (source `class-primary` / `class-secondary`). Choices are stored in `state.classChoices`.

You can extend this file to include more per-level grants and structured effects.


## Combat tracker tab

This build includes an integrated **Combat** tab (iframe) based on `combat.html`.

- Tracks HP, temp HP, AC, action economy, spell slots (standard and Pact Magic), and supports multiclass slot pooling.
- Syncs key values (HP and slot usage) with the main character sheet via shared localStorage plus postMessage events.

## Offline-first PWA

A basic Progressive Web App setup is included:

- `manifest.webmanifest`
- `sw.js` service worker that caches app assets for offline use
- App icons in `Icons/`

Service workers require serving over HTTP(S) (for local testing, use `python -m http.server`).

## Level-up wizard

The level-up wizard:

- Prompts you to roll Hit Die on level-up (with Roll and Average buttons).
- Guides ASI vs Feat choices.
- Guides spell learning (including the PHB 2014 Eldritch Knight and Arcane Trickster school rules).
