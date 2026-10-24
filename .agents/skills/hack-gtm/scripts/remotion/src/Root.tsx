import React from "react";
import { Composition, staticFile } from "remotion";
import { Showcase } from "./Showcase";
import type { Storyboard } from "./types";

// storyboard.json is copied into public/ by render.sh
import storyboardJson from "../public/storyboard.json";

const storyboard = storyboardJson as unknown as Storyboard;

// Showcase rounds each scene to whole frames, so the total is the sum of those, not the rounded sum.
const totalFrames = (sb: Storyboard) =>
  sb.scenes.reduce((a, s) => a + Math.round((s.seconds ?? 4) * sb.fps), 0);

export const Root: React.FC = () => (
  <>
    <Composition
      id="Showcase"
      component={Showcase}
      durationInFrames={totalFrames(storyboard)}
      fps={storyboard.fps}
      width={storyboard.width ?? 1920}
      height={storyboard.height ?? 1080}
      defaultProps={{ sb: storyboard, vertical: false, publicBase: staticFile("") }}
    />
    <Composition
      id="ShowcaseVertical"
      component={Showcase}
      durationInFrames={totalFrames(storyboard)}
      fps={storyboard.fps}
      width={1080}
      height={1920}
      defaultProps={{ sb: storyboard, vertical: true, publicBase: staticFile("") }}
    />
  </>
);
