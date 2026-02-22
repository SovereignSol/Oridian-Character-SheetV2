import { clampInt } from "./util.js";

export function isPreparedCaster(className) {
  return ["Cleric","Druid","Wizard","Paladin","Artificer"].includes((className||"").trim());
}

export function isKnownCaster(className, subclassName) {
  const cn = (className||"").trim();
  const sn = (subclassName||"").trim();
  if (["Bard","Sorcerer","Warlock","Ranger"].includes(cn)) return true;
  if (cn==="Rogue" && sn==="Arcane Trickster") return true;
  if (cn==="Fighter" && sn==="Eldritch Knight") return true;
  return false;
}

export function findSubclass(subclassesData, className, subName) {
  const c = (subclassesData?.classes||[]).find(x => x.class === className);
  if (!c) return null;
  return (c.subclasses||[]).find(s => s.name === subName) || null;
}

export function alwaysPreparedIds(state, subclassesData) {
  const ids = [];
  const blocks = [state.primary, state.multiclass ? state.secondary : null].filter(Boolean);
  for (const b of blocks) {
    const className = (b.className||"").trim();
    const subName = (b.subclass||"").trim();
    if (!className || !subName) continue;
    const sub = findSubclass(subclassesData, className, subName);
    const apbl = sub?.spellRules?.alwaysPreparedByLevel || {};
    const lvl = clampInt(b.classLevel||0, 0, 20);
    for (const [k, arr] of Object.entries(apbl)) {
      const need = clampInt(k, 0, 20);
      if (lvl >= need && Array.isArray(arr)) ids.push(...arr);
    }
    // Legacy support: alwaysPrepared (flat list)
    const ap = sub?.spellRules?.alwaysPrepared || [];
    if (Array.isArray(ap)) ids.push(...ap);
  }
  return Array.from(new Set(ids));
}

function computeMaxSpellLevelForProgression(spellcastingData, progressionKey, classLevel) {
  const prog = spellcastingData?.progressions?.[progressionKey] || null;
  if (!prog) return 0;

  const lv = clampInt(classLevel, 0, 20);
  if (lv <= 0) return 0;

  // If the data provides a per-level map, prefer it.
  if (prog?.maxSpellLevel && typeof prog.maxSpellLevel === "object" && !Array.isArray(prog.maxSpellLevel)) {
    const m = prog.maxSpellLevel[String(lv)];
    return Number.isFinite(m) ? m : 0;
  }

  // Pact Magic table: slotLevel is the max spell level for that warlock level.
  if (prog?.pactMagicTable) {
    const row = prog.pactMagicTable[String(lv)];
    const m = row?.slotLevel;
    return Number.isFinite(m) ? m : 0;
  }

  // Slot table: find the highest slot level with >0 slots at that class level.
  if (prog?.slotTable) {
    const row = prog.slotTable[String(lv)];
    if (Array.isArray(row)) {
      for (let i = row.length - 1; i >= 0; i--) {
        if (Number(row[i] || 0) > 0) return i + 1;
      }
      return 0;
    }
    // If the row is stored as an object mapping slot-level to count:
    if (row && typeof row === "object") {
      let best = 0;
      for (const [k, v] of Object.entries(row)) {
        const sl = Number(k);
        if (!Number.isFinite(sl)) continue;
        if (Number(v || 0) > 0) best = Math.max(best, sl);
      }
      return best;
    }
  }

  // Fallback: constant maximum (not ideal, but better than nothing).
  const c = prog?.maxSpellLevel;
  return Number.isFinite(c) ? c : 0;
}

export function allowedSpellIds(state, spellcastingData, subclassesData) {
  const allowed = [];
  const blocks = [state.primary, state.multiclass ? state.secondary : null].filter(Boolean);

  const maxLevelForBlock = (b) => {
    const className = (b.className||"").trim();
    const subName = (b.subclass||"").trim();
    const classLevel = clampInt(b.classLevel||0, 0, 20);
    if (!className || classLevel<=0) return 0;

    let progression = spellcastingData?.classes?.[className]?.progression || null;
    const sub = findSubclass(subclassesData, className, subName);
    const sr = sub?.spellRules || null;
    if (sr?.progression) progression = sr.progression;

    return computeMaxSpellLevelForProgression(spellcastingData, progression, classLevel);
  };

  const listByLevelForBlock = (b) => {
    const className = (b.className||"").trim();
    const subName = (b.subclass||"").trim();
    if (!className) return null;

    let list = spellcastingData?.classes?.[className]?.spellListByLevel || null;
    const sub = findSubclass(subclassesData, className, subName);
    const sr = sub?.spellRules || null;
    if (sr?.spellSourceClass) {
      list = spellcastingData?.classes?.[sr.spellSourceClass]?.spellListByLevel || list;
    }
    return list;
  };

  for (const b of blocks) {
    const maxLv = maxLevelForBlock(b);
    const lb = listByLevelForBlock(b);
    if (!lb) continue;
    for (let lv=0; lv<=maxLv; lv++) {
      const arr = lb[String(lv)] || [];
      for (const s of arr) allowed.push(s.id);
    }
  }

  for (const ap of alwaysPreparedIds(state, subclassesData)) allowed.push(ap);
  return Array.from(new Set(allowed));
}

export function spellsByLevel(spellCatalog, allowedIds) {
  const byLevel = new Map();
  const allowed = new Set(allowedIds);
  for (const sp of (spellCatalog?.spells || [])) {
    if (!allowed.has(sp.id)) continue;
    const lv = Number(sp.level);
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(sp);
  }
  for (const arr of byLevel.values()) arr.sort((a,b)=>a.name.localeCompare(b.name));
  return byLevel;
}
