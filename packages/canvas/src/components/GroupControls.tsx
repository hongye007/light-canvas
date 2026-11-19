import { Ungroup } from "lucide-react";
import { useState } from "react";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";
import { arrangeGroup, ungroupNodes } from "../lib/document";
import { ChoiceSelect } from "./ChoiceSelect";

const layouts = ["grid", "horizontal", "vertical"] as const;

export function GroupControls({ groupId, visible }: { groupId: string; visible: boolean }) {
    const { t } = useCanvasContext();
    const [layout, setLayout] = useState("");
    const hasMembers = useCanvasStore((state) => state.doc.nodes.some((member) => member.groupId === groupId));

    if (!visible) return null;
    return (
        <div className="mf-group-controls" data-canvas-no-pan onPointerDown={(event) => event.stopPropagation()}>
            {hasMembers && <ChoiceSelect label={t("group.layout")} value={layout}
                options={layouts.map((layout) => ({ value: layout, label: t(`group.layout.${layout}`) }))}
                onChange={(value) => {
                    setLayout(value);
                    useCanvasStore.getState().commit((prev) => arrangeGroup(prev, groupId, value as typeof layouts[number]));
                }} />}
            <button type="button" className="mf-icon-btn" title={t("group.ungroup")} aria-label={t("group.ungroup")}
                onClick={() => {
                    const store = useCanvasStore.getState();
                    store.commit((prev) => ungroupNodes(prev, groupId));
                    store.clearSelection();
                }}><Ungroup size={15} /></button>
        </div>
    );
}
