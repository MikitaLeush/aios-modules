'use strict';
/* Modes settings (machine.json → modules.modes) → a clean shape (spec §6.1). Bad entries
 * become `problems` the panel shows, instead of crashing a switch. Pure: no I/O. */
const PROC_RE = /^[A-Za-z0-9 ._()-]+\.exe$/i;
const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const strList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);

function normalize(settings) {
  const s = obj(settings);
  const problems = [];
  // no prototype: "toString" or "constructor" in hand-edited config must read as unknown
  const apps = Object.create(null);
  for (const [name, raw] of Object.entries(obj(s.apps))) {
    if (!NAME_RE.test(name)) { problems.push('app "' + name + '": name must be lowercase a-z, 0-9, -'); continue; }
    const a = obj(raw);
    const app = { name, aliases: strList(a.aliases) };
    if (typeof a.launch === 'string' && a.launch.trim()) app.launch = a.launch.trim();
    if (a.process !== undefined) {
      if (typeof a.process === 'string' && PROC_RE.test(a.process)) app.process = a.process;
      else problems.push('app "' + name + '": process must look like Name.exe');
    }
    apps[name] = app;
  }
  const modes = Object.create(null);
  for (const [name, raw] of Object.entries(obj(s.modes))) {
    if (!NAME_RE.test(name)) { problems.push('mode "' + name + '": name must be lowercase a-z, 0-9, -'); continue; }
    const m = obj(raw);
    const mode = { name, close: strList(m.close), open: strList(m.open) };
    if (typeof m.dnd === 'boolean') mode.dnd = m.dnd;
    if (m.audio !== undefined) {
      const a = obj(m.audio), au = {};
      if (typeof a.output === 'string' && a.output.trim()) au.output = a.output.trim();
      if (Number.isInteger(a.volume) && a.volume >= 0 && a.volume <= 100) au.volume = a.volume;
      else if (a.volume !== undefined) problems.push('mode "' + name + '": audio.volume must be a whole number 0-100');
      if (au.output || au.volume !== undefined) mode.audio = au;
    }
    if (typeof m.workspace === 'string' && m.workspace.trim()) mode.workspace = m.workspace.trim();
    for (const ref of mode.close.concat(mode.open)) if (!apps[ref]) problems.push('mode "' + name + '": unknown app "' + ref + '"');
    for (const ref of mode.close) if (apps[ref] && !apps[ref].process) problems.push('mode "' + name + '": app "' + ref + '" has no process to close');
    for (const ref of mode.open) if (apps[ref] && !apps[ref].launch) problems.push('mode "' + name + '": app "' + ref + '" has no launch target to open');
    modes[name] = mode;
  }
  const current = typeof s.current === 'string' && modes[s.current] ? s.current : null;
  return { apps, modes, current, dryRun: s.dryRun === true, problems };
}

const modeSlot = cfg => Object.keys(cfg.modes);
const appSlot = cfg => Object.values(cfg.apps).map(a => ({ value: a.name, aliases: a.aliases }));

function summary(mode) {
  const parts = [];
  if (mode.close.length) parts.push('closes ' + mode.close.join(', '));
  if (mode.audio) parts.push('audio' + (mode.audio.output ? ' → ' + mode.audio.output : '') + (mode.audio.volume !== undefined ? ' @ ' + mode.audio.volume + '%' : ''));
  if (mode.workspace) parts.push('workspace ' + mode.workspace);
  if (mode.open.length) parts.push('opens ' + mode.open.join(', '));
  return parts.join(' · ') || 'does nothing yet';
}

module.exports = { normalize, modeSlot, appSlot, summary, PROC_RE };
