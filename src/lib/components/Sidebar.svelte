<script lang="ts">
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import type { Workspace, ListedSandbox } from "$lib/werkbench/types";
  import {
    deleteWorkspaceCommand,
    killSandboxCommand,
    pauseSandboxCommand,
    resumeSandboxCommand,
  } from "$lib/remote/werkbench.remote";
  import { CaretDown, CaretRight, Pause, Play, Plus, Terminal, Trash } from "phosphor-svelte";

  let {
    workspaces,
    sandboxes,
    open = false,
    onAddWorkspace,
    onEditWorkspace,
    onDeleteWorkspace,
    onLaunchWorkspace,
    onClose,
  }: {
    workspaces: Workspace[];
    sandboxes: ListedSandbox[];
    open?: boolean;
    onAddWorkspace: () => void;
    onEditWorkspace: (workspace: Workspace) => void;
    onDeleteWorkspace?: (workspaceId: string) => void | Promise<void>;
    onLaunchWorkspace: (workspace: Workspace) => void;
    onClose?: () => void;
  } = $props();

  let collapsedWorkspaces = $state<Set<string>>(new Set());
  let sandboxActionPendingId = $state<string | null>(null);
  let actionError = $state("");
  const expandedWorkspaces = $derived.by(() => {
    const next = new Set<string>();

    for (const workspace of workspaces) {
      if (!collapsedWorkspaces.has(workspace.id)) {
        next.add(workspace.id);
      }
    }

    return next;
  });

  const openSandboxIds = $derived(page.url.searchParams.getAll("sandbox"));
  const selectedSandboxId = $derived(
    page.url.searchParams.get("active") ?? openSandboxIds[openSandboxIds.length - 1] ?? null,
  );

  function sandboxesForWorkspace(workspaceId: string) {
    return sandboxes.filter((s) => s.metadata?.workspaceId === workspaceId);
  }

  function avatarColor(name: string) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
    return `var(--avatar-${(hash % 7) + 1})`;
  }

  function toggleWorkspace(id: string) {
    const next = new Set(collapsedWorkspaces);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    collapsedWorkspaces = next;
  }

  async function selectSandbox(sandboxId: string) {
    const params = new URLSearchParams(page.url.searchParams);

    if (!openSandboxIds.includes(sandboxId)) {
      params.append("sandbox", sandboxId);
    }

    params.set("active", sandboxId);
    await goto(`/?${params.toString()}`, { replaceState: false });
    onClose?.();
  }

  async function handleResumeSandbox(event: MouseEvent, sandboxId: string) {
    event.stopPropagation();

    sandboxActionPendingId = sandboxId;
    actionError = "";

    try {
      await resumeSandboxCommand({ sandboxId });
      await invalidateAll();
      await selectSandbox(sandboxId);
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to resume sandbox";
    } finally {
      if (sandboxActionPendingId === sandboxId) {
        sandboxActionPendingId = null;
      }
    }
  }

  async function removeSandboxFromRoute(sandboxId: string) {
    const params = new URLSearchParams(page.url.searchParams);
    const remainingIds = params.getAll("sandbox").filter((id) => id !== sandboxId);

    params.delete("sandbox");
    for (const id of remainingIds) {
      params.append("sandbox", id);
    }

    if (params.get("active") === sandboxId) {
      if (remainingIds.length > 0) {
        params.set("active", remainingIds[remainingIds.length - 1]);
      } else {
        params.delete("active");
      }
    }

    const query = params.toString();
    await goto(query ? `/?${query}` : "/", { replaceState: false });
  }

  async function handlePauseSandbox(event: MouseEvent, sandboxId: string) {
    event.stopPropagation();

    sandboxActionPendingId = sandboxId;
    actionError = "";

    try {
      await pauseSandboxCommand({ sandboxId });
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to pause sandbox";
    } finally {
      if (sandboxActionPendingId === sandboxId) {
        sandboxActionPendingId = null;
      }
    }
  }

  async function handleKillSandbox(event: MouseEvent, sandboxId: string) {
    event.stopPropagation();

    const confirmed = window.confirm("Kill this sandbox?");
    if (!confirmed) return;

    sandboxActionPendingId = sandboxId;
    actionError = "";

    try {
      await killSandboxCommand({ sandboxId });
      await removeSandboxFromRoute(sandboxId);
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to kill sandbox";
    } finally {
      if (sandboxActionPendingId === sandboxId) {
        sandboxActionPendingId = null;
      }
    }
  }

  async function handleDeleteWorkspace(event: MouseEvent, workspace: Workspace) {
    event.stopPropagation();
    actionError = "";

    const confirmed = window.confirm(`Delete workspace "${workspace.name}"?`);
    if (!confirmed) return;

    try {
      await deleteWorkspaceCommand({ workspaceId: workspace.id });
      await invalidateAll();
      await onDeleteWorkspace?.(workspace.id);
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to delete workspace";
    }
  }
</script>

<aside
  class="fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 flex-col border-r border-sidebar-divider bg-sidebar transition-transform duration-200
    md:relative md:inset-auto md:z-auto md:translate-x-0
    {open ? 'translate-x-0' : '-translate-x-full'}"
