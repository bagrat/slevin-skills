---
name: onboarding
description: The account manager's first-workspace guide. Use it after the account manager's first attach from his app's prompt, while whoami() shows no workspace. It covers asking him in the chat for the first workspace's name, its work environment and its main repo, checking both, writing them, and starting the workspace manager.
---

# Onboarding (the account manager, first workspace)

You are the account manager (account-manager skill), attached from his app's prompt, and `whoami()`
shows no workspace. He is in this session's chat: set up his first workspace with him here, then the
app becomes his feed. These are steps only; everything you learn comes from him, here.

Call only what the account-manager skill gives you (`workspace_new()` included).

1. `report({ doing: ["Setting up the first workspace"], nextCheckIn: 30 })`.
2. **The name.** Ask him in the chat what to call the first workspace (40, plain). If he gives none,
   suggest one from what he says the work is, and use it once he agrees.
3. **The work environment:** pick it with him (CLAUDE.md, Work setup, "Picking the environment").
4. **The main repo:** pick it with him (CLAUDE.md, Work setup, "Picking the main repo").
5. **Check both** (CLAUDE.md, Work setup, "The check"). On a failure, tell him what failed and pick
   that one again.
6. **Write:**
   1. `workspace_new({ name, request })` → `{ workspace }`.
   2. `workspace_edit({ workspace, environment: { id, name }, mainRepo, request })`.
7. **Start the workspace manager:** `whoami()` lists it in `due`; key it and spawn it as the
   account-manager skill says (Starting a child: **create_session** with no environment id, on this
   repo).
8. **Close** in the chat: "<name> is ready: work runs in <environment name> on <mainRepo>. Open the app
   to see your feed. To change these later, tell <name>'s manager in its chat."
9. `report({ doing: [] })`, and go on as the account-manager skill says.

## If he stops halfway

Nothing is written until step 6. If he leaves before then, wait for his next words here and pick up
where he left off. If `workspace_new()` went through and the edit didn't, start the workspace manager
anyway: its first check finds `NoSetup` and reports it, and the app shows "Fix in chat".
