<script lang="ts">
  import "../app.css";
  import { goto, invalidateAll } from "$app/navigation";
  import type { LayoutData } from "./$types";
  import type { Workspace } from "$lib/devbox/types";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import WorkspaceModal from "$lib/components/WorkspaceModal.svelte";
  import LaunchDialog from "$lib/components/LaunchDialog.svelte";
  import { List } from "phosphor-svelte";

  let { children, data }: { children: import("svelte").Snippet; data: LayoutData } = $props();

  let sidebarOpen = $state(false);
  let workspaceModalOpen = $state(false);
  let workspaceModalWorkspace = $state<Workspace | null>(null);
  let launchDialogOpen = $state(false);
  let launchDialogWorkspace = $state<Workspace | null>(null);

  function openCreateModal() {
    workspaceModalWorkspace = null;
    workspaceModalOpen = true;
  }

  function openEditModal(workspace: Workspace) {
    workspaceModalWorkspace = workspace;
    workspaceModalOpen = true;
  }

  function openLaunchDialog(workspace: Workspace) {
    launchDialogWorkspace = workspace;
    launchDialogOpen = true;
  }

  async function onWorkspaceSaved() {
    workspaceModalOpen = false;
    await invalidateAll();
  }

  async function onSandboxLaunched(sandboxId: string) {
    launchDialogOpen = false;
    sidebarOpen = false;
    await invalidateAll();
    await goto(`/?sandbox=${sandboxId}`);
  }
</script>

<div class="flex h-screen overflow-hidden">
  <!-- Mobile backdrop -->
  {#if sidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
    <div
      class="fixed inset-0 z-30 bg-overlay md:hidden"
      role="button"
      tabindex="0"
      onclick={() => (sidebarOpen = false)}
    ></div>
  {/if}

  <Sidebar
    workspaces={data.workspaces}
    sandboxes={data.sandboxes}
    open={sidebarOpen}
    onAddWorkspace={openCreateModal}
    onEditWorkspace={openEditModal}
    onLaunchWorkspace={openLaunchDialog}
    onClose={() => (sidebarOpen = false)}
  />

  <main class="flex flex-1 flex-col overflow-hidden">
    <!-- Mobile top bar -->
    <div class="flex h-10 flex-shrink-0 items-center border-b border-sidebar-divider px-3 md:hidden">
      <button
        onclick={() => (sidebarOpen = !sidebarOpen)}
        class="flex size-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-surface-hover hover:text-foreground"
        aria-label="Toggle sidebar"
      >
        <List class="size-4" />
      </button>
    </div>

    {@render children()}
  </main>
</div>

{#if workspaceModalOpen}
  <WorkspaceModal
    workspace={workspaceModalWorkspace}
    onClose={() => (workspaceModalOpen = false)}
    onSaved={onWorkspaceSaved}
  />
{/if}

{#if launchDialogOpen && launchDialogWorkspace}
  <LaunchDialog
    workspace={launchDialogWorkspace}
    onClose={() => (launchDialogOpen = false)}
    onLaunched={onSandboxLaunched}
  />
{/if}
