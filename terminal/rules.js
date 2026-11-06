'use strict';
/* The one Claude permission rule: the vault is read-only, edits only under projects/,
 * no Bash, no MCP, no web. Used by the terminal module and by legacy /api/chat. */

// Claude Code absolute-path rule form: D:\Apps\x -> //d/Apps/x, /srv/u/x -> //srv/u/x
function ruleRoot(abs) {
  const p = String(abs).replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase());
  return '//' + p.replace(/^\/+/, '');
}

function claudeArgs({ root, flags } = {}) {
  const under = ruleRoot(root) + '/projects/**';
  return [
    '--permission-mode', 'default',
    '--strict-mcp-config',
    '--add-dir', root,
    '--disallowedTools', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit',
    '--allowedTools', 'Read', 'Grep', 'Glob', `Edit(${under})`, `Write(${under})`, `MultiEdit(${under})`,
    // extra flags go last and are plain strings; they cannot lift a deny above
    ...(Array.isArray(flags) ? flags.filter(f => typeof f === 'string') : []),
  ];
}

module.exports = { claudeArgs, ruleRoot };
