import { Download } from "lucide-react";
import { useState } from "react";
import type { Asset } from "../types";
import { useCanvasContext } from "./context";

const extensions: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "video/x-matroska": "mkv", "video/ogg": "ogv",
};

export function MediaDownload({ asset, title }: { asset: Asset; title: string }) {
    const { t, toast } = useCanvasContext();
    const [busy, setBusy] = useState(false);
    const label = t("node.action.download");

    async function download() {
        if (busy) return;
        setBusy(true);
        try {
            const response = await fetch(asset.url);
            if (!response.ok) throw new Error();
            const blob = await response.blob();
            const pathname = new URL(asset.remoteUrl || asset.url, document.baseURI).pathname;
            const suffix = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
            const extension = extensions[blob.type] ?? suffix ?? (asset.kind === "video" ? "mp4" : "png");
            const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || asset.kind;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = name.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? name : `${name}.${extension}`;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        } catch {
            toast(t("node.downloadFailed"), "error");
        } finally {
            setBusy(false);
        }
    }

    return <button type="button" className="mf-icon-btn mf-media-download" aria-label={label} title={label}
        disabled={busy} data-canvas-no-pan
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); void download(); }}>
        <Download size={14} aria-hidden />
    </button>;
}
