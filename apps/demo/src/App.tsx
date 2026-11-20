import { Github } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LightCanvas, createMockProducer, parseDocument, type CanvasDocument } from "@infranic/light-canvas";
import { createHttpProducer, readBackendConfig, MOCK_MODELS } from "./backend";
import { AssetLibrary } from "./AssetLibrary";
import { archiveCanvasImages, cacheGeneratedAsset, restoreLocalAssets, uploadLocalAsset } from "./local-assets";
import { buildDemoDocument } from "./seed";
import "./demo.css";

/**
 * Demo host.
 *
 * Everything the canvas needs is injected here: models, producer, theme, locale.
 * In a real project only this file changes — the canvas package stays untouched.
 */

export function App() {
    const [backend, setBackend] = useState<Awaited<ReturnType<typeof readBackendConfig>>>();
    useEffect(() => {
        const controller = new AbortController();
        void readBackendConfig(controller.signal).then(setBackend).catch(() => {
            if (!controller.signal.aborted) setBackend(null);
        });
        return () => controller.abort();
    }, []);
    const [doc, setDoc] = useState<CanvasDocument | null>(null);
    useEffect(() => {
        let active = true;
        const readCanvas = async () => {
            let restored: CanvasDocument;
            try {
                const saved = localStorage.getItem("maxflow:demo-doc");
                restored = saved ? parseDocument(JSON.parse(saved)) : buildDemoDocument(window.innerWidth < 640);
            } catch {
                restored = buildDemoDocument(window.innerWidth < 640);
            }
            try {
                restored = await restoreLocalAssets(restored);
            } catch {
                // Keep the canvas available if the local asset store cannot be opened.
            }
            if (active) setDoc(restored);
        };
        void readCanvas();
        return () => { active = false; };
    }, []);
    const producer = useMemo(() => {
        const upstream = backend?.descriptors.length ? createHttpProducer() : createMockProducer();
        return {
            ...upstream,
            generate: async (request: Parameters<typeof upstream.generate>[0]) => {
                const result = await upstream.generate(request);
                const assets = await Promise.all(result.assets.map((asset) => cacheGeneratedAsset(asset, request.signal)));
                return { ...result, assets };
            },
            upload: uploadLocalAsset,
        };
    }, [backend]);

    useEffect(() => {
        if (!doc) return;
        const save = () => {
            try {
                localStorage.setItem("maxflow:demo-doc", JSON.stringify(doc));
            } catch {
                // The current canvas still works when browser storage is full.
            }
        };
        const timer = window.setTimeout(save, 400);
        window.addEventListener("pagehide", save);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("pagehide", save);
        };
    }, [doc]);

    const config = useMemo(
        () => ({
            producer,
            models: backend?.descriptors.length ? backend.descriptors : MOCK_MODELS,
            renderAssetLibrary: (lang: "zh-CN" | "en-US", onSelect?: Parameters<typeof AssetLibrary>[0]["onSelect"]) => <AssetLibrary lang={lang} onSelect={onSelect} />,
            renderRailFooter: (lang: "zh-CN" | "en-US") => {
                const label = lang === "zh-CN" ? "在 GitHub 上查看 Light Canvas" : "View Light Canvas on GitHub";
                return <a className="mf-rail-btn" href="https://github.com/hongye007/light-canvas"
                    target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
                    <Github size={17} aria-hidden />
                </a>;
            },
            renderSettings: (lang: "zh-CN" | "en-US") => {
                const chinese = lang === "zh-CN";
                const models = backend?.descriptors.length ? backend.descriptors : MOCK_MODELS;
                return <div className="workspace-demo-settings">
                    <p>{backend?.descriptors.length
                        ? (chinese ? "生成请求由服务端处理。" : "Generation requests run on the backend.")
                        : (chinese ? "当前使用模拟生成，可直接体验画布。" : "This demo uses mock generation.")}</p>
                    <h3>{chinese ? "可用模型" : "Available models"}</h3>
                    <ul>{models.map(model => <li key={model.id}>{model.label}</li>)}</ul>
                </div>;
            },
            defaultRatio: "3:4" as const,
            defaultQuality: "standard" as const,
            restoreImportedAssets: restoreLocalAssets,
            onDocumentChange: (next: CanvasDocument) => {
                setDoc(next);
                archiveCanvasImages(next);
            },
        }),
        [producer, backend],
    );

    if (!doc || backend === undefined) return null;

    return (
        <LightCanvas
            key={doc.id}
            config={config}
            profile="full"
            initialDocument={doc}
        />
    );
}
