import { useMemo, useRef } from "react";
import { useCanvasStore } from "../store/canvas-store";
import { boundsOf, screenToWorld } from "../lib/geometry";

const WIDTH = 220;
const HEIGHT = 148;
const PAD = 400;

/** Overview of the whole document with a draggable viewport rectangle. */
export function Minimap() {
    const doc = useCanvasStore((state) => state.doc);
    const setViewport = useCanvasStore((state) => state.setViewport);
    const ref = useRef<HTMLDivElement>(null);

    const layout = useMemo(() => {
        const bounds = boundsOf(doc.nodes);
        if (!bounds) {
            return { scale: 0.12, origin: { x: -WIDTH / 2, y: -HEIGHT / 2 }, world: { x: 0, y: 0 } };
        }
        const padded = { x: bounds.x - PAD, y: bounds.y - PAD, width: bounds.width + PAD * 2, height: bounds.height + PAD * 2 };
        const scale = Math.min(WIDTH / padded.width, HEIGHT / padded.height);
        return {
            scale,
            origin: { x: padded.x, y: padded.y },
            world: { x: WIDTH / 2 - (padded.x + padded.width / 2) * scale, y: HEIGHT / 2 - (padded.y + padded.height / 2) * scale },
        };
    }, [doc.nodes]);

    const viewport = doc.viewport;

    const jump = (event: React.PointerEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const worldX = (mx - layout.world.x) / layout.scale + layout.origin.x;
        const worldY = (my - layout.world.y) / layout.scale + layout.origin.y;
        const canvas = ref.current?.closest(".mf-canvas");
        const size = canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : { width: window.innerWidth, height: window.innerHeight };
        setViewport({ x: size.width / 2 - worldX * viewport.k, y: size.height / 2 - worldY * viewport.k, k: viewport.k });
    };

    const viewTopLeft = screenToWorld({ x: 0, y: 0 }, viewport);
    const canvas = ref.current?.closest(".mf-canvas");
    const canvasSize = canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : { width: 0, height: 0 };

    return (
        <div className="mf-minimap" ref={ref} data-canvas-no-pan data-canvas-ignore-wheel onPointerDown={(event) => {
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            jump(event);
        }} onPointerMove={(event) => {
            if (event.buttons === 1) jump(event);
        }}>
            {doc.nodes.map((node) => (
                <div
                    key={node.id}
                    className="mf-minimap-node"
                    data-type={node.type}
                    style={{
                        left: (node.position.x - layout.origin.x) * layout.scale + layout.world.x,
                        top: (node.position.y - layout.origin.y) * layout.scale + layout.world.y,
                        width: Math.max(2, node.width * layout.scale),
                        height: Math.max(2, node.height * layout.scale),
                    }}
                />
            ))}
            {canvasSize.width > 0 && (
                <div
                    className="mf-minimap-viewport"
                    style={{
                        left: (viewTopLeft.x - layout.origin.x) * layout.scale + layout.world.x,
                        top: (viewTopLeft.y - layout.origin.y) * layout.scale + layout.world.y,
                        width: (canvasSize.width / viewport.k) * layout.scale,
                        height: (canvasSize.height / viewport.k) * layout.scale,
                    }}
                />
            )}
        </div>
    );
}
