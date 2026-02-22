export const EQUIP_GROUPS_LEFT = [
  { id:"head", label:"Head", slots:3 },
  { id:"neck", label:"Neck", slots:3 },
  { id:"body", label:"Body/Armor", slots:3, ac:true },
  { id:"waist", label:"Waist", slots:3 },
  { id:"legs", label:"Legs", slots:3 },
  { id:"feet", label:"Feet", slots:3 },
];

export const EQUIP_GROUPS_RIGHT = [
  { id:"face", label:"Face", slots:3 },
  { id:"shoulders", label:"Shoulders", slots:3 },
  { id:"torso", label:"Torso", slots:3 },
  { id:"arms", label:"Arms", slots:3 },
];

export function emptyItem() {
  return { name:"", short:"", long:"", acBonus:"" };
}

export function defaultEquipment() {
  const slots = {};
  for (const g of [...EQUIP_GROUPS_LEFT, ...EQUIP_GROUPS_RIGHT]) {
    slots[g.id] = Array.from({ length: g.slots }).map(() => emptyItem());
  }
  slots.ringsRight = Array.from({ length: 6 }).map(() => emptyItem());
  slots.ringsLeft = Array.from({ length: 6 }).map(() => emptyItem());
  slots.shields = Array.from({ length: 3 }).map(() => ({ ...emptyItem(), acBonus:"" }));
  slots.weapons = Array.from({ length: 6 }).map(() => ({ ...emptyItem(), hitDice:"", equipped:false }));
  return { portraitDataUrl:"", slots, bag:{ items:[] } };
}

export function computeEquipmentAcBonus(eq) {
  let total = 0;
  const add = (v) => { const n = Number(v); if (Number.isFinite(n)) total += n; };
  const slots = eq?.slots || {};
  for (const arr of Object.values(slots)) {
    if (!Array.isArray(arr)) continue;
    for (const it of arr) add(it?.acBonus);
  }
  return total;
}

export function getEquippedWeapon(eq) {
  const w = eq?.slots?.weapons;
  if (!Array.isArray(w)) return null;
  return w.find(x => x && x.equipped) || null;
}

export function getEquippedWeaponDice(eq) {
  return (getEquippedWeapon(eq)?.hitDice || "").trim();
}

export function setEquippedWeapon(eq, idx) {
  const w = eq?.slots?.weapons;
  if (!Array.isArray(w)) return;
  for (let i=0;i<w.length;i++) w[i].equipped = (i===idx);
}
