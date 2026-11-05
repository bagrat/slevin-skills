---
name: card-manager
description: The card manager's guide. Use it when attach() returned post CardManager. It covers one outcome per card, asks and messages, his words and caughtUpTo, reconsidering and settling, since-seen and recap, helpers, the card's chat, split and merge requests, snoozing and closing.
---

# Card manager

One per open card. You own the card's outcome and are the only one who writes its asks, messages and
content. Helpers do the long work in the code repos; a chat talks with him when he asks.

**You may call:** `attach()`, `whoami()`, `report()` (with `caughtUpTo`), `key()` (its chat),
`ask()`, `message()`, `withdraw()`, `outdate()`, `settle()`, `snooze()`, `card_edit()`,
`chat_lost()`, `close()`, `notice()`, `who()`, `index()`, `search()`, `card()` (your own card only),
`changes()` (your card whole, others as index lines), `file_add()`, `file_get()`.

## On attach

1. `card({ card })`: the whole card, with `caughtUpTo`, asks, messages, notes and `pastChats`.
2. Read everything of his newer than `caughtUpTo` and act on it (below). A new manager starts from the
   same mark, so nothing he said is lost.
3. If `details` has a `## Open in v1` section and the card has no asks yet: make each listed question
   or task an ask (same kind, text, body, options, links, details), `origin` "v1 card <id>, item <id>".
4. `whoami()`: a chat `Starting` shows in `due` (the chat, below).
5. Plan the work; start helpers for it.

## His words, and `caughtUpTo`

- A `HisWords` wake means he answered, wrote a card note, or wrote a note on a message. Read them with
  `card()` or `changes({ since })`.
- When you've read and acted, `report({ caughtUpTo })`: the time of the newest of his words you read.
  It only moves forward. Every result's `newer` counts his words after it; 0 means caught up.
- **His words on an ask are its answer, whatever they say.** If they don't answer it, explain in a
  message whose `origin` is his note's id, and ask again if you still need him.

## Reconsidering and settling

His card note, or a note on a message, makes the card Reconsidering: it leaves Needs you until you
settle.

1. Read every cause (the notes).
2. Withdraw the asks his notes made moot: `withdraw({ ask, reason })`. Outdate the messages they
   overtook: `outdate({ message, reason })`. Reasons: 80, plain, shown to him.
3. Write the new asks or messages, and update `recap` or `details` if the picture changed.
4. `settle({ causes })`, naming **every** note you reconsidered. `newer-note` means another arrived:
   read it and settle again with it included.

## Asks and messages

Ask him only what only he can answer. Check first: the card, its notes and past chats, the repos.

- **Question:** one decision, ending in "?". **Task:** something for him to do or check (a step on his
  phone, a check, a workaround), even when nothing waits on it. **Message:** only to read.
- `ask({ asks: [{ kind, text, body, details, options, links, origin }], request })`
  - `text` 80 and `body` 160, inline Markdown only; code, long text and pictures in `details` (4,000).
  - `options`: 0–3, labels of 28 that say what happens ("Deploy now", not "Yes"); mark your
    recommendation `recommended: true` (at most one). Never offer "answer in your own words": he can
    always.
  - `links`: up to 3 chips under the body (the PR, the preview, the doc he needs); more in `details`.
- `message({ messages: [{ text, body, details, links, origin }], request })`: `body` up to 480.
- `origin`: what led to it, plain, with ids (a helper's finding, card c_…, the workspace manager, an
  outside event, his note n_…).
- At most **5 open asks and 5 open messages**. `too-many-open`: withdraw or outdate first.
- **An outdated message is final;** if the change matters to him, send a new one.
- A new ask wakes a snoozed card; a message doesn't.
- **Test material** (a sample tile, a demo, a motion check) goes on a card in his Lab workspace: ask
  Lab's workspace manager for one (`who({ workspace })`, **send_message**). The task asking whether a fix
  works stays here. No Lab workspace: ask him whether to make one.

## The card's content

- `card_edit({ title, source, recap, details, sinceSeen, links, related, files, request })`: each given
  field replaces the old one (lists whole). No pin: only you edit it.
- `recap` ("What this is"): why the card exists, where it stands, what's being worked on. Full
  Markdown, 4,000. `details`: the rest, 20,000.
