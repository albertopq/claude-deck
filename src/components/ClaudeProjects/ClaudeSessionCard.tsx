"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MessageSquare, Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDeleteClaudeSession, type ClaudeSession } from "@/data/claude";

interface ClaudeSessionCardProps {
  session: ClaudeSession;
  projectName: string;
  onHide: () => void;
  onUnhide: () => void;
  onSelect?: (
    sessionId: string,
    directory: string,
    summary: string,
    projectName: string
  ) => void;
}

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function ClaudeSessionCard({
  session,
  projectName,
  onHide,
  onUnhide,
  onSelect,
}: ClaudeSessionCardProps) {
  const deleteSession = useDeleteClaudeSession();

  const handleClick = () => {
    if (onSelect && session.cwd) {
      onSelect(session.sessionId, session.cwd, session.summary, projectName);
    }
  };

  const handleDelete = () => {
    if (deleteSession.isPending) return;
    deleteSession.mutate(
      { projectName, sessionId: session.sessionId },
      {
        onSuccess: () => {
          toast.success("Session deleted");
        },
        onError: (err) => {
          toast.error(err.message || "Failed to delete session");
        },
      }
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={handleClick}
          className={cn(
            "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm",
            "hover:bg-accent/50",
            session.hidden && "opacity-40",
            deleteSession.isPending && "pointer-events-none opacity-50"
          )}
        >
          <MessageSquare className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
          <TruncatedText
            text={session.summary || "Untitled session"}
            className="flex-1 text-xs"
          />
          <span className="text-muted-foreground flex-shrink-0 text-[10px]">
            {getTimeAgo(session.lastActivity)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              if (session.hidden) {
                onUnhide();
              } else {
                onHide();
              }
            }}
          >
            {session.hidden ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
