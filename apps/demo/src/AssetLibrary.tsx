import { useEffect, useState } from "react";
import { IMAGE_ASSET_DRAG_TYPE, type Asset, type CanvasLocale } from "@infranic/light-canvas";
import { readLibraryImages, subscribeLibrary, type LibraryImage } from "./local-assets";

function Thumbnail({ image, fallback, unavailable, onSelect }: { image: LibraryImage; fallback: string; unavailable: string; onSelect?: (asset: Asset) => void }) {
    const [url, setUrl] = useState(() => typeof image.source === "string" ? image.source : "");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (typeof image.source === "string") {
            setUrl(image.source);
            return;
        }
        const objectUrl = URL.createObjectURL(image.source);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [image.source]);
    const asset: Asset = { id: image.id, kind: "image", url, localAssetId: typeof image.source === "string" ? undefined : image.id };
    const content = failed ? <small>{unavailable}</small> : url && (
        <img src={url} draggable={false} alt={image.name || fallback} loading="lazy" onError={() => setFailed(true)} />
    );
    if (onSelect) return <button type="button" className="workspace-asset-tile" title={image.name || fallback}
        disabled={!url || failed} onClick={() => onSelect(asset)}>{content}</button>;
    return (
        <figure className="workspace-asset-tile" title={image.name || fallback} draggable={Boolean(url) && !failed}
            onDragStart={(event) => {
                if (!url || failed) return;
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(IMAGE_ASSET_DRAG_TYPE, JSON.stringify(asset));
            }}>
            {content}
        </figure>
    );
}

export function AssetLibrary({ lang, onSelect }: { lang: CanvasLocale["lang"]; onSelect?: (asset: Asset) => void }) {
    const zh = lang === "zh-CN";
    const [images, setImages] = useState<LibraryImage[] | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        let requestId = 0;
        const refresh = () => {
            const id = ++requestId;
            void readLibraryImages().then((next) => {
                if (active && id === requestId) {
                    setImages(next);
                    setFailed(false);
                }
            }).catch(() => {
                if (active && id === requestId) setFailed(true);
            });
        };
        const unsubscribe = subscribeLibrary(refresh);
        refresh();
        return () => { active = false; unsubscribe(); };
    }, []);

    if (failed) return <p className="workspace-asset-status" role="alert">{zh ? "无法读取本地资产库" : "Could not read the local library"}</p>;
    if (!images) return <p className="workspace-asset-status" role="status">{zh ? "正在读取图片…" : "Loading images…"}</p>;
    if (!images.length) return <p className="workspace-asset-status">{zh ? "还没有上传或生成的图片" : "No uploaded or generated images yet"}</p>;
    return (
        <div className="workspace-asset-grid">
            {images.map((image) => <Thumbnail key={image.id} image={image} fallback={zh ? "画布图片" : "Canvas image"} unavailable={zh ? "图片不可用" : "Image unavailable"} onSelect={onSelect} />)}
        </div>
    );
}
