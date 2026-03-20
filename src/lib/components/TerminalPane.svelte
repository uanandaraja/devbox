<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { ListedSandbox } from "$lib/werkbench/types";
  import { Button } from "$lib/components/ui/button/index.js";
  import { ArrowCounterClockwise, WarningCircle, X } from "phosphor-svelte";

  let {
    sandbox,
    active = false,
    visible = true,
    label,
    closeable = false,
    onActivate,
    onClose,
  }: {
    sandbox: ListedSandbox;
    active?: boolean;
    visible?: boolean;
    label: string;
    closeable?: boolean;
    onActivate?: () => void;
    onClose?: () => void;
  } = $props();

  type PtyCallbacks = {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onData?: (data: string) => void;
    onStatus?: (shell: string) => void;
    onError?: (message: string, errors?: string[]) => void;
    onExit?: (code: number) => void;
  };

  type PtyResizeMeta = {
    widthPx?: number;
    heightPx?: number;
    cellW?: number;
    cellH?: number;
  };

  type PtyConnectOptions = {
    url: string;
    cols?: number;
    rows?: number;
    callbacks: PtyCallbacks;
  };

  type PtyTransport = {
    connect: (options: PtyConnectOptions) => void | Promise<void>;
    disconnect: () => void;
    sendInput: (data: string) => boolean;
    resize: (cols: number, rows: number, meta?: PtyResizeMeta) => boolean;
    isConnected: () => boolean;
    destroy?: () => void | Promise<void>;
  };

  type ResttyInstance = {
    connectPty: (url?: string) => void;
    disconnectPty: () => void;
    isPtyConnected: () => boolean;
    focus: () => void;
    blur: () => void;
    updateSize: (force?: boolean) => void;
    destroy: () => void;
    applyTheme: (theme: unknown, sourceLabel?: string) => void;
    setFontSize: (value: number) => void;
  };

  let terminalElement = $state<HTMLDivElement | null>(null);
  let terminalState = $state<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  let terminalError = $state("");

  let restty: ResttyInstance | null = null;
  let ptyTransport: PtyTransport | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resttyReady = false;
  let focusRun = 0;

  function cssVar(name: string, fallback: string) {
    if (typeof document === "undefined") return fallback;
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    );
  }

  function cleanupResizeObserver() {
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  function cleanupTerminalConnection() {
    cleanupResizeObserver();
    ptyTransport?.disconnect();
  }

  function fitTerminal() {
    if (!visible || !restty) return;
    restty.updateSize(true);
  }

  function observeTerminal() {
    cleanupResizeObserver();

    if (!visible || !terminalElement) return;

    resizeObserver = new ResizeObserver(() => {
      fitTerminal();
    });

    resizeObserver.observe(terminalElement);
  }

  async function syncActiveTerminal() {
    if (!active || !visible || !restty) return;

    const currentRun = ++focusRun;
    await tick();

    if (currentRun !== focusRun || !active || !visible || !restty) return;

    requestAnimationFrame(() => {
      if (currentRun !== focusRun || !active || !visible || !restty) return;

      fitTerminal();
      terminalElement?.focus();
      restty.focus();

      requestAnimationFrame(() => {
        if (currentRun !== focusRun || !active || !visible || !restty) return;

        restty.focus();
        fitTerminal();
      });
    });
  }

  function activatePane() {
    onActivate?.();
  }

  function getTerminalUrl() {
    const sessionId = crypto.randomUUID();
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const url = new URL(`${protocol}://${location.host}/api/terminal/${sandbox.sandboxID}`);
    url.searchParams.set("session", sessionId);
    return url.toString();
  }

  function createPtyTransport(): PtyTransport {
    let socket: WebSocket | null = null;
    let callbacks: PtyCallbacks = {};
    const decoder = new TextDecoder();

    const closeSocket = () => {
      if (!socket) return;

      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
      socket = null;
    };

    const handleServerMessage = (payload: string) => {
      try {
        const parsed = JSON.parse(payload) as
          | { type?: "status"; shell?: string }
          | { type?: "error"; message?: string; errors?: string[] }
          | { type?: "exit"; code?: number };

        if (parsed.type === "status") {
          callbacks.onStatus?.(parsed.shell ?? "");
          return true;
        }

        if (parsed.type === "error") {
          const message = parsed.message ?? "Terminal connection failed";
          terminalState = "error";
          terminalError = message;
          callbacks.onError?.(message, parsed.errors);
          return true;
        }

        if (parsed.type === "exit") {
          terminalState = "closed";
          callbacks.onExit?.(parsed.code ?? 0);
          return true;
        }
      } catch {
        return false;
      }

      return false;
    };

    return {
      connect(options) {
        callbacks = options.callbacks;
        closeSocket();

        terminalState = "connecting";
        terminalError = "";

        socket = new WebSocket(options.url);
        socket.binaryType = "arraybuffer";

        socket.onopen = () => {
          terminalState = "open";
          callbacks.onConnect?.();

          if (options.cols && options.rows) {
            socket?.send(
              JSON.stringify({
                type: "resize",
                cols: options.cols,
                rows: options.rows,
              }),
            );
          }

          observeTerminal();
          if (visible) {
            void syncActiveTerminal();
          } else {
            fitTerminal();
          }
        };

        socket.onmessage = async (event) => {
          if (typeof event.data === "string") {
            if (!handleServerMessage(event.data)) {
              callbacks.onData?.(event.data);
            }
            return;
          }

          if (event.data instanceof ArrayBuffer) {
            callbacks.onData?.(decoder.decode(event.data, { stream: true }));
            return;
          }

          const text = await event.data.text();
          if (!handleServerMessage(text)) {
            callbacks.onData?.(text);
          }
        };

        socket.onerror = () => {
          terminalState = "error";
          terminalError = "Terminal connection failed";
          callbacks.onError?.("Terminal connection failed");
        };

        socket.onclose = () => {
          cleanupResizeObserver();
          if (terminalState !== "error") {
            terminalState = "closed";
          }
          callbacks.onDisconnect?.();
          socket = null;
        };
      },
      disconnect() {
        closeSocket();
      },
      sendInput(data) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify({ type: "input", data }));
        return true;
      },
      resize(cols, rows, meta) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(
          JSON.stringify({
            type: "resize",
            cols,
            rows,
            ...meta,
          }),
        );
        return true;
      },
      isConnected() {
        return socket?.readyState === WebSocket.OPEN;
      },
      destroy() {
        closeSocket();
      },
    };
  }

  async function openTerminal() {
    if (!restty || sandbox.state !== "running") return;

    cleanupTerminalConnection();
    terminalState = "connecting";
    terminalError = "";
    restty.connectPty(getTerminalUrl());
  }

  onMount(() => {
    if (!terminalElement) return;

    let disposed = false;

    void (async () => {
      const { Restty, parseGhosttyTheme } = await import("restty");

      if (disposed || !terminalElement) return;

      ptyTransport = createPtyTransport();
      restty = new Restty({
        root: terminalElement,
        createInitialPane: true,
        appOptions: {
          renderer: "auto",
          fontSize: 13,
          fontPreset: "none",
          fontHinting: false,
          maxScrollbackBytes: 10_000_000,
          touchSelectionMode: "long-press",
          ptyTransport,
        },
        onActivePaneChange: () => {
          activatePane();
        },
      }) as ResttyInstance;

      const theme = parseGhosttyTheme(`
foreground = ${cssVar("--terminal-foreground", "#edf4ff")}
background = ${cssVar("--terminal-background", "#0b0f14")}
cursor-color = ${cssVar("--terminal-cursor", "#9ca3af")}
selection-background = ${cssVar("--terminal-selection", "rgba(103, 200, 255, 0.22)")}
`);

      restty.applyTheme(theme, "werkbench");
      restty.setFontSize(13);
      resttyReady = true;
      fitTerminal();

      if (sandbox.state === "running") {
        await openTerminal();
      }
    })().catch((error) => {
      terminalState = "error";
      terminalError = error instanceof Error ? error.message : "Failed to initialize terminal";
    });

    return () => {
      disposed = true;
      cleanupTerminalConnection();
      ptyTransport?.destroy?.();
      ptyTransport = null;
      restty?.destroy();
      restty = null;
      resttyReady = false;
    };
  });

  $effect(() => {
    if (!visible) {
      cleanupResizeObserver();
      restty?.blur();
      return;
    }

    if (resttyReady && restty) {
      observeTerminal();
      fitTerminal();
    }
  });

  $effect(() => {
    if (resttyReady && sandbox.state === "running" && terminalState === "idle" && restty) {
      void openTerminal();
    }
  });

  $effect(() => {
    if (resttyReady && active && visible && restty) {
      void syncActiveTerminal();
    }
  });
