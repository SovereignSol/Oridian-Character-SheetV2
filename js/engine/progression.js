export const ASI_LEVELS_BY_CLASS = {
  Barbarian: [4,8,12,16,19],
  Bard: [4,8,12,16,19],
  Cleric: [4,8,12,16,19],
  Druid: [4,8,12,16,19],
  Fighter: [4,6,8,12,14,16,19],
  Monk: [4,8,12,16,19],
  Paladin: [4,8,12,16,19],
  Ranger: [4,8,12,16,19],
  Rogue: [4,8,10,12,16,19],
  Sorcerer: [4,8,12,16,19],
  Warlock: [4,8,12,16,19],
  Wizard: [4,8,12,16,19],
};

export function countAsiSlots(className, classLevel) {
  const levels = ASI_LEVELS_BY_CLASS[className] || [];
  let n = 0;
  for (const lv of levels) if (classLevel >= lv) n++;
  return n;
}

export function earnedPickSlots({ multiclass, primary, secondary }) {
  // One pick at overall level 1, per your rule.
  let slots = 1;

  const pName = (primary?.className || "").trim();
  const pLvl = Number(primary?.classLevel || 0);
  if (pName && pLvl > 0) slots += countAsiSlots(pName, pLvl);

  if (multiclass) {
    const sName = (secondary?.className || "").trim();
    const sLvl = Number(secondary?.classLevel || 0);
    if (sName && sLvl > 0) slots += countAsiSlots(sName, sLvl);
  }
  return slots;
}
