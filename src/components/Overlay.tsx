import { useBuddyStore } from "../store";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

const STATUS_LABELS: Record<string, string> = {
  idle: "idle",
  capturing: "capturing…",
  thinking: "thinking…",
  speaking: "speaking…",
  error: "error",
};

const PULSE_STATUSES = new Set(["capturing", "thinking", "speaking"]);

interface OverlayProps {
  onStop?: () => void;
}

export default function Overlay({ onStop }: OverlayProps) {
  const status     = useBuddyStore((s) => s.status);
  const transcript = useBuddyStore((s) => s.transcript);

  const isActive = PULSE_STATUSES.has(status);

  return (
    <div className="flex items-end justify-end w-full h-full p-3">
      <Card className="w-full flex flex-col gap-2 px-4 py-3 max-h-full">
        {/* Status row */}
        <div className="flex items-center justify-between shrink-0">
          <Badge variant={status as Parameters<typeof Badge>[0]["variant"]}>
            {isActive && (
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
              </span>
            )}
            {STATUS_LABELS[status] ?? status}
          </Badge>

          {/* Stop button — only while pipeline is running */}
          {isActive && (
            <button
              onClick={onStop}
              title="Stop (Esc)"
              className="text-white/30 hover:text-white/80 transition-colors text-lg leading-none px-1 rounded"
            >
              ×
            </button>
          )}
        </div>

        {/* Transcript — scrollable, full text */}
        {transcript && (
          <div className="overflow-y-auto flex-1 pr-1 scrollbar-thin">
            <p className="text-white/85 text-xs leading-relaxed select-text whitespace-pre-wrap break-words">
              {transcript}
            </p>
          </div>
        )}

        {/* Idle hint */}
        {!transcript && status === "idle" && (
          <p className="text-white/30 text-xs">
            Press Ctrl+Shift+Space to analyse screen
          </p>
        )}
      </Card>
    </div>
  );
}
