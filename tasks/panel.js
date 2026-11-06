// Tasks panel (M6a). No Claude Design screen yet: built from the kit classes in shell/design/theme.css.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pad = n => String(n).padStart(2, '0');
const ROW = 'display:flex;flex-wrap:wrap;gap:12px;align-items:center;'; // theme.css has no .row (kit.html only)
const localDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export function mount(root, ctx) {
  let data = null, error = '', alive = true, addError = '', busy = false;
  const input = el('input', 'input');
  input.setAttribute('aria-label', 'New task');
  input.placeholder = 'Add a task — !p1 @2026-11-02 #tag work inline';

  async function load() {
    try { data = await ctx.api('list'); error = ''; } catch (e) { error = e.message; }
    if (alive) draw();
  }
  async function add() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    try { await ctx.api('add', { body: { text } }); input.value = ''; addError = ''; }
    catch (e) { addError = e.message; }
    busy = false;
    await load();
    input.focus();
  }
  async function toggle(t) {
    try { await ctx.api('toggle', { body: { index: t.i, raw: t.raw } }); }
    catch (e) { ctx.notify('Task list changed — refreshed', 'warn'); }
    await load();
  }
  async function archive() {
    try { const r = await ctx.api('archive', { body: {} }); ctx.notify('Archived ' + r.archived); }
    catch (e) { ctx.notify(e.message, 'error'); }
    await load();
  }

  function row(t, today) {
    const li = el('li');
    li.style.cssText = ROW + 'padding:10px 0;border-bottom:1px solid var(--line)';
    const label = el('label');
    label.style.cssText = ROW + 'cursor:pointer;flex:1;min-width:0';
    const box = el('input');
    box.type = 'checkbox';
    box.checked = t.done;
    box.setAttribute('aria-label', (t.done ? 'Done: ' : '') + (t.text || t.raw));
    box.addEventListener('change', () => toggle(t));
    label.append(box, el('span', t.done ? 'muted' : '', t.text || t.raw));
    li.append(label);
    if (t.priority) li.append(el('span', 'pill', 'p' + t.priority));
    if (t.due) li.append(el('span', 'pill' + (t.done ? '' : t.due < today ? ' pill-invalid' : t.due === today ? ' pill-loaded' : ''), t.due));
    for (const tag of t.tags) li.append(el('span', 'mono muted', '#' + tag));
    return li;
  }

  function draw() {
    // every tasks.changed redraws; keep the caret in the input so typing several tasks in a row works
    const typing = document.activeElement === input;
    root.innerHTML = '';
    if (error) { root.append(el('div', 'error', 'Tasks unavailable: ' + error)); return; }
    if (!data) { const k = el('div', 'skel'); k.style.cssText = 'height:56px;width:320px'; root.append(k); return; }
    const today = localDate(new Date());
    const open = data.tasks.filter(t => !t.done), done = data.tasks.filter(t => t.done);
    const overdue = open.filter(t => t.due && t.due < today).length, dueToday = open.filter(t => t.due === today).length;

    const head = el('section');
    head.append(el('div', 'label', 'TASKS'));
    const h1 = el('h1', 'serif', open.length + ' open'); h1.style.cssText = 'margin:14px 0 4px;font-size:48px;line-height:1.05';
    head.append(h1);
    const parts = [overdue ? overdue + ' overdue' : '', dueToday ? dueToday + ' due today' : ''].filter(Boolean);
    if (parts.length) head.append(el('div', 'muted', parts.join(' · ')));
    root.append(head);

    const form = el('div'); form.style.cssText = ROW + 'margin:24px 0 8px;flex-wrap:nowrap';
    const btn = el('button', 'btn btn-primary', 'Add');
    btn.addEventListener('click', add);
    input.setAttribute('aria-invalid', addError ? 'true' : 'false');
    form.append(input, btn);
    root.append(form);
    if (typing) input.focus();
    if (addError) root.append(el('div', 'error', addError));

    if (!open.length) root.append(el('div', 'empty', 'No open tasks.'));
    else {
      const ul = el('ul'); ul.style.cssText = 'list-style:none;margin:16px 0;padding:0';
      open.forEach(t => ul.append(row(t, today)));
      root.append(ul);
    }

    const foot = el('div'); foot.style.cssText = ROW + 'margin-top:16px';
    const arch = el('button', 'btn', 'Archive done');
    arch.disabled = done.length === 0;
    arch.addEventListener('click', archive);
    foot.append(el('span', 'muted', done.length + ' done'), arch);
    root.append(foot);
    if (done.length) {
      const ul = el('ul'); ul.style.cssText = 'list-style:none;margin:8px 0;padding:0';
      done.forEach(t => ul.append(row(t, today)));
      root.append(ul);
    }

    const k = data.skipped.length;
    if (k) root.append(el('div', 'warn', (k === 1 ? "1 line in tasks/tasks.md isn't" : k + " lines in tasks/tasks.md aren't") + ' read as tasks — run node system/lint.js'));
  }

  const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  input.addEventListener('keydown', onKey);
  const off = ctx.on('tasks.changed', load);
  load();
  return {
    unmount() {
      alive = false; off(); input.removeEventListener('keydown', onKey);
      root.innerHTML = '';
    }
  };
}
