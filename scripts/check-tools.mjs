#!/usr/bin/env node
// Checks the skills against the agent contract.
//
//   node scripts/check-tools.mjs <path to CONTRACT.md> [--root <skills checkout>]
//
// What it reads from CONTRACT.md:
// - the tools and who may call them: the "## 2. Who may call what" table (first column, and one
//   column per role; "—" means the role may not);
// - every tool's inputs and their types: each `tool({ … })` signature anywhere in the file, parsed as
//   TypeScript-like types, with the named types it defines (`type KeyFor = …`, `type Post = …`);
// - the refusal names: every backticked kebab-case name in "## 10. Results and refusals";
// - the wake subjects (`type WakeSubject`) and due reasons (`type DueReason`).
//
// What it checks in the skills (CLAUDE.md, README.md, .claude/skills/**):
// 1. A Slevin tool is written in backticks with parentheses (`attach()`, `ask({ asks })`); a span may
//    wrap a line. Every such name, and every backticked bare tool name, must be a tool.
// 2. Every input of a call, at any depth, must be in the signature: top-level keys, keys of nested
//    objects and of objects in arrays, string values against literal unions (`turn: "Human"`), and
//    `t` tags against tagged unions (`for: { t: "NewRelay" }`), checking the keys of the branch the
//    tag picks. Names without a value (`{ for, request }`) are only checked as keys.
// 3. Every backticked kebab-case name that isn't a skill's name must be a refusal in §10.
// 4. Every `/agent/<tool>` path, in any file (the .sh scripts included), must name a tool.
// 5. Each skill's "**You may call:**" list must name exactly the tools §2 gives its role.
// 6. In a wakes table (first column "Subject") every backticked PascalCase name must be a wake
//    subject; in a due table (first column "reason") every one must be a due reason.
// 7. The old working title must appear nowhere.
// 8. The card-manager skill keeps "ask before you work": the plan ask's three options and the
//    "before his Start" line.
// 9. The card-manager skill's Helpers section runs the setup check before any helper.
// 10. Its helper create_session names `environment_id` and `https://github.com/<mainRepo>`.
// 11. The card manager never clears a setup problem (`setup_problem({ problem: null })`).
// 12. The onboarding skill checks `whoami()` first, and with a workspace already there it's a restart.
// Cloud tools (get_session, create_session, …) are written in bold, not backticks, so they aren't
// taken for Slevin's. Fenced code blocks hold prompts and shell, and are skipped by 1–3 and 6.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const args = process.argv.slice(2);
const rootAt = args.indexOf("--root");
const root = rootAt >= 0 ? args.splice(rootAt, 2)[1] : new URL("..", import.meta.url).pathname;
const contractPath = args[0];
if (!contractPath) {
  console.error("usage: node scripts/check-tools.mjs <path to CONTRACT.md> [--root <dir>]");
  process.exit(2);
}
const contract = readFileSync(contractPath, "utf8");

// ---------- CONTRACT.md: tools and roles (§2) ----------