>
  <!-- Logo -->
  <div class="flex h-11 items-center border-b border-sidebar-divider px-4">
    <div class="flex items-center gap-2">
      <Terminal class="size-4 text-foreground/60" />
      <span class="font-mono text-sm font-semibold tracking-[0.15em] text-foreground/80">WERKBENCH</span>
    </div>
  </div>

  <!-- Workspaces list -->
  <div class="flex-1 overflow-y-auto py-3">
    <div class="mb-1.5 flex items-center justify-between px-3">
      <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/35">
        Workspaces
      </span>
      <button
        onclick={onAddWorkspace}
        title="Add workspace"
        class="flex size-4 items-center justify-center rounded text-foreground/35 transition-colors hover:bg-surface-hover hover:text-foreground/70"
      >
        <Plus class="size-3" />
      </button>
    </div>

    {#if actionError}
      <div class="mx-3 mb-3 rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
        {actionError}
      </div>
    {/if}

    {#if workspaces.length === 0}
      <div class="px-3 py-3 text-sm text-foreground/30">No workspaces yet.</div>
    {/if}

    {#each workspaces as workspace (workspace.id)}
      {@const wSandboxes = sandboxesForWorkspace(workspace.id)}
      {@const isExpanded = expandedWorkspaces.has(workspace.id)}

      <div class="mb-0.5 px-1.5">
        <!-- Workspace header row -->
        <div class="group flex items-center gap-1 rounded-md transition-colors hover:bg-field">
          <button
            onclick={() => toggleWorkspace(workspace.id)}
            class="flex flex-1 items-center gap-2 px-2 py-1.5 text-left"
          >
            <div
              class="flex size-5 flex-shrink-0 items-center justify-center rounded text-[11px] font-bold text-black/70"
              style="background-color: {avatarColor(workspace.name)}"
            >
              {workspace.name[0].toUpperCase()}
            </div>
            <span class="flex-1 truncate text-[13px] font-medium text-foreground/75">
              {workspace.name}
            </span>
          </button>

          <button
            type="button"
            class="flex size-7 flex-shrink-0 items-center justify-center rounded-md text-destructive/0 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            onclick={(event) => handleDeleteWorkspace(event, workspace)}
            title={`Delete ${workspace.name}`}
            aria-label={`Delete ${workspace.name}`}
          >
            <Trash class="size-3.5" />
          </button>

          <button
            type="button"
            class="flex size-7 flex-shrink-0 items-center justify-center rounded-md text-foreground/30 transition-colors hover:text-foreground/60"
            onclick={() => toggleWorkspace(workspace.id)}
            aria-label={isExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
          >
            {#if isExpanded}
              <CaretDown class="size-3" />
            {:else}
              <CaretRight class="size-3" />
            {/if}
          </button>
        </div>

        <!-- Expanded: sandboxes + launch button -->
        {#if isExpanded}
          <div class="ml-2 border-l border-sidebar-divider pl-2">
            <!-- New sandbox button -->
            <button
              onclick={() => onLaunchWorkspace(workspace)}
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-foreground/35 transition-colors hover:bg-field hover:text-foreground/60"
            >
              <Plus class="size-3" />
              New sandbox
            </button>

            <!-- Sandbox list -->
            {#each wSandboxes as sandbox (sandbox.sandboxID)}
              {@const isSelected = selectedSandboxId === sandbox.sandboxID}
              <div
                class="group flex items-center gap-1 rounded-md transition-colors {isSelected
                  ? 'bg-surface-selected'
                  : 'hover:bg-field/80'}"
              >
                <button
                  onclick={() => selectSandbox(sandbox.sandboxID)}
                  class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left transition-colors {isSelected
                    ? 'text-foreground'
                    : 'text-foreground/45 hover:text-foreground/70'}"
                >
                  <div
                    class="size-1.5 flex-shrink-0 rounded-full {sandbox.state === 'running'
                      ? 'bg-status-running'
                      : 'bg-status-paused'}"
                  ></div>
                  <span class="flex-1 truncate font-mono text-[11px]">
                    {sandbox.metadata?.repoOwner ?? "?"}/{sandbox.metadata?.repoName ??
                      sandbox.sandboxID.slice(0, 8)}
                  </span>
                </button>

                <div class="mr-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  {#if sandbox.state === "paused"}
                    <button
                      type="button"
                      class="flex size-6 flex-shrink-0 items-center justify-center rounded-md text-foreground/35 transition-colors hover:bg-field hover:text-foreground/65 disabled:cursor-not-allowed disabled:opacity-50"
                      onclick={(event) => handleResumeSandbox(event, sandbox.sandboxID)}
                      disabled={sandboxActionPendingId !== null}
                      title="Resume sandbox"
                      aria-label={`Resume ${sandbox.sandboxID}`}
                    >
                      <Play class="size-3" weight="fill" />
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="flex size-6 flex-shrink-0 items-center justify-center rounded-md text-foreground/35 transition-colors hover:bg-field hover:text-foreground/65 disabled:cursor-not-allowed disabled:opacity-50"
                      onclick={(event) => handlePauseSandbox(event, sandbox.sandboxID)}
                      disabled={sandboxActionPendingId !== null}
                      title="Pause sandbox"
                      aria-label={`Pause ${sandbox.sandboxID}`}
                    >
                      <Pause class="size-3" />
                    </button>
                  {/if}

                  <button
                    type="button"
                    class="flex size-6 flex-shrink-0 items-center justify-center rounded-md text-destructive/55 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={(event) => handleKillSandbox(event, sandbox.sandboxID)}
                    disabled={sandboxActionPendingId !== null}
                    title="Kill sandbox"
                    aria-label={`Kill ${sandbox.sandboxID}`}
                  >
                    <Trash class="size-3" />
                  </button>
                </div>
              </div>
            {/each}

            {#if wSandboxes.length === 0}
              <p class="px-2 py-1 text-[11px] text-foreground/25">No sandboxes</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Bottom -->
  <div class="border-t border-sidebar-divider p-2">
    <button
      onclick={onAddWorkspace}
      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-foreground/40 transition-colors hover:bg-field hover:text-foreground/70"
    >
      <Plus class="size-3.5" />
      Add workspace
    </button>
  </div>
</aside>
