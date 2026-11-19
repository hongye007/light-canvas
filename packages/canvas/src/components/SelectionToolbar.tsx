import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Copy, Trash2, Ungroup } from "lucide-react";
import { useCanvasStore } from "../store/canvas-store";
import { useCanvasContext } from "./context";
import { duplicateNodes, groupNodes, removeNodes, ungroupNodes, updateNode } from "../lib/document";
import { boundsOf } from "../lib/geometry";

type Align = "left" | "right" | "top" | "bottom" | "center-h" | "center-v";

/**
 * Batch toolbar for multi-selection.
 * Appears above the selection bounds; every action is a single undo entry.
 */
export function SelectionToolbar() {
    const { t } = useCanvasContext();
    const selection = useCanvasStore((state) => state.selection);
    const commit = useCanvasStore((state) => state.commit);
    const doc = useCanvasStore((state) => state.doc);

    const ids = [...selection];
    if (ids.length < 2) return null;
    const nodes = doc.nodes.filter((node) => selection.has(node.id) && node.type !== "group");
    if (nodes.length < 2) return null;
    const bounds = boundsOf(nodes);
    if (!bounds) return null;

    const align = (mode: Align) => {
        commit((prev) => {
            let next = prev;
            for (const node of nodes) {
                const dx =
                    mode === "left" ? bounds.x - node.position.x
                    : mode === "right" ? bounds.x + bounds.width - (node.position.x + node.width)
                    : mode === "center-h" ? bounds.x + bounds.width / 2 - (node.position.x + node.width / 2)
                    : 0;
                const dy =
                    mode === "top" ? bounds.y - node.position.y
                    : mode === "bottom" ? bounds.y + bounds.height - (node.position.y + node.height)
                    : mode === "center-v" ? bounds.y + bounds.height / 2 - (node.position.y + node.height / 2)
                    : 0;
                next = updateNode(next, node.id, { position: { x: Math.round(node.position.x + dx), y: Math.round(node.position.y + dy) } });
            }
            return next;
        });
    };

    const hasGroup = nodes.some((node) => node.groupId);

    return (
        <div className="mf-selection-toolbar" data-canvas-no-pan style={{ left: bounds.x + bounds.width / 2, top: bounds.y - 52 }} onPointerDown={(event) => event.stopPropagation()}>
            <span className="mf-selection-count">{ids.length}</span>
            <span className="mf-selection-sep" />
            <button type="button" className="mf-icon-btn" title={t("align.left")} onClick={() => align("left")}>
                <AlignStartVertical size={13} />
            </button>
            <button type="button" className="mf-icon-btn" title={t("align.centerH")} onClick={() => align("center-h")}>
                <AlignCenterVertical size={13} />
            </button>
            <button type="button" className="mf-icon-btn" title={t("align.right")} onClick={() => align("right")}>
                <AlignEndVertical size={13} />
            </button>
            <button type="button" className="mf-icon-btn" title={t("align.top")} onClick={() => align("top")}>
                <AlignStartHorizontal size={13} />
            </button>
            <button type="button" className="mf-icon-btn" title={t("align.centerV")} onClick={() => align("center-v")}>
                <AlignCenterHorizontal size={13} />
            </button>
            <button type="button" className="mf-icon-btn" title={t("align.bottom")} onClick={() => align("bottom")}>
                <AlignEndHorizontal size={13} />
            </button>
            <span className="mf-selection-sep" />
            <button type="button" className="mf-icon-btn" title={t("node.action.group")} onClick={() => commit((prev) => groupNodes(prev, ids).doc)}>
                <Copy size={13} />
            </button>
            {hasGroup && (
                <button
                    type="button"
                    className="mf-icon-btn"
                    title={t("node.action.ungroup")}
                    onClick={() => {
                        const group = doc.nodes.find((node) => node.type === "group" && nodes.some((item) => item.groupId === node.id));
                        if (group) commit((prev) => ungroupNodes(prev, group.id));
                    }}
                >
                    <Ungroup size={13} />
                </button>
            )}
            <button type="button" className="mf-icon-btn" title={t("node.action.duplicate")} onClick={() => commit((prev) => duplicateNodes(prev, ids))}>
                <Copy size={13} />
            </button>
            <button
                type="button"
                className="mf-icon-btn mf-danger"
                title={t("node.action.delete")}
                onClick={() => {
                    commit((prev) => removeNodes(prev, ids));
                    useCanvasStore.getState().clearSelection();
                }}
            >
                <Trash2 size={13} />
            </button>
        </div>
    );
}
