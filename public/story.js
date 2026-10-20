// The Hush: pupil-side story screens (loaded before the inline script in index.html; uses its el, app, S, api, bar, mark).
// The server only sends the text of scenes a pupil has unlocked, and only when asked (POST /api/game/story).
const qon = () => !!(S && S.story && S.story.on);
const storyShown = new Set(); // scene ids already played this session, so a failed save can never replay them in a loop
let storyBusy = false;

// Quip, the lantern-sprite shaped like a pair of quotation marks.
const quipGlyph = () => el('span', 'quip', '“”');

async function storyFetch(seen) {
  const r = await api('/api/game/story', 'POST', { seen: seen || [] });
  if (S && r.story) S.story = { ...S.story, ...r.story }; // keep the brief fields fresh (pending, next, bars)
  return r.story;
}

// Story text keeps the game's colour code for speech marks, so reading the story is quiet punctuation practice.
const storyPara = (t) => { const p = el('p', 'sc-p'); p.append(mark(t)); return p; };

const voiceBars = (st) => {
  const w = el('div', 'sc-bars');
  const row = (label, pct, cls, note) => { const r = el('div'); r.append(el('div', 'm', label + ' · ' + pct + '%' + (note ? ' · ' + note : '')), bar(cls, pct)); return r; };
  w.append(row('🔔 Elder Wren’s voice', st.wren.pct, 't', st.wren.label), row('🏘️ Parley’s voices', st.parley.pct, 'v', st.parley.acts + ' of 10 acts'));
  return w;
};

function storyCard() {
  if (!qon()) return null;
  const st = S.story, c = el('div', 'card sc-card');
  c.id = 'storycard';
  const h = el('div', 'row');
  h.append(quipGlyph(), el('h3', 'grow', 'The Hush'));
  c.append(h, el('div', 'm', 'Voices restored'), voiceBars(st));
  if (st.pending.length) {
    const nb = el('button', 0, '✨ New story: read it now (' + st.pending.length + ')');
    nb.onclick = () => storyPlay(st.pending.map((p) => p.id), 'village');
    c.append(el('p', 'good', 'Something is waiting for you in the story.'), nb, ' ');
  }
  const bk = el('button', 'alt', '📖 The story so far...');
  bk.onclick = storyBook;
  c.append(bk);
  c.append(el('p', 'm', st.next || '✨ You have read every part so far. The story is not over, because a staircase leads below Floor 100.'));
  return c;
}
const storyRefresh = () => { const old = document.getElementById('storycard'); const n = storyCard(); if (old && n) old.replaceWith(n); };

function storyDialog(id) {
  const old = document.getElementById(id);
  if (old) old.remove();
  const d = el('dialog', 'sc');
  d.id = id;
  d.onclick = (e) => { if (e.target === d) d.close(); };
  d.onclose = () => { d.remove(); storyBusy = false; storyRefresh(); };
  document.body.append(d);
  return d;
}

const kindLabel = (s, ctx) => s.kind === 'calling' ? 'The Calling · Level ' + s.level : s.kind === 'reckoning' ? 'The Reckoning · Floor ' + s.floor + (ctx === 'village' ? ' · looking back' : '') : s.kind === 'epilogue' ? 'Epilogue' : 'Prologue';

// Plays the given scene ids, one at a time. ctx 'village' or 'end' only changes a label.
async function storyPlay(ids, ctx) {
  if (storyBusy || !qon()) return;
  storyBusy = true;
  let full;
  try { full = await storyFetch([]); } catch (e) { storyBusy = false; return; }
  const q = ids.map((id) => full.scenes.find((s) => s.id === id)).filter(Boolean);
  if (!q.length) { storyBusy = false; return; }
  q.forEach((s) => storyShown.add(s.id));
  const d = storyDialog('story'), body = el('div');
  let i = 0;
  const done = (seen) => storyFetch(seen).catch(() => {});
  const show = () => {
    const s = q[i], top = el('div', 'row'), foot = el('div', 'row');
    body.replaceChildren();
    const x = el('button', 'alt', 'Close');
    x.onclick = () => d.close();
    top.append(quipGlyph(), el('h2', 'grow', s.act ? 'Act ' + s.act + ': ' + s.actTitle : s.title), x);
    body.append(top, el('div', 'm sc-kind', s.act ? kindLabel(s, ctx) + (s.zone ? ' · ' + s.zone : '') : kindLabel(s, ctx)));
    const paras = el('div', 'sc-body');
    s.text.forEach((t) => paras.append(storyPara(t)));
    body.append(paras);
    if (s.objective) body.append(el('p', 'sc-obj', s.objective.done ? '✅ You have already cleared Floor ' + s.objective.floor + '.' : '🎯 Objective: reach Floor ' + s.objective.floor + '.'));
    const last = i === q.length - 1;
    const finish = () => { if (last) d.close(); else { i++; show(); } };
    if (s.choice) {
      // The finale: seal or mend. Sealing is answered by Quip, then the choice is offered again; both paths end with Mend.
      const pick = el('div', 'row'), seal = el('button', 'alt', '🔒 ' + s.choice.seal), mend = el('button', 0, '🎶 ' + s.choice.mend);
      mend.onclick = () => {
        pick.remove();
        s.after.forEach((t) => paras.append(storyPara(t)));
        done([s.id]);
        const nx = el('button', 0, last ? 'Close' : 'Next ▸');
        nx.onclick = finish;
        body.append(nx);
      };
      seal.onclick = () => { seal.disabled = true; paras.append(storyPara(s.choice.sealReply)); seal.textContent = '🔒 ' + s.choice.seal + ' (Quip says no)'; };
      pick.append(seal, mend);
      body.append(pick);
    } else {
      done([s.id]);
      const nx = el('button', 0, last ? (ctx === 'village' ? 'Back to the village' : 'Continue') : 'Next ▸');
      nx.onclick = finish;
      foot.append(nx);
      if (!last) {
        const sk = el('button', 'alt', 'Skip the rest');
        sk.title = 'You can read them again under “The story so far...”';
        sk.onclick = () => { done(q.slice(i).map((z) => z.id)); d.close(); };
        foot.append(sk);
      }
      foot.append(el('span', 'm', 'Part ' + (i + 1) + ' of ' + q.length));
      body.append(foot);
    }
  };
  d.append(body);
  show();
  d.showModal();
}

