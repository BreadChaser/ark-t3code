import { ArkOperationError, type ArkMachine, type ArkTmuxSession } from "@t3tools/contracts";
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
    readonly ensureTmux: (name: string) => Effect.Effect<void, ArkOperationError>;
    readonly captureTmux: (
      name: string,
      scroll?: number,
    ) => Effect.Effect<{ readonly text: string }, ArkOperationError>;
    readonly sendTmuxText: (
      name: string,
      text: string,
      submit?: boolean,
    ) => Effect.Effect<void, ArkOperationError>;
    readonly sendTmuxKey: (name: string, key: string) => Effect.Effect<void, ArkOperationError>;
    readonly stopTmux: (name: string) => Effect.Effect<void, ArkOperationError>;
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
): Effect.Effect<ProcessRunner.ProcessRunOutput, ArkOperationError> {
  return processRunner
    .run({
      command: "sh",
      args: ["-lc", command],
      timeout: "10 seconds",
      maxOutputBytes: 512_000,
      outputMode: "truncate",
      truncatedMarker: "\n...[truncated]\n",
    })
    .pipe(Effect.mapError((cause) => operationError(operation, cause.message)));
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

export const make = Effect.fn("ArkService.make")(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;

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
    runShell(
      processRunner,
      "ark.listTmuxSessions",
      "tmux list-sessions -F '#S\t#{session_windows}\t#{session_attached}\t#{session_created}'",
    ).pipe(
      Effect.flatMap((result) => {
        if (result.code === 0) {
          return Effect.succeed({ sessions: parseTmuxSessions(result.stdout) });
        }
        return isTmuxMissing(commandText(result))
          ? Effect.succeed({ sessions: [] })
          : Effect.fail(operationError("ark.listTmuxSessions", commandText(result)));
      }),
    );

  const ensureTmux: ArkService["Service"]["ensureTmux"] = (name) =>
    runShell(processRunner, "ark.ensureTmux", buildEnsureTmuxScript(name)).pipe(
      Effect.flatMap((result) => ensureExitOk("ark.ensureTmux", result)),
    );

  const captureTmux: ArkService["Service"]["captureTmux"] = (name, scroll) =>
    runShell(processRunner, "ark.captureTmux", buildCapturePaneCommand(name, scroll ?? 300)).pipe(
      Effect.flatMap((result) =>
        result.code === 0
          ? Effect.succeed({ text: stripAnsi(result.stdout).trimEnd() })
          : Effect.fail(operationError("ark.captureTmux", commandText(result))),
      ),
    );

  const sendTmuxText: ArkService["Service"]["sendTmuxText"] = (name, text, submit) =>
    runShell(
      processRunner,
      "ark.sendTmuxText",
      buildSendTextCommand(name, text, submit ?? true),
    ).pipe(Effect.flatMap((result) => ensureExitOk("ark.sendTmuxText", result)));

  const sendTmuxKey: ArkService["Service"]["sendTmuxKey"] = (name, key) => {
    const command = buildSendKeyCommand(name, key);
    if (command === null) {
      return Effect.fail(operationError("ark.sendTmuxKey", `Unsupported tmux key: ${key}`));
    }
    return runShell(processRunner, "ark.sendTmuxKey", command).pipe(
      Effect.flatMap((result) => ensureExitOk("ark.sendTmuxKey", result)),
    );
  };

  const stopTmux: ArkService["Service"]["stopTmux"] = (name) =>
    runShell(processRunner, "ark.stopTmux", `tmux kill-session -t ${tmuxTarget(name)}`).pipe(
      Effect.flatMap((result) =>
        result.code === 0 || isTmuxMissing(commandText(result))
          ? Effect.void
          : Effect.fail(operationError("ark.stopTmux", commandText(result))),
      ),
    );

  return ArkService.of({
    listMachines,
    listTmuxSessions,
    ensureTmux,
    captureTmux,
    sendTmuxText,
    sendTmuxKey,
    stopTmux,
  });
});

export const layer = Layer.effect(ArkService, make());
