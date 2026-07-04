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

  it.effect("rejects unsupported tmux keys before shelling out", () =>
    Effect.gen(function* () {
      const ark = yield* ArkService.make();
      const error = yield* ark.sendTmuxKey("ark-main", "tmux kill-server").pipe(Effect.flip);
      assert.instanceOf(error, ArkOperationError);
      assert.equal(error.operation, "ark.sendTmuxKey");
    }).pipe(Effect.provide(testLayer(() => Effect.die("unexpected process call")))),
  );
});
