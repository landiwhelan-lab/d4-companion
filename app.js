// app.js — rendering + interactions. Content comes from content.json; state from store.js.
import * as store from './store.js';

let C = null; // content.json
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TABS = () => [
  { id: 'guide', label: 'Guide' },
  ...C.characters.map(ch => ({ id: ch.id, label: ch.name })),
  { id: 'sessions', label: 'Sessions' },
  { id: 'links', label: 'Links' },
];

let activeTab = localStorage.getItem('d4tab') || 'guide';

// ---------- boot ----------
async function boot() {
  // no-cache: always revalidate so content edits appear on next refresh (ETag makes this cheap)
  C = await (await fetch('./content.json', { cache: 'no-cache' })).json();
  $('#season-label').textContent = C.meta.season;
  store.onToast(showToast);
  store.onChange(onStateChange);
  renderTabs();
  render();
  store.subscribe();
  try {
    await store.refetchAll();
    await store.ensureSeeded(C);
  } catch (e) {
    showToast("Can't reach the database — it may be paused (free tier). Restore it in the Supabase dashboard, then reload.");
  }
  render();
}

function onStateChange(what) {
  updateSyncDot();
  if (what === 'connection') return;
  render();
}

function updateSyncDot() {
  const dot = $('#sync-dot');
  dot.className = store.state.connection;
  dot.title = { live: 'Live sync', reconnecting: 'Reconnecting…', error: 'Sync error', connecting: 'Connecting…' }[store.state.connection] || '';
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 6000);
}

// ---------- tabs ----------
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = TABS().map(t => {
    const ch = C.characters.find(c => c.id === t.id);
    const style = ch ? `style="--accent:${ch.color}"` : '';
    return `<button data-tab="${t.id}" ${style} class="${t.id === activeTab ? 'active' : ''}">${esc(t.label)}</button>`;
  }).join('');
  nav.onclick = e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    activeTab = b.dataset.tab;
    localStorage.setItem('d4tab', activeTab);
    renderTabs();
    render();
    $('#view').scrollTop = 0;
    window.scrollTo(0, 0);
  };
}

// ---------- render dispatch ----------
function render() {
  if (!C) return;
  updateSyncDot();
  const view = $('#view');
  const focused = document.activeElement;
  if (focused && view.contains(focused) && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) {
    return; // don't clobber a form the user is typing in; next event re-renders
  }
  if (activeTab === 'guide') view.innerHTML = renderGuide();
  else if (activeTab === 'sessions') view.innerHTML = renderSessions();
  else if (activeTab === 'links') view.innerHTML = renderLinks();
  else view.innerHTML = renderCharacter(C.characters.find(c => c.id === activeTab));
  wire(view);
}

// ---------- guide ----------
function renderGuide() {
  const jump = C.guide.map(s => `<a href="#g-${s.id}">${esc(s.title)}</a>`).join('');
  const sections = C.guide.map(s => {
    let body = s.html || '';
    if (s.items) {
      body = `<ul class="checklist">` + s.items.map(it => checkRow(`route.${it.id}`, it.text)).join('') + `</ul>` + body;
    }
    return `<section class="card" id="g-${s.id}"><h2>${esc(s.title)}</h2>${body}</section>`;
  }).join('');
  return `<div class="plan-banner">${esc(C.meta.plan)}</div><div class="jumpnav">${jump}</div>${sections}`;
}