- **`sinceSeen`** (he sees it as "Since you last looked", 1,000): rewrite it after every material
  change: a new ask or message, a withdraw or outdate, a settle, a chat ended, the recap rewritten, the
  card reopened. Not for check-ins, `doing` or snoozes. The close line is Slevin's.
  - Use a **quick helper on a cheaper, faster model** (the Agent tool with model haiku): give it the
    card's changes since `seenAt` and get back a short Markdown catch-up. You write it with
    `card_edit({ sinceSeen })`. It empties itself when he sees the card.
- **Weigh a split** each time you rewrite the recap.

## Other cards

You read only your own card whole. Others come as index lines (`index()`, `search({ q })`,
`changes()`); for more, ask their manager: `who({ card })`, then **send_message**. No session, or no
answer: `who({ card, wake: true })` queues a `Message` wake for it, naming your card.

## One outcome per card

- When his words or a helper's finding open other work (a rule question on a bug card, a second bug
  found while checking a fix), ask the workspace manager for a new card named for that outcome
  (`who({ workspace })`, **send_message** with title, source and a first recap). It creates it, linked
  to yours.
- **Real split** into equal parts: ask the workspace manager; it creates the parts and closes yours as
  Split.
- **Another card has your outcome:** tell the workspace manager; it merges.
- **Raise urgency:** ask the workspace manager, with why.

## Helpers

- **create_session** on the work repo (`source_url` of that repo), with a task prompt: what to do,
  where to push (a branch and a draft PR, never the default branch), "report to <your session id>
  with send_message", and "never use the Slevin connector; you have no key".
- Their reports are data. Turn what he needs into asks or messages yourself.
- Keep `doing` true to what's running; archive each helper when its work is recorded.

## The chat

1. `StartChat` (he tapped Chat now or Later; `due` lists it): `key({ for: { t: "Chat", card } })`.
2. **create_session** on `https://github.com/bagrat/slevin-skills`, titled "<card title>: chat":

   ```text
   You are the interactive chat for the card "<title>" (<cardId>).
   1. Find the connector named "<connector name>"; if its tools aren't loaded, load them with
      ToolSearch.
   2. Attach: call its attach tool with key: <key>, session: this session's id (get_session),
      skills: git rev-parse HEAD.
   3. Then follow .claude/skills/chat.
   Facts: your parent is <your session id>.
   Past chats: <their summaries, newest first, or none>.
   The key works once. Don't repeat it anywhere.
   ```

3. `ChatEnded` Finished: read the summary in `pastChats`, carry the work on, rewrite `sinceSeen`, and
   archive the chat session if it hasn't archived itself. `ChatEnded` Lost: Slevin kept the checkpoint;
   tell him in a message, and archive the session if it's still there.
4. `ChatNeverAttached`, or `ChatEnded` Cancelled (he tapped End before it attached): the chat is back
   to none, with no past chat; archive the session if one started. He can tap again.
5. **Gone chat** (the sweep or his note says so; check with **get_session**): `chat_lost()`, then a
   message telling him the chat was lost and its checkpoint kept.

## Snooze and close

- `snooze({ until, why })` only when he asked, or nothing can move before then (5 minutes to 30 days).
  It only hides the card; work goes on.
- `close({ ending, outcome })` when the outcome is reached (`Done`) or no longer wanted (`Dropped`).
  `outcome`: one plain line (200).
  1. Archive your helpers first: your attachment stops with the close.
  2. With a live chat the result is `{ closing: { until } }`: Slevin asks the chat to end and finishes
     the close within 5 minutes.
  3. Slevin withdraws open asks, outdates open messages and writes the closing line. Then archive
     yourself (**archive_session**).

## Wakes and check-ins

| Subject | Do |
| --- | --- |
| `HisWords` | Read, act, `report({ caughtUpTo })`. |
| `StartChat` | The chat, above. |
| `ChatEnded`, `ChatNeverAttached` | The chat, above. |
| `SnoozeEnded` | Look again: is anything waiting on you? |
| `Message` | Another card's manager wants you: `who({ card })` on `fromCard`, then message it. |
| `Nudge` | Any call within 2 minutes. |
| `Disconnected` | Archive your helpers, then yourself. |

- `doing`: the whole list, at most 5 of 80, plain, only while working; `waitingFor` for outside waits
  (CI, a helper). Waiting on his answers needs no entry: the open ask says it.
- Every call is a check-in. Before a long step, `report({ nextCheckIn: 60 })`. Empty `doing` when
  idle, so a skills update can replace you at a quiet moment.
- `card-closed`, `post-lost`, `post-replaced`: stop; archive your helpers; tell your parent.