const sectionOf = (prefix) => contract.split(/^## /m).find((s) => s.startsWith(prefix));
const s2 = sectionOf("2. Who may call what");
if (!s2) fail(["CONTRACT.md has no '## 2. Who may call what' section"]);
const tools = new Set();
const roleTools = new Map(); // skill directory name → Set of tools
{
  const rows = s2.split("\n").filter((l) => l.startsWith("|"));
  const head = rows[0].split("|").slice(2, -1).map((c) => c.trim().toLowerCase().replace(/\s+/g, "-"));
  for (const r of head) roleTools.set(r, new Set());
  for (const line of rows) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|").slice(1, -1);
    const names = [...cells[0].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    for (const n of names) tools.add(n);
    cells.slice(1).forEach((cell, i) => {
      if (cell.trim() === "—" || cell.trim() === "-") return;
      for (const n of names) roleTools.get(head[i]).add(n);
    });
  }
}

// ---------- CONTRACT.md: types ----------
// Type: { k: "any" } | { k: "lit", vals: Set } | { k: "obj", fields: Map<name, Type> }
//     | { k: "arr", of: Type } | { k: "union", of: Type[] } | { k: "ref", name }

const ANY = { k: "any" };
const NULL = { k: "null" }; // `| null` in a union: no string matches it

function lexer(text, start) {
  let i = start;
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) {
        const e = text.indexOf("\n", i);
        i = e < 0 ? text.length : e;
        continue;
      }
      return;
    }
  };
  return {
    get pos() { return i; },
    peek() { skip(); return text[i]; },
    peekWord() { skip(); return /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))?.[0] ?? null; },
    eat(c) { skip(); if (text.startsWith(c, i)) { i += c.length; return true; } return false; },
    word() { skip(); const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))?.[0]; if (w) i += w.length; return w ?? null; },
    str() {
      skip();
      const q = text[i];
      if (q !== '"' && q !== "'") return null;
      const e = text.indexOf(q, i + 1);
      if (e < 0) return null;
      const s = text.slice(i + 1, e);
      i = e + 1;
      return s;
    },
    // Skip one balanced chunk up to a separator at depth 0 (for what the parser doesn't model).
    skipTo(stops) {
      let depth = 0;
      for (; i < text.length; i++) {
        const c = text[i];
        if (depth === 0 && stops.includes(c)) return;
        if ("{[(<".includes(c)) depth++;
        else if ("}])>".includes(c)) { if (depth === 0) return; depth--; }
        else if (c === '"' || c === "'") { const e = text.indexOf(c, i + 1); i = e < 0 ? text.length : e; }
      }
    },
  };
}

function parseType(lx) {
  const members = [];
  lx.eat("|");
  do members.push(parseMember(lx)); while (lx.eat("|"));
  return members.length === 1 ? members[0] : { k: "union", of: members };
}
function parseMember(lx) {
  let t = parsePrimary(lx);
  while (lx.eat("[]")) t = { k: "arr", of: t };
  return t;
}
function parsePrimary(lx) {
  const s = lx.str();
  if (s !== null) return { k: "lit", vals: new Set([s]) };
  if (lx.eat("{")) return parseFields(lx);
  if (lx.eat("(")) { const t = parseType(lx); lx.eat(")"); return t; }
  const w = lx.word();
  if (w === null) { lx.skipTo(",;})|"); return ANY; }
  if (w === "null") return NULL;
  if (lx.eat("<")) {
    const inner = parseType(lx);
    lx.eat(">");
    if (w === "Readonly") return inner;
    if (w === "ReadonlyArray" || w === "Array") return { k: "arr", of: inner };
    return ANY;
  }
  return { k: "ref", name: w };
}
function parseFields(lx) {
  const fields = new Map();
  for (;;) {
    if (lx.eat("}")) break;
    if (lx.eat(",") || lx.eat(";")) continue;
    if (lx.eat("...") || lx.eat("…")) continue;
    const name = lx.word();
    if (name === null) { lx.skipTo(",;}"); if (!lx.peek()) break; continue; }
    lx.eat("?");
    fields.set(name, lx.eat(":") ? parseType(lx) : ANY);
  }
  return { k: "obj", fields };
}

const named = new Map();
for (const m of contract.matchAll(/^type ([A-Z][A-Za-z]*)\s*=/gm)) {
  named.set(m[1], parseType(lexer(contract, m.index + m[0].length)));
}
const resolve = (t, seen = new Set()) => {
  while (t.k === "ref") {
    if (seen.has(t.name) || !named.has(t.name)) return ANY;
    seen.add(t.name);
    t = named.get(t.name);
  }
  return t;
};
const tagsOf = (name) => {
  const t = resolve({ k: "ref", name });
  const of = t.k === "union" ? t.of : [t];
  return new Set(of.flatMap((x) => { x = resolve(x); return x.k === "obj" && x.fields.get("t")?.k === "lit" ? [...x.fields.get("t").vals] : x.k === "lit" ? [...x.vals] : []; }));
};