// ---------- character ----------
function renderCharacter(ch) {
  const phaseKey = `${ch.id}.phase`;
  const activePhase = store.tick(phaseKey, 'leveling');
  const phase = ch.phases.find(p => p.id === activePhase) || ch.phases[0];
  const level = store.tick(`${ch.id}.level`, 1);
  const diff = store.tick(`${ch.id}.difficulty`, 'Normal');
  const nodes = store.tick(`${ch.id}.nodes`, 0);

  const phaseTabs = ch.phases.map(p =>
    `<button data-phase="${p.id}" data-char="${ch.id}" class="${p.id === phase.id ? 'active' : ''}">${esc(p.label)}</button>`).join('');

  return `
  <div class="char" style="--accent:${ch.color}">
    <div class="card char-head">
      <div class="char-name">${esc(ch.name)} <span class="klass">${esc(ch.klass)} · ${esc(ch.build)}</span></div>
      <div class="progress-row">
        <div class="stat">
          <label>Level</label>
          <div class="stepper">
            <button data-step="${ch.id}.level" data-d="-1">−</button>
            <b>${level}</b>
            <button data-step="${ch.id}.level" data-d="1">+</button>
          </div>
        </div>
        <div class="stat">
          <label>Difficulty</label>
          <select data-diff="${ch.id}">${C.difficulties.map(d => `<option ${d === diff ? 'selected' : ''}>${d}</option>`).join('')}</select>
        </div>
      </div>
      ${nodeCounter(ch.id, nodes)}
    </div>

    <div class="phase-tabs">${phaseTabs}
      <a class="build-link" target="_blank" rel="noopener" href="${phase.id === 'endgame' ? ch.links.endgame : ch.links.leveling}">Mobalytics ↗</a>
    </div>
    ${phase.intro ? `<div class="intro-note">${phase.intro}</div>` : ''}

    <section class="card">
      <h2>Skills ${completion(ch.id, phase, 'skills')}</h2>
      <ul class="checklist">
        ${phase.skills.map(s => checkRow(`${ch.id}.${phase.id}.skills.${s.id}`, s.text + (s.rank ? ` · rank ${s.rank}` : ''), s.note)).join('')}
      </ul>
    </section>

    <section class="card">
      <h2>Gear ${gearCompletion(ch.id, phase)}</h2>
      <ul class="gearlist">
        ${phase.gear.map(g => gearRow(ch.id, phase, g)).join('')}
      </ul>
      ${phase.id === 'endgame' ? `<p class="hint">Tap the state chip to advance: — → Stopgap → Got it → Perfected. Long-press to go back. Tap the row for the ladder & drop source.</p>` : ''}
    </section>

    ${phase.paragon ? `
    <section class="card">
      <h2>Paragon</h2>
      <ul class="checklist">
        ${phase.paragon.map(p => checkRow(`${ch.id}.paragon.${p.id}`, p.text)).join('')}
      </ul>
      <p class="hint">Board layouts live on the Mobalytics paragon tab (link above) — mini-boards in the app are a later upgrade.</p>
    </section>` : ''}

    <section class="card">
      <h2>Farming targets</h2>
      <ul class="targets">
        ${store.state.targets.filter(t => t.character === ch.id).map(targetRow).join('') || '<li class="empty">No targets yet</li>'}
      </ul>
      <form class="add-target" data-char="${ch.id}">
        <input name="item" placeholder="Item" required>
        <input name="source" placeholder="Where (boss / craft)">
        <button>Add</button>
      </form>
    </section>

    <section class="card">
      <h2>Build notes</h2>
      ${phase.notes.map(n => `<p class="note">${n}</p>`).join('')}
    </section>
  </div>`;
}

function nodeCounter(chId, nodes) {
  const pips = Array.from({ length: 15 }, (_, i) =>
    `<span class="pip ${i <= nodes && i > 0 ? 'on' : ''} ${i === 4 ? 'bp4' : ''} ${i === 14 ? 'bp14' : ''}">${i === 4 || i === 14 ? i : ''}</span>`).join('');
  const label = nodes >= 14 ? '14+ — Maggots GUARANTEED 🎉' : nodes >= 4 ? `${nodes} — Maggots possible` : `${nodes} — below Maggot threshold`;
  return `
  <div class="nodes">
    <label>Helltide War Plan nodes <b class="${nodes >= 14 ? 'gold' : nodes >= 4 ? 'amber' : ''}">${esc(label)}</b></label>
    <div class="node-row">
      <button data-step="${chId}.nodes" data-d="-1" data-min="0" data-max="14">−</button>
      <div class="pips">${pips}</div>
      <button data-step="${chId}.nodes" data-d="1" data-min="0" data-max="14">+</button>
    </div>
  </div>`;
}

function checkRow(key, text, note) {
  const on = !!store.tick(key, false);
  return `<li class="${on ? 'done' : ''}">
    <button class="check" data-check="${key}" aria-checked="${on}">${on ? '✓' : ''}</button>
    <div class="check-label"><span>${esc(text)}</span>${note ? `<small>${esc(note)}</small>` : ''}</div>
  </li>`;
}

