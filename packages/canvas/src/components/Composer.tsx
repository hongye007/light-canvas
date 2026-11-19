import { ChoiceSelect } from "./ChoiceSelect";
import { useMemo, useState } from "react";
import { Sparkles, Square } from "lucide-react";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";
import { cancelGeneration, generateForNode } from "../ai/use-node-runtime";
import type { AspectRatio, ModelInfo, Quality } from "../types";
import { getNode, isContentNode } from "../lib/document";

const RATIOS: AspectRatio[] = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
const QUALITIES: Quality[] = ["draft", "standard", "high"];

export function Composer({ onToast }: { onToast: (message: string, kind?: "info" | "error" | "success") => void }) {
    const { t, config } = useCanvasContext();
    const store = useCanvasStore();
    const selection = useCanvasStore((state) => state.selection);
    const runtime = useCanvasStore((state) => state.runtime);
    const [prompt, setPrompt] = useState("");
    const [ratio, setRatio] = useState<AspectRatio>(config.defaultRatio ?? "3:4");
    const [quality, setQuality] = useState<Quality>(config.defaultQuality ?? "standard");
    const [count, setCount] = useState(1);
    const [modelId, setModelId] = useState("");

    const targetId = useMemo(() => {
        for (const id of selection) {
            const node = getNode(store.doc, id);
            if (node && !isContentNode(node) && (node.type === "image" || node.type === "video")) return id;
        }
        return null;
    }, [selection, store.doc]);

    const target = targetId ? getNode(store.doc, targetId) : null;
    const running = targetId ? runtime[targetId]?.status === "running" : false;
    const isVideo = target?.type === "video";
    const models = target ? config.models.filter((item) => item.capabilities.some((capability) => capability === target.type)) : config.models;
    const defaultModel = target?.type === "image" || target?.type === "video" ? config.defaultModels?.[target.type] : undefined;
    const model = models.find((item) => item.id === modelId) ?? models.find((item) => item.id === defaultModel) ?? models[0];
    const ratios = model?.ratios ?? RATIOS;
    const selectedRatio = ratios.includes(ratio) ? ratio : ratios[0] ?? ratio;
    const counts = model?.counts ?? [1, 2, 4];
    const selectedCount = counts.includes(count) ? count : counts[0] ?? 1;

    const submit = async () => {
        if (!targetId || !target) {
            onToast(t("composer.noTarget"), "error");
            return;
        }
        if (!model) {
            onToast(t("error.noModel"), "error");
            return;
        }
        if (!prompt.trim()) return;
        void generateForNode({
            nodeId: targetId,
            producer: config.producer,
            model: model.id,
            prompt: prompt.trim(),
            params: { ratio: selectedRatio, quality, count: isVideo ? 1 : selectedCount },
        });
    };

    return (
        <div className="mf-composer" data-canvas-no-pan data-canvas-ignore-wheel>
            <div className="mf-composer-meta">
                <div className="mf-composer-target">{target ? t(`node.${target.type}.label`) : t("composer.noTarget")}</div>
                <div className="mf-composer-controls">
                    <ChoiceSelect label={t("composer.field.model")} value={model?.id ?? ""} onChange={setModelId} options={models.map((item: ModelInfo) => ({ value: item.id, label: item.label }))} />
                    <ChoiceSelect label={t("composer.field.ratio")} value={selectedRatio} onChange={(value) => setRatio(value as AspectRatio)} options={ratios.map((item: AspectRatio) => ({ value: item, label: item }))} />
                    {!isVideo && (
                        <>
                            <ChoiceSelect label={t("composer.field.quality")} value={quality} onChange={(value) => setQuality(value as Quality)} options={QUALITIES.map((item: Quality) => ({ value: item, label: t(`composer.quality.${item}`) }))} />
                            <ChoiceSelect label={t("composer.field.count")} value={String(selectedCount)} onChange={(value) => setCount(Number(value))} options={counts.map((item: number) => ({ value: String(item), label: `${item}` }))} />
                        </>
                    )}
                </div>
            </div>

            <div className="mf-composer-row">
                <textarea
                    className="mf-composer-input"
                    value={prompt}
                    placeholder={t("composer.placeholder")}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            void submit();
                        }
                    }}
                />
                <button
                    type="button"
                    className={running ? "mf-composer-submit mf-composer-stop" : "mf-composer-submit"}
                    onClick={() => {
                        if (running && targetId) {
                            cancelGeneration(targetId);
                            onToast(t("node.action.cancel"));
                            return;
                        }
                        void submit();
                    }}
                    disabled={!targetId}
                    title={running ? t("composer.cancelHint") : undefined}
                >
                    {running ? <Square size={14} /> : <Sparkles size={16} />}
                    <span>{running ? t("composer.stop") : t("composer.submit")}</span>
                </button>
            </div>
        </div>
    );
}
