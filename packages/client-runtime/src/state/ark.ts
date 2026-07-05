import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createArkEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    listMachines: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:list-machines",
      tag: WS_METHODS.arkListMachines,
    }),
    listTmuxSessions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:list-tmux-sessions",
      tag: WS_METHODS.arkListTmuxSessions,
    }),
    browseTmuxPath: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:ark:browse-tmux-path",
      tag: WS_METHODS.arkBrowseTmuxPath,
    }),
    ensureTmux: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:ensure-tmux",
      tag: WS_METHODS.arkEnsureTmux,
    }),
    captureTmux: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:capture-tmux",
      tag: WS_METHODS.arkCaptureTmux,
    }),
    sendTmuxText: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:send-tmux-text",
      tag: WS_METHODS.arkSendTmuxText,
    }),
    sendTmuxKey: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:send-tmux-key",
      tag: WS_METHODS.arkSendTmuxKey,
    }),
    saveTmuxImage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:save-tmux-image",
      tag: WS_METHODS.arkSaveTmuxImage,
    }),
    stopTmux: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ark:stop-tmux",
      tag: WS_METHODS.arkStopTmux,
    }),
  };
}
