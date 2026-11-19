import type { ReactNode } from "react";
import type { Viewport } from "../types";

/** Single transform container: every child uses world coordinates. */
export function CanvasLayer({ viewport, children }: { viewport: Viewport; children: ReactNode }) {
    return (
        <div
            className="mf-layer"
            style={{
                transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`,
                // Ports keep a constant screen size: children multiply by this.
                ["--mf-port-scale" as string]: String(Math.min(Math.max(1 / viewport.k, 0.55), 1.8)),
            }}
        >
            {children}
        </div>
    );
}
