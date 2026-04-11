import { NextResponse } from "next/server";
import {
  getClaudeProjectNames,
  extractProjectDirectory,
  getSessions,
} from "@/lib/claude/jsonl-reader";
import { queries } from "@/lib/db";

export interface ClaudeProject {
  name: string;
  directory: string | null;
  displayName: string;
  sessionCount: number;
  lastActivity: string | null;
  hidden: boolean;
}

function decodeProjectName(encoded: string): string {
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

function deriveDisplayName(directory: string | null, encoded: string): string {
  if (directory) {
    const parts = directory.split("/");
    return parts[parts.length - 1] || directory;
  }
  const decoded = decodeProjectName(encoded);
  const parts = decoded.split("/");
  return parts[parts.length - 1] || decoded;
}

export async function GET() {
  try {
    const projectNames = getClaudeProjectNames();
    const hiddenItems = await queries.getHiddenItems("project");
    const hiddenSet = new Set(hiddenItems.map((h) => h.item_id));

    const projects: ClaudeProject[] = [];

    for (const name of projectNames) {
      const [directory, sessionData] = await Promise.all([
        extractProjectDirectory(name),
        getSessions(name, 1, 0),
      ]);

      const { sessions, total } = sessionData;
      const lastActivity = sessions[0]?.lastActivity || null;

      projects.push({
        name,
        directory,
        displayName: deriveDisplayName(directory, name),
        sessionCount: total,
        lastActivity,
        hidden: hiddenSet.has(name),
      });
    }

    projects.sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return (
        new Date(b.lastActivity).getTime() -
        new Date(a.lastActivity).getTime()
      );
    });

    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Error discovering Claude projects:", error);
    return NextResponse.json(
      { error: "Failed to discover projects" },
      { status: 500 }
    );
  }
}
