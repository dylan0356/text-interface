"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { conditionSpec, type ConditionSpec } from "@/lib/condition-spec";

type LogEntry = {
  event: "start" | "stop" | "tick" | "manual";
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

function getViewportTokenCount(step: ViewportStep): number {
  if (step === "letter-1" || step === "word-1" || step === "sentence") {
    return 1;
  }
  if (step === "letter-2" || step === "word-2") {
    return 2;
  }
  return 3;
}

function getRsvpDisplayToken(
  tokens: string[],
  startIndex: number,
  viewportTokenCount: number,
  unit: TokenizationUnit,
): string {
  if (!tokens.length) {
    return "";
  }

  const size = Math.max(1, Math.floor(viewportTokenCount || 1));
  const safeStart = ((startIndex % tokens.length) + tokens.length) % tokens.length;
  if (size === 1) {
    return tokens[safeStart] ?? "";
  }

  const windowTokens: string[] = [];
  for (let i = 0; i < size; i += 1) {
    windowTokens.push(tokens[(safeStart + i) % tokens.length] ?? "");
  }
  return windowTokens.join(unit === "char" ? "" : " ");
}

function splitAroundCenterCharacter(value: string): {
  left: string;
  center: string;
  right: string;
} {
  if (!value) {
    return { left: "", center: "", right: "" };
  }
  const chars = Array.from(value);
  const centerIndex = Math.floor(chars.length / 2);
  return {
    left: chars.slice(0, centerIndex).join(""),
    center: chars[centerIndex] ?? "",
    right: chars.slice(centerIndex + 1).join(""),
  };
}

function endsWithPausePunctuation(token: string): boolean {
  return /[.,!?;:]["')\]]?$/.test(token.trim());
}

function speedToPxPerSecond(spec: ConditionSpec): number {
  const charsPerSecond = Math.max(1, spec.motion.speed.value);
  const approxCharPx =
    spec.typography.fontSizePx * 0.62 + spec.typography.letterSpacingPx;
  return Math.max(10, charsPerSecond * Math.max(1, approxCharPx));
}

function getAdvanceCharacterCount(
  tokens: string[],
  startIndex: number,
  advanceCount: number,
  unit: TokenizationUnit,
): number {
  if (!tokens.length) {
    return 1;
  }

  const safeStart = ((startIndex % tokens.length) + tokens.length) % tokens.length;
  const size = Math.max(1, Math.floor(advanceCount || 1));
  const movedTokens: string[] = [];

  for (let i = 0; i < size; i += 1) {
    movedTokens.push(tokens[(safeStart + i) % tokens.length] ?? "");
  }

  const movedText = movedTokens.join(unit === "char" ? "" : " ");
  return Math.max(1, movedText.length);
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
  const { left, center, right } = splitAroundCenterCharacter(token);
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="grid w-full grid-cols-[1fr_auto_1fr] items-center select-none"
        style={{
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
        {token ? (
          <>
            <span className="justify-self-end whitespace-pre text-right">{left}</span>
            <span className="whitespace-pre">{center}</span>
            <span className="whitespace-pre">{right}</span>
          </>
        ) : (
          <span className="col-span-3 text-center">Enter text to begin</span>
        )}
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
  manualAdvanceEnabled,
  onManualAdvance,
}: {
  spec: ConditionSpec;
  text: string;
  rsvpToken: string;
  rsvpTokens: string[];
  manualAdvanceEnabled: boolean;
  onManualAdvance: () => void;
}) {
  return (
    <div
      className={`h-full w-full overflow-hidden border border-zinc-300 select-none ${
        manualAdvanceEnabled ? "cursor-pointer" : ""
      }`}
      onClick={manualAdvanceEnabled ? onManualAdvance : undefined}
    >
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
      speed: { ...conditionSpec.motion.speed, unit: "cps" },
    },
  });
  const [viewportStep, setViewportStep] = useState<ViewportStep>("word-1");
  const [advanceStep, setAdvanceStep] = useState(1);
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
    () => tokenizeText(text, spec.tokenization.unit, 1),
    [text, spec.tokenization.unit],
  );
  const viewportTokenCount = useMemo(
    () => getViewportTokenCount(viewportStep),
    [viewportStep],
  );
  const maxAdvanceStep = viewportTokenCount;
  const effectiveAdvanceStep = Math.max(
    1,
    Math.min(maxAdvanceStep, Math.floor(advanceStep || 1)),
  );
  const safeRsvpIndex = rsvpTokens.length ? rsvpIndex % rsvpTokens.length : 0;
  const currentRsvpToken = getRsvpDisplayToken(
    rsvpTokens,
    safeRsvpIndex,
    viewportTokenCount,
    spec.tokenization.unit,
  );
  const canManualAdvance =
    spec.mode === "rsvp" &&
    spec.motion.progression === "step" &&
    !spec.motion.autoplay &&
    rsvpTokens.length > 0;

  useEffect(() => {
    rsvpIndexRef.current = safeRsvpIndex;
  }, [safeRsvpIndex]);

  const advanceRsvp = useCallback(
    (event: "tick" | "manual") => {
      if (spec.mode !== "rsvp" || rsvpTokens.length === 0) {
        return null;
      }
      const currentIndex = rsvpIndexRef.current;
      const next = (currentIndex + effectiveAdvanceStep) % rsvpTokens.length;
      rsvpIndexRef.current = next;
      setRsvpIndex(next);
      appendLog({
        event,
        index: next,
        timestamp: new Date().toISOString(),
      });
      return {
        token: getRsvpDisplayToken(
          rsvpTokens,
          next,
          viewportTokenCount,
          spec.tokenization.unit,
        ),
        advancedCharCount: getAdvanceCharacterCount(
          rsvpTokens,
          currentIndex,
          effectiveAdvanceStep,
          spec.tokenization.unit,
        ),
      };
    },
    [
      appendLog,
      effectiveAdvanceStep,
      rsvpTokens,
      spec.mode,
      spec.tokenization.unit,
      viewportTokenCount,
    ],
  );

  useEffect(() => {
    if (
      spec.mode !== "rsvp" ||
      spec.motion.progression !== "step" ||
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
      const result = advanceRsvp("tick");
      if (!result) {
        return;
      }
      const speedValue = Math.max(1, spec.motion.speed.value);
      const msPerToken = Math.max(
        20,
        Math.round((result.advancedCharCount * 1000) / speedValue),
      );
      const extraDelay =
        spec.motion.pauseAtPunctuation.enabled &&
        endsWithPausePunctuation(result.token) &&
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
    advanceRsvp,
    rsvpTokens.length,
    spec.mode,
    spec.motion.progression,
    spec.motion.autoplay,
    spec.motion.pauseAtPunctuation.delayMs,
    spec.motion.pauseAtPunctuation.enabled,
    spec.motion.speed.value,
  ]);

  useEffect(() => {
    if (!canManualAdvance) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? "";
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      advanceRsvp("manual");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advanceRsvp, canManualAdvance]);

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
                manualAdvanceEnabled={canManualAdvance}
                onManualAdvance={() => advanceRsvp("manual")}
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
                        list="viewport-step-ticks"
                        value={getStepIndex(viewportStep)}
                        onChange={(e) =>
                          applyViewportStep(
                            VIEWPORT_STEPS[Number(e.target.value)] ?? "word-1",
                          )
                        }
                      />
                    </label>
                    <datalist id="viewport-step-ticks">
                      {VIEWPORT_STEPS.map((_, index) => (
                        <option key={index} value={index} />
                      ))}
                    </datalist>
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
                  <label className="flex flex-col gap-1 text-sm">
                    Advance Step: {effectiveAdvanceStep}
                    <input
                      type="range"
                      min={1}
                      max={maxAdvanceStep}
                      step={1}
                      list="advance-step-ticks"
                      value={effectiveAdvanceStep}
                      onChange={(e) =>
                        setAdvanceStep(
                          Math.max(
                            1,
                            Math.min(
                              maxAdvanceStep,
                              Number(e.target.value) || 1,
                            ),
                          ),
                        )
                      }
                    />
                    <datalist id="advance-step-ticks">
                      {Array.from({ length: maxAdvanceStep }, (_, i) => i + 1).map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                    <span className="text-xs text-zinc-500">
                      Allowed range: 1-{maxAdvanceStep}
                    </span>
                  </label>

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
                          Speed (chars/sec): {spec.motion.speed.value}
                          <input
                            className="w-full"
                            type="range"
                            min={1}
                            max={80}
                            step={1}
                            value={spec.motion.speed.value}
                            onChange={(e) =>
                              setSpec((prev) => ({
                                ...prev,
                                motion: {
                                  ...prev.motion,
                                  speed: {
                                    unit: "cps",
                                    value: Math.max(1, Number(e.target.value) || 1),
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
                      {canManualAdvance ? (
                        <p className="text-xs text-zinc-600">
                          Manual mode: click the viewport or press Space to advance.
                        </p>
                      ) : null}
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
