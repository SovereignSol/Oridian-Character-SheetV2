
import { clampInt } from "./util.js";

/**
 * SRD 5.1 (2014-era) leveling and spellcasting helpers.
 * Focus: proficiency, multiclass spell slots (Spellcasting), Pact Magic slots, and per-class known/prepared limits.
 */

export const HIT_DIE_BY_CLASS = {
  Barbarian: 12,
  Fighter: 10,
  Paladin: 10,
  Ranger: 10,
  Bard: 8,
  Cleric: 8,
  Druid: 8,
  Monk: 8,
  Rogue: 8,
  Warlock: 8,
  Artificer: 8,
  Sorcerer: 6,
  Wizard: 6,
};

export function totalCharacterLevel(state){
  const p = clampInt(state?.primary?.classLevel ?? 0, 0, 20);
  const s = state?.multiclass ? clampInt(state?.secondary?.classLevel ?? 0, 0, 20) : 0;
  return clampInt(Math.max(1, p + s), 1, 20);
}

export function proficiencyBonusByTotalLevel(totalLevel){
  const l = clampInt(totalLevel, 1, 20);
  if (l >= 17) return 6;
  if (l >= 13) return 5;
  if (l >= 9) return 4;
  if (l >= 5) return 3;
  return 2;
}

export function averageHpGainPerLevel(hitDie, conMod){
  const die = Number(hitDie);
  const avg = Math.floor(die / 2) + 1; // SRD average
  return avg + Number(conMod || 0);
}

export function recommendedHpMax(state){
  // Uses SRD averages: max at 1st (die) + avg thereafter, plus CON mod each level.
  const conMod = Number(state?.abilities ? abilityMod(state.abilities.CON) : 0);
  const blocks = [
    { name: state?.primary?.className, level: clampInt(state?.primary?.classLevel ?? 0, 0, 20) },
    state?.multiclass ? { name: state?.secondary?.className, level: clampInt(state?.secondary?.classLevel ?? 0, 0, 20) } : null,
  ].filter(Boolean);

  let hp = 0;
  let totalLv = 0;
  for (const b of blocks){
    const hd = HIT_DIE_BY_CLASS[(b.name||"").trim()] || 0;
    for (let i=1;i<=b.level;i++){
      totalLv++;
      if (i===1 && totalLv===1){
        hp += hd + conMod;
      } else {
        hp += (Math.floor(hd/2)+1) + conMod;
      }
    }
  }
  return Math.max(0, Math.trunc(hp));
}

export function abilityMod(score){
  const s = Number(score ?? 10);
  return Math.floor((s - 10) / 2);
}

/* ---------------------- Spell limits (SRD tables) ---------------------- */

// Spells-known tables extracted from SRD 5.1 class tables (see 5thsrd / 5esrd SRD pages).
export const SPELLS_KNOWN_TABLE = {
  Bard:   [0,4,5,6,7,8,9,10,11,12,14,15,15,16,18,19,19,20,22,22,22],
  Sorcerer:[0,2,3,4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,15,15],
  Warlock:[0,2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15],
  Ranger: [0,0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11],
};

