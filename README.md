# Slevin's role skills

The role guides for the sessions that run Slevin: account manager, workspace manager, card manager,
chat and relay. Every one of them is spawned on this repo, so `CLAUDE.md` and `.claude/skills/` load
as its project instructions. Helpers run on the work repos and never use these.

| Path | What |
| --- | --- |
| `CLAUDE.md` | The same for every role: what Slevin is, the trust rules, attach, how to tell your role. |
| `.claude/skills/account-manager/` | Relays, workspace managers, the handover. |
| `.claude/skills/workspace-manager/` | Cards, the inbox, urgency, merges and splits, the sweep, moving v1's cards in. |
| `.claude/skills/card-manager/` | Asks, messages, his words, the card's content, helpers, the chat, closing. |
| `.claude/skills/chat/` | The interactive chat. |
| `.claude/skills/relay/` | The long-poll loop (`poll.sh`) and delivering wakes. |
| `scripts/check-tools.mjs` | Checks every tool name and input against the agent contract. |

The tools, inputs, limits and refusals are the agent contract (`spec/CONTRACT.md` in the app's
repo). These skills are how to use it well; where they differ, the contract wins and the skill is fixed.

## Writing tools in the skills

- A Slevin tool is written in backticks with parentheses: `attach()`, `ask({ asks })`.
- The cloud's own tools (**get_session**, **create_session**, **send_message**, **archive_session**)
  are written in bold, so the check doesn't take them for Slevin's.
- Check before every merge:

  ```bash
  node scripts/check-tools.mjs <path to CONTRACT.md>
  ```

## Versions and replacement

1. **A version is a commit** on the default branch. Changes come by PR; the check must pass.
2. Every post records the commit it started on (`attach({ skills })`, from `git rev-parse HEAD`).
3. Slevin reads this repo's newest commit every hour (GitHub's public API).
4. A running session keeps the instructions it started with, so an update needs a new session. For
   each post that is behind, Slevin waits for a quiet moment (its `doing` empty) and wakes its parent
   with "replace: skills <old> → <new>". The parent calls `key()` for the post (the old holder becomes
   Updated), spawns a new session on this repo, and archives the old one. Relays are replaced by the
   account manager the same way.
5. The account manager has no parent, so it hands over: woken with "hand over", it calls
   `key({ post })` with `{ t: "Successor" }`, spawns its successor, and the successor archives it.
6. So a merge here reaches every session within about an hour, one post at a time. Keep changes small
   and the check green.

## Builder's choices (to revisit)

- **Tool spelling:** Slevin tools in backticks with parentheses, cloud tools in bold, so the check can
  tell them apart.
- **Unions as `{ t: … }`:** endings and sort targets are written like the contract's `Post`
  (`{ t: "Split", into }`, `{ t: "OntoCard", card }`); plain `"Done"` and `"Dropped"`.
- **The relay's loop** is a background Bash run of `poll.sh`, which exits on the first wake, refusal or
  repeated failure, so the model runs only then. The attachment sits in a `600` header file in `$HOME`,
  passed to curl with `-H @file`, never on a command line or in output.
- **Overload** is read from the loop: 3 wakes in a row that were already waiting (`waited=0`) make the
  relay call `relay_more()`. The contract's "a wake waiting over a minute" isn't visible to a relay.
- **Lab's id travels in start prompts:** the account manager lists the workspaces and Lab's id in each
  workspace manager's prompt, and the workspace manager passes Lab's id to its card managers. A card
  manager asks Lab's workspace manager for test cards with **send_message**.
- **Closing by him:** the workspace manager asks the card manager to archive its helpers, then archives
  the card manager. Only the card manager knows its helpers.
- **Since you saw it** is rewritten by a subagent on haiku (the Agent tool), which writes nothing; the
  card manager posts it with `card_edit()`.
- **No "started from" message on a card born from another card's note** (v1's rule): in v2 the new
  card's `source` and two-way `related` carry the link, so a message would only add a push.
- **Chat decisions reach the card manager in the summary** (and by **send_message** when something
  can't wait). The chat does work in its own session as he asks there, since his words in it are his.
- **Moving v1's cards in:** the workspace manager writes each v1 card's open questions and tasks under
  `## Open in v1` in its details, and the card manager turns them into asks with origin "v1 card <id>,
  item <id>". The card's urgency is the highest of its open items. The notice has 5 chips at most, so
  more than 5 cards get one notice per 5, numbered.
- **Stale asks in the sweep** go back to their card manager to re-check; the workspace manager doesn't
  withdraw them itself (only the card manager may).
- **No CI here:** the contract lives in the app's repo, so the check is run by hand (or by the build)
  with its path.
