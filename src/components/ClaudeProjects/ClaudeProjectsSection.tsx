"use client";

import { useState, useMemo } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  useClaudeProjectsQuery,
  useClaudeUpdates,
  type ClaudeProject,
} from "@/data/claude";
import { ClaudeProjectCard } from "./ClaudeProjectCard";

interface ClaudeProjectsSectionProps {
  onSelectSession?: (
    sessionId: string,
    directory: string,
    summary: string,
    projectName: string
  ) => void;
  onNewSession?: (cwd: string, projectName: string) => void;
}

function ProjectsSkeleton() {
  return (
    <div className="space-y-1 px-2 py-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="bg-muted h-4 w-4 animate-pulse rounded" />
          <div
            className="bg-muted h-3.5 animate-pulse rounded"
            style={{ width: `${60 + Math.random() * 60}px` }}
          />
          <div className="flex-1" />
          <div className="bg-muted h-3 w-4 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

interface ProjectGroup {
  parent: ClaudeProject | null;
  children: ClaudeProject[];
}

function groupByParent(projects: ClaudeProject[]): ProjectGroup[] {
  const byDirectory = new Map<string, ClaudeProject>();
  for (const p of projects) {
    if (p.directory) byDirectory.set(p.directory, p);
  }

  const groups: ProjectGroup[] = [];
  const consumed = new Set<string>();

  for (const p of projects) {
    if (p.isWorktree) continue;
    groups.push({ parent: p, children: [] });
    consumed.add(p.name);
  }

  for (const p of projects) {
    if (!p.isWorktree) continue;
    const parent = p.parentRoot ? byDirectory.get(p.parentRoot) : undefined;
    if (parent && consumed.has(parent.name)) {
      const group = groups.find((g) => g.parent?.name === parent.name);
      group?.children.push(p);
    } else {
      groups.push({ parent: p, children: [] });
      consumed.add(p.name);
    }
  }

  return groups;
}

export function ClaudeProjectsSection({
  onSelectSession,
  onNewSession,
}: ClaudeProjectsSectionProps) {
  useClaudeUpdates();
  const { data: projects = [], isPending } = useClaudeProjectsQuery();
  const [showHidden, setShowHidden] = useState(false);

  const groups = useMemo(() => {
    const visible = showHidden ? projects : projects.filter((p) => !p.hidden);
    return groupByParent(visible);
  }, [projects, showHidden]);

  const hiddenCount = projects.filter((p) => p.hidden).length;

  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-muted-foreground text-xs font-medium">
          Projects
        </span>
        <div className="flex items-center gap-1">
          {isPending && (
            <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
          )}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="text-muted-foreground hover:text-foreground p-0.5"
            >
              {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>
      </div>

      {isPending && projects.length === 0 && <ProjectsSkeleton />}

      <div className="space-y-0.5">
        {groups.map((group) => (
          <div key={group.parent?.name ?? "orphan"}>
            {group.parent && (
              <ClaudeProjectCard
                project={group.parent}
                showHidden={showHidden}
                onSelectSession={onSelectSession}
                onNewSession={onNewSession}
              />
            )}
            {group.children.length > 0 && (
              <div className="border-border/30 ml-3 space-y-0.5 border-l pl-1.5">
                {group.children.map((child) => (
                  <ClaudeProjectCard
                    key={child.name}
                    project={child}
                    showHidden={showHidden}
                    onSelectSession={onSelectSession}
                    onNewSession={onNewSession}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