// Signatures: every `tool({ … })` in CONTRACT.md. A key typed in one place and bare in another keeps
// its type; types from several signatures are joined.
const sigs = new Map(); // tool → Map<key, Type[]>
for (const m of contract.matchAll(/\b([a-z_]+)\(\{/g)) {
  if (!tools.has(m[1])) continue;
  const obj = parseFields(lexer(contract, m.index + m[0].length));
  const known = sigs.get(m[1]) ?? new Map();
  for (const [k, t] of obj.fields) {
    const list = known.get(k) ?? [];
    if (t !== ANY) list.push(t);
    known.set(k, list);
  }
  sigs.set(m[1], known);
}
const sigType = (tool) => ({
  k: "obj",
  fields: new Map([...sigs.get(tool)].map(([k, list]) => [k, list.length === 0 ? ANY : list.length === 1 ? list[0] : { k: "union", of: list }])),
});

// Refusal names (§10).
const s10 = sectionOf("10. Results and refusals") ?? "";
const refusals = new Set([...s10.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]));
// Kebab-case names in the skills that are not refusals: the cloud's message attribute.
const notRefusals = new Set(["from-session"]);
const subjects = tagsOf("WakeSubject");
const dueReasons = tagsOf("DueReason");

// ---------- The skills' calls: values ----------
// Value: { v: "str", s } | { v: "obj", fields: Map<name, Value|null> } | { v: "arr", of: Value[] } | { v: "other" }

function parseValue(lx) {
  const s = lx.str();
  if (s !== null) return { v: "str", s };
  if (lx.eat("{")) {
    const fields = new Map();
    for (;;) {
      if (lx.eat("}") || lx.peek() === undefined) break;
      if (lx.eat(",")) continue;
      if (lx.eat("...") || lx.eat("…")) continue;
      const name = lx.word() ?? lx.str();
      if (name === null) { lx.skipTo(",}"); continue; }
      fields.set(name, lx.eat(":") ? parseValue(lx) : null);
    }
    return { v: "obj", fields };
  }
  if (lx.eat("[")) {
    const of = [];
    for (;;) {
      if (lx.eat("]") || lx.peek() === undefined) break;
      if (lx.eat(",")) continue;
      if (lx.eat("...") || lx.eat("…")) continue;
      of.push(parseValue(lx));
    }
    return { v: "arr", of };
  }
  lx.skipTo(",}]");
  return { v: "other" };
}

const describe = (t) => {
  t = resolve(t);
  if (t.k === "lit") return [...t.vals].map((v) => JSON.stringify(v)).join(" | ");
  if (t.k === "obj") return `{ ${[...t.fields.keys()].join(", ")} }`;
  if (t.k === "arr") return `${describe(t.of)}[]`;
  if (t.k === "union") return t.of.map(describe).join(" | ");
  if (t.k === "null") return "null";
  return "any";
};

// Returns the problems with `val` against `type`, at `path`.
function checkValue(val, type, path) {
  const t = resolve(type);
  if (val === null || val.v === "other" || t.k === "any") return [];
  if (t.k === "union") {
    const flat = (x) => { x = resolve(x); return x.k === "union" ? x.of.flatMap(flat) : [x]; };
    const members = flat(t);
    if (members.some((x) => x.k === "any")) return [];
    if (val.v === "obj" && val.fields.get("t")?.v === "str") {
      const tag = val.fields.get("t").s;
      const tagged = members.filter((x) => x.k === "obj" && x.fields.get("t")?.k === "lit");
      if (tagged.length) {
        const branch = tagged.filter((x) => x.fields.get("t").vals.has(tag));
        if (!branch.length) return [`${path}.t is "${tag}", not one of ${tagged.map((x) => JSON.stringify([...x.fields.get("t").vals][0])).join(", ")}`];
        const tries = branch.map((x) => checkValue(val, x, path));
        return tries.find((p) => p.length === 0) ?? tries[0];
      }
    }
    const tries = members.map((x) => checkValue(val, x, path));
    if (tries.some((p) => p.length === 0)) return [];
    if (val.v === "str" && members.every((x) => x.k === "lit" || x.k === "null")) return [`${path} is "${val.s}", not ${members.map(describe).join(" | ")}`];
    return [`${path} doesn't match ${describe(t)}`];
  }
  if (t.k === "null") return [`${path} should be null`];
  if (t.k === "lit") {
    if (val.v !== "str") return [`${path} should be ${describe(t)}`];
    return t.vals.has(val.s) ? [] : [`${path} is "${val.s}", not ${describe(t)}`];
  }
  if (t.k === "obj") {
    if (val.v !== "obj") return [`${path} should be an object ${describe(t)}`];
    const out = [];
    for (const [k, v] of val.fields) {
      if (!t.fields.has(k)) { out.push(`${path} has no input \`${k}\` (takes ${[...t.fields.keys()].join(", ")})`); continue; }
      out.push(...checkValue(v, t.fields.get(k), `${path}.${k}`));
    }
    return out;
  }
  if (t.k === "arr") {
    if (val.v !== "arr") return [`${path} should be a list ${describe(t)}`];
    return val.of.flatMap((x, i) => checkValue(x, t.of, `${path}[${i}]`));
  }
  return [];
}

// ---------- The skills ----------

function files(dir, ext) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, ext) : ext.some((e) => p.endsWith(e)) ? [p] : [];
  });
}
const skillsDir = join(root, ".claude/skills");
const skillNames = new Set(readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory()));
const mdFiles = [join(root, "CLAUDE.md"), join(root, "README.md"), ...files(skillsDir, [".md"])];
const allFiles = [...mdFiles, ...files(skillsDir, [".sh"]), ...files(join(root, "scripts"), [".mjs", ".sh"])];

