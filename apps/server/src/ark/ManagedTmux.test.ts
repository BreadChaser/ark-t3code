import { assert, describe, it } from "@effect/vitest";

import {
  buildCapturePaneCommand,
  buildEnsureTmuxScript,
  buildSendKeyCommand,
  buildSendLineCommand,
  buildSendTextCommand,
  extractTaggedPaneOutput,
  isTmuxMissing,
  parseTmuxSessions,
  prepareShellCommand,
  shellSingle,
} from "./ManagedTmux.ts";

describe("ManagedTmux", () => {
  it("quotes shell values for tmux commands", () => {
    assert.equal(shellSingle("don't"), `'don'"'"'t'`);
    assert.equal(
      buildSendLineCommand("ark-main", "echo don't"),
      `tmux send-keys -t 'ark-main' 'echo don'"'"'t' Enter`,
    );
  });

  it("builds Ark tmux lifecycle commands", () => {
    assert.equal(
      buildEnsureTmuxScript("ark-main"),
      "tmux has-session -t 'ark-main' 2>/dev/null || tmux new-session -d -s 'ark-main' -c ~; tmux set-option -t 'ark-main' history-limit 10000",
    );
    assert.equal(
      buildCapturePaneCommand("ark-main", 500),
      "tmux capture-pane -pt 'ark-main' -S -500 -e",
    );
    assert.equal(
      buildSendTextCommand("ark-main", "hello", false),
      "tmux send-keys -t 'ark-main' -l 'hello'",
    );
    assert.equal(
      buildSendTextCommand("ark-main", "hello", true),
      "tmux send-keys -t 'ark-main' -l 'hello'; sleep 0.65; tmux send-keys -t 'ark-main' Enter",
    );
  });

  it("validates tmux key commands", () => {
    assert.equal(buildSendKeyCommand("ark-main", "C-c"), "tmux send-keys -t 'ark-main' 'C-c'");
    assert.equal(buildSendKeyCommand("ark-main", "tmux kill-server"), null);
  });

  it("parses tmux session inventory", () => {
    assert.deepEqual(parseTmuxSessions("ark-main\t1\t0\t1710000000\nwork\t3\t1\t1710000001"), [
      { name: "ark-main", windows: 1, attached: 0, created: 1710000000, ark: true },
      { name: "work", windows: 3, attached: 1, created: 1710000001, ark: false },
    ]);
  });

  it("keeps bare cd commands visible", () => {
    assert.equal(prepareShellCommand("cd"), "cd ~ && pwd");
    assert.equal(prepareShellCommand("cd src"), "cd src && pwd");
    assert.equal(prepareShellCommand("cd src && ls"), "cd src && ls");
  });

  it("recognizes missing tmux panes", () => {
    assert.equal(isTmuxMissing("can't find session: ark-main"), true);
    assert.equal(isTmuxMissing("normal output"), false);
  });

  it("extracts tagged command output from a captured pane", () => {
    const result = extractTaggedPaneOutput(
      ["tony@hp:~/repo$ ls", "README.md", "src", "", "@@abc123:0"].join("\n"),
      "abc123",
    );

    assert.deepEqual(result, {
      state: "done",
      exitCode: 0,
      output: "README.md\nsrc",
    });
  });

  it("returns running output before a marker exists", () => {
    const result = extractTaggedPaneOutput("tony@hp:~/repo$ npm test\nstill running", "missing");
    assert.deepEqual(result, {
      state: "running",
      exitCode: 0,
      output: "still running",
    });
  });
});
