"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRenameWorktree, type ClaudeProject } from "@/data/claude";

interface RenameWorktreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worktree: ClaudeProject;
}

function slugifyBranch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function RenameWorktreeDialog({
  open,
  onOpenChange,
  worktree,
}: RenameWorktreeDialogProps) {
  const [value, setValue] = useState("");
  const renameMutation = useRenameWorktree();
  const parentPath = worktree.parentRoot || worktree.directory || "";
  const preview = slugifyBranch(value);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview || !worktree.directory) return;
    renameMutation.mutate(
      {
        worktreePath: worktree.directory,
        projectPath: parentPath,
        newBranchName: preview,
      },
      {
        onSuccess: () => {
          toast.success("Rama renombrada");
          onOpenChange(false);
          setValue("");
        },
        onError: (err) => {
          toast.error(err.message || "No se pudo renombrar");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renombrar rama</DialogTitle>
          <DialogDescription>
            El directorio del worktree no cambia, solo el nombre de la rama git.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <div className="text-muted-foreground mb-1 text-xs">
              Rama actual
            </div>
            <div className="font-mono text-sm">{worktree.displayName}</div>
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground text-xs">
              Nuevo nombre
            </label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="my-new-feature"
              autoFocus
            />
            {preview && (
              <p className="text-muted-foreground text-xs">Rama: {preview}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={renameMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!preview || renameMutation.isPending}
            >
              {renameMutation.isPending ? "Renombrando…" : "Renombrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