function gearRow(chId, phase, g) {
  const key = `${chId}.${phase.id}.gear.${g.id}`;
  const st = phase.id === 'endgame' ? Number(store.tick(key, 0)) : (store.tick(key, false) ? 3 : 0);
  const states = C.gearStates;
  const open = openGear.has(key);
  if (phase.id !== 'endgame') {
    // leveling: checkbox rows, expandable when they carry affix/temper detail
    const on = st === 3;
    const hasDetail = g.affixes?.length || g.tempers?.length || g.masterwork || g.aspect || g.note;
    return `<li class="gear lvl ${on ? 'done' : ''}">
      <div class="gear-main" ${hasDetail ? `data-expand="${key}"` : ''}>
        <button class="check" data-check-gear="${key}" aria-checked="${on}">${on ? '✓' : ''}</button>
        <div class="gear-text">
          <b>${esc(g.slot)}</b>
          <span>${esc(g.item)}</span>
        </div>
        ${hasDetail ? `<span class="chev">${open ? '▾' : '▸'}</span>` : ''}
      </div>
      ${open && hasDetail ? `<div class="gear-detail">
        ${g.aspect ? `<p>✨ <b>Aspect:</b> ${esc(g.aspect)}</p>` : ''}
        ${g.affixes?.length ? `<p>🎯 <b>Affixes:</b> ${g.affixes.map(esc).join(' · ')}</p>` : ''}
        ${g.tempers?.length ? `<p>🔨 <b>Tempers:</b> ${g.tempers.map(esc).join(' · ')}</p>` : ''}
        ${g.masterwork ? `<p>⭐ <b>Masterwork:</b> ${esc(g.masterwork)}</p>` : ''}
        ${g.note ? `<p>${esc(g.note)}</p>` : ''}
      </div>` : ''}
    </li>`;
  }
  return `<li class="gear ${st === 3 ? 'done' : ''}">
    <div class="gear-main" data-expand="${key}">
      <div class="gear-text">
        <b>${esc(g.slot)}</b>
        <span>${esc(g.item)}</span>
      </div>
      <button class="state-chip s${st}" data-cycle="${key}">${states[st]}</button>
    </div>
    ${open ? `<div class="gear-detail">
      <ol class="ladder">${g.ladder.map((l, i) => `<li class="${i <= st - 1 ? 'past' : ''}">${esc(l)}</li>`).join('')}</ol>
      ${g.source ? `<p>📍 <b>${esc(g.source)}</b></p>` : ''}
      ${g.aspect ? `<p>✨ <b>Aspect:</b> ${esc(g.aspect)}</p>` : ''}
      ${g.affixes?.length ? `<p>🎯 <b>Affixes:</b> ${g.affixes.map(esc).join(' · ')}</p>` : ''}
      ${g.tempers?.length ? `<p>🔨 <b>Tempers:</b> ${g.tempers.map(esc).join(' · ')}</p>` : ''}
      ${g.masterwork ? `<p>⭐ <b>Masterwork:</b> ${esc(g.masterwork)}</p>` : ''}
      ${g.note ? `<p>${esc(g.note)}</p>` : ''}
    </div>` : ''}
  </li>`;
}

const openGear = new Set();

function completion(chId, phase, kind) {
  const items = phase[kind];
  const done = items.filter(s => store.tick(`${chId}.${phase.id}.${kind}.${s.id}`, false)).length;
  return `<span class="count">${done}/${items.length}</span>`;
}
function gearCompletion(chId, phase) {
  if (phase.id !== 'endgame') {
    const done = phase.gear.filter(g => store.tick(`${chId}.${phase.id}.gear.${g.id}`, false)).length;
    return `<span class="count">${done}/${phase.gear.length}</span>`;
  }
  const total = phase.gear.length * 3;
  const sum = phase.gear.reduce((a, g) => a + Number(store.tick(`${chId}.${phase.id}.gear.${g.id}`, 0)), 0);
  const pct = Math.round(100 * sum / total);
  return `<span class="count">${pct}% perfected</span><span class="bar"><span style="width:${pct}%"></span></span>`;
}

function targetRow(t) {
  return `<li class="${t.done ? 'done' : ''}">
    <button class="check" data-target-done="${t.id}" aria-checked="${t.done}">${t.done ? '✓' : ''}</button>
    <div class="check-label">
      <span>${esc(t.item)}</span>
      <small>${esc(t.source || '')}${t.note ? ' · ' + esc(t.note) : ''}</small>
    </div>
    <button class="del" data-target-del="${t.id}">×</button>
  </li>`;
}

// ---------- sessions ----------
function renderSessions() {
  const strategy = store.tick('notes.strategy', '');
  return `
  <section class="card">
    <h2>Session log</h2>
    <ul class="sessions">
      ${store.state.sessions.map(s => `
        <li>
          <div class="sess-date">${esc(s.session_date)}</div>
          <div class="sess-body"><b>${esc(s.levels || '')}</b> ${esc(s.notes || '')}</div>
          <button class="del" data-session-del="${s.id}">×</button>
        </li>`).join('') || '<li class="empty">No sessions yet</li>'}
    </ul>
    <form id="add-session">
      <input name="session_date" type="date" required value="${new Date().toISOString().slice(0, 10)}">
      <input name="levels" placeholder="Levels (e.g. 50 → 58)">
      <input name="notes" placeholder="What we did">
      <button>Add session</button>
    </form>
  </section>

  <section class="card">
    <h2>Roadmap</h2>
    <ul class="checklist">
      ${C.roadmap.map(r => checkRow(`roadmap.${r.id}`, r.text)).join('')}
    </ul>
  </section>

  <section class="card">
    <h2>Strategy notes</h2>
    <textarea id="strategy" placeholder="Plan the next session…">${esc(strategy)}</textarea>
    <div class="row-end"><button id="save-strategy">Save notes</button></div>
  </section>

  <section class="card">
    <h2>Confirm in-game</h2>
    <ul class="plain">${C.openQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
  </section>

  <section class="card danger-zone">
    <h2>Party</h2>
    <p class="hint">Party code: <code>${esc(store.party)}</code></p>
    <div class="row-end">
      <button id="share-party">Copy invite link</button>
      <button id="reset-party" class="danger">Reset season…</button>
    </div>
  </section>`;
}

