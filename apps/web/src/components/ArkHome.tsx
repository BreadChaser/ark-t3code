import type { ArkTmuxSession, EnvironmentId } from "@t3tools/contracts";
import { ImageIcon, RefreshCwIcon, SendIcon, SquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { arkEnvironment } from "../state/ark";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const DEFAULT_SESSION = "ark-main";
export const ARK_OPEN_SESSION_EVENT = "ark:open-session";

type ArkSessionTarget = Pick<ArkTmuxSession, "name" | "machineIp" | "machineName">;
interface PastedImage {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly previewUrl: string;
}

function sessionKey(session: ArkSessionTarget): string {
  return `${session.machineIp ?? "local"}:${session.name}`;
}

function machineLabel(session: ArkSessionTarget): string {
  return session.machineName ?? (session.machineIp ? session.machineIp : "This device");
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = value.split(",", 2);
      base64 ? resolve(base64) : reject(new Error("Could not read image."));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Could not read image.")),
    );
    reader.readAsDataURL(file);
  });
}

function randomLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const saveTmuxImage = useAtomCommand(arkEnvironment.saveTmuxImage, { reportFailure: false });
  const stopTmux = useAtomCommand(arkEnvironment.stopTmux, { reportFailure: false });

  const [, setSessions] = useState<ArkTmuxSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ArkSessionTarget | null>(null);
  const [terminalText, setTerminalText] = useState("");
  const [draft, setDraft] = useState("");
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSelectedKey = useRef<string | null>(null);
  const pastedImagesRef = useRef<readonly PastedImage[]>([]);

  useEffect(() => {
    latestSelectedKey.current = selectedSession === null ? null : sessionKey(selectedSession);
  }, [selectedSession]);

  useEffect(() => {
    pastedImagesRef.current = pastedImages;
  }, [pastedImages]);

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

    for (const image of pastedImages) URL.revokeObjectURL(image.previewUrl);
    setPastedImages([]);
    await captureSelected(selectedSession);
  }, [captureSelected, draft, environmentId, pastedImages, selectedSession, sendTmuxText]);

  const pasteImages = useCallback(
    async (files: File[]) => {
      if (environmentId === null || selectedSession === null || files.length === 0) return;
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      const savedImages: PastedImage[] = [];
      for (const file of imageFiles) {
        const dataBase64 = await readFileBase64(file);
        const result = await saveTmuxImage({
          environmentId,
          input: {
            machineIp: selectedSession.machineIp,
            name: file.name || "pasted-image",
            mimeType: file.type,
            dataBase64,
          },
        });
        if (result._tag === "Failure") {
          setError(`Could not save ${file.name || "pasted image"}.`);
          continue;
        }
        savedImages.push({
          id: randomLocalId(),
          name: file.name || "pasted image",
          path: result.value.path,
          previewUrl: URL.createObjectURL(file),
        });
      }
      if (savedImages.length === 0) return;

      setPastedImages((current) => [...current, ...savedImages]);
      setDraft((current) => {
        const prefix = current.trim().length === 0 ? "" : `${current.trimEnd()}\n`;
        return `${prefix}${savedImages.map((image) => `Image: ${image.path}`).join("\n")}`;
      });
      setError(null);
    },
    [environmentId, saveTmuxImage, selectedSession],
  );

  const removePastedImage = useCallback((imageId: string) => {
    setPastedImages((current) => {
      const image = current.find((item) => item.id === imageId);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return current.filter((item) => item.id !== imageId);
    });
  }, []);

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

  useEffect(
    () => () => {
      for (const image of pastedImagesRef.current) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  if (environmentId === null) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No Ark backend is connected.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-5">
      {error === null ? null : (
        <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {selectedSession?.name ?? "No session selected"}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedSession === null ? "Live tmux capture" : machineLabel(selectedSession)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void refreshSessions(true)}>
                <RefreshCwIcon />
                Refresh
              </Button>
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
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="min-h-full rounded-lg border border-amber-500/25 bg-[#151109] px-3 py-3 font-mono text-[13px] leading-5 text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.10)]">
              {selectedSession === null ? (
                <button
                  className="rounded-md border border-amber-400/20 px-3 py-2 text-amber-100 hover:bg-amber-300/10"
                  type="button"
                  onClick={() => void openSession(DEFAULT_SESSION)}
                  disabled={isBusy}
                >
                  Open ark-main
                </button>
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
            {pastedImages.length === 0 ? null : (
              <div className="mb-2 flex flex-wrap gap-2">
                {pastedImages.map((image) => (
                  <div
                    key={image.id}
                    className="flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs"
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="size-8 rounded object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{image.name}</span>
                      <span className="block truncate text-muted-foreground">{image.path}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${image.name}`}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => removePastedImage(image.id)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                className="flex-1"
                disabled={selectedSession === null}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.some((file) => file.type.startsWith("image/"))) {
                    event.preventDefault();
                    void pasteImages(files);
                  }
                }}
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
                {pastedImages.length > 0 ? <ImageIcon /> : <SendIcon />}
                Send
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
