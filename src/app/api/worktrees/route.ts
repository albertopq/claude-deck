import { NextRequest, NextResponse } from "next/server";
import { createWorktree, deleteWorktree } from "@/lib/worktrees";
import { invalidateAllProjects } from "@/lib/claude/jsonl-cache";

export async function POST(request: NextRequest) {
  try {
    const { projectPath, featureName, baseBranch } = await request.json();

    if (!projectPath || !featureName) {
      return NextResponse.json(
        { error: "projectPath and featureName are required" },
        { status: 400 }
      );
    }

    const worktree = await createWorktree({
      projectPath,
      featureName,
      baseBranch,
    });

    return NextResponse.json(worktree, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to create worktree: ${message}` },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { worktreePath, projectPath, deleteBranch } = await request.json();
    if (!worktreePath || !projectPath) {
      return NextResponse.json(
        { error: "worktreePath and projectPath are required" },
        { status: 400 }
      );
    }
    await deleteWorktree(worktreePath, projectPath, Boolean(deleteBranch));
    invalidateAllProjects();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to delete worktree: ${message}` },
      { status: 400 }
    );
  }
}
