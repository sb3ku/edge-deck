'use strict';
// Adds or removes Edge Deck's PermissionRequest hook in Claude Code's user
// settings (~/.claude/settings.json). Only Edge Deck's own entry is touched,
// the file is backed up before the first change, and a file that is not valid
// JSON is never rewritten. The hook uses exec form (node.exe + script, no
// shell) and onFailure "continue", so a problem never blocks a tool call.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MARKER = 'claude-permission-hook.cjs';
const TIMEOUT_SECONDS = 60;

function isOurs(handler) {
  return Boolean(handler && handler.type === 'command' && Array.isArray(handler.args) && handler.args.some(arg => String(arg).endsWith(MARKER)));
}
function read(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Claude Code settings are not a JSON object.');
  return value;
}
function withoutOurs(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map(group => (group && Array.isArray(group.hooks) ? { ...group, hooks: group.hooks.filter(handler => !isOurs(handler)) } : group))
    .filter(group => !(group && Array.isArray(group.hooks) && group.hooks.length === 0));
}
function write(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = `${file}.edge-deck-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const temporary = `${file}.edge-deck.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function status(file) {
  try {
    const groups = read(file).hooks?.PermissionRequest;
    return { installed: Array.isArray(groups) && groups.some(group => Array.isArray(group?.hooks) && group.hooks.some(isOurs)), error: null };
  } catch { return { installed: false, error: 'Claude Code settings could not be read. Check ~/.claude/settings.json.' }; }
}
function install(file, { node, script }) {
  if (typeof node !== 'string' || !/node\.exe$/i.test(node) || typeof script !== 'string' || !script.endsWith(MARKER)) throw new Error('Edge Deck could not locate Node.js or its hook script.');
  let settings;
  try { settings = read(file); } catch { throw new Error('Claude Code settings are not valid JSON, so Edge Deck did not change them.'); }
  const hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
  const groups = withoutOurs(hooks.PermissionRequest);
  groups.push({ hooks: [{ type: 'command', command: node, args: [script], timeout: TIMEOUT_SECONDS, onFailure: 'continue' }] });
  write(file, { ...settings, hooks: { ...hooks, PermissionRequest: groups } });
  return status(file);
}
function uninstall(file) {
  let settings;
  try { settings = read(file); } catch { throw new Error('Claude Code settings are not valid JSON, so Edge Deck did not change them.'); }
  const hooks = settings.hooks;
  if (!hooks || !Array.isArray(hooks.PermissionRequest) || !hooks.PermissionRequest.some(group => Array.isArray(group?.hooks) && group.hooks.some(isOurs))) return status(file);
  const groups = withoutOurs(hooks.PermissionRequest);
  const nextHooks = { ...hooks };
  if (groups.length) nextHooks.PermissionRequest = groups; else delete nextHooks.PermissionRequest;
  const next = { ...settings };
  if (Object.keys(nextHooks).length) next.hooks = nextHooks; else delete next.hooks;
  write(file, next);
  return status(file);
}
// The node.exe on PATH (Claude Code runs exec-form hooks without a shell).
function findNode() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') { resolve(null); return; }
    execFile('where.exe', ['node.exe'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      const found = String(stdout || '').split(/\r?\n/).map(line => line.trim()).find(line => /node\.exe$/i.test(line) && fs.existsSync(line));
      resolve(error && !found ? null : found || null);
    });
  });
}

module.exports = { install, uninstall, status, findNode, isOurs };
