export type Rect = { x: number; y: number; width: number; height: number } | number[] | null | undefined;

export type Scene = {
  id: string;
  kind: "title" | "card" | "step" | "demo" | "verdict" | "outro";
  act?: "pitch" | "build" | "proof" | "close";
  images?: string[];
  seconds: number;
  narration?: string;
  audio?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  mono?: boolean;
  image?: string | null;
  step?: number;
  label?: string;
  status?: string;
  url?: string | null;
  rect?: Rect;
  error?: string | null;
  hidden_steps?: number;
  totals?: { steps?: number; passed?: number; failed?: number; duration?: string };
  links?: string[];
  credits?: string;
};

export type Storyboard = {
  project: string;
  pitch: string;
  fps: number;
  width?: number;
  height?: number;
  captions?: boolean;
  brand: { accent: string; bg: string; credit: string };
  scenes: Scene[];
};
