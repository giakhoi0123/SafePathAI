"use client";
import { HTMLAttributes, PointerEvent } from "react";
export function LiquidGlassCard({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  function spotlight(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
  }
  return <div {...props} className={`liquid-glass specular-card ${className}`} onPointerMove={spotlight}>{children}</div>;
}
