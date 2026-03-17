import { homedir } from "node:os";
import { join } from "node:path";

export const sshUser = process.env.E2B_SSH_USER ?? "user";
export const sshProxyPort = Number(process.env.E2B_SSH_PROXY_PORT ?? 2222);

function expandHome(path: string) {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

export function getPublicKeyPath() {
  const configured = process.env.E2B_SSH_PUBLIC_KEY_PATH;

  if (configured) {
    return expandHome(configured);
  }

  const candidates = [
    join(homedir(), ".ssh", "id_ed25519.pub"),
    join(homedir(), ".ssh", "id_rsa.pub"),
  ];

  for (const path of candidates) {
    if (Bun.file(path).size > 0) {
      return path;
    }
  }

  return null;
}

export async function readAuthorizedKey() {
  const path = getPublicKeyPath();

  if (!path) {
    throw new Error(
      "no SSH public key found; set E2B_SSH_PUBLIC_KEY_PATH to a .pub file",
    );
  }

  return (await Bun.file(path).text()).trim();
}

export function getPrivateKeyPath() {
  const publicKeyPath = getPublicKeyPath();

  if (!publicKeyPath) {
    return null;
  }

  return publicKeyPath.endsWith(".pub")
    ? publicKeyPath.slice(0, -4)
    : publicKeyPath;
}
