"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./number-field.module.css";

const { spring, blur } = motionTokens;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** One digit on the wheel. Its distance from the wheel position sets where it sits, how clear it is, and whether it shows. */
function Glyph({ position, digit }: { position: MotionValue<number>; digit: number }) {
  // Every style reads the wheel directly: a chained transform can update a frame late and leave the wheel blank on a jump.
  const offset = (current: number) => ((((digit - current) % 10) + 15) % 10) - 5;
  const y = useTransform(position, current => `${offset(current) * 1.05}em`);
  // An eased falloff keeps a turning digit legible through the middle of the roll instead of washing out.
  const opacity = useTransform(position, current => Math.max(0, 1 - Math.abs(offset(current)) ** 1.5 * 1.1));
  const visibility = useTransform(position, current => Math.abs(offset(current)) >= 1 ? "hidden" : "visible");
  const filter = useTransform(position, current => { const distance = Math.abs(offset(current)); return distance < .02 || distance >= 1 ? "none" : `blur(${(distance * blur.soft * .75).toFixed(2)}px)`; });
  return <motion.span className={styles.glyph} style={{ y, opacity, filter, visibility }}>{digit}</motion.span>;
}

/** An odometer wheel. It turns the way the whole number moved, wraps 9 → 0, and retargets mid spin when steps arrive quickly. */
export function DigitWheel({ digit, direction, instant }: { digit: number; direction: number; instant: boolean }) {
  const reduced = useReducedMotion();
  const position = useMotionValue(digit);
  const wheel = useRef({ digit, target: digit });
  useLayoutEffect(() => {
    const state = wheel.current;
    if (state.digit === digit) return;
    // Turn the way the number moved, unless that is more than half a turn; then take the short way, so a big clamp never spins.
    let delta = direction > 0 ? (digit - state.digit + 10) % 10 : -((state.digit - digit + 10) % 10);
    if (Math.abs(delta) > 5) delta -= Math.sign(delta) * 10;
    state.target += delta;
    state.digit = digit;
    if (instant || reduced) position.jump(state.target);
    else animate(position, state.target, spring.snappy);
  }, [digit, direction, instant, position, reduced]);
  return <><span className={styles.sizer}>0</span>{DIGITS.map(item => <Glyph key={item} position={position} digit={item} />)}</>;
}
