# Data and State Notes

## Storage keys
- Character sheet: `dnd_character_state_v1`
- Combat tracker: `generic_tracker_state_v5_multiclass_pooled_packages`

## Combat fields mirrored to character state
- `combat.hpMax`, `combat.hpNow`, `combat.hpTemp`
- `resources.spellSlotsUsed` (per spell level 1-9)
- `resources.pactSlotsUsed`

## Spell slot rules
- If you have 2+ classes that grant standard Spellcasting slots, the app uses pooled multiclass slot rules.
- If you have only 1 Spellcasting class (even if you multiclass into a non-caster), the app uses the single class slot table.
- Pact Magic is tracked separately.
