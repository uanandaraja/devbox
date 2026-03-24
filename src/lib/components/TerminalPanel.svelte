<script lang="ts">
  import { tick } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type { DesktopSession, ListedSandbox } from "$lib/werkbench/types";
  import {
    killSandboxCommand,
    pauseSandboxCommand,
    resumeSandboxCommand,
  } from "$lib/remote/werkbench.remote";
  import { Button } from "$lib/components/ui/button/index.js";
  import TerminalPane from "$lib/components/TerminalPane.svelte";
  import {
    ArrowCounterClockwise,
    ArrowSquareOut,
    Globe,
    Pause,
    Play,
    SquareSplitHorizontal,
    SquareSplitVertical,
    Terminal,
    Trash,
    WarningCircle,
  } from "phosphor-svelte";

  let {
    sandbox,
    active = true,
    onKilled,
  }: {
    sandbox: ListedSandbox;
    active?: boolean;
    onKilled?: () => void;
  } = $props();

  let panelMode = $state<"terminal" | "browser">("terminal");
  let browserState = $state<DesktopSession["status"]>("idle");
  let browserError = $state("");
  let browserUrl = $state("");
  let actionPending = $state(false);
  let actionError = $state("");
  let browserFrame = $state<HTMLIFrameElement | null>(null);
  let splitContainer = $state<HTMLDivElement | null>(null);
  let splitRatio = $state(0.5);
  let splitLayout = $state<"columns" | "rows">("columns");
  let activePaneId = $state("terminal-1");
  let paneIds = $state(["terminal-1"]);
  let resizeDrag = $state<{
    pointerId: number;
    startRatio: number;
  } | null>(null);

  function resetBrowserState() {
    browserState = "idle";
    browserError = "";
    browserUrl = "";
  }

  async function syncActiveBrowser() {
    if (!active || panelMode !== "browser") return;
    await tick();
    requestAnimationFrame(() => {
      browserFrame?.focus();
    });
  }

  async function loadBrowser() {
    if (sandbox.state !== "running") return;

    browserState = "starting";
    browserError = "";

    const response = await fetch(`/api/desktop/${sandbox.sandboxID}/session`);
    const payload = (await response.json().catch(() => null)) as DesktopSession | null;

    if (!response.ok || !payload || payload.status !== "open" || !payload.url) {
      browserState = "error";
      browserError =
        payload?.status === "error"
          ? "Desktop failed to start"
          : "Failed to open remote desktop";
      browserUrl = "";
      return;
    }

    browserState = "open";
    browserError = "";
    browserUrl = payload.url;
  }

  async function reconnectBrowser() {
    await loadBrowser();
    await syncActiveBrowser();
  }

  function openBrowserInNewTab() {
    if (!browserUrl) return;
    window.open(browserUrl, "_blank", "noopener,noreferrer");
  }

  async function showTerminal() {
    panelMode = "terminal";
  }

  async function showBrowser() {
    panelMode = "browser";

    if (browserState === "idle" || browserState === "error") {
      await loadBrowser();
    }

    await syncActiveBrowser();
  }

  async function handleResume() {
    actionPending = true;
    actionError = "";
    try {
      await resumeSandboxCommand({ sandboxId: sandbox.sandboxID });
      await invalidateAll();
      await tick();
      if (panelMode === "browser") {
        await loadBrowser();
        await syncActiveBrowser();
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to resume";
    } finally {
      actionPending = false;
    }
  }

  async function handlePause() {
    actionPending = true;
    actionError = "";
    try {
      await pauseSandboxCommand({ sandboxId: sandbox.sandboxID });
      await invalidateAll();
      resetBrowserState();
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to pause";
    } finally {
      actionPending = false;
    }
  }

  async function handleKill() {
    actionPending = true;
    actionError = "";
    try {
      await killSandboxCommand({ sandboxId: sandbox.sandboxID });
      await invalidateAll();
      resetBrowserState();
      onKilled?.();
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to kill";
    } finally {
      actionPending = false;
    }
  }

  function addSplitPane() {
    if (paneIds.length > 1) return;

    const nextId = `terminal-${paneIds.length + 1}`;
    paneIds = [...paneIds, nextId];
    activePaneId = nextId;
    splitRatio = 0.5;
  }

  function closeSplitPane() {
    if (paneIds.length === 1) return;
    const paneToKeep = paneIds.includes(activePaneId) ? activePaneId : paneIds[0];
    paneIds = [paneToKeep];
    activePaneId = paneToKeep;
    splitRatio = 0.5;
  }

  function closePane(paneId: string) {
    if (paneIds.length === 1) return;

    const remainingPaneIds = paneIds.filter((id) => id !== paneId);
    if (remainingPaneIds.length === 0) return;

    paneIds = remainingPaneIds;

    if (activePaneId === paneId) {
      activePaneId = remainingPaneIds[remainingPaneIds.length - 1];
    }

    splitRatio = 0.5;
  }

  function setActivePane(paneId: string) {
    activePaneId = paneId;
  }

  function toggleSplitLayout() {
    splitLayout = splitLayout === "columns" ? "rows" : "columns";
    splitRatio = 0.5;
  }

  function beginSplitResize(event: PointerEvent) {
    if (paneIds.length < 2) return;

    event.preventDefault();
    resizeDrag = {
      pointerId: event.pointerId,
      startRatio: splitRatio,
    };
  }

  $effect(() => {
    if (active && panelMode === "browser" && browserUrl) {
      void syncActiveBrowser();
    }
  });

  $effect(() => {
    if (!resizeDrag || !splitContainer) return;

    const dragPointerId = resizeDrag.pointerId;
    const handlePointerMove = (event: PointerEvent) => {
      if (!splitContainer) return;

      const rect = splitContainer.getBoundingClientRect();
      if (splitLayout === "columns" && rect.width > 0) {
        const nextRatio = (event.clientX - rect.left) / rect.width;
        splitRatio = Math.min(0.75, Math.max(0.25, nextRatio));
      } else if (splitLayout === "rows" && rect.height > 0) {
        const nextRatio = (event.clientY - rect.top) / rect.height;
        splitRatio = Math.min(0.75, Math.max(0.25, nextRatio));
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === dragPointerId) {
        resizeDrag = null;
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  });
</script>

<div class="flex h-full flex-col bg-background">
  <div class="flex h-10 flex-shrink-0 items-center justify-between border-b border-sidebar-divider px-3">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1">
        <Button
          size="xs"
          variant={panelMode === "terminal" ? "secondary" : "ghost"}
          onclick={showTerminal}
          disabled={actionPending}
        >
          <Terminal class="size-3.5" />
          Terminal
        </Button>
        <Button
          size="xs"
          variant={panelMode === "browser" ? "secondary" : "ghost"}
          onclick={showBrowser}
          disabled={sandbox.state !== "running" || actionPending}
        >
          <Globe class="size-3.5" />
          Browser
        </Button>
      </div>
      {#if panelMode === "browser"}
        {#if browserState === "starting"}
          <span class="text-sm text-foreground/30">starting desktop...</span>
        {:else if browserState === "open"}
          <span class="text-sm text-foreground/30">desktop connected</span>
        {:else if browserState === "error"}
          <span class="text-sm text-destructive/70">desktop error</span>
        {/if}
      {/if}
    </div>

    <div class="flex items-center gap-1">
      {#if panelMode === "browser"}
        <Button
          size="xs"
          variant="ghost"
          onclick={reconnectBrowser}
          disabled={sandbox.state !== "running" || actionPending}
          title="Reconnect desktop"
        >
          <ArrowCounterClockwise class="size-3.5" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onclick={openBrowserInNewTab}
          disabled={!browserUrl || actionPending}
          title="Open desktop in new tab"
        >
          <ArrowSquareOut class="size-3.5" />
        </Button>
      {:else}
        <Button
          size="xs"
          variant="ghost"
          onclick={paneIds.length === 1 ? addSplitPane : closeSplitPane}
          disabled={sandbox.state !== "running" || actionPending}
          title={paneIds.length === 1 ? "Open split terminal" : "Close split terminal"}
        >
          {#if paneIds.length === 1}
            <SquareSplitHorizontal class="size-3.5" />
          {:else}
            <SquareSplitVertical class="size-3.5" />
          {/if}
        </Button>
        {#if paneIds.length > 1}
          <Button
            size="xs"
            variant="ghost"
            onclick={toggleSplitLayout}
            disabled={sandbox.state !== "running" || actionPending}
            title={splitLayout === "columns" ? "Stack panes" : "Show panes side by side"}
          >
            {#if splitLayout === "columns"}
              <SquareSplitVertical class="size-3.5" />
            {:else}
              <SquareSplitHorizontal class="size-3.5" />
            {/if}
          </Button>
        {/if}
      {/if}
      {#if sandbox.state === "paused"}
        <Button size="xs" variant="ghost" onclick={handleResume} disabled={actionPending}>
          <Play class="size-3.5" />
          Resume
        </Button>
      {:else}
        <Button size="xs" variant="ghost" onclick={handlePause} disabled={actionPending}>
          <Pause class="size-3.5" />
          Pause
        </Button>
      {/if}
      <Button
        size="xs"
        variant="ghost"
        onclick={handleKill}
        disabled={actionPending}
        class="text-destructive/70 hover:text-destructive"
        title="Kill sandbox"
      >
        <Trash class="size-3.5" />
      </Button>
    </div>
  </div>

  {#if actionError}
    <div class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <WarningCircle class="size-3.5 flex-shrink-0" />
      {actionError}
    </div>
  {/if}

  {#if browserError && panelMode === "browser"}
    <div class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <WarningCircle class="size-3.5 flex-shrink-0" />
      {browserError}
    </div>
  {/if}

  {#if sandbox.state === "paused"}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <p class="text-sm text-foreground/50">Sandbox is paused</p>
        <Button size="sm" class="mt-4" onclick={handleResume} disabled={actionPending}>
          <Play class="size-3.5" />
          {actionPending ? "Resuming..." : "Resume sandbox"}
        </Button>
      </div>
    </div>
  {:else}
    <div class:hidden={panelMode !== "terminal"} class="flex flex-1 overflow-hidden">
      <div
        class="terminal-split-grid h-full w-full"
        bind:this={splitContainer}
        data-layout={paneIds.length > 1 ? splitLayout : "single"}
        style:grid-template-columns={paneIds.length > 1 && splitLayout === "columns"
          ? `minmax(0, ${splitRatio}fr) 0.625rem minmax(0, ${1 - splitRatio}fr)`
          : "minmax(0, 1fr)"}
        style:grid-template-rows={paneIds.length > 1 && splitLayout === "rows"
          ? `minmax(0, ${splitRatio}fr) 0.625rem minmax(0, ${1 - splitRatio}fr)`
          : "minmax(0, 1fr)"}
      >
        {#each paneIds as paneId, index (paneId)}
          <div
            class="min-h-0 min-w-0 h-full"
            style:grid-column={paneIds.length > 1 && splitLayout === "columns"
              ? index === 0
                ? "1"
                : "3"
              : "1"}
            style:grid-row={paneIds.length > 1 && splitLayout === "rows"
              ? index === 0
                ? "1"
                : "3"
              : "1"}
          >
            <TerminalPane
              sandbox={sandbox}
              label={paneId === "terminal-1" ? "Terminal 1" : "Terminal 2"}
              active={active && panelMode === "terminal" && activePaneId === paneId}
              visible={panelMode === "terminal"}
              closeable={paneIds.length > 1}
              onActivate={() => setActivePane(paneId)}
              onClose={() => closePane(paneId)}
            />
          </div>

          {#if paneIds.length > 1 && index === 0}
            <button
              class="terminal-split-handle"
              data-layout={splitLayout}
              aria-label="Resize split panes"
              style:grid-column={splitLayout === "columns" ? "2" : "1"}
              style:grid-row={splitLayout === "rows" ? "2" : "1"}
              onpointerdown={beginSplitResize}
            ></button>
          {/if}
        {/each}
      </div>
    </div>

    <div class:hidden={panelMode !== "browser"} class="flex flex-1 flex-col overflow-hidden">
      {#if browserState === "starting"}
        <div class="flex flex-1 items-center justify-center">
          <p class="text-sm text-foreground/40">Starting remote desktop...</p>
        </div>
      {:else if browserState === "open" && browserUrl}
        <div class="min-h-0 flex-1 p-1">
          <iframe
            title={`Browser desktop for ${sandbox.metadata?.repoName ?? sandbox.sandboxID}`}
            class="h-full w-full rounded-[calc(var(--radius)-0.2rem)] border border-border/60 bg-background outline-none"
            bind:this={browserFrame}
            tabindex="-1"
            src={browserUrl}
            onload={() => {
              browserState = "open";
              browserError = "";
              browserFrame?.focus();
            }}
          ></iframe>
        </div>
      {:else}
        <div class="flex flex-1 items-center justify-center p-6">
          <div class="w-full max-w-lg rounded-[calc(var(--radius)+0.25rem)] border border-border/60 bg-field/30 p-6 text-center">
            <p class="text-sm text-foreground/70">
              Open Browser to start the full sandbox desktop. Chrome will launch inside it.
            </p>
            <Button size="sm" class="mt-4" onclick={showBrowser} disabled={actionPending}>
              <Globe class="size-3.5" />
              Open Browser
            </Button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
