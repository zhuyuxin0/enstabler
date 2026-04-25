"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView } from "motion/react";

import { cn } from "@/lib/cn";

type Props = {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  prefix?: string;
};

// Animated counter that smoothly transitions to its target value.
// Re-animates whenever the value prop changes.
export function NumberTicker({
  value,
  decimals = 0,
  duration = 1.2,
  className,
  prefix,
}: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: false, margin: "-20%" });
  const [displayed, setDisplayed] = useState<number>(value);
  const fromRef = useRef<number>(value);

  useEffect(() => {
    if (!ref.current) return;
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplayed(to);
      return;
    }
    if (!inView) {
      setDisplayed(to);
      fromRef.current = to;
      return;
    }
    const controls = animate(from, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplayed(v),
      onComplete: () => {
        fromRef.current = to;
      },
    });
    return () => controls.stop();
  }, [value, duration, inView]);

  const formatted = displayed.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={cn("font-mono tabular-nums", className)}>
      {prefix}
      {formatted}
    </span>
  );
}
