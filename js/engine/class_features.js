import { clampInt } from "./util.js";
import { applyEffects } from "./effects.js";

/**
 * Class feature grants + choice points.
 *
 * Data source: data/class_features.json
 *
 * Philosophy:
 * - Grants are applied once (idempotent via a stable feature.key).
 * - Scaling resources (resourceEnsure) are "refreshed" on every sync so max values stay up to date.
 * - Choices are stored in state.classChoices as { [choiceKey]: string[] }.
 */

export function syncClassFeatures(state, classFeaturesData) {
  const next = structuredClone(state);
  const classes = classFeaturesData?.classes || null;
  if (!classes || typeof classes !== "object") return next;

  next.classChoices = (next.classChoices && typeof next.classChoices === "object") ? next.classChoices : {};

  applyBlock(next, "primary", next.primary, classes);
  if (next.multiclass) applyBlock(next, "secondary", next.secondary, classes);

  return next;
}

export function listClassChoicesForState(state, classFeaturesData) {
  const out = [];
  const classes = classFeaturesData?.classes || null;
  if (!classes || typeof classes !== "object") return out;

  const blocks = [
    { which:"primary", block: state.primary },
    ...(state.multiclass ? [{ which:"secondary", block: state.secondary }] : []),
  ];

  const classChoices = (state.classChoices && typeof state.classChoices === "object") ? state.classChoices : {};

  for (const b of blocks) {
    const className = String(b.block?.className || "").trim();
    const classLevel = clampInt(b.block?.classLevel ?? 0, 0, 20);
    if (!className || classLevel <= 0) continue;

    const cd = classes[className];
    const levels = cd?.levels || {};
    for (let lv = 1; lv <= classLevel; lv++) {
      const entry = levels[String(lv)] || null;
      if (!entry) continue;
      for (const choice of (Array.isArray(entry.choices) ? entry.choices : [])) {
        const cid = String(choice?.id || slug(choice?.name || "choice"));
        const choose = clampInt(choice?.choose ?? 1, 1, 20);
        const key = choiceKey(b.which, className, lv, cid);
        const selected = normalizeChoiceValue(classChoices[key]);
        const fulfilled = selected.length >= choose;

        out.push({
          choiceKey: key,
          which: b.which,
          className,
          classLevel,
          level: lv,
          id: cid,
          name: String(choice?.name || cid),
          prompt: String(choice?.prompt || ""),
          choose,
          options: Array.isArray(choice?.options) ? choice.options : [],
          selected,
          fulfilled,
        });
      }
    }
  }

  return out;
}

export function setClassChoice(state, choiceKeyStr, optionIds) {
  const next = structuredClone(state);
  next.classChoices = (next.classChoices && typeof next.classChoices === "object") ? next.classChoices : {};
  const arr = Array.isArray(optionIds) ? optionIds.map(x => String(x)) : [];
  next.classChoices[String(choiceKeyStr)] = Array.from(new Set(arr.filter(Boolean)));
  return next;
}

/* ------------------------------ Internals ----------------------------- */

