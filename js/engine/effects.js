import { clampInt } from "./util.js";
export function applyEffects(state, effects) {
  const next = structuredClone(state);
  if (!Array.isArray(effects)) return next;

  for (const e of effects) {
    if (!e || typeof e !== "object") continue;
    const t = e.type;

    if (t === "skillProficiency") {
      const id = String(e.skillId || "");
      const lvl = clampInt(e.level ?? 1, 1, 2);
      if (id && next.skills && (id in next.skills)) next.skills[id] = Math.max(Number(next.skills[id] || 0), lvl);
    }

    if (t === "savingThrowProficiency") {
      const ab = String(e.ability || "");
      if (ab && next.saves && (ab in next.saves)) next.saves[ab] = true;
    }

    if (t === "toolProficiency") addSourced(next, "toolProficiencies", e.value, "trait");
    if (t === "languageProficiency") addSourced(next, "languageProficiencies", e.value, "trait");

    if (t === "abilityIncrease") {
      const ab = String(e.ability || "");
      const amt = clampInt(e.amount ?? 0, -5, 5);
      if (ab && next.abilities && (ab in next.abilities)) next.abilities[ab] = Math.min(20, clampInt(Number(next.abilities[ab] || 0) + amt, 1, 20));
    }

    if (t === "hpNowAdd") {
      const amt = clampInt(e.amount ?? 0, -9999, 9999);
      next.combat.hpNow = clampInt(Number(next.combat.hpNow || 0) + amt, 0, Number(next.combat.hpMax || 9999));
    }
  }
  return next;
}
function addSourced(state, key, value, source) {
  if (!value) return;
  state[key] = Array.isArray(state[key]) ? state[key] : [];
  const v = String(value);
  if (!state[key].some(x => x && x.value === v)) state[key].push({ value: v, source });
}
