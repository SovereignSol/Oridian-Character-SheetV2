import { clampInt } from "./util.js";
export function hitDieForClass(className){
  switch((className||"").trim()){
    case "Barbarian": return "d12";
    case "Fighter":
    case "Paladin":
    case "Ranger": return "d10";
    case "Bard":
    case "Cleric":
    case "Druid":
    case "Monk":
    case "Rogue":
    case "Warlock":
    case "Artificer": return "d8";
    case "Sorcerer":
    case "Wizard": return "d6";
    default: return "";
  }
}
export function defaultHitDicePools(state){
  const pools = {};
  const add=(die,count)=>{
    if(!die||!count) return;
    pools[die]=pools[die]||{max:0,remaining:0};
    pools[die].max+=count; pools[die].remaining+=count;
  };
  add(hitDieForClass(state?.primary?.className), clampInt(state?.primary?.classLevel||0,0,20));
  if(state?.multiclass) add(hitDieForClass(state?.secondary?.className), clampInt(state?.secondary?.classLevel||0,0,20));
  for(const k of Object.keys(pools)) pools[k].remaining=Math.min(pools[k].remaining,pools[k].max);
  return pools;
}
export function applyShortRestHitDice(state, spendMap, { mode="roll" } = {}){
  // spendMap: { "d8": 2, "d10": 1 } etc.
  // mode: "roll" (default) or "average"
  const next = structuredClone(state);
  next.rest = next.rest || {};
  next.rest.hitDice = next.rest.hitDice || defaultHitDicePools(next);

  const conScore = Number(next?.abilities?.CON ?? 10);
  const conMod = Math.floor((conScore - 10) / 2);

  let healed = 0;

  for(const [die,spendRaw] of Object.entries(spendMap||{})){
    const spend = clampInt(spendRaw,0,999);
    const pool = next.rest.hitDice[die];
    if(!pool) continue;

    const use = Math.min(spend, pool.remaining);
    pool.remaining -= use;

    const faces = dieToFaces(die);
    for (let i=0;i<use;i++){
      const base = (mode==="average") ? (Math.floor(faces/2)+1) : rollDie(faces);
      healed += Math.max(0, base + conMod);
    }
  }

  const hpMax = Number(next.combat?.hpMax||0);
  const hpNow = Number(next.combat?.hpNow||0);
  next.combat.hpNow = clampInt(hpNow + healed, 0, hpMax||9999);
  return next;
}

function dieToFaces(die){
  const m = String(die||"").match(/d(\d+)/i);
  const faces = m ? Number(m[1]) : 0;
  return Number.isFinite(faces) ? faces : 0;
}

function rollDie(faces){
  const f = Math.max(1, Math.trunc(Number(faces||0)));
  // cryptographically strong randomness
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % f) + 1;
}

export function applyLongRest(state){
  const next=structuredClone(state);
  next.rest=next.rest||{};
  next.rest.hitDice=defaultHitDicePools(next);
  next.rest.preparedUnlock=(next.rest.preparedUnlock||0)+1;
  if(next.combat){ next.combat.hpNow=next.combat.hpMax||next.combat.hpNow||0; next.combat.hpTemp=0; }
  return next;
}
