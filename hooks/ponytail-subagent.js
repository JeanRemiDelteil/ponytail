#!/usr/bin/env node
// ponytail — Claude Code SubagentStart hook
//
// SessionStart context is parent-thread only and never reaches subagents, so
// without this every Task-spawned agent runs ponytail-unaware (issue #252).
// When ponytail mode is active, inject the same ruleset into each subagent.
//
// Scoping (opt-in, issue #506): set PONYTAIL_SUBAGENT_MATCHER to a regex and
// the ruleset is injected only into subagents whose agent_type matches. The
// regex is unanchored and case-insensitive — "explore|general" matches either,
// "^general$" is exact. Unset means inject into every subagent, as before.

const { getPonytailInstructions } = require('./ponytail-instructions');
const { readMode, writeHookOutput } = require('./ponytail-runtime');
const vm = require('vm');

const mode = readMode();

// Absent flag or off → ponytail isn't active; inject nothing.
if (!mode || mode === 'off') {
  process.exit(0);
}

function inject() {
  try {
    writeHookOutput('SubagentStart', getPonytailInstructions(mode));
  } catch (e) {
    // Silent fail — a stdout error at hook exit must not surface as a hook failure.
  }
}

// A bad regex must never crash the hook; treat it as "no matcher" and inject.
let matcherRe = null;
try {
  if (process.env.PONYTAIL_SUBAGENT_MATCHER) {
    matcherRe = new RegExp(process.env.PONYTAIL_SUBAGENT_MATCHER, 'i');
  }
} catch (e) {
  matcherRe = null;
}

// No matcher → nothing to read from stdin, inject right away.
if (!matcherRe) {
  inject();
  process.exit(0);
}

// Matcher set → read agent_type from stdin and skip only on a definite
// mismatch. Missing/unparseable agent_type, a stdin error, or the timeout all
// fail open (inject), so scoping never silently drops the persona.
let input = '';
let done = false;

function finish() {
  if (done) return;
  done = true;

  let agentType = '';
  try {
    agentType = String(JSON.parse(input).agent_type || '').trim();
  } catch (e) {
    // Unparseable payload — fall through and inject to be safe.
  }
  // .test() is synchronous, so a backtracking-heavy matcher like (a+)+$ would
  // block the event loop and the fallback timer below could never fire (#658).
  // Run it under a vm timeout; a timeout fails open like every other doubt.
  let matches = true;
  try {
    if (agentType) {
      matches = vm.runInNewContext('re.test(s)', { re: matcherRe, s: agentType }, { timeout: 100 });
    }
  } catch (e) {
    matches = true;
  }
  if (!matches) {
    process.exit(0);
  }
  inject();
}

process.stdin.on('data', chunk => { input += chunk; });
// Exit on 'end' (not just finish()) so the ref'd fallback timer below can't
// add its full 1000ms to the normal fast path.
process.stdin.on('end', () => { finish(); process.exit(0); });
// Never block the session: recover on stdin error or a short fallback.
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
