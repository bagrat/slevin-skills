#!/usr/bin/env node
// Checks the skills against the agent contract.
//
//   node scripts/check-tools.mjs <path to CONTRACT.md>
//
// - The tool list is the first column of CONTRACT.md's "Who may call what" table.
// - Inputs are the top-level keys of every `tool({ … })` signature in CONTRACT.md.
// - In the skills (CLAUDE.md, README.md, .claude/skills/**), a tool is written in backticks with
//   parentheses: `attach()` or `ask({ asks })`. Every such name must be in the tool list, and
//   every top-level input must be in its signature. A backticked bare word that is a tool name
//   counts as a mention too.
// - The old working title must appear nowhere.
// Cloud tools (get_session, create_session, …) are written in bold, not backticks.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const contractPath = process.argv[2];
if (!contractPath) {
  console.error("usage: node scripts/check-tools.mjs <path to CONTRACT.md>");
  process.exit(2);
}
const contract = readFileSync(contractPath, "utf8");
const root = new URL("..", import.meta.url).pathname;

// The tool list: rows of the table under "## 2. Who may call what".
const section = contract.split(/^## /m).find((s) => s.startsWith("2. Who may call what"));
if (!section) fail(["CONTRACT.md has no '## 2. Who may call what' section"]);
const tools = new Set();
for (const line of section.split("\n")) {
  if (!line.startsWith("| `")) continue;
  const first = line.split("|")[1];
  for (const m of first.matchAll(/`([a-z_]+)`/g)) tools.add(m[1]);
}

// Top-level keys of the object literal starting at text[open] === "{".
function topKeys(text, open) {
  const keys = new Set();
  let depth = 0;
  let expectKey = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      i = end < 0 ? text.length : end;
      continue;
    }
    if ("{[(".includes(c)) {
      depth++;
      if (depth === 1) expectKey = true;
      continue;
    }
    if ("}])".includes(c)) {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (c === ",") { expectKey = true; continue; }
    if (expectKey && /[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
      keys.add(m[0]);
      i += m[0].length - 1;
      expectKey = false;
    } else if (!/\s/.test(c)) {
      expectKey = false;
    }
  }
  return keys;
}

// Signatures in CONTRACT.md: name({ … }).
const inputs = new Map();
for (const m of contract.matchAll(/\b([a-z_]+)\(\{/g)) {
  if (!tools.has(m[1])) continue;
  const keys = topKeys(contract, m.index + m[0].length - 1);
  const known = inputs.get(m[1]) ?? new Set();
  for (const k of keys) known.add(k);
  inputs.set(m[1], known);
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".md") ? [p] : [];
  });
}
const skillFiles = [
  join(root, "CLAUDE.md"),
  join(root, "README.md"),
  ...files(join(root, ".claude/skills")),
];

const problems = [];
const used = new Map();
const oldTitle = new RegExp(["b", "ench"].join(""), "i");
for (const file of [...skillFiles, ...files(join(root, "scripts")).concat(
  readdirSync(join(root, ".claude/skills/relay")).map((n) => join(root, ".claude/skills/relay", n)),
)]) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const where = relative(root, file);
  if (oldTitle.test(text) && !file.endsWith("check-tools.mjs")) problems.push(`${where}: the old working title appears`);
  if (!file.endsWith(".md")) continue;
  // Inline code spans (fenced blocks are skipped: they hold prompts and shell).
  const prose = text.replace(/^```[\s\S]*?^```/gm, "");
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    const call = /^([a-z][a-z_]*)\(/.exec(span);
    const bare = tools.has(span) ? span : null;
    const name = call ? call[1] : bare;
    if (!name) continue;
    const line = text.slice(0, text.indexOf(m[0])).split("\n").length;
    if (!tools.has(name)) {
      problems.push(`${where}:${line}: \`${name}\` is not a tool in CONTRACT.md`);
      continue;
    }
    used.set(name, (used.get(name) ?? 0) + 1);
    const brace = span.indexOf("({");
    if (call && brace >= 0 && inputs.has(name)) {
      for (const k of topKeys(span, brace + 1)) {
        if (!inputs.get(name).has(k)) {
          problems.push(`${where}:${line}: \`${name}\` has no input \`${k}\` (takes ${[...inputs.get(name)].join(", ")})`);
        }
      }
    }
  }
}

const unused = [...tools].filter((t) => !used.has(t));
console.log(`CONTRACT.md: ${tools.size} tools, ${inputs.size} with signatures.`);
console.log(`Skills: ${[...used.values()].reduce((a, b) => a + b, 0)} tool mentions, ${used.size} tools used.`);
if (unused.length) console.log(`Not mentioned in any skill: ${unused.join(", ")}`);
if (problems.length) fail(problems);
console.log("OK");

function fail(lines) {
  for (const l of lines) console.error(`✗ ${l}`);
  process.exit(1);
}
