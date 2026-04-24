# Worktree UI improvements — Phase 1 + 2 — Design

**Status:** pending user approval — 2026-04-24
**Author:** brainstorming session
**Scope:** Phase 1 (collapse structure) + Phase 2 (worktree actions). Phases 3 and 4 are out of scope.

## Problem

Today `ClaudeProjectsSection.tsx` groups worktrees under their parent repo (per the 2026-04-17 design) but:

1. **Worktree children are always visible** when the parent group is rendered. Collapsing the parent's chevron only toggles the parent's sessions — worktree children stay on screen. The user expects "collapse workspace → hide its worktrees too".
2. **There is no way to delete a worktree from the UI**. `deleteWorktree()` exists in `src/lib/worktrees.ts` but only `POST /api/worktrees` (create) is exposed. Users must drop to the CLI.
3. **There are no quick actions on a worktree** — no open in editor, no copy path.
4. **Collapse state is not persisted** — every reload re-collapses everything, which will be especially annoying with two independent sub-sections per project.

## Goal

1. Parent project cards expose **two independently collapsible sub-sections** — "Sesiones (N)" and "Worktrees (M)" — each persisted across reloads.
2. The parent master chevron collapses both sub-sections as a unit.
3. A worktree card offers a context menu with **Delete worktree…**, **Open in editor (VS Code / Cursor / Finder)**, and **Copy path**.
4. The delete flow shows a confirmation dialog with warnings for dirty state and active Claude sessions, and an opt-in to delete the local branch.

## Non-goals

- **Phase 3** — visual enrichment (git status badges, abandoned-worktree indicator, metadata tooltip). Separate spec.
- **Phase 4** — rename worktree branch from UI. Separate spec.
- Bulk operations (merge clean worktrees, multi-select delete).
- Merging / PR creation from UI.
- Any change to the session creation flow beyond wiring the new `+` button to the existing `NewSessionDialog`.
- Persisting collapse state server-side (localStorage is enough; single-user per instance).

## Architecture

### Phase 1 — Collapse structure

#### Sub-section rendering ownership

`ClaudeProjectsSection.tsx` currently calls `groupByParent(projects)` which returns `{ parent, children }[]` and **renders children itself**, outside the parent's card, inside a sibling `<div>`. This is moved inside the parent card so the parent is self-sufficient.

New signature for `ClaudeProjectCard`:

```ts
interface ClaudeProjectCardProps {
  project: ClaudeProject;
  worktreeChildren: ClaudeProject[]; // empty array if none or if project.isWorktree
  showHidden: boolean;
  onSelectSession?: (...);
  onNewSession?: (cwd: string, projectName: string) => void;
}
```

`ClaudeProjectsSection` now only iterates `groups` and renders one `<ClaudeProjectCard>` per group, passing `group.children` as `worktreeChildren`. The intermediate indentation wrapper (`<div className="border-border/30 ml-3 ...">`) moves _inside_ the card too.

#### Collapse state

A new hook `src/hooks/useProjectExpansion.ts`:

```ts
interface ProjectExpansion {
  master: boolean; // parent chevron: collapses both subsections as a unit
  sessions: boolean; // sessions subsection chevron
  worktrees: boolean; // worktrees subsection chevron
}

export function useProjectExpansion(projectName: string): {
  expansion: ProjectExpansion;
  toggleMaster: () => void;
  toggleSessions: () => void;
  toggleWorktrees: () => void;
};
```

- Persistence key: `claudedeck:expanded:<projectName>`.
- Default when no entry: `{ master: false, sessions: false, worktrees: false }` — fully collapsed, matching current default.
- `toggleMaster()` flips `master` only. Sub-section chevrons keep their own state; when master is `false`, both subsections are visually hidden regardless of their individual state, so opening the master again restores the previous sub-section states. **This is the key behaviour the user asked for** — "pliega las sesiones y ten desplegados los worktrees" works because each chevron has its own persisted state.
- Safe-guarded `localStorage` read (try/catch, `typeof window !== 'undefined'`) so SSR does not break.

#### Parent card layout

```
[▸] 📁 project-name         N sesiones · M worktrees   [+] [👁]   <- master row
    [▸] Sesiones (N)                                              <- subsection
        ... session cards ...
    [▸] Worktrees (M) [+]                                         <- subsection
        ... worktree cards (ClaudeProjectCard with isWorktree) ...
```

- Master chevron: shows everything below when open; hides everything when closed.
- Sub-section header is a small row: chevron + label + count. Hidden entirely if that subsection has zero items (e.g. a brand-new project with no sessions shows no "Sesiones (0)" noise).
- "Worktrees (M)" header has a trailing `+` button that calls `onNewSession(project.directory, project.name)` with a flag that pre-opens the `WorktreeSection` toggle in `NewSessionDialog`. For minimal surface change, we reuse the existing dialog — we add an optional `openWorktreeByDefault?: boolean` to its props and wire it through `onNewSession`.

#### Count in parent row

The trailing count today renders `project.sessionCount`. Replace with:

- If `project.isWorktree` or `worktreeChildren.length === 0` → `N sesiones` (or just the bare number, matching current density preference).
- Else → `N sesiones · M worktrees`.

Use `text-[10px] text-muted-foreground`, consistent with current styling. The actual label "sesiones"/"worktrees" is shown as text (one-liner, KISS). No i18n abstraction introduced.

### Phase 2 — Worktree actions

#### Context menu extension

`ClaudeProjectCard` already wraps its card in `<ContextMenu>`. When `project.isWorktree`, the menu gains additional items **above** the existing Hide/Show entry:

```
Open in VS Code        (only if vscode detected)
Open in Cursor         (only if cursor detected)
Open in Finder         (always — uses `open` on macOS, `xdg-open` on Linux)
Copy path
──────────────────────
Delete worktree…       (destructive, text-red-500)
──────────────────────
Hide worktree / Show worktree  (existing)
```

For non-worktree projects, the menu is unchanged.

#### External editor detection

New `src/lib/external-editors.ts`:

```ts
export interface ExternalEditorAvailability {
  vscode: boolean;
  cursor: boolean;
  finder: boolean; // always true (SO-native)
}

export async function detectExternalEditors(): Promise<ExternalEditorAvailability>;
```

- Uses `execFile("which", [binName])` or a `PATH` scan.
- Memoised after first call (module-scope cache). Invalidation on server restart is fine.
- `finder` resolves to the native reveal-in-file-manager command (`open` on darwin, `xdg-open` on linux). It is always reported `true`.

API: `GET /api/external-editors` → `{ vscode: boolean, cursor: boolean, finder: true }`.

Client: `useExternalEditors()` hook in `src/data/claude/queries.ts`, long stale time (5 min), retry false.

#### Open endpoint

`POST /api/open` with body `{ path: string, editor: "vscode" | "cursor" | "finder" }`.

Server-side validation:

- `path` must resolve (after `realpath`) to either:
  - a directory inside `~/.claude-deck/worktrees/` (via `isClaudeDeckWorktree()` that already exists), **or**
  - a directory that matches a current `ClaudeProject.directory` (fetched from the JSONL cache).

Any other path → `400`. This prevents abuse via the endpoint while still allowing non-worktree projects to use the same feature later if desired.

Command dispatch (`execFile`, never `exec`, args passed as array):

- vscode → `code <path>`
- cursor → `cursor <path>`
- finder (darwin) → `open <path>`
- finder (linux) → `xdg-open <path>`

Errors surface as toast on client (existing toast infra).

#### Copy path

Pure client-side:

```ts
await navigator.clipboard.writeText(project.directory);
toast.success("Path copiado");
```

No backend.

#### Delete flow

**Pre-delete status endpoint**: `GET /api/worktrees/status?path=<worktreePath>`:

```ts
interface WorktreeStatus {
  dirty: boolean; // `git status --porcelain` is non-empty
  branchName: string; // `git rev-parse --abbrev-ref HEAD`
  activeSessions: number; // JSONL sessions whose cwd === worktreePath AND lastActivity within 24h
  isClaudeDeckManaged: boolean; // isClaudeDeckWorktree(path)
}
```

The status endpoint is separate from `DELETE` so the dialog can display warnings _before_ the user confirms. If any call fails (git missing, path gone), return best-effort values with sensible defaults (`dirty: false`, `activeSessions: 0`).

**Delete endpoint**: extend `src/app/api/worktrees/route.ts` with `DELETE`:

```
DELETE /api/worktrees
Body: { worktreePath: string, projectPath: string, deleteBranch: boolean }
```

- Reuses `deleteWorktree()` in `src/lib/worktrees.ts` unchanged.
- On success, invalidates the server-side `projectsData` cache and `repoIdentityCache` (both already exist as exported invalidation functions).
- Response `{ ok: true }` on success, `400` with `{ error }` on failure.

**Dialog**: new `src/components/ClaudeProjects/DeleteWorktreeDialog.tsx`.

Props:

```ts
interface DeleteWorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worktree: ClaudeProject; // the worktree project card
  parentProjectPath: string; // resolved via project.parentRoot or fallback to project.directory
}
```

- On open, fires `useWorktreeStatus(worktreePath)` query.
- Renders:
  - Branch name and path (monospace, truncated).
  - Warning boxes (only when applicable):
    - Dirty → amber box "El worktree tiene cambios sin commitear. Se perderán."
    - `activeSessions > 0` → amber box "N sesión(es) de Claude apuntan a este worktree."
  - Checkbox `☑ Borrar también la rama local` (default `true`).
  - Buttons: `Cancelar` (default), `Eliminar` (destructive, `variant="destructive"`).
- On confirm, `useDeleteWorktree()` mutation → toast + close + TanStack Query invalidation of `claudeKeys.projects()`.

#### Data hooks in `src/data/claude/queries.ts`

Three new hooks, following the pattern of `useHideItem` / `useUnhideItem`:

```ts
useExternalEditors(); // GET /api/external-editors, staleTime 5min
useWorktreeStatus(path); // GET /api/worktrees/status?path=..., staleTime 10s, enabled when path truthy
useDeleteWorktree(); // DELETE /api/worktrees, invalidates projects on success
useOpenInEditor(); // POST /api/open, no invalidation (side-effect only)
```

## Data flow

```
User clicks worktree card (right) ─┐
                                   ▼
                 ContextMenu shows actions
                      │
       ┌──────────────┼───────────────┬────────────────────┐
       ▼              ▼               ▼                    ▼
Open in editor    Copy path    Delete worktree…      Hide worktree
POST /api/open   navigator.    Opens DeleteDialog   (existing hide flow)
                 clipboard           │
                                     ▼
                         GET /api/worktrees/status
                                     │
                                     ▼
                         Dialog renders + warnings
                                     │
                             User confirms
                                     ▼
                      DELETE /api/worktrees
                                     │
                                     ▼
                      deleteWorktree() (lib)
                                     │
                                     ▼
                    invalidate projectsData + repoIdentity
                                     ▼
                    TanStack invalidate claudeKeys.projects()
                                     ▼
                           Sidebar re-renders
```

## Error handling

- **External editor binary missing at call time** (race with detection cache) → 500 "Editor not available", surfaced as error toast.
- **Invalid path in `/api/open` or `/api/worktrees/status`** → 400. No stack traces leaked.
- **`git` missing or path no longer a git worktree** → status endpoint returns defaults; delete endpoint falls back to manual rm (already implemented in `deleteWorktree()`).
- **Active Claude sessions** → warning only; user can still proceed. Rationale: the tmux/session teardown is out of scope; we surface info, user decides.
- **localStorage unavailable or corrupt JSON** → default to all-collapsed, silently recover (overwrite on next toggle).

## Testing

Manual:

1. Expand a project with worktrees → see two subsections, each with its own chevron + count.
2. Collapse "Sesiones" but keep "Worktrees" open → reload → state preserved.
3. Collapse master chevron → both subsections hide → expand again → previous sub-section state restored.
4. `+` in "Worktrees (M)" opens `NewSessionDialog` with worktree toggle pre-opened.
5. Right-click worktree card → menu shows only detected editors + Copy path + Delete.
6. Copy path → clipboard contains `project.directory`, toast confirms.
7. Open in VS Code → VS Code opens at that path.
8. Delete worktree with no changes → confirmation with no warnings → delete succeeds → sidebar updates, worktree disappears.
9. Delete worktree with uncommitted changes → warning shown → confirm → succeeds.
10. Delete worktree while Claude session is running (mock by opening session) → warning shown → confirm → succeeds, tmux/session is NOT killed (scoped out).
11. Delete with "delete branch" unchecked → worktree gone, branch still visible via `git branch`.

No automated tests introduced — the codebase has no test infra today. If this changes later, prioritise `useProjectExpansion` (pure logic), `detectExternalEditors`, and the `/api/open` path validation.

## Edge cases

- **Worktree whose parent repo is not in the project list** ("orphan worktree") — it renders flat today; the card still gets context-menu actions because `isWorktree` is true. Delete works but the `parentProjectPath` needed by `deleteWorktree()` comes from `project.parentRoot ?? project.directory` — if `parentRoot` is null we fall back to the worktree's own directory, which makes `git -C <worktree> worktree remove <worktree>` — git accepts this from within the worktree (it resolves the common dir internally).
- **User hides a worktree then deletes it** — hidden state is in DB keyed by worktree project name; delete only removes the filesystem/branch, not the hidden entry. We prune the hidden entry in the same mutation to avoid orphan rows. This is a one-liner in the delete handler.
- **Race: another client or CLI already deleted the worktree** — `deleteWorktree()` already does best-effort cleanup and ignores "does not exist" errors. Our endpoint still returns 200 and invalidates caches; sidebar self-heals.
- **Double-click on master chevron** — standard debounce via React state (no special handling needed).
- **Project marked hidden while user expands it** — no interaction issue; filtering happens at the section level.

## Open questions

None at time of writing. If the user spots one during review we amend before plan.

## Rationale for KISS/DRY choices

- **Single `ClaudeProjectCard` handles both parent and worktree child** — we avoid a separate `WorktreeCard` component. The only divergence is the context-menu items, driven by `project.isWorktree`. DRY.
- **One hook `useProjectExpansion`** encapsulates the three-boolean state + persistence. Not three separate hooks. KISS.
- **`NewSessionDialog` is reused** for "create worktree from header `+`" via a single prop. No new dialog.
- **Delete reuses existing `deleteWorktree()`** — no new library code, only an endpoint and a dialog.
- **Detection of editors is a one-shot memoised module, not a subsystem** — no plugins, no config file. User can always re-detect by restarting the server.

## Out of scope (for future specs)

- Git status badges on worktree cards (dirty/ahead/behind) — Phase 3.
- Abandoned-worktree indicator — Phase 3.
- Metadata tooltip (base branch, creation date, last commit) — Phase 3.
- Rename worktree — Phase 4.
- Bulk clean-up of merged worktrees — future.
- Session teardown on worktree delete — future (would couple to tmux lifecycle).