// ---------- links ----------
function renderLinks() {
  return C.resources.map(g => `
    <section class="card">
      <h2>${esc(g.group)}</h2>
      <ul class="linklist">
        ${g.links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span class="ext">↗</span></a></li>`).join('')}
      </ul>
    </section>`).join('');
}

// ---------- event wiring ----------
let pressTimer = null;
function wire(view) {
  view.onclick = async (e) => {
    const t = e.target;
    const check = t.closest('[data-check]');
    if (check) { store.setTick(check.dataset.check, !store.tick(check.dataset.check, false)); return; }

    const checkGear = t.closest('[data-check-gear]');
    if (checkGear) { store.setTick(checkGear.dataset.checkGear, !store.tick(checkGear.dataset.checkGear, false)); return; }

    const step = t.closest('[data-step]');
    if (step) {
      const key = step.dataset.step;
      const min = step.dataset.min !== undefined ? Number(step.dataset.min) : 1;
      const max = step.dataset.max !== undefined ? Number(step.dataset.max) : 300;
      const cur = Number(store.tick(key, min));
      const next = Math.min(max, Math.max(min, cur + Number(step.dataset.d)));
      if (next !== cur) store.setTick(key, next);
      return;
    }

    const cycle = t.closest('[data-cycle]');
    if (cycle) {
      if (cycle._longpressed) { cycle._longpressed = false; return; }
      const key = cycle.dataset.cycle;
      store.setTick(key, (Number(store.tick(key, 0)) + 1) % 4);
      return;
    }

    const expand = t.closest('[data-expand]');
    if (expand && !t.closest('[data-cycle]')) {
      const key = expand.dataset.expand;
      openGear.has(key) ? openGear.delete(key) : openGear.add(key);
      render();
      return;
    }

    const done = t.closest('[data-target-done]');
    if (done) {
      const row = store.state.targets.find(x => x.id === done.dataset.targetDone);
      if (row) store.upsertTarget({ ...row, done: !row.done });
      return;
    }
    const tdel = t.closest('[data-target-del]');
    if (tdel && confirm('Delete this target?')) { store.deleteTarget(tdel.dataset.targetDel); return; }
    const sdel = t.closest('[data-session-del]');
    if (sdel && confirm('Delete this session entry?')) { store.deleteSession(sdel.dataset.sessionDel); return; }

    const phase = t.closest('[data-phase]');
    if (phase) { store.setTick(`${phase.dataset.char}.phase`, phase.dataset.phase); return; }

    if (t.id === 'save-strategy') { store.setTick('notes.strategy', $('#strategy').value); showToastOk('Notes saved'); return; }
    if (t.id === 'share-party') {
      const link = `${location.origin}${location.pathname}?party=${encodeURIComponent(store.party)}`;
      try { await navigator.clipboard.writeText(link); showToastOk('Invite link copied'); }
      catch { prompt('Copy this link:', link); }
      return;
    }
    if (t.id === 'reset-party') {
      if (!confirm('Reset EVERYTHING for a new season? All ticks, sessions and targets will be wiped and re-seeded.')) return;
      if (!confirm('Really sure? This affects both of you.')) return;
      await store.resetParty(C);
      showToastOk('Party reset & re-seeded');
      return;
    }
  };

  // long-press on gear state chip = step backwards
  view.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('[data-cycle]');
    if (!chip) return;
    pressTimer = setTimeout(() => {
      chip._longpressed = true;
      const key = chip.dataset.cycle;
      store.setTick(key, (Number(store.tick(key, 0)) + 3) % 4);
    }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    view.addEventListener(ev, () => clearTimeout(pressTimer)));

  view.onchange = (e) => {
    const diff = e.target.closest('[data-diff]');
    if (diff) store.setTick(`${diff.dataset.diff}.difficulty`, diff.value);
  };

  view.onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'add-session') {
      store.upsertSession({
        id: store.newId(),
        session_date: f.session_date.value,
        levels: f.levels.value.trim(),
        notes: f.notes.value.trim(),
      });
      f.reset();
      f.session_date.value = new Date().toISOString().slice(0, 10);
    } else if (f.classList.contains('add-target')) {
      store.upsertTarget({
        id: store.newId(),
        character: f.dataset.char,
        item: f.item.value.trim(),
        source: f.source.value.trim(),
        note: '',
        done: false,
      });
      f.reset();
    }
  };
}

function showToastOk(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2000);
}

boot();
