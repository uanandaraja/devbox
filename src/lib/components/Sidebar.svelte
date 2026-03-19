<script lang="ts">
  import { page } from "$app/state";
  import { goto, invalidateAll } from "$app/navigation";
  import type { Workspace, ListedSandbox } from "$lib/devbox/types";
  import { resumeSandboxCommand } from "$lib/remote/devbox.remote";
  import { CaretDown, CaretRight, Play, Plus, Terminal } from "phosphor-svelte";

  let {
    workspaces,
    sandboxes,
    open = false,
    onAddWorkspace,
    onEditWorkspace,
    onLaunchWorkspace,
    onClose,
  }: {
    workspaces: Workspace[];
    sandboxes: ListedSandbox[];
    open?: boolean;
    onAddWorkspace: () => void;
    onEditWorkspace: (workspace: Workspace) => void;
    onLaunchWorkspace: (workspace: Workspace) => void;
    onClose?: () => void;
  } = $props();

  let collapsedWorkspaces = $state<Set<string>>(new Set());
  let resumePendingSandboxId = $state<string | null>(null);
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

    resumePendingSandboxId = sandboxId;
    actionError = "";

    try {
      await resumeSandboxCommand({ sandboxId });
      await invalidateAll();
      await selectSandbox(sandboxId);
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to resume sandbox";
    } finally {
      if (resumePendingSandboxId === sandboxId) {
        resumePendingSandboxId = null;
      }
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
      <span class="font-mono text-sm font-semibold tracking-[0.15em] text-foreground/80">DEVBOX</span>
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
        <div class="group flex items-center gap-1">
          <button
            onclick={() => toggleWorkspace(workspace.id)}
            class="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-field"
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
            {#if isExpanded}
              <CaretDown class="size-3 flex-shrink-0 text-foreground/30" />
            {:else}
              <CaretRight class="size-3 flex-shrink-0 text-foreground/30" />
            {/if}
          </button>
        </div>

        <!-- Expanded: sandboxes + launch button -->
        {#if isExpanded}
          <div class="ml-[1.125rem] border-l border-sidebar-divider pl-3">
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
              <div class="flex items-center gap-1">
                <button
                  onclick={() => selectSandbox(sandbox.sandboxID)}
                  class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors {isSelected
                    ? 'bg-surface-selected text-foreground'
                    : 'text-foreground/45 hover:bg-field/80 hover:text-foreground/70'}"
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

                {#if sandbox.state === "paused"}
                  <button
                    type="button"
                    class="flex size-6 flex-shrink-0 items-center justify-center rounded-md text-foreground/35 transition-colors hover:bg-field hover:text-foreground/65 disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={(event) => handleResumeSandbox(event, sandbox.sandboxID)}
                    disabled={resumePendingSandboxId !== null}
                    title="Resume sandbox"
                    aria-label={`Resume ${sandbox.sandboxID}`}
                  >
                    <Play class="size-3" weight="fill" />
                  </button>
                {/if}
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
