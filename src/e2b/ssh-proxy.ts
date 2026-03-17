import { Sandbox } from "e2b";
import { sshProxyPort } from "./ssh-settings";

const sandboxId = Bun.argv[2];
const timeoutMs = Number(process.env.E2B_SANDBOX_TIMEOUT_MS ?? 3600000);

if (!sandboxId) {
  console.error("usage: bun run src/e2b/ssh-proxy.ts <sandbox-id>");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWebSocket(url: string) {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const socket = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("timed out waiting for SSH proxy"));
        }, 2000);

        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          clearTimeout(timer);
          resolve(ws);
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("failed to connect to SSH proxy"));
        };
      });

      return socket;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("unknown WebSocket error");
      await sleep(1000);
    }
  }

  throw lastError ?? new Error("failed to connect to SSH proxy");
}

const sandbox = await Sandbox.connect(sandboxId);
await sandbox.setTimeout(timeoutMs);

const socket = await connectWebSocket(`wss://${sandbox.getHost(sshProxyPort)}`);

process.stdin.resume();
process.stdin.on("data", (chunk) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(chunk);
  }
});
process.stdin.on("end", () => socket.close());

socket.onmessage = async (event) => {
  if (typeof event.data === "string") {
    process.stdout.write(event.data);
    return;
  }

  if (event.data instanceof ArrayBuffer) {
    process.stdout.write(Buffer.from(event.data));
    return;
  }

  if (event.data instanceof Blob) {
    process.stdout.write(Buffer.from(await event.data.arrayBuffer()));
  }
};

socket.onerror = () => {
  process.exit(1);
};

socket.onclose = () => {
  process.exit(0);
};
