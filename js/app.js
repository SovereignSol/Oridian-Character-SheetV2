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
import { earnedPickSlots, hasAsiAtLevel } from "./engine/progression.js";
import { hitDieForClass, defaultHitDicePools, applyShortRestHitDice, applyLongRest } from "./engine/rest.js";
import { recommendedHpMax, spellSlotsForState, spellLimitsForState, spellsKnownLimit, cantripsKnownLimit } from "./engine/rules_5e2014.js";
import { allowedSpellIds, spellsByLevel, isPreparedCaster, isKnownCaster, alwaysPreparedIds } from "./engine/spells_engine.js";
import { syncClassFeatures, listClassChoicesForState, setClassChoice } from "./engine/class_features.js";

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
  classFeatures: null,
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
    classFeatures,
  ] = await Promise.all([
    loadJson("data/classes.json"),
    loadJson("data/backgrounds.json"),
    loadJson("data/races.json"),
    loadJson("data/spellcasting.json"),
    loadJson("data/spells.json"),
    loadJson("data/subclasses.json"),
    loadJson("data/traits_all_feats.json"),
    loadJson("data/class_features.json"),
  ]);

  DATA.classes = classes;
  DATA.backgrounds = backgrounds;
  DATA.races = races;
  DATA.spellcasting = spellcasting;
  DATA.spells = spells;
  DATA.subclasses = subclasses;
  DATA.feats = feats;
  DATA.classFeatures = classFeatures;
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
      // Roving tabindex for keyboard-friendly tab navigation
      t.tabIndex = on ? 0 : -1;
    }
    for (const p of panels){
      const on = p.dataset.tab === name;
      p.classList.toggle("hidden", !on);
    }
  };

  tabs.forEach((t, idx)=>{
    t.addEventListener("click", () => show(t.dataset.tab));

    // Keyboard navigation (WAI-ARIA Tabs pattern)
    t.addEventListener("keydown", (ev)=>{
      const k = ev.key;
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(k)) return;
      ev.preventDefault();
      let ni = idx;
      if (k === "ArrowRight") ni = (idx + 1) % tabs.length;
      else if (k === "ArrowLeft") ni = (idx - 1 + tabs.length) % tabs.length;
      else if (k === "Home") ni = 0;
      else if (k === "End") ni = tabs.length - 1;
      show(tabs[ni].dataset.tab);
      tabs[ni].focus();
    });
  });

  // Ensure initial ARIA state matches the visible panel.
  const initial = tabs.find(t => t.getAttribute("aria-selected") === "true")?.dataset.tab || "sheet";
  show(initial);
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
          <input data-ability="${ab}" class="abilityScore" type="number" min="1" max="30" value="${score}" ${state.build?.locked ? "disabled" : ""}>
        </label>
      </div>
    `;
    root.appendChild(wrap);
  }

  qa(".abilityScore", root).forEach(inp => {
    inp.addEventListener("change", () => {
      if (state.build?.locked){
        const ab = inp.dataset.ability;
        inp.value = String(state.abilities[ab] ?? 10);
        return;
      }
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

  state.spells = state.spells || { known:[], knownByBlock:{primary:[],secondary:[]}, prepared:[], pendingLearn:0, notes:"" };

  // Spell list view selector (multiclass-friendly)
  const hasSecondary = !!(state.multiclass && (state.secondary?.className||"").trim());
  const row = document.getElementById("spellClassRow");
  const sel = document.getElementById("spellClassSelect");
  if (row) row.style.display = hasSecondary ? "grid" : "none";

  let viewWhich = state.spells.viewWhich;
  if (!hasSecondary) viewWhich = "primary";
  if (!hasSecondary && sel) viewWhich = "primary";
  if (hasSecondary && !["all","primary","secondary"].includes(viewWhich)) viewWhich = "all";
  if (!viewWhich) viewWhich = hasSecondary ? "all" : "primary";
  state.spells.viewWhich = viewWhich;

  if (sel){
    const opts = hasSecondary
      ? [
          { v:"all", label:"All spell lists" },
          { v:"primary", label:`Primary: ${(state.primary?.className||"").trim() || "(none)"}` },
          { v:"secondary", label:`Secondary: ${(state.secondary?.className||"").trim() || "(none)"}` },
        ]
      : [
          { v:"primary", label:`Class: ${(state.primary?.className||"").trim() || "(none)"}` },
        ];
    sel.innerHTML = opts.map(o => `<option value="${escapeAttr(o.v)}">${escapeHtml(o.label)}</option>`).join("");
    sel.value = viewWhich;
  }

  const viewIsAll = viewWhich === "all";
  const viewBlock = (viewWhich === "secondary") ? (state.secondary||{}) : (state.primary||{});
  const cn = (viewBlock.className||"").trim();
  const sn = (viewBlock.subclass||"").trim();

  const prepared = viewIsAll ? false : isPreparedCaster(cn);
  const known = viewIsAll ? false : isKnownCaster(cn, sn);

  if (!cn){
    hint.textContent = "Pick a class to view spells.";
  } else if (viewIsAll){
    hint.textContent = "Viewing all spell lists. Switch to a specific class to add/remove Known spells or manage Prepared spells.";
  } else if (prepared && cn==="Wizard"){
    hint.textContent = "Wizard mode (5e 2014): add spells to your Spellbook (Known), then prepare from the Spellbook. Always-prepared spells appear automatically.";
  } else if (prepared){
    hint.textContent = "Prepared caster mode: prepare spells from your class list. Always-prepared spells appear automatically.";
  } else if (known){
    hint.textContent = "Known caster mode: learn spells (Known). You do not normally prepare spells.";
  } else {
    hint.textContent = "This class does not use spellcasting lists.";
  }

  // Allowed spell ids for the selected view
  let allowedIds = [];
  if (viewWhich === "primary" || viewWhich === "secondary"){
    const lvl = clampInt(viewBlock.classLevel || 0, 0, 20);
    const viewState = { multiclass:false, primary:{ className:cn, classLevel:lvl, subclass:sn, spellMod:0 }, secondary:{ className:"", classLevel:0, subclass:"", spellMod:0 } };
    allowedIds = allowedSpellIds(viewState, DATA.spellcasting, DATA.subclasses);
  } else {
    allowedIds = allowedSpellIds(state, DATA.spellcasting, DATA.subclasses);
  }

  const apIds = new Set(alwaysPreparedIds(state, DATA.classFeatures));
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
          <input class="spellKnown" data-id="${sp.id}" type="checkbox" ${isKnown ? "checked":""} ${known || cn==="Wizard" ? "" : "disabled"} ${(state.build?.locked) ? "disabled" : ""} ${(state.spells?.viewWhich==="all") ? "disabled" : ""}>
          <span class="small">Known</span>
        </label>
        <label class="field" style="flex-direction:row; align-items:center; gap:8px; margin:0;">
          <input class="spellPrep" data-id="${sp.id}" type="checkbox" ${isAlwaysPrepared || isPrepared ? "checked":""} ${prepared ? "" : "disabled"} ${(cn==="Wizard" && !isAlwaysPrepared && !isKnown) ? "disabled" : ""} ${isAlwaysPrepared ? "disabled" : ""} ${(state.spells?.viewWhich==="all") ? "disabled" : ""}>
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
      if (!id) return;
      if (state.build?.locked || state.spells?.viewWhich === "all"){
        inp.checked = Array.isArray(state.spells?.known) ? state.spells.known.includes(id) : false;
        return;
      }

      state.spells = state.spells || { known:[], knownByBlock:{primary:[],secondary:[]}, prepared:[], pendingLearn:0, notes:"" };
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
      if (!id) return;
      if (state.spells?.viewWhich === "all"){
        inp.checked = Array.isArray(state.spells?.prepared) ? state.spells.prepared.includes(id) : false;
        return;
      }

      state.spells = state.spells || { known:[], knownByBlock:{primary:[],secondary:[]}, prepared:[], pendingLearn:0, notes:"" };
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
    const rmBtn = box.querySelector("button");
    const locked = !!state.build?.locked;
    if (locked){
      rmBtn.disabled = true;
      rmBtn.title = "Build is locked. Use 'Undo last level up' to remove permanent choices.";
    }
    rmBtn.addEventListener("click", () => {
      if (state.build?.locked) return;
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
    list.innerHTML = `<div class="muted small">No picks yet. Earn ASIs and feats through the Level Up wizard.</div>`;
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
    if (state.build?.locked){
      btn.disabled = true;
      btn.title = "Build is locked. Feats are granted through the Level Up wizard.";
    }
    btn.addEventListener("click", () => {
      if (state.build?.locked) return;
      if (isPicked){
        // remove pick
        const idx = picks.findIndex(p=>p?.type==="feat" && p?.featId===f.id);
        if (idx >= 0) picks.splice(idx,1);

        // also remove feature entry if we created one
        state.features = (state.features||[]).filter(x => !String(x?.key||"").startsWith(`feat:${f.id}`));
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

function renderBuildLogPanel(){
  ensureBuildState();
  const lockSel = document.getElementById("buildLockSelect");
  if (lockSel) lockSel.value = state.build.locked ? "locked" : "unlocked";

  const undoBtn = document.getElementById("undoLevelUpBtn");
  if (undoBtn) undoBtn.disabled = !(state.build.log && state.build.log.length);

  const logBox = document.getElementById("buildLog");
  if (!logBox) return;
  const log = Array.isArray(state.build.log) ? state.build.log.slice().reverse() : [];
  if (!log.length){
    logBox.innerHTML = `<div class="small muted">No level ups recorded yet.</div>`;
    return;
  }

  const spellName = (id) => {
    const s = (DATA.spells?.spells||[]).find(x=>x.id===id);
    return s?.name || id;
  };
  const featName = (id) => {
    const f = (DATA.feats?.items||[]).find(x=>x.id===id);
    return f?.name || id;
  };

  logBox.innerHTML = log.map(ev => {
    const when = ev.at ? new Date(ev.at).toLocaleString() : "";
    const hp = ev.hp?.gain ? `HP +${ev.hp.gain}` : "";
    const asi = (ev.asiFeat?.type === "asi") ? (Object.entries(ev.asiFeat.delta||{}).map(([a,v])=>`${a} +${v}`).join(", ")) : "";
    const feat = (ev.asiFeat?.type === "feat") ? featName(ev.asiFeat.featId) : "";
    const learned = (ev.spells?.learnSpellIds||[]).map(spellName);
    const learnedCan = (ev.spells?.learnCantripIds||[]).map(spellName);
    const autoCan = (ev.spells?.autoCantripIds||[]).map(spellName);
    const rep = ev.spells?.replaced ? `${spellName(ev.spells.replaced.from)} → ${spellName(ev.spells.replaced.to)}` : "";
    const parts = [hp, asi ? `ASI: ${asi}` : "", feat ? `Feat: ${feat}` : "", (autoCan.length||learnedCan.length||learned.length) ? `Learned: ${[...autoCan,...learnedCan,...learned].join(", ")}` : "", rep ? `Replaced: ${rep}` : ""].filter(Boolean);

    return `
      <div class="card" style="padding:10px;">
        <div class="small muted">${escapeHtml(when)}</div>
        <div><strong>${escapeHtml(ev.className||"")}</strong> ${ev.fromLevel} → ${ev.toLevel}</div>
        ${parts.length ? `<div class="small muted mt">${escapeHtml(parts.join(" | "))}</div>` : ""}
      </div>
    `;
  }).join("\n");
}


function renderClassChoices(){
  const root = $("classChoicesPanel");
  if (!root) return;

  const choices = listClassChoicesForState(state, DATA.classFeatures);
  root.innerHTML = "";

  if (!choices.length){
    root.innerHTML = `<div class="muted small">No pending class choices. (Or class_features.json has no choices for your current classes.)</div>`;
    return;
  }

  for (const c of choices){
    const box = document.createElement("div");
    box.className = "feature";
    const selCount = (c.selected||[]).length;

    const hdr = document.createElement("div");
    hdr.className = "hdr";
    hdr.innerHTML = `
      <div>
        <div class="name">${escapeHtml(c.name)} <span class="meta">(${escapeHtml(c.className)} ${c.which}, level ${c.level})</span></div>
        <div class="src">${escapeHtml(c.prompt || "")} ${c.choose ? `<span class="muted small">Choose ${c.choose}</span>` : ""}</div>
      </div>
    `;
    box.appendChild(hdr);

    const body = document.createElement("div");
    body.className = "txt";
    const fulfilled = !!c.fulfilled;

    if (fulfilled){
      const pickedNames = (c.options||[])
        .filter(o => (c.selected||[]).includes(String(o?.id)))
        .map(o => String(o?.name || o?.id))
        .join(", ") || "(unknown)";
      body.innerHTML = `<div class="muted small">Selected: <strong>${escapeHtml(pickedNames)}</strong></div>`;
    } else {
      const optWrap = document.createElement("div");
      optWrap.className = "grid two";

      const options = Array.isArray(c.options) ? c.options : [];
      for (const o of options){
        const oid = String(o?.id || "");
        if (!oid) continue;
        const lbl = String(o?.name || oid);
        const checked = (c.selected||[]).includes(oid);

        const lab = document.createElement("label");
        lab.className = "field";
        lab.style.flexDirection = "row";
        lab.style.alignItems = "center";
        lab.style.gap = "8px";
        lab.style.margin = "0";

        lab.innerHTML = `
          <input type="checkbox" class="classChoiceOpt" data-choicekey="${escapeAttr(c.choiceKey)}" data-opt="${escapeAttr(oid)}" ${checked ? "checked" : ""}>
          <span>${escapeHtml(lbl)}</span>
        `;
        optWrap.appendChild(lab);
      }

      const actions = document.createElement("div");
      actions.className = "grid two mt";
      actions.innerHTML = `
        <div class="muted small">Selected: <strong><span data-count="${escapeAttr(c.choiceKey)}">${selCount}</span></strong> / ${c.choose}</div>
        <button class="btn small classChoiceApply" type="button" data-choicekey="${escapeAttr(c.choiceKey)}">Apply choice</button>
      `;

      body.appendChild(optWrap);
      body.appendChild(actions);
    }

    box.appendChild(body);
    root.appendChild(box);
  }

  // Wire handlers (delegated-ish)
  qa(".classChoiceOpt", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const ckey = String(inp.dataset.choicekey || "");
      const all = qa(`.classChoiceOpt[data-choicekey="${cssEscape(ckey)}"]`, root);
      const checked = all.filter(x => x.checked);

      // enforce max
      const choice = choices.find(x => x.choiceKey === ckey);
      const max = choice ? Number(choice.choose||1) : 1;
      if (checked.length > max){
        inp.checked = false;
        return;
      }

      const counter = q(`span[data-count="${cssEscape(ckey)}"]`, root);
      if (counter) counter.textContent = String(all.filter(x => x.checked).length);
    });
  });

  qa(".classChoiceApply", root).forEach(btn => {
    btn.addEventListener("click", () => {
      const ckey = String(btn.dataset.choicekey || "");
      const choice = choices.find(x => x.choiceKey === ckey);
      if (!choice) return;

      const all = qa(`.classChoiceOpt[data-choicekey="${cssEscape(ckey)}"]`, root);
      const picked = all.filter(x => x.checked).map(x => String(x.dataset.opt||"")).filter(Boolean);

      if (picked.length !== Number(choice.choose||1)){
        alert(`Please choose exactly ${choice.choose} option(s).`);
        return;
      }

      state = setClassChoice(state, ckey, picked);
      save(); rerender();
    });
  });
}

function cssEscape(s){
  // minimal CSS.escape polyfill for attribute selectors
  return String(s||"").replace(/["\\]/g, "\\$&");
}


function renderDataStatus(){
  const lines = [];
  lines.push(`classes.json: ${Array.isArray(DATA.classes) ? DATA.classes.length : "?"}`);
  lines.push(`backgrounds.json: ${Array.isArray(DATA.backgrounds?.backgrounds) ? DATA.backgrounds.backgrounds.length : "?"}`);
  lines.push(`races.json: ${Array.isArray(DATA.races?.races) ? DATA.races.races.length : "?"}`);
  lines.push(`spellcasting.json: classes=${Object.keys(DATA.spellcasting?.classes||{}).length}, progressions=${Object.keys(DATA.spellcasting?.progressions||{}).length}`);
  lines.push(`spells.json: ${Array.isArray(DATA.spells?.spells) ? DATA.spells.spells.length : "?"}`);
  lines.push(`traits_all_feats.json: ${Array.isArray(DATA.feats?.items) ? DATA.feats.items.length : "?"}`);
  lines.push(`class_features.json: ${Object.keys(DATA.classFeatures?.classes||{}).length}`);
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
  $("hpMax").addEventListener("change", () => {
    if (state.build?.locked){
      $("hpMax").value = String(state.combat.hpMax || 0);
      return;
    }
    state.combat.hpMax = clampInt($("hpMax").value, 0, 9999);
    if (state.combat.hpNow > state.combat.hpMax) state.combat.hpNow = state.combat.hpMax;
    save(); rerender();
  });
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
  const spellClassSelect = $("spellClassSelect");
  if (spellClassSelect){
    spellClassSelect.addEventListener("change", () => {
      state.spells = state.spells || { known:[], knownByBlock:{primary:[],secondary:[]}, prepared:[], pendingLearn:0, notes:"" };
      state.spells.viewWhich = spellClassSelect.value;
      save();
      rerenderSpellsOnly();
    });
  }

  // Build lock + level-up wizard
  const buildLockSelect = $("buildLockSelect");
  if (buildLockSelect){
    buildLockSelect.addEventListener("change", () => {
      const v = buildLockSelect.value;
      if (v === "unlocked"){
        const ok = confirm("Unlock build mode? This enables manual edits for levels, feats, ASIs, and known spells.");
        if (!ok){ buildLockSelect.value = "locked"; return; }
        state.build = state.build || { locked:true, log:[], redo:[] };
        state.build.locked = false;
      } else {
        state.build = state.build || { locked:true, log:[], redo:[] };
        state.build.locked = true;
      }
      save(); rerender();
    });
  }

  const openWiz = $("openLevelUpWizardBtn");
  if (openWiz) openWiz.addEventListener("click", () => openLevelUpWizard());

  const undoBtn = $("undoLevelUpBtn");
  if (undoBtn) undoBtn.addEventListener("click", () => undoLastLevelUp());

  $("featSearch").addEventListener("input", () => rerenderLevelOnly());
  $("featFilter").addEventListener("change", () => rerenderLevelOnly());

  // Level Up modal controls
  const dlg = document.getElementById("levelUpDialog");
  if (dlg){
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeLevelUpWizard();
    });
  }
  const closeBtn = document.getElementById("levelUpCloseBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => closeLevelUpWizard());
  const backBtn = document.getElementById("levelUpBackBtn");
  if (backBtn) backBtn.addEventListener("click", () => wizardValidateAndAdvance(-1));
  const nextBtn = document.getElementById("levelUpNextBtn");
  if (nextBtn) nextBtn.addEventListener("click", () => wizardValidateAndAdvance(1));
  const confirmBtn = document.getElementById("levelUpConfirmBtn");
  if (confirmBtn) confirmBtn.addEventListener("click", () => commitLevelUpWizard());

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
    const out = (typeof structuredClone === "function") ? structuredClone(state) : JSON.parse(JSON.stringify(state));
    $("exportBox").value = JSON.stringify(out, null, 2);
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
    save();
    rerender();
    notifyBattleFrame();
  });

  // Cloud
  $("cloudSaveBtn").addEventListener("click", async () => {
    const out = await cloudSave();
    $("cloudStatus").textContent = out.message || String(out.ok);
  });
  $("cloudLoadBtn").addEventListener("click", async () => {
    const ok = confirm("Load from cloud? This will overwrite your local copy.");
    if (!ok) return;
    const out = await cloudLoad();
    $("cloudStatus").textContent = out.message || String(out.ok);
    if (out?.ok){
      state = loadCharacterState();
      state.equipment = state.equipment || defaultEquipment();
      save();
      rerender();
    } else {
      alert(out?.message || "Cloud load failed.");
    }
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
  $("hpMax").disabled = !!state.build?.locked;
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
  $("primaryLevel").disabled = !!state.build?.locked;

  $("secondaryClass").value = (state.secondary?.className || "").trim();
  $("secondaryLevel").value = String(state.secondary?.classLevel ?? 0);
  $("secondaryLevel").disabled = !!state.build?.locked;

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

  // Custom resources (stored as {name,cur,max,reset,source?})
  if (next.resources?.custom && Array.isArray(next.resources.custom)){
    next.resources.custom = next.resources.custom.filter(r => (r?.source||"") !== source);
  }

  // profSources maps
  if (next.profSources?.skills){
    for (const [k,v] of Object.entries(next.profSources.skills)){
      if (v === source){
        delete next.profSources.skills[k];
        // If the proficiency came from this source, roll it back.
        if (next.skills){
          const cur = Number(next.skills[k]||0);
          if (cur === 1) next.skills[k] = 0;
          else if (cur === 2) next.skills[k] = 1;
        }
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

// ---------------------------- Level Up Wizard (strict 5e 2014) ----------------------------

let LEVELUP_WIZ = null;

function totalLevelOf(st){
  const p = clampInt(st?.primary?.classLevel ?? 0, 0, 20);
  const s = st?.multiclass ? clampInt(st?.secondary?.classLevel ?? 0, 0, 20) : 0;
  return clampInt(Math.max(1, p + s), 1, 20);
}

function ensureBuildState(){
  state.build = state.build || { locked:true, log:[], redo:[] };
  if (typeof state.build.locked !== "boolean") state.build.locked = true;
  if (!Array.isArray(state.build.log)) state.build.log = [];
  if (!Array.isArray(state.build.redo)) state.build.redo = [];
}

function addHitDieForClassLevelChange(st, className, delta){
  const next = st;
  next.rest = next.rest || { preparedUnlock:0, hitDice:null };
  next.rest.hitDice = next.rest.hitDice || {};
  const die = hitDieForClass(className);
  if (!die) return;
  const pool = next.rest.hitDice[die] || { max:0, remaining:0 };
  pool.max = clampInt(Number(pool.max||0) + delta, 0, 20);
  pool.remaining = clampInt(Number(pool.remaining||0), 0, pool.max);
  // If you gain or lose a level, adjust remaining hit dice in the same direction (strict revert behavior).
  if (delta !== 0) pool.remaining = clampInt(pool.remaining + delta, 0, pool.max);
  if (pool.max <= 0) delete next.rest.hitDice[die];
  else next.rest.hitDice[die] = pool;
}

function buildSpellLearnPlan({ className, subclassName, fromLevel, toLevel }){
  const cn = (className||"").trim();
  const sn = (subclassName||"").trim();
  const from = clampInt(fromLevel, 0, 20);
  const to = clampInt(toLevel, 0, 20);

  const plan = {
    cantripsToChoose: 0,
    spellsToChoose: 0,
    autoCantripIds: [],
    canReplaceSpell: false,
    spellListLabel: (cn === "Wizard") ? "Spellbook" : "Known",
  };

  // Wizard: spellbook grows by 2 spells per wizard level gained (PHB 2014). Cantrips follow the wizard table.
  if (cn === "Wizard"){
    plan.spellsToChoose = (to > from) ? 2 : 0;
    const cFrom = cantripsKnownLimit("Wizard", from, sn) || 0;
    const cTo = cantripsKnownLimit("Wizard", to, sn) || 0;
    plan.cantripsToChoose = Math.max(0, cTo - cFrom);
    plan.canReplaceSpell = false;
    return plan;
  }

  // Known casters (incl. EK/AT which are subclass-dependent).
  const kFrom = spellsKnownLimit(cn, from, sn);
  const kTo = spellsKnownLimit(cn, to, sn);
  const cFrom = cantripsKnownLimit(cn, from, sn);
  const cTo = cantripsKnownLimit(cn, to, sn);

  if (kTo !== null){
    plan.spellsToChoose = Math.max(0, Number(kTo||0) - Number(kFrom||0));
    plan.canReplaceSpell = true;
  }
  if (cTo !== null){
    const deltaC = Math.max(0, Number(cTo||0) - Number(cFrom||0));
    plan.cantripsToChoose = deltaC;
  }

  // Prepared casters still learn cantrips.
  if (kTo === null && cTo !== null){
    plan.canReplaceSpell = false;
  }

  // Arcane Trickster: always has Mage Hand. At level 3 when spellcasting begins, auto-grant Mage Hand.
  if (cn === "Rogue" && sn === "Arcane Trickster" && from < 3 && to >= 3){
    plan.autoCantripIds = ["mage_hand"];
    plan.cantripsToChoose = Math.max(0, plan.cantripsToChoose - 1);
  }

  return plan;
}

function openLevelUpWizard(){
  ensureBuildState();
  const dlg = $("levelUpDialog");
  if (!dlg) return;

  LEVELUP_WIZ = {
    step: 0,
    steps: ["choose"],
    which: "primary",
    className: "",
    subclassName: "",
    fromLevel: 0,
    toLevel: 0,
    hpRoll: null,
    hpGain: 0,
    asiFeat: null, // { type:"asi", delta } | { type:"feat", featId }
    spellPlan: null,
    spells: { learnCantripIds:[], learnSpellIds:[], replaceFromId:"", replaceToId:"", doReplace:false, autoCantripIds:[] },
    id: `lvlup:${cryptoId()}`,
  };

  dlg.showModal();
  renderLevelUpWizardStep();
}

function closeLevelUpWizard(){
  const dlg = $("levelUpDialog");
  if (dlg && dlg.open) dlg.close();
  LEVELUP_WIZ = null;
}

function wizardSetError(msg){
  const box = $("levelUpBody");
  if (!box) return;
  const el = box.querySelector("#wizErr");
  if (el) el.textContent = msg || "";
}

function renderLevelUpWizardStep(){
  if (!LEVELUP_WIZ) return;
  const body = $("levelUpBody");
  const sub = $("levelUpSubtitle");
  if (!body || !sub) return;

  const stepId = LEVELUP_WIZ.steps[LEVELUP_WIZ.step];
  const stepNum = LEVELUP_WIZ.step + 1;
  const stepTotal = LEVELUP_WIZ.steps.length;

  sub.textContent = `Step ${stepNum} of ${stepTotal}`;

  // Footer buttons
  const backBtn = $("levelUpBackBtn");
  const nextBtn = $("levelUpNextBtn");
  const confirmBtn = $("levelUpConfirmBtn");
  if (backBtn) backBtn.disabled = LEVELUP_WIZ.step === 0;
  if (nextBtn) nextBtn.classList.toggle("hidden", LEVELUP_WIZ.step >= LEVELUP_WIZ.steps.length - 1);
  if (confirmBtn) confirmBtn.classList.toggle("hidden", LEVELUP_WIZ.step < LEVELUP_WIZ.steps.length - 1);

  if (stepId === "choose"){
    const t = totalLevelOf(state);
    const pName = (state.primary?.className||"").trim() || "(none)";
    const pLv = clampInt(state.primary?.classLevel ?? 0, 0, 20);
    const sName = (state.secondary?.className||"").trim() || "(none)";
    const sLv = clampInt(state.secondary?.classLevel ?? 0, 0, 20);
    const canSecondary = !!(state.secondary?.className||"").trim();

    body.innerHTML = `
      <div class="small muted">Current total level: <strong>${t}</strong></div>
      <div class="mt">
        <label class="pill"><input type="radio" name="wizWhich" value="primary" ${LEVELUP_WIZ.which==="primary"?"checked":""}> Primary: <strong>${escapeHtml(pName)}</strong> (level ${pLv})</label>
        <label class="pill" style="margin-left:10px;"><input type="radio" name="wizWhich" value="secondary" ${LEVELUP_WIZ.which==="secondary"?"checked":""} ${canSecondary?"":"disabled"}> Secondary: <strong>${escapeHtml(sName)}</strong> (level ${sLv})</label>
      </div>
      <div class="small muted mt">Level cap is 20. You choose which class gains the next level.</div>
      <div id="wizErr" class="wiz-err small mt"></div>
    `;
    qa("input[name=wizWhich]", body).forEach(r => r.addEventListener("change", () => {
      LEVELUP_WIZ.which = r.value;
    }));
    return;
  }

  if (stepId === "hp"){
  const dieStr = hitDieForClass(LEVELUP_WIZ.className, DATA.classes);
  const dieMax = clampInt(String(dieStr||"d8").replace(/^d/,""), 1, 100);
  const avg = Math.floor(dieMax/2) + 1;
  const con = abilityMod(state.abilities?.con ?? 10);
  const curMax = clampInt(Number(state.combat?.hpMax || 0), 0, 99999);

  const rollVal = clampInt(Number(LEVELUP_WIZ.hpRoll || 0), 0, dieMax);
  const gainVal = rollVal ? Math.max(1, rollVal + con) : 0;
  LEVELUP_WIZ.hpRoll = rollVal || null;
  LEVELUP_WIZ.hpGain = rollVal ? gainVal : null;

  const gainText = (LEVELUP_WIZ.hpGain != null) ? String(LEVELUP_WIZ.hpGain) : "N/A";
  const newMaxText = (LEVELUP_WIZ.hpGain != null) ? String(curMax + LEVELUP_WIZ.hpGain) : "N/A";

  body.innerHTML = `
    <div class="small muted">
      Hit Die for <b>${escapeHtml(LEVELUP_WIZ.className)}</b>: <b>d${dieMax}</b> (average <b>${avg}</b>).
      Roll it, then add your CON modifier (<b>${con>=0?"+":""}${con}</b>), minimum +1.
    </div>
    <div class="row mt">
      <label>Roll (1-${dieMax})
        <input type="number" id="wizHpRoll" min="1" max="${dieMax}" value="${LEVELUP_WIZ.hpRoll||""}">
      </label>
      <button type="button" class="btn" id="wizHpRollBtn">Roll d${dieMax}</button>
      <button type="button" class="btn" id="wizHpAvgBtn">Use average (${avg})</button>
    </div>
    <div class="small muted mt">
      Current Max HP: <b>${curMax}</b>,
      HP gain: <b id="wizHpGain">${gainText}</b>,
      new Max HP: <b id="wizHpNewMax">${newMaxText}</b>.
    </div>
  `;

  const rollDie = (sides) => {
    const n = clampInt(sides, 1, 1000);
    if (n <= 1) return 1;
    try{
      if (window.crypto && crypto.getRandomValues){
        const arr = new Uint32Array(1);
        const max = 0xFFFFFFFF;
        const limit = max - (max % n);
        let x = 0;
        do { crypto.getRandomValues(arr); x = arr[0]; } while (x >= limit);
        return (x % n) + 1;
      }
    }catch{}
    return Math.floor(Math.random() * n) + 1;
  };

  const inp = body.querySelector("#wizHpRoll");
  const out = body.querySelector("#wizHpGain");
  const outNew = body.querySelector("#wizHpNewMax");

  const applyRoll = (v) => {
    const vv = clampInt(v, 0, dieMax);
    if (!vv){
      LEVELUP_WIZ.hpRoll = null;
      LEVELUP_WIZ.hpGain = null;
      if (out) out.textContent = "N/A";
      if (outNew) outNew.textContent = "N/A";
      if (inp) inp.value = "";
      return;
    }
    LEVELUP_WIZ.hpRoll = vv;
    const g = Math.max(1, vv + con);
    LEVELUP_WIZ.hpGain = g;
    if (out) out.textContent = String(g);
    if (outNew) outNew.textContent = String(curMax + g);
    if (inp) inp.value = String(vv);
  };

  if (inp) inp.addEventListener("input", () => applyRoll(Number(inp.value || 0)));
  const btnRoll = body.querySelector("#wizHpRollBtn");
  const btnAvg = body.querySelector("#wizHpAvgBtn");
  if (btnRoll) btnRoll.addEventListener("click", () => applyRoll(rollDie(dieMax)));
  if (btnAvg) btnAvg.addEventListener("click", () => applyRoll(avg));

  return;
}

  if (stepId === "asi"){
    const isFeat = LEVELUP_WIZ.asiFeat?.type === "feat";
    const isAsi = LEVELUP_WIZ.asiFeat?.type === "asi" || !LEVELUP_WIZ.asiFeat;
    const feats = (DATA.feats?.items||[]).filter(f => (f?.type||"") === "feat");
    const picked = new Set((state.picks||[]).filter(p=>p?.type==="feat").map(p=>p.featId));

    body.innerHTML = `
      <div class="small muted">You earned an Ability Score Improvement (or a feat) at this class level.</div>

      <div class="mt">
        <label class="pill"><input type="radio" name="wizAsiType" value="asi" ${isAsi?"checked":""}> Ability Score Improvement</label>
        <label class="pill" style="margin-left:10px;"><input type="radio" name="wizAsiType" value="feat" ${isFeat?"checked":""}> Feat</label>
      </div>

      <div id="wizAsiPanel" class="mt"></div>
      <div id="wizFeatPanel" class="mt"></div>
      <div id="wizErr" class="wiz-err small mt"></div>
    `;

    const asiPanel = body.querySelector("#wizAsiPanel");
    const featPanel = body.querySelector("#wizFeatPanel");

    function renderPanels(){
      const t = (LEVELUP_WIZ.asiFeat?.type) || "asi";
      if (t === "asi"){
        if (asiPanel) asiPanel.innerHTML = `
          <div class="grid two">
            <label class="field">
              <span>Mode</span>
              <select id="wizAsiMode">
                <option value="+2">+2 to one ability</option>
                <option value="+1+1">+1 to two abilities</option>
              </select>
            </label>
            <div class="small muted">Ability scores normally cap at 20 (5e 2014).</div>
          </div>

          <div id="wizAsiChoices" class="mt"></div>
        `;

        if (featPanel) featPanel.innerHTML = "";

        const modeSel = asiPanel.querySelector("#wizAsiMode");
        const choices = asiPanel.querySelector("#wizAsiChoices");
        const curMode = LEVELUP_WIZ.asiFeat?.mode || "+2";
        if (modeSel) modeSel.value = curMode;

        function renderAsiChoices(){
          const mode = modeSel ? modeSel.value : curMode;
          LEVELUP_WIZ.asiFeat = { type:"asi", mode, delta: LEVELUP_WIZ.asiFeat?.delta || {} };
          if (!choices) return;
          if (mode === "+2"){
            const ab = LEVELUP_WIZ.asiFeat?.ab || "STR";
            choices.innerHTML = `
              <label class="field">
                <span>Ability</span>
                <select id="wizAsiAb1">${abilityList.map(a=>`<option value="${a}">${a} (current ${Number(state.abilities?.[a]||0)})</option>`).join("")}</select>
              </label>
            `;
            const abSel = choices.querySelector("#wizAsiAb1");
            if (abSel) abSel.value = ab;
            if (abSel) abSel.addEventListener("change", ()=>{ LEVELUP_WIZ.asiFeat.ab = abSel.value; });
            LEVELUP_WIZ.asiFeat.ab = ab;
          } else {
            const ab1 = LEVELUP_WIZ.asiFeat?.ab1 || "STR";
            const ab2 = LEVELUP_WIZ.asiFeat?.ab2 || "DEX";
            choices.innerHTML = `
              <div class="grid two">
                <label class="field">
                  <span>Ability A</span>
                  <select id="wizAsiAbA">${abilityList.map(a=>`<option value="${a}">${a} (current ${Number(state.abilities?.[a]||0)})</option>`).join("")}</select>
                </label>
                <label class="field">
                  <span>Ability B</span>
                  <select id="wizAsiAbB">${abilityList.map(a=>`<option value="${a}">${a} (current ${Number(state.abilities?.[a]||0)})</option>`).join("")}</select>
                </label>
              </div>
              <div class="small muted mt">A and B must be different.</div>
            `;
            const aSel = choices.querySelector("#wizAsiAbA");
            const bSel = choices.querySelector("#wizAsiAbB");
            if (aSel) aSel.value = ab1;
            if (bSel) bSel.value = ab2;
            if (aSel) aSel.addEventListener("change", ()=>{ LEVELUP_WIZ.asiFeat.ab1 = aSel.value; });
            if (bSel) bSel.addEventListener("change", ()=>{ LEVELUP_WIZ.asiFeat.ab2 = bSel.value; });
            LEVELUP_WIZ.asiFeat.ab1 = ab1;
            LEVELUP_WIZ.asiFeat.ab2 = ab2;
          }
        }

        if (modeSel) modeSel.addEventListener("change", renderAsiChoices);
        renderAsiChoices();
      } else {
        if (asiPanel) asiPanel.innerHTML = "";
        const curSearch = LEVELUP_WIZ.asiFeat?.search || "";
        const curFeat = LEVELUP_WIZ.asiFeat?.featId || "";
        const list = feats
          .filter(f => !picked.has(f.id))
          .filter(f => (f.name||"").toLowerCase().includes(curSearch.toLowerCase()))
          .slice(0, 200);

        if (featPanel) featPanel.innerHTML = `
          <label class="field">
            <span>Search feats</span>
            <input id="wizFeatSearch" type="text" value="${escapeAttr(curSearch)}" placeholder="Type to filter" />
          </label>
          <label class="field mt">
            <span>Pick a feat</span>
            <select id="wizFeatSelect" size="10">${list.map(f=>`<option value="${escapeAttr(f.id)}">${escapeHtml(f.name)}</option>`).join("")}</select>
          </label>
          <div id="wizFeatDetail" class="mt small muted"></div>
        `;

        const search = featPanel.querySelector("#wizFeatSearch");
        const sel = featPanel.querySelector("#wizFeatSelect");
        const detail = featPanel.querySelector("#wizFeatDetail");

        function updateDetail(){
          const id = sel ? sel.value : "";
          const f = feats.find(x=>x.id===id) || null;
          if (!detail) return;
          if (!f){ detail.textContent = ""; return; }
          const eff = Array.isArray(f.effects) ? f.effects.join("\n") : "";
          detail.innerHTML = `<div><strong>${escapeHtml(f.name)}</strong></div>` +
            (f.requirementsText ? `<div class="mt">${escapeHtml(f.requirementsText)}</div>` : "") +
            (eff ? `<div class="mt" style="white-space:pre-wrap;">${escapeHtml(eff)}</div>` : "");
        }

        if (sel){
          if (curFeat) sel.value = curFeat;
          sel.addEventListener("change", () => {
            LEVELUP_WIZ.asiFeat = { type:"feat", featId: sel.value, search: search ? search.value : "" };
            updateDetail();
          });
        }
        if (search) search.addEventListener("input", () => {
          LEVELUP_WIZ.asiFeat = { type:"feat", featId: sel ? sel.value : "", search: search.value };
          renderPanels();
        });

        if (!LEVELUP_WIZ.asiFeat || LEVELUP_WIZ.asiFeat.type !== "feat") LEVELUP_WIZ.asiFeat = { type:"feat", featId: curFeat, search: curSearch };
        updateDetail();
      }
    }

    qa("input[name=wizAsiType]", body).forEach(r => r.addEventListener("change", () => {
      LEVELUP_WIZ.asiFeat = (r.value === "feat") ? { type:"feat", featId:"", search:"" } : { type:"asi", mode:"+2", delta:{} };
      renderPanels();
    }));

    renderPanels();
    return;
  }

  if (stepId === "spells"){
    const plan = LEVELUP_WIZ.spellPlan;
    const cn = LEVELUP_WIZ.className;
    const sn = LEVELUP_WIZ.subclassName;
    const toLv = LEVELUP_WIZ.toLevel;

    const tmp = { multiclass:false, primary:{ className:cn, subclass:sn, classLevel:toLv, spellMod: computeSpellModForBlock({className:cn, subclass:sn}) }, secondary:{ className:"", subclass:"", classLevel:0, spellMod:0 } };
    const allowedIds = allowedSpellIds(tmp, DATA.spellcasting, DATA.subclasses);
    const spellsAll = (DATA.spells?.spells || []);
    const byId = new Map(spellsAll.map(s => [s.id, s]));
    const allowed = allowedIds.map(id => byId.get(id)).filter(Boolean);

    const knownSet = new Set(state.spells?.known || []);
    const cantrips = allowed
      .filter(s => Number(s.level||0) === 0 && !knownSet.has(s.id))
      .sort((a,b)=>a.name.localeCompare(b.name));

    // Subclass school restrictions (5e 2014): EK learns abjuration/evocation except at 8/14/20, AT learns enchantment/illusion except at 8/14/20.
    const anySchoolLevels = new Set([8,14,20]);
    let spellCandidates = allowed.filter(s => Number(s.level||0) >= 1 && !knownSet.has(s.id));
    const spells = spellCandidates.sort((a,b)=> (Number(a.level||0)-Number(b.level||0)) || a.name.localeCompare(b.name));
    const knownNonCantrip = (state.spells?.known || []).map(id=>byId.get(id)).filter(s=>s && Number(s.level||0) >= 1);

    const canNeed = clampInt(plan?.cantripsToChoose ?? 0, 0, 99);
    const spNeed = clampInt(plan?.spellsToChoose ?? 0, 0, 99);

// Eldritch Knight / Arcane Trickster school restrictions (PHB 2014)
const schoolRule = (() => {
  if (cn === "Fighter" && sn === "Eldritch Knight") return { schools: new Set(["abjuration","evocation"]), label: "Abjuration or Evocation" };
  if (cn === "Rogue" && sn === "Arcane Trickster") return { schools: new Set(["enchantment","illusion"]), label: "Enchantment or Illusion" };
  return null;
})();
let requiredSchoolCount = 0;
if (schoolRule && spNeed > 0){
  if (anySchoolLevels.has(Number(toLv))) requiredSchoolCount = 0;
  else if (Number(toLv) === 3) requiredSchoolCount = Math.min(2, spNeed);
  else requiredSchoolCount = spNeed;
}
const schoolHintText = (!schoolRule || spNeed <= 0) ? "" : (
  requiredSchoolCount <= 0
    ? "School restriction: spells learned at this class level can be from any school."
    : (requiredSchoolCount === spNeed
        ? `School restriction: all spells you learn this level must be ${schoolRule.label}.`
        : `School restriction: at least ${requiredSchoolCount} of the spells you learn this level must be ${schoolRule.label}.`)
);
    const autoCantrips = plan?.autoCantripIds || [];

    body.innerHTML = `
      <div class="small muted">Learn spells for <strong>${escapeHtml(cn)}</strong> level ${toLv}.</div>
      ${schoolHintText ? `<div class="small muted mt">${escapeHtml(schoolHintText)}</div>` : ""}
      ${autoCantrips.length ? `<div class="small muted mt">Auto-granted: <strong>${autoCantrips.map(id=>escapeHtml(byId.get(id)?.name || id)).join(", ")}</strong></div>` : ""}

      ${canNeed ? `
        <div class="mt">
          <div><strong>Choose ${canNeed} cantrip${canNeed===1?"":"s"}</strong></div>
          <label class="field mt"><span>Filter</span><input id="wizCantripFilter" type="text" placeholder="Type to filter cantrips" /></label>
          <select id="wizCantripSelect" multiple size="10" class="mt">${cantrips.map(s=>`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`).join("")}</select>
          <div class="small muted mt">Selected: <span id="wizCantripCount">0</span> of ${canNeed}</div>
        </div>
      ` : ""}

      ${spNeed ? `
        <div class="mt">
          <div><strong>Choose ${spNeed} spell${spNeed===1?"":"s"} (${escapeHtml(plan?.spellListLabel || "Known")})</strong></div>
          <label class="field mt"><span>Filter</span><input id="wizSpellFilter" type="text" placeholder="Type to filter spells" /></label>
          <select id="wizSpellSelect" multiple size="12" class="mt">${spells.map(s=>`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)} (L${Number(s.level||0)}${s.school ? ", " + escapeHtml(s.school) : ""})</option>`).join("")}</select>
          <div class="small muted mt">Selected: <span id="wizSpellCount">0</span> of ${spNeed}</div>
        </div>
      ` : ""}

      ${(plan?.canReplaceSpell && knownNonCantrip.length) ? `
        <details class="mt">
          <summary>Optional: Replace 1 known spell</summary>
          <div class="small muted mt">When you gain a level in many known-caster classes, you may replace one known spell with another from your class list.</div>
          <label class="pill mt"><input id="wizDoReplace" type="checkbox" ${LEVELUP_WIZ.spells.doReplace?"checked":""}> Replace one known spell</label>
          <div id="wizReplacePanel" class="mt"></div>
        </details>
      ` : ""}

      <div id="wizErr" class="wiz-err small mt"></div>
    `;

    // Keep plan reference for validation
    LEVELUP_WIZ.spells.autoCantripIds = autoCantrips.slice();

    function bindFilter(inputId, selectId){
      const inp = body.querySelector(inputId);
      const sel = body.querySelector(selectId);
      if (!inp || !sel) return;
      inp.addEventListener("input", () => {
        const q = inp.value.toLowerCase().trim();
        for (const opt of sel.options){
          const txt = String(opt.textContent||"").toLowerCase();
          opt.hidden = q ? !txt.includes(q) : false;
        }
      });
    }

    function bindMultiCount(selectId, outId, storeKey){
      const sel = body.querySelector(selectId);
      const out = body.querySelector(outId);
      if (!sel || !out) return;
      const update = () => {
        const ids = Array.from(sel.selectedOptions).map(o=>o.value);
        LEVELUP_WIZ.spells[storeKey] = ids;
        out.textContent = String(ids.length);
      };
      sel.addEventListener("change", update);
      update();
    }

    bindFilter("#wizCantripFilter", "#wizCantripSelect");
    bindFilter("#wizSpellFilter", "#wizSpellSelect");
    bindMultiCount("#wizCantripSelect", "#wizCantripCount", "learnCantripIds");
    bindMultiCount("#wizSpellSelect", "#wizSpellCount", "learnSpellIds");

    // Replacement
    const doRep = body.querySelector("#wizDoReplace");
    const repPanel = body.querySelector("#wizReplacePanel");
    if (doRep && repPanel){
      const renderRep = () => {
        LEVELUP_WIZ.spells.doReplace = !!doRep.checked;
        if (!doRep.checked){ repPanel.innerHTML = ""; return; }
        const fromOpts = knownNonCantrip.map(s=>`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)} (L${Number(s.level||0)}${s.school ? ", " + escapeHtml(s.school) : ""})</option>`).join("");
        const toOpts = spells.map(s=>`<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)} (L${Number(s.level||0)}${s.school ? ", " + escapeHtml(s.school) : ""})</option>`).join("");
        repPanel.innerHTML = `
          <div class="grid two">
            <label class="field">
              <span>Replace</span>
              <select id="wizRepFrom">${fromOpts}</select>
            </label>
            <label class="field">
              <span>With</span>
              <select id="wizRepTo">${toOpts}</select>
            </label>
          </div>
        `;
        const fromSel = repPanel.querySelector("#wizRepFrom");
        const toSel = repPanel.querySelector("#wizRepTo");
        if (fromSel) fromSel.value = LEVELUP_WIZ.spells.replaceFromId || (knownNonCantrip[0]?.id||"");
        if (toSel) toSel.value = LEVELUP_WIZ.spells.replaceToId || (spells[0]?.id||"");
        LEVELUP_WIZ.spells.replaceFromId = fromSel ? fromSel.value : "";
        LEVELUP_WIZ.spells.replaceToId = toSel ? toSel.value : "";
        if (fromSel) fromSel.addEventListener("change", ()=>{ LEVELUP_WIZ.spells.replaceFromId = fromSel.value; });
        if (toSel) toSel.addEventListener("change", ()=>{ LEVELUP_WIZ.spells.replaceToId = toSel.value; });
      };
      doRep.addEventListener("change", renderRep);
      renderRep();
    }

    return;
  }

  if (stepId === "summary"){
    const which = LEVELUP_WIZ.which;
    const cn = LEVELUP_WIZ.className;
    const from = LEVELUP_WIZ.fromLevel;
    const to = LEVELUP_WIZ.toLevel;
    const hp = LEVELUP_WIZ.hpGain;
    const isAsi = LEVELUP_WIZ.asiFeat?.type === "asi";
    const isFeat = LEVELUP_WIZ.asiFeat?.type === "feat";

    const featObj = isFeat ? (DATA.feats?.items||[]).find(f=>f.id===LEVELUP_WIZ.asiFeat.featId) : null;
    const asiText = isAsi ? Object.entries(LEVELUP_WIZ.asiFeat.delta||{}).map(([a,v])=>`${a} +${v}`).join(", ") : "";

    body.innerHTML = `
      <div class="small muted">Review and confirm.</div>
      <div class="mt">
        <div class="kv"><div>Class</div><div><strong>${escapeHtml(which==="primary"?"Primary":"Secondary")}: ${escapeHtml(cn)}</strong></div></div>
        <div class="kv"><div>Class level</div><div>${from} → <strong>${to}</strong></div></div>
        <div class="kv"><div>HP gain</div><div><strong>${hp||0}</strong></div></div>
        ${(isAsi) ? `<div class="kv"><div>ASI</div><div><strong>${escapeHtml(asiText)}</strong></div></div>` : ""}
        ${(isFeat) ? `<div class="kv"><div>Feat</div><div><strong>${escapeHtml(featObj?.name || LEVELUP_WIZ.asiFeat.featId || "")}</strong></div></div>` : ""}
        ${(LEVELUP_WIZ.steps.includes("spells")) ? `<div class="kv"><div>Spells learned</div><div><strong>${(LEVELUP_WIZ.spells.autoCantripIds||[]).length + (LEVELUP_WIZ.spells.learnCantripIds||[]).length + (LEVELUP_WIZ.spells.learnSpellIds||[]).length}</strong></div></div>` : ""}
      </div>
      <div id="wizErr" class="wiz-err small mt"></div>
    `;
    return;
  }
}

function wizardValidateAndAdvance(dir){
  if (!LEVELUP_WIZ) return;
  const stepId = LEVELUP_WIZ.steps[LEVELUP_WIZ.step];
  wizardSetError("");

  if (dir < 0){
    LEVELUP_WIZ.step = clampInt(LEVELUP_WIZ.step + dir, 0, LEVELUP_WIZ.steps.length-1);
    renderLevelUpWizardStep();
    return;
  }

  // Validate current step
  if (stepId === "choose"){
    const which = LEVELUP_WIZ.which;
    const block = which === "primary" ? state.primary : state.secondary;
    const className = (block?.className||"").trim();
    const subclassName = (block?.subclass||"").trim();
    if (!className){ wizardSetError(`Select a ${which} class first.`); return; }

    const from = clampInt(block?.classLevel ?? 0, 0, 20);
    const to = clampInt(from + 1, 0, 20);
    const totalFrom = totalLevelOf(state);
    const totalTo = clampInt(totalFrom + 1, 1, 20);
    if (totalFrom >= 20 || totalTo > 20){ wizardSetError("You are already level 20."); return; }
    if (to > 20){ wizardSetError("Class level cannot exceed 20."); return; }
    if (which === "secondary" && !((state.secondary?.className||"").trim())){
      wizardSetError("Select a Secondary class before leveling it.");
      return;
    }

    LEVELUP_WIZ.className = className;
    LEVELUP_WIZ.subclassName = subclassName;
    LEVELUP_WIZ.fromLevel = from;
    LEVELUP_WIZ.toLevel = to;

    // Build step list
    const steps = ["choose", "hp"];
    if (hasAsiAtLevel(className, to)) steps.push("asi");
    const plan = buildSpellLearnPlan({ className, subclassName, fromLevel: from, toLevel: to });
    LEVELUP_WIZ.spellPlan = plan;
    const hasSpellsStep = (plan.cantripsToChoose > 0) || (plan.spellsToChoose > 0) || (plan.canReplaceSpell && (state.spells?.known||[]).length > 0) || (plan.autoCantripIds?.length);
    if (hasSpellsStep) steps.push("spells");
    steps.push("summary");
    LEVELUP_WIZ.steps = steps;

    LEVELUP_WIZ.step++;
    renderLevelUpWizardStep();
    return;
  }

  if (stepId === "hp"){
    const dieStr = hitDieForClass(LEVELUP_WIZ.className);
    const dieMax = clampInt(String(dieStr||"").replace(/^d/,""), 1, 100);
    const roll = clampInt(LEVELUP_WIZ.hpRoll, 0, dieMax);
    if (!roll){ wizardSetError(`Enter your HP roll (1-${dieMax}).`); return; }
    const con = abilityMod(state.abilities?.CON ?? 10);
    LEVELUP_WIZ.hpGain = Math.max(1, roll + con);
    LEVELUP_WIZ.step++;
    renderLevelUpWizardStep();
    return;
  }

  if (stepId === "asi"){
    const choice = LEVELUP_WIZ.asiFeat;
    if (!choice){ wizardSetError("Choose ASI or feat."); return; }

    if (choice.type === "asi"){
      const mode = choice.mode || "+2";
      const delta = {};
      if (mode === "+2"){
        const ab = String(choice.ab || "").trim();
        if (!abilityList.includes(ab)){ wizardSetError("Pick an ability."); return; }
        delta[ab] = 2;
      } else {
        const a = String(choice.ab1 || "").trim();
        const b = String(choice.ab2 || "").trim();
        if (!abilityList.includes(a) || !abilityList.includes(b)){ wizardSetError("Pick two abilities."); return; }
        if (a === b){ wizardSetError("Ability A and B must be different."); return; }
        delta[a] = 1;
        delta[b] = 1;
      }

      // Enforce 20 cap (strict 2014 baseline)
      for (const [ab,amt] of Object.entries(delta)){
        const cur = clampInt(state.abilities?.[ab] ?? 0, 0, 30);
        if (cur + Number(amt||0) > 20){
          wizardSetError(`${ab} would exceed 20. Choose a different ASI split.`);
          return;
        }
      }

      LEVELUP_WIZ.asiFeat = { type:"asi", delta };
      LEVELUP_WIZ.step++;
      renderLevelUpWizardStep();
      return;
    }

    if (choice.type === "feat"){
      const featId = String(choice.featId || "").trim();
      if (!featId){ wizardSetError("Pick a feat."); return; }
      const already = (state.picks||[]).some(p => p?.type==="feat" && p?.featId === featId);
      if (already){ wizardSetError("You already have that feat."); return; }
      LEVELUP_WIZ.asiFeat = { type:"feat", featId };
      LEVELUP_WIZ.step++;
      renderLevelUpWizardStep();
      return;
    }
  }

  if (stepId === "spells"){
    const plan = LEVELUP_WIZ.spellPlan;
    const canNeed = clampInt(plan?.cantripsToChoose ?? 0, 0, 99);
    const spNeed = clampInt(plan?.spellsToChoose ?? 0, 0, 99);
    const canSel = Array.isArray(LEVELUP_WIZ.spells.learnCantripIds) ? LEVELUP_WIZ.spells.learnCantripIds : [];
    const spSel = Array.isArray(LEVELUP_WIZ.spells.learnSpellIds) ? LEVELUP_WIZ.spells.learnSpellIds : [];

    if (canSel.length !== canNeed){ wizardSetError(`Choose exactly ${canNeed} cantrip${canNeed===1?"":"s"}.`); return; }
    if (spSel.length !== spNeed){ wizardSetError(`Choose exactly ${spNeed} spell${spNeed===1?"":"s"}.`); return; }

// Eldritch Knight / Arcane Trickster school restrictions (PHB 2014)
const cn = LEVELUP_WIZ.className;
const sn = LEVELUP_WIZ.subclassName || "";
const toLv = Number(LEVELUP_WIZ.toLevel);
const anySchoolLevels = new Set([8, 14, 20]);

const schoolRule = (() => {
  if (cn === "Fighter" && sn === "Eldritch Knight") return { schools: new Set(["abjuration","evocation"]), label: "Abjuration or Evocation" };
  if (cn === "Rogue" && sn === "Arcane Trickster") return { schools: new Set(["enchantment","illusion"]), label: "Enchantment or Illusion" };
  return null;
})();

let requiredSchoolCount = 0;
if (schoolRule && spNeed > 0){
  if (anySchoolLevels.has(toLv)) requiredSchoolCount = 0;
  else if (toLv === 3) requiredSchoolCount = Math.min(2, spNeed);
  else requiredSchoolCount = spNeed;
}

if (schoolRule && spNeed > 0 && requiredSchoolCount > 0){
  const byId = new Map((DATA.spells?.spells || []).map(s => [s.id, s]));
  const restrictedCount = spSel.filter(id => schoolRule.schools.has(String(byId.get(id)?.school || "").toLowerCase())).length;
  if (restrictedCount < requiredSchoolCount){
    wizardSetError(`School restriction: choose at least ${requiredSchoolCount} ${schoolRule.label} spell${requiredSchoolCount===1?"":"s"} this level.`);
    return;
  }
}


    // Validate replacement
    if (LEVELUP_WIZ.spells.doReplace){
      if (!LEVELUP_WIZ.spells.replaceFromId || !LEVELUP_WIZ.spells.replaceToId){
        wizardSetError("Select both the spell to replace and the new spell.");
        return;
      }
      if (LEVELUP_WIZ.spells.replaceFromId === LEVELUP_WIZ.spells.replaceToId){
        wizardSetError("Replacement spell must be different.");
        return;
      }
      const knownSet = new Set(state.spells?.known || []);
      if (!knownSet.has(LEVELUP_WIZ.spells.replaceFromId)){
        wizardSetError("You can only replace a spell you already know.");
        return;
      }
      if (knownSet.has(LEVELUP_WIZ.spells.replaceToId)){
        wizardSetError("You already know the replacement spell.");
        return;
      }
      // Avoid duplicates in the same level
      const selSet = new Set([...canSel, ...spSel, ...(plan?.autoCantripIds||[])]);
      if (selSet.has(LEVELUP_WIZ.spells.replaceToId)){
        wizardSetError("Do not pick the replacement spell as a learned spell in the same level.");
        return;
      }

if (schoolRule && !anySchoolLevels.has(toLv)){
  const byId = new Map((DATA.spells?.spells || []).map(s => [s.id, s]));
  const school = String(byId.get(LEVELUP_WIZ.spells.replaceToId)?.school || "").toLowerCase();
  if (!schoolRule.schools.has(school)){
    wizardSetError(`School restriction: replacement spell must be ${schoolRule.label} at this class level.`);
    return;
  }
}
    }

    LEVELUP_WIZ.step++;
    renderLevelUpWizardStep();
    return;
  }

  // summary or any other
  LEVELUP_WIZ.step = clampInt(LEVELUP_WIZ.step + 1, 0, LEVELUP_WIZ.steps.length-1);
  renderLevelUpWizardStep();
}

function commitLevelUpWizard(){
  if (!LEVELUP_WIZ) return;

  // Final validation, then apply.
  wizardSetError("");
  const which = LEVELUP_WIZ.which;
  const src = (which === "primary") ? "class-primary" : "class-secondary";
  const block = (which === "primary") ? state.primary : state.secondary;
  if (!block?.className){ wizardSetError("Missing class."); return; }

  ensureBuildState();
  state.build.redo = [];

  // Apply level
  if (which === "secondary") state.multiclass = true;
  block.classLevel = clampInt(Number(block.classLevel||0) + 1, 0, 20);
  state.level = totalLevelOf(state);

  // HP
  const hpGain = clampInt(LEVELUP_WIZ.hpGain, 1, 99);
  state.combat.hpMax = clampInt(Number(state.combat.hpMax||0) + hpGain, 1, 9999);
  state.combat.hpNow = clampInt(Number(state.combat.hpNow||0), 0, state.combat.hpMax);

  // Hit dice
  addHitDieForClassLevelChange(state, block.className, +1);

  // ASI / Feat
  const pickGrantId = LEVELUP_WIZ.id;
  if (LEVELUP_WIZ.asiFeat?.type === "asi"){
    const delta = LEVELUP_WIZ.asiFeat.delta || {};
    for (const [ab, amt] of Object.entries(delta)){
      if (ab in state.abilities) state.abilities[ab] = clampInt(Number(state.abilities[ab]||0) + Number(amt||0), 1, 30);
    }
    state.picks = Array.isArray(state.picks) ? state.picks : [];
    const name = `ASI (${block.className} ${block.classLevel}): ` + Object.entries(delta).map(([a,v])=>`${a} +${v}`).join(", ");
    state.picks.push({ type:"asi", name, text:name, delta, grantId: pickGrantId, grantedAt:{ which, className:block.className, level:block.classLevel } });
  }
  if (LEVELUP_WIZ.asiFeat?.type === "feat"){
    const featId = LEVELUP_WIZ.asiFeat.featId;
    const f = (DATA.feats?.items||[]).find(x=>x.id===featId) || null;
    const featText = f ? (Array.isArray(f.effects) ? f.effects.join("\n") : "") : "";
    state.picks = Array.isArray(state.picks) ? state.picks : [];
    state.picks.push({ type:"feat", featId, name: f?.name || featId, text: featText || "", requirementsText: f?.requirementsText || "", grantId: pickGrantId, grantedAt:{ which, className:block.className, level:block.classLevel } });
    state.feats = Array.isArray(state.feats) ? state.feats : [];
    if (!state.feats.some(x => x?.id === featId)){
      state.feats.push({ id: featId, name: f?.name || featId, requirementsText: f?.requirementsText || "", text: featText || "", source: "feat", grantId: pickGrantId });
    }
    state.features = Array.isArray(state.features) ? state.features : [];
    state.features.push({ key:`feat:${featId}:${pickGrantId}`, source:"feat", name: f?.name || featId, text: featText || "", grantId: pickGrantId });
  }

  // Spells
  const learned = [];
  const unlearned = [];
  if (LEVELUP_WIZ.steps.includes("spells")){
    state.spells = state.spells || { known:[], knownByBlock:{primary:[],secondary:[]}, prepared:[], pendingLearn:0, notes:"" };
    state.spells.known = Array.isArray(state.spells.known) ? state.spells.known : [];
    const addKnown = (id) => { if (id && !state.spells.known.includes(id)) { state.spells.known.push(id); learned.push(id); } };
    const removeKnown = (id) => {
      const idx = state.spells.known.indexOf(id);
      if (idx >= 0){ state.spells.known.splice(idx,1); unlearned.push(id); }
    };

    for (const id of (LEVELUP_WIZ.spells.autoCantripIds||[])) addKnown(id);
    for (const id of (LEVELUP_WIZ.spells.learnCantripIds||[])) addKnown(id);
    for (const id of (LEVELUP_WIZ.spells.learnSpellIds||[])) addKnown(id);

    if (LEVELUP_WIZ.spells.doReplace){
      removeKnown(LEVELUP_WIZ.spells.replaceFromId);
      addKnown(LEVELUP_WIZ.spells.replaceToId);
    }
  }

  // Record build log
  state.build.log.push({
    id: LEVELUP_WIZ.id,
    kind:"levelUp",
    at: new Date().toISOString(),
    which,
    className: block.className,
    subclassName: block.subclass || "",
    fromLevel: LEVELUP_WIZ.fromLevel,
    toLevel: LEVELUP_WIZ.toLevel,
    hp: { die: hitDieForClass(block.className), roll: LEVELUP_WIZ.hpRoll, gain: hpGain },
    asiFeat: LEVELUP_WIZ.asiFeat,
    spells: {
      learned,
      unlearned,
      autoCantripIds: LEVELUP_WIZ.spells.autoCantripIds||[],
      learnCantripIds: LEVELUP_WIZ.spells.learnCantripIds||[],
      learnSpellIds: LEVELUP_WIZ.spells.learnSpellIds||[],
      replaced: LEVELUP_WIZ.spells.doReplace ? { from: LEVELUP_WIZ.spells.replaceFromId, to: LEVELUP_WIZ.spells.replaceToId } : null,
    },
  });

  // Ensure class feature sources are up to date
  state = stripSourceContributions(state, src);
  save();
  closeLevelUpWizard();
  rerender();
}

function undoLastLevelUp(){
  ensureBuildState();
  const last = state.build.log[state.build.log.length-1];
  if (!last){
    alert("No level up actions to undo.");
    return;
  }
  const ok = confirm(`Undo the most recent level up? (${last.className} ${last.fromLevel}→${last.toLevel})`);
  if (!ok) return;

  state.build.log.pop();
  state.build.redo.push(last);

  const which = last.which;
  const src = (which === "primary") ? "class-primary" : "class-secondary";
  const block = (which === "primary") ? state.primary : state.secondary;

  // Level down
  block.classLevel = clampInt(Number(block.classLevel||0) - 1, 0, 20);
  if (which === "secondary" && block.classLevel <= 0){
    // If you removed the only secondary level, consider multiclass off.
    if (clampInt(state.secondary.classLevel,0,20) === 0) state.multiclass = false;
  }
  state.level = totalLevelOf(state);

  // HP max rollback
  const hpGain = clampInt(last?.hp?.gain ?? 0, 0, 99);
  state.combat.hpMax = clampInt(Number(state.combat.hpMax||0) - hpGain, 1, 9999);
  state.combat.hpNow = clampInt(Number(state.combat.hpNow||0), 0, state.combat.hpMax);

  // Hit dice rollback
  addHitDieForClassLevelChange(state, last.className, -1);

  // Undo ASI/Feat
  const grantId = last.id;
  if (last.asiFeat?.type === "asi"){
    for (const [ab, amt] of Object.entries(last.asiFeat.delta||{})){
      if (ab in state.abilities) state.abilities[ab] = clampInt(Number(state.abilities[ab]||0) - Number(amt||0), 1, 30);
    }
  }
  if (Array.isArray(state.picks)) state.picks = state.picks.filter(p => p?.grantId !== grantId);
  if (Array.isArray(state.features)) state.features = state.features.filter(f => f?.grantId !== grantId);
  if (Array.isArray(state.feats)) state.feats = state.feats.filter(f => f?.grantId !== grantId);

  // Undo spells
  if (state.spells && Array.isArray(state.spells.known)){
    const known = state.spells.known;
    // Reverse replacement first
    if (last.spells?.replaced){
      const { from, to } = last.spells.replaced;
      const idxTo = known.indexOf(to);
      if (idxTo >= 0) known.splice(idxTo,1);
      if (from && !known.includes(from)) known.push(from);
    }
    // Remove learned spells/cantrips from this level-up
    for (const id of (last.spells?.learned||[])){
      const idx = known.indexOf(id);
      if (idx >= 0) known.splice(idx,1);
    }
  }

  // Remove class choices above the new class level
  if (state.classChoices && typeof state.classChoices === "object"){
    const cls = (block.className||"").trim();
    const curLv = clampInt(block.classLevel||0, 0, 20);
    for (const k of Object.keys(state.classChoices)){
      const m = k.match(/^choice:(primary|secondary):([^:]+):L(\d+):/);
      if (!m) continue;
      const kWhich = m[1];
      const kClass = m[2];
      const kLv = Number(m[3]);
      if (kWhich === which && kClass === cls && kLv > curLv) delete state.classChoices[k];
    }
  }

  // Resync class-derived features/resources
  state = stripSourceContributions(state, src);
  save();
  rerender();
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
  renderClassChoices();
  renderBuildLogPanel();

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
  renderClassChoices();
  renderCore();
  renderBuildLogPanel();
}

function save(){
  ensureBuildState();

  // Keep backward-compat spell arrays in sync.
  if (!state.spells) state.spells = { known:[], knownByBlock:{primary:[],secondary:[]}, prepared:[], pendingLearn:0, notes:"" };
  if (state.spells.knownByBlock && typeof state.spells.knownByBlock === "object"){
    const p = Array.isArray(state.spells.knownByBlock.primary) ? state.spells.knownByBlock.primary : [];
    const s = Array.isArray(state.spells.knownByBlock.secondary) ? state.spells.knownByBlock.secondary : [];
    state.spells.known = Array.from(new Set([...(Array.isArray(state.spells.known)?state.spells.known:[]), ...p, ...s]));
  } else {
    state.spells.known = Array.from(new Set(Array.isArray(state.spells.known)?state.spells.known:[]));
  }

  state = syncClassFeatures(state, DATA.classFeatures);
  state = saveCharacterState(state);
  notifyBattleFrame();
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
  // Battle tracker iframe integration
  const bf = $("battleFrame");
  if (bf) {
    bf.addEventListener("load", () => notifyBattleFrame());
  }

  window.addEventListener("message", (e) => {
    if (!e || !e.data || typeof e.data.type !== "string") return;
    if (e.data.type === "BATTLE_UPDATED") {
      // Battle tab wrote to shared character storage, reload and re-render.
      try {
        state = loadCharacterState();
        state = syncClassFeatures(state, DATA.classFeatures);
        state.equipment = state.equipment || defaultEquipment();
        state.rest = state.rest || { preparedUnlock:0, hitDice:null };
        state.rest.hitDice = state.rest.hitDice || defaultHitDicePools(state);
        rerender();
      } catch {}
    }
    if (e.data.type === "BATTLE_READY") {
      notifyBattleFrame();
    }
  });
  await loadAllData();
  renderDataStatus();
  initSelectOptions();

  state = loadCharacterState();
  state = syncClassFeatures(state, DATA.classFeatures);
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
    // Changing class removes auto-applied class features for this block.
    state = stripSourceContributions(state, "class-primary");
    state.primary.className = $("primaryClass").value;
    // If no subclass applies, clear
    state.primary.subclass = "";
    // Auto-set spell ability mod for this block (if applicable)
    state.primary.spellMod = computeSpellModForBlock(state.primary);
    save(); rerender();
  });
  $("primaryLevel").addEventListener("change", () => {
    if (state.build?.locked){
      $("primaryLevel").value = String(state.primary?.classLevel ?? 0);
      return;
    }
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
    if (!state.multiclass) state = stripSourceContributions(state, "class-secondary");
    save(); rerender();
  });

  $("secondaryClass").addEventListener("change", () => {
    state = stripSourceContributions(state, "class-secondary");
    state.secondary.className = $("secondaryClass").value;
    state.secondary.subclass = "";
    state.secondary.spellMod = computeSpellModForBlock(state.secondary);
    save(); rerender();
  });
  $("secondaryLevel").addEventListener("change", () => {
    if (state.build?.locked){
      $("secondaryLevel").value = String(state.secondary?.classLevel ?? 0);
      return;
    }
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
function notifyBattleFrame(){
  const frame = $("battleFrame");
  if (!frame || !frame.contentWindow) return;
  try{
    frame.contentWindow.postMessage({ type:"CHAR_SHEET_UPDATED", at: Date.now() }, "*");
  }catch{}
}



function registerServiceWorker(){
  try{
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    });
  }catch{}
}

registerServiceWorker();
