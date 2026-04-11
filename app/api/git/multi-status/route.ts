import { NextRequest, NextResponse } from "next/server";
import { getProjectRepositories, getProject } from "@/lib/projects";
import { getMultiRepoGitStatus } from "@/lib/multi-repo-git";
import { expandPath } from "@/lib/git-status";
import type { ProjectRepository } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const fallbackPath = searchParams.get("fallbackPath");

    if (!projectId && !fallbackPath) {
      return NextResponse.json(
        { error: "Either projectId or fallbackPath is required" },
        { status: 400 }
      );
    }

    let repositories: ProjectRepository[] = [];

    if (projectId) {
      const project = await getProject(projectId);
      if (!project) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }
      repositories = await getProjectRepositories(projectId);
    }

    const expandedFallback = fallbackPath
      ? expandPath(fallbackPath)
      : undefined;
    const status = getMultiRepoGitStatus(repositories, expandedFallback);

    return NextResponse.json(status);
  } catch (error) {
    console.error("Error fetching multi-repo git status:", error);
    return NextResponse.json(
      { error: "Failed to fetch git status" },
      { status: 500 }
    );
  }
}
