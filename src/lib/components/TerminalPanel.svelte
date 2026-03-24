<script lang="ts">
  import { tick } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type {
    BrowserSession,
    ListedSandbox,
    PreviewCandidate,
  } from "$lib/werkbench/types";
  import { resumeSandboxCommand } from "$lib/remote/werkbench.remote";
  import { Button } from "$lib/components/ui/button/index.js";
  import TerminalPane from "$lib/components/TerminalPane.svelte";
  import {
    ArrowClockwise,
    ArrowCounterClockwise,
    ArrowSquareOut,
    Code,
    Globe,
    Play,
    SquareSplitHorizontal,
    SquareSplitVertical,
    Terminal,
    WarningCircle,
  } from "phosphor-svelte";

  let {
    sandbox,
    active = true,
  }: {
    sandbox: ListedSandbox;
    active?: boolean;
  } = $props();

  let panelMode = $state<"terminal" | "browser">("terminal");
  let browserState = $state<BrowserSession["status"]>("idle");
  let browserError = $state("");
  let browserMessage = $state("");
  let browserUrl = $state("");
  let browserDevtoolsUrl = $state("");
  let browserCandidates = $state<PreviewCandidate[]>([]);
  let browserPortInput = $state("");
  let browserSelectedPort = $state<number | null>(null);
  let browserViewportKey = $state(0);
  let browserDevtoolsKey = $state(0);
  let browserDevtoolsVisible = $state(false);
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

  const activeBrowserCandidates = $derived(
    browserCandidates.filter((candidate) => candidate.active),
  );

  function resetBrowserState() {
    browserState = "idle";
    browserError = "";
    browserMessage = "";
    browserUrl = "";
    browserDevtoolsUrl = "";
    browserCandidates = [];
    browserSelectedPort = null;
    browserDevtoolsVisible = false;
  }

  async function syncActiveBrowser() {
    if (!active || panelMode !== "browser") return;
    await tick();
    requestAnimationFrame(() => {
      browserFrame?.focus();
    });
  }

  async function loadBrowser(portOverride?: number) {
    if (sandbox.state !== "running") return;

    browserState = "starting";
    browserError = "";
    browserMessage = "";

    const sessionUrl = new URL(`/api/browser/${sandbox.sandboxID}/session`, window.location.origin);
    if (portOverride) {
      sessionUrl.searchParams.set("port", String(portOverride));
    }

    const response = await fetch(sessionUrl);
    const payload = (await response.json().catch(() => null)) as BrowserSession | null;

    browserCandidates = payload?.candidates ?? [];

    if (!response.ok || !payload) {
      browserState = "error";
      browserError = "Failed to open browser workspace";
      browserUrl = "";
      browserDevtoolsUrl = "";
      return;
    }

    if (payload.status === "empty") {
      browserState = "empty";
      browserMessage =
        payload.message ?? "No preview detected. Start your app on 0.0.0.0 and choose a port.";
      browserUrl = "";
      browserDevtoolsUrl = "";
      browserSelectedPort = null;
      return;
    }

    if (payload.status !== "open" || !payload.url || !payload.devtoolsUrl) {
      browserState = "error";
      browserError =
        payload.status === "error"
          ? payload.message ?? "Browser workspace failed to start"
          : "Failed to open browser workspace";
      browserUrl = "";
      browserDevtoolsUrl = "";
      return;
    }

    browserState = "open";
    browserError = "";
    browserMessage = "";
    browserUrl = payload.url;
    browserDevtoolsUrl = payload.devtoolsUrl;
    browserSelectedPort = payload.selectedPort ?? null;
    if (payload.selectedPort) {
      browserPortInput = String(payload.selectedPort);
    }
    browserViewportKey += 1;
    browserDevtoolsKey += 1;
  }

  async function reconnectBrowser() {
    const requestedPort = Number.parseInt(browserPortInput, 10);
    await loadBrowser(Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : browserSelectedPort ?? undefined);
    await syncActiveBrowser();
  }

  function reloadBrowserViewport() {
    if (!browserUrl) return;
    browserViewportKey += 1;
  }

  function openBrowserInNewTab() {
    if (!browserUrl) return;
    window.open(browserUrl, "_blank", "noopener,noreferrer");
  }

  async function openSelectedPort() {
    const requestedPort = Number.parseInt(browserPortInput, 10);
    if (!Number.isInteger(requestedPort) || requestedPort <= 0) return;

    await loadBrowser(requestedPort);
    await syncActiveBrowser();
  }

  async function useCandidatePort(port: number) {
    browserPortInput = String(port);
    await loadBrowser(port);
    await syncActiveBrowser();
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

  function toggleBrowserDevtools() {
    browserDevtoolsVisible = !browserDevtoolsVisible;
    if (browserDevtoolsVisible) {
      browserDevtoolsKey += 1;
    }
  }

  async function handleResume() {
    actionPending = true;
    actionError = "";
    try {
      await resumeSandboxCommand({ sandboxId: sandbox.sandboxID });
      await invalidateAll();
      await tick();
      if (panelMode === "browser") {
        await loadBrowser(browserSelectedPort ?? undefined);
        await syncActiveBrowser();
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : "Failed to resume";
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
          <span class="text-sm text-foreground/30">starting browser...</span>
        {:else if browserState === "open"}
          <span class="text-sm text-foreground/30">browser ready</span>
        {:else if browserState === "empty"}
          <span class="text-sm text-foreground/30">waiting for app</span>
        {:else if browserState === "error"}
          <span class="text-sm text-destructive/70">browser error</span>
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
          title="Reconnect browser"
        >
          <ArrowCounterClockwise class="size-3.5" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onclick={openBrowserInNewTab}
          disabled={!browserUrl || actionPending}
          title="Open page in new tab"
        >
          <ArrowSquareOut class="size-3.5" />
        </Button>
        <Button
          size="xs"
          variant={browserDevtoolsVisible ? "secondary" : "ghost"}
          onclick={toggleBrowserDevtools}
          disabled={!browserDevtoolsUrl || actionPending}
          title={browserDevtoolsVisible ? "Hide DevTools" : "Show DevTools"}
        >
          <Code class="size-3.5" />
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
      <div class="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <Button
          size="xs"
          variant="ghost"
          onclick={reloadBrowserViewport}
          disabled={!browserUrl || actionPending}
          title="Reload preview"
        >
          <ArrowClockwise class="size-3.5" />
        </Button>

        <div class="flex items-center gap-1">
          {#each activeBrowserCandidates as candidate (candidate.port)}
            <button
              type="button"
              class="rounded border px-2 py-1 font-mono text-[11px] transition-colors {browserSelectedPort === candidate.port
                ? 'border-border bg-field text-foreground'
                : 'border-border/50 text-foreground/45 hover:bg-field hover:text-foreground/70'}"
              onclick={() => useCandidatePort(candidate.port)}
            >
              :{candidate.port}
            </button>
          {/each}
        </div>

        <form
          class="flex items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            void openSelectedPort();
          }}
        >
          <label class="text-[11px] text-foreground/40" for={`browser-port-${sandbox.sandboxID}`}>
            Port
          </label>
          <input
            id={`browser-port-${sandbox.sandboxID}`}
            class="h-7 w-24 rounded border border-border/60 bg-field/40 px-2 font-mono text-[11px] text-foreground outline-none transition focus:border-border focus:bg-field"
            bind:value={browserPortInput}
            inputmode="numeric"
            placeholder="5173"
          />
          <Button size="xs" type="submit" disabled={actionPending}>
            Open
          </Button>
        </form>

        <div class="min-w-0 flex-1 truncate rounded border border-border/50 bg-field/20 px-2 py-1 font-mono text-[11px] text-foreground/45">
          {browserUrl || "No preview selected"}
        </div>
      </div>

      {#if browserState === "starting"}
        <div class="flex flex-1 items-center justify-center">
          <p class="text-sm text-foreground/40">Starting browser workspace...</p>
        </div>
      {:else if browserState === "open" && browserUrl}
        <div
          class="grid min-h-0 flex-1 gap-1 p-1"
          class:grid-cols-[minmax(0,1fr)]={!browserDevtoolsVisible || !browserDevtoolsUrl}
          class:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]={browserDevtoolsVisible && !!browserDevtoolsUrl}
        >
          <div class="min-h-0 overflow-hidden rounded-[calc(var(--radius)-0.2rem)] border border-border/60 bg-background">
            {#key `${browserUrl}:${browserViewportKey}`}
              <iframe
                title={`Browser preview for ${sandbox.metadata?.repoName ?? sandbox.sandboxID}`}
                class="h-full w-full bg-background outline-none"
                bind:this={browserFrame}
                tabindex="-1"
                src={browserUrl}
                onload={() => {
                  browserState = "open";
                  browserError = "";
                  browserFrame?.focus();
                }}
              ></iframe>
            {/key}
          </div>

          {#if browserDevtoolsVisible && browserDevtoolsUrl}
            <div class="min-h-0 overflow-hidden rounded-[calc(var(--radius)-0.2rem)] border border-border/60 bg-background">
              {#key `${browserDevtoolsUrl}:${browserDevtoolsKey}`}
                <iframe
                  title={`Chrome DevTools for ${sandbox.metadata?.repoName ?? sandbox.sandboxID}`}
                  class="h-full w-full bg-background outline-none"
                  src={browserDevtoolsUrl}
                ></iframe>
              {/key}
            </div>
          {/if}
        </div>
      {:else}
        <div class="flex flex-1 items-center justify-center p-6">
          <div class="w-full max-w-xl rounded-[calc(var(--radius)+0.25rem)] border border-border/60 bg-field/30 p-6">
            <p class="text-sm text-foreground/70">
              {browserMessage || "No preview detected yet. Start your app on 0.0.0.0, or open a port manually."}
            </p>

            {#if browserCandidates.length > 0}
              <div class="mt-4 flex flex-wrap gap-2">
                {#each browserCandidates as candidate (candidate.port)}
                  <button
                    type="button"
                    class="rounded border px-2 py-1 font-mono text-[11px] transition-colors {candidate.active
                      ? 'border-border bg-field text-foreground'
                      : 'border-border/40 text-foreground/30 hover:text-foreground/55'}"
                    onclick={() => {
                      browserPortInput = String(candidate.port);
                      void openSelectedPort();
                    }}
                  >
                    :{candidate.port}
                  </button>
                {/each}
              </div>
            {/if}

            <form
              class="mt-4 flex items-center gap-2"
              onsubmit={(event) => {
                event.preventDefault();
                void openSelectedPort();
              }}
            >
              <input
                class="h-8 w-28 rounded border border-border/60 bg-field/40 px-2 font-mono text-[12px] text-foreground outline-none transition focus:border-border focus:bg-field"
                bind:value={browserPortInput}
                inputmode="numeric"
                placeholder="Enter port"
              />
              <Button size="sm" type="submit" disabled={actionPending}>
                <Globe class="size-3.5" />
                Open Browser
              </Button>
            </form>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
