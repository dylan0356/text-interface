"use client";

import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { conditionSpec, type ConditionSpec } from "@/lib/condition-spec";

type LogEntry = {
  event: "start" | "stop" | "tick" | "manual";
  index: number;
  timestamp: string;
};

type TokenizationUnit = ConditionSpec["tokenization"]["unit"];
type ReaderMode = ConditionSpec["mode"];
const RSVP_STEPS = [
  "letter-1",
  "letter-2",
  "letter-3",
  "word-1",
  "word-2",
  "word-3",
  "sentence",
  "page",
] as const;
const CONTINUOUS_STEPS = [...RSVP_STEPS] as const;
type ViewportStep = (typeof CONTINUOUS_STEPS)[number];
const MIN_SETTINGS_WIDTH = 280;
const MIN_VIEWPORT_WIDTH = 320;
const SPEED_MIN_CPS = 1;
const SPEED_MAX_CPS = 80;
const DEFAULT_TEXT_PATH = "/default-text.txt";
const VIEWPORT_STEP_LABELS: Record<ViewportStep, string> = {
  "letter-1": "1 letter",
  "letter-2": "2 letters",
  "letter-3": "3 letters",
  "word-1": "1 word",
  "word-2": "2 words",
  "word-3": "3 words",
  sentence: "sentence",
  page: "page",
};

function getViewportStepsForMode(mode: ReaderMode) {
  return mode === "continuous" ? CONTINUOUS_STEPS : RSVP_STEPS;
}

function getStepIndex(step: ViewportStep, mode: ReaderMode): number {
  return getViewportStepsForMode(mode).indexOf(step);
}

function getViewportTokenCount(step: ViewportStep): number {
  if (
    step === "letter-1" ||
    step === "word-1" ||
    step === "sentence" ||
    step === "page"
  ) {
    return 1;
  }
  if (step === "letter-2" || step === "word-2") {
    return 2;
  }
  return 3;
}

function getViewportStepFromTokenization(
  unit: TokenizationUnit,
  chunkSize: number,
): ViewportStep {
  const size = Math.max(1, Math.floor(chunkSize || 1));
  if (unit === "sentence") {
    return "sentence";
  }
  if (unit === "char") {
    if (size === 1) return "letter-1";
    if (size === 2) return "letter-2";
    return "letter-3";
  }
  if (size === 1) return "word-1";
  if (size === 2) return "word-2";
  return "word-3";
}

function getTokenizationFromViewportStep(step: ViewportStep): {
  unit: TokenizationUnit;
  chunkSize: number;
} {
  if (step === "letter-1") return { unit: "char", chunkSize: 1 };
  if (step === "letter-2") return { unit: "char", chunkSize: 2 };
  if (step === "letter-3") return { unit: "char", chunkSize: 3 };
  if (step === "word-1") return { unit: "word", chunkSize: 1 };
  if (step === "word-2") return { unit: "word", chunkSize: 2 };
  if (step === "word-3") return { unit: "word", chunkSize: 3 };
  if (step === "sentence") return { unit: "sentence", chunkSize: 1 };
  return { unit: "word", chunkSize: 20 };
}

function sanitizeSettingsName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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
  const safeStart =
    ((startIndex % tokens.length) + tokens.length) % tokens.length;
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
  const safeCharsPerSecond = Math.max(1, spec.motion.speed.value);
  const approxCharPx =
    spec.typography.fontSizePx * 0.62 + spec.typography.letterSpacingPx;
  return Math.max(10, safeCharsPerSecond * Math.max(1, approxCharPx));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  const safeStart =
    ((startIndex % tokens.length) + tokens.length) % tokens.length;
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

function formatTokenAsSentenceLines(value: string): string {
  if (!value.trim()) {
    return "";
  }
  return (value.match(/[^.!?]+[.!?]?/g) ?? [value])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .join("\n");
}

