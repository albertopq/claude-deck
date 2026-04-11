/**
 * Port Management for Dev Servers
 *
 * Assigns unique ports to worktree sessions to avoid conflicts.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { getPool } from "./db";

const execAsync = promisify(exec);

// Port range for dev servers
const BASE_PORT = 3100;
const PORT_INCREMENT = 10;
const MAX_PORT = 3900;

/**
 * Check if a port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `lsof -i :${port} -sTCP:LISTEN 2>/dev/null | head -1`,
      { timeout: 5000 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get all ports currently assigned to sessions
 */
export async function getAssignedPorts(): Promise<number[]> {
  const { rows } = await getPool().query(
    "SELECT dev_server_port FROM sessions WHERE dev_server_port IS NOT NULL"
  );
  return (rows as Array<{ dev_server_port: number }>).map((s) => s.dev_server_port);
}

/**
 * Find the next available port
 */
export async function findAvailablePort(): Promise<number> {
  const assignedPorts = new Set(await getAssignedPorts());

  for (let port = BASE_PORT; port <= MAX_PORT; port += PORT_INCREMENT) {
    // Skip if already assigned to a session
    if (assignedPorts.has(port)) {
      continue;
    }

    // Check if port is actually in use (by something outside AgentOS)
    if (!(await isPortInUse(port))) {
      return port;
    }
  }

  // Fallback: return a random port in range
  return BASE_PORT + Math.floor(Math.random() * 80) * PORT_INCREMENT;
}

/**
 * Assign a port to a session
 */
export async function assignPort(sessionId: string): Promise<number> {
  const port = await findAvailablePort();
  await getPool().query(
    "UPDATE sessions SET dev_server_port = $1 WHERE id = $2",
    [port, sessionId]
  );
  return port;
}

/**
 * Release a port from a session
 */
export async function releasePort(sessionId: string): Promise<void> {
  await getPool().query(
    "UPDATE sessions SET dev_server_port = NULL WHERE id = $1",
    [sessionId]
  );
}

/**
 * Get the port assigned to a session
 */
export async function getSessionPort(sessionId: string): Promise<number | null> {
  const { rows } = await getPool().query(
    "SELECT dev_server_port FROM sessions WHERE id = $1",
    [sessionId]
  );
  const result = rows[0] as { dev_server_port: number | null } | undefined;
  return result?.dev_server_port || null;
}