const problems = [];
const used = new Map();
const oldTitle = new RegExp(["b", "ench"].join(""), "i");
const lineAt = (text, index) => text.slice(0, index).split("\n").length;

for (const file of allFiles) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const where = relative(root, file);
  const self = basename(file) === "check-tools.mjs" || basename(file) === "test-check-tools.mjs";
  if (!self && oldTitle.test(text)) problems.push(`${where}: the old working title appears`);

  // 4. /agent/<tool> paths.
  if (!self) {
    for (const m of text.matchAll(/\/agent\/([A-Za-z_]+)/g)) {
      if (!tools.has(m[1])) problems.push(`${where}:${lineAt(text, m.index)}: /agent/${m[1]} is not a tool in CONTRACT.md`);
    }
  }
  if (!file.endsWith(".md")) continue;

  // Fenced blocks blanked out, keeping their lines so line numbers stay true.
  const prose = text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, (b) => b.replace(/[^\n]/g, " "));
  // Code spans pair up within a paragraph (a blank line ends one), as in Markdown.
  const spans = [];
  for (const para of prose.matchAll(/[^\n](?:[\s\S]*?)(?=\n[ \t]*\n|(?![\s\S]))/g)) {
    for (const m of para[0].matchAll(/`([^`]+)`/g)) spans.push({ body: m[1], index: para.index + m.index });
  }

  // 1–3. Inline code spans; one may wrap a line but never a blank line.
  for (const m of spans) {
    const span = m.body.replace(/\s*\n\s*/g, " ").trim();
    const line = lineAt(prose, m.index);
    if (/^[a-z]+(?:-[a-z]+)+$/.test(span)) {
      if (!skillNames.has(span) && !notRefusals.has(span) && !refusals.has(span)) problems.push(`${where}:${line}: \`${span}\` is not a refusal in CONTRACT.md §10`);
      continue;
    }
    const call = /^([a-z][a-z_]*)\(/.exec(span);
    const name = call ? call[1] : tools.has(span) ? span : null;
    if (!name) continue;
    if (!tools.has(name)) { problems.push(`${where}:${line}: \`${name}()\` is not a tool in CONTRACT.md`); continue; }
    used.set(name, (used.get(name) ?? 0) + 1);
    const brace = span.indexOf("({");
    if (call && brace >= 0 && sigs.has(name)) {
      const val = parseValue(lexer(span, brace + 1));
      for (const p of checkValue(val, sigType(name), name)) problems.push(`${where}:${line}: ${p}`);
    }
  }

  // 5. "You may call" against §2.
  const role = file.startsWith(skillsDir) ? relative(skillsDir, file).split("/")[0] : null;
  const may = /^\*\*You may call:\*\*([\s\S]*?)(?:\n\s*\n|(?![\s\S]))/m.exec(prose);
  if (role && roleTools.has(role)) {
    if (!may) problems.push(`${where}: no "**You may call:**" list`);
    else {
      const listed = new Set([...may[1].matchAll(/`([a-z][a-z_]*)\(/g)].map((x) => x[1]));
      const line = lineAt(prose, may.index);
      for (const t of listed) if (!roleTools.get(role).has(t)) problems.push(`${where}:${line}: "You may call" lists \`${t}()\`, which §2 doesn't give the ${role}`);
      for (const t of roleTools.get(role)) if (!listed.has(t)) problems.push(`${where}:${line}: "You may call" leaves out \`${t}()\`, which §2 gives the ${role}`);
    }
  }

  // 6. Wake subjects and due reasons in their tables.
  let table = null;
  prose.split("\n").forEach((l, i) => {
    if (!l.startsWith("|")) { table = null; return; }
    if (table === null) {
      const first = l.split("|")[1].trim();
      table = first === "Subject" ? "subject" : first === "reason" ? "reason" : "other";
      return;
    }
    if (table === "other") return;
    const cell = l.split("|")[1];
    const set = table === "subject" ? subjects : dueReasons;
    for (const m of cell.matchAll(/`([A-Z][A-Za-z]*)`/g)) {
      if (!set.has(m[1])) problems.push(`${where}:${i + 1}: \`${m[1]}\` is not a ${table === "subject" ? "wake subject (WakeSubject)" : "due reason (DueReason)"} in CONTRACT.md`);
    }
  });
}

// 8. The card manager asks before it works.
{
  const file = join(skillsDir, "card-manager/SKILL.md");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch {}
  const keeps = [
    ['the plan ask\'s options ("Start" recommended, "Change the plan" and "Not now")', /`options`: "Start" \(`recommended: true`\), "Change the plan" and "Not now"\./],
    ['the line "Before his Start: no helper, no code, no PR."', /Before his Start: no helper, no code, no PR\./],
  ];
  for (const [what, re] of keeps) if (!re.test(text)) problems.push(`${relative(root, file)}: ask before you work: ${what} is missing`);
}

// 9–11. The card manager and the work setup.
{
  const file = join(skillsDir, "card-manager/SKILL.md");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch {}
  const where = relative(root, file);
  const prose = text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, (b) => b.replace(/[^\n]/g, " "));
  const helpers = /^## Helpers\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(prose)?.[1] ?? "";
  if (!/Before starting any helper, run the setup check/.test(helpers)) problems.push(`${where}: work setup: the Helpers section doesn't run the setup check before starting a helper`);
  const spawn = /\*\*create_session\*\*[\s\S]*?task prompt/.exec(helpers)?.[0] ?? "";
  if (!/`environment_id`/.test(spawn)) problems.push(`${where}: work setup: a helper's create_session doesn't name \`environment_id\``);
  if (!/`https:\/\/github\.com\/<mainRepo>`/.test(spawn)) problems.push(`${where}: work setup: a helper's create_session doesn't use the main repo as source_url`);
  for (const m of prose.matchAll(/`setup_problem\(\{[^`]*\bproblem:\s*null/g)) problems.push(`${where}:${lineAt(prose, m.index)}: work setup: the card manager clears a setup problem; only the workspace and account managers may`);
}

// 12. Onboarding or a restart.
{
  const file = join(skillsDir, "onboarding/SKILL.md");
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch {}
  if (!/before anything else, `whoami\(\)`: if it shows a workspace already, this is a\s+restart, not onboarding\. Ask him nothing here/.test(text)) problems.push(`${relative(root, file)}: onboarding: it doesn't check \`whoami()\` first for a restart (a workspace already there)`);
}

const unused = [...tools].filter((t) => !used.has(t));
console.log(`CONTRACT.md: ${tools.size} tools, ${sigs.size} with signatures, ${refusals.size} refusals, ${subjects.size} wake subjects.`);
console.log(`Skills: ${[...used.values()].reduce((a, b) => a + b, 0)} tool mentions, ${used.size} tools used.`);
if (unused.length) console.log(`Not mentioned in any skill: ${unused.join(", ")}`);
if (problems.length) fail(problems);
console.log("OK");

function fail(lines) {
  for (const l of lines) console.error(`✗ ${l}`);
  process.exit(1);
}
