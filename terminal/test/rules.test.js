'use strict';
const path = require('path');
const rules = require('../rules.js');

module.exports = async function (ok) {
  const root = path.resolve('fixture-root');
  const after = (a, flag) => {
    const i = a.indexOf(flag), out = [];
    for (let j = i + 1; i >= 0 && j < a.length && !a[j].startsWith('--'); j++) out.push(a[j]);
    return out;
  };

  ok('ruleRoot turns a Windows path into //d/...',
    rules.ruleRoot('D:\\Apps\\v') === '//d/Apps/v' && rules.ruleRoot('/srv/u/v') === '//srv/u/v');

  const a = rules.claudeArgs({ root });
  ok('args deny Bash, web and notebook edits',
    after(a, '--disallowedTools').join(',') === 'Bash,WebFetch,WebSearch,NotebookEdit');

  const p = rules.ruleRoot(root) + '/projects/**';
  const allow = after(a, '--allowedTools');
  ok('args allow reads and edits only under projects/',
    allow.join(',') === ['Read', 'Grep', 'Glob', `Edit(${p})`, `Write(${p})`, `MultiEdit(${p})`].join(',') &&
    !allow.includes('Edit') && !allow.includes('Write'));

  ok('args pin the permission mode and drop MCP',
    after(a, '--permission-mode').join() === 'default' && a.includes('--strict-mcp-config') &&
    after(a, '--add-dir').join() === root);

  const b = rules.claudeArgs({ root, flags: ['--model', 'x', 42, null] });
  ok('extra flags come last and cannot remove a deny',
    b.slice(-2).join() === '--model,x' && b.length === a.length + 2 &&
    after(b, '--disallowedTools').join() === after(a, '--disallowedTools').join());
};
