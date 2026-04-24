import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getProjectDir } from "@/lib/claude/jsonl-reader";
import { invalidateAllProjects } from "@/lib/claude/jsonl-cache";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ name: string; sessionId: string }>;
}

export async function DELETE(_: Request, { params }: RouteParams) {
  try {
    const { name, sessionId } = await params;

    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json(
        { error: "invalid session id" },
        { status: 400 }
      );
    }

    const projectDir = getProjectDir(name);
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    if (path.dirname(filePath) !== projectDir) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }

    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      throw err;
    }

    invalidateAllProjects();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to delete session: ${message}` },
      { status: 500 }
    );
  }
}
