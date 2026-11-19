import { useMemo } from "react";
import { useCanvasStore } from "../store/canvas-store";
import { edgeGeometry, nodeRect } from "../lib/geometry";
import { disconnect, getNode } from "../lib/document";

const EDGE_HIT_WIDTH = 18;

export function EdgeLayer({ referenceEdgeId, nodeStack }: { referenceEdgeId?: string | null; nodeStack: ReadonlyMap<string, number> }) {
    const doc = useCanvasStore((state) => state.doc);
    const selectedEdgeId = useCanvasStore((state) => state.selectedEdgeId);
    const selectEdge = useCanvasStore((state) => state.selectEdge);
    const commit = useCanvasStore((state) => state.commit);

    const paths = useMemo(() => {
        return doc.edges
            .map((edge) => {
                const from = getNode(doc, edge.from);
                const to = getNode(doc, edge.to);
                if (!from || !to) return null;
                return { edge, geometry: edgeGeometry(nodeRect(from), nodeRect(to), edge.fromPort ?? "right", edge.toPort ?? "left") };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
    }, [doc]);

    const highlighted = paths.find(({ edge }) => edge.id === referenceEdgeId);
    const ordered = highlighted ? [...paths.filter((item) => item !== highlighted), highlighted] : paths;

    const layers = new Map<number, typeof paths>();
    for (const path of ordered) {
        const stack = Math.min(nodeStack.get(path.edge.from) ?? 2, nodeStack.get(path.edge.to) ?? 2) - 1;
        const items = layers.get(stack);
        if (items) items.push(path);
        else layers.set(stack, [path]);
    }

    return [...layers].map(([stack, items]) => (
        <svg key={stack} className="mf-edges" style={{ zIndex: stack }}>
            {items.map(({ edge, geometry }) => {
                const active = edge.id === selectedEdgeId;
                return (
                    <g key={edge.id} data-edge-id={edge.id}>
                        <path
                            d={geometry.d}
                            className="mf-edge-hit"
                            strokeWidth={EDGE_HIT_WIDTH}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                selectEdge(edge.id);
                            }}
                        />
                        <path
                            d={geometry.d}
                            className={active || edge.id === referenceEdgeId ? "mf-edge mf-edge-active" : "mf-edge"}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                selectEdge(edge.id);
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                selectEdge(edge.id);
                            }}
                        />
                        {active && (
                            <circle
                                cx={(geometry.start.x + geometry.end.x) / 2}
                                cy={(geometry.start.y + geometry.end.y) / 2}
                                r={5}
                                className="mf-edge-dot"
                                onPointerDown={(event) => {
                                    event.stopPropagation();
                                    commit((prev) => disconnect(prev, edge.id));
                                }}
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    ));
}