function RsvpRenderer({
  spec,
  token,
  viewportStep,
}: {
  spec: ConditionSpec;
  token: string;
  viewportStep: ViewportStep;
}) {
  const isSentenceOrPage =
    viewportStep === "sentence" || viewportStep === "page";
  const multilineToken = isSentenceOrPage
    ? formatTokenAsSentenceLines(token)
    : token;
  const { left, center, right } = splitAroundCenterCharacter(token);
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className={`w-full select-none ${isSentenceOrPage ? "" : "grid grid-cols-[1fr_auto_1fr] items-center"}`}
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
        {token ? (
          isSentenceOrPage ? (
            <div className="whitespace-pre-wrap text-left">
              {multilineToken}
            </div>
          ) : (
            <>
              <span className="justify-self-end whitespace-pre text-right">
                {left}
              </span>
              <span className="whitespace-pre">{center}</span>
              <span className="whitespace-pre">{right}</span>
            </>
          )
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
    if (!spec.motion.autoplay || spec.mode !== "continuous") {
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
  }, [pxPerSecond, spec.mode, spec.motion.autoplay]);

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
          className={
            direction === "vertical"
              ? "whitespace-pre text-center"
              : "whitespace-nowrap"
          }
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

function Viewport({
  spec,
  viewportStep,
  rsvpToken,
  continuousTokens,
  manualAdvanceEnabled,
  onManualAdvance,
  onViewportMouseMove,
  onViewportMouseLeave,
}: {
  spec: ConditionSpec;
  viewportStep: ViewportStep;
  rsvpToken: string;
  continuousTokens: string[];
  manualAdvanceEnabled: boolean;
  onManualAdvance: () => void;
  onViewportMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  onViewportMouseLeave: () => void;
}) {
  return (
    <div
      className={`h-full w-full overflow-hidden border border-zinc-300 select-none ${
        manualAdvanceEnabled ? "cursor-pointer" : ""
      }`}
      onClick={manualAdvanceEnabled ? onManualAdvance : undefined}
      onMouseMove={onViewportMouseMove}
      onMouseLeave={onViewportMouseLeave}
    >
      {spec.mode === "continuous" ? (
        <ContinuousRsvpRenderer
          key={`${spec.motion.direction}-${spec.motion.speed.value}-${continuousTokens.join("|")}`}
          spec={spec}
          tokens={continuousTokens}
        />
      ) : (
        <RsvpRenderer
          spec={spec}
          token={rsvpToken}
          viewportStep={viewportStep}
        />
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
  const [settingsName, setSettingsName] = useState("condition-spec");
  const [settingsModalError, setSettingsModalError] = useState("");
  const [text, setText] = useState("");
  const logsRef = useRef<LogEntry[]>([]);
  const rsvpIndexRef = useRef(0);
  const baseSpeedBeforeMouseRef = useRef<number | null>(null);
  const splitViewRef = useRef<HTMLDivElement | null>(null);
  const settingsFileInputRef = useRef<HTMLInputElement | null>(null);

  const appendLog = useCallback((entry: LogEntry) => {
    const next = [...logsRef.current, entry];
    logsRef.current = next.length > 200 ? next.slice(next.length - 200) : next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDefaultText = async () => {
      try {
        const response = await fetch(DEFAULT_TEXT_PATH);
        if (!response.ok) {
          return;
        }
        const loadedText = await response.text();
        if (!cancelled) {
          setText(loadedText);
        }
      } catch {
        // Ignore missing default text file and keep current content.
      }
    };

    void loadDefaultText();
    return () => {
      cancelled = true;
    };
  }, []);

  const rsvpChunkSize =
    spec.mode === "rsvp" && viewportStep === "page"
      ? Math.max(1, spec.tokenization.chunkSize)
      : 1;
  const rsvpTokens = useMemo(
    () => tokenizeText(text, spec.tokenization.unit, rsvpChunkSize),
    [rsvpChunkSize, spec.tokenization.unit, text],
  );
  const continuousTokens = useMemo(
    () =>
      tokenizeText(
        text,
        spec.tokenization.unit,
        Math.max(1, spec.tokenization.chunkSize),
      ),
    [text, spec.tokenization.chunkSize, spec.tokenization.unit],
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
    spec.mode === "rsvp" && !spec.motion.autoplay && rsvpTokens.length > 0;

  const handleViewportMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!spec.motion.rateControl.enabled) {
        return;
      }
      if (baseSpeedBeforeMouseRef.current == null) {
        baseSpeedBeforeMouseRef.current = spec.motion.speed.value;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }
      const yNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const mapped = 1 - yNorm;
      const nextCps = clamp(
        Math.round(SPEED_MIN_CPS + mapped * (SPEED_MAX_CPS - SPEED_MIN_CPS)),
        SPEED_MIN_CPS,
        SPEED_MAX_CPS,
      );
      setSpec((prev) => {
        if (prev.motion.speed.value === nextCps) {
          return prev;
        }
        return {
          ...prev,
          motion: {
            ...prev.motion,
            speed: { ...prev.motion.speed, unit: "cps", value: nextCps },
          },
        };
      });
    },
    [spec.motion.rateControl.enabled, spec.motion.speed.value],
  );

  const handleViewportMouseLeave = useCallback(() => {
    if (
      spec.motion.rateControl.resetOnLeave &&
      baseSpeedBeforeMouseRef.current != null
    ) {
      const fallbackSpeed = baseSpeedBeforeMouseRef.current;
      setSpec((prev) => ({
        ...prev,
        motion: {
          ...prev.motion,
          speed: {
            ...prev.motion.speed,
            unit: "cps",
            value: clamp(
              Math.round(fallbackSpeed),
              SPEED_MIN_CPS,
              SPEED_MAX_CPS,
            ),
          },
        },
      }));
    }
    baseSpeedBeforeMouseRef.current = null;
  }, [spec.motion.rateControl.resetOnLeave]);

  useEffect(() => {
    rsvpIndexRef.current = safeRsvpIndex;
  }, [safeRsvpIndex]);

  useEffect(() => {
    if (spec.motion.rateControl.enabled) {
      return;
    }
    baseSpeedBeforeMouseRef.current = null;
  }, [spec.motion.rateControl.enabled]);

  useEffect(() => {
    const allowedSteps = getViewportStepsForMode(spec.mode);
    if (allowedSteps.includes(viewportStep)) {
      return;
    }
    const fallbackStep: ViewportStep = "word-1";
    setViewportStep(fallbackStep);
    const tokenization = getTokenizationFromViewportStep(fallbackStep);
    setSpec((prev) => ({
      ...prev,
      tokenization: {
        ...prev.tokenization,
        unit: tokenization.unit,
        chunkSize: tokenization.chunkSize,
      },
    }));
  }, [spec.mode, viewportStep]);

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
        spec.mode === "rsvp"
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
    const tokenization = getTokenizationFromViewportStep(step);
    setSpec((prev) => ({
      ...prev,
      tokenization: {
        ...prev.tokenization,
        unit: tokenization.unit,
        chunkSize: tokenization.chunkSize,
      },
    }));
  }, []);

  const handleDownloadSettings = useCallback(() => {
    const safeName = sanitizeSettingsName(settingsName) || "condition-spec";
    const fileName = `${safeName}.json`;
    const blob = new Blob([JSON.stringify(spec, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [settingsName, spec]);

  const handleUploadSettingsFile = useCallback(async (file: File) => {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<ConditionSpec> & {
      motion?: Partial<ConditionSpec["motion"]> & {
        speed?: { unit?: string; value?: number };
        rateControl?: Partial<ConditionSpec["motion"]["rateControl"]>;
      };
    };

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.tokenization ||
      !parsed.motion ||
      !parsed.typography
    ) {
      throw new Error("Invalid settings JSON structure.");
    }

    const next = {
      ...conditionSpec,
      ...parsed,
      mode:
        parsed.mode === "rsvp" || parsed.mode === "continuous"
          ? parsed.mode
          : "continuous",
      tokenization: {
        ...conditionSpec.tokenization,
        ...parsed.tokenization,
      },
      typography: {
        ...conditionSpec.typography,
        ...parsed.typography,
      },
      motion: {
        ...conditionSpec.motion,
        ...parsed.motion,
        speed: {
          ...conditionSpec.motion.speed,
          ...parsed.motion?.speed,
          unit:
            parsed.motion?.speed?.unit === "wpm"
              ? "cps"
              : (parsed.motion?.speed?.unit ?? conditionSpec.motion.speed.unit),
          value:
            parsed.motion?.speed?.unit === "wpm"
              ? Math.max(
                  1,
                  Math.round((Number(parsed.motion?.speed?.value) || 0) / 12),
                )
              : Math.max(
                  1,
                  Number(parsed.motion?.speed?.value) ||
                    conditionSpec.motion.speed.value,
                ),
        },
        pauseAtPunctuation: {
          ...conditionSpec.motion.pauseAtPunctuation,
          ...parsed.motion?.pauseAtPunctuation,
        },
        rateControl: {
          ...conditionSpec.motion.rateControl,
          ...parsed.motion?.rateControl,
          source: "mouseY",
          invert: true,
          minCps: Math.max(
            1,
            Number(parsed.motion?.rateControl?.minCps) ||
              conditionSpec.motion.rateControl.minCps,
          ),
          maxCps: Math.max(
            1,
            Number(parsed.motion?.rateControl?.maxCps) ||
              conditionSpec.motion.rateControl.maxCps,
          ),
        },
      },
    } satisfies ConditionSpec;

    const normalizedMinCps = Math.max(
      1,
      Math.min(next.motion.rateControl.minCps, next.motion.rateControl.maxCps),
    );
    const normalizedMaxCps = Math.max(
      normalizedMinCps,
      next.motion.rateControl.maxCps,
    );
    setSpec({
      ...next,
      motion: {
        ...next.motion,
        rateControl: {
          ...next.motion.rateControl,
          minCps: normalizedMinCps,
          maxCps: normalizedMaxCps,
        },
      },
    });
    setViewportStep(
      getViewportStepFromTokenization(
        next.tokenization.unit,
        next.tokenization.chunkSize,
      ),
    );
    setSettingsModalError("");
  }, []);

  const handleSettingsFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      try {
        await handleUploadSettingsFile(file);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import JSON.";
        setSettingsModalError(message);
      } finally {
        event.target.value = "";
      }
    },
    [handleUploadSettingsFile],
  );

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
                viewportStep={viewportStep}
                rsvpToken={currentRsvpToken}
                continuousTokens={continuousTokens}
                manualAdvanceEnabled={canManualAdvance}
                onManualAdvance={() => advanceRsvp("manual")}
                onViewportMouseMove={handleViewportMouseMove}
                onViewportMouseLeave={handleViewportMouseLeave}
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

                  <label className="flex flex-col gap-1 text-sm">
                    Mode
                    <select
                      className="rounded border border-zinc-300 px-2 py-1"
                      value={spec.mode}
                      onChange={(e) =>
                        setSpec((prev) => ({
                          ...prev,
                          mode: e.target.value as ConditionSpec["mode"],
                        }))
                      }
                    >
                      <option value="rsvp">rsvp</option>
                      <option value="continuous">continuous</option>
                    </select>
                  </label>

                  <div className="space-y-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Viewport Step
                      <input
                        type="range"
                        min={0}
                        max={getViewportStepsForMode(spec.mode).length - 1}
                        step={1}
                        list="viewport-step-ticks"
                        value={getStepIndex(viewportStep, spec.mode)}
                        onChange={(e) =>
                          applyViewportStep(
                            getViewportStepsForMode(spec.mode)[
                              Number(e.target.value)
                            ] ?? "word-1",
                          )
                        }
                      />
                    </label>
                    <datalist id="viewport-step-ticks">
                      {getViewportStepsForMode(spec.mode).map((_, index) => (
                        <option key={index} value={index} />
                      ))}
                    </datalist>
                    <div
                      className="grid text-center text-xs text-zinc-500"
                      style={{
                        gridTemplateColumns: `repeat(${getViewportStepsForMode(spec.mode).length}, minmax(0, 1fr))`,
                      }}
                    >
                      {getViewportStepsForMode(spec.mode).map((step) => (
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

                  <section className="space-y-3 rounded border border-zinc-200 p-3 text-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                      Mouse Y Rate Control
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-2 pt-6">
                        <input
                          type="checkbox"
                          checked={spec.motion.rateControl.enabled}
                          onChange={(e) =>
                            setSpec((prev) => ({
                              ...prev,
                              motion: {
                                ...prev.motion,
                                rateControl: {
                                  ...prev.motion.rateControl,
                                  enabled: e.target.checked,
                                },
                              },
                            }))
                          }
                        />
                        Enable Mouse Y
                      </label>
                      <label className="flex items-center gap-2 pt-6">
                        <input
                          type="checkbox"
                          checked={spec.motion.rateControl.resetOnLeave}
                          disabled={!spec.motion.rateControl.enabled}
                          onChange={(e) =>
                            setSpec((prev) => ({
                              ...prev,
                              motion: {
                                ...prev.motion,
                                rateControl: {
                                  ...prev.motion.rateControl,
                                  resetOnLeave: e.target.checked,
                                },
                              },
                            }))
                          }
                        />
                        Reset on mouse leave
                      </label>
                    </div>
                  </section>

                  <label className="flex flex-col gap-1 text-sm">
                    Advance Step: {effectiveAdvanceStep}
                    <input
                      type="range"
                      min={1}
                      max={maxAdvanceStep}
                      step={1}
                      list="advance-step-ticks"
                      disabled={spec.mode !== "rsvp"}
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
                      {Array.from(
                        { length: maxAdvanceStep },
                        (_, i) => i + 1,
                      ).map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                    <span className="text-xs text-zinc-500">
                      Allowed range: 1-{maxAdvanceStep}
                    </span>
                  </label>

                  <div className="grid gap-4">
                    {spec.mode === "rsvp" ? (
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
                                      value: Math.max(
                                        1,
                                        Number(e.target.value) || 1,
                                      ),
                                    },
                                  },
                                }))
                              }
                            />
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
                            Punctuation Delay (ms):{" "}
                            {spec.motion.pauseAtPunctuation.delayMs}
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
                                      delayMs: Math.max(
                                        0,
                                        Number(e.target.value) || 0,
                                      ),
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
                            Manual mode: click the viewport or press Space to
                            advance.
                          </p>
                        ) : null}
                      </section>
                    ) : null}

                    {spec.mode === "continuous" ? (
                      <section className="space-y-3 rounded border border-zinc-200 p-3 text-sm">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                          Continuous
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
                                      value: Math.max(
                                        1,
                                        Number(e.target.value) || 1,
                                      ),
                                    },
                                  },
                                }))
                              }
                            />
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
                                    direction: e.target
                                      .value as ConditionSpec["motion"]["direction"],
                                  },
                                }))
                              }
                            >
                              <option value="horizontal">horizontal</option>
                              <option value="vertical">vertical</option>
                            </select>
                          </label>
                        </div>
                      </section>
                    ) : null}

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
                                lineWidthPx: Math.max(
                                  200,
                                  Number(e.target.value) || 200,
                                ),
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
            <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input
                  type="text"
                  className="rounded border border-zinc-300 px-2 py-1"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="self-end rounded border border-zinc-300 px-3 py-1 text-sm"
                onClick={handleDownloadSettings}
              >
                Download JSON
              </button>
              <button
                type="button"
                className="self-end rounded border border-zinc-300 px-3 py-1 text-sm"
                onClick={() => settingsFileInputRef.current?.click()}
              >
                Upload JSON
              </button>
              <input
                ref={settingsFileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleSettingsFileChange}
              />
            </div>
            {settingsModalError ? (
              <p className="mb-3 text-xs text-red-600">{settingsModalError}</p>
            ) : null}
            <pre className="max-h-[70vh] overflow-auto rounded border border-zinc-200 p-3 text-xs">
              {JSON.stringify(spec, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </main>
  );
}
