<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type {
    FitAddon as GhosttyFitAddon,
    Terminal as GhosttyTerminal,
  } from "ghostty-web";
  import type { DesktopSession, ListedSandbox } from "$lib/devbox/types";
  import {
    killSandboxCommand,
    pauseSandboxCommand,
    resumeSandboxCommand,
  } from "$lib/remote/devbox.remote";
  import { Button } from "$lib/components/ui/button/index.js";
  import {
    ArrowCounterClockwise,
    ArrowSquareOut,
    Globe,
    Pause,
    Play,
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

  let terminalElement = $state<HTMLDivElement | null>(null);
  let terminalState = $state<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  let terminalError = $state("");
  let panelMode = $state<"terminal" | "browser">("terminal");
  let browserState = $state<DesktopSession["status"]>("idle");
  let browserError = $state("");
  let browserUrl = $state("");
  let actionPending = $state(false);
  let actionError = $state("");

  let xterm: GhosttyTerminal | null = null;
  let fitAddon: GhosttyFitAddon | null = null;
  let browserFrame = $state<HTMLIFrameElement | null>(null);
  let socket: WebSocket | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let ghosttyReady = false;
  let focusRun = 0;

  function cssVar(name: string, fallback: string) {
    if (typeof document === "undefined") return fallback;
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    );
  }

  function cleanupSocket() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
      socket = null;
    }
  }

  function resetBrowserState() {
    browserState = "idle";
    browserError = "";
    browserUrl = "";
  }

  function sendResize() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !xterm) return;
    socket.send(JSON.stringify({ type: "resize", cols: xterm.cols, rows: xterm.rows }));
  }

  async function syncActiveTerminal() {
    if (!active || panelMode !== "terminal" || !xterm) return;

    const currentRun = ++focusRun;
    await tick();

    if (currentRun !== focusRun || !active || !xterm) return;

    requestAnimationFrame(() => {
      if (currentRun !== focusRun || !active || !xterm) return;

      fitAddon?.fit();
      sendResize();
      terminalElement?.focus();
      xterm.textarea?.focus();
      xterm.focus();

      requestAnimationFrame(() => {
        if (currentRun !== focusRun || !active || !xterm) return;

        xterm.textarea?.focus();
        xterm.focus();
        sendResize();
      });
    });
  }

  async function syncActiveBrowser() {
    if (!active || panelMode !== "browser") return;
    await tick();
    requestAnimationFrame(() => {
      browserFrame?.focus();
    });
  }

  async function openTerminal() {
    if (!xterm || sandbox.state !== "running") return;
    cleanupSocket();
    xterm.reset();
    xterm.clear();
    terminalState = "connecting";
    terminalError = "";

    const sessionId = crypto.randomUUID();
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const url = new URL(`${protocol}://${location.host}/api/terminal/${sandbox.sandboxID}`);
    url.searchParams.set("session", sessionId);

    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      if (!xterm) return;
      terminalState = "open";
      void syncActiveTerminal();
      resizeObserver = new ResizeObserver(() => {
        fitAddon?.fit();
        sendResize();
      });
      if (terminalElement) resizeObserver.observe(terminalElement);
    };

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        xterm?.write(event.data);
      } else {
        xterm?.write(new Uint8Array(event.data));
      }
    };

    socket.onerror = () => {
      terminalState = "error";
      terminalError = "Terminal connection failed";
    };

    socket.onclose = () => {
      if (terminalState !== "error") terminalState = "closed";
    };
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
    await syncActiveTerminal();
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
      } else {
        await openTerminal();
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
      cleanupSocket();
      await pauseSandboxCommand({ sandboxId: sandbox.sandboxID });
      await invalidateAll();
      terminalState = "idle";
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
      cleanupSocket();
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

  onMount(() => {
    if (!terminalElement) return;

    let disposed = false;

    void (async () => {
      const { Terminal, FitAddon, init } = await import("ghostty-web");

      await init();
      if (disposed || !terminalElement) return;

      ghosttyReady = true;
      xterm = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: cssVar("--font-mono", "ui-monospace, monospace"),
        fontSize: 13,
        theme: {
          background: cssVar("--terminal-background", "#0b0f14"),
          foreground: cssVar("--terminal-foreground", "#edf4ff"),
          cursor: cssVar("--terminal-cursor", "#9ca3af"),
          selectionBackground: cssVar("--terminal-selection", "rgba(103, 200, 255, 0.22)"),
        },
      });

      fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.open(terminalElement);
      fitAddon.fit();

      xterm.onData((input) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data: input }));
        }
      });

      if (sandbox.state === "running") {
        await openTerminal();
      }
    })().catch((error) => {
      terminalState = "error";
      terminalError = error instanceof Error ? error.message : "Failed to initialize terminal";
    });

    return () => {
      disposed = true;
      cleanupSocket();
      xterm?.dispose();
      xterm = null;
      fitAddon = null;
      ghosttyReady = false;
    };
  });

  $effect(() => {
    if (ghosttyReady && sandbox.state === "running" && terminalState === "idle" && xterm) {
      void openTerminal();
    }
  });

  $effect(() => {
    if (ghosttyReady && active && panelMode === "terminal" && xterm) {
      void syncActiveTerminal();
    }
  });

  $effect(() => {
    if (active && panelMode === "browser" && browserUrl) {
      void syncActiveBrowser();
    }
  });
</script>

<div class="flex h-full flex-col bg-background">
  <div class="flex h-10 flex-shrink-0 items-center justify-between border-b border-sidebar-divider px-4">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1 rounded-md border border-border/60 bg-field/40 p-0.5">
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
      <div
        class="size-1.5 rounded-full {sandbox.state === 'running' ? 'bg-status-running' : 'bg-status-paused'}"
      ></div>
      <span class="text-sm text-foreground/40 capitalize">{sandbox.state}</span>
      {#if panelMode === "browser"}
        {#if browserState === "starting"}
          <span class="text-sm text-foreground/30">starting desktop...</span>
        {:else if browserState === "open"}
          <span class="text-sm text-foreground/30">desktop connected</span>
        {:else if browserState === "error"}
          <span class="text-sm text-destructive/70">desktop error</span>
        {/if}
      {:else if terminalState === "connecting"}
        <span class="text-sm text-foreground/30">connecting...</span>
      {:else if terminalState === "open"}
        <span class="text-sm text-foreground/30">connected</span>
      {:else if terminalState === "closed"}
        <span class="text-sm text-foreground/30">disconnected</span>
      {:else if terminalState === "error"}
        <span class="text-sm text-destructive/70">error</span>
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
          onclick={() => openTerminal()}
          disabled={sandbox.state !== "running" || actionPending}
          title="Reconnect"
        >
          <ArrowCounterClockwise class="size-3.5" />
        </Button>
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
    <div class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <WarningCircle class="size-3.5 flex-shrink-0" />
      {browserError}
    </div>
  {/if}

  {#if terminalError && panelMode === "terminal"}
    <div class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <WarningCircle class="size-3.5 flex-shrink-0" />
      {terminalError}
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
    <div class:hidden={panelMode !== "terminal"} class="terminal-shell flex-1 overflow-hidden">
      <div class="h-full p-1">
        <div
          class="h-full rounded-[calc(var(--radius)-0.2rem)] outline-none"
          bind:this={terminalElement}
          tabindex="-1"
        ></div>
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