export const CANTRIPS_KNOWN_TABLE = {
  Bard:    [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  Cleric:  [0,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  Druid:   [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  Sorcerer:[0,4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6],
  Warlock: [0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4],
  Wizard:  [0,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5],
  // Ranger has no cantrips in SRD 2014
};

// Eldritch Knight and Arcane Trickster use the same spells-known progression.
// Source table reproduced (counts) from the 2014 PHB / SRD-style class tables.
export const THIRD_CASTER_SPELLS_KNOWN_TABLE = [
  0, // 0
  0, // 1
  0, // 2
  3, // 3
  4, // 4
  4, // 5
  4, // 6
  5, // 7
  6, // 8
  6, // 9
  7, // 10
  8, // 11
  8, // 12
  9, // 13
  10,// 14
  10,// 15
  11,// 16
  11,// 17
  11,// 18
  12,// 19
  13,// 20
];

export const ELDRITCH_KNIGHT_CANTRIPS_TABLE = [
  0,0,0,
  2,2,2,2,2,2,2,
  3,3,3,3,3,3,3,3,3,3,3,
];

// Arcane Trickster always has Mage Hand, plus 2 cantrips (levels 3-9), then +3 (levels 10+).
// This table counts total cantrips known, including Mage Hand.
export const ARCANE_TRICKSTER_CANTRIPS_TABLE = [
  0,0,0,
  3,3,3,3,3,3,3,
  4,4,4,4,4,4,4,4,4,4,4,
];

export const WARLOCK_PACT_TABLE = {
  slotLevel: [0,1,1,2,2,3,3,4,4,5,5,5,5,5,5,5,5,5,5,5,5],
  slots:     [0,1,2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,4,4,4,4],
  invocationsKnown:[0,0,2,2,2,3,3,4,4,5,5,5,6,6,6,7,7,7,8,8,8],
  cantripsKnown: CANTRIPS_KNOWN_TABLE.Warlock,
  spellsKnown: SPELLS_KNOWN_TABLE.Warlock,
};

export const MYSTIC_ARCANUM_BY_LEVEL = {
  11: 6,
  13: 7,
  15: 8,
  17: 9,
};

export function spellsKnownLimit(className, classLevel, subclassName){
  const name = (className||"").trim();
  const sub = (subclassName||"").trim();
  const lv = clampInt(classLevel, 0, 20);

  // Subclass-dependent known casters.
  if (name==="Fighter" && sub==="Eldritch Knight"){
    return THIRD_CASTER_SPELLS_KNOWN_TABLE[lv] ?? 0;
  }
  if (name==="Rogue" && sub==="Arcane Trickster"){
    return THIRD_CASTER_SPELLS_KNOWN_TABLE[lv] ?? 0;
  }

  const table = SPELLS_KNOWN_TABLE[name];
  if (!table) return null;
  return table[lv] ?? null;
}

export function cantripsKnownLimit(className, classLevel, subclassName){
  const name = (className||"").trim();
  const sub = (subclassName||"").trim();
  const lv = clampInt(classLevel, 0, 20);

  if (name==="Fighter" && sub==="Eldritch Knight"){
    return ELDRITCH_KNIGHT_CANTRIPS_TABLE[lv] ?? 0;
  }
  if (name==="Rogue" && sub==="Arcane Trickster"){
    return ARCANE_TRICKSTER_CANTRIPS_TABLE[lv] ?? 0;
  }

  const table = CANTRIPS_KNOWN_TABLE[name];
  if (!table) return null;
  return table[lv] ?? null;
}

export function preparedSpellsLimit({ className, classLevel, spellAbilityMod }){
  const name = (className||"").trim();
  const lv = clampInt(classLevel, 0, 20);
  const mod = Number(spellAbilityMod || 0);

  if (lv <= 0) return null;

  // SRD prepared casters
  if (name === "Cleric") return Math.max(1, mod + lv);
  if (name === "Druid") return Math.max(1, mod + lv);
  if (name === "Wizard") return Math.max(1, mod + lv);
  if (name === "Paladin") return Math.max(1, mod + Math.floor(lv/2));

  // Artificer (non-SRD but commonly used): INT mod + floor(level/2), min 1
  if (name === "Artificer") return Math.max(1, mod + Math.floor(lv/2));

  return null;
}


/* ---------------------- Spell slots (Spellcasting vs Pact) ---------------------- */

export function effectiveSpellcasterLevel(state){
  // SRD multiclass slots for Spellcasting feature:
  // Full: bard, cleric, druid, sorcerer, wizard
  // Half: paladin, ranger (round down)
  // Third: EK fighter, AT rogue (round down) if those subclasses are selected
  // Artificer (non-SRD but commonly used): half, rounded UP when multiclassing
  const blocks = [
    { role:"primary", ...state?.primary },
    state?.multiclass ? { role:"secondary", ...state?.secondary } : null,
  ].filter(Boolean);

  let full = 0, halfDown = 0, halfUp = 0, third = 0;

  for (const b of blocks){
    const name = (b.className||"").trim();
    const lv = clampInt(b.classLevel ?? 0, 0, 20);
    const sub = (b.subclass||"").trim();

    if (["Bard","Cleric","Druid","Sorcerer","Wizard"].includes(name)) full += lv;
    else if (["Paladin","Ranger"].includes(name)) halfDown += Math.floor(lv/2);
    else if (name==="Artificer") halfUp += Math.ceil(lv/2);
    else if (name==="Fighter" && sub==="Eldritch Knight") third += Math.floor(lv/3);
    else if (name==="Rogue" && sub==="Arcane Trickster") third += Math.floor(lv/3);
  }
  return clampInt(full + halfDown + halfUp + third, 0, 20);
}


export function spellSlotsForState(state, spellcastingData){
  // Returns:
  // {
  //   effectiveSpellcasterLevel,           // only meaningful when pooled slot rules apply (2+ standard casters)
  //   spellcastingSlots: { "1": n, ... },  // standard Spellcasting slots
  //   pactMagic: { slots, slotLevel, arcanum:[...] } | null
  // }

  const normalizeSlotRow = (arr)=>{
    const out = {};
    if (!Array.isArray(arr)) return out;
    for (let i=0;i<arr.length;i++){
      const v = Number(arr[i]);
      out[String(i+1)] = Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
    }
    return out;
  };

  const blocks = [];
  if (state?.primary?.className) blocks.push({ key:"primary", className: state.primary.className, subclass: state.primary.subclass, classLevel: Number(state.primary.classLevel)||0 });
  if (state?.multiclass && state?.secondary?.className) blocks.push({ key:"secondary", className: state.secondary.className, subclass: state.secondary.subclass, classLevel: Number(state.secondary.classLevel)||0 });

  // Pact Magic (Warlock) is always separate.
  let pact = null;
  for (const b of blocks){
    if (b.className !== "Warlock") continue;
    const lv = Math.max(0, Math.trunc(b.classLevel||0));
    if (lv <= 0) continue;
    pact = pactMagicForLevel(lv, spellcastingData);
    break;
  }

  const progressions = (spellcastingData && spellcastingData.progressions) ? spellcastingData.progressions : {};
  const fullTable = (progressions.full && progressions.full.slotTable) ? progressions.full.slotTable : {};

  // Determine which (non-warlock) classes actually contribute to standard Spellcasting slots.
  // Important 5e 2014 detail:
  // - You only use the pooled multiclass spell slot rules if you have 2+ classes that grant Spellcasting slots.
  // - If you have only one Spellcasting class (even if you're multiclassed into a non-caster), you use that class's own slot table.
  const standardContributors = [];
  for (const b of blocks){
    const cls = String(b.className||"");
    const lv = Math.max(0, Math.trunc(b.classLevel||0));
    if (!cls || lv <= 0) continue;
    if (cls === "Warlock") continue;

    // Third-casters only have slots if they're the correct subclass.
    const sub = String(b.subclass||"");
    if (cls === "Fighter" && sub !== "Eldritch Knight") continue;
    if (cls === "Rogue" && sub !== "Arcane Trickster") continue;

    let progKey = null;
    if (["Bard","Cleric","Druid","Sorcerer","Wizard"].includes(cls)) progKey = "full";
    else if (["Paladin","Ranger"].includes(cls)) progKey = "half";
    else if (cls === "Artificer") progKey = "artificer";
    else if (cls === "Fighter" || cls === "Rogue") progKey = "third";

    if (!progKey) continue;

    // Spellcasting start levels
    const startLv = (progKey === "half") ? 2 : (progKey === "third") ? 3 : 1;
    if (lv < startLv) continue;

    standardContributors.push({ progKey, classLevel: lv });
  }

  // If we have 2+ standard casters, use pooled slot rules.
  if (standardContributors.length >= 2){
    const eff = effectiveSpellcasterLevel(state);
    const row = fullTable[String(eff)] || fullTable[eff] || [];
    return { effectiveSpellcasterLevel: eff, spellcastingSlots: normalizeSlotRow(row), pactMagic: pact };
  }

  // Otherwise, use the single contributing class's table (if any).
  if (standardContributors.length === 1){
    const c = standardContributors[0];
    const table = (progressions[c.progKey] && progressions[c.progKey].slotTable) ? progressions[c.progKey].slotTable : {};
    const row = table[String(c.classLevel)] || table[c.classLevel] || [];
    return { effectiveSpellcasterLevel: 0, spellcastingSlots: normalizeSlotRow(row), pactMagic: pact };
  }

  return { effectiveSpellcasterLevel: 0, spellcastingSlots: {}, pactMagic: pact };
}


function normalizeSlotRow(row){
  // Accept either [n1,n2,...] or {"1":n1,"2":n2,...}
  if (Array.isArray(row)){
    const out = {};
    for (let i=0;i<row.length;i++){
      out[String(i+1)] = Number(row[i] || 0);
    }
    return out;
  }
  if (row && typeof row === "object"){
    const out = {};
    for (const [k,v] of Object.entries(row)){
      out[String(k)] = Number(v || 0);
    }
    return out;
  }
  return {};
}


export function spellLimitsForState(state){
  // Class-specific known/prepared stay separate under SRD multiclass rules.
  const out = [];
  const blocks = [
    { label:"Primary", ...state?.primary },
    state?.multiclass ? { label:"Secondary", ...state?.secondary } : null,
  ].filter(Boolean);

  for (const b of blocks){
    const className = (b.className||"").trim();
    const classLevel = clampInt(b.classLevel ?? 0, 0, 20);
    const subclassName = (b.subclass||"").trim();
    if (!className || classLevel<=0) continue;

    const known = spellsKnownLimit(className, classLevel, subclassName);
    const cantrips = cantripsKnownLimit(className, classLevel, subclassName);
    const prepared = preparedSpellsLimit({ className, classLevel, spellAbilityMod: Number(b.spellMod||0) });

    out.push({
      label: b.label,
      className,
      classLevel,
      knownSpellsMax: known,
      cantripsKnownMax: cantrips,
      preparedSpellsMax: prepared,
    });
  }
  return out;
}
