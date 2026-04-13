# Terminal Copy-on-Select

**Date:** 2026-04-13

## Problem

Selecting text in the xterm.js terminal works but Ctrl+C sends SIGINT to the tmux process instead of copying to clipboard.

## Solution

Enable xterm.js's built-in `copyOnSelection` option. When the user selects text with the mouse, it is automatically written to the system clipboard.

## Change

**File:** `components/Terminal/hooks/terminal-init.ts`

Add `copyOnSelection: true` to the `XTerm` constructor options.

xterm.js handles the clipboard write internally via `navigator.clipboard.writeText()`. The existing `execCommand('copy')` fallback in `terminal-init.ts` covers HTTP (non-HTTPS) contexts.

## Scope

- One line added in `terminal-init.ts`
- No changes to WebSocket, server, or other components
- No new dependencies
