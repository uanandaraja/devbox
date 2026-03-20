<script lang="ts">
  import { onMount, tick } from "svelte";
  import type {
    FitAddon as GhosttyFitAddon,
    Terminal as GhosttyTerminal,
  } from "ghostty-web";
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

  let terminalElement = $state<HTMLDivElement | null>(null);
  let terminalState = $state<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  let terminalError = $state("");

  let xterm: GhosttyTerminal | null = null;
  let fitAddon: GhosttyFitAddon | null = null;
  let socket: WebSocket | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let ghosttyReady = false;
  let focusRun = 0;
  let activeTouchId: number | null = null;
  let lastTouchY = 0;
  let touchLineRemainder = 0;

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

  function cleanupSocket() {
    cleanupResizeObserver();
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

  function sendInput(data: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", data }));
  }

  function fitTerminal() {
    if (!visible || !xterm) return;
    fitAddon?.fit();
    sendResize();
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
    if (!active || !visible || !xterm) return;

    const currentRun = ++focusRun;
    await tick();

    if (currentRun !== focusRun || !active || !visible || !xterm) return;

    requestAnimationFrame(() => {
      if (currentRun !== focusRun || !active || !visible || !xterm) return;

      fitTerminal();
      terminalElement?.focus();
      xterm.textarea?.focus();
      xterm.focus();

      requestAnimationFrame(() => {
        if (currentRun !== focusRun || !active || !visible || !xterm) return;

        xterm.textarea?.focus();
        xterm.focus();
        sendResize();
      });
    });
  }

  function writeToTerminal(data: string | Uint8Array) {
    if (!xterm) return;

    const previousViewportY = xterm.getViewportY();
    const previousScrollbackLength = xterm.getScrollbackLength();

    xterm.write(data, () => {
      if (!xterm || previousViewportY <= 0 || xterm.getViewportY() !== 0) return;

      const scrollbackDelta = Math.max(
        0,
        xterm.getScrollbackLength() - previousScrollbackLength,
      );
      const targetViewportY = Math.min(
        xterm.getScrollbackLength(),
        previousViewportY + scrollbackDelta,
      );

      xterm.scrollToLine(targetViewportY);
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
      terminalState = "open";
      observeTerminal();
      if (visible) {
        void syncActiveTerminal();
      } else {
        sendResize();
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        writeToTerminal(event.data);
      } else {
        writeToTerminal(new Uint8Array(event.data));
      }
    };

    socket.onerror = () => {
      terminalState = "error";
      terminalError = "Terminal connection failed";
    };

    socket.onclose = () => {
      cleanupResizeObserver();
      if (terminalState !== "error") terminalState = "closed";
    };
  }

  function activatePane() {
    onActivate?.();
  }

  function getTrackedTouch(touches: TouchList) {
    if (activeTouchId === null) return null;

    for (const touch of touches) {
      if (touch.identifier === activeTouchId) {
        return touch;
      }
    }

    return null;
  }

  function scrollFromTouch(lineDelta: number) {
    if (!xterm || lineDelta === 0) return;

    if (xterm.wasmTerm?.isAlternateScreen()) {
      const sequence = lineDelta < 0 ? "\u001b[A" : "\u001b[B";
      for (let index = 0; index < Math.abs(lineDelta); index += 1) {
        sendInput(sequence);
      }
      return;
    }

    xterm.scrollLines(lineDelta);
  }

  function handleTouchStart(event: TouchEvent) {
    if (!active || !visible || !xterm || event.touches.length !== 1) {
      activeTouchId = null;
      return;
    }

    const touch = event.touches[0];
    activeTouchId = touch.identifier;
    lastTouchY = touch.clientY;
    touchLineRemainder = 0;
    activatePane();
  }

  function handleTouchMove(event: TouchEvent) {
    if (!xterm) return;

    const touch = getTrackedTouch(event.touches);
    if (!touch) return;

    const lineHeight = xterm.renderer?.getMetrics().height ?? 20;
    const touchDeltaY = touch.clientY - lastTouchY;
    lastTouchY = touch.clientY;

    const nextLineDelta = touchLineRemainder + touchDeltaY / lineHeight;
    const wholeLineDelta =
      nextLineDelta > 0 ? Math.floor(nextLineDelta) : Math.ceil(nextLineDelta);

    if (wholeLineDelta === 0) return;

    touchLineRemainder = nextLineDelta - wholeLineDelta;
    event.preventDefault();

    // A downward finger drag should reveal older terminal output.
    scrollFromTouch(-wholeLineDelta);
  }

  function resetTouchTracking() {
    activeTouchId = null;
    touchLineRemainder = 0;
  }

  function handleTouchEnd(event: TouchEvent) {
    if (activeTouchId === null) return;

    if (!getTrackedTouch(event.touches)) {
      resetTouchTracking();
    }
  }

  function handleTouchCancel() {
    resetTouchTracking();
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
        scrollback: 10000,
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
      fitTerminal();

      terminalElement.addEventListener("touchstart", handleTouchStart, { passive: true });
      terminalElement.addEventListener("touchmove", handleTouchMove, { passive: false });
      terminalElement.addEventListener("touchend", handleTouchEnd, { passive: true });
      terminalElement.addEventListener("touchcancel", handleTouchCancel, { passive: true });

      xterm.onData((input) => {
        sendInput(input);
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
      terminalElement?.removeEventListener("touchstart", handleTouchStart);
      terminalElement?.removeEventListener("touchmove", handleTouchMove);
      terminalElement?.removeEventListener("touchend", handleTouchEnd);
      terminalElement?.removeEventListener("touchcancel", handleTouchCancel);
      resetTouchTracking();
      cleanupSocket();
      xterm?.dispose();
      xterm = null;
      fitAddon = null;
      ghosttyReady = false;
    };
  });

  $effect(() => {
    if (!visible) {
      cleanupResizeObserver();
      return;
    }

    if (ghosttyReady && xterm) {
      observeTerminal();
      fitTerminal();
    }
  });

  $effect(() => {
    if (ghosttyReady && sandbox.state === "running" && terminalState === "idle" && xterm) {
      void openTerminal();
    }
  });

  $effect(() => {
    if (ghosttyReady && active && visible && xterm) {
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
    ></div>
  </div>
</div>
