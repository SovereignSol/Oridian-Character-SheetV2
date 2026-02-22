import {
  loadCharacterState,
  saveCharacterState,
  defaultCharacterState,
  abilityList,
  skillMeta,
  abilityMod,
  proficiencyBonus,
  formatSigned,
  saveBonus,
  skillBonus,
  passivePerception,
  initiative as initiativeFn,
} from "./engine/character.js";

import { applyBackgroundToState } from "./engine/backgrounds.js";
import { applyRaceToState } from "./engine/races.js";
import { defaultEquipment, computeEquipmentAcBonus, setEquippedWeapon, getEquippedWeaponDice } from "./engine/equipment.js";
import { earnedPickSlots } from "./engine/progression.js";
import { hitDieForClass, defaultHitDicePools, applyShortRestHitDice, applyLongRest } from "./engine/rest.js";
import { recommendedHpMax, spellSlotsForState, spellLimitsForState } from "./engine/rules_5e2014.js";
import { allowedSpellIds, spellsByLevel, isPreparedCaster, isKnownCaster, alwaysPreparedIds } from "./engine/spells_engine.js";

import { isCloudConfigured, cloudSave, cloudLoad } from "./engine/cloud.js";

// ---------------------------- Data loading ----------------------------
async function loadJson(path){
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.json();
}

const DATA = {
  classes: null,
  backgrounds: null,
  races: null,
  spellcasting: null,
  spells: null,
  subclasses: null,
  feats: null,
};

async function loadAllData(){
  const [
    classes,
    backgrounds,
    races,
    spellcasting,
    spells,
    subclasses,
    feats,
  ] = await Promise.all([
    loadJson("data/classes.json"),
    loadJson("data/backgrounds.json"),
    loadJson("data/races.json"),
    loadJson("data/spellcasting.json"),
    loadJson("data/spells.json"),
    loadJson("data/subclasses.json"),
    loadJson("data/traits_all_feats.json"),
  ]);

  DATA.classes = classes;
  DATA.backgrounds = backgrounds;
  DATA.races = races;
  DATA.spellcasting = spellcasting;
  DATA.spells = spells;
  DATA.subclasses = subclasses;
  DATA.feats = feats;
}

function $(id){ return document.getElementById(id); }
function q(sel, root=document){ return root.querySelector(sel); }
function qa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

function safeNum(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function setText(id, txt){ $(id).textContent = txt; }
function setHtml(id, html){ $(id).innerHTML = html; }

let state = null;

// ---------------------------- Tabs ----------------------------
function initTabs(){
  const tabs = qa(".tab");
  const panels = qa(".tab-panel");
  const show = (name) => {
    for (const t of tabs){
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
    }
    for (const p of panels){
      p.classList.toggle("hidden", p.dataset.tab !== name);
    }
  };
  for (const t of tabs){
    t.addEventListener("click", () => show(t.dataset.tab));
  }
}

// ---------------------------- Rendering helpers ----------------------------
function renderAbilities(){
  const root = $("abilitiesGrid");
  root.innerHTML = "";
  for (const ab of abilityList){
    const score = state.abilities[ab];
    const mod = abilityMod(score);

    const wrap = document.createElement("div");
    wrap.className = "ability-box";

    wrap.innerHTML = `
      <div class="top">
        <div class="name">${ab}</div>
        <div class="mod">${formatSigned(mod)}</div>
      </div>
      <div class="score">
        <label class="field" style="flex:1">
          <span>Score</span>
          <input data-ability="${ab}" class="abilityScore" type="number" min="1" max="30" value="${score}">
        </label>
      </div>
    `;
    root.appendChild(wrap);
  }

  qa(".abilityScore", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const ab = inp.dataset.ability;
      state.abilities[ab] = Math.max(1, Math.min(30, Math.trunc(safeNum(inp.value, 10))));
      save();
      rerender();
    });
  });
}

function renderSaves(){
  const root = $("savesGrid");
  root.innerHTML = "";
  for (const ab of abilityList){
    const proficient = !!state.saves[ab];
    const b = saveBonus(state, ab);

    const row = document.createElement("div");
    row.className = "save-row";
    row.innerHTML = `
      <div class="left">
        <label class="field" style="flex-direction:row; align-items:center; gap:8px; margin:0;">
          <input data-save="${ab}" class="saveProf" type="checkbox" ${proficient ? "checked" : ""}>
          <span>${ab}</span>
        </label>
      </div>
      <div class="bonus">${formatSigned(b)}</div>
    `;
    root.appendChild(row);
  }

  qa(".saveProf", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const ab = inp.dataset.save;
      state.saves[ab] = !!inp.checked;
      save();
      rerender();
    });
  });
}

function renderSkills(){
  const root = $("skillsTable");
  root.innerHTML = "";
  for (const sk of skillMeta){
    const lvl = Number(state.skills[sk.id] || 0);
    const b = skillBonus(state, sk.id);
    const src = state.profSources?.skills?.[sk.id] || (lvl ? "manual" : "");

    const row = document.createElement("div");
    row.className = "skill-row";
    row.innerHTML = `
      <div>
        <div><strong>${sk.label}</strong> <span class="meta">(${sk.ability})</span></div>
        <div class="meta">${src ? `source: ${src}` : ""}</div>
      </div>
      <div class="bonus">${formatSigned(b)}</div>
      <select data-skill="${sk.id}" class="skillLevel">
        <option value="0" ${lvl===0?"selected":""}>0</option>
        <option value="1" ${lvl===1?"selected":""}>1</option>
        <option value="2" ${lvl===2?"selected":""}>2</option>
      </select>
    `;
    root.appendChild(row);
  }

  qa(".skillLevel", root).forEach(sel => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.skill;
      const lvl = Math.max(0, Math.min(2, Math.trunc(safeNum(sel.value, 0))));
      state.skills[id] = lvl;
      if (lvl === 0 && state.profSources?.skills?.[id] === "manual") delete state.profSources.skills[id];
      if (lvl > 0){
        state.profSources = state.profSources || { skills:{}, tools:{}, languages:{} };
        if (!state.profSources.skills[id]) state.profSources.skills[id] = "manual";
      }
      save();
      rerender();
    });
  });
}

function renderCore(){
  setText("totalLevel", String(state.level));
  setText("pb", formatSigned(proficiencyBonus(state.level)));
  setText("passivePerception", String(passivePerception(state)));

  setText("initiative", formatSigned(initiativeFn(state)));

  // Spell DC / attack uses primary spell mod by default.
  const pb = proficiencyBonus(state.level);
  const mod = safeNum(state.primary?.spellMod, 0);
  setText("spellDc", String(8 + pb + mod));
  setText("spellAtk", formatSigned(pb + mod));

  // Combat derived
  const ac = computeTotalAc(state);
  setText("acTotal", String(ac));

  // Hit die display
  setText("hitDie", hitDieForClass(state.primary?.className) || "—");

  // Saving throw prof summary
  const saves = abilityList.filter(a => state.saves[a]).join(", ") || "None";
  $("saveProfSummary").textContent = saves;
}

