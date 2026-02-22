import { clampInt } from "./util.js";

/**
 * Apply structured effects to character state.
 *
 * Supported effect types:
 * - skillProficiency: { skillId, level(1|2), source? }
 * - savingThrowProficiency: { ability }
 * - toolProficiency: { value, source? }
 * - languageProficiency: { value, source? }
 * - abilityIncrease: { ability, amount, max?, min?, source? }
 * - hpNowAdd: { amount }
 * - resourceEnsure: { name, reset("none"|"short"|"long"), max?, maxByLevel?, fill? }
 *
 * applyEffects is designed to be mostly idempotent. Avoid using "abilityIncrease" in effects that
 * might be re-applied without a stable "already applied" gate.
 */
export function applyEffects(state, effects, ctx = {}) {
  const next = structuredClone(state);
  if (!Array.isArray(effects)) return next;

  const defaultSource = String(ctx?.source || "");

  // Ensure expected containers exist
  next.profSources = next.profSources || { skills:{}, tools:{}, languages:{} };
  next.skills = next.skills || {};
  next.saves = next.saves || {};
  next.abilities = next.abilities || {};
  next.combat = next.combat || {};
  next.toolProficiencies = Array.isArray(next.toolProficiencies) ? next.toolProficiencies : [];
  next.languageProficiencies = Array.isArray(next.languageProficiencies) ? next.languageProficiencies : [];
  next.resources = next.resources || { spellSlotsUsed:{}, pactSlotsUsed:0, custom:[] };
  next.resources.custom = Array.isArray(next.resources.custom) ? next.resources.custom : [];

  for (const e of effects) {
    if (!e || typeof e !== "object") continue;
    const t = String(e.type || "");

    if (t === "skillProficiency") {
      const id = String(e.skillId || "");
      const lvl = clampInt(e.level ?? 1, 1, 2);
      if (id && (id in next.skills)) {
        const cur = Number(next.skills[id] || 0);
        if (lvl > cur) {
          next.skills[id] = lvl;
          const src = String(e.source || defaultSource || "");
          if (src) next.profSources.skills[id] = src;
        }
      }
    }

    if (t === "savingThrowProficiency") {
      const ab = String(e.ability || "");
      if (ab && (ab in next.saves)) next.saves[ab] = true;
    }

    if (t === "toolProficiency") addSourced(next, "toolProficiencies", e.value, String(e.source || defaultSource || "trait"));
    if (t === "languageProficiency") addSourced(next, "languageProficiencies", e.value, String(e.source || defaultSource || "trait"));

    if (t === "abilityIncrease") {
      const ab = String(e.ability || "");
      const amt = clampInt(e.amount ?? 0, -10, 10);

      // Default: ASI-style caps at 20, but allow class features to exceed (e.max).
      const max = Number.isFinite(Number(e.max)) ? clampInt(Number(e.max), 1, 30) : 20;
      const min = Number.isFinite(Number(e.min)) ? clampInt(Number(e.min), 1, max) : 1;

      if (ab && (ab in next.abilities)) {
        next.abilities[ab] = clampInt(Number(next.abilities[ab] || 0) + amt, min, max);
      }
    }

    if (t === "hpNowAdd") {
      const amt = clampInt(e.amount ?? 0, -9999, 9999);
      next.combat.hpNow = clampInt(Number(next.combat.hpNow || 0) + amt, 0, Number(next.combat.hpMax || 9999));
    }

    if (t === "resourceEnsure") {
      const name = String(e.name || "").trim();
      if (!name) continue;

      const reset = normalizeReset(String(e.reset || "none"));
      const max = computeResourceMax(e, ctx);
      if (!Number.isFinite(Number(max))) continue;

      const desiredMax = clampInt(Number(max), 0, 9999);
      const fill = (e.fill === undefined) ? true : !!e.fill;
      const src = String(ctx?.source || "");

      let r = next.resources.custom.find(x => String(x?.name || "").trim() === name) || null;
      if (!r) {
        next.resources.custom.push({ name, cur: fill ? desiredMax : 0, max: desiredMax, reset, source: src });
      } else {
        // Only auto-maintain the resource if it was created by the same source, or if it has no source yet.
        if (r.source && src && r.source !== src) continue;
        r.reset = reset || (r.reset || "none");
        r.max = desiredMax;
        r.cur = clampInt(Number(r.cur || 0), 0, desiredMax);
        if (fill) r.cur = desiredMax;
        if (!r.source && src) r.source = src;
      }
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

function normalizeReset(v) {
  const s = String(v || "none");
  if (s === "short" || s === "long" || s === "none") return s;
  return "none";
}

function computeResourceMax(effect, ctx) {
  if (effect?.maxByLevel && typeof effect.maxByLevel === "object") {
    const lv = clampInt(ctx?.classLevel ?? ctx?.grantLevel ?? 0, 0, 20);
    // Exact match first
    const direct = effect.maxByLevel[String(lv)];
    if (Number.isFinite(Number(direct))) return Number(direct);

    // Otherwise, nearest lower level
    let best = null;
    let bestLv = -1;
    for (const [k, v] of Object.entries(effect.maxByLevel)) {
      const klv = Number(k);
      if (!Number.isFinite(klv)) continue;
      if (klv <= lv && klv > bestLv && Number.isFinite(Number(v))) {
        best = Number(v);
        bestLv = klv;
      }
    }
    if (best !== null) return best;
  }

  if (Number.isFinite(Number(effect?.max))) return Number(effect.max);
  return NaN;
}
