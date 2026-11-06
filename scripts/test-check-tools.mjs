#!/usr/bin/env node
// Plants each kind of error check-tools.mjs is meant to catch, one at a time, in a copy of this repo,
// and sees each one caught: the check fails with that problem, which the unplanted copy doesn't have.
// (Whether the unplanted copy passes is check-tools.mjs's own answer; it is shown, not tested here.)
//
//   node scripts/test-check-tools.mjs <path to CONTRACT.md>

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const contract = process.argv[2];
if (!contract) {
  console.error("usage: node scripts/test-check-tools.mjs <path to CONTRACT.md>");
  process.exit(2);
}
const root = new URL("..", import.meta.url).pathname;
const checker = join(root, "scripts/check-tools.mjs");

const append = (file, text) => (dir) => writeFileSync(join(dir, file), readFileSync(join(dir, file), "utf8") + text);
// Changes the "**You may call:**" paragraph of a skill only.
const mayCall = (skill, edit) => (dir) => {
  const p = join(dir, ".claude/skills", skill, "SKILL.md");
  const text = readFileSync(p, "utf8");
  const m = /^\*\*You may call:\*\*[\s\S]*?(?=\n\s*\n)/m.exec(text);
  writeFileSync(p, text.slice(0, m.index) + edit(m[0]) + text.slice(m.index + m[0].length));
};
// Rewrites a file with a function of its text.
const edit = (file, f) => (dir) => writeFileSync(join(dir, file), f(readFileSync(join(dir, file), "utf8")));
const old = ["B", "ench"].join("");

const plants = [
  ["an unknown tool", append("CLAUDE.md", "\nCall `relay_pull()` now.\n"), /`relay_pull\(\)` is not a tool/],
  ["an unknown top-level input", append(".claude/skills/chat/SKILL.md", "\nThen `end({ summary, outcome })`.\n"), /end has no input `outcome`/],
  ["an unknown attach input", append("CLAUDE.md", "\nThen `attach({ key, session, skills, mail })`.\n"), /attach has no input `mail`/],
  ["an unknown nested input in a list", append(".claude/skills/card-manager/SKILL.md", "\nUse `ask({ asks: [{ kind, text, label }] })`.\n"), /ask\.asks\[0\] has no input `label`/],
  ["a value outside a literal union", append(".claude/skills/chat/SKILL.md", '\nHand it over: `turn({ turn: "Him" })`.\n'), /turn\.turn is "Him"/],
  ["an unknown union tag", append(".claude/skills/account-manager/SKILL.md", '\nThen `key({ for: { t: "Relays" } })`.\n'), /key\.for\.t is "Relays"/],
  ["an unknown key in a tagged branch", append(".claude/skills/workspace-manager/SKILL.md", '\nSort it: `sort({ note, to: { t: "OntoCard", cards } })`.\n'), /sort\.to has no input `cards`/],
  ["a bad input in a call that wraps a line", append(".claude/skills/card-manager/SKILL.md", "\nThen `report({ doing,\n  checkIn })` at once.\n"), /report has no input `checkIn`/],
  ["an unknown refusal name", append(".claude/skills/relay/SKILL.md", "\nOn `post-gone`, stop.\n"), /`post-gone` is not a refusal/],
  ["an unknown /agent/ path in a script", append(".claude/skills/relay/poll.sh", '\n# curl "$base/agent/relay_pol"\n'), /\/agent\/relay_pol is not a tool/],
  ["a tool outside the role in its list", mayCall("relay", (s) => s.replace("`relay_more()`", "`relay_more()`, `ask()`")), /lists `ask\(\)`, which §2 doesn't give the relay/],
  ["a tool of the role missing from its list", mayCall("chat", (s) => s.replace(/`end\(\)`/, "`whoami()`")), /leaves out `end\(\)`, which §2 gives the chat/],
  ["an unknown wake subject in a wakes table", append(".claude/skills/chat/SKILL.md", "\n| Subject | Do |\n| --- | --- |\n| `ChatClosed` | Stop. |\n"), /`ChatClosed` is not a wake subject/],
  ["an unknown due reason in a due table", append(".claude/skills/account-manager/SKILL.md", "\n| reason | Do |\n| --- | --- |\n| `Stale` | Spawn one. |\n"), /`Stale` is not a due reason/],
  ["the card manager working before his Start", edit(".claude/skills/card-manager/SKILL.md", (t) => t.replace("Before his Start: no helper, no code, no PR.", "Start helpers at once.")), /ask before you work: the line "Before his Start/],
  ["the plan ask without \"Not now\"", edit(".claude/skills/card-manager/SKILL.md", (t) => t.replace(' and "Not now".', ".")), /ask before you work: the plan ask's options/],
  ["a setup problem outside its union", append(".claude/skills/workspace-manager/SKILL.md", '\nThen `setup_problem({ problem: "Broken" })`.\n'), /setup_problem\.problem is "Broken"/],
  ["an unknown key in workspace_edit's environment", append(".claude/skills/workspace-manager/SKILL.md", "\nThen `workspace_edit({ workspace, environment: { id, label } })`.\n"), /workspace_edit\.environment has no input `label`/],
  ["a helper started without the setup check", edit(".claude/skills/card-manager/SKILL.md", (t) => t.replace("Before starting any helper, run the setup check", "Start helpers when you like, after the check")), /the Helpers section doesn't run the setup check/],
  ["a helper's create_session without the environment", edit(".claude/skills/card-manager/SKILL.md", (t) => t.replace("with `environment_id` the workspace's environment id and ", "with ")), /create_session doesn't name `environment_id`/],
  ["a helper's create_session without the main repo", edit(".claude/skills/card-manager/SKILL.md", (t) => t.replace("`https://github.com/<mainRepo>`", "of the repo")), /create_session doesn't use the main repo/],
  ["a card manager clearing a setup problem", append(".claude/skills/card-manager/SKILL.md", "\nWhen it works again, `setup_problem({ problem: null })`.\n"), /the card manager clears a setup problem/],
  ["onboarding without the restart check", edit(".claude/skills/onboarding/SKILL.md", (t) => t.replace("before anything else, `whoami()`", "when you like, `whoami()`")), /onboarding: it doesn't check `whoami\(\)` first/],
  ["the old working title", append("README.md", `\nOnce called ${old}.\n`), /the old working title appears/],
];

function copy() {
  const dir = mkdtempSync(join(tmpdir(), "check-tools-test-"));
  for (const p of ["CLAUDE.md", "README.md", ".claude", "scripts"]) cpSync(join(root, p), join(dir, p), { recursive: true });
  return dir;
}
const check = (dir) => spawnSync("node", [checker, contract, "--root", dir], { encoding: "utf8" });

const results = [];
let baseline;
{
  const dir = copy();
  baseline = check(dir);
  console.log(baseline.status === 0 ? "· the unplanted copy passes" : `· the unplanted copy has ${baseline.stderr.trim().split("\n").length} problems of its own`);
  rmSync(dir, { recursive: true, force: true });
}
for (const [name, plant, expect] of plants) {
  const dir = copy();
  plant(dir);
  const r = check(dir);
  const caught = r.status === 1 && expect.test(r.stderr) && !expect.test(baseline.stderr);
  results.push(caught ? `✓ caught: ${name}` : `✗ missed: ${name} (exit ${r.status})\n${r.stderr}`);
  rmSync(dir, { recursive: true, force: true });
}
for (const l of results) console.log(l);
const failed = results.filter((l) => l.startsWith("✗")).length;
console.log(failed ? `${failed} failed` : `OK: ${plants.length} planted errors caught`);
process.exit(failed ? 1 : 0);
