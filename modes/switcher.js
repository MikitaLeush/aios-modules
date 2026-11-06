'use strict';
/* Runs a mode's steps in the fixed order close → dnd → audio → workspace → open (spec §6.3,
 * experiments.md). Every step runs even if an earlier one failed; nothing is force-killed.
 * `sys` does the OS work (windows.js, or drySys below), so this file has no I/O. */
const DND_TEXT = 'Do Not Disturb: not supported on Windows (needs a Microsoft feature unlock)';

function createSwitcher(sys) {
  let busy = null;

  async function closeStep(cfg, names) {
    const closed = [], notRunning = [], still = [], errors = [];
    // side by side: each app that ignores the close costs the full 5 s wait; results keep config order
    const results = await Promise.all(names.map(async n => {
      const app = cfg.apps[n];
      if (!app) return { n, error: 'unknown app "' + n + '"' };
      if (!app.process) return { n, error: n + ' has no process name' };
      try { return { n, r: await sys.close(app.process) }; } catch (e) { return { n, error: n + ': ' + e.message }; }
    }));
    for (const { n, r, error } of results) {
      if (error) errors.push(error);
      else (r === 'closed' ? closed : r === 'not-running' ? notRunning : still).push(n);
    }
    const bits = [];
    if (closed.length) bits.push('closed ' + closed.join(', '));
    if (notRunning.length) bits.push(notRunning.join(', ') + ' not running');
    if (still.length) bits.push(still.join(', ') + ' still running after 5s (not forced)');
    return { step: 'close', ok: !still.length && !errors.length, text: bits.concat(errors).join(' · ') };
  }

  async function audioStep(a) {
    try {
      const r = await sys.audio(a);
      return { step: 'audio', ok: true, text: 'audio → ' + (r.output || 'current device') + (r.volume !== undefined ? ' @ ' + r.volume + '%' : '') };
    } catch (e) {
      return { step: 'audio', ok: false, text: "couldn't set audio" + (a.output ? ' to ' + a.output : '') + ' (' + e.message + ')' };
    }
  }

  async function workspaceStep(name) {
    try {
      await sys.workspace(name);
      return { step: 'workspace', ok: true, text: 'workspace "' + name + '" launched (window placement is best effort)' };
    } catch (e) {
      return { step: 'workspace', ok: false, text: 'workspace "' + name + '" not launched (' + e.message + ')' };
    }
  }

  async function openStep(cfg, names) {
    const opened = [], errors = [];
    for (const n of names) {
      const app = cfg.apps[n];
      if (!app) { errors.push('unknown app "' + n + '"'); continue; }
      if (!app.launch) { errors.push(n + ' has no launch target'); continue; }
      try { await sys.launch(app.launch); opened.push(n); } catch (e) { errors.push(n + ': ' + e.message); }
    }
    return { step: 'open', ok: !errors.length, text: (opened.length ? ['opened ' + opened.join(', ')] : []).concat(errors).join(' · ') };
  }

  async function switchMode(name, cfg) {
    const mode = cfg.modes[name];
    if (!mode) throw new Error('no mode "' + name + '"');
    if (busy) throw new Error('already switching to ' + busy);
    busy = name;
    try {
      const steps = [];
      if (mode.close.length) steps.push(await closeStep(cfg, mode.close));
      if (mode.dnd !== undefined) steps.push({ step: 'dnd', ok: null, text: DND_TEXT });
      if (mode.audio) steps.push(await audioStep(mode.audio));
      if (mode.workspace) steps.push(await workspaceStep(mode.workspace));
      if (mode.open.length) steps.push(await openStep(cfg, mode.open));
      return { mode: name, at: new Date().toISOString(), steps };
    } finally {
      busy = null;
    }
  }

  // single-app commands must not interleave with a running switch
  const idle = fn => async (...a) => { if (busy) throw new Error('already switching to ' + busy); return fn(...a); };

  return {
    switchMode,
    openApp: idle((cfg, name) => openStep(cfg, [name])),
    closeApp: idle((cfg, name) => closeStep(cfg, [name])),
    setVolume: idle(n => audioStep({ volume: n })),
    busy: () => busy
  };
}

// A sys that changes nothing: records each call and reports success (dryRun, tests).
function drySys(log) {
  const rec = (kind, arg) => { if (log) log.push([kind, arg]); };
  return {
    async launch(t) { rec('launch', t); },
    async close(p) { rec('close', p); return 'closed'; },
    async workspace(n) { rec('workspace', n); },
    async audio(a) { rec('audio', a); return { output: a.output, volume: a.volume }; }
  };
}

module.exports = { createSwitcher, drySys, DND_TEXT };
