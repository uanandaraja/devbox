<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type { FitAddon as GhosttyFitAddon, Terminal as GhosttyTerminal } from "ghostty-web";
  import type { ListedSandbox } from "$lib/devbox/types";
  import { killSandboxCommand, pauseSandboxCommand, resumeSandboxCommand } from "$lib/remote/devbox.remote";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Pause, Play, ArrowCounterClockwise, Trash, WarningCircle } from "phosphor-svelte";

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
  let actionPending = $state(false);
  let actionError = $state("");

  let xterm: GhosttyTerminal | null = null;
  let fitAddon: GhosttyFitAddon | null = null;
  let socket: WebSocket | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let ghosttyReady = false;

  function cssVar(name: string, fallback: string) {
    if (typeof document === "undefined") return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
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

  function sendResize() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !xterm) return;
    socket.send(JSON.stringify({ type: "resize", cols: xterm.cols, rows: xterm.rows }));
  }

  function focusTerminal() {
    if (!xterm) return;

    terminalElement?.focus();
    xterm.focus();

    requestAnimationFrame(() => {
      xterm?.focus();
    });
  }

  function syncActiveTerminal() {
    if (!active || !xterm) return;
    fitAddon?.fit();
    sendResize();
    focusTerminal();
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
      syncActiveTerminal();
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

  async function handleResume() {
    actionPending = true;
    actionError = "";
    try {
      await resumeSandboxCommand({ sandboxId: sandbox.sandboxID });
      await invalidateAll();
      await tick();
      await openTerminal();
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
    if (ghosttyReady && active && xterm) {
      syncActiveTerminal();
    }
  });
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Top bar -->
  <div class="flex h-10 flex-shrink-0 items-center justify-between border-b border-sidebar-divider px-4">
    <div class="flex items-center gap-3">
      <div
        class="size-1.5 rounded-full {sandbox.state === 'running' ? 'bg-status-running' : 'bg-status-paused'}"
      ></div>
      <span class="text-sm text-foreground/40 capitalize">{sandbox.state}</span>
      {#if terminalState === "connecting"}
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
      <Button
        size="xs"
        variant="ghost"
        onclick={() => openTerminal()}
        disabled={sandbox.state !== "running" || actionPending}
        title="Reconnect"
      >
        <ArrowCounterClockwise class="size-3.5" />
      </Button>
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

  <!-- Error banner -->
  {#if actionError}
    <div class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <WarningCircle class="size-3.5 flex-shrink-0" />
      {actionError}
    </div>
  {/if}

  <!-- Paused notice -->
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
    <!-- Terminal -->
    <div class="terminal-shell flex-1 overflow-hidden">
        <div class="h-full p-1">
        <div
          class="h-full rounded-[calc(var(--radius)-0.2rem)] outline-none"
          bind:this={terminalElement}
          tabindex="-1"
        ></div>
      </div>
    </div>
  {/if}
</div>
