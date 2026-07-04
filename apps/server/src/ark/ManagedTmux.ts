const PROMPT_REGEX = /^[\w@.~-]+:.*[$#]\s*/u;
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/gu;

export const VALID_TMUX_KEYS = new Set([
  "C-a",
  "C-b",
  "C-c",
  "C-d",
  "C-e",
  "C-f",
  "C-g",
  "C-j",
  "C-k",
  "C-l",
  "C-n",
  "C-o",
  "C-p",
  "C-r",
  "C-s",
  "C-t",
  "C-u",
  "C-v",
  "C-w",
  "C-x",
  "C-y",
  "C-z",
  "Up",
  "Down",
  "Left",
  "Right",
  "Tab",
  "BTab",
  "Enter",
  "Escape",
  "Space",
  "BSpace",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
]);

export interface ManagedTmuxSession {
  readonly name: string;
  readonly windows: number | null;
  readonly attached: number | null;
  readonly created: number | null;
  readonly ark: boolean;
}

export function shellSingle(command: string): string {
  return `'${command.replaceAll("'", `'"'"'`)}'`;
}

export function tmuxTarget(name: string): string {
  return shellSingle(name);
}

export function isTmuxMissing(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("can't find pane") ||
    normalized.includes("can't find session") ||
    normalized.includes("no server running")
  );
}

export function prepareShellCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed === "cd") {
    return "cd ~ && pwd";
  }
  if (/^cd\s+\S/u.test(trimmed) && !trimmed.includes("&&") && !trimmed.includes(";")) {
    return `${trimmed} && pwd`;
  }
  return command;
}

export function parseTmuxSessions(output: string): readonly ManagedTmuxSession[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [name, windows, attached, created] = line.split("\t");
      if (!name) return [];
      return [
        {
          name,
          windows: windows && /^\d+$/u.test(windows) ? Number(windows) : null,
          attached: attached && /^\d+$/u.test(attached) ? Number(attached) : null,
          created: created && /^\d+$/u.test(created) ? Number(created) : null,
          ark: name.startsWith("ark-"),
        },
      ];
    });
}

export function buildEnsureTmuxScript(tmuxName: string): string {
  const target = tmuxTarget(tmuxName);
  return [
    `tmux has-session -t ${target} 2>/dev/null || tmux new-session -d -s ${target} -c ~`,
    `tmux set-option -t ${target} history-limit 10000`,
  ].join("; ");
}

export function buildCapturePaneCommand(tmuxName: string, scroll = 300): string {
  const start = scroll > 0 ? ` -S -${Math.floor(scroll)}` : "";
  return `tmux capture-pane -pt ${tmuxTarget(tmuxName)}${start} -e`;
}

export function buildSendLineCommand(tmuxName: string, command: string): string {
  return `tmux send-keys -t ${tmuxTarget(tmuxName)} ${shellSingle(command)} Enter`;
}

export function buildSendTextCommand(tmuxName: string, text: string, submit = true): string {
  const target = tmuxTarget(tmuxName);
  const sendText = `tmux send-keys -t ${target} -l ${shellSingle(text)}`;
  return submit ? `${sendText}; sleep 0.65; tmux send-keys -t ${target} Enter` : sendText;
}

export function buildSendKeyCommand(tmuxName: string, key: string): string | null {
  if (!VALID_TMUX_KEYS.has(key)) {
    return null;
  }
  return `tmux send-keys -t ${tmuxTarget(tmuxName)} ${shellSingle(key)}`;
}

export function stripAnsi(input: string): string {
  return input.replaceAll(ANSI_REGEX, "");
}

export function extractTaggedPaneOutput(
  pane: string,
  tag: string,
): { readonly state: "running" | "done"; readonly exitCode: number; readonly output: string } {
  const lines = pane.split(/\r?\n/u);
  const clean = lines.map(stripAnsi);
  const marker = `@@${tag}`;
  const markerRegex = new RegExp(`(?:${escapeRegExp(marker)}|__ARK_${escapeRegExp(tag)}__):(\\d+)`);
  let endIdx: number | null = null;
  let exitCode = 0;
  let markerPrefix = "";

  for (let i = clean.length - 1; i >= 0; i -= 1) {
    const match = clean[i]!.match(markerRegex);
    if (match) {
      exitCode = Number(match[1] ?? 0);
      endIdx = i;
      markerPrefix = clean[i]!.slice(0, match.index).trimEnd();
      break;
    }
  }

  const searchTo = endIdx ?? clean.length;
  let startIdx = 0;
  for (let i = searchTo - 1; i >= 0; i -= 1) {
    if (PROMPT_REGEX.test(clean[i]!)) {
      startIdx = i + 1;
      break;
    }
  }

  const output: string[] = [];
  const limit = endIdx ?? lines.length;
  for (let i = startIdx; i < limit; i += 1) {
    const cleanLine = clean[i]!.trim();
    if (!cleanLine || cleanLine.includes(marker) || cleanLine.includes(`__ARK_${tag}__`)) {
      continue;
    }
    if (PROMPT_REGEX.test(clean[i]!)) {
      continue;
    }
    output.push(lines[i]!.trimEnd());
  }

  if (markerPrefix && !markerPrefix.includes(marker) && !PROMPT_REGEX.test(markerPrefix)) {
    output.push(markerPrefix);
  }

  return {
    state: endIdx === null ? "running" : "done",
    exitCode,
    output: output.join("\n").trim(),
  };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
