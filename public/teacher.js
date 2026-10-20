/* Dialogue Dungeon — teacher console. Plain JS. Server text is always inserted with textContent. */
(() => {
  'use strict';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const app = document.getElementById('app');
  const mem = {};
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
    del: (k) => { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
  };

  const S = {
    token: store.get('dd_ttoken') || '',
    tab: 'classes',
    meta: null,
    classes: [],
    guests: 0,
    selClass: null, // id
    sheet: false,
    qMode: 0,
    editQ: null,
    ana: { cls: '', days: 30, by: 'rule' },
    msg: '',
    pl: { cls: 'all', q: '', sel: null }, // pupil stats tab
    me: (() => { try { return JSON.parse(store.get('dd_tme') || 'null'); } catch { return null; } })(), // { role: 'admin' | 'teacher', name }
  };
  const isAdmin = () => !!S.me && S.me.role === 'admin';
  // forget everything tied to whoever was signed in (a different person may sign in next)
  const clearSession = () => {
    S.token = ''; S.me = null; S.classes = []; S.guests = 0; S.selClass = null; S.sheet = false; S.editQ = null; S.dx = null;
    S.ana = { cls: '', days: 30, by: 'rule' }; S.pl = { cls: 'all', q: '', sel: null }; S.tab = 'classes'; S.tpw = null;
    store.del('dd_ttoken');
    store.del('dd_tme');
  };

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/t' + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 401) {
      clearSession();
      render();
      throw new Error('Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Something went wrong (' + res.status + ').');
    return data;
  }

  const flash = (m, bad) => {
    const n = h('div', { class: 'notice' + (bad ? ' bad' : ''), role: 'status' }, m);
    const box = document.getElementById('flash');
    if (!box) return;
    box.replaceChildren(n);
    n.scrollIntoView({ block: 'nearest' });
  };
  const guard = (fn) => async (...a) => {
    try { await fn(...a); } catch (e) { flash(e.message, true); }
  };
  const tagLabel = (k) => (S.meta && S.meta.tags && S.meta.tags[k]) || k;
  const fmtTime = (t) => (t ? new Date(t).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const download = (name, text) => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  };

  // ---------- shell ----------
  function render() {
    if (!S.token) return app.replaceChildren(loginView());
    if (!S.me) {
      // a token was kept from before but not who it belongs to: ask the server, and say so if that fails
      const box = h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Loading…'));
      app.replaceChildren(box);
      api('/me').then((m) => { S.me = { role: m.role, name: m.name }; store.set('dd_tme', JSON.stringify(S.me)); render(); }, (e) => {
        if (!S.token) return; // a 401 already sent us to the sign-in page
        box.replaceChildren(
          h('div', { class: 'notice bad', role: 'alert' }, 'Could not load the teacher console: ' + e.message),
          h('p', null, h('button', { class: 'btn small', type: 'button', onclick: () => render() }, 'Try again'), ' ', h('button', { class: 'btn small alt', type: 'button', onclick: () => { clearSession(); render(); } }, 'Sign out')));
      });
      return;
    }
    const admin = isAdmin();
    const tabs = [['classes', 'Classes & pupils'], ['questions', 'Questions'], admin && ['verbs', 'Verb bank'], ['analytics', 'Analytics'], ['diagnosis', 'Diagnosis'], admin && ['game', 'Game balance'], ['feedback', 'Feedback'], ['players', 'Pupil stats'], admin && ['teachers', 'Teachers']].filter(Boolean);
    if (!tabs.some(([k]) => k === S.tab)) S.tab = 'classes';
    const body = h('div', { class: 'wrap' }, h('div', { id: 'flash', 'aria-live': 'polite' }), h('div', { id: 'tab' }));
    app.replaceChildren(
      h('header', { class: 'topbar no-print' },
        h('div', { class: 'brand' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Dialogue Dungeon · Teacher'),
        h('div', { class: 'row', style: 'align-items:center;gap:8px' },
          h('span', { class: 'small' }, S.me.name, ' ', h('span', { class: 'pill' }, admin ? 'Admin' : 'Teacher')),
          admin ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.tpw = !S.tpw; render(); } }, 'Change password'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => { clearSession(); render(); } }, 'Sign out'))),
      ...(S.tpw ? [passwordPanel()] : []),
      h('nav', { class: 'tabs no-print', 'aria-label': 'Sections' },
        tabs.map(([k, l]) => h('button', { class: 'tab', type: 'button', 'aria-current': S.tab === k ? 'page' : false, onclick: () => { S.tab = k; render(); } }, l))),
      body,
    );
    const view = { classes: classesView, questions: questionsView, verbs: verbsView, analytics: analyticsView, diagnosis: diagnosisView, game: gameView, feedback: feedbackView, players: playersView, teachers: teachersView }[S.tab];
    guard(async () => {
      if (!S.meta) S.meta = await (await fetch('/api/meta')).json();
      await view(document.getElementById('tab'));
    })();
  }

  function loginView() {
    const u = h('input', { type: 'text', id: 'tu', autocomplete: 'username', required: true });
    const p = h('input', { type: 'password', id: 'tp', autocomplete: 'current-password', required: true });
    const err = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
    return h('div', { class: 'wrap' },
      h('div', { class: 'auth' },
        h('div', { class: 'brand', style: 'margin:0 0 18px' }, h('span', { class: 'bubble-logo', 'aria-hidden': 'true' }, '“”'), 'Teacher sign-in'),
        h('form', { class: 'panel', onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          err.replaceChildren();
          try {
            const res = await fetch('/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u.value, password: p.value }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'Could not sign in.');
            clearSession();
            S.token = d.token;
            S.me = { role: d.role, name: d.name };
            store.set('dd_ttoken', d.token);
            store.set('dd_tme', JSON.stringify(S.me));
            render();
          } catch (x) {
            err.replaceChildren(h('div', { class: 'notice bad', role: 'alert' }, x.message));
            btn.disabled = false;
          }
        } },
          h('label', { class: 'field' }, h('span', null, 'Username'), u),
          h('label', { class: 'field' }, h('span', null, 'Password'), p),
          err, btn)));
  }

  // ---------- own password (teachers) ----------
  function passwordPanel() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Current password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8', 'aria-label': 'New password' });
    return h('section', { class: 'panel no-print' },
      h('h2', null, 'Change your password'),
      h('form', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center', onsubmit: guard(async (e) => {
        e.preventDefault();
        await api('/me/password', { method: 'POST', body: { current: cur.value, next: nw.value } });
        clearSession();
        render();
        alert('Password changed. Please sign in again with the new password.');
      }) }, cur, nw, h('button', { class: 'btn small', type: 'submit' }, 'Change password'), h('span', { class: 'muted small' }, 'At least 8 characters.')));
  }

  // ---------- teacher accounts (admin) ----------
  const randomPw = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => chars[b % chars.length]).join('');
  };
  async function teachersView(root) {
    const d = await api('/teachers');
    S.teachers = d.teachers;
    const nameIn = h('input', { type: 'text', maxlength: '60', placeholder: 'Name, e.g. Ms Tan', required: true, 'aria-label': 'Teacher name' });
    const userIn = h('input', { type: 'text', maxlength: '40', placeholder: 'Username, e.g. mstan', required: true, autocapitalize: 'none', 'aria-label': 'Teacher username' });
    const pwIn = h('input', { type: 'text', value: randomPw(), 'aria-label': 'Starting password', class: 'mono' });
    const shown = h('div', { 'aria-live': 'polite' });
    const showCreds = (title, username, password) => shown.replaceChildren(h('div', { class: 'notice' },
      h('strong', null, title), h('div', null, 'Username: ', h('code', null, username)), h('div', null, 'Password: ', h('code', null, password)),
      h('div', { class: 'small muted' }, 'Copy this now: the password is not shown again. Give it to the teacher, who can change it after signing in.')));
    const create = h('form', { class: 'row', style: 'gap:8px;flex-wrap:wrap;align-items:center', onsubmit: guard(async (e) => {
      e.preventDefault();
      const r = await api('/teachers', { method: 'POST', body: { name: nameIn.value, username: userIn.value, password: pwIn.value } });
      await teachersView(root);
      showCreds('Account created for ' + nameIn.value, r.username, r.password);
      document.getElementById('tshown').replaceChildren(...shown.childNodes);
    }) }, nameIn, userIn, pwIn, h('button', { class: 'btn small', type: 'submit' }, 'Create teacher'));
    const rows = d.teachers.map((t) => h('tr', null,
      h('td', null, t.name, t.active ? null : h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'switched off')),
      h('td', null, h('code', null, t.username)),
      h('td', null, t.classes), h('td', null, t.pupils), h('td', null, fmtTime(t.last_login)),
      h('td', null,
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          const n = prompt('Teacher name', t.name);
          if (n == null || !n.trim()) return;
          await api('/teachers/' + t.id, { method: 'PATCH', body: { name: n } });
          await teachersView(root);
        }) }, 'Rename'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (!confirm(`Make a new password for ${t.name}? They are signed out straight away.`)) return;
          const r = await api(`/teachers/${t.id}/password`, { method: 'POST', body: {} });
          await teachersView(root);
          showCreds('New password for ' + t.name, t.username, r.password);
          document.getElementById('tshown').replaceChildren(...shown.childNodes);
        }) }, 'New password'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (t.active && !confirm(`Switch off ${t.name}? They are signed out and can't sign in until you switch them back on. Their classes stay as they are.`)) return;
          await api('/teachers/' + t.id, { method: 'PATCH', body: { active: !t.active } });
          await teachersView(root);
        }) }, t.active ? 'Switch off' : 'Switch on'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          if (!confirm(`Delete ${t.name}'s account? Their ${t.classes} class${t.classes === 1 ? '' : 'es'} and pupils are kept and go back to you (the admin).`)) return;
          await api('/teachers/' + t.id, { method: 'DELETE' });
          await teachersView(root);
        }) }, 'Delete'))));
    root.replaceChildren(
      h('section', { class: 'panel' },
        h('h2', null, 'Teacher accounts'),
        h('p', { class: 'muted small' }, 'Each teacher signs in with their own username and password at the teacher sign-in page. They create and manage their own classes, pupils, questions for their classes, analytics, diagnosis and feedback, and see nobody else’s. Verb bank and Game balance stay with you. You (the admin) see everything and can move a class from one teacher to another in Classes & pupils.'),
        d.teachers.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Teacher', 'Username', 'Classes', 'Pupils', 'Last sign-in', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
          : h('p', { class: 'muted' }, 'No teacher accounts yet. Add one below.'),
        d.unowned ? h('p', { class: 'muted small' }, `${d.unowned} class${d.unowned === 1 ? ' is' : 'es are'} owned by you (the admin).`) : null),
      h('section', { class: 'panel' }, h('h2', null, 'Add a teacher'),
        h('p', { class: 'muted small' }, 'A starting password is suggested; you can type your own (8 or more characters).'),
        create, h('div', { id: 'tshown', style: 'margin-top:10px' })));
  }

  // ---------- classes & pupils ----------
  async function classesView(root) {
    const d = await api('/classes');
    S.classes = d.classes;
    S.guests = d.guests;
    const nameIn = h('input', { type: 'text', maxlength: '60', placeholder: 'e.g. 5 Integrity', 'aria-label': 'New class name' });
    if (isAdmin() && !S.teachers) S.teachers = (await api('/teachers')).teachers;
    const ownerIn = isAdmin() ? h('select', { 'aria-label': 'Owner of the new class' }, h('option', { value: '' }, 'Owner: Admin'), (S.teachers || []).filter((t) => t.active).map((t) => h('option', { value: String(t.id) }, 'Owner: ' + t.name))) : null;
    const create = h('form', { class: 'row', onsubmit: guard(async (e) => {
      e.preventDefault();
      const r = await api('/classes', { method: 'POST', body: { name: nameIn.value, teacher_id: ownerIn && ownerIn.value ? +ownerIn.value : null } });
      S.selClass = r.class.id;
      S.sheet = false;
      render();
    }) }, nameIn, ownerIn, h('button', { class: 'btn small', type: 'submit' }, 'Create class'));

    const rows = S.classes.map((c) => h('tr', { class: c.id === S.selClass ? 'sel' : '' },
      h('td', null, c.name, c.archived ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'archived') : null),
      h('td', null, h('span', { style: 'font-family:var(--display);letter-spacing:.15em;font-weight:700' }, c.code)),
      isAdmin() ? h('td', null, c.teacher_name || h('span', { class: 'muted small' }, 'Admin')) : null,
      h('td', null, c.pupils),
      h('td', null, h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.selClass = c.id; S.sheet = false; render(); } }, 'Open'))));

    root.replaceChildren(
      h('section', { class: 'panel' },
        h('h2', null, 'Classes'),
        S.classes.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Class', 'Class code', isAdmin() ? 'Owner' : null, 'Pupils', ''].filter((t) => t !== null).map((t) => h('th', null, t)))), h('tbody', null, rows)))
          : h('p', { class: 'muted' }, 'No classes yet. Create one, then add pupils.'),
        isAdmin() ? h('p', { class: 'muted small' }, 'Guest players (not in any class): ' + S.guests + '. Guest accounts are deleted automatically after 30 days.') : null,
        create),
      h('div', { id: 'cdetail' }));
    if (S.selClass && S.classes.some((c) => c.id === S.selClass)) await classDetail(document.getElementById('cdetail'));
  }

  async function classDetail(root) {
    const c = S.classes.find((x) => x.id === S.selClass);
    const pd = await api(`/classes/${c.id}/pupils`);
    const signOut = h('input', { type: 'checkbox', id: 'so', checked: true });
    const codeBox = h('span', { class: 'code-big', 'aria-label': 'Class code ' + c.code.split('').join(' ') }, c.code);

    const head = h('section', { class: 'panel sel' },
      h('div', { class: 'row', style: 'align-items:center;gap:14px;flex-wrap:wrap' },
        h('h2', { class: 'grow', style: 'margin:0' }, c.name),
        codeBox),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center' },
        h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
          const msg = signOut.checked ? 'Make a new code and sign everyone in this class out?' : 'Make a new code? Pupils already signed in stay signed in.';
          if (!confirm(msg)) return;
          const r = await api(`/classes/${c.id}/regen`, { method: 'POST', body: { signOut: signOut.checked } });
          c.code = r.code;
          await classesView(document.getElementById('tab'));
          flash('New class code: ' + r.code + (r.signedOut ? ' (everyone was signed out).' : '.'));
        }) }, 'New class code'),
        h('label', { class: 'small' }, signOut, ' also sign everyone out'),
        isAdmin() ? h('label', { class: 'small' }, 'Owner ', (() => {
          const o = h('select', { 'aria-label': 'Class owner' }, h('option', { value: '' }, 'Admin'), (S.teachers || []).filter((t) => t.active || t.id === c.teacher_id).map((t) => h('option', { value: String(t.id), selected: t.id === c.teacher_id }, t.name)));
          o.addEventListener('change', guard(async () => { await api(`/classes/${c.id}`, { method: 'PATCH', body: { teacher_id: o.value ? +o.value : null } }); await classesView(document.getElementById('tab')); flash('Owner changed.'); }));
          return o;
        })()) : null,
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          const n = prompt('Rename class', c.name);
          if (n == null || !n.trim()) return;
          await api(`/classes/${c.id}`, { method: 'PATCH', body: { name: n } });
          render();
        }) }, 'Rename'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (!c.archived && !confirm('Archive this class? Its pupils are signed out and can’t sign in until you restore it.')) return;
          await api(`/classes/${c.id}`, { method: 'PATCH', body: { archived: !c.archived } });
          render();
        }) }, c.archived ? 'Restore' : 'Archive'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          const t = prompt(`This permanently deletes the class, its ${pd.pupils.length} pupils and all their results.\nType the class name to confirm:`);
          if (t !== c.name) return t == null ? null : flash('The name didn’t match, so nothing was deleted.', true);
          await api(`/classes/${c.id}`, { method: 'DELETE' });
          S.selClass = null;
          render();
        }) }, 'Delete class')));

    // add pupils
    const ta = h('textarea', { class: 'mono', rows: '6', 'aria-label': 'Pupils to add', placeholder: 'One pupil per line.\nRaj Tan\nMei Lin, mei.l\n(or paste two columns from a spreadsheet: name, username)' });
    const pv = h('div');
    let rowsPv = [];
    const showPv = (list) => {
      rowsPv = list;
      const good = list.filter((r) => r.status === 'ok');
      pv.replaceChildren(
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Name', 'Username', ''].map((t) => h('th', null, t)))),
          h('tbody', null, list.map((r) => h('tr', null, h('td', null, r.name), h('td', null, r.username),
            h('td', null, h('span', { class: 'pill ' + (r.status === 'ok' ? 'ok' : 'bad') }, r.status === 'ok' ? 'ok' : r.status === 'duplicate' ? 'username taken' : 'invalid username'))))))),
        good.length ? h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
          const r = await api(`/classes/${c.id}/pupils`, { method: 'POST', body: { pupils: good } });
          ta.value = '';
          await classesView(document.getElementById('tab'));
          flash(`Added ${r.added} pupil${r.added === 1 ? '' : 's'}.` + (r.skipped.length ? ` Skipped ${r.skipped.length}.` : ''));
        }) }, `Add ${good.length} pupil${good.length === 1 ? '' : 's'}`) : h('p', { class: 'muted small' }, 'Nothing valid to add yet. Fix the flagged lines and preview again.'));
    };
    const adder = h('section', { class: 'panel' },
      h('h2', null, 'Add pupils'),
      h('p', { class: 'muted small' }, 'Usernames you leave blank are made from the name (e.g. Raj Tan → rajt). Pupils sign in with their username and the class code. Use first names or nicknames rather than full names where you can.'),
      ta,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
        if (!ta.value.trim()) return flash('Paste some names first.', true);
        showPv((await api(`/classes/${c.id}/pupils/preview`, { method: 'POST', body: { text: ta.value } })).rows);
      }) }, 'Preview')),
      pv);

    // pupils table
    const prow = (p) => h('tr', null,
      h('td', null, p.name), h('td', null, h('code', null, p.username)), h('td', null, p.attempts), h('td', null, p.xp), h('td', null, fmtTime(p.last_active)),
      h('td', null,
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          const n = prompt('Name', p.name);
          if (n == null) return;
          const u = prompt('Username', p.username);
          if (u == null) return;
          await api(`/pupils/${p.id}`, { method: 'PATCH', body: { name: n, username: u } });
          await classesView(document.getElementById('tab'));
        }) }, 'Edit'),
        h('button', { class: 'btn small alt', type: 'button', onclick: guard(async () => {
          if (!confirm(`Erase all of ${p.name}'s results? The account stays.`)) return;
          await api(`/pupils/${p.id}/reset`, { method: 'POST' });
          await classesView(document.getElementById('tab'));
        }) }, 'Reset'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          if (!confirm(`Delete ${p.name} and all their results?`)) return;
          await api(`/pupils/${p.id}`, { method: 'DELETE' });
          await classesView(document.getElementById('tab'));
        }) }, 'Delete')));
    const list = h('section', { class: 'panel' },
      h('div', { class: 'row no-print', style: 'align-items:center;flex-wrap:wrap;gap:8px' },
        h('h2', { class: 'grow', style: 'margin:0' }, `Pupils (${pd.pupils.length})`),
        pd.pupils.length ? h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.sheet = !S.sheet; render(); } }, S.sheet ? 'Hide sign-in cards' : 'Sign-in cards') : null),
      pd.pupils.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Name', 'Username', 'Answers', 'XP', 'Last active', ''].map((t) => h('th', null, t)))),
        h('tbody', null, pd.pupils.map(prow)))) : h('p', { class: 'muted' }, 'No pupils yet.'));

    const nodes = [head, adder, list];
    if (S.sheet) {
      nodes.push(h('section', { class: 'panel' },
        h('div', { class: 'row no-print', style: 'align-items:center;gap:10px' },
          h('h2', { class: 'grow', style: 'margin:0' }, 'Sign-in cards'),
          h('button', { class: 'btn small', type: 'button', onclick: () => window.print() }, 'Print')),
        h('p', { class: 'muted small no-print' }, 'Cut along the dashed lines. Share the class code only with this class.'),
        h('div', { class: 'sheet' }, pd.pupils.map((p) => h('div', { class: 'sheet-card' },
          h('div', null, c.name), h('div', null, 'Name: ', h('b', null, p.name)), h('div', null, 'Username: ', h('b', null, p.username)),
          h('div', null, 'Class code: ', h('b', null, c.code)), h('div', { class: 'small' }, location.origin))))));
    }
    root.replaceChildren(...nodes);
  }

  // ---------- questions ----------
  const MODE_NAME = { 1: 'Mode 1 · Rewrite it', 2: 'Mode 2 · Spot the error', 3: 'Mode 3 · Upgrade the tag', 4: 'Mode 4 · Multiple choice', 5: 'Mode 5 · Say it another way', 6: 'Mode 6 · Tap the tense slip' };
  const skillName = (id) => (id ? ((S.meta && S.meta.skills && S.meta.skills[id]) || {}).n || id : 'Ordinary pool');

  async function questionsView(root) {
    const [qs, cls] = await Promise.all([api('/questions' + (S.qMode ? '?mode=' + S.qMode : '')), api('/classes')]);
    S.classes = cls.classes;
    const qText = (q) => (q.mode === 1 ? (q.data.lines ? '↵ ' : q.data.beat ? '✋ ' : '') + q.data.prompt : q.mode === 2 ? q.data.faulty : q.mode === 3 ? `“${q.data.line}” ____ ${q.data.speaker}` : q.mode === 4 ? (q.data.passage ? q.data.passage.split('\n')[0] + ' … ' : '') + q.data.stem : q.mode === 5 ? q.data.prompt : q.data.sentence);
    const floors = (q) => (q.min_floor || q.max_floor ? `floors ${q.min_floor || 1}–${q.max_floor || 100}` : '');
    const filter = h('div', { class: 'seg no-print', role: 'group', 'aria-label': 'Filter by mode' },
      [[0, 'All'], [1, 'Mode 1'], [2, 'Mode 2'], [3, 'Mode 3'], [4, 'Mode 4'], [5, 'Mode 5'], [6, 'Mode 6']].map(([m, l]) => h('button', { type: 'button', 'aria-pressed': String(S.qMode === m), onclick: () => { S.qMode = m; render(); } }, l)));
    const editable = (q) => isAdmin() || (q.class_id != null && S.classes.some((c) => c.id === q.class_id));
    const rows = qs.questions.map((q) => h('tr', null,
      h('td', null, 'M' + q.mode),
      h('td', { style: 'max-width:420px;white-space:pre-wrap' }, qText(q), q.skill ? h('div', { class: 'muted small' }, skillName(q.skill) + (floors(q) ? ' · ' + floors(q) : '')) : (floors(q) ? h('div', { class: 'muted small' }, floors(q)) : null)),
      h('td', null, q.class_name ? h('span', { class: 'pill' }, q.class_name) : h('span', { class: 'muted small' }, 'all')),
      h('td', null, q.tries ? Math.round((100 * q.right) / q.tries) + '% of ' + q.tries : '—'),
      !editable(q) ? h('td', null, h('span', { class: 'muted small' }, 'shared (read only)')) : h('td', null,
        h('button', { class: 'btn small alt', type: 'button', onclick: () => { S.editQ = q; render(); } }, 'Edit'),
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
          if (!confirm('Remove this question? Past results stay in the analytics.')) return;
          await api('/questions/' + q.id, { method: 'DELETE' });
          render();
        }) }, 'Remove'))));
    root.replaceChildren(
      questionForm(),
      importPanel(),
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:10px' }, h('h2', { class: 'grow', style: 'margin:0' }, `Question bank (${qs.questions.length})`), filter),
        h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Question', 'Visible to', 'First-try correct', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))));
  }

  function classSelect(val) {
    return h('select', { 'aria-label': 'Who sees this question' }, isAdmin() ? h('option', { value: '' }, 'Every class and guests') : null,
      S.classes.filter((c) => !c.archived).map((c) => h('option', { value: String(c.id), selected: val === c.id }, 'Only ' + c.name)));
  }

  function questionForm() {
    const edit = S.editQ;
    const mode0 = edit ? edit.mode : 1;
    const modeSel = h('select', { 'aria-label': 'Question type', disabled: !!edit }, [1, 2, 3, 4, 5, 6].map((m) => h('option', { value: m, selected: m === mode0 }, MODE_NAME[m])));
    const holder = h('div', { class: 'grid-form' });
    const out = h('div', { class: 'pv', 'aria-live': 'polite' }, 'The preview appears here.');
    const scope = classSelect(edit ? edit.class_id : null);
    const f = {}; // field elements
    const d = edit ? edit.data : {};
    const skills = (S.meta && S.meta.skills) || {};
    const skillSel = h('select', { 'aria-label': 'Skill' });
    const minF = h('input', { type: 'number', min: '1', max: '100', 'aria-label': 'First floor', style: 'width:5em', value: edit && edit.min_floor ? edit.min_floor : '' });
    const maxF = h('input', { type: 'number', min: '1', max: '100', 'aria-label': 'Last floor', style: 'width:5em', value: edit && edit.max_floor ? edit.max_floor : '' });
    const fillSkills = () => {
      const m = +modeSel.value, cur = skillSel.value || (edit ? edit.skill || '' : '');
      skillSel.replaceChildren(h('option', { value: '' }, m >= 4 ? 'Choose a skill…' : 'Ordinary pool (any floor)'),
        Object.entries(skills).filter(([, s]) => s.modes.includes(m)).map(([id, s]) => h('option', { value: id, selected: id === cur }, `${s.n} (floors ${s.min}–${s.max})`)));
      if (m >= 4 && !skillSel.value) skillSel.selectedIndex = skillSel.options.length > 1 ? 1 : 0;
    };
    const mk = (name, label, el, hint) => { f[name] = el; return h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null); };
    const ck = (name, label, on) => h('label', { class: 'small' }, (f[name] = h('input', { type: 'checkbox', checked: on ? true : null })), ' ' + label);
    let timer;
    const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const payload = () => {
      const m = +modeSel.value;
      if (m === 1) return { correct: f.correct.value, prompt: f.prompt.value, alts: f.alts.value.split('\n').filter((x) => x.trim()), lines: f.lines.checked, beat: f.beat.checked, instruction: f.instruction.value, group: f.group.value };
      if (m === 2) return { correct: f.correct.value, faulty: f.faulty.value };
      if (m === 4) return { stem: f.stem.value, context: f.context.value, passage: f.passage.value, options: lines(f.options.value), correct: f.key.value, pick: f.pick.value, explanation: f.explanation.value, group: f.group.value };
      if (m === 5) return { prompt: f.prompt.value, instruction: f.instruction.value, kind: f.kind.value, accepted: lines(f.accepted.value), traps: lines(f.traps.value).map((l) => { const [w, c] = l.split('=>'); return { words: (w || '').split(',').map((x) => x.trim()).filter(Boolean), code: (c || '').trim() }; }), group: f.group.value };
      if (m === 6) return { sentence: f.sentence.value, wrong: f.wrong.value.split(',').map((x) => x.trim()).filter(Boolean), fixes: f.fixes.value.split(',').map((x) => x.trim()).filter(Boolean), instruction: f.instruction.value, group: f.group.value };
      return { speaker: f.speaker.value, line: f.line.value, context: f.context.value, target: [...holder.querySelectorAll('.tagpick input:checked')].map((i) => i.value) };
    };
    const body = () => ({ mode: +modeSel.value, data: payload(), lowerFirst: lower(), skill: skillSel.value, min_floor: minF.value, max_floor: maxF.value, class_id: scope.value ? +scope.value : null });
    const lower = () => (f.lower ? f.lower.checked : false);
    const li = (items) => h('ul', null, items.map((x) => h('li', null, x)));
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(guard(async () => {
        const m = +modeSel.value;
        const r = await api('/questions/preview', { method: 'POST', body: body() });
        if (!r.ok) return out.replaceChildren(h('b', { style: 'color:var(--bad)' }, r.problem));
        const p = r.preview;
        if (m === 1) out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.prompt), h('div', { style: 'white-space:pre-wrap' }, h('b', null, 'Model answer: '), p.answer), p.lines ? h('div', { class: 'muted small' }, 'Line breaks are marked: one speaker per line.') : null, p.beat ? h('div', { class: 'muted small' }, 'Action beat: a comma instead of the full stop gets its own feedback.') : null);
        else if (m === 2) out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.faulty), h('div', null, h('b', null, 'Corrected: '), p.correct), h('b', null, `${p.mistakes.length} mistake spot${p.mistakes.length === 1 ? '' : 's'} (worked out automatically):`), h('ul', null, p.mistakes.map((x) => h('li', null, x.summary))));
        else if (m === 4) out.replaceChildren(p.context ? h('div', { class: 'muted' }, p.context) : null, p.passage ? h('blockquote', { style: 'white-space:pre-wrap' }, p.passage) : null, h('div', null, h('b', null, p.stem)), h('div', { class: 'muted small' }, p.pick > 1 ? `Pupils choose ${p.pick}; any ${p.pick} of the ticked options is correct.` : 'Pupils choose one.'), h('ul', { style: 'list-style:none;padding-left:0' }, p.options.map((o) => h('li', null, (o.correct ? '✔ ' : '✗ ') + o.label + '. ' + o.text))), h('div', null, h('b', null, 'After answering: '), p.explanation));
        else if (m === 5) out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.prompt), h('div', { class: 'muted' }, p.instruction), h('div', null, h('b', null, 'Model answer: '), p.model), h('b', null, `${p.accepted.length} accepted wording${p.accepted.length === 1 ? '' : 's'} (case, spacing, trailing punctuation and I’ll = I will are ignored):`), li(p.accepted));
        else if (m === 6) out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.sentence), h('div', null, h('b', null, 'Wrong word(s): '), p.wrong.join(', ')), h('div', null, h('b', null, 'Accepted fixes: '), p.fixes.join(', ')), h('div', null, h('b', null, 'Corrected: '), p.corrected));
        else out.replaceChildren(h('div', null, h('b', null, 'Pupils see: '), p.sentence));
      }), 350);
    };
    const m1 = () => [
      mk('correct', 'Correct sentence', h('textarea', { rows: '2', value: d.correct || '' }), 'Type it correctly with “curly” or "straight" quotes. The prompt is made by stripping the punctuation. For a one-speaker-per-line question, put each speaker on their own line.'),
      mk('prompt', 'Prompt shown to pupils (optional)', h('textarea', { rows: '2', value: d.prompt || '' }), 'Leave blank to make it automatically.'),
      mk('alts', 'Other acceptable answers (one per line, optional)', h('textarea', { rows: '2', value: (d.alts || []).join('\n') }), 'e.g. the version with the saying words first.'),
      h('label', { class: 'small' }, (f.lower = h('input', { type: 'checkbox' })), ' lowercase the first spoken word in the prompt'),
      ck('lines', 'Line breaks matter: each speaker on their own line (skill: New speaker, new line)', d.lines),
      ck('beat', 'Action beat + speech tag: a full stop, not a comma, before the speech (skill: Action beat)', d.beat),
      mk('instruction', 'Instruction shown above the prompt (optional)', h('input', { type: 'text', maxlength: '200', value: d.instruction || '' })),
      mk('group', 'Group id (optional)', h('input', { type: 'text', maxlength: '40', value: d.group || '' }), 'Questions with the same group id are served back to back.'),
    ];
    const m2 = () => [
      mk('correct', 'Correct version (use a new line for each line of dialogue)', h('textarea', { rows: '3', value: d.correct || '' })),
      mk('faulty', 'Version with mistakes', h('textarea', { rows: '3', value: d.faulty || '' }), 'Break only punctuation, capitals and speech marks. Keep the words the same.'),
    ];
    const m3 = () => [
      mk('speaker', 'Speaker', h('input', { type: 'text', maxlength: '40', value: d.speaker || '' })),
      mk('line', 'What they say (ending in , ! or ?)', h('input', { type: 'text', maxlength: '200', value: d.line || '' })),
      mk('context', 'Situation (optional)', h('input', { type: 'text', maxlength: '300', value: d.context || '' })),
      h('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0' }, h('legend', { class: 'small' }, 'The verb must show…'),
        h('div', { class: 'tagpick' }, Object.entries((S.meta && S.meta.tags) || {}).map(([k, l]) => h('label', null, h('input', { type: 'checkbox', value: k, checked: (d.target || []).includes(k) }), l)))),
    ];
    const m4 = () => [
      mk('context', 'Situation (optional, one line)', h('input', { type: 'text', maxlength: '300', value: d.context || '' })),
      mk('passage', 'Passage (optional; shown above the question)', h('textarea', { rows: '4', value: d.passage || '' }), 'Questions about the same passage: paste it in each and give them the same group id.'),
      mk('stem', 'Question', h('textarea', { rows: '2', value: d.stem || '' })),
      mk('options', 'Options (one per line, 2 to 6, shown in this order)', h('textarea', { rows: '5', value: (d.options || []).map((o) => o.text).join('\n') }), 'Write plausible wrong options: wrong in volume, feeling or purpose.'),
      mk('key', 'Correct option numbers', h('input', { type: 'text', maxlength: '20', value: (d.correct || []).map((id) => id.charCodeAt(0) - 96).join(', ') }), 'e.g. 2   or   1, 2, 3, 4 when several options are valid.'),
      mk('pick', 'How many options do pupils choose?', h('input', { type: 'number', min: '1', max: '5', style: 'width:5em', value: d.pick || 1 }), 'With “choose 2” and four valid options, any two valid options are correct.'),
      mk('explanation', 'Explanation (shown after answering)', h('textarea', { rows: '2', value: d.explanation || '' })),
      mk('group', 'Group id (optional)', h('input', { type: 'text', maxlength: '40', value: d.group || '' }), 'Questions with the same group id are served back to back.'),
    ];
    const m5 = () => [
      mk('prompt', 'Sentence pupils rewrite', h('textarea', { rows: '2', value: d.prompt || '' })),
      mk('instruction', 'Instruction', h('input', { type: 'text', maxlength: '200', value: d.instruction || '' }), 'e.g. Rewrite as reported speech.'),
      mk('kind', 'Pupils write…', h('select', null, h('option', { value: 'reported', selected: d.kind !== 'direct' }, 'reported speech'), h('option', { value: 'direct', selected: d.kind === 'direct' }, 'direct speech'))),
      mk('accepted', 'Accepted answers (one per line)', h('textarea', { rows: '4', value: (d.accepted || []).join('\n') }), 'Words in (brackets) are optional, e.g. Brisk said (that) she was going. Case, spacing, quote style and final punctuation are ignored.'),
      mk('traps', 'Common mistakes (optional, one per line)', h('textarea', { rows: '3', value: (d.traps || []).map((t) => t.words.join(', ') + ' => ' + t.code).join('\n') }), 'words that give it away => feedback code, e.g.  i, my => RS_PRONOUN   or   would => DS_TENSE. Codes: RS_PRONOUN RS_TENSE RS_TIME RS_QUOTES DS_PRONOUN DS_TENSE DS_TIME'),
      mk('group', 'Group id (optional)', h('input', { type: 'text', maxlength: '40', value: d.group || '' })),
    ];
    const m6 = () => [
      mk('sentence', 'Sentence with the tense slip', h('textarea', { rows: '2', value: d.sentence || '' })),
      mk('wrong', 'The wrong word(s), comma separated', h('input', { type: 'text', maxlength: '120', value: (d.wrong || []).join(', ') }), 'Tapping any word on this list counts.'),
      mk('fixes', 'Accepted corrections, comma separated', h('input', { type: 'text', maxlength: '200', value: (d.fixes || []).join(', ') })),
      mk('instruction', 'Instruction (optional)', h('input', { type: 'text', maxlength: '200', value: d.instruction || '' })),
      mk('group', 'Group id (optional)', h('input', { type: 'text', maxlength: '40', value: d.group || '' })),
    ];
    const build = () => {
      holder.replaceChildren(...({ 1: m1, 2: m2, 3: m3, 4: m4, 5: m5, 6: m6 }[+modeSel.value])());
      holder.addEventListener('input', refresh);
      holder.addEventListener('change', refresh);
      fillSkills();
      refresh();
    };
    modeSel.addEventListener('change', () => { S.editQ = null; skillSel.value = ''; build(); });
    skillSel.addEventListener('change', refresh);
    minF.addEventListener('input', refresh);
    maxF.addEventListener('input', refresh);
    build();
    return h('section', { class: 'panel' },
      h('h2', null, edit ? 'Edit question' : 'Add a question'),
      h('div', { class: 'two' },
        h('div', { class: 'grid-form' }, modeSel, holder,
          h('label', { class: 'field' }, h('span', null, 'Skill'), skillSel, h('small', { class: 'muted' }, 'A skill question only appears on floors inside its skill’s range (Game balance). Modes 4–6 always need a skill.')),
          h('label', { class: 'field' }, h('span', null, 'Only on floors (optional)'), h('div', { class: 'row' }, 'from ', minF, ' to ', maxF), h('small', { class: 'muted' }, 'Narrows where this one question can appear. Leave blank to follow the skill (or any floor).')),
          scope,
          h('div', { class: 'row', style: 'gap:8px' },
            h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
              if (edit) await api('/questions/' + edit.id, { method: 'PUT', body: body() });
              else await api('/questions', { method: 'POST', body: body() });
              S.editQ = null;
              await questionsView(document.getElementById('tab'));
              flash(edit ? 'Question updated.' : 'Question added.');
            }) }, edit ? 'Save changes' : 'Add question'),
            edit ? h('button', { class: 'btn alt', type: 'button', onclick: () => { S.editQ = null; render(); } }, 'Cancel') : null)),
        out));
  }

  function importPanel() {
    const mode = h('select', { 'aria-label': 'Import type' }, [1, 2, 3].map((m) => h('option', { value: m }, MODE_NAME[m])));
    const ta = h('textarea', { class: 'mono', rows: '5', 'aria-label': 'Questions to import' });
    const help = h('p', { class: 'muted small' });
    const sets = {
      1: 'One correct sentence per line.',
      2: 'One question per line: correct version | faulty version. Use \\n for a new line inside either part.',
      3: 'One question per line: speaker | line | tag,tag | situation (optional).',
    };
    const upd = () => { help.textContent = sets[mode.value]; };
    mode.addEventListener('change', upd);
    upd();
    const res = h('div', { 'aria-live': 'polite' });
    return h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Import many questions'), mode, help, ta,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        const m = +mode.value;
        const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
        const rows = lines.map((l) => {
          if (m === 1) return { correct: l };
          const p = l.split('|').map((s) => s.trim().replace(/\\n/g, '\n'));
          if (m === 2) return { correct: p[0], faulty: p[1] };
          return { speaker: p[0], line: p[1], target: (p[2] || '').split(/[,;\s]+/).filter(Boolean), context: p[3] || '' };
        });
        const r = await api('/questions/import', { method: 'POST', body: { mode: m, rows } });
        res.replaceChildren(h('p', null, `Added ${r.added}.`), r.problems.length ? h('ul', null, r.problems.map((p) => h('li', null, `Line ${p.row}: ${p.problem}`))) : null);
        if (r.added) { ta.value = ''; await questionsView(document.getElementById('tab')); flash(`Added ${r.added} question${r.added === 1 ? '' : 's'}.` + (r.problems.length ? ` ${r.problems.length} line(s) had problems.` : '')); }
      }) }, 'Import')), res);
  }

  // ---------- verb bank ----------
  async function verbsView(root) {
    const [d, rv] = await Promise.all([api('/verbs'), api('/verbs/review')]);
    const q = h('input', { type: 'search', placeholder: 'Filter verbs…', 'aria-label': 'Filter verbs' });
    const tagKeys = Object.keys(d.tags || S.meta.tags);
    const tagBoxes = (sel) => h('div', { class: 'tagpick' }, tagKeys.map((k) => h('label', null, h('input', { type: 'checkbox', value: k, checked: sel.includes(k) }), (S.meta.tags[k] || k))));
    const picked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);

    // review queue
    const review = h('section', { class: 'panel' }, h('h2', null, `Words the AI has judged (${rv.items.length})`),
      h('p', { class: 'muted small' }, 'When a pupil types a verb that isn’t in your bank, the AI judges it once (≥ 80% confidence to accept). Approve to add it to your bank permanently, or reject to block it. Words the AI rejected are listed below.'),
      rv.items.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Word', 'Confidence', 'Tags', 'AI’s reason', ''].map((t) => h('th', null, t)))), h('tbody', null, rv.items.map((it) => {
        const box = tagBoxes(it.tags || []);
        return h('tr', null, h('td', null, h('b', null, it.word), h('div', { class: 'small muted' }, it.status === 'pending' ? 'waiting' : 'accepted by AI')), h('td', null, it.conf != null ? Math.round(it.conf * 100) + '%' : '—'),
          h('td', null, box), h('td', { style: 'max-width:260px' }, it.reason || ''),
          h('td', null,
            h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api(`/verbs/review/${encodeURIComponent(it.word)}/approve`, { method: 'POST', body: { tags: picked(box) } }); await verbsView(document.getElementById('tab')); }) }, 'Approve'),
            h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { await api(`/verbs/review/${encodeURIComponent(it.word)}/reject`, { method: 'POST', body: {} }); await verbsView(document.getElementById('tab')); }) }, 'Reject')));
      })))) : h('p', { class: 'muted' }, 'Nothing waiting.'),
      rv.rejected.length ? h('details', null, h('summary', { style: 'cursor:pointer' }, `Recently rejected (${rv.rejected.length})`),
        h('ul', null, rv.rejected.map((r) => h('li', null, h('b', null, r.word), ' — ', r.reason || '', ' ', h('button', { class: 'btn small ghost', type: 'button', onclick: guard(async () => { await api(`/verbs/review/${encodeURIComponent(r.word)}/reset`, { method: 'POST', body: {} }); await verbsView(document.getElementById('tab')); }) }, 'Let the AI re-judge'))))) : null);

    // add one
    const b = h('input', { type: 'text', maxlength: '24', placeholder: 'whisper', 'aria-label': 'Base form' });
    const p = h('input', { type: 'text', maxlength: '24', placeholder: 'whispered (blank = add -ed)', 'aria-label': 'Past tense' });
    const addTags = tagBoxes([]);
    const ban = h('input', { type: 'checkbox' });
    const add = h('section', { class: 'panel' }, h('h2', null, 'Add a verb'),
      h('div', { class: 'two' }, h('div', { class: 'grid-form' }, h('label', { class: 'field' }, h('span', null, 'Base form'), b), h('label', { class: 'field' }, h('span', null, 'Past tense'), p),
        h('label', { class: 'small' }, ban, ' Not allowed (e.g. said, asked)')),
        h('div', null, h('p', { class: 'small', style: 'margin-top:0' }, 'What does it show?'), addTags)),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        await api('/verbs', { method: 'POST', body: { base: b.value, past: p.value, tags: picked(addTags), banned: ban.checked } });
        await verbsView(document.getElementById('tab'));
        flash('Verb saved.');
      }) }, 'Save verb')),
      h('p', { class: 'muted small' }, 'Check the past tense for irregular or doubled-letter verbs (e.g. begged, not beged).'));

    // import
    const ita = h('textarea', { class: 'mono', rows: '4', 'aria-label': 'Verbs to import', placeholder: 'whisper, whispered, soft|calm\nsnap, snapped, angry' });
    const importer = h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Import many verbs'),
      h('p', { class: 'muted small' }, 'One per line: base, past (optional), tags separated by | — tags: ' + tagKeys.join(', ')), ita,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        const rows = ita.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [base, past, tags] = l.split(',').map((s) => s.trim()); return { base, past, tags: tags || '' }; });
        const r = await api('/verbs/import', { method: 'POST', body: { rows } });
        await verbsView(document.getElementById('tab'));
        flash(`Added ${r.added}.` + (r.problems.length ? ' Problems: ' + r.problems.map((x) => `line ${x.row}: ${x.problem}`).join('; ') : ''), !!r.problems.length && !r.added);
      }) }, 'Import')));

    // list
    const tbody = h('tbody');
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      tbody.replaceChildren(...d.verbs.filter((v) => !t || v.base.includes(t) || v.past.includes(t)).map((v) => h('tr', null,
        h('td', null, h('b', null, v.base), v.banned ? h('span', { class: 'pill bad', style: 'margin-left:6px' }, 'not allowed') : null),
        h('td', null, v.past), h('td', null, v.tags.map((x) => S.meta.tags[x] || x).join(', ')), h('td', null, v.source),
        h('td', null,
          h('button', { class: 'btn small alt', type: 'button', onclick: () => editVerb(v) }, 'Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm(`Delete “${v.base}”?`)) return; await api('/verbs/' + v.id, { method: 'DELETE' }); await verbsView(document.getElementById('tab')); }) }, 'Delete')))));
    };
    const editor = h('div');
    const editVerb = (v) => {
      const eb = h('input', { type: 'text', value: v.base, maxlength: '24', 'aria-label': 'Base' });
      const ep = h('input', { type: 'text', value: v.past, maxlength: '24', 'aria-label': 'Past' });
      const et = tagBoxes(v.tags);
      const en = h('input', { type: 'checkbox', checked: v.banned });
      editor.replaceChildren(h('div', { class: 'panel sel' }, h('h3', { style: 'margin-top:0' }, 'Edit “' + v.base + '”'),
        h('div', { class: 'two' }, h('div', { class: 'grid-form' }, eb, ep, h('label', { class: 'small' }, en, ' Not allowed')), et),
        h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
          h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api('/verbs/' + v.id, { method: 'PUT', body: { base: eb.value, past: ep.value, tags: picked(et), banned: en.checked } }); await verbsView(document.getElementById('tab')); flash('Saved.'); }) }, 'Save'),
          h('button', { class: 'btn small alt', type: 'button', onclick: () => editor.replaceChildren() }, 'Cancel'))));
      editor.scrollIntoView({ block: 'nearest' });
    };
    q.addEventListener('input', draw);
    draw();
    const list = h('section', { class: 'panel' }, h('h2', null, `Verb bank (${d.verbs.length})`), q, editor,
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Verb', 'Past', 'Shows', 'Source', ''].map((t) => h('th', null, t)))), tbody)));
    root.replaceChildren(review, add, importer, list);
  }

  // ---------- analytics ----------
  async function gameView(root) {
    const d = await api('/game-config'), c = d.cfg, ik = Object.keys(d.items);
    const num = (v, w) => h('input', { type: 'number', step: 'any', value: v ?? '', style: `width:${w || 5}em` });
    const val = (i) => (i.value === '' ? undefined : Number(i.value));
    const base = num(c.hp.base), tiers = h('div', null);
    const addTier = (t) => {
      const up = num(t.upTo, 4), per = num(t.per, 4);
      const row = h('div', { class: 'row' }, 'Up to level ', up, ' gains ', per, ' HP per level ', h('button', { class: 'btn small danger', type: 'button', onclick: () => row.remove() }, 'Remove'));
      row._get = () => ({ upTo: val(up), per: val(per) });
      tiers.append(row);
    };
    c.hp.tiers.forEach(addTier);
    // Player HP: tiers of 'up to level N gains [hp] HP at [chance]% ...'. Chances are relative (25 and 75 mean 25% and 75%).
    const pbase = num(c.php.base, 4), ptiers = h('div', null);
    const addPTier = (t) => {
      const up = num(t.upTo, 4), outs = h('span', null);
      const addOut = (x) => {
        const hp = num(x[0], 3), w = num(x[1], 4);
        const o = h('span', { style: 'display:inline-block;margin:0 10px 4px 0;white-space:nowrap' }, hp, ' HP at ', w, '% ', h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Remove this HP amount', onclick: () => o.remove() }, '×'));
        o._get = () => [val(hp), val(w)];
        outs.append(o);
      };
      t.gains.forEach(addOut);
      const row = h('div', { class: 'row', style: 'flex-wrap:wrap' }, 'Up to level ', up, ' gains ', outs, h('button', { class: 'btn small', type: 'button', onclick: () => addOut([1, 0]) }, '+ HP amount'), h('button', { class: 'btn small danger', type: 'button', onclick: () => row.remove() }, 'Remove tier'));
      row._get = () => ({ upTo: val(up), gains: [...outs.children].map((o) => o._get()) });
      ptiers.append(row);
    };
    c.php.tiers.forEach(addPTier);
    // Dodge: the chance a monster's attack misses, by level range (a class's own dodge perk is added in the perks table below).
    const md = [c.mdodge.mob, c.mdodge.mid, c.mdodge.boss].map((v) => num(+(v * 100).toFixed(2), 4));
    const sureBox = (on) => { const i = h('input', { type: 'checkbox' }); i.checked = !!on; return i; };
    const sureJ = Object.entries(d.jobs).map(([id, jb]) => ({ id, jb, box: sureBox(c.sure.jobs[id]) }));
    const sureM = Object.entries(d.mobs).map(([id, m]) => ({ id, m, box: sureBox(c.sure.mobs[id]) }));
    const sureList = (rows, label) => h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 16px' }, ...rows.map((r) => h('label', { class: 'small', style: 'white-space:nowrap' }, r.box, ' ' + label(r))));
    const dtiers = h('div', null);
    const addDTier = (t) => {
      const up = num(t.upTo, 4), v = num(+(t.v * 100).toFixed(2), 4);
      const row = h('div', { class: 'row' }, 'Up to level ', up, ' dodge chance ', v, '% ', h('button', { class: 'btn small danger', type: 'button', onclick: () => row.remove() }, 'Remove'));
      row._get = () => ({ upTo: val(up), v: val(v) / 100 });
      dtiers.append(row);
    };
    c.dodge.tiers.forEach(addDTier);
    const bands = h('div', null);
    const addBand = (b) => {
      const up = num(b.upTo, 4), mn = num(b.min, 4), mx = num(b.max, 4);
      const row = h('div', { class: 'row' }, 'Floors up to ', up, ': ', mn, ' to ', mx, ' monsters ', h('button', { class: 'btn small danger', type: 'button', onclick: () => row.remove() }, 'Remove'));
      row._get = () => ({ upTo: val(up), min: val(mn), max: val(mx) });
      bands.append(row);
    };
    c.floors.forEach(addBand);
    const bk = ['midHp', 'midDmg', 'bossHp', 'bossDmg', 'rageDmg', 'lo', 'hi'], bs = bk.map((k) => num(c.boss[k], 4));
    const g1 = num(c.def.goldMin, 4), g2 = num(c.def.goldMax, 4), xp = num(c.def.xp, 4), dm = num(c.def.dmg, 4);
    const fields = [['st', 0], ['price', 0], ['atk', 0], ['def', 0], ['gold', 1], ['xp', 1], ['heal', 0], ['spd', 1], ['dbl', 1], ['par', 1], ['ref', 1], ['stn', 1], ['lch', 1], ['crit', 1], ['pw', 0]];
    const itemRows = Object.entries(d.items).sort((a, b) => a[1].st - b[1].st || a[1].price - b[1].price).map(([id, it]) => {
      const ins = fields.map(([k, pct]) => (it[k] == null ? null : num(+(it[k] * (pct ? 100 : 1)).toFixed(2), 5)));
      return { id, ins, tr: h('tr', null, h('td', null, it.e + ' ' + it.n + (it.fam ? ' (' + it.fam + ' line)' : '')), ...ins.map((i) => h('td', null, i || '—'))) };
    });
    const sp = [c.speed.turn, c.speed.offset, c.speed.ranged, c.speed.cap * 100, c.speed.monster * 100].map((v) => num(v, 4));
    const sc = c.shopCost.map((v) => num(v, 6));
    const ss = num(c.strike, 4), mu = [c.must.mob, c.must.mid, c.must.boss].map((v) => num(v, 3));
    const dvOn = h('input', { type: 'checkbox' });
    dvOn.checked = !!c.dive.on;
    const dv = [c.dive.hpPer, c.dive.poolPer, c.dive.balanced, c.dive.gap, c.dive.revive].map((v) => num(v, 4));
    const dvHp = h('input', { type: 'checkbox' }), dvBoss = h('input', { type: 'checkbox' });
    dvHp.checked = c.dive.hpScale !== false;
    dvBoss.checked = !!c.dive.bosses;
    const dv2 = [c.dive.midEvery, c.dive.bossEvery, c.dive.dropMult].map((v) => num(v, 4));
    const rs = h('input', { type: 'checkbox', checked: c.respawn ? true : null });
    rs.checked = !!c.respawn;
    const sy = h('input', { type: 'checkbox' });
    sy.checked = c.story !== false;
    const xm = h('select', null, h('option', { value: 'level' }, 'Fixed XP by monster level'), h('option', { value: 'damage' }, 'Monster-level XP + 50% of strike damage'));
    xm.value = c.xpMode === 'damage' ? 'damage' : 'level';
    const st = [c.start.levels, c.start.gold, c.start.xp, c.start.dmg, c.start.bossHp].map((v) => num(v, 4));
    const T0 = c.training || {}, tr = { x: num(T0.xpMult ?? 1.5, 4), b: num(T0.bonusMult ?? 2, 4), w: num(T0.weakest ?? 3, 4), m: num(T0.dailyMonsters ?? 30, 4), z: num(T0.tz ?? 8, 4), c: num(T0.levelCap ?? 20, 4) };
    const sk = Object.entries(d.skillDefs).map(([id, def]) => {
      const cur = c.skills[id] || {}, on = h('input', { type: 'checkbox', 'aria-label': def.n + ' on' });
      on.checked = cur.on !== false;
      const share = num(cur.share ?? 35, 4), mn = num(cur.min ?? def.min, 4), mx = num(cur.max ?? def.max, 4);
      return { id, on, share, mn, mx, tr: h('tr', null, h('td', null, def.n, h('div', { class: 'muted small' }, 'Mode ' + def.modes.join(' / '))), h('td', null, on), h('td', null, share, ' %'), h('td', null, mn), h('td', null, mx)) };
    });
    const pd = d.perkDefs, pj = Object.entries(d.jobs).filter(([id]) => id !== 'adventurer').map(([id, jb]) => {
      const cur = c.perks[id] || {}, ins = pd.map(([k, , pct]) => num(cur[k] != null ? +(cur[k] * (pct ? 100 : 1)).toFixed(2) : '', 4));
      return { id, ins, tr: h('tr', null, h('td', null, jb.e + ' ' + jb.n), ...ins.map((i) => h('td', null, i))) };
    });
    const mobs = Object.entries(d.mobs).map(([id, m]) => {
      const mc = c.mobs[id] || {}, ov = ['goldMin', 'goldMax', 'xp'].map((k) => num(mc[k], 4));
      const di = ik.map((k) => num(mc.drops && mc.drops[k] != null ? +(mc.drops[k] * 100).toFixed(2) : '', 4));
      return { id, ov, di, tr: h('tr', null, h('td', null, m.img ? h('img', { src: '/m/' + m.img + '.png', height: 28, alt: '' }) : m.e, ' ' + m.n), ...ov.map((i) => h('td', null, i)), ...di.map((i) => h('td', null, i))) };
    });
    const save = guard(async () => {
      const body = { hp: { base: val(base), tiers: [...tiers.children].map((r) => r._get()) }, php: { base: val(pbase), tiers: [...ptiers.children].map((r) => r._get()) }, dodge: { tiers: [...dtiers.children].map((r) => r._get()) }, sure: { jobs: Object.fromEntries(sureJ.filter((r) => r.box.checked).map((r) => [r.id, true])), mobs: Object.fromEntries(sureM.filter((r) => r.box.checked).map((r) => [r.id, true])) }, mdodge: { mob: val(md[0]) / 100, mid: val(md[1]) / 100, boss: val(md[2]) / 100 }, def: { goldMin: val(g1), goldMax: val(g2), xp: val(xp), dmg: val(dm) }, floors: [...bands.children].map((r) => r._get()), boss: Object.fromEntries(bk.map((k, i) => [k, val(bs[i])])), speed: { turn: val(sp[0]), offset: val(sp[1]), ranged: val(sp[2]), cap: val(sp[3]) / 100, monster: val(sp[4]) / 100 }, shopCost: sc.map(val), respawn: rs.checked, story: sy.checked, xpMode: xm.value, dive: { on: dvOn.checked, hpPer: val(dv[0]), poolPer: val(dv[1]), balanced: val(dv[2]), gap: val(dv[3]), revive: val(dv[4]), hpScale: dvHp.checked, bosses: dvBoss.checked, midEvery: val(dv2[0]), bossEvery: val(dv2[1]), dropMult: val(dv2[2]) }, strike: val(ss), must: { mob: val(mu[0]), mid: val(mu[1]), boss: val(mu[2]) }, start: { levels: val(st[0]), gold: val(st[1]), xp: val(st[2]), dmg: val(st[3]), bossHp: val(st[4]) }, training: { xpMult: val(tr.x), bonusMult: val(tr.b), weakest: val(tr.w), dailyMonsters: val(tr.m), tz: val(tr.z), levelCap: val(tr.c) }, skills: Object.fromEntries(sk.map((r) => [r.id, { on: r.on.checked, share: val(r.share), min: val(r.mn), max: val(r.mx) }])), items: Object.fromEntries(itemRows.map((r) => [r.id, Object.fromEntries(fields.map(([k, pct], i) => [k, r.ins[i] ? val(r.ins[i]) / (pct ? 100 : 1) : undefined]).filter(([, v]) => v != null && !Number.isNaN(v)))])), perks: Object.fromEntries(pj.map((r) => [r.id, Object.fromEntries(pd.map(([k, , pct], i) => [k, val(r.ins[i]) / (pct ? 100 : 1)]).filter(([, v]) => v > 0))])), mobs: {} };
      mobs.forEach((r) => {
        const o = { drops: {} };
        ['goldMin', 'goldMax', 'xp'].forEach((k, i) => { const v = val(r.ov[i]); if (v != null) o[k] = v; });
        ik.forEach((k, i) => { const v = val(r.di[i]); if (v) o.drops[k] = v / 100; });
        body.mobs[r.id] = o;
      });
      await api('/game-config', { method: 'PUT', body });
      flash('Saved. New fights use these numbers.');
      await gameView(root);
    });
    root.replaceChildren(h('div', { class: 'card' },
      h('h2', null, 'Game balance (Dialogue Dungeon)'),
      h('h3', null, 'Monster HP'), h('p', null, 'Level 1 monsters have ', base, ' HP. Each level after that adds HP by tier (levels past the last tier use the last tier’s gain).'), tiers,
      h('button', { class: 'btn small', type: 'button', onclick: () => addTier({ upTo: (c.hp.tiers.at(-1)?.upTo || 0) + 50, per: 4 }) }, '+ Add tier'),
      h('p', { class: 'muted' }, 'Preview: ' + d.preview.map(([l, x]) => `Lv ${l} = ${x} HP`).join(' · ') + ' (saved values)'),
      h('h3', null, 'Player HP'), h('p', null, 'Pupils start with ', pbase, ' HP at level 1. Each level after that adds HP by tier (levels past the last tier use the last tier’s gain). A tier with several HP amounts rolls one of them each level, by chance: 2 HP at 25% and 3 HP at 75% means a quarter of levels add 2 and the rest add 3. Chances are relative, so 1 and 3 work like 25 and 75. A pupil’s roll for each level is fixed, so their max HP never changes between visits. Job perks (Max HP bonus %) are added on top.'), ptiers,
      h('button', { class: 'btn small', type: 'button', onclick: () => addPTier({ upTo: (c.php.tiers.at(-1)?.upTo || 0) + 50, gains: [[1, 100]] }) }, '+ Add tier'),
      h('p', { class: 'muted' }, 'Preview (average, with the lowest and highest max HP luck could give, before job perks): ' + d.playerPreview.map((r) => `Lv ${r.l} ≈ ${r.avg}` + (r.min === r.max ? '' : ` (${r.min} to ${r.max})`)).join(' · ') + ' (saved values)'),
      h('h3', null, 'Player dodge chance'), h('p', null, 'The chance that a monster’s attack misses and deals 0 damage that turn, by pupil level (levels past the last tier use the last tier’s chance). Scout, Horse Archer, Ranger, Bow Knight and Assassin add their own dodge on top: edit it in the “Dodge chance %” column of the job perks table. Ranger and Bow Knight also keep the Horse Archer’s dodge, like their other perks. A pupil’s total dodge is capped at 50%.'), dtiers,
      h('button', { class: 'btn small', type: 'button', onclick: () => addDTier({ upTo: (c.dodge.tiers.at(-1)?.upTo || 0) + 50, v: 0.05 }) }, '+ Add tier'),
      h('h3', null, 'Sure hit'), h('p', null, 'A sure-hit job’s regular attacks ignore the monster’s dodge chance. A sure-hit monster’s attacks ignore the pupil’s dodge chance. (Parry and reflect still work.) Tick the jobs and monsters that have it. Default: Sniper only.'),
      h('p', { class: 'small' }, h('b', null, 'Jobs')), sureList(sureJ, (r) => r.jb.e + ' ' + r.jb.n),
      h('p', { class: 'small' }, h('b', null, 'Monsters')), sureList(sureM, (r) => r.m.n),
      h('h3', null, 'Monster dodge chance'), h('p', null, 'The chance a pupil’s regular attack misses and deals 0 damage (no critical, stun or leech). Correct-answer strikes never miss. Regular monsters ', md[0], '% · mid-bosses ', md[1], '% · bosses ', md[2], '%.'),
      h('p', { class: 'muted' }, 'Preview: ' + d.playerPreview.map((r) => `Lv ${r.l} = ${+(r.dodge * 100).toFixed(2)}%`).join(' · ') + ' (saved values, before job dodge)'),
      h('h3', null, 'Default rewards and damage'),
      h('p', null, 'Gold: ', g1, ' to ', g2, ' × monster level · XP: ', xp, ' × monster level · Monster damage per hit: ', dm, ' × monster level'),
      h('h3', null, 'Mid-bosses and bosses'), h('p', null, 'Mid-boss (every 5th floor): health ×', bs[0], ' and hits ×', bs[1], '. Boss (every 10th floor): health ×', bs[2], ', hits ×', bs[3], ', then hits ×', bs[4], ' once below 50% HP. All compared with a regular monster of the same level. They appear as the last monster of the floor. Each of their hits is a random amount between ', bs[5], '× and ', bs[6], '× their maximum damage. Regular monsters and pupils hit for a random 1 to their maximum.'),
      h('h3', null, 'Combat timing'), h('p', null, 'A normal attack lands every ', sp[0], ' seconds. The monster’s first attack comes ', sp[1], ' seconds earlier. Ranged classes strike first, ', sp[2], ' seconds after the fight begins. Attack speed bonuses are capped at ', sp[3], '%. Monster attack speed bonus: ', sp[4], '%.'),
      h('h3', null, 'Answer strike'), h('p', null, 'A correct answer deals (', ss, ' + the class’s bonus-strike perk) × the pupil’s attack. Raise the number to make fights easier, lower it to make them harder (default 3).'),
      h('p', null, 'Correct answers needed before a monster can die: regular ', mu[0], ' · mid-boss ', mu[1], ' · boss ', mu[2], '. Until then basic attacks and strikes can’t finish it (it is left on 1 HP). 0 = basic attacks alone may finish it.'),
      h('h3', null, 'Gentle start (early levels)'), h('p', null, 'While a pupil is below level ', st[0], ' (0 = off): gold ×', st[1], ', XP ×', st[2], ', monsters hit ×', st[3], ' as hard, and mid-bosses and bosses have ×', st[4], ' of their usual HP. Set the multipliers to 1 for no change. Level 10 is when pupils can unlock the Adventurer job.'),
      h('h3', null, 'Dungeon Dive (party mode)'), h('label', { class: 'row' }, dvOn, ' Turn on Dungeon Dive. Pupils can then form parties of up to 4 with a 4-character code and fight an endless dungeon together. Monsters start at the highest level in the party and go up by one level per monster. Everyone gets their own question; all attacks hit the same monster; gold and XP are split equally; loot is rolled among pupils who answered correctly. Gold and loot are only kept when a pupil retreats (a party wipe loses them, XP is always kept).'),
      h('p', null, 'Each extra player adds ', dv[0], ' × a monster’s HP. Each extra player adds ', dv[1], ' × a monster’s gold and XP to the pool (the pool is then split equally, so 1 means each pupil’s share equals one solo kill). Balanced party (melee + ranged + magic + healer) bonus gold and XP: ', dv[2], ' (0.25 = +25%). Seconds before the next monster: ', dv[3], '. A downed pupil returns with ', dv[4], ' of their max HP (0 to 1) when the next monster appears.'),
      h('label', { class: 'row' }, dvHp, ' Scale monster HP with party size. Off: a monster has the same HP whatever the party size, and the “extra player adds × a monster’s HP” number above is ignored.'),
      h('label', { class: 'row' }, dvBoss, ' Mid-bosses and bosses in Dungeon Dive. A mid-boss appears every ', dv2[0], ' monsters and a boss every ', dv2[1], ' (a boss wins when both fall on the same monster; 0 turns that kind off). They use the mid-boss and boss health, damage and correct-answer numbers above, plus their own drop tables.'),
      h('p', null, 'Dungeon Dive drop multiplier: ×', dv2[2], ' on every drop chance in a dive (1 = same as solo, 0 = no drops). Each item’s chance is capped at 10% first, so ×2 gives at most 20%.'),
      h('h3', null, 'XP mode'), h('label', { class: 'row' }, xm), h('p', null, 'Fixed XP by monster level (default): every kill gives the same XP for that monster. Monster-level XP + 50% of strike damage: the same XP, plus half of the damage the pupil’s answer strikes took off the monster (basic attacks and overkill don’t count). Pupil XP bonuses and the gentle-start multiplier apply to the total. In Dungeon Dive, the base XP is still shared equally, but each pupil’s strike-damage XP comes only from their own strikes.'),
      h('h3', null, 'Story: The Hush'), h('label', { class: 'row' }, sy, ' Show the story. Pupils meet short story scenes (under 80 words each) in the village at Level 10, 20 … 100 and on the victory screen after the boss on Floor 10, 20 … 100, plus a short note after each mid-boss. They can reread them under “The story so far…”, and a “Voices restored” bar tracks Elder Wren and Parley. Off: no scenes, no story card, and the boss names stay as they are. Pupils’ story progress is kept while it is off.'),
      h('h3', null, 'Monster respawn'), h('label', { class: 'row' }, rs, ' Monsters respawn when a pupil retreats or is defeated. Off: kills on a floor are kept. On: if a pupil flees or returns to the village before clearing a floor, they must fight all of that floor’s monsters again (cleared floors stay cleared, and the monster count isn’t re-rolled).'),
      h('h3', null, 'Monsters per floor'), h('p', { class: 'muted' }, 'The count is chosen at random within the range the first time a pupil explores a floor. Pupils must defeat every monster to find the stairs down. Every 5th floor ends with a mid-boss and every 10th with a boss.'), bands,
      h('button', { class: 'btn small', type: 'button', onclick: () => addBand({ upTo: (c.floors.at(-1)?.upTo || 0) + 10, min: 10, max: 15 }) }, '+ Add floor range'),
      h('h3', null, 'Guild Training Grounds'),
      h('p', { class: 'muted' }, 'The Training Grounds (the pupils’ practice room) let a pupil practise one skill at a time against training monsters. Training monsters never give gold or drops and cannot hurt the pupil. A training monster is as strong as the pupil (the pupil’s level, never above the highest level below), and is worth the XP of a dungeon monster of that level, times the multiplier below. A pupil’s weakest skills are fixed each morning (first time they open the Training Grounds that day), and the first round on each of them pays the bonus multiplier.'),
      h('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' },
        h('label', null, 'XP multiplier ', tr.x), h('label', null, 'Daily bonus multiplier ', tr.b), h('label', null, 'Weakest skills that get the bonus ', tr.w),
        h('label', null, 'Monsters that pay XP per day ', tr.m), h('label', null, 'Hours ahead of UTC (a “day”) ', tr.z), h('label', null, 'Highest training monster level ', tr.c)),
      h('h3', null, 'Question skills'),
      h('p', { class: 'muted' }, 'Skills are families of questions that only appear on certain floors (in Dungeon Dive, the monster’s level stands in for the floor). On a floor inside a skill’s range, that skill supplies about its share of the questions and the rest come from the ordinary pool, as before. Where two skills overlap they split the floor, and together they never take more than 70%. Switching a skill off removes its questions from play without deleting them. Questions can narrow their own floors in the Questions tab.'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Skill', 'On', 'Share of questions', 'From floor', 'To floor'].map((t) => h('th', null, t)))), h('tbody', null, sk.map((r) => r.tr)))),
      h('h3', null, 'Equipment and item prices'), h('p', { class: 'muted' }, 'Shop level is the shop upgrade (1 to 4) that starts selling the item. Attack and defence add to the pupil’s own numbers, gold and XP are bonus percentages, and heal is HP restored (potions) or restored after each win (accessories). Changes apply to everyone straight away, including items pupils already own. A dash means that stat doesn’t apply to the item. Special stats: Crit = chance a regular hit does double damage, Parry = chance a monster’s hit does nothing, Reflect = chance half the damage taken bounces back at the monster, Stun = chance a hit delays the monster’s next strike by 4 seconds, Leech = share of damage dealt returned as HP, Answer crit = chance a correct-answer strike does double. Answer power (weapons only) is the attack value the answer strike is built on, so fast or slow weapons don’t change what a correct answer is worth. Totals are capped (crit and answer crit 50%, parry and reflect 40%, stun 30%, leech 20%) so no build becomes unkillable.'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Item', 'Shop level', 'Price', 'Attack', 'Defence', 'Gold %', 'XP %', 'Heal', 'Speed %', 'Crit %', 'Parry %', 'Reflect %', 'Stun %', 'Leech %', 'Answer crit %', 'Answer power'].map((t) => h('th', null, t)))), h('tbody', null, itemRows.map((r) => r.tr)))),
      h('h3', null, 'Shop upgrade prices'), h('p', null, 'Upgrade to level 2: ', sc[0], ' gold · level 3: ', sc[1], ' · level 4: ', sc[2], '. A pupil also needs the matching job first (Adventurer, a branch class, a top-tier class).'),
      h('h3', null, 'Job perks'), h('p', { class: 'muted' }, 'Values stack. Stage 3 jobs (Fighter, Archer, Acolyte and their next classes) get only their own perk; top-tier jobs get their own perk plus the perk of the class they came from. % columns are percentages and blank means no perk. The Adventurer’s ability to use any stage 3 weapon is built in.'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Job', ...pd.map((q) => q[1])].map((t) => h('th', null, t)))), h('tbody', null, pj.map((r) => r.tr)))),
      h('h3', null, 'Per-monster rewards and drops'),
      h('p', { class: 'muted' }, 'Leave gold/XP blank to use the defaults. Drop rates are % per win, per item (maximum 10%); blank = never drops.'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Monster', 'Gold× min', 'Gold× max', 'XP×', ...ik.map((k) => d.items[k].e + ' ' + d.items[k].n)].map((t) => h('th', null, t)))), h('tbody', null, mobs.map((r) => r.tr)))),
      h('p', null, h('button', { class: 'btn', type: 'button', onclick: save }, 'Save game balance'))));
  }

  // ---------- feedback from pupils ----------
  const FB_KIND = { difficulty: '🎚️ Difficulty', suggestion: '💡 Idea', bug: '🐞 Problem', other: '💬 Other' };
  const FB_RATING = { too_easy: '😴 Too easy', just_right: '👌 About right', too_hard: '😵 Too hard' };
  // ---------- Diagnosis: what does this class need to learn next? ----------
  const LV = { new: '○', learning: '◔', developing: '◑', secure: '●' };
  const LV_NAME = { new: 'not started', learning: 'learning', developing: 'getting there', secure: 'secure' };
  const TREND = { worse: '↗ more mistakes than the period before', better: '↘ fewer mistakes than the period before', steady: '→ about the same as before' };
  async function diagnosisView(root) {
    if (!S.classes.length) { const c = await api('/classes'); S.classes = c.classes; S.guests = c.guests; }
    S.dx = S.dx || { cls: null, days: 30 };
    if (!S.dx.cls) S.dx.cls = S.classes[0] ? String(S.classes[0].id) : (isAdmin() ? 'guests' : '');
    const sel = h('select', { 'aria-label': 'Class' }, S.classes.map((c) => h('option', { value: String(c.id), selected: String(c.id) === S.dx.cls }, c.name)), isAdmin() ? h('option', { value: 'guests', selected: S.dx.cls === 'guests' }, 'Guests') : null);
    const days = h('select', { 'aria-label': 'Time period' }, [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'This year']].map(([n, l]) => h('option', { value: n, selected: n === S.dx.days }, l)));
    sel.addEventListener('change', () => { S.dx.cls = sel.value; render(); });
    days.addEventListener('change', () => { S.dx.days = +days.value; render(); });
    const body = h('div');
    root.replaceChildren(h('section', { class: 'panel no-print' }, h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Diagnosis'), sel, days),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'Works from each pupil’s first try at each question, in the dungeon and in the Training Grounds. A pupil is “struggling” on a skill when they made a mistake of that kind on at least 40% of at least 3 tries.')), body);
    const d = await api(`/diagnosis?class=${encodeURIComponent(S.dx.cls)}&days=${S.dx.days}`);
    drawDiagnosis(body, d);
  }

  function drawDiagnosis(root, d) {
    const classId = S.dx.cls === 'guests' ? null : +S.dx.cls;
    const assign = guard(async (rule, pupilIds, target, due) => {
      if (classId == null) throw new Error('Choose a class to assign practice to.');
      await api('/focus', { method: 'POST', body: { class_id: classId, rule, pupil_ids: pupilIds || [], target: target || 8, due: due || null } });
      flash(pupilIds && pupilIds.length ? `Assigned “${ruleName(rule)}” to ${pupilIds.length} pupil${pupilIds.length === 1 ? '' : 's'}.` : `Assigned “${ruleName(rule)}” to the whole class.`);
      render();
    });
    const withData = d.rules.filter((r) => r.exposures > 0);
    const next = withData.filter((r) => r.struggling.length || r.errorRate >= 30).slice(0, 3);
    const parts = [];
    parts.push(h('p', { class: 'muted' }, `${d.active} of ${d.pupils} pupils answered at least one question in this period.` + (d.unscanned ? ` ${d.unscanned} questions have not been analysed yet; reload this tab to finish.` : '')));
    // 1. teach next
    parts.push(h('section', { class: 'panel' }, h('h2', null, 'Teach next'),
      next.length ? h('div', null, next.map((r, i) => h('div', { class: 'rule', style: `border-left:6px solid var(--r${r.rule});padding:8px 12px;margin:8px 0` },
        h('div', null, h('b', null, `${i + 1}. ${r.name}`), ` · ${r.errorRate}% of tries had a mistake · ${r.struggling.length} of ${r.pupilsExposed} pupils struggling`, r.trend ? ' · ' + TREND[r.trend] : ''),
        h('div', null, r.action),
        r.struggling.length ? h('div', { class: 'muted small' }, 'Struggling: ' + r.struggling.map((x) => `${x.name} (${x.rate}%)`).join(', ')) : null,
        h('div', { class: 'row no-print', style: 'gap:8px;margin-top:6px' },
          h('button', { class: 'btn small', type: 'button', onclick: () => assign(r.rule, []) }, 'Assign to the whole class'),
          r.struggling.length ? h('button', { class: 'btn alt small', type: 'button', onclick: () => assign(r.rule, r.struggling.map((x) => x.id)) }, `Assign to these ${r.struggling.length}`) : null))))
        : h('p', { class: 'muted' }, withData.length ? 'No skill stands out: nobody is struggling yet.' : 'No answers in this period yet.')));
    // 2. all skills
    parts.push(h('section', { class: 'panel' }, h('h2', null, 'All skills'),
      withData.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Skill', 'Tries', 'Mistakes', 'Struggling', 'Secure', 'Trend', 'Suggested action'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, d.rules.filter((r) => r.exposures > 0).map((r) => h('tr', null,
          h('th', { scope: 'row' }, h('span', { class: 'chip', style: `background:var(--r${r.rule});color:#fff;padding:0 6px;border-radius:8px` }, r.rule), ' ' + r.name),
          h('td', null, r.exposures), h('td', null, r.errorRate + '%'), h('td', null, `${r.struggling.length} of ${r.pupilsExposed}`), h('td', null, r.secureCount),
          h('td', null, r.trend ? TREND[r.trend].split(' ')[0] : '·'), h('td', null, r.action)))))) : h('p', { class: 'muted' }, 'Nothing to show yet.')));
    // 3. who needs support
    const need = new Map();
    for (const r of withData) for (const x of r.struggling) (need.get(x.id) || need.set(x.id, { name: x.name, rules: [] }).get(x.id)).rules.push(r);
    parts.push(h('section', { class: 'panel' }, h('h2', null, 'Who needs support'),
      withData.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Pupil'), withData.map((r) => h('th', { scope: 'col', title: r.name }, r.rule)))),
        h('tbody', null, d.roster.map((p) => h('tr', null, h('th', { scope: 'row' }, p.name),
          withData.map((r) => { const lv = r.levels[p.id]; const st = r.struggling.some((x) => x.id === p.id); return h('td', { style: 'text-align:center' + (st ? ';font-weight:700;color:var(--bad)' : ''), title: lv ? `${r.name}: ${LV_NAME[lv]}${st ? ', struggling' : ''}` : `${r.name}: no tries yet` }, lv ? LV[lv] : '·'); })))))) : h('p', { class: 'muted' }, 'Nothing to show yet.'),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, '● secure · ◑ getting there · ◔ learning · red = struggling · · = no tries. Column numbers are the rules: ' + withData.map((r) => `${r.rule} ${r.name}`).join(' · '))));
    // 4. what pupils actually wrote
    parts.push(h('section', { class: 'panel' }, h('h2', null, 'What pupils actually wrote'),
      d.wrong.length ? h('div', null, d.wrong.map((q) => h('div', { style: 'margin:8px 0' }, h('b', { style: 'white-space:pre-wrap' }, q.text), h('div', { class: 'muted small' }, `${q.wrong} wrong first tries of ${q.tries}. The most common answers:`), h('ul', null, q.answers.map((a) => h('li', { style: 'white-space:pre-wrap' }, `“${a.text}” × ${a.n}`))))))
        : h('p', { class: 'muted' }, 'Appears once a question has been answered wrongly at least 3 times.')));
    root.replaceChildren(...parts, assignedPanel(classId, d, assign), exportPanel(d));
  }

  function assignedPanel(classId, d, assign) {
    const box = h('section', { class: 'panel no-print' }, h('h2', null, 'Assigned practice'));
    if (classId == null) { box.append(h('p', { class: 'muted' }, 'Choose a class to assign practice.')); return box; }
    const list = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
    guard(async () => {
      const r = await api('/focus?class=' + classId);
      list.replaceChildren(r.assignments.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Skill', 'For', 'Target', 'Done', 'Due', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, r.assignments.map((a) => h('tr', null, h('td', null, a.name), h('td', null, a.who), h('td', null, a.target + ' first-try correct'), h('td', null, `${a.done} of ${a.targeted} pupil${a.targeted === 1 ? '' : 's'}`), h('td', null, a.due ? new Date(a.due).toLocaleDateString() : '·'),
          h('td', null, h('button', { class: 'btn ghost small', type: 'button', onclick: guard(async () => { await api('/focus/' + a.id, { method: 'DELETE' }); render(); }) }, 'End')))))) : h('p', { class: 'muted' }, 'Nothing assigned. Pupils see assigned practice in the Training Grounds, and on their village screen until they finish.'));
    })();
    const rule = h('select', { 'aria-label': 'Skill to assign' }, Object.keys(S.meta.rules).filter((n) => +n > 0).map((n) => h('option', { value: n }, `${n} · ${S.meta.rules[n].short}`)));
    const target = h('input', { type: 'number', min: '1', max: '30', value: '8', style: 'width:5em', 'aria-label': 'Target' });
    const due = h('input', { type: 'date', 'aria-label': 'Due date (optional)' });
    const picks = d.roster.map((p) => h('label', { class: 'small', style: 'margin-right:10px;white-space:nowrap' }, h('input', { type: 'checkbox', value: p.id }), ' ' + p.name));
    box.append(list, h('h3', null, 'Assign a focus skill'),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, rule, h('label', null, 'Target ', target, ' first-try correct'), h('label', null, 'Due ', due)),
      h('details', null, h('summary', null, 'Choose pupils (leave empty for the whole class)'), h('div', null, picks)),
      h('button', { class: 'btn', type: 'button', style: 'margin-top:8px', onclick: () => assign(+rule.value, picks.map((l) => l.firstChild).filter((i) => i.checked).map((i) => +i.value), +target.value, due.value) }, 'Assign'));
    return box;
  }

  function exportPanel(d) {
    const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    return h('section', { class: 'panel no-print' }, h('h2', null, 'Export'),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn alt small', type: 'button', onclick: () => download('diagnosis-skills.csv', csv([['Skill', 'Tries', 'Mistake %', 'Pupils exposed', 'Struggling', 'Secure', 'Trend', 'Struggling pupils', 'Suggested action'], ...d.rules.map((r) => [r.name, r.exposures, r.errorRate, r.pupilsExposed, r.struggling.length, r.secureCount, r.trend || '', r.struggling.map((x) => x.name).join('; '), r.action])])) }, 'Skills (CSV)'),
        h('button', { class: 'btn alt small', type: 'button', onclick: () => download('diagnosis-pupils.csv', csv([['Pupil', ...d.rules.map((r) => r.name)], ...d.roster.map((p) => [p.name, ...d.rules.map((r) => (r.levels[p.id] ? LV_NAME[r.levels[p.id]] : ''))])])) }, 'Pupils by skill (CSV)'),
        h('button', { class: 'btn alt small', type: 'button', onclick: guard(async () => { const r = await api('/rules/scan', { method: 'POST', body: {} }); flash(`Analysed ${r.scanned} question${r.scanned === 1 ? '' : 's'}; ${r.remaining} left.`); }) }, 'Re-analyse questions')),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'Questions are analysed automatically (which skills each one practises). Use “Re-analyse” only if you edited questions outside this console.'));
  }

  async function feedbackView(root) {
    const f = S.fb || (S.fb = { status: 'new', kind: 'all' });
    const d = await api(`/feedback?status=${f.status}&kind=${f.kind}`);
    const again = () => feedbackView(document.getElementById('tab'));
    const mk = (key, opts) => {
      const s = h('select', { 'aria-label': key === 'status' ? 'Show' : 'Type' }, opts.map(([v, l]) => h('option', { value: v }, l)));
      s.value = f[key];
      s.addEventListener('change', () => { f[key] = s.value; guard(again)(); });
      return s;
    };
    const ctxText = (c) => [c.level != null ? 'Lv ' + c.level : '', c.job || '', c.floor != null ? 'floor ' + c.floor : '', c.mob ? c.mob + (c.mlv ? ' (Lv ' + c.mlv + ')' : '') : '', c.where === 'dive' ? 'Dungeon Dive' : ''].filter(Boolean).join(' · ') || '—';
    const r = d.ratings, total = r.too_easy + r.just_right + r.too_hard;
    const rows = d.items.map((it) => h('tr', null,
      h('td', null, fmtTime(it.ts)),
      h('td', null, h('b', null, it.name), h('div', { class: 'muted small' }, it.className)),
      h('td', null, FB_KIND[it.kind] || it.kind, it.rating ? h('div', { class: 'small' }, FB_RATING[it.rating]) : null),
      h('td', { style: 'white-space:pre-wrap;min-width:14em' }, it.message || '—'),
      h('td', { class: 'small' }, ctxText(it.ctx)),
      h('td', { style: 'white-space:nowrap' },
        h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api('/feedback/' + it.id, { method: 'PATCH', body: { status: it.status === 'done' ? 'new' : 'done' } }); await again(); }) }, it.status === 'done' ? 'Reopen' : 'Mark done'), ' ',
        h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => { if (!confirm('Delete this feedback?')) return; await api('/feedback/' + it.id, { method: 'DELETE' }); await again(); }) }, 'Delete'))));
    root.replaceChildren(h('section', { class: 'panel' },
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Pupil feedback'),
        mk('status', [['new', `New (${d.counts.new})`], ['done', `Done (${d.counts.done})`], ['all', 'All']]),
        mk('kind', [['all', 'All types'], ...Object.entries(FB_KIND)]),
        d.counts.done ? h('button', { class: 'btn small ghost', type: 'button', onclick: guard(async () => { if (!confirm(`Delete all ${d.counts.done} feedback notes marked done?`)) return; await api('/feedback/clear-done', { method: 'POST', body: {} }); await again(); }) }, 'Clear done') : null),
      h('p', { class: 'muted small' }, 'Pupils send feedback from the 💬 Feedback button in the village, in solo fights and in Dungeon Dive. You see their name, class, level, job and, in a fight, the floor and monster. Difficulty ratings so far (all time): ',
        total ? `${FB_RATING.too_easy} ${r.too_easy} · ${FB_RATING.just_right} ${r.just_right} · ${FB_RATING.too_hard} ${r.too_hard}` : 'none yet', '.'),
      rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Pupil', 'Type', 'Message', 'Where they were', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
        : h('p', { class: 'muted' }, 'No feedback here yet.')));
  }

  async function analyticsView(root) {
    if (!S.classes.length) { const c = await api('/classes'); S.classes = c.classes; S.guests = c.guests; }
    if (!S.ana.cls) S.ana.cls = S.classes[0] ? String(S.classes[0].id) : (isAdmin() ? 'guests' : '');
    const sel = h('select', { 'aria-label': 'Class' }, S.classes.map((c) => h('option', { value: String(c.id), selected: String(c.id) === S.ana.cls }, c.name)), isAdmin() ? h('option', { value: 'guests', selected: S.ana.cls === 'guests' }, 'Guests') : null);
    const days = h('select', { 'aria-label': 'Time period' }, [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'This year']].map(([n, l]) => h('option', { value: n, selected: n === S.ana.days }, l)));
    const by = h('div', { class: 'seg', role: 'group', 'aria-label': 'Group columns by' }, [['rule', 'By rule'], ['code', 'By error type']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(S.ana.by === k), onclick: () => { S.ana.by = k; render(); } }, l)));
    sel.addEventListener('change', () => { S.ana.cls = sel.value; render(); });
    days.addEventListener('change', () => { S.ana.days = +days.value; render(); });
    const body = h('div');
    root.replaceChildren(h('section', { class: 'panel no-print' }, h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Analytics'), sel, days, by),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'Counts use each pupil’s first try at each question, so retries don’t inflate the numbers.')), body);
    const d = await api(`/analytics?class=${encodeURIComponent(S.ana.cls)}&days=${S.ana.days}`);
    drawAnalytics(body, d);
  }

  const ruleName = (n) => (S.meta.rules[n] ? S.meta.rules[n].short : 'Other');
  function bucket(n, max) { return Math.max(0, Math.min(6, Math.ceil((n / max) * 7) - 1)); }

  function drawAnalytics(root, d) {
    const active = d.pupils.filter((p) => p.attempts > 0);
    if (!d.pupils.length) return root.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', style: 'margin:0' }, 'No pupils here yet.')));
    if (!active.length) return root.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'muted', style: 'margin:0' }, `No answers in the last ${d.days} days.`)));

    // columns
    let cols;
    if (S.ana.by === 'rule') {
      const g = new Map();
      for (const c of d.codes) { const r = c.rule || 0; if (!g.has(r)) g.set(r, { key: 'r' + r, label: r ? `Rule ${r}: ${ruleName(r)}` : 'Other', rule: r, codes: [] }); g.get(r).codes.push(c.code); }
      cols = [...g.values()].sort((a, b) => (a.rule || 99) - (b.rule || 99));
    } else {
      cols = d.codes.slice().sort((a, b) => (a.rule || 99) - (b.rule || 99)).map((c) => ({ key: c.code, label: c.label, rule: c.rule, codes: [c.code] }));
    }
    const val = (p, col) => col.codes.reduce((n, c) => n + (p.counts[c] || 0), 0);
    const colTotal = (col) => active.reduce((n, p) => n + val(p, col), 0);
    cols = cols.filter((c) => colTotal(c) > 0 || S.ana.by === 'rule');
    const pupils = d.pupils.slice().sort((a, b) => a.name.localeCompare(b.name));
    let max = 1;
    for (const p of pupils) for (const c of cols) max = Math.max(max, val(p, c));

    // tooltip
    const tip = h('div', { class: 'tip', hidden: true, role: 'tooltip' });
    document.querySelectorAll('.tip').forEach((t) => t.remove());
    document.body.append(tip);
    const showTip = (td, p, c, n) => {
      tip.replaceChildren(h('b', null, n + (n === 1 ? ' mistake' : ' mistakes')), h('div', null, p.name), h('div', { class: 'small muted' }, c.label), h('div', { class: 'small muted' }, `${p.attempts} first tries`));
      tip.hidden = false;
      const r = td.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - 270, Math.max(8, r.left)) + 'px';
      tip.style.top = (r.bottom + 6 > window.innerHeight - 90 ? r.top - 90 : r.bottom + 6) + 'px';
    };
    const hideTip = () => { tip.hidden = true; };

    const head = h('tr', null, h('th', { scope: 'col' }, 'Pupil'), cols.map((c) => h('th', { scope: 'col', class: 'rg', style: `--rc:var(--r${c.rule || 1})`, title: c.label }, c.label)), h('th', { scope: 'col' }, 'First-try correct'));
    const body = pupils.map((p) => h('tr', null, h('th', { scope: 'row' }, p.name),
      cols.map((c) => {
        const n = val(p, c);
        const td = h('td', { class: n ? 'b' + bucket(n, max) : 'z', tabindex: '0', 'data-n': n || false, 'aria-label': `${p.name}, ${c.label}: ${n}` }, n || '·');
        td.addEventListener('mouseenter', () => showTip(td, p, c, n));
        td.addEventListener('focus', () => showTip(td, p, c, n));
        td.addEventListener('mouseleave', hideTip);
        td.addEventListener('blur', hideTip);
        return td;
      }),
      h('td', { style: 'text-align:center' }, p.attempts ? Math.round((100 * p.correct) / p.attempts) + '% (' + p.attempts + ')' : '—')));
    const tot = h('tr', null, h('th', { scope: 'row' }, 'Class total'), cols.map((c) => h('td', { style: 'font-weight:700' }, colTotal(c))), h('td'));

    const steps = [0, 1, 2, 3, 4, 5, 6];
    const scale = h('div', { class: 'scale' }, h('span', null, 'fewer'), h('span', { class: 'ramp', 'aria-hidden': 'true' }, steps.map((i) => h('i', { style: `background:var(--h${i})` }))), h('span', null, 'more (max ' + max + ')'));
    const csv = () => {
      const lines = [['Pupil', ...cols.map((c) => c.label), 'First tries', 'Correct'].map(csvCell).join(',')];
      for (const p of pupils) lines.push([p.name, ...cols.map((c) => val(p, c)), p.attempts, p.correct].map(csvCell).join(','));
      download('dialogue-dungeon-heatmap.csv', lines.join('\n'));
    };

    // bar chart of totals
    const totals = cols.map((c) => ({ ...c, n: colTotal(c) })).sort((a, b) => b.n - a.n);
    const topN = Math.max(1, ...totals.map((t) => t.n));
    const bars = h('div', { class: 'bars-h' }, totals.filter((t) => t.n > 0).map((t) => h('div', { class: 'line' }, h('span', null, t.label), h('div', { class: 'bar' }, h('i', { style: `width:${(100 * t.n) / topN}%` })), h('b', { style: 'text-align:right' }, t.n))));

    const hard = d.hardest.length ? h('ol', null, d.hardest.map((q) => h('li', null, h('span', { class: 'pill' }, 'M' + q.mode), ' ', q.text, ' — ', h('b', null, Math.round((100 * q.right) / q.tries) + '%'), ` correct first time (${q.tries} tries)`))) : h('p', { class: 'muted' }, 'Needs at least 3 first tries per question.');

    const props = pupils.filter((p) => p.attempts > 0).length;
    const sk = d.bySkill || [];
    const pct = (c, n) => (n ? Math.round((100 * c) / n) + '%' : '—');
    const skillPanel = h('section', { class: 'panel' }, h('h2', null, 'Accuracy by skill'),
      sk.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Pupil'), sk.map((x) => h('th', { scope: 'col' }, x.name)))),
        h('tbody', null,
          pupils.filter((p) => p.attempts > 0).map((p) => h('tr', null, h('th', { scope: 'row' }, p.name), sk.map((x) => { const e = (p.bySkill || {})[x.skill]; return h('td', { style: 'text-align:center' }, e ? pct(e.c, e.n) + ' (' + e.n + ')' : '·'); }))),
          h('tr', null, h('th', { scope: 'row' }, 'Class'), sk.map((x) => h('td', { style: 'text-align:center;font-weight:700' }, pct(x.right, x.tries) + ' (' + x.tries + ')'))))))
        : h('p', { class: 'muted' }, 'No answers yet.'),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, 'First tries only. “Dialogue (core questions)” are the questions without a skill.'));
    root.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:8px' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Who is making which mistakes'), h('button', { class: 'btn small alt no-print', type: 'button', onclick: csv }, 'Download CSV')),
        h('p', { class: 'muted small' }, `${props} of ${pupils.length} pupils active in the last ${d.days} days. Each cell is a count of mistakes; darker means more.`),
        scale,
        h('div', { class: 'scroll-x', onscroll: hideTip }, h('table', { class: 'heat' }, h('thead', null, head), h('tbody', null, body, tot)))),
      h('div', { class: 'two' },
        h('section', { class: 'panel' }, h('h2', null, 'Most common mistakes'), bars.children.length ? bars : h('p', { class: 'muted' }, 'No mistakes recorded. 🎉')),
        h('section', { class: 'panel' }, h('h2', null, 'Hardest questions'), hard)),
      skillPanel);
  }

  // ---------- Pupil stats: view and edit pupils' game stats (beta testing) ----------
  async function playersView(root) {
    if (S.pl.sel) return playersEdit(root, S.pl.sel);
    const q = new URLSearchParams({ class: S.pl.cls, q: S.pl.q });
    const d = await api('/players?' + q);
    const cls = h('select', { 'aria-label': 'Class' }, h('option', { value: 'all' }, 'All pupils'), d.classes.map((c) => h('option', { value: String(c.id) }, c.name)), isAdmin() ? h('option', { value: 'guests' }, 'Guests') : null);
    cls.value = S.pl.cls;
    cls.addEventListener('change', () => { S.pl.cls = cls.value; render(); });
    const search = h('input', { type: 'search', placeholder: 'Search name or username', value: S.pl.q, 'aria-label': 'Search' });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { S.pl.q = search.value; render(); } });
    const csv = () => download('pupil-stats.csv', [['Name', 'Username', 'Class', 'Level', 'XP', 'XP needed', 'HP', 'Max HP', 'Gold', 'Gold in pack', 'Job', 'Jobs unlocked', 'Floors cleared', 'Kills', 'Last seen'], ...d.pupils.map((p) => [p.name, p.username, p.className, p.level, p.xp, p.need, p.hp, p.maxHp, p.gold, p.runGold, p.jobName, p.jobs, p.floors, p.kills, p.lastSeen ? new Date(p.lastSeen).toISOString() : ''])].map((r) => r.map(csvCell).join(',')).join('\n'));
    const rows = d.pupils.map((p) => h('tr', null,
      h('td', null, h('b', null, p.name), h('div', { class: 'muted small' }, p.username + (p.started ? '' : ' · not played yet'))),
      h('td', null, p.className), h('td', null, p.level), h('td', null, p.xp + ' / ' + p.need), h('td', null, p.hp + ' / ' + p.maxHp),
      h('td', null, p.gold + (p.runGold ? ' (+' + p.runGold + ')' : '')), h('td', null, p.jobName), h('td', null, p.floors), h('td', null, p.kills), h('td', { class: 'small' }, fmtTime(p.lastSeen)),
      h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => { S.pl.sel = p.id; render(); } }, 'Edit'))));
    root.replaceChildren(h('section', { class: 'panel' },
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Pupil stats (beta testing)'), cls, search,
        h('button', { class: 'btn small', type: 'button', onclick: csv }, 'Download CSV')),
      h('p', { class: 'muted small' }, d.pupils.length + ' pupil' + (d.pupils.length === 1 ? '' : 's') + '. Edits change real progress straight away, so use this for beta testing.'),
      d.pupils.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Pupil', 'Class', 'Level', 'XP', 'HP', 'Gold', 'Job', 'Floors cleared', 'Kills', 'Last seen', ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
        : h('p', { class: 'muted' }, 'No pupils match.')));
  }

  async function playersEdit(root, id) {
    const d = await api('/players/' + id), P = d.player;
    const back = () => { S.pl.sel = null; render(); };
    const num = (v, max) => h('input', { type: 'number', min: 0, max, step: 1, value: v, style: 'width:9em' });
    const f = { level: num(P.level, 500), xp: num(P.xp), hp: num(P.hp), gold: num(P.gold, 1e9), runGold: num(P.runGold, 1e9), kills: num(P.kills), floors: num(P.floors, d.topFloor), shop: num(P.shop, 4) };
    f.level.min = 1; f.hp.min = 1; f.shop.min = 1;
    const jobs = new Set(P.jobs), jobBox = h('div', { class: 'row', style: 'gap:6px 14px;flex-wrap:wrap' }), active = h('select', { 'aria-label': 'Active job' });
    const kids = (j) => Object.keys(d.jobs).filter((k) => d.jobs[k].p === j);
    const drop = (j) => { jobs.delete(j); kids(j).forEach(drop); };
    const add = (j) => { jobs.add(j); if (d.jobs[j].p) add(d.jobs[j].p); };
    const drawJobs = () => {
      jobs.add('villager');
      if (!jobs.has(active.value)) active.value = 'villager';
      jobBox.replaceChildren(...Object.entries(d.jobs).map(([k, j]) => {
        const cb = h('input', { type: 'checkbox', checked: jobs.has(k) ? true : null, disabled: k === 'villager' ? true : null });
        cb.checked = jobs.has(k);
        cb.addEventListener('change', () => { cb.checked ? add(k) : drop(k); drawJobs(); });
        return h('label', { class: 'row', style: 'gap:4px' }, cb, j.e + ' ' + j.n);
      }));
    };
    Object.entries(d.jobs).forEach(([k, j]) => active.append(h('option', { value: k }, j.e + ' ' + j.n)));
    active.value = P.job;
    active.addEventListener('change', () => { add(active.value); drawJobs(); });
    drawJobs();
    const slots = { weapon: ['Weapon', 'weapon'], armor: ['Armour', 'armor'], acc: ['Accessory', 'acc'], potion: ['Potion', 'use'] }, eq = {};
    for (const [k, [, kind]] of Object.entries(slots)) {
      eq[k] = h('select', { 'aria-label': slots[k][0] }, h('option', { value: '' }, '— none —'), Object.entries(d.items).filter(([, i]) => i.slot === kind).map(([id, i]) => h('option', { value: id }, i.e + ' ' + i.n)));
      eq[k].value = P[k] || '';
    }
    const inv = { ...d.inv }, invBox = h('div'), addSel = h('select', { 'aria-label': 'Add an item' }, h('option', { value: '' }, '+ Add an item…'), Object.entries(d.items).map(([id, i]) => h('option', { value: id }, i.e + ' ' + i.n + ' (' + i.slot + ')')));
    const drawInv = () => invBox.replaceChildren(...Object.entries(inv).map(([id, q]) => {
      const qi = h('input', { type: 'number', min: 0, max: 99, step: 1, value: q, style: 'width:5em', 'aria-label': d.items[id].n + ' quantity' });
      qi.addEventListener('input', () => { inv[id] = Number(qi.value); });
      return h('div', { class: 'row', style: 'gap:8px;align-items:center' }, h('span', { class: 'grow' }, d.items[id].e + ' ' + d.items[id].n), qi);
    }), Object.keys(inv).length ? null : h('p', { class: 'muted small' }, 'Nothing in the bag.'));
    addSel.addEventListener('change', () => { if (addSel.value && inv[addSel.value] == null) inv[addSel.value] = 1; addSel.value = ''; drawInv(); });
    drawInv();
    const auto = h('input', { type: 'checkbox' });
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);
    const save = guard(async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, Number(i.value)]));
      Object.assign(body, { job: active.value, jobs: [...jobs], inv, weapon: eq.weapon.value || null, armor: eq.armor.value || null, acc: eq.acc.value || null, potion: eq.potion.value || null });
      await api('/players/' + id, { method: 'PUT', body });
      await playersEdit(document.getElementById('tab'), id);
      flash('Saved. The pupil sees it the next time their game loads or they return to the village.');
    });
    const act = (label, cls, fn) => h('button', { class: 'btn small ' + cls, type: 'button', onclick: guard(fn) }, label);
    root.replaceChildren(h('section', { class: 'panel' },
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Edit ' + d.pupil.name + ' · ' + d.pupil.className), h('button', { class: 'btn small ghost', type: 'button', onclick: back }, '← All pupils')),
      h('p', { class: 'muted small' }, 'Saving ends any fight the pupil is in the middle of, so a stale fight can’t overwrite your numbers. A pupil who has the game open should return to the village or reload to see the change.' + (d.inFight ? ' This pupil is in a fight right now.' : '')),
      h('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap;align-items:end' },
        field('Level', f.level), field('XP into this level', f.xp, 'needs ' + P.need + ' at this level'), field('HP', f.hp, 'max ' + P.maxHp), field('Gold (banked)', f.gold), field('Gold in pack', f.runGold), field('Kills', f.kills), field('Floors cleared', f.floors, 'in a row from Floor 1, 0 to ' + d.topFloor), field('Shop level', f.shop, '1 to 4')),
      h('p', { class: 'muted small' }, 'Job points: ' + P.jobPoints + ' (a pupil’s level earns points; each extra job spends one). Story scenes seen: ' + P.storySeen + '.'),
      h('h3', null, 'Job'), field('Active job', active), h('p', { class: 'muted small' }, 'Tick the jobs they have unlocked. Ticking a job also ticks the ones it needs; unticking removes the ones that depend on it.'), jobBox,
      h('h3', null, 'Equipped'), h('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' }, Object.entries(slots).map(([k, [l]]) => field(l, eq[k]))),
      h('h3', null, 'Bag'), invBox, addSel,
      h('div', { class: 'row', style: 'gap:10px;margin-top:16px;flex-wrap:wrap' },
        h('button', { class: 'btn', type: 'button', onclick: save }, 'Save changes'),
        act('Replay story from the start', 'ghost', async () => { await api('/players/' + id, { method: 'PUT', body: { resetStory: true } }); await playersEdit(document.getElementById('tab'), id); flash('Story progress reset: the pupil will see the scenes again.'); }),
        act('Reset to a new player…', 'danger', async () => { if (!confirm('Reset ' + d.pupil.name + ' to a brand-new player? Level, gold, jobs, bag, floors and story progress are all deleted. Their answer history is kept.')) return; await api('/players/' + id + '/reset', { method: 'POST' }); await playersEdit(document.getElementById('tab'), id); flash('Reset.'); }))));
  }


  render();
})();
