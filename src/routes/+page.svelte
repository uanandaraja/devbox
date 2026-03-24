<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import type { PageData } from "./$types";
  import TerminalPanel from "$lib/components/TerminalPanel.svelte";
  import { X } from "phosphor-svelte";

  let { data }: { data: PageData } = $props();

  const openSandboxIds = $derived(page.url.searchParams.getAll("sandbox"));
  const activeSandboxId = $derived(
    page.url.searchParams.get("active") ?? openSandboxIds[openSandboxIds.length - 1] ?? null,
  );
  const openSandboxes = $derived(
    openSandboxIds
      .map((sandboxId) => data.sandboxes.find((sandbox) => sandbox.sandboxID === sandboxId) ?? null)
      .filter((sandbox) => sandbox !== null),
  );

  async function setActiveSandbox(sandboxId: string) {
    const params = new URLSearchParams(page.url.searchParams);
    params.set("active", sandboxId);
    await goto(`/?${params.toString()}`, { replaceState: false });
  }

  async function closeSandboxTab(sandboxId: string) {
    const params = new URLSearchParams(page.url.searchParams);
    const remainingIds = params.getAll("sandbox").filter((id) => id !== sandboxId);

    params.delete("sandbox");
    for (const id of remainingIds) {
      params.append("sandbox", id);
    }

    const currentActive = params.get("active");
    if (currentActive === sandboxId) {
      if (remainingIds.length > 0) {
        params.set("active", remainingIds[remainingIds.length - 1]);
      } else {
        params.delete("active");
      }
    }

    const query = params.toString();
    await goto(query ? `/?${query}` : "/", { replaceState: false });
  }
</script>

<svelte:head>
  <title>Werkbench</title>
</svelte:head>

{#if openSandboxes.length > 0}
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 gap-2 overflow-x-auto border-b border-sidebar-divider px-3 py-2">
      {#each openSandboxes as sandbox (sandbox.sandboxID)}
        {@const isActive = activeSandboxId === sandbox.sandboxID}
        <div
          class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors {isActive
            ? 'border-border bg-surface-selected text-foreground'
            : 'border-transparent bg-field/40 text-foreground/50 hover:bg-field hover:text-foreground/80'}"
        >
          <button
            class="flex items-center gap-2"
            onclick={() => setActiveSandbox(sandbox.sandboxID)}
          >
            <div
              class="size-1.5 rounded-full {sandbox.state === 'running'
                ? 'bg-status-running'
                : 'bg-status-paused'}"
            ></div>
            <span class="font-mono">
              {sandbox.metadata?.repoName ?? sandbox.sandboxID.slice(0, 8)}
            </span>
          </button>
          <button
            class="rounded p-0.5 text-foreground/40 hover:bg-black/10 hover:text-foreground/80"
            onclick={() => closeSandboxTab(sandbox.sandboxID)}
            aria-label={`Close ${sandbox.sandboxID}`}
          >
            <X class="size-3.5" />
          </button>
        </div>
      {/each}
    </div>

    <div class="min-h-0 flex-1">
      {#each openSandboxes as sandbox (sandbox.sandboxID)}
        <div class:hidden={activeSandboxId !== sandbox.sandboxID} class="h-full">
          <TerminalPanel
            sandbox={sandbox}
            active={activeSandboxId === sandbox.sandboxID}
          />
        </div>
      {/each}
    </div>
  </div>
{:else}
  <!-- Empty state -->
  <div class="flex h-full flex-col items-center justify-center gap-10">
    <!-- Pixel-style wordmark -->
    <div class="select-none text-center">
      <h1
        class="font-mono text-[clamp(2rem,6vw,4rem)] font-black tracking-[0.3em] text-foreground/[0.07]"
      >
        WERKBENCH
      </h1>
    </div>

    {#if data.workspaces.length === 0}
      <!-- No workspaces yet -->
      <div class="text-center">
        <p class="text-sm text-foreground/40">No workspaces yet.</p>
        <p class="mt-1 text-sm text-foreground/25">
          Use the <span class="font-mono">+</span> in the sidebar to add one.
        </p>
      </div>
    {:else}
      <!-- Has workspaces, just nothing selected -->
      <div class="text-center">
        <p class="text-sm text-foreground/35">Select a sandbox from the sidebar</p>
        <p class="mt-1 text-sm text-foreground/25">or launch a new one from a workspace.</p>
      </div>
    {/if}
  </div>
{/if}
