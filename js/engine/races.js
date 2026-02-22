import { clampInt } from "./util.js";
import { applyEffects } from "./effects.js";

const RACE_SOURCE = "race";

export function applyRaceToState(state, race) {
  const next = structuredClone(state);

  // Remove old race ability bonuses if we previously applied them.
  next.raceBonusesApplied = next.raceBonusesApplied || {};
  if (next.abilities && next.raceBonusesApplied && typeof next.raceBonusesApplied === "object") {
    for (const [ab, amtRaw] of Object.entries(next.raceBonusesApplied)) {
      const amt = clampInt(amtRaw, -10, 10);
      if (ab in next.abilities) next.abilities[ab] = clampInt(Number(next.abilities[ab] || 0) - amt, 1, 30);
    }
  }
  next.raceBonusesApplied = {};

  // Remove old race-sourced proficiencies and features.
  stripSource(next, RACE_SOURCE);

  // Apply new race
  next.raceId = race?.id || "";
  next.race = race?.name || "";

  // Ability bonuses (simple additive).
  if (race?.abilityBonuses && next.abilities) {
    for (const [ab, amtRaw] of Object.entries(race.abilityBonuses)) {
      const amt = clampInt(amtRaw, -10, 10);
      if (ab in next.abilities) {
        next.abilities[ab] = clampInt(Number(next.abilities[ab] || 0) + amt, 1, 30);
        next.raceBonusesApplied[ab] = (next.raceBonusesApplied[ab] || 0) + amt;
      }
    }
  }

  // Speed
  if (Number.isFinite(Number(race?.speed))) next.combat.speed = clampInt(Number(race.speed), 0, 999);

  // Proficiencies (skills/tools/languages), with sources
  next.profSources = next.profSources || { skills: {}, tools: {}, languages: {} };

  if (Array.isArray(race?.skills)) {
    for (const sid of race.skills) {
      const id = String(sid || "");
      if (!id) continue;
      if (next.skills && (id in next.skills)) {
        if (Number(next.skills[id] || 0) === 0) next.skills[id] = 1;
        next.profSources.skills[id] = RACE_SOURCE;
      }
    }
  }

  next.toolProficiencies = Array.isArray(next.toolProficiencies) ? next.toolProficiencies : [];
  next.languageProficiencies = Array.isArray(next.languageProficiencies) ? next.languageProficiencies : [];

  for (const t of (Array.isArray(race?.tools) ? race.tools : [])) addSourced(next.toolProficiencies, t, RACE_SOURCE);
  for (const l of (Array.isArray(race?.languages) ? race.languages : [])) addSourced(next.languageProficiencies, l, RACE_SOURCE);

  // Trait list
  next.features = Array.isArray(next.features) ? next.features : [];
  if (Array.isArray(race?.traits)) {
    for (const tr of race.traits) {
      const name = String(tr?.name || "").trim();
      const text = String(tr?.text || "").trim();
      if (!name && !text) continue;
      const key = `race:${race?.id || race?.name || "race"}:${name || "trait"}`;
      if (!next.features.some(x => x && x.key === key)) {
        next.features.push({ key, source: RACE_SOURCE, name: name || "Racial Trait", text });
      }
    }
  }

  // Optional structured effects
  if (Array.isArray(race?.effects)) {
    return applyEffects(next, race.effects);
  }
  return next;
}

function stripSource(state, source) {
  // Features
  if (Array.isArray(state.features)) state.features = state.features.filter(f => (f?.source || "") !== source);

  // Tool/language list entries are objects like {value, source}
  if (Array.isArray(state.toolProficiencies)) state.toolProficiencies = state.toolProficiencies.filter(x => (x?.source || "") !== source);
  if (Array.isArray(state.languageProficiencies)) state.languageProficiencies = state.languageProficiencies.filter(x => (x?.source || "") !== source);

  // Skills sources, remove and also clear proficiency if it was only proficiency (not expertise).
  if (state.profSources?.skills) {
    for (const [k,v] of Object.entries(state.profSources.skills)) {
      if (v === source) {
        delete state.profSources.skills[k];
        if (state.skills && Number(state.skills[k]||0) === 1) state.skills[k] = 0;
      }
    }
  }
  if (state.profSources?.tools) {
    for (const [k,v] of Object.entries(state.profSources.tools)) {
      if (v === source) delete state.profSources.tools[k];
    }
  }
  if (state.profSources?.languages) {
    for (const [k,v] of Object.entries(state.profSources.languages)) {
      if (v === source) delete state.profSources.languages[k];
    }
  }
}


function addSourced(list, value, source) {
  if (!value) return;
  const key = String(value);
  if (!list.some(x => x && x.value === key)) list.push({ value: key, source });
}