function computeTotalAc(st){
  const eq = st.equipment || null;
  const bonus = eq ? computeEquipmentAcBonus(eq) : 0;
  const base = safeNum(st.combat?.acBase, 10);
  const extra = safeNum(st.combat?.acBonusExtra, 0);
  return Math.max(0, Math.trunc(base + extra + bonus));
}

function renderProficiencies(){
  const tools = Array.isArray(state.toolProficiencies) ? state.toolProficiencies : [];
  const langs = Array.isArray(state.languageProficiencies) ? state.languageProficiencies : [];

  const renderPills = (arr, rootId, removeFn) => {
    const root = $(rootId);
    root.innerHTML = "";
    for (let i=0;i<arr.length;i++){
      const it = arr[i];
      const value = it?.value || "";
      const source = it?.source || "";
      const pill = document.createElement("div");
      pill.className = "pill";
      pill.innerHTML = `
        <span>${escapeHtml(value)}</span>
        <span class="muted small">${source ? `(${source})` : ""}</span>
        <button type="button" data-idx="${i}" aria-label="Remove">✕</button>
      `;
      pill.querySelector("button").addEventListener("click", () => removeFn(i));
      root.appendChild(pill);
    }
    if (arr.length===0){
      const empty = document.createElement("div");
      empty.className = "muted small";
      empty.textContent = "None";
      root.appendChild(empty);
    }
  };

  renderPills(tools, "toolsList", (idx) => {
    tools.splice(idx,1);
    state.toolProficiencies = tools;
    save(); rerender();
  });

  renderPills(langs, "langsList", (idx) => {
    langs.splice(idx,1);
    state.languageProficiencies = langs;
    save(); rerender();
  });
}

function renderFeatures(){
  const root = $("featuresList");
  const feats = Array.isArray(state.features) ? state.features : [];
  root.innerHTML = "";

  for (let i=0;i<feats.length;i++){
    const f = feats[i];
    const name = String(f?.name || "Feature");
    const src = String(f?.source || "");
    const text = String(f?.text || "");

    const box = document.createElement("div");
    box.className = "feature";
    box.innerHTML = `
      <div class="hdr">
        <div>
          <div class="name">${escapeHtml(name)}</div>
          <div class="src">${src ? `source: ${escapeHtml(src)}` : ""}</div>
        </div>
        <button class="btn danger small" type="button" data-idx="${i}">Remove</button>
      </div>
      <div class="txt">${escapeHtml(text)}</div>
    `;
    box.querySelector("button").addEventListener("click", () => {
      feats.splice(i,1);
      state.features = feats;
      save(); rerender();
    });
    root.appendChild(box);
  }

  if (feats.length === 0){
    root.innerHTML = `<div class="muted small">No features yet. Pick a background, race, and feats, or add custom features.</div>`;
  }
}

function renderSlotsAndLimits(){
  const out = spellSlotsForState(state, DATA.spellcasting);

  const slots = out.spellcastingSlots || {};
  const pact = out.pactMagic || { slots:0, slotLevel:0, arcanum:[] };

  // Ensure state.resources spellSlotsUsed has keys
  state.resources = state.resources || { spellSlotsUsed:{}, pactSlotsUsed:0, custom:[] };
  state.resources.spellSlotsUsed = state.resources.spellSlotsUsed || {};
  for (const [k,v] of Object.entries(slots)){
    if (!(k in state.resources.spellSlotsUsed)) state.resources.spellSlotsUsed[k] = 0;
    state.resources.spellSlotsUsed[k] = clampInt(state.resources.spellSlotsUsed[k], 0, Number(v||0));
  }
  state.resources.pactSlotsUsed = clampInt(state.resources.pactSlotsUsed, 0, pact.slots || 0);

  const rows = [];
  rows.push(`<table class="table">
    <thead><tr><th>Slot</th><th>Max</th><th>Used</th><th>Actions</th></tr></thead>
    <tbody>
  `);
  const levels = Object.keys(slots).map(x=>Number(x)).filter(Number.isFinite).sort((a,b)=>a-b);
  if (levels.length === 0){
    rows.push(`<tr><td colspan="4" class="muted">No Spellcasting slots (yet).</td></tr>`);
  } else {
    for (const lv of levels){
      const max = Number(slots[String(lv)] || 0);
      const used = Number(state.resources.spellSlotsUsed[String(lv)] || 0);
      rows.push(`<tr>
        <td>${lv}</td>
        <td>${max}</td>
        <td><input data-slot="${lv}" class="slotUsed" type="number" min="0" max="${max}" value="${used}"></td>
        <td>
          <button data-cast="${lv}" class="btn small castBtn" type="button">Cast</button>
          <button data-restore="${lv}" class="btn small restoreBtn" type="button">Restore</button>
        </td>
      </tr>`);
    }
  }
  rows.push(`</tbody></table>`);

  // Pact magic
  if ((pact.slots||0) > 0){
    const max = pact.slots;
    const used = state.resources.pactSlotsUsed || 0;
    rows.push(`<h3 class="mt">Pact Magic (Warlock)</h3>`);
    rows.push(`<div class="kv"><div>Slot level</div><div><strong>${pact.slotLevel}</strong></div></div>`);
    rows.push(`<div class="kv"><div>Slots</div><div><strong>${max - used}/${max}</strong></div></div>`);
    rows.push(`<div class="grid two mt">
      <button id="pactCastBtn" class="btn" type="button">Use pact slot</button>
      <button id="pactRestoreBtn" class="btn" type="button">Restore pact slot</button>
    </div>`);
    if (Array.isArray(pact.arcanum) && pact.arcanum.length){
      rows.push(`<div class="kv"><div>Mystic Arcanum</div><div><strong>${pact.arcanum.join(", ")}</strong></div></div>`);
    }
  }

  $("slotsTable").innerHTML = rows.join("");

  qa(".slotUsed", $("slotsTable")).forEach(inp => {
    inp.addEventListener("change", () => {
      const lv = String(inp.dataset.slot);
      const max = safeNum(inp.max, 0);
      state.resources.spellSlotsUsed[lv] = clampInt(inp.value, 0, max);
      save(); rerenderSlotsOnly();
    });
  });

  qa(".castBtn", $("slotsTable")).forEach(btn => {
    btn.addEventListener("click", () => {
      const lv = String(btn.dataset.cast);
      const max = Number(slots[lv] || 0);
      const used = Number(state.resources.spellSlotsUsed[lv] || 0);
      if (used < max){
        state.resources.spellSlotsUsed[lv] = used + 1;
        save(); rerenderSlotsOnly();
      }
    });
  });

  qa(".restoreBtn", $("slotsTable")).forEach(btn => {
    btn.addEventListener("click", () => {
      const lv = String(btn.dataset.restore);
      const used = Number(state.resources.spellSlotsUsed[lv] || 0);
      if (used > 0){
        state.resources.spellSlotsUsed[lv] = used - 1;
        save(); rerenderSlotsOnly();
      }
    });
  });

  const pactCast = $("pactCastBtn");
  if (pactCast){
    pactCast.addEventListener("click", () => {
      const max = pact.slots || 0;
      const used = state.resources.pactSlotsUsed || 0;
      if (used < max){
        state.resources.pactSlotsUsed = used + 1;
        save(); rerenderSlotsOnly();
      }
    });
  }
  const pactRestore = $("pactRestoreBtn");
  if (pactRestore){
    pactRestore.addEventListener("click", () => {
      const used = state.resources.pactSlotsUsed || 0;
      if (used > 0){
        state.resources.pactSlotsUsed = used - 1;
        save(); rerenderSlotsOnly();
      }
    });
  }

  // Limits display
  const limits = spellLimitsForState(state);
  const lines = [];
  if (!limits.length){
    lines.push(`<div class="muted">No spell limits to show (pick a class).</div>`);
  } else {
    for (const b of limits){
      lines.push(`<div class="kv"><div>${b.label} (${b.className} ${b.classLevel})</div><div></div></div>`);
      lines.push(`<div class="kv"><div>Known spells max</div><div><strong>${b.knownSpellsMax ?? "—"}</strong></div></div>`);
      lines.push(`<div class="kv"><div>Cantrips max</div><div><strong>${b.cantripsKnownMax ?? "—"}</strong></div></div>`);
      lines.push(`<div class="kv"><div>Prepared max</div><div><strong>${b.preparedSpellsMax ?? "—"}</strong></div></div>`);
    }
  }
  $("spellLimits").innerHTML = lines.join("");
}

