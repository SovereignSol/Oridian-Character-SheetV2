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