// The village plays whatever is pending, once per session. The victory screen plays only the act of the boss just beaten.
function storyAuto() {
  if (!qon() || storyBusy) return;
  const ids = S.story.pending.map((p) => p.id).filter((id) => !storyShown.has(id));
  if (ids.length) setTimeout(() => { if (!document.querySelector('dialog[open]')) storyPlay(ids, 'village'); }, 250);
}
function storyEnd(e, box) {
  if (!qon() || !e.stairs) return;
  const act = e.floor % 10 === 0 ? e.floor / 10 : 0;
  const ids = S.story.pending.filter((p) => act && p.act === act).map((p) => p.id).filter((id) => !storyShown.has(id));
  if (ids.length) setTimeout(() => storyPlay(ids, 'end'), 700);
  else if (act && S.story.next) box.append(el('p', 'm', '📖 ' + S.story.next));
  if (e.floor % 10 === 5) {
    const slot = el('div');
    box.append(slot);
    storyFetch([]).then((f) => {
      const n = (f.notes || []).find((z) => z.floor === e.floor);
      if (n) { const c = el('div', 'sc-note'); c.append(el('b', 0, '📝 Found on Floor ' + n.floor + ' · ' + n.boss), storyPara(n.text)); slot.append(c); }
    }).catch(() => {});
  }
}

// "The story so far...": every unlocked part, grouped by act, with the Voices restored bars on top.
async function storyBook() {
  if (storyBusy || !qon()) return;
  storyBusy = true;
  let f;
  try { f = await storyFetch([]); } catch (e) { storyBusy = false; return; }
  const d = storyDialog('storybook'), top = el('div', 'row'), x = el('button', 'alt', 'Close');
  x.onclick = () => d.close();
  top.append(quipGlyph(), el('h2', 'grow', 'The story so far...'), x);
  d.append(top, el('div', 'm', 'Voices restored'), voiceBars(f));
  const seen = new Set(f.seen || []), acts = [...new Set(f.scenes.map((s) => s.act))];
  acts.forEach((a, k) => {
    const ss = f.scenes.filter((s) => s.act === a), det = el('details', 'sc-act');
    det.open = k === acts.length - 1;
    const sum = el('summary', 0, a ? 'Act ' + a + ': ' + ss[0].actTitle : 'Prologue');
    det.append(sum);
    ss.forEach((s) => {
      const c = el('div', 'sc-scene');
      c.append(el('div', 'm sc-kind', kindLabel(s) + (seen.has(s.id) ? '' : ' · NEW')));
      s.text.forEach((t) => c.append(storyPara(t)));
      if (s.after) { c.append(el('p', 'm', 'You chose to mend the Chorus with every voice in Parley.')); s.after.forEach((t) => c.append(storyPara(t))); }
      det.append(c);
      // notes found on this act's mid-boss floor sit between its Calling and its Reckoning
      if (s.kind === 'calling') (f.notes || []).filter((n) => n.act === a).forEach((n) => { const nc = el('div', 'sc-note'); nc.append(el('b', 0, '📝 Found on Floor ' + n.floor + ' · ' + n.boss), storyPara(n.text)); det.append(nc); });
    });
    d.append(det);
  });
  if (f.done) d.append(el('p', 'm', '✨ You have read every part so far. The story is not over: a staircase leads below Floor 100, and a letter from another silent village is waiting.'));
  else d.append(el('p', 'sc-more', '🔒 Continue through the dungeon to unlock more.'), el('p', 'm', f.next || ''));
  d.showModal();
  // opening the book counts as having read anything that was still waiting
  if ((f.pending || []).length) storyFetch(f.scenes.filter((s) => !s.choice).map((s) => s.id)).catch(() => {}); // the finale is only read once the choice is made
}