function clampInt(v, min, max){
  const n = Number(v);
  const i = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.max(min, Math.min(max, i));
}

function renderSpells(){
  const hint = $("spellModeHint");

  const primary = state.primary || {};
  const cn = (primary.className||"").trim();
  const sn = (primary.subclass||"").trim();

  const prepared = isPreparedCaster(cn);
  const known = isKnownCaster(cn, sn);

  if (!cn){
    hint.textContent = "Pick a class to view spells.";
  } else if (prepared && cn==="Wizard"){
    hint.textContent = "Wizard mode: add spells to your Spellbook (Known) then prepare from the Spellbook. Always-prepared spells appear automatically.";
  } else if (prepared){
    hint.textContent = "Prepared caster mode: prepare spells from your class list. Always-prepared spells appear automatically.";
  } else if (known){
    hint.textContent = "Known caster mode: learn spells (Known). You do not normally prepare spells.";
  } else {
    hint.textContent = "This class does not use spellcasting lists.";
  }

  // Allowed spell ids across all class blocks (primary + secondary, including always prepared)
  const allowedIds = allowedSpellIds(state, DATA.spellcasting, DATA.subclasses);
  const apIds = new Set(alwaysPreparedIds(state, DATA.subclasses));
  const byLevel = spellsByLevel(DATA.spells, allowedIds);

  const search = ($("spellSearch").value || "").trim().toLowerCase();
  const levelFilter = ($("spellLevelFilter").value || "all");

  const root = $("spellsByLevel");
  root.innerHTML = "";

  const levels = Array.from(byLevel.keys()).sort((a,b)=>a-b);

  for (const lv of levels){
    if (levelFilter !== "all" && String(lv) !== String(levelFilter)) continue;

    const section = document.createElement("div");
    section.className = "spell-list-level";

    const header = document.createElement("div");
    header.className = "spell-level-header";
    header.innerHTML = `<strong>${lv===0 ? "Cantrips" : `${ordinal(lv)}-level`}</strong><span class="muted small">${byLevel.get(lv).length} spells</span>`;
    section.appendChild(header);

    const items = document.createElement("div");
    items.className = "spell-items";

    const spells = byLevel.get(lv) || [];
    for (const sp of spells){
      if (search && !String(sp.name||"").toLowerCase().includes(search)) continue;

      const isKnown = state.spells?.known?.includes(sp.id);
      const isPrepared = state.spells?.prepared?.includes(sp.id);
      const isAlwaysPrepared = apIds.has(sp.id);

      const row = document.createElement("div");
      row.className = "spell-item";

      const meta = `${sp.school || ""}${Number.isFinite(Number(sp.level)) ? `, level ${sp.level}` : ""}`;
      row.innerHTML = `
        <div>
          <div class="name">${escapeHtml(sp.name || sp.id)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
        </div>
        <label class="field" style="flex-direction:row; align-items:center; gap:8px; margin:0;">
          <input class="spellKnown" data-id="${sp.id}" type="checkbox" ${isKnown ? "checked":""} ${known || cn==="Wizard" ? "" : "disabled"}>
          <span class="small">Known</span>
        </label>
        <label class="field" style="flex-direction:row; align-items:center; gap:8px; margin:0;">
          <input class="spellPrep" data-id="${sp.id}" type="checkbox" ${isAlwaysPrepared || isPrepared ? "checked":""} ${prepared ? "" : "disabled"} ${(cn==="Wizard" && !isAlwaysPrepared && !isKnown) ? "disabled" : ""} ${isAlwaysPrepared ? "disabled" : ""}>
          <span class="small">${isAlwaysPrepared ? "Always" : "Prepared"}</span>
        </label>
      `;
      items.appendChild(row);
    }

    if (!items.children.length){
      const empty = document.createElement("div");
      empty.className = "muted small";
      empty.textContent = "No spells match filters.";
      items.appendChild(empty);
    }

    section.appendChild(items);
    root.appendChild(section);
  }

  // Wire handlers (delegated)
  qa(".spellKnown", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const id = inp.dataset.id;
      state.spells = state.spells || { known:[], prepared:[], pendingLearn:0, notes:"" };
      state.spells.known = Array.isArray(state.spells.known) ? state.spells.known : [];
      if (inp.checked){
        if (!state.spells.known.includes(id)) state.spells.known.push(id);
      } else {
        state.spells.known = state.spells.known.filter(x => x !== id);
        // If removing from known, also remove from prepared (for wizard spellbook safety)
        state.spells.prepared = (state.spells.prepared||[]).filter(x => x !== id);
      }
      save(); rerenderSpellsOnly();
    });
  });

  qa(".spellPrep", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const id = inp.dataset.id;
      state.spells = state.spells || { known:[], prepared:[], pendingLearn:0, notes:"" };
      state.spells.prepared = Array.isArray(state.spells.prepared) ? state.spells.prepared : [];
      if (inp.checked){
        if (!state.spells.prepared.includes(id)) state.spells.prepared.push(id);
      } else {
        state.spells.prepared = state.spells.prepared.filter(x => x !== id);
      }
      save(); rerenderSpellsOnly();
    });
  });
}

