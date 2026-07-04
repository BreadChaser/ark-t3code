import type { ArkTmuxSession, EnvironmentId } from "@t3tools/contracts";
import { PlusIcon, RefreshCwIcon, SendIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { arkEnvironment } from "../state/ark";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const DEFAULT_SESSION = "ark-main";
export const ARK_OPEN_SESSION_EVENT = "ark:open-session";

type ArkSessionTarget = Pick<ArkTmuxSession, "name" | "machineIp" | "machineName">;

function sessionKey(session: ArkSessionTarget): string {
  return `${session.machineIp ?? "local"}:${session.name}`;
}

function machineLabel(session: ArkSessionTarget): string {
  return session.machineName ?? (session.machineIp ? session.machineIp : "This device");
}

function sessionLabel(session: ArkTmuxSession): string {
  const windows = session.windows === null ? "?" : String(session.windows);
  const attached = session.attached === null ? "?" : String(session.attached);
  return `${machineLabel(session)} - ${windows} window${windows === "1" ? "" : "s"} - ${attached} attached`;
}

export function ArkHome() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = useMemo<EnvironmentId | null>(
    () => primaryEnvironmentId ?? environments[0]?.environmentId ?? null,
    [environments, primaryEnvironmentId],
  );

  const listTmuxSessions = useAtomCommand(arkEnvironment.listTmuxSessions, {
    reportFailure: false,
  });
  const ensureTmux = useAtomCommand(arkEnvironment.ensureTmux, { reportFailure: false });
  const captureTmux = useAtomCommand(arkEnvironment.captureTmux, { reportFailure: false });
  const sendTmuxText = useAtomCommand(arkEnvironment.sendTmuxText, { reportFailure: false });
  const stopTmux = useAtomCommand(arkEnvironment.stopTmux, { reportFailure: false });

  const [sessions, setSessions] = useState<ArkTmuxSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ArkSessionTarget | null>(null);
  const [terminalText, setTerminalText] = useState("");
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSelectedKey = useRef<string | null>(null);

  useEffect(() => {
    latestSelectedKey.current = selectedSession === null ? null : sessionKey(selectedSession);
  }, [selectedSession]);

  const refreshSessions = useCallback(
    async (showError = false) => {
      if (environmentId === null) return;

      const result = await listTmuxSessions({ environmentId, input: {} });
      if (result._tag === "Failure") {
        if (showError) setError("Could not load tmux sessions.");
        return;
      }

      const sorted = [...result.value.sessions].sort((a, b) => {
        if (a.machineSelf !== b.machineSelf) return a.machineSelf ? -1 : 1;
        const machineSort = machineLabel(a).localeCompare(machineLabel(b));
        if (machineSort !== 0) return machineSort;
        if (a.ark !== b.ark) return a.ark ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setSessions(sorted);
      setError(null);
      setSelectedSession((current) =>
        current === null
          ? (sorted[0] ?? null)
          : (sorted.find((session) => sessionKey(session) === sessionKey(current)) ?? current),
      );
    },
    [environmentId, listTmuxSessions],
  );

  const captureSelected = useCallback(
    async (target: ArkSessionTarget) => {
      if (environmentId === null) return;

      const result = await captureTmux({
        environmentId,
        input: { name: target.name, machineIp: target.machineIp, scroll: 900 },
      });
      if (result._tag === "Failure") {
        if (latestSelectedKey.current === sessionKey(target)) {
          setTerminalText("");
          setError(`Could not read ${target.name}.`);
        }
        return;
      }

      if (latestSelectedKey.current === sessionKey(target)) {
        setTerminalText(result.value.text.trimEnd());
        setError(null);
      }
    },
    [captureTmux, environmentId],
  );

  const openSession = useCallback(
    async (target: ArkSessionTarget | string) => {
      if (environmentId === null) return;
      const session = typeof target === "string" ? { name: target } : target;
      setIsBusy(true);
      const result = await ensureTmux({
        environmentId,
        input: { name: session.name, machineIp: session.machineIp },
      });
      setIsBusy(false);
      if (result._tag === "Failure") {
        setError(`Could not open ${session.name}.`);
        return;
      }

      setSelectedSession(session);
      await refreshSessions();
      await captureSelected(session);
    },
    [captureSelected, ensureTmux, environmentId, refreshSessions],
  );

  const sendDraft = useCallback(async () => {
    const text = draft;
    if (environmentId === null || selectedSession === null || text.trim().length === 0) return;

    setDraft("");
    const result = await sendTmuxText({
      environmentId,
      input: {
        name: selectedSession.name,
        machineIp: selectedSession.machineIp,
        text,
        submit: true,
      },
    });
    if (result._tag === "Failure") {
      setDraft(text);
      setError(`Could not send to ${selectedSession.name}.`);
      return;
    }

    await captureSelected(selectedSession);
  }, [captureSelected, draft, environmentId, selectedSession, sendTmuxText]);

  const stopSelected = useCallback(async () => {
    if (environmentId === null || selectedSession === null) return;

    const target = selectedSession;
    const result = await stopTmux({
      environmentId,
      input: { name: target.name, machineIp: target.machineIp },
    });
    if (result._tag === "Failure") {
      setError(`Could not stop ${target.name}.`);
      return;
    }

    setSelectedSession(null);
    setTerminalText("");
    await refreshSessions();
  }, [environmentId, refreshSessions, selectedSession, stopTmux]);

  useEffect(() => {
    void refreshSessions();
    const timers = [
      window.setTimeout(() => void refreshSessions(), 3000),
      window.setTimeout(() => void refreshSessions(), 9000),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [refreshSessions]);

  useEffect(() => {
    if (selectedSession === null) return;
    void captureSelected(selectedSession);
    const interval = window.setInterval(() => {
      void captureSelected(selectedSession);
    }, 1200);
    return () => window.clearInterval(interval);
  }, [captureSelected, selectedSession]);

  useEffect(() => {
    const handleOpenSession = (event: Event) => {
      const detail = (event as CustomEvent<ArkSessionTarget>).detail;
      if (detail?.name) void openSession(detail);
    };
    window.addEventListener(ARK_OPEN_SESSION_EVENT, handleOpenSession);
    return () => window.removeEventListener(ARK_OPEN_SESSION_EVENT, handleOpenSession);
  }, [openSession]);

  if (environmentId === null) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No Ark backend is connected.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-foreground">Ark sessions</h1>
          <p className="text-xs text-muted-foreground">tmux chats on this backend</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refreshSessions(true)}>
            <RefreshCwIcon />
            Refresh
          </Button>
          <Button size="sm" onClick={() => void openSession(DEFAULT_SESSION)} disabled={isBusy}>
            <PlusIcon />
            Open ark-main
          </Button>
        </div>
      </div>

      {error === null ? null : (
        <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto rounded-lg border border-border bg-card/50 p-2">
          {sessions.length === 0 ? (
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm hover:bg-accent"
              type="button"
              onClick={() => void openSession(DEFAULT_SESSION)}
            >
              <TerminalIcon className="size-4 text-muted-foreground" />
              <span>
                <span className="block font-medium text-foreground">Create ark-main</span>
                <span className="block text-xs text-muted-foreground">No tmux sessions yet</span>
              </span>
            </button>
          ) : (
            sessions.map((session) => (
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-accent",
                  selectedSession !== null &&
                    sessionKey(selectedSession) === sessionKey(session) &&
                    "bg-accent text-accent-foreground",
                )}
                key={session.name}
                type="button"
                onClick={() => void openSession(session.name)}
              >
                <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{session.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {sessionLabel(session)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {selectedSession?.name ?? "No session selected"}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedSession === null ? "Live tmux capture" : machineLabel(selectedSession)}
              </div>
            </div>
            <Button
              size="sm"
              variant="destructive-outline"
              onClick={() => void stopSelected()}
              disabled={selectedSession === null}
            >
              <SquareIcon />
              Stop
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="max-w-[980px] rounded-lg border border-amber-500/25 bg-[#151109] px-3 py-3 font-mono text-[13px] leading-5 text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.10)]">
              {selectedSession === null ? (
                <span className="text-amber-200/55">Open a tmux session to start.</span>
              ) : terminalText.length === 0 ? (
                <span className="text-amber-200/55">Waiting for terminal output...</span>
              ) : (
                <pre className="whitespace-pre-wrap break-words">{terminalText}</pre>
              )}
            </div>
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendDraft();
            }}
          >
            <div className="flex gap-2">
              <Textarea
                className="flex-1"
                disabled={selectedSession === null}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendDraft();
                  }
                }}
                placeholder={
                  selectedSession === null
                    ? "Open a session first"
                    : `Send to ${selectedSession.name}`
                }
                rows={2}
                value={draft}
              />
              <Button
                disabled={selectedSession === null || draft.trim().length === 0}
                type="submit"
              >
                <SendIcon />
                Send
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
