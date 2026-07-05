import type { ResolvedSpawnCommand } from "@t3tools/shared/shell";

export const ARK_CODEX_REMOTE_MACHINE_ENV = "ARK_CODEX_REMOTE_MACHINE";
export const ARK_CODEX_REMOTE_PROBE_CWD_ENV = "ARK_CODEX_REMOTE_PROBE_CWD";

const ARK_CODEX_ENV_KEYS = new Set([ARK_CODEX_REMOTE_MACHINE_ENV, ARK_CODEX_REMOTE_PROBE_CWD_ENV]);
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellPath(path: string): string {
  return path === "~" ? "$HOME" : shellQuote(path);
}

function shellEnv(input: NodeJS.ProcessEnv): string {
  const assignments = Object.entries(input)
    .filter(
      ([name, value]) =>
        value !== undefined && !ARK_CODEX_ENV_KEYS.has(name) && ENV_NAME_RE.test(name),
    )
    .map(([name, value]) => `${name}=${shellQuote(value ?? "")}`);
  return assignments.length === 0 ? "" : `env ${assignments.join(" ")} `;
}

export function buildArkRemoteCodexSpawn(input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}): {
  readonly spawnCommand: ResolvedSpawnCommand;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly extendEnv: boolean;
} | null {
  const machine = input.env[ARK_CODEX_REMOTE_MACHINE_ENV]?.trim();
  if (!machine) return null;

  const remoteCwd = input.cwd.trim().length === 0 ? "~" : input.cwd.trim();
  const remoteCommand = [
    `cd ${shellPath(remoteCwd)}`,
    `exec ${shellEnv(input.env)}${shellQuote(input.binaryPath)} ${input.args.map(shellQuote).join(" ")}`,
  ].join(" && ");

  return {
    spawnCommand: {
      command: "tailscale",
      args: ["ssh", machine, "bash", "-lc", remoteCommand],
      shell: false,
    },
    cwd: process.cwd(),
    env: { ...process.env, ...input.env },
    extendEnv: true,
  };
}
