import {
  ArkOperationError,
  type ArkMachine,
  type ArkTmuxSession,
  type FilesystemBrowseResult,
} from "@t3tools/contracts";
import { parseTailscalePeers } from "@t3tools/tailscale";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  buildCapturePaneCommand,
  buildEnsureTmuxScript,
  buildSendKeyCommand,
  buildSendTextCommand,
  isTmuxMissing,
  parseTmuxSessions,
  shellSingle,
  stripAnsi,
  tmuxTarget,
} from "./ManagedTmux.ts";
import * as ProcessRunner from "../processRunner.ts";

export class ArkService extends Context.Service<
  ArkService,
  {
    readonly listMachines: () => Effect.Effect<
      { readonly machines: readonly ArkMachine[] },
      ArkOperationError
    >;
    readonly listTmuxSessions: () => Effect.Effect<
      { readonly sessions: readonly ArkTmuxSession[] },
      ArkOperationError
    >;
    readonly browseTmuxPath: (
      partialPath: string,
      machineIp?: string,
    ) => Effect.Effect<FilesystemBrowseResult, ArkOperationError>;
    readonly ensureTmux: (
      name: string,
      machineIp?: string,
      cwd?: string,
      command?: string,
    ) => Effect.Effect<void, ArkOperationError>;
    readonly captureTmux: (
      name: string,
      scroll?: number,
      machineIp?: string,
    ) => Effect.Effect<{ readonly text: string }, ArkOperationError>;
    readonly sendTmuxText: (
      name: string,
      text: string,
      submit?: boolean,
      machineIp?: string,
    ) => Effect.Effect<void, ArkOperationError>;
    readonly sendTmuxKey: (
      name: string,
      key: string,
      machineIp?: string,
    ) => Effect.Effect<void, ArkOperationError>;
    readonly saveTmuxImage: (input: {
      readonly machineIp?: string | undefined;
      readonly name: string;
      readonly mimeType: string;
      readonly dataBase64: string;
    }) => Effect.Effect<{ readonly path: string }, ArkOperationError>;
    readonly stopTmux: (name: string, machineIp?: string) => Effect.Effect<void, ArkOperationError>;
  }
>()("t3/ark/ArkService") {}

function operationError(operation: string, message: string): ArkOperationError {
  return new ArkOperationError({ operation, message });
}

function commandText(result: ProcessRunner.ProcessRunOutput): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function runShell(
  processRunner: ProcessRunner.ProcessRunner["Service"],
  operation: string,
  command: string,
  stdin?: string,
): Effect.Effect<ProcessRunner.ProcessRunOutput, ArkOperationError> {
  return processRunner
    .run({
      command: "sh",
      args: ["-lc", command],
      stdin,
      timeout: "10 seconds",
      maxOutputBytes: 512_000,
      outputMode: "truncate",
      truncatedMarker: "\n...[truncated]\n",
    })
    .pipe(Effect.mapError((cause) => operationError(operation, cause.message)));
}

const TMUX_LIST_COMMAND =
  "tmux list-sessions -F '#S\t#{session_windows}\t#{session_attached}\t#{session_created}'";
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function parseBrowseOutput(output: string): FilesystemBrowseResult {
  let parentPath = "";
  const entries: Array<{ name: string; fullPath: string }> = [];
  for (const line of output.split(/\r?\n/u)) {
    const [kind, first, second] = line.split("\t");
    if (kind === "P" && first) parentPath = first;
    if (kind === "E" && first && second) entries.push({ name: first, fullPath: second });
  }
  return { parentPath: parentPath || "~", entries };
}

function buildBrowsePathCommand(partialPath: string): string {
  const raw = shellSingle(partialPath);
  return [
    `raw=${raw}`,
    `case "$raw" in \\~) target="$HOME" ;; \\~/*) target="$HOME/\${raw#\\~/}" ;; /*) target="$raw" ;; *) target="$PWD/$raw" ;; esac`,
    `case "$raw" in */|\\~) parent="$(realpath -m "$target")"; prefix="" ;; *) parent="$(realpath -m "$(dirname "$target")")"; prefix="$(basename "$target")" ;; esac`,
    `printf 'P\\t%s\\n' "$parent"`,
    `[ -d "$parent" ] || exit 0`,
    `find "$parent" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort -f | while IFS= read -r full; do name="\${full##*/}"; case "$name" in "$prefix"*) printf 'E\\t%s\\t%s\\n' "$name" "$full" ;; esac; done`,
  ].join("; ");
}

