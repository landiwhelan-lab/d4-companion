// store.js — all Supabase state: fetch, realtime, optimistic writes, seeding, reset.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';
import { SUPABASE_URL, SUPABASE_KEY, DEFAULT_PARTY } from './config.js';

const url = new URL(location.href);
const urlParty = url.searchParams.get('party');
if (urlParty) localStorage.setItem('d4party', urlParty);
export const party = localStorage.getItem('d4party') || DEFAULT_PARTY;
localStorage.setItem('d4party', party);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- in-memory state ----
export const state = {
  ticks: new Map(),      // key -> value
  sessions: [],          // rows sorted by date
  targets: [],           // rows sorted by created_at
  connection: 'connecting', // 'live' | 'reconnecting' | 'error'
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit(what) { for (const fn of listeners) fn(what); }

export function tick(key, fallback) {
  const v = state.ticks.get(key);
  return v === undefined ? fallback : v;
}

function setConnection(c) {
  if (state.connection !== c) { state.connection = c; emit('connection'); }
}

// ---- fetch ----
export async function refetchAll() {
  const [t, s, g] = await Promise.all([
    supabase.from('ticks').select('key,value').eq('party', party),
    supabase.from('sessions').select('*').eq('party', party).order('session_date').order('created_at'),
    supabase.from('targets').select('*').eq('party', party).order('created_at'),
  ]);
  if (t.error || s.error || g.error) {
    setConnection('error');
    throw t.error || s.error || g.error;
  }
  state.ticks = new Map(t.data.map(r => [r.key, r.value]));
  state.sessions = s.data;
  state.targets = g.data;
  setConnection('live');
  emit('all');
}

// ---- writes (optimistic) ----
export async function setTick(key, value) {
  const prev = state.ticks.get(key);
  state.ticks.set(key, value);
  emit('ticks');
  const { error } = await supabase.from('ticks').upsert(
    { party, key, value, updated_at: new Date().toISOString() },
    { onConflict: 'party,key' }
  );
  if (error) {
    if (prev === undefined) state.ticks.delete(key); else state.ticks.set(key, prev);
    emit('ticks');
    toastError(error);
  }
}

export async function upsertSession(row) {
  const { error } = await supabase.from('sessions').upsert({ ...row, party }, { onConflict: 'id' });
  if (error) toastError(error); else await refetchAll();
}
export async function deleteSession(id) {
  const { error } = await supabase.from('sessions').delete().eq('id', id).eq('party', party);
  if (error) toastError(error); else await refetchAll();
}
export async function upsertTarget(row) {
  const { error } = await supabase.from('targets').upsert({ ...row, party }, { onConflict: 'id' });
  if (error) toastError(error); else await refetchAll();
}
export async function deleteTarget(id) {
  const { error } = await supabase.from('targets').delete().eq('id', id).eq('party', party);
  if (error) toastError(error); else await refetchAll();
}

let toastFn = null;
export function onToast(fn) { toastFn = fn; }
function toastError(err) {
  console.error(err);
  setConnection('error');
  if (toastFn) toastFn("Couldn't save — is the database napping? (free tier pauses after ~1 week idle; restore it in the Supabase dashboard)");
}

// ---- realtime ----
let channel = null;
let refetchTimer = null;
function debouncedRefetch() {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => refetchAll().catch(() => {}), 1500);
}

function handleEvent(table) {
  return (payload) => {
    if (payload.eventType === 'DELETE') {
      // DELETE events ignore filters and only carry PKs under RLS — treat as a refetch signal.
      debouncedRefetch();
      return;
    }
    const row = payload.new;
    if (!row || row.party !== party) return;
    if (table === 'ticks') {
      state.ticks.set(row.key, row.value);
      emit('ticks');
    } else {
      debouncedRefetch(); // simple + safe for sessions/targets
    }
  };
}

export function subscribe() {
  if (channel) supabase.removeChannel(channel);
  setConnection('reconnecting');
  channel = supabase.channel(`party-${party}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ticks', filter: `party=eq.${party}` }, handleEvent('ticks'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `party=eq.${party}` }, handleEvent('sessions'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'targets', filter: `party=eq.${party}` }, handleEvent('targets'))
    // DELETE events can't pass a party filter (old row only carries its PK under RLS),
    // so listen unfiltered for deletes and just refetch — deletes are rare.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ticks' }, debouncedRefetch)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessions' }, debouncedRefetch)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'targets' }, debouncedRefetch)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // fires on join AND every rejoin; missed events are not replayed, so always refetch
        refetchAll().catch(() => {});
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConnection('reconnecting');
      }
    });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refetchAll().catch(() => {});
  setTimeout(() => {
    // iOS kills websockets on lock; supabase-js usually auto-rejoins, but not always
    if (!channel || channel.state !== 'joined') subscribe();
  }, 2000);
});

// ---- seeding & reset ----
export async function ensureSeeded(content) {
  if (state.ticks.get('_seeded')) return;
  await seed(content);
}

// Deterministic per-party pseudo-UUID so seeding is idempotent for a party but
// two parties can never collide on the same primary key (FNV-1a over party+key).
function seedId(key) {
  const hex = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0xcafebabe].map((init, s) => {
    let x = init >>> 0;
    const str = `${party}:${key}:${s}`;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return (x >>> 0).toString(16).padStart(8, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function seed(content) {
  const now = new Date().toISOString();
  const tickRows = Object.entries(content.seed.ticks)
    .map(([key, value]) => ({ party, key, value, updated_at: now }));
  const sessionRows = content.seed.sessions.map(r => ({ ...r, id: seedId('session:' + r.id), party }));
  const targetRows = content.seed.targets.map(r => ({ ...r, id: seedId('target:' + r.id), party }));
  const r1 = await supabase.from('ticks').upsert(tickRows, { onConflict: 'party,key' });
  const r2 = await supabase.from('sessions').upsert(sessionRows, { onConflict: 'id' });
  const r3 = await supabase.from('targets').upsert(targetRows, { onConflict: 'id' });
  if (r1.error || r2.error || r3.error) { toastError(r1.error || r2.error || r3.error); return; }
  await supabase.from('ticks').upsert(
    { party, key: '_seeded', value: true, updated_at: now }, { onConflict: 'party,key' });
  await refetchAll();
}

export async function resetParty(content) {
  await Promise.all([
    supabase.from('ticks').delete().eq('party', party),
    supabase.from('sessions').delete().eq('party', party),
    supabase.from('targets').delete().eq('party', party),
  ]);
  await seed(content);
}

export function newId() {
  return crypto.randomUUID();
}