function applyBlock(next, which, block, classes) {
  const source = classSource(which);
  const className = String(block?.className || "").trim();
  const classLevel = clampInt(block?.classLevel ?? 0, 0, 20);
  if (!className || classLevel <= 0) return;

  const cd = classes[className];
  if (!cd) return;

  // Ensure containers exist
  next.features = Array.isArray(next.features) ? next.features : [];
  next.profSources = next.profSources || { skills:{}, tools:{}, languages:{} };
  next.skills = next.skills || {};
  next.toolProficiencies = Array.isArray(next.toolProficiencies) ? next.toolProficiencies : [];
  next.languageProficiencies = Array.isArray(next.languageProficiencies) ? next.languageProficiencies : [];
  next.resources = next.resources || { spellSlotsUsed:{}, pactSlotsUsed:0, custom:[] };
  next.resources.custom = Array.isArray(next.resources.custom) ? next.resources.custom : [];

  const levels = cd?.levels || {};

  for (let lv=1; lv<=classLevel; lv++) {
    const entry = levels[String(lv)] || null;
    if (!entry) continue;

    // Grants
    for (const g of (Array.isArray(entry.grants) ? entry.grants : [])) {
      const gid = String(g?.id || slug(g?.name || "feature"));
      const key = grantKey(which, className, lv, gid);

      const exists = hasFeature(next, key);
      if (!exists) {
        addFeature(next, key, source, String(g?.name || gid), String(g?.text || ""));
        if (Array.isArray(g?.effects)) {
          applyEffectsWithCtx(next, g.effects, { source, which, className, classLevel, grantLevel: lv });
        }
      } else {
        // Refresh scaling resources (maxByLevel, etc) without reapplying one-time bonuses.
        const resEffects = (Array.isArray(g?.effects) ? g.effects : []).filter(e => e?.type === "resourceEnsure");
        if (resEffects.length) applyEffectsWithCtx(next, resEffects, { source, which, className, classLevel, grantLevel: lv });
      }
    }

    // Choices
    for (const choice of (Array.isArray(entry.choices) ? entry.choices : [])) {
      const cid = String(choice?.id || slug(choice?.name || "choice"));
      const choose = clampInt(choice?.choose ?? 1, 1, 20);
      const ckey = choiceKey(which, className, lv, cid);
      const selected = normalizeChoiceValue(next.classChoices?.[ckey]);

      if (selected.length < choose) continue; // pending

      // Apply selected option effects once per option
      for (const optId of selected.slice(0, choose)) {
        const opt = (Array.isArray(choice?.options) ? choice.options : []).find(o => String(o?.id) === String(optId)) || null;
        const fkey = choiceFeatureKey(ckey, optId);
        if (!hasFeature(next, fkey)) {
          const nm = `${String(choice?.name || cid)}: ${String(opt?.name || optId)}`;
          addFeature(next, fkey, source, nm, String(opt?.text || ""));
          if (Array.isArray(opt?.effects)) applyEffectsWithCtx(next, opt.effects, { source, which, className, classLevel, grantLevel: lv, choiceKey: ckey });
        } else {
          const resEffects = (Array.isArray(opt?.effects) ? opt.effects : []).filter(e => e?.type === "resourceEnsure");
          if (resEffects.length) applyEffectsWithCtx(next, resEffects, { source, which, className, classLevel, grantLevel: lv, choiceKey: ckey });
        }
      }
    }
  }
}

function applyEffectsWithCtx(stateObj, effects, ctx) {
  const out = applyEffects(stateObj, effects, ctx);
  // applyEffects returns a new object, but we want to mutate the caller's reference (sync uses structuredClone).
  // We'll shallow-merge back.
  Object.assign(stateObj, out);
}

function classSource(which) {
  return which === "secondary" ? "class-secondary" : "class-primary";
}

function grantKey(which, className, level, grantId) {
  return `class:${which}:${className}:L${level}:${grantId}`;
}
function choiceKey(which, className, level, choiceId) {
  return `class:${which}:${className}:L${level}:choice:${choiceId}`;
}
function choiceFeatureKey(choiceKeyStr, optId) {
  return `choice:${choiceKeyStr}:${String(optId)}`;
}

function hasFeature(state, key) {
  return Array.isArray(state.features) && state.features.some(f => f && f.key === key);
}
function addFeature(state, key, source, name, text) {
  state.features = Array.isArray(state.features) ? state.features : [];
  state.features.push({ key, source, name, text });
}

function normalizeChoiceValue(v) {
  if (Array.isArray(v)) return v.map(x => String(x)).filter(Boolean);
  if (typeof v === "string" && v) return [v];
  return [];
}

function slug(s) {
  return String(s||"")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "x";
}
