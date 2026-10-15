#!/usr/bin/env node
// ponytail — UserPromptSubmit hook to track which ponytail mode is active
// Inspects user input for /ponytail commands and writes mode to flag file

const { getDefaultMode, isDeactivationCommand, writeDefaultMode } = require('./ponytail-config');
const { clearMode, readMode, setMode, writeHookOutput } = require('./ponytail-runtime');

let input = '';
let done = false;

function finish() {
  if (done) return;
  done = true;
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim().toLowerCase();

    if (isDeactivationCommand(prompt)) {
      clearMode();
      writeHookOutput('UserPromptSubmit', 'PONYTAIL MODE OFF');
      return;
    }

    // Match /ponytail commands. /ponytail-review is a one-shot skill, not a
    // session level (#736), so only the bare command switches modes.
    const parts = prompt.split(/\s+/);
    if (parts[0] !== '/ponytail' && parts[0] !== '/ponytail:ponytail') return;
    const arg = parts[1] || '';

    // `/ponytail default <mode>` persists the default to config (survives
    // restarts). Plain switches stay session-scoped ("sticks until session
    // end"), so this is the only path that writes config.
    if (arg === 'default') {
      const dmode = writeDefaultMode(parts[2]);
      if (dmode) writeHookOutput('UserPromptSubmit', 'PONYTAIL DEFAULT SET — new sessions start in ' + dmode + '.');
      return;
    }

    let mode = null;
    if (arg === 'lite' || arg === 'full' || arg === 'ultra' || arg === 'off') mode = arg;
    else if (arg === '') {
      // Bare /ponytail switches ponytail on: off → the default level (full if
      // the default is off too); already on → keep the level, report it (#639).
      const live = readMode();
      if (live && live !== 'off') {
        writeHookOutput('UserPromptSubmit', 'PONYTAIL MODE ACTIVE — level: ' + live);
        return;
      }
      mode = getDefaultMode() === 'off' ? 'full' : getDefaultMode();
    }

    if (mode === 'off') {
      clearMode();
      writeHookOutput('UserPromptSubmit', 'PONYTAIL MODE OFF');
    } else if (mode) {
      setMode(mode);
      writeHookOutput('UserPromptSubmit', 'PONYTAIL MODE CHANGED — level: ' + mode);
    }
  } catch (e) {
    // Silent fail
  }
}

process.stdin.on('data', chunk => { input += chunk; });
// Exit on 'end', not just finish(): the fallback timer below is ref'd and would
// otherwise keep the process alive for its full 1000ms on this normal fast path.
process.stdin.on('end', () => { finish(); process.exit(0); });
// Never hang the session: on a stdin error, or if stdin never ends, process
// whatever arrived and exit.
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