</script>

<div
  class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[calc(var(--radius)-0.1rem)] border transition-colors {active
    ? 'border-border bg-field/20 shadow-[0_0_0_1px_color-mix(in_oklch,var(--border)_85%,transparent)]'
    : 'border-border/50 bg-field/10'}"
  onfocusin={activatePane}
>
  <div class="flex h-9 flex-shrink-0 items-center justify-between border-b border-sidebar-divider px-3">
    <div class="flex items-center gap-2">
      <div class="size-1.5 rounded-full {terminalState === 'open'
        ? 'bg-status-running'
        : terminalState === 'error'
          ? 'bg-destructive'
          : 'bg-foreground/20'}"></div>
      <button class="text-sm text-foreground/70" onclick={activatePane}>{label}</button>
      {#if terminalState === "connecting"}
        <span class="text-xs text-foreground/30">connecting...</span>
      {:else if terminalState === "open"}
        <span class="text-xs text-foreground/30">connected</span>
      {:else if terminalState === "closed"}
        <span class="text-xs text-foreground/30">disconnected</span>
      {:else if terminalState === "error"}
        <span class="text-xs text-destructive/70">error</span>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      <Button
        size="xs"
        variant="ghost"
        onclick={() => openTerminal()}
        disabled={sandbox.state !== "running"}
        title={`Reconnect ${label.toLowerCase()}`}
      >
        <ArrowCounterClockwise class="size-3.5" />
      </Button>
      {#if closeable}
        <Button
          size="xs"
          variant="ghost"
          onclick={onClose}
          title={`Close ${label.toLowerCase()}`}
        >
          <X class="size-3.5" />
        </Button>
      {/if}
    </div>
  </div>

  {#if terminalError}
    <div class="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <WarningCircle class="size-3.5 flex-shrink-0" />
      {terminalError}
    </div>
  {/if}

  <div class="terminal-shell min-h-0 flex-1 overflow-hidden p-1">
    <div
      class="terminal-host h-full rounded-[calc(var(--radius)-0.3rem)] outline-none"
      bind:this={terminalElement}
      tabindex="-1"
    ></div>
  </div>
</div>
