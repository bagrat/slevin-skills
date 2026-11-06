# Slevin's role skills

The role guides for the sessions that run Slevin: account manager, workspace manager, card manager,
chat and relay. Every one of them is spawned on this repo, so `CLAUDE.md` and `.claude/skills/` load
as its project instructions. Helpers run on the work repos and never use these.

| Path | What |
| --- | --- |
| `CLAUDE.md` | The same for every role: what Slevin is, attach, wakes, the trust rules, his yes for outward actions, what every role always does. |
| `.claude/skills/account-manager/` | The host check, relays, workspace managers, archiving what they leave, the handover. |
| `.claude/skills/workspace-manager/` | Cards, the inbox, urgency, merges and splits, closes, the sweep, moving v1's cards in. |
| `.claude/skills/card-manager/` | Asks, messages, his words, the card's content, helpers, the chat, closing. |
| `.claude/skills/chat/` | The interactive chat. |
| `.claude/skills/relay/` | The long-poll loop (`poll.sh`) and delivering wakes. |
| `scripts/check-tools.mjs` | Checks the skills against the agent contract (below). |
| `scripts/test-check-tools.mjs` | Plants each kind of error the check catches, and sees each caught. |
| `scripts/test-poll.mjs` | Runs `poll.sh` against a local stub of the app's HTTP door. |

The tools, inputs, limits and refusals are the agent contract (`spec/CONTRACT.md` in the app's
repo). These skills are how to use it well; where they differ, the contract wins and the skill is fixed.

## Rules for this repo

- It is public: nothing private goes in it (no emails, tokens, keys or card content).
- **Only the build's PRs are merged,** after the orchestrator's review. Never merge a PR from outside.
- **A change to the trust rules** (CLAUDE.md's Trust and "His yes" sections) also needs his yes.
- **A role session never commits to or pushes this repo;** it only reads its checkout.
- Every merge reaches every session within about an hour (below), so keep changes small and the
  checks green.

## Writing tools in the skills

- A Slevin tool is written in backticks with parentheses: `attach()`, `ask({ asks })`. A call may
  wrap a line.
- The cloud's own tools (**get_session**, **create_session**, **send_message**, **archive_session**)
  are written in bold, so the check doesn't take them for Slevin's.
- A refusal is written in backticks by its check name (`post-lost`); a wake subject or due reason in
  backticks in its table's first column.

## The checks

Run before every merge, against the contract of the server the skills are for:

```bash
node scripts/check-tools.mjs <path to CONTRACT.md>
node scripts/test-check-tools.mjs <path to CONTRACT.md>
node scripts/test-poll.mjs
```

`check-tools.mjs` reads the contract's §2 table, every tool signature (a tool name, then `({ … })`)
with the named types it uses, §10's refusal names, and the `WakeSubject` and `DueReason` types. In
`CLAUDE.md`, `README.md` and `.claude/skills/` it checks:

1. every backticked call or bare tool name is a tool;
2. every input of a call, at any depth: keys of nested objects and of objects in lists, string values
   against literal unions, and `t` tags against tagged unions (the branch's keys too). A name without
   a value is checked only as a key; an input the contract leaves untyped isn't looked into;
3. every backticked kebab-case name, other than a skill's, is a refusal in §10;
4. every `/agent/<tool>` path, in any file (the `.sh` scripts included), names a tool;
5. each skill's "**You may call:**" list names exactly the tools §2 gives its role;
6. every backticked name in a wakes table ("Subject") or a due table ("reason") is a wake subject or a
   due reason;
7. the old working title appears nowhere.

Fenced blocks (prompts and shell) are not checked for calls. It doesn't check prose: what a skill
tells a role to do is the review's job.

## Versions and replacement

1. **A version is a commit** on the default branch. Changes come by PR; the checks must pass.
2. Every post records the commit it started on (`attach({ skills })`, from `git rev-parse HEAD`).
3. Slevin reads this repo's newest commit every hour (GitHub's public API).
4. A running session keeps the instructions it started with, so an update needs a new session. For
   each post that is behind, Slevin waits for a quiet moment (its `doing` empty) and wakes its parent
   with a `Replace` (Skills) subject; `whoami()` lists it as `SkillsUpdate` in `due`. The parent calls
   `key()` for the post and spawns a new session on this repo. The old holder stays attached until the
   new one attaches; then Slevin wakes the parent with `Replaced`, naming the old session, and the
   parent archives it. Relays are replaced by the account manager the same way.
5. The account manager has no parent, so it hands over: woken with `HandOver`, it calls
   `key({ for })` with `{ t: "Successor" }`, spawns its successor, and the successor archives it.
6. So a merge here reaches every session within about an hour, one post at a time.

## Builder's choices (to revisit)

- **Tool spelling:** Slevin tools in backticks with parentheses, cloud tools in bold, so the check can
  tell them apart.
- **Unions as `{ t: … }`:** endings and sort targets are written like the contract's `Post` and
  `KeyFor` (`{ t: "Split", into }`, `{ t: "OntoCard", card }`); plain `"Done"` and `"Dropped"`.
- **A child tells its parent when it attaches** (one **send_message**); a parent archives an old
  session on the `Replaced` wake, after checking it with **get_session**.
- **Wakes are cues to read:** every wake table starts "confirm with a read before you act", and the
  archiving steps (after `Disconnected`, `CardClosed`, `WorkspaceArchived`, `EndChat`) each name the
  read that must show it first.
- **Sessions to archive** come from the wake that names them (`CardClosed`'s manager and chat,
  `WorkspaceArchived`'s manager, `Replaced`'s old) or from the parent's own map of the sessions it
  started; `who()` no longer gives them once a card has closed. Before archiving one, the parent checks
  it with **get_session**: its title, its parent_session_id or the map must agree. The account
  manager's map travels in its successor's prompt, so it starts nothing between spawning the successor
  and `handed-over` (or sends the successor each session it starts).
- **Disconnect reaches only the account manager and the relays:** he can't disconnect a Claude
  account that serves a workspace. The other roles keep a "not expected" row, and every role archives
  itself on `claude-account-disconnected` (a card manager archives its helpers first).
- **The older connector, once:** CLAUDE.md bans other connectors' tools, except the workspace
  manager's one-time v1 move, which may call only the older connector's index and card tools.
- **After a close** the workspace manager asks the card manager to archive its helpers and reply,
  waits for the reply (or the 5 minutes, with `doing` filled and `nextCheckIn` 5 so a `Nudge` wakes
  it), then archives the card manager and the chat session. A card manager closing its own card
  archives its helpers before the close.
- **Helpers are recorded on the card** (`## Helpers` in `details`, with branch and PR). A new card
  manager can't re-point them (a work repo lets a helper take direction only from its parent), so it
  archives the live ones and starts its own from the recorded branch; a card manager that lost its
  post leaves them for it.
- **Relays only from `due`:** the account manager starts a relay only when `due` lists a slot, so the
  starting count is whatever `relaysWanted` says, and more come only after `relay_more()`.
- **The host comes from the start prompt:** the account manager checks it with a `curl` to
  `/agent/whoami` (reachable: exit 0 and a code other than `000`; a blocked host is `000` with exit
  56 through the agent proxy) and writes "Host: <host>" into every relay's and successor's prompt.
  `poll.sh` has no default host.
- **The relay's loop** is a background Bash run of `poll.sh`, which exits on the first wake, refusal or
  repeated failure, printing the HTTP status and body, so the model runs only then. One loop per
  header file (a lock), at least 2 seconds between fast "none" answers, and `POLL_DELAY` to wait by
  starting the loop in the background. The attachment sits in a `600` header file in `$HOME`, written
  in its own Bash call and passed to curl with `-H @file`, never on a command line or in output.
  `APP_BASE` points it at a local stub for tests.
- **A wake for the relay's own session** (a `Disconnected` to itself) is read by the relay itself, not
  sent to itself; it keeps delivering for up to 10 minutes, then archives itself.
- **Lab's id travels in start prompts:** the account manager names Lab (from `whoami()`'s workspaces)
  in each workspace manager's prompt, and the workspace manager passes it to its card managers. A card
  manager asks Lab's workspace manager for test cards with **send_message**.
