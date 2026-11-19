import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useCanvasStore } from "../store/canvas-store";
import { useCanvasContext } from "./context";
import { addNode, createMediaNode, createTextNode } from "../lib/document";
import { createId } from "../lib/id";
import type { CanvasNode, NodeDefinition, Vec } from "../types";

/** Cmd/Ctrl+K palette: jump to a node by title or content, or create one when nothing matches. */
export function NodeSearch({ onClose, inline = false }: { onClose: () => void; inline?: boolean }) {
    const { t, registry } = useCanvasContext();
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const doc = useCanvasStore((state) => state.doc);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        return doc.nodes
            .map((node) => {
                const label = node.title || t(registry.get(node.type)?.labelKey ?? `node.${node.type}.label`);
                const text =
                    node.data.type === "text" ? node.data.text : node.data.type === "image" || node.data.type === "video" ? node.data.prompt : "";
                const haystack = `${label} ${text}`.toLowerCase();
                const score = q ? (haystack.includes(q) ? (label.toLowerCase().startsWith(q) ? 2 : 1) : 0) : 1;
                return { node, label, text, score };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
    }, [doc.nodes, query, t, registry]);

    const jump = (node: CanvasNode) => {
        const canvas = document.querySelector(".mf-canvas");
        const size = { width: canvas?.clientWidth ?? 1200, height: canvas?.clientHeight ?? 800 };
        const { doc: current, setViewport: apply } = useCanvasStore.getState();
        const k = current.viewport.k;
        apply({ x: size.width / 2 - (node.position.x + node.width / 2) * k, y: size.height / 2 - (node.position.y + node.height / 2) * k, k });
        useCanvasStore.getState().select([node.id]);
        onClose();
    };

    const create = (definition: NodeDefinition) => {
        const { type } = definition;
        const viewport = useCanvasStore.getState().doc.viewport;
        const canvas = document.querySelector(".mf-canvas");
        const size = { width: canvas?.clientWidth ?? 1200, height: canvas?.clientHeight ?? 800 };
        const center: Vec = { x: (size.width / 2 - viewport.x) / viewport.k - 160, y: (size.height / 2 - viewport.y) / viewport.k - 120 };
        const node: CanvasNode = type === "text" ? createTextNode(center)
            : type === "image" || type === "video" ? createMediaNode(type, center)
            : { id: createId("node"), type, title: "", position: center, ...definition.defaultSize,
                aspectLocked: definition.aspectLocked, data: definition.createData() };
        useCanvasStore.getState().commit((prev) => addNode(prev, node));
        useCanvasStore.getState().select([node.id]);
        onClose();
    };

    const definitions = registry.list().filter((definition) => definition.type !== "group");
    const matching = definitions.filter((definition) => t(definition.labelKey).toLowerCase().includes(query.trim().toLowerCase()));
    const creatable = matching.length ? matching : definitions;

    const content = (
            <div className={inline ? "mf-node-drawer-list" : "mf-palette"} onPointerDown={(event) => event.stopPropagation()}>
                <div className="mf-palette-input">
                    <Search size={14} />
                    <input
                        ref={inputRef}
                        autoFocus
                        value={query}
                        placeholder={t("search.placeholder")}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") onClose();
                            if (event.key === "Enter") {
                                if (results[0]) jump(results[0].node);
                                else if (creatable[0]) create(creatable[0]);
                            }
                        }}
                    />
                </div>
                <div className="mf-palette-list">
                    {results.map((item) => (
                        <button key={item.node.id} type="button" className="mf-palette-item" onClick={() => jump(item.node)}>
                            <span className="mf-palette-label">{item.label}</span>
                            {item.text && <span className="mf-palette-text">{item.text.slice(0, 48)}</span>}
                        </button>
                    ))}
                    {!results.length && (
                        <div className="mf-palette-empty">
                            {creatable.map((definition) => (
                                <button key={definition.type} type="button" className="mf-palette-item" onClick={() => create(definition)}>
                                    {t(definition.labelKey)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
    );

    return inline ? content : <div className="mf-palette-backdrop" data-canvas-no-pan onPointerDown={onClose}>{content}</div>;
}
