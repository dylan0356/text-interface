export type ConditionSpec = {
  version: "0.1";
  mode: "rsvp" | "paragraph";
  window: { width: number; height: number };
  tokenization: { unit: "char" | "word" | "chunk" | "sentence"; chunkSize: number };
  typography: {
    fontFamily: string;
    fontSizePx: number;
    lineHeight: number;
    lineWidthPx: number;
    letterSpacingPx: number;
    wordSpacingPx: number;
    variableAxes?: Record<string, number>;
  };
  motion: {
    autoplay: boolean;
    speed: { unit: "cps" | "pxps"; value: number };
    direction: "vertical" | "horizontal";
    progression: "continuous" | "step";
    pauseAtPunctuation: { enabled: boolean; delayMs: number };
  };
};

export const conditionSpec: ConditionSpec = {
  version: "0.1",
  mode: "rsvp",
  window: { width: 1280, height: 720 },
  tokenization: { unit: "word", chunkSize: 1 },
  typography: {
    fontFamily: "Geist",
    fontSizePx: 36,
    lineHeight: 1.4,
    lineWidthPx: 720,
    letterSpacingPx: 0,
    wordSpacingPx: 0,
    variableAxes: { wght: 450, wdth: 100, opsz: 36 },
  },
  motion: {
    autoplay: true,
    speed: { unit: "cps", value: 24 },
    direction: "horizontal",
    progression: "step",
    pauseAtPunctuation: { enabled: false, delayMs: 250 },
  },
};

export const conditionSpecJson = JSON.stringify(conditionSpec, null, 2);
