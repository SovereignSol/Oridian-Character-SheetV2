import { skillIdMap } from "./ids.js";
const BG_SOURCE = "background";
export function applyBackgroundToState(state, background) {
  const next = structuredClone(state);
  next.backgroundId = background?.id || "";
  next.backgroundName = background?.name || "";
  next.profSources = next.profSources || { skills: {}, tools: {}, languages: {} };

  const skills = Array.isArray(background?.skills) ? background.skills : [];
  for (const sid of skills) {
    const id = skillIdMap[sid] || sid;
    if (!(id in next.skills)) continue;
    if (Number(next.skills[id] || 0) === 0) next.skills[id] = 1;
    next.profSources.skills[id] = BG_SOURCE;
  }

  next.toolProficiencies = next.toolProficiencies || [];
  next.languageProficiencies = next.languageProficiencies || [];

  for (const t of (Array.isArray(background?.tools) ? background.tools : [])) addSourced(next.toolProficiencies, t, BG_SOURCE);
  for (const l of (Array.isArray(background?.languages) ? background.languages : [])) addSourced(next.languageProficiencies, l, BG_SOURCE);

  const feat = background?.feature;
  if (feat && (feat.name || feat.text)) {
    next.features = next.features || [];
    const key = `bg:${background.id || background.name || "background"}`;
    if (!next.features.some(x => x && x.key === key)) next.features.push({ key, source: BG_SOURCE, name: feat.name || "Background Feature", text: feat.text || "" });
  }
  return next;
}
function addSourced(list, value, source) {
  if (!value) return;
  const key = String(value);
  if (!list.some(x => x && x.value === key)) list.push({ value: key, source });
}
