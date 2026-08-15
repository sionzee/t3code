import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { GitCommandError, type ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readEnvironmentThreadRefs, readProject, readThreadShell } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import type { ThreadShell } from "../types";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { useClientSettings } from "./useSettings";

type WorktreeThread = Pick<ThreadShell, "branch" | "projectId" | "worktreePath">;

const isGitCommandError = Schema.is(GitCommandError);

/**
 * Both halves of the `deleteWorktreeOnSettle` setting, for every settle and
 * un-settle entry point to call after its command lands. Each is a no-op when
 * the setting is off, so callers do not repeat the check.
 *
 * Settling never clears the thread's branch or worktreePath, and removing a
 * worktree never deletes its branch, so restoring is re-adding the same path
 * on the same branch: the thread stays linked exactly as it was.
 */
export function useSettleWorktreeSync() {
  const enabled = useClientSettings((settings) => settings.deleteWorktreeOnSettle);
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, { reportFailure: false });
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });

  const removeWorktreeForSettledThread = useCallback(
    async (thread: WorktreeThread, threadRef: ScopedThreadRef) => {
      if (!enabled) {
        return;
      }
      const threads = readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
        const shell = readThreadShell(ref);
        return shell === null ? [] : [shell];
      });
      // Null when a sibling thread still points at the same checkout.
      const worktreePath = getOrphanedWorktreePathForThread(threads, threadRef.threadId);
      const project = readProject({
        environmentId: threadRef.environmentId,
        projectId: thread.projectId,
      });
      if (!worktreePath || !project) {
        return;
      }
      // Never forced: git refuses on a dirty worktree, so settling cannot
      // discard uncommitted work.
      const removeResult = await removeWorktree({
        environmentId: threadRef.environmentId,
        input: { cwd: project.workspaceRoot, path: worktreePath, force: false },
      });
      if (removeResult._tag === "Failure") {
        const error = squashAtomCommandFailure(removeResult);
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove worktree after thread settle", {
          threadId: threadRef.threadId,
          projectCwd: project.workspaceRoot,
          worktreePath,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Thread settled, but its worktree was kept",
            description: `Could not remove ${formatWorktreePathForDisplay(worktreePath)}. ${message}`,
          }),
        );
        return;
      }
      await refreshVcsStatus({
        environmentId: threadRef.environmentId,
        input: { cwd: project.workspaceRoot },
      });
    },
    [enabled, refreshVcsStatus, removeWorktree],
  );

  const restoreWorktreeForUnsettledThread = useCallback(
    async (thread: WorktreeThread, threadRef: ScopedThreadRef) => {
      if (!enabled) {
        return;
      }
      const project = readProject({
        environmentId: threadRef.environmentId,
        projectId: thread.projectId,
      });
      if (!thread.worktreePath || !thread.branch || !project) {
        return;
      }
      const createResult = await createWorktree({
        environmentId: threadRef.environmentId,
        input: {
          cwd: project.workspaceRoot,
          refName: thread.branch,
          path: thread.worktreePath,
        },
      });
      if (createResult._tag === "Failure") {
        const error = squashAtomCommandFailure(createResult);
        // The checkout is already there — settle skipped the removal (dirty or
        // shared worktree) or it was re-added by hand. Nothing was lost, so
        // this is not worth a toast.
        // ponytail: matches git's stable "already exists" text; a worktree-list
        // RPC would make it exact.
        if (isGitCommandError(error) && error.detail.includes("already exists")) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unknown error adding worktree.";
        console.error("Failed to restore worktree after thread un-settle", {
          threadId: threadRef.threadId,
          projectCwd: project.workspaceRoot,
          worktreePath: thread.worktreePath,
          branch: thread.branch,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Thread reopened, but its worktree could not be restored",
            description: `Could not re-create ${formatWorktreePathForDisplay(thread.worktreePath)} on ${thread.branch}. ${message}`,
          }),
        );
        return;
      }
      await refreshVcsStatus({
        environmentId: threadRef.environmentId,
        input: { cwd: project.workspaceRoot },
      });
    },
    [createWorktree, enabled, refreshVcsStatus],
  );

  return { removeWorktreeForSettledThread, restoreWorktreeForUnsettledThread };
}