function ordinal(n){
  const x = Number(n);
  if (x===1) return "1st";
  if (x===2) return "2nd";
  if (x===3) return "3rd";
  return `${x}th`;
}

function renderEquipment(){
  state.equipment = state.equipment || defaultEquipment();
  const eq = state.equipment;

  const root = $("equipmentSlots");
  root.innerHTML = "";

  const slotGroups = Object.entries(eq.slots || {});
  // Weapons last
  slotGroups.sort(([a],[b]) => (a==="weapons") - (b==="weapons"));

  for (const [groupId, arr] of slotGroups){
    if (!Array.isArray(arr)) continue;

    const title = document.createElement("h3");
    title.textContent = groupId;
    root.appendChild(title);

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead><tr>
        <th>Item</th>
        <th>AC bonus</th>
        ${groupId==="weapons" ? "<th>Hit dice</th><th>Equipped</th>" : ""}
        <th></th>
      </tr></thead>
      <tbody></tbody>
    `;
    const tb = table.querySelector("tbody");

    for (let i=0;i<arr.length;i++){
      const it = arr[i] || {};
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input data-eqgroup="${groupId}" data-eqidx="${i}" data-field="name" class="eqInput" value="${escapeAttr(it.name||"")}" /></td>
        <td><input data-eqgroup="${groupId}" data-eqidx="${i}" data-field="acBonus" class="eqInput" value="${escapeAttr(it.acBonus||"")}" /></td>
        ${groupId==="weapons" ? `
          <td><input data-eqgroup="${groupId}" data-eqidx="${i}" data-field="hitDice" class="eqInput" value="${escapeAttr(it.hitDice||"")}" placeholder="e.g. 1d8+3"/></td>
          <td><input data-eqgroup="${groupId}" data-eqidx="${i}" data-field="equipped" class="eqEquip" type="radio" name="equippedWeapon" ${it.equipped ? "checked":""} /></td>
        ` : ""}
        <td><button data-eqgroup="${groupId}" data-eqidx="${i}" class="btn small eqClear" type="button">Clear</button></td>
      `;
      tb.appendChild(tr);
    }

    root.appendChild(table);
  }

  qa(".eqInput", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const g = inp.dataset.eqgroup;
      const i = Number(inp.dataset.eqidx);
      const field = inp.dataset.field;
      if (!state.equipment?.slots?.[g]?.[i]) return;
      state.equipment.slots[g][i][field] = inp.value;
      save(); rerender();
    });
  });

  qa(".eqEquip", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const g = inp.dataset.eqgroup;
      const i = Number(inp.dataset.eqidx);
      if (g !== "weapons") return;
      setEquippedWeapon(state.equipment, i);
      // Also mirror into combat.weaponDice for convenience
      state.combat.weaponDice = getEquippedWeaponDice(state.equipment) || state.combat.weaponDice || "";
      save(); rerender();
    });
  });

  qa(".eqClear", root).forEach(btn => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.eqgroup;
      const i = Number(btn.dataset.eqidx);
      const it = state.equipment?.slots?.[g]?.[i];
      if (!it) return;
      for (const k of Object.keys(it)) it[k] = (k==="equipped") ? false : "";
      save(); rerender();
    });
  });

  // Bag
  const bag = state.equipment?.bag || { items:[] };
  bag.items = Array.isArray(bag.items) ? bag.items : [];
  state.equipment.bag = bag;

  const bagRoot = $("bagList");
  bagRoot.innerHTML = "";
  if (bag.items.length === 0){
    bagRoot.innerHTML = `<div class="muted small">No items.</div>`;
  } else {
    const ul = document.createElement("div");
    ul.className = "feature-list";
    for (let i=0;i<bag.items.length;i++){
      const it = bag.items[i];
      const box = document.createElement("div");
      box.className = "feature";
      box.innerHTML = `
        <div class="hdr">
          <div class="name">${escapeHtml(it||"")}</div>
          <button class="btn danger small" type="button">Remove</button>
        </div>
      `;
      box.querySelector("button").addEventListener("click", () => {
        bag.items.splice(i,1);
        save(); rerenderEquipmentOnly();
      });
      ul.appendChild(box);
    }
    bagRoot.appendChild(ul);
  }
}

