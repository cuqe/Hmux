// Motion tokens for the hmux mod (durations, easings and springs in one place).
// Components never write ms or easing literals: they ask this module by token name.
// GPUI only offers named easings, so easing.out maps to "ease-out", easing.in to "ease-in".

import { exec } from "herdr";

const TOKENS = {
  duration: { instant: 0, fast: 120, base: 200, moderate: 240, slow: 320, themeFade: 700 },
  easing: { out: "ease-out", in: "ease-in", inOut: "ease-in-out", linear: "linear" },
  // SwiftUI-style response = 2π / √(k/m), damping = ζ (see motion-tokens 4-2).
  spring: {
    snappy: { response: 237, damping: 0.945 },
    smooth: { response: 314, damping: 0.9 },
    gentle: { response: 424, damping: 0.944 },
  },
  loop: { spinner: 1000, pulse: 1600 },
  // Theme crossfade: wait for the window picture to load, then for the new theme to draw.
  fade: { imageLoad: 120, themeApply: 180 },
};

let reduced = false;

// macOS "Reduce motion". Absent key means off.
export async function detectReducedMotion() {
  try {
    const r = await exec("defaults", ["read", "com.apple.universalaccess", "reduceMotion"]);
    reduced = r.code === 0 && r.stdout.trim() === "1";
  } catch {
    reduced = false;
  }
  return reduced;
}

export const isReduced = () => reduced;

// Opacity-only changes keep 120 ms under reduced motion; everything else is instant.
export function transition(durationToken, easingToken = "out", { opacityOnly = false } = {}) {
  if (reduced) return { duration: opacityOnly ? TOKENS.duration.fast : 0, easing: TOKENS.easing.linear };
  return { duration: TOKENS.duration[durationToken], easing: TOKENS.easing[easingToken] };
}

// null under reduced motion: callers skip .spring() and jump to the final value.
export function spring(token = "smooth") {
  return reduced ? null : { ...TOKENS.spring[token] };
}

export const loopMs = (token) => TOKENS.loop[token];

// Raw duration for scheduling steps (timers), 0 under reduced motion.
export const durationMs = (token) => (reduced ? 0 : TOKENS.duration[token]);

// Theme crossfade timing (the fade itself is duration.themeFade, a deliberate change).
export const fadeDelay = (token) => TOKENS.fade[token];
export const fadeTotalMs = () => TOKENS.fade.imageLoad + TOKENS.fade.themeApply + TOKENS.duration.themeFade + 120;
