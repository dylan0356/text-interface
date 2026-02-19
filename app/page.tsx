"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { conditionSpec, type ConditionSpec } from "@/lib/condition-spec";

type LogEntry = {
  event: "start" | "stop" | "tick";
  index: number;
  timestamp: string;
};

type TokenizationUnit = ConditionSpec["tokenization"]["unit"];
const VIEWPORT_STEPS = [
  "letter-1",
  "letter-2",
  "letter-3",
  "word-1",
  "word-2",
  "word-3",
  "sentence",
] as const;
type ViewportStep = (typeof VIEWPORT_STEPS)[number];
const MIN_SETTINGS_WIDTH = 280;
const MIN_VIEWPORT_WIDTH = 320;
const VIEWPORT_STEP_LABELS: Record<ViewportStep, string> = {
  "letter-1": "1 letter",
  "letter-2": "2 letters",
  "letter-3": "3 letters",
  "word-1": "1 word",
  "word-2": "2 words",
  "word-3": "3 words",
  sentence: "sentence",
};

function getStepIndex(step: ViewportStep): number {
  return VIEWPORT_STEPS.indexOf(step);
}

function endsWithPausePunctuation(token: string): boolean {
  return /[.,!?;:]["')\]]?$/.test(token.trim());
}

function speedToPxPerSecond(spec: ConditionSpec): number {
  const value = Math.max(1, spec.motion.speed.value);
  const wordsPerSecond = value / 60;
  const approxWordPx = spec.typography.fontSizePx * 3.6;
  return Math.max(10, wordsPerSecond * approxWordPx);
}

function tokenizeText(
  text: string,
  unit: TokenizationUnit,
  chunkSize: number,
): string[] {
  const size = Math.max(1, Math.floor(chunkSize || 1));

  const baseTokens =
    unit === "char"
      ? Array.from(text)
      : unit === "sentence"
        ? (text.match(/[^.!?]+[.!?]?/g) ?? [])
            .map((token) => token.trim())
            .filter(Boolean)
        : text.trim().split(/\s+/).filter(Boolean);

  if (!baseTokens.length) {
    return [];
  }

  if (size === 1 && unit !== "chunk") {
    return baseTokens;
  }

  const grouped: string[] = [];
  for (let i = 0; i < baseTokens.length; i += size) {
    grouped.push(
      baseTokens.slice(i, i + size).join(unit === "char" ? "" : " "),
    );
  }

  return grouped;
}

function RsvpRenderer({ spec, token }: { spec: ConditionSpec; token: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="text-center"
        style={{
          fontSize: spec.typography.fontSizePx,
          lineHeight: spec.typography.lineHeight,
        }}
      >
        {token || "Enter text to begin"}
      </div>
    </div>
  );
}

function ContinuousRsvpRenderer({
  spec,
  tokens,
}: {
  spec: ConditionSpec;
  tokens: string[];
}) {
  const [offsetPx, setOffsetPx] = useState(0);
  const direction = spec.motion.direction;
  const pxPerSecond = speedToPxPerSecond(spec);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const cycleLengthRef = useRef(2000);
  const text = useMemo(
    () =>
      direction === "vertical"
        ? tokens.join("\n")
        : tokens.join(spec.tokenization.unit === "char" ? "" : " "),
    [direction, spec.tokenization.unit, tokens],
  );

  useEffect(() => {
    if (!spec.motion.autoplay || spec.mode !== "rsvp" || spec.motion.progression !== "continuous") {
      return;
    }

    const tick = (ts: number) => {
      const lastTs = lastTsRef.current;
      const dt = lastTs == null ? 0 : (ts - lastTs) / 1000;
      lastTsRef.current = ts;
      setOffsetPx((prev) => {
        const next = prev + pxPerSecond * dt;
        const cycle = Math.max(1, cycleLengthRef.current);
        return next > cycle ? 0 : next;
      });
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [pxPerSecond, spec.mode, spec.motion.autoplay, spec.motion.progression]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute left-0 top-0 h-full w-full opacity-15"
        style={{
          background:
            direction === "horizontal"
              ? "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(34,197,94,0.25) 50%, rgba(255,255,255,0) 100%)"
              : "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(34,197,94,0.25) 50%, rgba(255,255,255,0) 100%)",
        }}
      />
      <div className="flex h-full w-full items-center justify-center px-8">
        <div
          className={direction === "vertical" ? "whitespace-pre text-center" : "whitespace-nowrap"}
          style={{
            transform:
              direction === "horizontal"
                ? `translateX(${-offsetPx}px)`
                : `translateY(${-offsetPx}px)`,
            fontFamily: spec.typography.fontFamily,
            fontSize: spec.typography.fontSizePx,
            lineHeight: spec.typography.lineHeight,
            letterSpacing: spec.typography.letterSpacingPx,
            wordSpacing: spec.typography.wordSpacingPx,
          }}
          ref={(node) => {
            if (!node) {
              return;
            }
            const container = node.parentElement;
            const viewportWidth = container?.clientWidth ?? node.clientWidth;
            const viewportHeight = container?.clientHeight ?? node.clientHeight;
            cycleLengthRef.current =
              direction === "horizontal"
                ? node.scrollWidth + viewportWidth
                : node.scrollHeight + viewportHeight;
          }}
        >
          {text || "Enter text to begin"}
        </div>
      </div>
    </div>
  );
}

function ParagraphRenderer({
  spec,
  text,
}: {
  spec: ConditionSpec;
  text: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div
        style={{
          maxWidth: spec.typography.lineWidthPx,
          fontFamily: spec.typography.fontFamily,
          fontSize: spec.typography.fontSizePx,
          lineHeight: spec.typography.lineHeight,
          letterSpacing: spec.typography.letterSpacingPx,
          wordSpacing: spec.typography.wordSpacingPx,
          fontVariationSettings: spec.typography.variableAxes
            ? Object.entries(spec.typography.variableAxes)
                .map(([axis, value]) => `"${axis}" ${value}`)
                .join(", ")
            : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function Viewport({
  spec,
  text,
  rsvpToken,
  rsvpTokens,
}: {
  spec: ConditionSpec;
  text: string;
  rsvpToken: string;
  rsvpTokens: string[];
}) {
  return (
    <div className="h-full w-full overflow-hidden border border-zinc-300">
      {spec.mode === "rsvp" && spec.motion.progression === "continuous" ? (
        <ContinuousRsvpRenderer
          key={`${spec.motion.direction}-${spec.motion.speed.value}-${rsvpTokens.join("|")}`}
          spec={spec}
          tokens={rsvpTokens}
        />
      ) : spec.mode === "rsvp" ? (
        <RsvpRenderer spec={spec} token={rsvpToken} />
      ) : (
        <ParagraphRenderer spec={spec} text={text} />
      )}
    </div>
  );
}

export default function Home() {
  const [spec, setSpec] = useState<ConditionSpec>({
    ...conditionSpec,
    motion: {
      ...conditionSpec.motion,
      speed: { ...conditionSpec.motion.speed, unit: "wpm" },
    },
  });
  const [viewportStep, setViewportStep] = useState<ViewportStep>("word-1");
  const [rsvpIndex, setRsvpIndex] = useState(0);
  const [isSpecModalOpen, setIsSpecModalOpen] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(true);
  const [settingsWidth, setSettingsWidth] = useState(420);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [text, setText] = useState(
    "The quick brown fox jumps over the lazy dog. Sixty zippers were quickly picked from the woven jute bag. A wizards job is to vex chumps quickly in fog.",
  );
  const logsRef = useRef<LogEntry[]>([]);
  const rsvpIndexRef = useRef(0);
  const splitViewRef = useRef<HTMLDivElement | null>(null);

  const appendLog = useCallback((entry: LogEntry) => {
    const next = [...logsRef.current, entry];
    logsRef.current = next.length > 200 ? next.slice(next.length - 200) : next;
  }, []);

  const rsvpTokens = useMemo(
    () =>
      tokenizeText(text, spec.tokenization.unit, spec.tokenization.chunkSize),
    [text, spec.tokenization.unit, spec.tokenization.chunkSize],
  );
  const safeRsvpIndex = rsvpTokens.length ? rsvpIndex % rsvpTokens.length : 0;
  const currentRsvpToken = rsvpTokens.length ? rsvpTokens[safeRsvpIndex] : "";

  useEffect(() => {
    rsvpIndexRef.current = safeRsvpIndex;
  }, [safeRsvpIndex]);

  useEffect(() => {
    if (
      spec.mode !== "rsvp" ||
      !spec.motion.autoplay ||
      rsvpTokens.length === 0
    ) {
      return;
    }

    let timeoutId: number;
    let cancelled = false;

    const tick = () => {
      if (cancelled) {
        return;
      }
      const next = (rsvpIndexRef.current + 1) % rsvpTokens.length;
      rsvpIndexRef.current = next;
      setRsvpIndex(next);
      appendLog({
        event: "tick",
        index: next,
        timestamp: new Date().toISOString(),
      });
      const token = rsvpTokens[next] ?? "";
      const speedValue = Math.max(50, spec.motion.speed.value);
      const msPerToken = Math.max(50, Math.round(60000 / speedValue));
      const extraDelay =
        spec.motion.pauseAtPunctuation.enabled &&
        endsWithPausePunctuation(token) &&
        spec.motion.progression === "step"
          ? Math.max(0, spec.motion.pauseAtPunctuation.delayMs)
          : 0;
      timeoutId = window.setTimeout(tick, msPerToken + extraDelay);
    };
    timeoutId = window.setTimeout(tick, 1);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    appendLog,
    rsvpTokens,
    spec.mode,
    spec.motion.autoplay,
    spec.motion.direction,
    spec.motion.pauseAtPunctuation.delayMs,
    spec.motion.pauseAtPunctuation.enabled,
    spec.motion.progression,
    spec.motion.speed.value,
  ]);

  const setAutoplay = useCallback(
    (autoplay: boolean) => {
      setSpec((prev) => ({
        ...prev,
        motion: { ...prev.motion, autoplay },
      }));
      appendLog({
        event: autoplay ? "start" : "stop",
        index: safeRsvpIndex,
        timestamp: new Date().toISOString(),
      });
    },
    [appendLog, safeRsvpIndex],
  );

  const applyViewportStep = useCallback((step: ViewportStep) => {
    setViewportStep(step);
    setSpec((prev) => {
      if (step === "letter-1") {
        return {
          ...prev,
          mode: "rsvp",
          tokenization: { ...prev.tokenization, unit: "char", chunkSize: 1 },
        };
      }
      if (step === "letter-2") {
        return {
          ...prev,
          mode: "rsvp",
          tokenization: { ...prev.tokenization, unit: "char", chunkSize: 2 },
        };
      }
      if (step === "letter-3") {
        return {
          ...prev,
          mode: "rsvp",
          tokenization: { ...prev.tokenization, unit: "char", chunkSize: 3 },
        };
      }
      if (step === "word-1") {
        return {
          ...prev,
          mode: "rsvp",
          tokenization: { ...prev.tokenization, unit: "word", chunkSize: 1 },
        };
      }
      if (step === "word-2") {
        return {
          ...prev,
          mode: "rsvp",
          tokenization: {
            ...prev.tokenization,
            unit: "word",
            chunkSize: 2,
          },
        };
      }
      if (step === "word-3") {
        return {
          ...prev,
          mode: "rsvp",
          tokenization: {
            ...prev.tokenization,
            unit: "word",
            chunkSize: 3,
          },
        };
      }
      return {
        ...prev,
        mode: "rsvp",
        tokenization: { ...prev.tokenization, unit: "sentence", chunkSize: 1 },
      };
    });
  }, []);

  useEffect(() => {
    if (!isResizingPanel || !isSettingsVisible) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const node = splitViewRef.current;
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      const maxSettingsWidth = Math.max(
        MIN_SETTINGS_WIDTH,
        rect.width - MIN_VIEWPORT_WIDTH,
      );
      const nextWidth = rect.right - event.clientX;
      const clampedWidth = Math.min(
        maxSettingsWidth,
        Math.max(MIN_SETTINGS_WIDTH, nextWidth),
      );
      setSettingsWidth(clampedWidth);
    };

    const handlePointerUp = () => {
      setIsResizingPanel(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizingPanel, isSettingsVisible]);

  useEffect(() => {
    const handleResize = () => {
      const node = splitViewRef.current;
      if (!node) {
        return;
      }
      const maxSettingsWidth = Math.max(
        MIN_SETTINGS_WIDTH,
        node.getBoundingClientRect().width - MIN_VIEWPORT_WIDTH,
      );
      setSettingsWidth((prev) =>
        Math.min(maxSettingsWidth, Math.max(MIN_SETTINGS_WIDTH, prev)),
      );
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isSettingsVisible]);

  return (
    <main className="bg-white text-black">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-4">
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className="rounded border border-zinc-300 px-3 py-1 text-sm"
            onClick={() => setIsSettingsVisible((prev) => !prev)}
          >
            {isSettingsVisible ? "Hide Settings" : "Show Settings"}
          </button>
        </div>

        <div
          ref={splitViewRef}
          className="flex h-[calc(100vh-5rem)] min-h-[680px] rounded border border-zinc-200"
        >
          <section className="min-w-0 flex-1 overflow-auto p-4">
            <div className="flex h-full items-center justify-center">
              <Viewport
                spec={spec}
                text={text}
                rsvpToken={currentRsvpToken}
                rsvpTokens={rsvpTokens}
              />
            </div>
          </section>

          {isSettingsVisible ? (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize settings panel"
                className={`w-2 shrink-0 cursor-col-resize border-l border-r border-zinc-200 bg-zinc-100 transition-colors ${
                  isResizingPanel ? "bg-zinc-300" : "hover:bg-zinc-200"
                }`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setIsResizingPanel(true);
                }}
              />
              <aside
                className="shrink-0 overflow-y-auto p-4"
                style={{ width: settingsWidth }}
              >
                <div className="space-y-4">
                  <label className="flex flex-col gap-2 text-sm">
                    Text
                    <textarea
                      className="min-h-24 rounded border border-zinc-300 p-2"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>

                  <div className="space-y-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Viewport Step
                      <input
                        type="range"
                        min={0}
                        max={VIEWPORT_STEPS.length - 1}
                        step={1}
                        value={getStepIndex(viewportStep)}
                        onChange={(e) =>
                          applyViewportStep(
                            VIEWPORT_STEPS[Number(e.target.value)] ?? "word-1",
                          )
                        }
                      />
                    </label>
                    <div className="grid grid-cols-7 text-center text-xs text-zinc-500">
                      {VIEWPORT_STEPS.map((step) => (
                        <span
                          key={step}
                          className={
                            step === viewportStep
                              ? "font-medium text-black"
                              : undefined
                          }
                        >
                          {VIEWPORT_STEP_LABELS[step]}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <section className="space-y-3 rounded border border-zinc-200 p-3 text-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Playback
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center gap-2 pt-6">
                          <input
                            type="checkbox"
                            checked={spec.motion.autoplay}
                            onChange={(e) => setAutoplay(e.target.checked)}
                          />
                          Autoplay
                        </label>
                        <label className="flex flex-col gap-1">
                          Speed (WPM): {spec.motion.speed.value}
                          <input
                            className="w-full"
                            type="range"
                            min={50}
                            max={1200}
                            step={10}
                            value={spec.motion.speed.value}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                motion: {
                                  ...prev.motion,
                                  speed: {
                                    unit: "wpm",
                                    value: Math.max(50, Number(e.target.value) || 50),
                                  },
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          Progression
                          <select
                            className="rounded border border-zinc-300 px-2 py-1"
                            value={spec.motion.progression}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                motion: {
                                  ...prev.motion,
                                  progression: e.target.value as ConditionSpec["motion"]["progression"],
                                },
                              }))
                            }
                          >
                            <option value="step">step</option>
                            <option value="continuous">continuous</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          Direction
                          <select
                            className="rounded border border-zinc-300 px-2 py-1"
                            value={spec.motion.direction}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                motion: {
                                  ...prev.motion,
                                  direction: e.target.value as ConditionSpec["motion"]["direction"],
                                },
                              }))
                            }
                          >
                            <option value="horizontal">horizontal</option>
                            <option value="vertical">vertical</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-2 pt-6">
                          <input
                            type="checkbox"
                            checked={spec.motion.pauseAtPunctuation.enabled}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                motion: {
                                  ...prev.motion,
                                  pauseAtPunctuation: {
                                    ...prev.motion.pauseAtPunctuation,
                                    enabled: e.target.checked,
                                  },
                                },
                              }))
                            }
                          />
                          Pause at punctuation
                        </label>
                        <label className="flex flex-col gap-1">
                          Punctuation Delay (ms): {spec.motion.pauseAtPunctuation.delayMs}
                          <input
                            className="w-full"
                            type="range"
                            min={0}
                            max={2000}
                            step={25}
                            disabled={!spec.motion.pauseAtPunctuation.enabled}
                            value={spec.motion.pauseAtPunctuation.delayMs}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                motion: {
                                  ...prev.motion,
                                  pauseAtPunctuation: {
                                    ...prev.motion.pauseAtPunctuation,
                                    delayMs: Math.max(0, Number(e.target.value) || 0),
                                  },
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          className="rounded border border-zinc-300 px-3 py-1"
                          disabled={spec.mode !== "rsvp"}
                          onClick={() => setAutoplay(!spec.motion.autoplay)}
                        >
                          {spec.motion.autoplay ? "Pause" : "Play"}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-300 px-3 py-1"
                          disabled={spec.mode !== "rsvp"}
                          onClick={() => {
                            rsvpIndexRef.current = 0;
                            setRsvpIndex(0);
                            appendLog({
                              event: "stop",
                              index: 0,
                              timestamp: new Date().toISOString(),
                            });
                          }}
                        >
                          Reset
                        </button>
                        <span className="pb-1 text-xs text-zinc-600">
                          {safeRsvpIndex + 1}/{Math.max(1, rsvpTokens.length)}
                        </span>
                      </div>
                    </section>

                    <section className="space-y-3 rounded border border-zinc-200 p-3 text-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                        Typography
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                          Font Size: {spec.typography.fontSizePx}px
                          <input
                            className="w-full"
                            type="range"
                            min={12}
                            max={120}
                            step={1}
                            value={spec.typography.fontSizePx}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                typography: {
                                  ...prev.typography,
                                  fontSizePx: Math.max(
                                    12,
                                    Number(e.target.value) || 12,
                                  ),
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          Line Height: {spec.typography.lineHeight.toFixed(2)}
                          <input
                            className="w-full"
                            type="range"
                            step="0.05"
                            min={0.8}
                            max={3}
                            value={spec.typography.lineHeight}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                typography: {
                                  ...prev.typography,
                                  lineHeight: Math.max(
                                    0.8,
                                    Number(e.target.value) || 0.8,
                                  ),
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1">
                        Line Width: {spec.typography.lineWidthPx}px
                        <input
                          className="w-full"
                          type="range"
                          min={200}
                          max={1400}
                          step={10}
                          value={spec.typography.lineWidthPx}
                          onChange={(e) =>
                            setSpec((prev) => ({
                              ...prev,
                              typography: {
                                ...prev.typography,
                                lineWidthPx: Math.max(200, Number(e.target.value) || 200),
                              },
                            }))
                          }
                        />
                      </label>
                    </section>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="rounded border border-zinc-300 px-3 py-1 text-sm"
                      onClick={() => setIsSpecModalOpen(true)}
                    >
                      View Settings Json
                    </button>
                  </div>
                </div>
              </aside>
            </>
          ) : null}
        </div>
      </div>

      {isSpecModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl rounded border border-zinc-300 bg-white p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">ConditionSpec</h2>
              <button
                type="button"
                className="rounded border border-zinc-300 px-2 py-1 text-xs"
                onClick={() => setIsSpecModalOpen(false)}
              >
                Close
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto rounded border border-zinc-200 p-3 text-xs">
              {JSON.stringify(spec, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </main>
  );
}