- **Outward actions go through a Question ask** on the card (CLAUDE.md, "His yes"), unless the work
  repo's `CLAUDE.md`, as the card manager reads it itself on the default branch, gives them to the card
  manager's role; helpers are told not to merge, deploy, delete, pay, make anything public, change
  anyone's access or write secrets.
- **Since you last looked** is rewritten by a subagent on haiku (the Agent tool), which writes nothing;
  the card manager posts it with `card_edit()`.
- **No "started from" message on a card born from another card's note** (v1's rule): in v2 the new
  card's `source` and two-way `related` carry the link, so a message would only add a push.
- **Chat decisions reach the card manager in the summary** (and by **send_message** when something
  can't wait). The chat does work in its own session as he asks there, since his words in it are his;
  outward actions go to the card manager.
- **Moving v1's cards in:** the workspace manager skips each v1 card already moved (a v2 card whose
  `source` is exactly "v1 card <id>", found by search and then `card()`), so an interrupted move
  finishes on the next run; it leaves out v1's Lab cards. Each card's open questions and tasks, and
  his unacknowledged replies and updates, go under `## Open in v1` in its details; the card manager
  posts each item once (it skips any ask or message whose `origin` already names that item), at most
  5 open at a time, highest urgency first, and removes the section once all are in. The card's
  urgency is the highest of its open items. The notice has 5 chips at most, so more than 5 cards get
  one notice per 5, numbered.
- **Stale asks in the sweep** go back to their card manager to re-check; the workspace manager doesn't
  withdraw them itself (only the card manager may).
- **The Claude-Session trailer stays in public commits:** a session link opens only for his account.
- **No CI here:** the contract lives in the app's repo, so the checks are run by hand (or by the build)
  with its path.
