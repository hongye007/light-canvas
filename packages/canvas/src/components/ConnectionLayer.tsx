import type { NodeRegistry } from "../lib/registry";
import { useConnectDraft, type ConnectDraft } from "../store/connect-store";
import { useConnectStore } from "../store/connect-store";
import { useCanvasStore } from "../store/canvas-store";
import { connect, remainingReferenceSlots } from "../lib/document";
import { nodeRect, portCurve, portPosition, PORT_SIDES } from "../lib/geometry";
import { nearestNodePort } from "../lib/ports";
import type { PortSide } from "../types";

/** Screen-space distance from a node that still counts as "over it". */
const MAGNET_TOLERANCE_PX = 56;

/**
 * World-space layer that draws the in-flight connection.
 * Inside the world transform container, so path coordinates need no conversion.
 */
export type ConnectionDrop = { x: number; y: number; draft: ConnectDraft; targetPort: PortSide };

export function ConnectionLayer({ pending }: { pending?: ConnectDraft }) {
    const active = useConnectDraft();
    const draft = active ?? pending;
    if (!draft) return null;

    const { start, point, sourcePort, targetPort, magnetized } = draft;
    const d = portCurve(start, sourcePort, point, targetPort ?? oppositeOf(sourcePort));
    const color = magnetized ? "var(--mf-accent)" : "var(--mf-textMuted)";

    return (
        <svg className="mf-connect-layer" aria-hidden>
            <path d={d} className={magnetized ? "mf-connect-path mf-connect-path-snap" : "mf-connect-path"} />
            <circle cx={point.x} cy={point.y} r={magnetized ? 6 : 3.5} className={magnetized ? "mf-connect-dot mf-connect-dot-snap" : "mf-connect-dot"} style={{ stroke: color }} />
        </svg>
    );
}

function oppositeOf(side: PortSide): PortSide {
    if (side === "left") return "right";
    if (side === "right") return "left";
    if (side === "top") return "bottom";
    return "top";
}

function toWorld(clientX: number, clientY: number) {
    const rect = document.querySelector(".mf-canvas")?.getBoundingClientRect();
    const viewport = useCanvasStore.getState().doc.viewport;
    return {
        x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.k,
        y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.k,
    };
}

/**
 * Resolves the magnet target for a pointer position.
 * Magnetism works on the whole canvas: the nearest free port within a fixed
 * screen distance wins, so the user does not have to hit a 22px dot.
 */
export function resolveMagnet(sourceId: string, point: { x: number; y: number }, registry?: NodeRegistry) {
    const { doc } = useCanvasStore.getState();
    const zoom = doc.viewport.k;
    const source = doc.nodes.find((node) => node.id === sourceId);
    const incomingFrom = source ? { x: source.position.x + source.width, y: source.position.y + source.height / 2 } : point;
    // The whole target node is magnetic; the port is then chosen to match the approach.
    const candidates = doc.nodes.filter((node) => registry?.get(node.type)?.capabilities.canConnect !== false && remainingReferenceSlots(doc, node) > 0);
    return nearestNodePort(candidates, point, MAGNET_TOLERANCE_PX / Math.max(zoom, 0.2), {
        exclude: new Set([sourceId]),
        incomingFrom,
    });
}

/** Camera-agnostic: starts a magnetic connection drag from one port. */
export function beginConnection(sourceNodeId: string, side: PortSide, event: React.PointerEvent | React.MouseEvent, registry?: NodeRegistry, onEmptyDrop?: (drop: ConnectionDrop) => void) {
    event.preventDefault();
    event.stopPropagation();

    const source = useCanvasStore.getState().doc.nodes.find((node) => node.id === sourceNodeId);
    if (!source) return;

    const origin = { x: event.clientX, y: event.clientY };
    const start = portPosition(nodeRect(source), side);
    const pointer = toWorld(event.clientX, event.clientY);
    const initialHit = resolveMagnet(sourceNodeId, pointer, registry);
    const store = useConnectStore.getState();
    store.begin({
        sourceId: sourceNodeId,
        sourcePort: side,
        start,
        point: initialHit ? initialHit.point : pointer,
        targetId: initialHit?.nodeId ?? null,
        targetPort: initialHit?.side ?? null,
        magnetized: Boolean(initialHit),
    });

    const move = (moveEvent: PointerEvent) => {
        const raw = toWorld(moveEvent.clientX, moveEvent.clientY);
        const hit = resolveMagnet(sourceNodeId, raw, registry);
        useConnectStore.getState().update({
            point: hit ? hit.point : raw,
            targetId: hit?.nodeId ?? null,
            targetPort: hit?.side ?? null,
            magnetized: Boolean(hit),
        });
    };

    const finish = (event: PointerEvent) => {
        const draft = useConnectStore.getState().end();
        cleanup();
        if (!draft || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) return;
        const point = toWorld(event.clientX, event.clientY);
        const hit = resolveMagnet(sourceNodeId, point, registry);
        if (hit) {
            useCanvasStore.getState().commit((prev) => connect(prev, draft.sourceId, hit.nodeId, draft.sourcePort, hit.side));
            return;
        }
        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (!element?.closest(".mf-canvas") || element.closest("[data-canvas-no-pan], [data-node-id]:not([data-group])")) return;
        onEmptyDrop?.({
            x: event.clientX, y: event.clientY,
            draft: { ...draft, point, targetId: null, targetPort: null, magnetized: false },
            targetPort: oppositeOf(side),
        });
    };

    const cancel = () => {
        useConnectStore.getState().end();
        cleanup();
    };

    const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", onKey);
    };

    const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") cancel();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey);
}

export { PORT_SIDES };