function renderRest(){
  // hit dice pools
  state.rest = state.rest || { preparedUnlock:0, hitDice:null };
  state.rest.hitDice = state.rest.hitDice || defaultHitDicePools(state);

  const pools = state.rest.hitDice;
  const root = $("hitDicePools");
  root.innerHTML = "";

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `<thead><tr><th>Die</th><th>Remaining</th><th>Spend</th></tr></thead><tbody></tbody>`;
  const tb = table.querySelector("tbody");

  for (const [die, pool] of Object.entries(pools)){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${die}</td>
      <td>${pool.remaining}/${pool.max}</td>
      <td><input data-die="${die}" class="hdSpend" type="number" min="0" max="${pool.remaining}" value="0"></td>
    `;
    tb.appendChild(tr);
  }

  if (!Object.keys(pools).length){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">No hit dice (pick a class and level).</td>`;
    tb.appendChild(tr);
  }

  root.appendChild(table);

  // custom resources
  state.resources = state.resources || { spellSlotsUsed:{}, pactSlotsUsed:0, custom:[] };
  state.resources.custom = Array.isArray(state.resources.custom) ? state.resources.custom : [];

  const rroot = $("resourcesList");
  rroot.innerHTML = "";
  if (state.resources.custom.length === 0){
    rroot.innerHTML = `<div class="muted small">No custom resources.</div>`;
  } else {
    const tbl = document.createElement("table");
    tbl.className = "table";
    tbl.innerHTML = `<thead><tr><th>Name</th><th>Current</th><th>Max</th><th>Reset</th><th></th></tr></thead><tbody></tbody>`;
    const tb2 = tbl.querySelector("tbody");

    for (let i=0;i<state.resources.custom.length;i++){
      const r = state.resources.custom[i];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input data-ridx="${i}" data-field="name" class="resIn" value="${escapeAttr(r.name||"")}" /></td>
        <td><input data-ridx="${i}" data-field="cur" class="resIn" type="number" min="0" max="999" value="${safeNum(r.cur,0)}" /></td>
        <td><input data-ridx="${i}" data-field="max" class="resIn" type="number" min="0" max="999" value="${safeNum(r.max,0)}" /></td>
        <td>
          <select data-ridx="${i}" data-field="reset" class="resIn">
            <option value="none" ${(r.reset||"none")==="none"?"selected":""}>None</option>
            <option value="short" ${(r.reset||"none")==="short"?"selected":""}>Short</option>
            <option value="long" ${(r.reset||"none")==="long"?"selected":""}>Long</option>
          </select>
        </td>
        <td><button data-ridx="${i}" class="btn danger small resDel" type="button">Remove</button></td>
      `;
      tb2.appendChild(tr);
    }

    rroot.appendChild(tbl);

    qa(".resIn", rroot).forEach(inp => {
      inp.addEventListener("change", () => {
        const i = Number(inp.dataset.ridx);
        const field = inp.dataset.field;
        const r = state.resources.custom[i];
        if (!r) return;
        if (field === "name") r.name = inp.value;
        if (field === "cur") r.cur = clampInt(inp.value, 0, 999);
        if (field === "max") r.max = clampInt(inp.value, 0, 999);
        if (field === "reset") r.reset = inp.value;
        save(); rerenderRestOnly();
      });
    });

    qa(".resDel", rroot).forEach(btn => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.ridx);
        state.resources.custom.splice(i,1);
        save(); rerenderRestOnly();
      });
    });
  }
}

function renderPicksAndFeats(){
  // Picks
  const slots = earnedPickSlots(state);
  const picks = Array.isArray(state.picks) ? state.picks : [];
  setHtml("picksSummary", `
    <div class="kv"><div>Pick slots earned</div><div><strong>${slots}</strong></div></div>
    <div class="kv"><div>Picks filled</div><div><strong>${picks.length}</strong></div></div>
  `);

  const ed = $("picksEditor");
  ed.innerHTML = "";

  const list = document.createElement("div");
  list.className = "feature-list";

  for (let i=0;i<picks.length;i++){
    const p = picks[i];
    const name = p?.name || p?.type || "Pick";
    const txt = p?.text || "";
    const box = document.createElement("div");
    box.className = "feature";
    box.innerHTML = `
      <div class="hdr">
        <div>
          <div class="name">${escapeHtml(name)}</div>
          <div class="src">${escapeHtml(p?.type || "")}</div>
        </div>
        <button class="btn danger small" type="button">Remove</button>
      </div>
      <div class="txt">${escapeHtml(txt)}</div>
    `;
    box.querySelector("button").addEventListener("click", () => {
      // If ASI pick includes increments, undo them
      if (p?.type === "asi" && p?.delta && typeof p.delta === "object"){
        for (const [ab, amt] of Object.entries(p.delta)){
          if (ab in state.abilities) state.abilities[ab] = clampInt(Number(state.abilities[ab]||0) - Number(amt||0), 1, 30);
        }
      }
      picks.splice(i,1);
      state.picks = picks;
      save(); rerenderLevelOnly();
    });
    list.appendChild(box);
  }

  if (picks.length === 0){
    list.innerHTML = `<div class="muted small">No picks yet. Add feats or apply ASIs.</div>`;
  }

  ed.appendChild(list);

  // Feats list (from data)
  const feats = (DATA.feats?.items || []).filter(x => (x?.type || "") === "feat");
  const picked = new Set(picks.filter(p=>p?.type==="feat").map(p=>p.featId));

  const search = ($("featSearch").value || "").trim().toLowerCase();
  const filter = ($("featFilter").value || "all");

  const root = $("featsList");
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "feature-list";

  for (const f of feats){
    const name = String(f.name || "");
    if (search && !name.toLowerCase().includes(search)) continue;
    const isPicked = picked.has(f.id);

    if (filter==="picked" && !isPicked) continue;
    if (filter==="available" && isPicked) continue;

    const box = document.createElement("div");
    box.className = "feature";
    box.innerHTML = `
      <div class="hdr">
        <div>
          <div class="name">${escapeHtml(name)}</div>
          <div class="src">${escapeHtml(f.requirementsText || "")}</div>
        </div>
        <button class="btn ${isPicked ? "danger" : ""} small" type="button">${isPicked ? "Remove" : "Add"}</button>
      </div>
      <div class="txt">${escapeHtml((Array.isArray(f.effects) ? f.effects.join("\n") : String(f.effects||"")) || "")}</div>
    `;

    const btn = box.querySelector("button");
    btn.addEventListener("click", () => {
      if (isPicked){
        // remove pick
        const idx = picks.findIndex(p=>p?.type==="feat" && p?.featId===f.id);
        if (idx >= 0) picks.splice(idx,1);

        // also remove feature entry if we created one
        state.features = (state.features||[]).filter(x => x?.key !== `feat:${f.id}`);
      } else {
        // add pick if slots allow (soft limit, still lets you exceed if you want)
        picks.push({ type:"feat", featId: f.id, name: `Feat: ${f.name}`, text: Array.isArray(f.effects) ? f.effects.join("\n") : String(f.effects||"") });

        // also add to features (for the Sheet tab)
        state.features = Array.isArray(state.features) ? state.features : [];
        if (!state.features.some(x => x?.key === `feat:${f.id}`)) {
          state.features.push({ key:`feat:${f.id}`, source:"feat", name: f.name, text: Array.isArray(f.effects) ? f.effects.join("\n") : String(f.effects||"") });
        }
      }
      state.picks = picks;
      save(); rerenderLevelOnly();
    });

    wrap.appendChild(box);
  }

  if (!wrap.children.length){
    wrap.innerHTML = `<div class="muted small">No feats match your filter.</div>`;
  }
  root.appendChild(wrap);
}

function renderDataStatus(){
  const lines = [];
  lines.push(`classes.json: ${Array.isArray(DATA.classes) ? DATA.classes.length : "?"}`);
  lines.push(`backgrounds.json: ${Array.isArray(DATA.backgrounds?.backgrounds) ? DATA.backgrounds.backgrounds.length : "?"}`);
  lines.push(`races.json: ${Array.isArray(DATA.races?.races) ? DATA.races.races.length : "?"}`);
  lines.push(`spellcasting.json: classes=${Object.keys(DATA.spellcasting?.classes||{}).length}, progressions=${Object.keys(DATA.spellcasting?.progressions||{}).length}`);
  lines.push(`spells.json: ${Array.isArray(DATA.spells?.spells) ? DATA.spells.spells.length : "?"}`);
  lines.push(`traits_all_feats.json: ${Array.isArray(DATA.feats?.items) ? DATA.feats.items.length : "?"}`);
  $("dataStatus").textContent = lines.join(" | ");
}

// ---------------------------- Wiring inputs ----------------------------
function initStaticBindings(){
  // Identity
  $("name").addEventListener("change", () => { state.name = $("name").value; save(); });
  $("alignment").addEventListener("change", () => { state.alignment = $("alignment").value; save(); });

  // misc
  $("initiativeMisc").addEventListener("change", () => { state.combat.initiativeMisc = clampInt($("initiativeMisc").value, -99, 99); save(); rerender(); });
  $("perceptionMisc").addEventListener("change", () => { state.perceptionMisc = clampInt($("perceptionMisc").value, -50, 50); save(); rerender(); });
  $("inspirationPoints").addEventListener("change", () => { state.inspirationPoints = clampInt($("inspirationPoints").value, 0, 99); save(); rerender(); });

  // combat
  $("hpMax").addEventListener("change", () => { state.combat.hpMax = clampInt($("hpMax").value, 0, 9999); if (state.combat.hpNow > state.combat.hpMax) state.combat.hpNow = state.combat.hpMax; save(); rerender(); });
  $("hpNow").addEventListener("change", () => { state.combat.hpNow = clampInt($("hpNow").value, 0, state.combat.hpMax||9999); save(); rerender(); });
  $("hpTemp").addEventListener("change", () => { state.combat.hpTemp = clampInt($("hpTemp").value, 0, 9999); save(); rerender(); });
  $("acBase").addEventListener("change", () => { state.combat.acBase = clampInt($("acBase").value, 0, 99); save(); rerender(); });
  $("acExtra").addEventListener("change", () => { state.combat.acBonusExtra = clampInt($("acExtra").value, -20, 20); save(); rerender(); });
  $("speed").addEventListener("change", () => { state.combat.speed = clampInt($("speed").value, 0, 999); save(); rerender(); });
  $("weaponDice").addEventListener("change", () => { state.combat.weaponDice = $("weaponDice").value; save(); rerender(); });

  // spell ability mods
  $("primarySpellMod").addEventListener("change", () => { state.primary.spellMod = clampInt($("primarySpellMod").value, -5, 15); save(); rerender(); });
  $("secondarySpellMod").addEventListener("change", () => { state.secondary.spellMod = clampInt($("secondarySpellMod").value, -5, 15); save(); rerender(); });

  // notes
  $("notes").addEventListener("change", () => { state.notes = $("notes").value; save(); });
  $("spellNotes").addEventListener("change", () => { state.spells.notes = $("spellNotes").value; save(); });

  // Proficiency add buttons
  $("toolAddBtn").addEventListener("click", () => {
    const v = $("toolAdd").value.trim();
    if (!v) return;
    state.toolProficiencies = state.toolProficiencies || [];
    state.toolProficiencies.push({ value: v, source:"manual" });
    $("toolAdd").value = "";
    save(); rerender();
  });
  $("langAddBtn").addEventListener("click", () => {
    const v = $("langAdd").value.trim();
    if (!v) return;
    state.languageProficiencies = state.languageProficiencies || [];
    state.languageProficiencies.push({ value: v, source:"manual" });
    $("langAdd").value = "";
    save(); rerender();
  });

  // Feature add
  $("featureAddBtn").addEventListener("click", () => {
    const name = $("featureName").value.trim();
    const text = $("featureText").value;
    if (!name && !text.trim()) return;
    state.features = state.features || [];
    state.features.push({ key:`custom:${cryptoId()}`, source:"custom", name: name || "Custom Feature", text });
    $("featureName").value = "";
    $("featureText").value = "";
    save(); rerender();
  });

  // Apply class saves
  $("applyClassSaves").addEventListener("click", () => {
    applyFirstClassSavingThrows();
    save(); rerender();
  });

  // Recommended HP
  $("applyRecommendedHp").addEventListener("click", () => {
    const hp = recommendedHpMax(state);
    state.combat.hpMax = hp;
    if (state.combat.hpNow > hp) state.combat.hpNow = hp;
    save(); rerender();
  });
  $("healToFull").addEventListener("click", () => {
    state.combat.hpNow = state.combat.hpMax;
    state.combat.hpTemp = 0;
    save(); rerender();
  });

  // Spells filters
  $("spellSearch").addEventListener("input", () => rerenderSpellsOnly());
  $("spellLevelFilter").addEventListener("change", () => rerenderSpellsOnly());

  // Level-up actions
  $("levelUpBtn").addEventListener("click", () => {
    const which = $("levelUpWhich").value;
    if (which === "primary"){
      state.primary.classLevel = clampInt((state.primary.classLevel||0) + 1, 0, 20);
    } else {
      state.multiclass = true;
      state.secondary.classLevel = clampInt((state.secondary.classLevel||0) + 1, 0, 20);
    }
    // Update total level
    state.level = clampInt(Math.max(1, (state.primary.classLevel||0) + (state.multiclass ? (state.secondary.classLevel||0) : 0)), 1, 20);
    // Sync hit dice pools
    state.rest.hitDice = defaultHitDicePools(state);
    save(); rerender();
  });

  $("asiApplyBtn").addEventListener("click", () => {
    const ab = $("asiAbility").value;
    const amt = clampInt($("asiAmount").value, 1, 2);
    if (!(ab in state.abilities)) return;
    state.abilities[ab] = clampInt(Number(state.abilities[ab]||0) + amt, 1, 30);
    state.picks = Array.isArray(state.picks) ? state.picks : [];
    state.picks.push({ type:"asi", name:`ASI: ${ab} +${amt}`, text:`Increased ${ab} by ${amt}.`, delta:{ [ab]: amt } });
    save(); rerenderLevelOnly();
  });

  $("asiUndoBtn").addEventListener("click", () => {
    const picks = Array.isArray(state.picks) ? state.picks : [];
    for (let i=picks.length-1; i>=0; i--){
      const p = picks[i];
      if (p?.type === "asi" && p?.delta){
        for (const [ab, amt] of Object.entries(p.delta)){
          if (ab in state.abilities) state.abilities[ab] = clampInt(Number(state.abilities[ab]||0) - Number(amt||0), 1, 30);
        }
        picks.splice(i,1);
        state.picks = picks;
        save(); rerenderLevelOnly();
        return;
      }
    }
  });

  $("featSearch").addEventListener("input", () => rerenderLevelOnly());
  $("featFilter").addEventListener("change", () => rerenderLevelOnly());

  // Equipment bag add
  $("bagAddBtn").addEventListener("click", () => {
    const v = $("bagItemName").value.trim();
    if (!v) return;
    state.equipment = state.equipment || defaultEquipment();
    state.equipment.bag = state.equipment.bag || { items:[] };
    state.equipment.bag.items = Array.isArray(state.equipment.bag.items) ? state.equipment.bag.items : [];
    state.equipment.bag.items.push(v);
    $("bagItemName").value = "";
    save(); rerenderEquipmentOnly();
  });

  // Rest buttons
  $("shortRestBtn").addEventListener("click", () => {
    const mode = $("shortRestMode").value || "roll";
    const spend = {};
    qa(".hdSpend", $("hitDicePools")).forEach(inp => {
      const die = inp.dataset.die;
      const n = clampInt(inp.value, 0, 999);
      if (n > 0) spend[die] = n;
    });

    state = applyShortRestHitDice(state, spend, { mode });
    // Pact slots reset on short rest
    if (state.resources) state.resources.pactSlotsUsed = 0;
    save(); rerender();
  });

  $("longRestBtn").addEventListener("click", () => {
    state = applyLongRest(state);

    // Reset all slot usage
    state.resources = state.resources || { spellSlotsUsed:{}, pactSlotsUsed:0, custom:[] };
    for (const k of Object.keys(state.resources.spellSlotsUsed || {})) state.resources.spellSlotsUsed[k] = 0;
    state.resources.pactSlotsUsed = 0;

    // Reset custom resources that reset on long rest
    for (const r of (state.resources.custom||[])){
      if ((r.reset||"") === "long") r.cur = r.max;
    }

    save(); rerender();
  });

  $("resourceAddBtn").addEventListener("click", () => {
    const name = $("resourceName").value.trim();
    if (!name) return;
    state.resources = state.resources || { spellSlotsUsed:{}, pactSlotsUsed:0, custom:[] };
    state.resources.custom = Array.isArray(state.resources.custom) ? state.resources.custom : [];
    state.resources.custom.push({ name, cur: 0, max: 0, reset: "none" });
    $("resourceName").value = "";
    save(); rerenderRestOnly();
  });

  // Export / import
  $("exportBtn").addEventListener("click", () => {
    $("exportBox").value = JSON.stringify(state, null, 2);
  });
  $("importBtn").addEventListener("click", () => {
    const raw = $("importBox").value;
    try{
      const obj = JSON.parse(raw);
      state = saveCharacterState(obj);
      // ensure equipment exists
      state.equipment = state.equipment || defaultEquipment();
      $("importStatus").textContent = "Imported successfully.";
      $("importStatus").className = "small mt";
      save(); rerender();
    } catch (e){
      $("importStatus").textContent = `Import failed: ${e?.message || e}`;
      $("importStatus").className = "small mt";
    }
  });
  $("resetBtn").addEventListener("click", () => {
    state = defaultCharacterState();
    state.equipment = defaultEquipment();
    save(); rerender();
  });

  // Cloud
  $("cloudSaveBtn").addEventListener("click", async () => {
    const out = await cloudSave();
    $("cloudStatus").textContent = out.message || String(out.ok);
  });
  $("cloudLoadBtn").addEventListener("click", async () => {
    const out = await cloudLoad();
    $("cloudStatus").textContent = out.message || String(out.ok);
    state = loadCharacterState();
    state.equipment = state.equipment || defaultEquipment();
    rerender();
  });

  // Settings
  $("recomputeAllBtn").addEventListener("click", () => {
    // This just forces a rerender and re-save (derive/clamp)
    save(); rerender();
  });
}

function initSelectOptions(){
  // Classes dropdowns
  const classList = Array.isArray(DATA.classes) ? DATA.classes.map(x=>x.name) : [];
  fillSelect($("primaryClass"), ["", ...classList]);
  fillSelect($("secondaryClass"), ["", ...classList]);

  // Backgrounds
  const bgs = Array.isArray(DATA.backgrounds?.backgrounds) ? DATA.backgrounds.backgrounds : [];
  fillSelect($("backgroundSelect"), ["", ...bgs.map(b=>b.id)], (id) => {
    const b = bgs.find(x=>x.id===id);
    return b ? `${b.name}` : id;
  });

  // Races
  const races = Array.isArray(DATA.races?.races) ? DATA.races.races : [];
  fillSelect($("raceSelect"), ["", ...races.map(r=>r.id)], (id) => {
    const r = races.find(x=>x.id===id);
    return r ? r.name : id;
  });

  // Subclasses are per class, filled in render
}

function fillSelect(sel, values, labelFn=(x)=>x){
  sel.innerHTML = "";
  for (const v of values){
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v ? labelFn(v) : "—";
    sel.appendChild(opt);
  }
}

function renderSelectValues(){
  $("name").value = state.name || "";
  $("alignment").value = state.alignment || "";

  $("initiativeMisc").value = String(state.combat.initiativeMisc || 0);
  $("perceptionMisc").value = String(state.perceptionMisc || 0);
  $("inspirationPoints").value = String(state.inspirationPoints || 0);

  $("hpMax").value = String(state.combat.hpMax || 0);
  $("hpNow").value = String(state.combat.hpNow || 0);
  $("hpTemp").value = String(state.combat.hpTemp || 0);
  $("acBase").value = String(state.combat.acBase || 10);
  $("acExtra").value = String(state.combat.acBonusExtra || 0);
  $("speed").value = String(state.combat.speed || 0);
  $("weaponDice").value = String(state.combat.weaponDice || "");

  $("primarySpellMod").value = String(state.primary?.spellMod || 0);
  $("secondarySpellMod").value = String(state.secondary?.spellMod || 0);

  $("notes").value = state.notes || "";
  $("spellNotes").value = state.spells?.notes || "";

  $("multiclass").checked = !!state.multiclass;

  $("primaryClass").value = (state.primary?.className || "").trim();
  $("primaryLevel").value = String(state.primary?.classLevel ?? 0);

  $("secondaryClass").value = (state.secondary?.className || "").trim();
  $("secondaryLevel").value = String(state.secondary?.classLevel ?? 0);

  $("backgroundSelect").value = state.backgroundId || "";
  $("raceSelect").value = state.raceId || "";

  // Subclasses: populate options based on current classes
  renderSubclassSelects();
}

function renderSubclassSelects(){
  const subData = DATA.subclasses;
  const fillSubclass = (sel, className, current) => {
    const c = (subData?.classes || []).find(x => x.class === className);
    const subs = c ? (c.subclasses || []).map(s => s.name) : [];
    fillSelect(sel, ["", ...subs]);
    sel.value = current || "";
  };

  fillSubclass($("primarySubclass"), (state.primary?.className||"").trim(), (state.primary?.subclass||"").trim());
  fillSubclass($("secondarySubclass"), (state.secondary?.className||"").trim(), (state.secondary?.subclass||"").trim());
}

// ---------------------------- Apply background / race ----------------------------
function applyBackgroundFromSelect(){
  const id = $("backgroundSelect").value;
  const bg = (DATA.backgrounds?.backgrounds||[]).find(b=>b.id===id) || null;

  // Remove previous background-sourced features/profs when switching backgrounds.
  state = stripSourceContributions(state, "background");

  state = applyBackgroundToState(state, bg);
}

function applyRaceFromSelect(){
  const id = $("raceSelect").value;
  const race = (DATA.races?.races||[]).find(r=>r.id===id) || null;
  state = applyRaceToState(state, race);
}

// ---------------------------- Source stripping helpers ----------------------------
function stripSourceContributions(st, source){
  const next = structuredClone(st);

  // Features
  if (Array.isArray(next.features)) next.features = next.features.filter(f => (f?.source||"") !== source);

  // Tools/languages (stored as {value, source})
  if (Array.isArray(next.toolProficiencies)) next.toolProficiencies = next.toolProficiencies.filter(x => (x?.source||"") !== source);
  if (Array.isArray(next.languageProficiencies)) next.languageProficiencies = next.languageProficiencies.filter(x => (x?.source||"") !== source);

  // profSources maps
  if (next.profSources?.skills){
    for (const [k,v] of Object.entries(next.profSources.skills)){
      if (v === source){
        delete next.profSources.skills[k];
        // If the proficiency level was only 1, remove it as well.
        if (next.skills && Number(next.skills[k]||0) === 1) next.skills[k] = 0;
      }
    }
  }
  if (next.profSources?.tools){
    for (const [k,v] of Object.entries(next.profSources.tools)){
      if (v === source) delete next.profSources.tools[k];
    }
  }
  if (next.profSources?.languages){
    for (const [k,v] of Object.entries(next.profSources.languages)){
      if (v === source) delete next.profSources.languages[k];
    }
  }
  return next;
}

const SPELL_ABILITY_BY_CLASS = {
  Bard: "CHA",
  Cleric: "WIS",
  Druid: "WIS",
  Paladin: "CHA",
  Ranger: "WIS",
  Sorcerer: "CHA",
  Warlock: "CHA",
  Wizard: "INT",
  Artificer: "INT",
};

function computeSpellModForBlock(block){
  const cn = (block?.className||"").trim();
  const sn = (block?.subclass||"").trim();

  // Default by class
  let ab = SPELL_ABILITY_BY_CLASS[cn] || null;

  // Third-caster subclasses use INT (wizard list)
  if (cn==="Fighter" && sn==="Eldritch Knight") ab = "INT";
  if (cn==="Rogue" && sn==="Arcane Trickster") ab = "INT";

  if (!ab) return 0;
  return abilityMod(state.abilities?.[ab] ?? 10);
}

// ---------------------------- Class save prof helper ----------------------------
const CLASS_SAVES = {
  Barbarian: ["STR","CON"],
  Bard: ["DEX","CHA"],
  Cleric: ["WIS","CHA"],
  Druid: ["INT","WIS"],
  Fighter: ["STR","CON"],
  Monk: ["STR","DEX"],
  Paladin: ["WIS","CHA"],
  Ranger: ["STR","DEX"],
  Rogue: ["DEX","INT"],
  Sorcerer: ["CON","CHA"],
  Warlock: ["WIS","CHA"],
  Wizard: ["INT","WIS"],
  Artificer: ["CON","INT"],
};

function applyFirstClassSavingThrows(){
  const cn = (state.primary?.className || "").trim();
  const arr = CLASS_SAVES[cn] || [];
  // Clear and set only if user hasn't manually set anything yet, OR they want overwrite.
  // Here, we overwrite. It's a button.
  for (const ab of abilityList) state.saves[ab] = false;
  for (const ab of arr) state.saves[ab] = true;
}

// ---------------------------- Main rerender ----------------------------
function rerender(){
  renderSelectValues();
  renderCore();
  renderAbilities();
  renderSaves();
  renderSkills();
  renderProficiencies();
  renderFeatures();

  renderSlotsAndLimits();
  renderSpells();

  renderEquipment();
  renderRest();
  renderPicksAndFeats();

  // Cloud buttons
  const cloudOn = isCloudConfigured();
  $("cloudSaveBtn").disabled = !cloudOn;
  $("cloudLoadBtn").disabled = !cloudOn;
}

function rerenderSlotsOnly(){
  renderSlotsAndLimits();
}

function rerenderSpellsOnly(){
  renderSlotsAndLimits();
  renderSpells();
}

function rerenderEquipmentOnly(){
  renderEquipment();
  renderCore();
}

function rerenderRestOnly(){
  renderRest();
  renderCore();
}

function rerenderLevelOnly(){
  renderPicksAndFeats();
  renderCore();
}

function save(){
  state = saveCharacterState(state);
}

// ---------------------------- Utilities ----------------------------
function escapeHtml(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}
function escapeAttr(s){
  return escapeHtml(s).replaceAll('"',"&quot;");
}
function cryptoId(){
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(x=>x.toString(16).padStart(2,"0")).join("");
}

// ---------------------------- Boot ----------------------------
async function boot(){
  initTabs();
  await loadAllData();
  renderDataStatus();
  initSelectOptions();

  state = loadCharacterState();
  state.equipment = state.equipment || defaultEquipment();

  // Default hit dice pools, if missing
  state.rest = state.rest || { preparedUnlock:0, hitDice:null };
  state.rest.hitDice = state.rest.hitDice || defaultHitDicePools(state);

  // Wire select changes AFTER state exists
  $("backgroundSelect").addEventListener("change", () => {
    applyBackgroundFromSelect();
    save(); rerender();
  });
  $("raceSelect").addEventListener("change", () => {
    applyRaceFromSelect();
    save(); rerender();
  });

  $("primaryClass").addEventListener("change", () => {
    state.primary.className = $("primaryClass").value;
    // If no subclass applies, clear
    state.primary.subclass = "";
    // Auto-set spell ability mod for this block (if applicable)
    state.primary.spellMod = computeSpellModForBlock(state.primary);
    save(); rerender();
  });
  $("primaryLevel").addEventListener("change", () => {
    state.primary.classLevel = clampInt($("primaryLevel").value, 0, 20);
    save(); rerender();
  });
  $("primarySubclass").addEventListener("change", () => {
    state.primary.subclass = $("primarySubclass").value;
    state.primary.spellMod = computeSpellModForBlock(state.primary);
    save(); rerender();
  });

  $("multiclass").addEventListener("change", () => {
    state.multiclass = !!$("multiclass").checked;
    save(); rerender();
  });

  $("secondaryClass").addEventListener("change", () => {
    state.secondary.className = $("secondaryClass").value;
    state.secondary.subclass = "";
    state.secondary.spellMod = computeSpellModForBlock(state.secondary);
    save(); rerender();
  });
  $("secondaryLevel").addEventListener("change", () => {
    state.secondary.classLevel = clampInt($("secondaryLevel").value, 0, 20);
    save(); rerender();
  });
  $("secondarySubclass").addEventListener("change", () => {
    state.secondary.subclass = $("secondarySubclass").value;
    state.secondary.spellMod = computeSpellModForBlock(state.secondary);
    save(); rerender();
  });

  initStaticBindings();
  rerender();
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="white-space:pre-wrap;color:#fff;padding:16px;">Boot error: ${String(err?.stack || err)}</pre>`;
});
