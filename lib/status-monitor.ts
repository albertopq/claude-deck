/**
 * Consolidated session status monitor.
 *
 * Single module that handles all tmux session status detection and
 * pushes updates to clients via WebSocket. Replaces the old split
 * between status-detector.ts (detection) and status-monitor.ts (loop).
 *
 * Resource usage per tick:
 * - 1x exec("tmux list-sessions")  — always
 * - Nx exec("tmux capture-pane")   — only for sessions whose activity changed
 * - claudeSessionId lookups        — cached with 30s TTL
 *
 * Adaptive interval:
 * - 1s when any session is running/waiting
 * - 3s when all sessions are idle
 * - Paused when no managed sessions exist
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getManagedSessionPattern,
  getSessionIdFromName,
  getProviderIdFromSessionName,
} from "./providers/registry";
import type { AgentType } from "./providers";
import { broadcast } from "./claude/watcher";
import { getDb } from "./db";

const execAsync = promisify(exec);

// --- Configuration ---

const INTERVAL_ACTIVE_MS = 1000;
const INTERVAL_IDLE_MS = 3000;
const COOLDOWN_MS = 2000;
const SPIKE_WINDOW_MS = 1000;
const SPIKE_THRESHOLD = 2;
const CLAUDE_ID_CACHE_TTL = 30000;

const UUID_PATTERN = getManagedSessionPattern();

// --- Pattern matching ---

const BUSY_INDICATORS = [
  "esc to interrupt",
  "(esc to interrupt)",
  "\u00b7 esc to interrupt",
];

const SPINNER_CHARS = [
  "\u280b",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283c",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280f",
];

const WHIMSICAL_WORDS = [
  "accomplishing",
  "actioning",
  "actualizing",
  "baking",
  "booping",
  "brewing",
  "calculating",
  "cerebrating",
  "channelling",
  "churning",
  "clauding",
  "coalescing",
  "cogitating",
  "combobulating",
  "computing",
  "concocting",
  "conjuring",
  "considering",
  "contemplating",
  "cooking",
  "crafting",
  "creating",
  "crunching",
  "deciphering",
  "deliberating",
  "determining",
  "discombobulating",
  "divining",
  "doing",
  "effecting",
  "elucidating",
  "enchanting",
  "envisioning",
  "finagling",
  "flibbertigibbeting",
  "forging",
  "forming",
  "frolicking",
  "generating",
  "germinating",
  "hatching",
  "herding",
  "honking",
  "hustling",
  "ideating",
  "imagining",
  "incubating",
  "inferring",
  "jiving",
  "manifesting",
  "marinating",
  "meandering",
  "moseying",
  "mulling",
  "mustering",
  "musing",
  "noodling",
  "percolating",
  "perusing",
  "philosophising",
  "pondering",
  "pontificating",
  "processing",
  "puttering",
  "puzzling",
  "reticulating",
  "ruminating",
  "scheming",
  "schlepping",
  "shimmying",
  "shucking",
  "simmering",
  "smooshing",
  "spelunking",
  "spinning",
  "stewing",
  "sussing",
  "synthesizing",
  "thinking",
  "tinkering",
  "transmuting",
  "unfurling",
  "unravelling",
  "vibing",
  "wandering",
  "whirring",
  "wibbling",
  "wizarding",
  "working",
  "wrangling",
];

const WAITING_PATTERNS = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Allow\?/i,
  /Approve\?/i,
  /Continue\?/i,
  /Press Enter to/i,
  /waiting for input/i,
  /\(yes\/no\)/i,
  /Do you want to/i,
  /Enter to confirm.*Esc to cancel/i,
  />\s*1\.\s*Yes/,
  /Yes, allow all/i,
  /allow all edits/i,
  /allow all commands/i,
];

function checkBusyIndicators(content: string): boolean {
  const lines = content.split("\n");
  const recent = lines.slice(-10).join("\n").toLowerCase();
  if (BUSY_INDICATORS.some((ind) => recent.includes(ind))) return true;
  if (
    recent.includes("tokens") &&
    WHIMSICAL_WORDS.some((w) => recent.includes(w))
  )
    return true;
  const last5 = lines.slice(-5).join("");
  return SPINNER_CHARS.some((s) => last5.includes(s));
}

function checkWaitingPatterns(content: string): boolean {
  const recent = content.split("\n").slice(-5).join("\n");
  return WAITING_PATTERNS.some((p) => p.test(recent));
}

// --- Types ---

export type SessionStatus = "running" | "waiting" | "idle" | "dead";

interface TrackedSession {
  lastActivityTimestamp: number;
  status: SessionStatus;
  lastChangeTime: number;
  acknowledged: boolean;
  spikeWindowStart: number | null;
  spikeChangeCount: number;
  lastLine: string;
  waitingContext?: string;
  claudeSessionId: string | null;
  claudeIdCachedAt: number;
}

export interface SessionStatusSnapshot {
  sessionName: string;
  status: SessionStatus;
  lastLine: string;
  waitingContext?: string;
  claudeSessionId: string | null;
  agentType: AgentType;
}

// --- State ---

const tracked = new Map<string, TrackedSession>();
let currentSnapshot: Record<string, SessionStatusSnapshot> = {};
let monitorTimer: ReturnType<typeof setTimeout> | null = null;
let _currentInterval = INTERVAL_IDLE_MS;

// --- tmux helpers ---

async function listTmuxSessions(): Promise<Map<string, number>> {
  try {
    const { stdout } = await execAsync(
      "tmux list-sessions -F '#{session_name}\t#{session_activity}' 2>/dev/null || echo \"\""
    );
    const map = new Map<string, number>();
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const name = line.slice(0, tab);
      const ts = parseInt(line.slice(tab + 1), 10) || 0;
      map.set(name, ts);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function capturePaneLines(sessionName: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -5 2>/dev/null || echo ""`
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

function extractLastLines(content: string): {
  lastLine: string;
  waitingContext?: string;
} {
  const lines = content.split("\n").filter(Boolean);
  const lastLine = lines[lines.length - 1] || "";
  const waitingContext =
    lines.length > 1 ? lines.slice(-3).join("\n") : undefined;
  return { lastLine, waitingContext };
}

// --- Claude session ID resolution ---

async function resolveClaudeSessionId(
  session: TrackedSession,
  sessionName: string
): Promise<string | null> {
  if (
    session.claudeSessionId &&
    Date.now() - session.claudeIdCachedAt < CLAUDE_ID_CACHE_TTL
  ) {
    return session.claudeSessionId;
  }

  let id: string | null = null;

  try {
    const { stdout } = await execAsync(
      `tmux show-environment -t "${sessionName}" CLAUDE_SESSION_ID 2>/dev/null || echo ""`
    );
    const line = stdout.trim();
    if (line.startsWith("CLAUDE_SESSION_ID=")) {
      const val = line.replace("CLAUDE_SESSION_ID=", "");
      if (val && val !== "null") id = val;
    }
  } catch {
    // ignore
  }

  if (!id) {
    try {
      const { stdout } = await execAsync(
        `tmux display-message -t "${sessionName}" -p "#{pane_current_path}" 2>/dev/null || echo ""`
      );
      const cwd = stdout.trim();
      if (cwd) id = findClaudeSessionInFiles(cwd);
    } catch {
      // ignore
    }
  }

  session.claudeSessionId = id;
  session.claudeIdCachedAt = Date.now();
  return id;
}

function findClaudeSessionInFiles(projectPath: string): string | null {
  const claudeDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const dirName = projectPath.replace(/\//g, "-");
  const dir = path.join(claudeDir, "projects", dirName);
  if (!fs.existsSync(dir)) return null;

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
  try {
    let best: string | null = null;
    let bestTime = 0;
    for (const file of fs.readdirSync(dir)) {
      if (file.startsWith("agent-") || !uuidRe.test(file)) continue;
      const stat = fs.statSync(path.join(dir, file));
      if (stat.mtimeMs > bestTime) {
        bestTime = stat.mtimeMs;
        best = file.replace(".jsonl", "");
      }
    }
    return best && Date.now() - bestTime < 5 * 60 * 1000 ? best : null;
  } catch {
    return null;
  }
}

// --- Status detection logic ---

function needsCapture(session: TrackedSession, newTimestamp: number): boolean {
  // Always capture if timestamp changed (new activity)
  if (session.lastActivityTimestamp !== newTimestamp) return true;
  // Capture during cooldown (status might transition)
  if (Date.now() - session.lastChangeTime < COOLDOWN_MS) return true;
  // Capture during spike window
  if (
    session.spikeWindowStart !== null &&
    Date.now() - session.spikeWindowStart < SPIKE_WINDOW_MS
  )
    return true;
  return false;
}

function determineStatus(
  session: TrackedSession,
  newTimestamp: number,
  content: string | null
): SessionStatus {
  const now = Date.now();

  // If we have fresh content, check patterns
  if (content !== null) {
    if (checkBusyIndicators(content)) {
      session.lastChangeTime = now;
      session.acknowledged = false;
      return "running";
    }
    if (checkWaitingPatterns(content)) return "waiting";
  }

  // Spike detection
  const tsChanged = session.lastActivityTimestamp !== newTimestamp;
  if (tsChanged) {
    session.lastActivityTimestamp = newTimestamp;

    const windowExpired =
      session.spikeWindowStart === null ||
      now - session.spikeWindowStart > SPIKE_WINDOW_MS;

    if (windowExpired) {
      session.spikeWindowStart = now;
      session.spikeChangeCount = 1;
    } else {
      session.spikeChangeCount++;
      if (session.spikeChangeCount >= SPIKE_THRESHOLD) {
        session.lastChangeTime = now;
        session.acknowledged = false;
        session.spikeWindowStart = null;
        session.spikeChangeCount = 0;
        return "running";
      }
    }
  } else if (
    session.spikeChangeCount === 1 &&
    session.spikeWindowStart !== null &&
    now - session.spikeWindowStart > SPIKE_WINDOW_MS
  ) {
    session.spikeWindowStart = null;
    session.spikeChangeCount = 0;
  }

  // During spike window, hold stable
  if (
    session.spikeWindowStart !== null &&
    now - session.spikeWindowStart < SPIKE_WINDOW_MS
  ) {
    return now - session.lastChangeTime < COOLDOWN_MS
      ? "running"
      : session.acknowledged
        ? "idle"
        : "waiting";
  }

  // Cooldown
  if (now - session.lastChangeTime < COOLDOWN_MS) return "running";

  return session.acknowledged ? "idle" : "waiting";
}

// --- Core tick ---

async function tick(): Promise<void> {
  const tmux = await listTmuxSessions();
  const managed = [...tmux.entries()].filter(([name]) =>
    UUID_PATTERN.test(name)
  );

  if (managed.length === 0) {
    // No sessions — clear state and broadcast empty if needed
    if (Object.keys(currentSnapshot).length > 0) {
      currentSnapshot = {};
      tracked.clear();
      broadcast({ type: "session-statuses", statuses: {} });
    }
    scheduleNext(INTERVAL_IDLE_MS);
    return;
  }

  let hasChanges = false;
  let hasActive = false;
  const newSnapshot: Record<string, SessionStatusSnapshot> = {};
  const dbUpdates: Array<{ id: string; claudeSessionId: string | null }> = [];

  // Process sessions in parallel
  const results = await Promise.all(
    managed.map(async ([sessionName, activityTs]) => {
      const id = getSessionIdFromName(sessionName);
      const agentType = getProviderIdFromSessionName(sessionName) || "claude";

      // Get or create tracker
      let session = tracked.get(sessionName);
      if (!session) {
        session = {
          lastActivityTimestamp: activityTs,
          status: "idle",
          lastChangeTime: 0,
          acknowledged: true,
          spikeWindowStart: null,
          spikeChangeCount: 0,
          lastLine: "",
          claudeSessionId: null,
          claudeIdCachedAt: 0,
        };
        tracked.set(sessionName, session);
      }

      // Only capture pane if activity changed or in transition
      let content: string | null = null;
      if (needsCapture(session, activityTs)) {
        content = await capturePaneLines(sessionName);
        const { lastLine, waitingContext } = extractLastLines(content);
        session.lastLine = lastLine;
        session.waitingContext = waitingContext;
      }

      const status = determineStatus(session, activityTs, content);
      const prevStatus = session.status;
      session.status = status;

      // Resolve claude session ID (cached)
      const claudeSessionId = await resolveClaudeSessionId(
        session,
        sessionName
      );

      return {
        id,
        sessionName,
        agentType,
        status,
        prevStatus,
        claudeSessionId,
      };
    })
  );

  for (const {
    id,
    sessionName,
    agentType,
    status,
    prevStatus,
    claudeSessionId,
  } of results) {
    const session = tracked.get(sessionName)!;

    const snap: SessionStatusSnapshot = {
      sessionName,
      status,
      lastLine: session.lastLine,
      ...(status === "waiting" && session.waitingContext
        ? { waitingContext: session.waitingContext }
        : {}),
      claudeSessionId,
      agentType,
    };
    newSnapshot[id] = snap;

    // Track if anything changed for broadcast
    const prev = currentSnapshot[id];
    if (!prev || prev.status !== status || prev.lastLine !== session.lastLine) {
      hasChanges = true;
    }

    if (status === "running" || status === "waiting") hasActive = true;

    // DB update only on status change
    if (prevStatus !== status) {
      dbUpdates.push({ id, claudeSessionId });
    }
  }

  // Check for disappeared sessions
  for (const id of Object.keys(currentSnapshot)) {
    if (!(id in newSnapshot)) hasChanges = true;
  }

  // Clean up trackers for dead sessions
  for (const [name] of tracked) {
    if (!tmux.has(name)) tracked.delete(name);
  }

  currentSnapshot = newSnapshot;

  // DB writes (only on actual changes)
  if (dbUpdates.length > 0) {
    try {
      const db = getDb();
      for (const { id, claudeSessionId } of dbUpdates) {
        db.prepare(
          "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
        ).run(id);
        if (claudeSessionId) {
          db.prepare(
            "UPDATE sessions SET claude_session_id = ? WHERE id = ? AND (claude_session_id IS NULL OR claude_session_id != ?)"
          ).run(claudeSessionId, id, claudeSessionId);
        }
      }
    } catch {
      // DB errors shouldn't break the monitor
    }
  }

  if (hasChanges) {
    broadcast({ type: "session-statuses", statuses: newSnapshot });
  }

  scheduleNext(hasActive ? INTERVAL_ACTIVE_MS : INTERVAL_IDLE_MS);
}

function scheduleNext(interval: number): void {
  _currentInterval = interval;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = setTimeout(() => {
    tick().catch(console.error);
  }, interval);
}

// --- Public API ---

export function getStatusSnapshot(): Record<string, SessionStatusSnapshot> {
  return currentSnapshot;
}

export function acknowledge(sessionName: string): void {
  const session = tracked.get(sessionName);
  if (session) session.acknowledged = true;
}

/** Trigger an immediate tick (e.g., when JSONL watcher detects a change) */
export function triggerTick(): void {
  if (monitorTimer) clearTimeout(monitorTimer);
  tick().catch(console.error);
}

export function startStatusMonitor(): void {
  if (monitorTimer) return;
  setTimeout(() => tick().catch(console.error), 500);
  console.log("> Status monitor started (adaptive 1-3s push)");
}

export function stopStatusMonitor(): void {
  if (monitorTimer) {
    clearTimeout(monitorTimer);
    monitorTimer = null;
  }
}