function decorateSessions(
  sessions: readonly ArkTmuxSession[],
  machine: Pick<ArkMachine, "id" | "hostname" | "tailscaleIp" | "online" | "isSelf">,
): readonly ArkTmuxSession[] {
  return sessions.map((session) => ({
    ...session,
    machineId: machine.id,
    machineName: machine.hostname,
    machineIp: machine.isSelf ? undefined : machine.tailscaleIp,
    machineOnline: machine.online,
    machineSelf: machine.isSelf,
  }));
}

function remoteCommand(machineIp: string | undefined, command: string): string {
  return machineIp
    ? `timeout 6 tailscale ssh ${shellSingle(machineIp)} ${shellSingle(command)}`
    : command;
}

function ensureExitOk(
  operation: string,
  result: ProcessRunner.ProcessRunOutput,
): Effect.Effect<void, ArkOperationError> {
  if (result.code === 0) return Effect.void;
  return Effect.fail(
    operationError(operation, commandText(result) || `Command exited with code ${result.code}.`),
  );
}

function safeUploadFileName(name: string, mimeType: string): string {
  const extension = IMAGE_EXTENSIONS[mimeType] ?? "img";
  const stem = name
    .replace(/\.[^.]+$/u, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `${stem || "paste"}.${extension}`;
}

export const make = Effect.fn("ArkService.make")(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const readTmuxSessions = (machineIp?: string) =>
    runShell(
      processRunner,
      "ark.listTmuxSessions",
      remoteCommand(machineIp, TMUX_LIST_COMMAND),
    ).pipe(
      Effect.flatMap((result) => {
        if (result.code === 0) {
          return Effect.succeed(parseTmuxSessions(result.stdout));
        }
        return isTmuxMissing(commandText(result))
          ? Effect.succeed([])
          : Effect.fail(operationError("ark.listTmuxSessions", commandText(result)));
      }),
    );

  const listMachines: ArkService["Service"]["listMachines"] = () =>
    runShell(processRunner, "ark.listMachines", "tailscale status --json").pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? parseTailscalePeers(result.stdout).pipe(
              Effect.mapError((cause) => operationError("ark.listMachines", cause.message)),
            )
          : Effect.fail(operationError("ark.listMachines", commandText(result))),
      ),
      Effect.map((machines) => ({ machines })),
    );

  const listTmuxSessions: ArkService["Service"]["listTmuxSessions"] = () =>
    Effect.gen(function* () {
      const localSessions = yield* readTmuxSessions();
      const { machines } = yield* listMachines().pipe(
        Effect.catch(() => Effect.succeed({ machines: [] as readonly ArkMachine[] })),
      );
      const self = machines.find((machine) => machine.isSelf);
      const localMachine =
        self ??
        ({
          id: "local",
          hostname: "This device",
          tailscaleIp: "",
          online: true,
          isSelf: true,
        } satisfies Pick<ArkMachine, "id" | "hostname" | "tailscaleIp" | "online" | "isSelf">);

      const remoteMachines = machines.filter(
        (machine) => machine.online && !machine.isSelf && machine.os === "linux",
      );
      const remoteSessions = yield* Effect.forEach(
        remoteMachines,
        (machine) =>
          readTmuxSessions(machine.tailscaleIp).pipe(
            Effect.map((sessions) => decorateSessions(sessions, machine)),
            Effect.catch(() => Effect.succeed([] as readonly ArkTmuxSession[])),
          ),
        { concurrency: 4 },
      );

      return {
        sessions: [...decorateSessions(localSessions, localMachine), ...remoteSessions.flat()],
      };
    });

  const browseTmuxPath: ArkService["Service"]["browseTmuxPath"] = (partialPath, machineIp) =>
    runShell(
      processRunner,
      "ark.browseTmuxPath",
      remoteCommand(machineIp, buildBrowsePathCommand(partialPath)),
    ).pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.succeed(parseBrowseOutput(result.stdout))
          : Effect.fail(operationError("ark.browseTmuxPath", commandText(result))),
      ),
    );

  const ensureTmux: ArkService["Service"]["ensureTmux"] = (name, machineIp, cwd, command) =>
    runShell(
      processRunner,
      "ark.ensureTmux",
      remoteCommand(machineIp, buildEnsureTmuxScript(name, cwd, command)),
    ).pipe(Effect.flatMap((result) => ensureExitOk("ark.ensureTmux", result)));

  const captureTmux: ArkService["Service"]["captureTmux"] = (name, scroll, machineIp) =>
    runShell(
      processRunner,
      "ark.captureTmux",
      remoteCommand(machineIp, buildCapturePaneCommand(name, scroll ?? 300)),
    ).pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.succeed({ text: stripAnsi(result.stdout).trimEnd() })
          : Effect.fail(operationError("ark.captureTmux", commandText(result))),
      ),
    );

  const sendTmuxText: ArkService["Service"]["sendTmuxText"] = (name, text, submit, machineIp) =>
    runShell(
      processRunner,
      "ark.sendTmuxText",
      remoteCommand(machineIp, buildSendTextCommand(name, text, submit ?? true)),
    ).pipe(Effect.flatMap((result) => ensureExitOk("ark.sendTmuxText", result)));

  const sendTmuxKey: ArkService["Service"]["sendTmuxKey"] = (name, key, machineIp) => {
    const command = buildSendKeyCommand(name, key);
    if (command === null) {
      return Effect.fail(operationError("ark.sendTmuxKey", `Unsupported tmux key: ${key}`));
    }
    return runShell(processRunner, "ark.sendTmuxKey", remoteCommand(machineIp, command)).pipe(
      Effect.flatMap((result) => ensureExitOk("ark.sendTmuxKey", result)),
    );
  };

  const saveTmuxImage: ArkService["Service"]["saveTmuxImage"] = (input) => {
    if (!input.mimeType.startsWith("image/")) {
      return Effect.fail(operationError("ark.saveTmuxImage", "Only image uploads are supported."));
    }
    const fileName = safeUploadFileName(input.name, input.mimeType);
    const extensionIndex = fileName.lastIndexOf(".");
    const fileStem = extensionIndex === -1 ? fileName : fileName.slice(0, extensionIndex);
    const fileExtension = extensionIndex === -1 ? "" : fileName.slice(extensionIndex);
    const command = [
      `dir="$HOME/.ark/uploads"`,
      `file=${shellSingle(fileName)}`,
      `stem=${shellSingle(fileStem)}`,
      `ext=${shellSingle(fileExtension)}`,
      `mkdir -p "$dir"`,
      `path="$dir/$file"`,
      `if [ -e "$path" ]; then path="$dir/$stem-$(date +%s%3N)$ext"; fi`,
      `base64 -d > "$path"`,
      `printf %s "$path"`,
    ].join(" && ");
    return runShell(
      processRunner,
      "ark.saveTmuxImage",
      remoteCommand(input.machineIp, command),
      input.dataBase64,
    ).pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.succeed({ path: result.stdout.trim() })
          : Effect.fail(operationError("ark.saveTmuxImage", commandText(result))),
      ),
    );
  };

  const stopTmux: ArkService["Service"]["stopTmux"] = (name, machineIp) =>
    runShell(
      processRunner,
      "ark.stopTmux",
      remoteCommand(machineIp, `tmux kill-session -t ${tmuxTarget(name)}`),
    ).pipe(
      Effect.flatMap((result) =>
        result.code === 0 || isTmuxMissing(commandText(result))
          ? Effect.void
          : Effect.fail(operationError("ark.stopTmux", commandText(result))),
      ),
    );

  return ArkService.of({
    listMachines,
    listTmuxSessions,
    browseTmuxPath,
    ensureTmux,
    captureTmux,
    sendTmuxText,
    sendTmuxKey,
    saveTmuxImage,
    stopTmux,
  });
});

export const layer = Layer.effect(ArkService, make());
