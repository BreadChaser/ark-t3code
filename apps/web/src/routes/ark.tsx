import { createFileRoute } from "@tanstack/react-router";
import type { ArkMachine, ArkTmuxSession } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { RefreshCwIcon, SendIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { arkEnvironment } from "../state/ark";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

export const Route = createFileRoute("/ark")({
  component: ArkRouteView,
});

function causeMessage(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause);
}

function ArkRouteView() {
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
  const [status, setStatus] = useState("Idle");

  const requireEnvironment = (): NonNullable<typeof environmentId> | null => {
    if (environmentId === null) {
      setStatus("No primary environment connected.");
      return null;
    }
    return environmentId;
  };

  const refreshMachines = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Refresh machines...");
    const result = await listMachines({ environmentId: targetEnvironmentId, input: {} });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setMachines(result.value.machines);
    setStatus("Refresh machines done");
  };

  const refreshSessions = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Refresh tmux...");
    const result = await listTmuxSessions({ environmentId: targetEnvironmentId, input: {} });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setSessions(result.value.sessions);
    setStatus("Refresh tmux done");
  };

  const ensureSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Ensure tmux...");
    const result = await ensureTmux({
      environmentId: targetEnvironmentId,
      input: { name: sessionName },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setStatus("Ensure tmux done");
    await refreshSessions();
  };

  const captureSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Capture tmux...");
    const result = await captureTmux({
      environmentId: targetEnvironmentId,
      input: { name: sessionName, scroll: 300 },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setCapture(result.value.text);
    setStatus("Capture tmux done");
  };

  const sendTextToSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Send text...");
    const result = await sendTmuxText({
      environmentId: targetEnvironmentId,
      input: { name: sessionName, text: sendText, submit: true },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setStatus("Send text done");
    await captureSession();
  };

  const sendKeyToSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Send key...");
    const result = await sendTmuxKey({
      environmentId: targetEnvironmentId,
      input: { name: sessionName, key: keyName },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setStatus("Send key done");
    await captureSession();
  };

  const stopSession = async () => {
    const targetEnvironmentId = requireEnvironment();
    if (targetEnvironmentId === null) return;
    setStatus("Stop tmux...");
    const result = await stopTmux({
      environmentId: targetEnvironmentId,
      input: { name: sessionName },
    });
    if (AsyncResult.isFailure(result)) {
      setStatus(causeMessage(result.cause));
      return;
    }
    setStatus("Stop tmux done");
    await refreshSessions();
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-auto bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-semibold">Ark Control</h1>
            <p className="text-sm text-muted-foreground">{status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void refreshMachines()} size="sm" variant="secondary">
              <RefreshCwIcon className="size-4" />
              Machines
            </Button>
            <Button onClick={() => void refreshSessions()} size="sm" variant="secondary">
              <RefreshCwIcon className="size-4" />
              Tmux
            </Button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-medium">Tailscale Machines</h2>
            <div className="space-y-2">
              {machines.map((machine) => (
                <div key={machine.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {machine.hostname}
                    {machine.isSelf ? " (this)" : ""}
                  </span>
                  <span className={machine.online ? "text-emerald-500" : "text-muted-foreground"}>
                    {machine.tailscaleIp}
                  </span>
                </div>
              ))}
              {machines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No machines loaded.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-medium">Tmux Sessions</h2>
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.name}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => setSessionName(session.name)}
                  type="button"
                >
                  <span>{session.name}</span>
                  <span className="text-muted-foreground">{session.windows ?? "?"} windows</span>
                </button>
              ))}
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tmux sessions loaded.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
            <Input value={sessionName} onChange={(event) => setSessionName(event.target.value)} />
            <Button onClick={() => void ensureSession()} variant="secondary">
              <TerminalIcon className="size-4" />
              Ensure
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

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_10rem_auto]">
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

          <pre className="mt-4 min-h-72 overflow-auto rounded-lg bg-black p-4 text-xs text-green-200">
            {capture || "No capture yet."}
          </pre>
        </section>
      </main>
    </SidebarInset>
  );
}
