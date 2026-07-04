import { assert, describe, it } from "@effect/vitest";
import { ArkOperationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ArkService from "./ArkService.ts";
import * as ProcessRunner from "../processRunner.ts";

function testLayer(run: ProcessRunner.ProcessRunner["Service"]["run"]) {
  return Layer.succeed(ProcessRunner.ProcessRunner, { run });
}

describe("ArkService", () => {
  it.effect("returns an empty tmux list when no tmux server is running", () =>
    Effect.gen(function* () {
      const ark = yield* ArkService.make();
      const result = yield* ark.listTmuxSessions();
      assert.deepEqual(result, { sessions: [] });
    }).pipe(
      Effect.provide(
        testLayer(() =>
          Effect.succeed({
            stdout: "",
            stderr: "no server running on /tmp/tmux-1000/default",
            code: ChildProcessSpawner.ExitCode(1),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          }),
        ),
      ),
    ),
  );

  it.effect("lists tmux sessions from online linux tailnet machines", () =>
    Effect.gen(function* () {
      const ark = yield* ArkService.make();
      const result = yield* ark.listTmuxSessions();
      assert.deepEqual(
        result.sessions.map((session) => ({
          name: session.name,
          machineName: session.machineName,
          machineIp: session.machineIp,
        })),
        [
          { name: "local-main", machineName: "gaming", machineIp: undefined },
          { name: "remote-main", machineName: "hp", machineIp: "100.94.206.66" },
        ],
      );
    }).pipe(
      Effect.provide(
        testLayer((request) => {
          const command = request.args[1] ?? "";
          if (command.includes("tailscale status --json")) {
            return Effect.succeed({
              stdout: JSON.stringify({
                Self: {
                  HostName: "gaming",
                  DNSName: "gaming.tail.test.",
                  OS: "linux",
                  TailscaleIPs: ["100.114.148.108"],
                },
                Peer: {
                  hp: {
                    HostName: "hp",
                    DNSName: "hp.tail.test.",
                    Online: true,
                    OS: "linux",
                    TailscaleIPs: ["100.94.206.66"],
                  },
                },
              }),
              stderr: "",
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
            });
          }
          return Effect.succeed({
            stdout: command.includes("tailscale ssh")
              ? "remote-main\t1\t0\t1783120013"
              : "local-main\t1\t0\t1783120001",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        }),
      ),
    ),
  );

  it.effect("rejects unsupported tmux keys before shelling out", () =>
    Effect.gen(function* () {
      const ark = yield* ArkService.make();
      const error = yield* ark.sendTmuxKey("ark-main", "tmux kill-server").pipe(Effect.flip);
      assert.instanceOf(error, ArkOperationError);
      assert.equal(error.operation, "ark.sendTmuxKey");
    }).pipe(Effect.provide(testLayer(() => Effect.die("unexpected process call")))),
  );

  it.effect("saves pasted images on the target machine through stdin", () =>
    Effect.gen(function* () {
      const ark = yield* ArkService.make();
      const result = yield* ark.saveTmuxImage({
        machineIp: "100.94.206.66",
        name: "screen shot.png",
        mimeType: "image/png",
        dataBase64: "aGVsbG8=",
      });
      assert.equal(result.path, "/home/tony/.ark/uploads/screen-shot.png");
    }).pipe(
      Effect.provide(
        testLayer((request) => {
          const command = request.args[1] ?? "";
          assert.match(command, /tailscale ssh '100\.94\.206\.66'/u);
          assert.match(command, /base64 -d/u);
          assert.equal(request.stdin, "aGVsbG8=");
          return Effect.succeed({
            stdout: "/home/tony/.ark/uploads/screen-shot.png",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(0),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        }),
      ),
    ),
  );
});
