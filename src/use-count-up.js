import { useEffect, useRef, useState } from 'react';

// Eases a number from its previous value to the new one, so totals feel like they settle
// into place instead of snapping. Skipped entirely for people who ask for less motion.
export function useCountUp(target, duration = 620) {
  const to = Number(target) || 0;
  const [display, setDisplay] = useState(to);
  const shown = useRef(to);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = shown.current;
    // A background tab never gets animation frames, so settle immediately instead of
    // leaving the figure reading zero.
    if (reduce || document.hidden || from === to) {
      shown.current = to;
      setDisplay(to);
      return undefined;
    }

    let frame;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const value = from + (to - from) * eased;
      shown.current = value;
      setDisplay(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        shown.current = to;
        setDisplay(to);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, duration]);

  return display;
}
