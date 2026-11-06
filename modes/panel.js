// Modes panel (spec §6.4). Markup mirrors shell/design/screens/modes.html; screen-only classes
// live in assets/panel.css. Switching goes through the command registry (ctx.run), so the
// panel, the palette and Viero behave the same.
const ICONS = {
  focus: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  game: '<path d="M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 0.8A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11" r=".6"/><circle cx="17" cy="12.5" r=".6"/>',
  relax: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'
};
const DEFAULT_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function mount(root, ctx) {
  if (!document.getElementById('modes-css')) {
    const l = document.createElement('link');
    l.id = 'modes-css'; l.rel = 'stylesheet'; l.href = '/m/modes/assets/panel.css';
    document.head.appendChild(l);
  }
  let state = null, busy = null, alive = true, error = '';
  root.tabIndex = 0;
  root.setAttribute('aria-label', 'Modes panel. Press a number to switch.');

  async function load() {
    try { state = await ctx.api('state'); error = ''; } catch (e) { error = e.message; }
    if (alive) draw();
  }

  async function pick(name) {
    if (busy) return;
    busy = name; draw();
    try { await ctx.run(name + ' mode'); } finally { busy = null; load(); }
  }

  function stepRow(s) {
    const row = el('div', 'step');
    const cls = s.ok === false ? 'error' : s.ok === null ? 'muted' : '';
    const mark = el('span', cls, s.ok === false ? '✗' : s.ok === null ? '—' : '✓');
    if (s.ok === true) mark.style.color = 'var(--accent)';
    row.append(mark, el('span', cls, s.text));
    return row;
  }

  // draw() rebuilds the panel, so keyboard focus is put back where it was (a mode button, or the panel).
  function draw() {
    const a = document.activeElement;
    const had = root.contains(a) ? (a.dataset && a.dataset.mode) || '' : null;
    render();
    if (had === null) return;
    const back = had && Array.from(root.querySelectorAll('.mode')).find(b => b.dataset.mode === had);
    (back || root).focus();
  }

  function render() {
    root.innerHTML = '';
    if (error) { root.append(el('div', 'error', 'Modes unavailable: ' + error)); return; }
    if (!state) { const s = el('div', 'skel'); s.style.cssText = 'height:56px;width:320px'; root.append(s); return; }

    const head = el('section');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-end;gap:16px';
    const t = el('div');
    t.append(el('div', 'label', 'Right now'));
    const h1 = el('h1', 'serif');
    h1.style.cssText = 'margin:8px 0 0;font-size:56px;line-height:1';
    if (state.current) {
      h1.append(cap(state.current) + ' ');
      const em = el('em', 'muted', 'mode'); em.style.fontSize = '40px'; h1.append(em);
    } else h1.textContent = 'No mode yet';
    t.append(h1);
    head.append(t);
    if (state.modes.length) {
      const hint = el('p', 'muted'); hint.style.cssText = 'margin:0;font-size:14px';
      hint.append('Press ');
      state.modes.slice(0, 9).forEach((m, i) => hint.append(el('span', 'kbd', String(i + 1)), ' '));
      hint.append('while this panel has focus');
      head.append(hint);
    }
    root.append(head);

    if (state.dryRun) root.append(el('div', 'warn', 'Dry run: steps are recorded, nothing on this computer changes (modules.modes.dryRun in system/machine.json).'));
    if (state.applyPending) root.append(el('div', 'warn', 'dryRun changed in system/machine.json — restart AIOS (or turn Modes off and on) to apply it.'));
    if (state.problems.length) {
      const p = el('div', 'card'); p.style.padding = '18px 24px';
      p.append(el('div', 'warn', 'Check modules.modes in system/machine.json:'));
      for (const msg of state.problems) p.append(el('div', 'muted', '· ' + msg));
      root.append(p);
    }
    if (!state.modes.length) {
      root.append(el('div', 'empty', 'No modes yet. Add them under modules.modes in system/machine.json — see modules/modes/README.md.'));
      return;
    }

    const grid = el('section', 'modes-grid');
    state.modes.forEach((m, i) => {
      const on = state.current === m.name;
      const b = el('button', 'mode'); b.type = 'button'; b.dataset.mode = m.name;
      b.setAttribute('aria-pressed', String(on));
      if (busy === m.name) b.setAttribute('aria-busy', 'true');
      const top = el('div'); top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%';
      top.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:' +
        (on ? 'var(--accent)' : 'var(--muted)') + '" aria-hidden="true">' + (Object.prototype.hasOwnProperty.call(ICONS, m.name) ? ICONS[m.name] : DEFAULT_ICON) + '</svg>';
      if (busy === m.name) top.append(el('span', 'spin'));
      else if (i < 9) top.append(el('span', 'kbd', String(i + 1)));
      const body = el('div');
      const nm = el('div', 'serif', cap(m.name)); nm.style.cssText = 'font-size:40px;line-height:1';
      const sub = el('div', 'muted', (on ? 'On now · ' : '') + m.summary); sub.style.cssText = 'font-size:14px;margin-top:6px';
      body.append(nm, sub);
      b.append(top, body);
      b.addEventListener('click', () => pick(m.name));
      grid.append(b);
    });
    root.append(grid);

    const cols = el('section', 'modes-cols');
    const lastCard = el('div', 'card'); lastCard.style.padding = '24px 28px';
    const lh = el('div'); lh.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:10px';
    const lt = el('span', 'muted', 'Last switch'); lt.style.fontSize = '14px';
    lh.append(lt);
    if (state.last) {
      const when = el('span', 'mono muted', '→ ' + cap(state.last.mode) + ' · ' + new Date(state.last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      when.style.fontSize = '12px'; lh.append(when);
    }
    const steps = el('div');
    if (!state.last) steps.append(el('div', 'muted', 'Nothing switched since AIOS started.'));
    else if (!state.last.steps.length) steps.append(el('div', 'muted', 'That mode has no steps.'));
    else for (const s of state.last.steps) steps.append(stepRow(s));
    lastCard.append(lh, steps);

    const appsCard = el('div', 'card'); appsCard.style.padding = '24px 28px';
    const at = el('div', 'muted', 'Apps'); at.style.cssText = 'font-size:14px;margin-bottom:10px';
    const apps = el('div');
    if (!state.apps.length) apps.append(el('div', 'muted', 'No apps configured.'));
    state.apps.forEach((a, i) => {
      const row = el('div', 'step');
      const n = el('span', 'mono muted', String(i + 1).padStart(2, '0')); n.style.fontSize = '12px';
      const name = el('span', null, a.name);
      if (a.aliases.length) { const al = el('span', 'muted', ' · ' + a.aliases.join(', ')); al.style.fontSize = '13px'; name.append(al); }
      row.append(n, name);
      apps.append(row);
    });
    appsCard.append(at, apps);
    cols.append(lastCard, appsCard);
    root.append(cols);
  }

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input, textarea'))) return;
    const i = parseInt(e.key, 10);
    if (i >= 1 && i <= 9 && state && state.modes[i - 1]) { e.preventDefault(); pick(state.modes[i - 1].name); }
  };
  root.addEventListener('keydown', onKey);
  const off = ctx.on('modes.changed', () => load());
  load();

  return {
    unmount() {
      alive = false;
      root.removeEventListener('keydown', onKey);
      root.removeAttribute('tabindex'); root.removeAttribute('aria-label');
      off();
      root.innerHTML = '';
    }
  };
}
