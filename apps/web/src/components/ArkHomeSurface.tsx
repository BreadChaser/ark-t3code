import type { ArkMachine, ArkTmuxSession } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  MonitorIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  TerminalIcon,
  WifiIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { arkEnvironment } from "../state/ark";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarInset } from "./ui/sidebar";

function causeMessage(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause);
}

export function ArkHomeSurface() {
  const environmentId = usePrimaryEnvironmentId();
  const listMachines = useAtomCommand(arkEnvironment.listMachines, { reportFailure: false });
  const listTmuxSessions = useAtomCommand(arkEnvironment.listTmuxSessions, {
    reportFailure: false,
  });
  const ensureTmux = useAtomCommand(arkEnvironment.ensureTmux, { reportFailure: false });
  const captureTmux = useAtomCommand(arkEnvironment.captureTmux, { reportFailure: false });
  const sendTmuxText = useAtomCommand(arkEnvironment.sendTmuxText, { reportFailure: false });
  const sendTmuxKey = useAtomCommand(arkEnvironment.sendTmuxKey, { reportFailure: false });
  const stopTmux = useAtomCommand(arkEnvironment.stopTmux, { reportFailure: false });

  const [machines, setMachines] = useState<readonly ArkMachine[]>([]);
  const [sessions, setSessions] = useState<readonly ArkTmuxSession[]>([]);
  const [sessionName, setSessionName] = useState("ark-main");
  const [sendText, setSendText] = useState("pwd");
  const [keyName, setKeyName] = useState("Enter");
  const [capture, setCapture] = useState("");
  const [status, setStatus] = useState("Loading Ark...");

  const requireEnvironment = (): NonNullable<typeof environmentId> | null => {
    if (environmentId === null) {
      setStatus("Pair this browser with the Ark backend first.");
      return null;
    }
    return environmentId;
  };

  const refreshMachines = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Refreshing machines...");
    const result = await listMachines({ environmentId: targetEnvironmentId, input: {} });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setMachines(result.value.machines);
    setStatus("Machines refreshed");
  };

  const refreshSessions = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Refreshing tmux sessions...");
    const result = await listTmuxSessions({ environmentId: targetEnvironmentId, input: {} });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setSessions(result.value.sessions);
    setStatus("Tmux sessions refreshed");
  };

  const captureSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus(`Capturing ${sessionName}...`);
    const result = await captureTmux({
      environmentId: targetEnvironmentId,
      input: { name: sessionName, scroll: 400 },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setCapture(result.value.text);
    setStatus(`${sessionName} captured`);
  };

  const refreshAll = async () => {
    await refreshMachines();
    await refreshSessions();
  };

  const ensureSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus(`Starting ${sessionName}...`);
    const result = await ensureTmux({
      environmentId: targetEnvironmentId,
      input: { name: sessionName },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    await refreshSessions();
    await captureSession();
  };

  const sendTextToSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus(`Sending to ${sessionName}...`);
    const result = await sendTmuxText({
      environmentId: targetEnvironmentId,
      input: { name: sessionName, text: sendText, submit: true },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    await captureSession();
  };

  const sendKeyToSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus(`Sending ${keyName} to ${sessionName}...`);
    const result = await sendTmuxKey({
      environmentId: targetEnvironmentId,
      input: { name: sessionName, key: keyName },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    await captureSession();
  };

  const stopSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus(`Stopping ${sessionName}...`);
    const result = await stopTmux({
      environmentId: targetEnvironmentId,
      input: { name: sessionName },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setCapture("");
    await refreshSessions();
  };

  useEffect(() => {
    if (environmentId === null) {
      setStatus("Pair this browser with the Ark backend first.");
      return;
    }
    void refreshAll();
  }, [environmentId]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
            isElectron ? "workspace-topbar drag-region" : "workspace-topbar",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">Ark</div>
              <div className="truncate text-xs text-muted-foreground">{status}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button onClick={() => void refreshAll()} size="sm" variant="secondary">
                <RefreshCwIcon className="size-4" />
                Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-r border-border bg-muted/15 p-3">
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <WifiIcon className="size-3.5" />
                Machines
              </div>
              <div className="space-y-1">
                {machines.map((machine) => (
                  <div
                    key={machine.id}
                    className="rounded-md border border-border/70 bg-background/70 px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {machine.hostname}
                        {machine.isSelf ? " (this)" : ""}
                      </span>
                      <span
                        className={machine.online ? "text-emerald-500" : "text-muted-foreground"}
                      >
                        {machine.online ? "online" : "offline"}
                      </span>
                    </div>
                    <div className="truncate font-mono text-muted-foreground">
                      {machine.tailscaleIp}
                    </div>
                  </div>
                ))}
                {machines.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No machines loaded.</p>
                ) : null}
              </div>
            </section>

            <section className="mt-5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <MonitorIcon className="size-3.5" />
                Tmux
              </div>
              <div className="space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.name}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                      session.name === sessionName ? "bg-accent text-accent-foreground" : "",
                    )}
                    onClick={() => setSessionName(session.name)}
                    type="button"
                  >
                    <span className="truncate font-medium">{session.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {session.windows ?? "?"} win
                    </span>
                  </button>
                ))}
                {sessions.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No tmux sessions.</p>
                ) : null}
              </div>
            </section>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="grid gap-2 border-b border-border p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <Input value={sessionName} onChange={(event) => setSessionName(event.target.value)} />
              <Button onClick={() => void ensureSession()} variant="secondary">
                <TerminalIcon className="size-4" />
                Start
              </Button>
              <Button onClick={() => void captureSession()} variant="secondary">
                <RefreshCwIcon className="size-4" />
                Capture
              </Button>
              <Button onClick={() => void stopSession()} variant="destructive">
                <SquareIcon className="size-4" />
                Stop
              </Button>
            </div>

            <div className="grid gap-2 border-b border-border p-3 md:grid-cols-[minmax(0,1fr)_auto_9rem_auto]">
              <Input value={sendText} onChange={(event) => setSendText(event.target.value)} />
              <Button onClick={() => void sendTextToSession()}>
                <SendIcon className="size-4" />
                Send
              </Button>
              <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} />
              <Button onClick={() => void sendKeyToSession()} variant="secondary">
                Key
              </Button>
            </div>

            <pre className="min-h-0 flex-1 overflow-auto bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
              {capture || "Start or select a tmux session, then capture it here."}
            </pre>
          </section>
        </main>
      </div>
    </SidebarInset>
  );
}
