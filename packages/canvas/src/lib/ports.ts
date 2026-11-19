import type { CanvasNode, PortSide, Vec } from "../types";
import { nodeRect, PORT_SIDES, portPosition } from "./geometry";

export type PortHit = {
    nodeId: string;
    side: PortSide;
    point: Vec;
    /** Screen-independent distance in world units. */
    distance: number;
};

/** Ports that can start a connection. Only sides that are actually offered. */
export const SOURCE_SIDES: PortSide[] = ["right", "left"];
export const TARGET_SIDES: PortSide[] = ["left", "right"];

/**
 * Magnetism: find the nearest port of any eligible node within `radius`
 * (world units, caller converts from screen pixels).
 */
export function nearestPort(
    nodes: CanvasNode[],
    point: Vec,
    radius: number,
    options: { exclude: Set<string>; side: "source" | "target" },
): PortHit | null {
    const sides = options.side === "source" ? SOURCE_SIDES : TARGET_SIDES;
    let best: PortHit | null = null;

    for (const node of nodes) {
        if (node.type === "group" || options.exclude.has(node.id)) continue;
        const rect = nodeRect(node);
        for (const side of sides) {
            const position = portPosition(rect, side);
            const distance = Math.hypot(position.x - point.x, position.y - point.y);
            if (distance > radius) continue;
            if (!best || distance < best.distance) best = { nodeId: node.id, side, point: position, distance };
        }
    }
    return best;
}

export { PORT_SIDES, portPosition };

/**
 * Magnetism that targets whole nodes, not just the small port dots.
 *
 * Dropping anywhere over (or near) a target node connects to its nearest port in
 * the direction the line came from. Requiring the pointer to land on a 22px port
 * made connecting fail in practice: users release over the card body.
 */
export function nearestNodePort(
    nodes: CanvasNode[],
    point: Vec,
    tolerance: number,
    options: { exclude: Set<string>; incomingFrom: Vec },
): PortHit | null {
    let bestNode: CanvasNode | null = null;
    let bestDistance = Infinity;

    for (const node of nodes) {
        if (node.type === "group" || options.exclude.has(node.id)) continue;
        const rect = nodeRect(node);
        const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
        const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
        const distance = Math.hypot(dx, dy);
        if (distance > tolerance) continue;
        if (distance < bestDistance) {
            bestDistance = distance;
            bestNode = node;
        }
    }

    if (!bestNode) return null;

    // Pick the port facing the incoming line so the curve flows naturally.
    const rect = nodeRect(bestNode);
    const prefersLeft = options.incomingFrom.x < rect.x + rect.width / 2;
    const side: PortSide = prefersLeft ? "left" : "right";
    const fallback: PortSide = prefersLeft ? "right" : "left";
    const candidates: PortSide[] = [side, fallback];
    let best: PortHit | null = null;
    for (const candidate of candidates) {
        const position = portPosition(rect, candidate);
        const distance = Math.hypot(position.x - point.x, position.y - point.y);
        if (!best || distance < best.distance) best = { nodeId: bestNode.id, side: candidate, point: position, distance };
    }
    return best;
}
