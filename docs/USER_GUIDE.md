# User Guide (Quick)

## Tabs
- **Sheet**: Core character stats, attacks, HP, AC, saves, skills.
- **Spells**: Known/prepared spells, spell limits, and slot usage.
- **Feats**: Track feats.
- **Equipment**: Inventory and encumbrance tools.
- **Build**: Class progression and build helpers.
- **Settings**: Configuration and resets.
- **Combat**: Integrated combat tracker with action economy and trackers.
- **Import/Export**: JSON backup and restore (export includes combat tracker state).

## Combat tab syncing
The Combat tab mirrors:
- Current HP / Max HP / Temp HP
- Spell slot usage (standard slots, pooled slots for multiclass spellcasters, and Pact Magic)

Edits made in either tab are pushed to the other tab automatically.

## Offline use
If hosted over HTTP(S), the app registers a service worker for offline use.
