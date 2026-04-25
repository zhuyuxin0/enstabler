"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

import { cn } from "@/lib/cn";

type Props = {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  yOffset?: number;
  blur?: number;
  className?: string;
  once?: boolean;
};

// Fade-in + slight upward shift + blur-to-clear entry. Used for hero copy and
// list-item entrance.
export function BlurFade({
  children,
  delay = 0,
  duration = 0.55,
  yOffset = 12,
  blur = 6,
  className,
  once = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once, margin: "-10%" });

  return (
    <motion.div
      ref={ref}
      className={cn(className)}
      initial={{ opacity: 0, y: yOffset, filter: `blur(${blur}px)` }}
      animate={
        inView
          ? { opacity: 1, y: 0, filter: "blur(0px)" }
          : { opacity: 0, y: yOffset, filter: `blur(${blur}px)` }
      }
      transition={{ delay, duration, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
