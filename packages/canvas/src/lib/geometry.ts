import type { CanvasNode, PortSide, Rect, Vec, Viewport } from "../types";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 5;
export const GRID_SIZE = 48;
export const NODE_MIN_WIDTH = 160;
export const NODE_MIN_HEIGHT = 80;
const DEFAULT_NODE_SIZE = { width: 320, height: 220 };
export const BUILTIN_NODE_SIZES = {
    text: DEFAULT_NODE_SIZE,
    image: DEFAULT_NODE_SIZE,
    video: DEFAULT_NODE_SIZE,
};

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function screenToWorld(point: Vec, viewport: Viewport): Vec {
    return { x: (point.x - viewport.x) / viewport.k, y: (point.y - viewport.y) / viewport.k };
}

export function worldToScreen(point: Vec, viewport: Viewport): Vec {
    return { x: point.x * viewport.k + viewport.x, y: point.y * viewport.k + viewport.y };
}

/** Zoom around a screen-space anchor so the world point under it stays fixed. */
export function zoomAt(viewport: Viewport, anchor: Vec, factor: number): Viewport {
    const k = clamp(viewport.k * factor, MIN_SCALE, MAX_SCALE);
    if (k === viewport.k) return viewport;
    const world = screenToWorld(anchor, viewport);
    return { x: anchor.x - world.x * k, y: anchor.y - world.y * k, k };
}

export function nodeRect(node: CanvasNode): Rect {
    return { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
}

export function boundsOf(nodes: CanvasNode[]): Rect | null {
    if (!nodes.length) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of nodes) {
        left = Math.min(left, node.position.x);
        top = Math.min(top, node.position.y);
        right = Math.max(right, node.position.x + node.width);
        bottom = Math.max(bottom, node.position.y + node.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

export function normalizeRect(a: Vec, b: Vec): Rect {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function rectsIntersect(a: Rect, b: Rect) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Screen-space rect of the visible world area. */
export function visibleWorldRect(viewport: Viewport, size: { width: number; height: number }, pad = 400): Rect {
    const topLeft = screenToWorld({ x: -pad, y: -pad }, viewport);
    const bottomRight = screenToWorld({ x: size.width + pad, y: size.height + pad }, viewport);
    return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
}

export function fitViewport(rect: Rect, size: { width: number; height: number }, padding = 96, maxScale = 1): Viewport {
    const k = clamp(Math.min((size.width - padding * 2) / Math.max(rect.width, 1), (size.height - padding * 2) / Math.max(rect.height, 1)), MIN_SCALE, maxScale);
    return { x: size.width / 2 - (rect.x + rect.width / 2) * k, y: size.height / 2 - (rect.y + rect.height / 2) * k, k };
}

export function ratioValue(ratio: string): number {
    const [w, h] = ratio.split(":").map(Number);
    return w / h;
}

export function sizeForRatio(ratio: string, max: number): { width: number; height: number } {
    const value = ratioValue(ratio);
    return value >= 1 ? { width: max, height: Math.round(max / value) } : { width: Math.round(max * value), height: max };
}

type EdgeGeometry = { d: string; start: Vec; end: Vec };

export function edgeGeometry(from: Rect, to: Rect, fromPort: PortSide = "right", toPort: PortSide = "left"): EdgeGeometry {
    const start = portPosition(from, fromPort);
    const end = portPosition(to, toPort);
    return { d: portCurve(start, fromPort, end, toPort), start, end };
}

export function edgeGeometryToPoint(from: Rect, point: Vec): EdgeGeometry {
    const start = { x: from.x + from.width, y: from.y + from.height / 2 };
    const curve = Math.max(Math.abs(point.x - start.x) * 0.5, 48);
    return { d: `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${point.x - curve} ${point.y}, ${point.x} ${point.y}`, start, end: point };
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Resize a rect from a handle; keeps the opposite edge fixed. */
export const NODE_HEADER_HEIGHT = 30;

export function resizeRect(start: Rect, handle: ResizeHandle, delta: Vec, opts: { minWidth?: number; minHeight?: number; ratio?: number; insetHeight?: number; insetWidth?: number } = {}): Rect {
    const minWidth = opts.minWidth ?? NODE_MIN_WIDTH;
    const minHeight = opts.minHeight ?? NODE_MIN_HEIGHT;
    let { x, y, width, height } = start;

    if (opts.ratio) {
        const ratio = opts.ratio;
        const insetHeight = opts.insetHeight ?? 0;
        const insetWidth = opts.insetWidth ?? 0;
        const horizontal = handle.includes("e") || handle.includes("w");
        const vertical = handle.includes("n") || handle.includes("s");
        const dx = handle.includes("w") ? -delta.x : delta.x;
        const dy = handle.includes("n") ? -delta.y : delta.y;
        // Project the pointer onto the permitted drag direction.
        const change = horizontal && vertical ? (dx + dy / ratio) / (1 + 1 / (ratio * ratio)) : horizontal ? dx : dy * ratio;
        width = Math.max(minWidth, (minHeight - insetHeight) * ratio + insetWidth, start.width + change);
        height = (width - insetWidth) / ratio + insetHeight;
        if (handle.includes("w")) x += start.width - width;
        else if (!horizontal) x += (start.width - width) / 2;
        if (handle.includes("n")) y += start.height - height;
        else if (!vertical) y += (start.height - height) / 2;
        return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    }

    if (handle.includes("e")) width = Math.max(minWidth, start.width + delta.x);
    if (handle.includes("s")) height = Math.max(minHeight, start.height + delta.y);
    if (handle.includes("w")) {
        width = Math.max(minWidth, start.width - delta.x);
        x = start.x + (start.width - width);
    }
    if (handle.includes("n")) {
        height = Math.max(minHeight, start.height - delta.y);
        y = start.y + (start.height - height);
    }

    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------


export const PORT_SIDES: PortSide[] = ["left", "right", "top", "bottom"];

/** World position of a port on a node box. */
export function portPosition(rect: Rect, side: PortSide): Vec {
    switch (side) {
        case "left":
            return { x: rect.x, y: rect.y + rect.height / 2 };
        case "right":
            return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
        case "top":
            return { x: rect.x + rect.width / 2, y: rect.y };
        case "bottom":
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    }
}

/** Outward direction of a port, used to orient the bezier control points. */
export function portDirection(side: PortSide): Vec {
    switch (side) {
        case "left":
            return { x: -1, y: 0 };
        case "right":
            return { x: 1, y: 0 };
        case "top":
            return { x: 0, y: -1 };
        case "bottom":
            return { x: 0, y: 1 };
    }
}

/**
 * Bezier between two ports, curved along each port's outward direction.
 * A right-to-left pair produces the familiar horizontal S-curve; a top-to-left
 * pair curves out of the top and into the left side instead of cutting diagonally.
 */
export function portCurve(from: Vec, fromSide: PortSide, to: Vec, toSide: PortSide) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const strength = Math.min(Math.max(distance * 0.45, 40), 220);
    const d1 = portDirection(fromSide);
    const d2 = portDirection(toSide);
    const c1 = { x: from.x + d1.x * strength, y: from.y + d1.y * strength };
    const c2 = { x: to.x + d2.x * strength, y: to.y + d2.y * strength };
    return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}
