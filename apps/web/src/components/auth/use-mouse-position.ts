"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface MousePosition {
  x: number;
  y: number;
}

/**
 * Tracks mouse position relative to a container element.
 * Returns normalized coordinates (0-1) where (0.5, 0.5) is center.
 */
export function useMousePosition(containerRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<MousePosition>({ x: 0.5, y: 0.5 });
  const rafRef = useRef<number>(0);
  const latestPos = useRef<MousePosition>({ x: 0.5, y: 0.5 });

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      latestPos.current = {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          setPos({ ...latestPos.current });
          rafRef.current = 0;
        });
      }
    },
    [containerRef]
  );

  const handleMouseLeave = useCallback(() => {
    // Return to center when mouse leaves
    latestPos.current = { x: 0.5, y: 0.5 };
    setPos({ x: 0.5, y: 0.5 });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Listen on window so we track even outside the container
    window.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, handleMouseMove, handleMouseLeave]);

  return pos;
}
