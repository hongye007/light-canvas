import type { CanvasNode, Vec } from "../types";
import { boundsOf, nodeRect } from "./geometry";

/** Distance from a point to a rect; 0 when inside. */
export function pointRectDistance(rect: { x: number; y: number; width: number; height: number }, point: Vec): number {
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
    const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
    return Math.hypot(dx, dy);
}

export type HitOptions = {
    /** Ignore these ids (the node a connection started from). */
    exclude?: Set<string>;
    /** Screen-space tolerance converted to world units by the caller. */
    tolerance?: number;
};

/**
 * Geometric hit testing for connections.
 *
 * DOM hit testing (elementsFromPoint) cannot be used here: the drag starts on the
 * source node's port, so the pointer is still over the source node and it always wins.
 */
export function hitTestNodes(nodes: CanvasNode[], point: Vec, options: HitOptions = {}): CanvasNode | null {
    const tolerance = options.tolerance ?? 24;
    const exclude = options.exclude ?? new Set<string>();
    let best: CanvasNode | null = null;
    let bestDistance = Infinity;

    // Iterate in reverse so visually-topmost nodes win ties.
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.type === "group" || exclude.has(node.id)) continue;
        const distance = pointRectDistance(nodeRect(node), point);
        if (distance > tolerance) continue;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = node;
        }
    }
    return best;
}

/** The topmost group whose bounds contain the entire dragged node. */
export function groupContainingNode(nodes: CanvasNode[], member: CanvasNode): CanvasNode | null {
    const inner = nodeRect(member);
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        if (node.type !== "group") continue;
        const outer = nodeRect(node);
        if (inner.x >= outer.x && inner.y >= outer.y &&
            inner.x + inner.width <= outer.x + outer.width &&
            inner.y + inner.height <= outer.y + outer.height) return node;
    }
    return null;
}

/** Bounding rect of a node set plus padding, used to frame a newly created group. */
export function wrapRect(nodes: CanvasNode[], padding = 32, topPadding = 64) {
    const bounds = boundsOf(nodes);
    if (!bounds) return null;
    return {
        x: bounds.x - padding,
        y: bounds.y - topPadding,
        width: bounds.width + padding * 2,
        height: bounds.height + topPadding + padding,
    };
}

export type AlignmentGuide = {
    orientation: "vertical" | "horizontal";
    /** World coordinate of the guide line. */
    at: number;
    /** World-space extent of the guide, for drawing a bounded line. */
    from: number;
    to: number;
};

export const SNAP_THRESHOLD = 6;

/**
 * Snap a moving rect to the edges and centers of other nodes.
 * Returns the adjusted position plus the guides to render.
 */
export function computeSnap(
    moving: { x: number; y: number; width: number; height: number },
    others: CanvasNode[],
    threshold = SNAP_THRESHOLD,
): { x: number; y: number; guides: AlignmentGuide[] } {
    const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
    const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

    let snapX: { delta: number; at: number } | null = null;
    let snapY: { delta: number; at: number } | null = null;

    for (const node of others) {
        if (node.type === "group") continue;
        const targetsX = [node.position.x, node.position.x + node.width / 2, node.position.x + node.width];
        const targetsY = [node.position.y, node.position.y + node.height / 2, node.position.y + node.height];

        for (const target of targetsX) {
            for (const current of movingX) {
                const delta = target - current;
                if (Math.abs(delta) <= threshold && (!snapX || Math.abs(delta) < Math.abs(snapX.delta))) {
                    snapX = { delta, at: target };
                }
            }
        }
        for (const target of targetsY) {
            for (const current of movingY) {
                const delta = target - current;
                if (Math.abs(delta) <= threshold && (!snapY || Math.abs(delta) < Math.abs(snapY.delta))) {
                    snapY = { delta, at: target };
                }
            }
        }
    }

    const guides: AlignmentGuide[] = [];
    const x = moving.x + (snapX?.delta ?? 0);
    const y = moving.y + (snapY?.delta ?? 0);

    if (snapX) {
        const others1 = others.filter((node) => node.type !== "group");
        const ys = others1.map((node) => node.position.y);
        const ye = others1.map((node) => node.position.y + node.height);
        guides.push({ orientation: "vertical", at: snapX.at, from: Math.min(y, ...ys) - 40, to: Math.max(y + moving.height, ...ye) + 40 });
    }
    if (snapY) {
        const others1 = others.filter((node) => node.type !== "group");
        const xs = others1.map((node) => node.position.x);
        const xe = others1.map((node) => node.position.x + node.width);
        guides.push({ orientation: "horizontal", at: snapY.at, from: Math.min(x, ...xs) - 40, to: Math.max(x + moving.width, ...xe) + 40 });
    }

    return { x, y, guides };
}
