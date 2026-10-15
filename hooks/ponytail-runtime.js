const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { getClaudeDir } = require('./ponytail-config');

const STATE_FILE = '.ponytail-active';

const stateDir = getClaudeDir();
const statePath = path.join(stateDir, STATE_FILE);

// Claude Code hands every hook its project dir, so the live mode is kept per
// project and concurrent sessions in different repos stop overwriting each other
// (#662, #809). Without it, only the single shared flag is used.
// ponytail: sessions in the SAME repo still share one mode, and the statusline
// script reads the shared flag (last write wins); key by session_id if either matters.
const projectDir = (process.env.CLAUDE_PROJECT_DIR || '').trim();
const projectStatePath = projectDir
  ? path.join(stateDir, 'ponytail-modes',
    createHash('sha256').update(path.normalize(projectDir)).digest('hex'))
  : null;

// The shared flag is still written, for the statusline.
function setMode(mode) {
  for (const file of [projectStatePath, statePath]) {
    if (!file) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mode);
  }
}

function clearMode() {
  for (const file of [projectStatePath, statePath]) {
    if (file) try { fs.unlinkSync(file); } catch (e) {}
  }
}

// Live mode written by activate/mode-tracker. Absent flag = ponytail off.
function readMode() {
  try {
    return fs.readFileSync(projectStatePath || statePath, 'utf8').trim() || null;
  } catch (e) {
    return null;
  }
}

// Synchronous: every hook calls process.exit() right after this, and a pending
// async write would die with the process (#1043).
function writeOut(text) {
  fs.writeSync(1, text);
}

// SessionStart and UserPromptSubmit accept raw stdout, but SubagentStart needs
// the hookSpecificOutput JSON form or the context is dropped.
function writeHookOutput(event, context = '') {
  if (event === 'SubagentStart') {
    writeOut(JSON.stringify(
      { hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
    return;
  }
  writeOut(context);
}

module.exports = {
  clearMode,
  readMode,
  setMode,
  writeHookOutput,
};
