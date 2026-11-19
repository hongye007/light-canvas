import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Boxes, FileText, Image as ImageIcon, Play, Trash2 } from "lucide-react";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";
import { removeNodes } from "../lib/document";

export function ContextMenu({
    x,
    y,
    nodeId,
    connectionOnly,
    onAdd,
    onClose,
}: {
    x: number;
    y: number;
    nodeId?: string;
    connectionOnly?: boolean;
    onAdd: (type: "text" | "image" | "video" | "group") => void;
    onClose: () => void;
}) {
    const { t } = useCanvasContext();
    const store = useCanvasStore();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) onClose();
        };
        window.addEventListener("mousedown", handler);
        return () => window.removeEventListener("mousedown", handler);
    }, [onClose]);

    const [position, setPosition] = useState({ left: x, top: y });
    useLayoutEffect(() => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        setPosition({
            left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
            top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
        });
    }, [x, y, nodeId, connectionOnly]);

    return (
        <div className="mf-menu" style={position} ref={ref} data-canvas-no-pan>
            <div className="mf-menu-title">{t("toolbar.addNode")}</div>
            <button type="button" className="mf-menu-item" onClick={() => onAdd("text")}>
                <FileText size={14} /> {t("node.text.label")}
            </button>
            <button type="button" className="mf-menu-item" onClick={() => onAdd("image")}>
                <ImageIcon size={14} /> {t("node.image.label")}
            </button>
            <button type="button" className="mf-menu-item" onClick={() => onAdd("video")}>
                <Play size={14} /> {t("node.video.label")}
            </button>
            {!connectionOnly && <button type="button" className="mf-menu-item" onClick={() => onAdd("group")}>
                <Boxes size={14} /> {t("node.group.label")}
            </button>}
            {nodeId && (
                <>
                    <div className="mf-menu-sep" />
                    <button
                        type="button"
                        className="mf-menu-item mf-danger"
                        onClick={() => {
                            store.commit((prev) => removeNodes(prev, [nodeId]));
                            onClose();
                        }}
                    >
                        <Trash2 size={14} /> {t("node.action.delete")}
                    </button>
                </>
            )}
        </div>
    );
}
