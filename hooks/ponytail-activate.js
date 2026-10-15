#!/usr/bin/env node
// ponytail — Claude Code SessionStart activation hook
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.ponytail-active (defaults to ~/.claude; statusline reads this)
//   2. Emits ponytail ruleset as hidden SessionStart context
//   3. Refreshes the statusline script copy in the config dir, if the user installed one

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getDefaultMode, getClaudeDir } = require('./ponytail-config');
const { getPonytailInstructions } = require('./ponytail-instructions');
const { clearMode, readMode, setMode, writeHookOutput } = require('./ponytail-runtime');

const scriptName = 'ponytail-statusline.sh';
const scriptPath = path.join(getClaudeDir(), scriptName);

function activate(mode) {
  // "off" mode — skip activation entirely, don't write flag or emit rules
  if (mode === 'off') {
    clearMode();
    process.exit(0);
  }

  // 1. Write flag file
  try {
    setMode(mode);
  } catch (e) {
    // Silent fail -- flag is best-effort, don't block the hook
  }

  // 2. Emit the ponytail ruleset, filtered to the active intensity level.
  let output = getPonytailInstructions(mode);

  // 2b. Codebase map: what already exists, so "reuse first" costs no search. Fail open: a map
  // that cannot be built must never block or slow the session start.
  if (process.env.PONYTAIL_MAP !== '0') try {
    const map = execFileSync(process.execPath, [path.join(__dirname, 'ponytail-map.js')], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd();
    if (map) output += '\n\n' + map;
  } catch (e) { /* no map */ }

  // 3. Keep the statusline script copy fresh, once the user has put one in the
  // config dir. The plugin root is a versioned cache dir that Claude Code deletes
  // on update, so a statusLine pointing into it goes blank (#1032); the copy
  // survives updates and picks up script fixes. Copy to a new temp file, then
  // rename: the rename replaces a symlink at scriptPath instead of writing
  // through it, and a concurrent session never runs a half-written script.
  if (fs.existsSync(scriptPath)) try {
    const tmpPath = scriptPath + '.' + process.pid + '.tmp';
    try {
      fs.copyFileSync(path.join(__dirname, scriptName), tmpPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(tmpPath, 0o644);
      fs.renameSync(tmpPath, scriptPath);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* renamed */ }
    }
  } catch (e) {
    // Silent fail — don't block session start over the statusline copy
  }

  try {
    writeHookOutput('SessionStart', output);
  } catch (e) {
    // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
  }
}

// Compaction re-runs SessionStart inside the same conversation, so it keeps the
// live level (or stays off after "stop ponytail") instead of resetting to the
// default. Claude Code passes the trigger as `source` on stdin.
let input = '';
let done = false;

function finish() {
  if (done) return;
  done = true;
  let source = '';
  try {
    source = JSON.parse(input).source;
  } catch (e) {
    // No payload, or an unparseable one: treat it as a fresh session
  }
  activate(source === 'compact' ? (readMode() || 'off') : getDefaultMode());
}

process.stdin.on('data', chunk => { input += chunk; });
// Never hang the session start: recover on a stdin error or after a short
// ref'd fallback, and start at the default level.
process.stdin.on('end', () => { finish(); process.exit(0); });
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
