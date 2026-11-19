import { createId, type Asset, type CanvasDocument } from "@infranic/light-canvas";

const database = "maxflow-workspace";
const storeName = "uploaded-assets";

function openAssets(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(database, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

const changedEvent = "maxflow:local-assets-changed";
type RemoteImage = { url: string; name: string };
type StoredAsset = Blob | RemoteImage;

async function storeAsset(id: string, asset: StoredAsset) {
    const db = await openAssets();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(storeName, "readwrite");
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error ?? new Error("Could not save the uploaded file."));
            transaction.objectStore(storeName).put(asset, id);
        });
    } finally {
        db.close();
    }
    window.dispatchEvent(new Event(changedEvent));
}

export async function uploadLocalAsset(file: File): Promise<Asset> {
    const id = createId("asset");
    await storeAsset(id, file);
    return {
        id,
        kind: file.type.startsWith("video/") ? "video" : "image",
        url: URL.createObjectURL(file),
        localAssetId: id,
    };
}

export async function cacheGeneratedAsset(asset: Asset, signal?: AbortSignal): Promise<Asset> {
    if (asset.localAssetId) return asset;
    try {
        const timeout = AbortSignal.timeout(30_000);
        const response = await fetch(asset.url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (!response.ok) return asset;
        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith(`${asset.kind}/`)) return asset;
        await storeAsset(asset.id, blob);
        return {
            ...asset, localAssetId: asset.id, url: URL.createObjectURL(blob),
            remoteUrl: asset.remoteUrl ?? (/^https?:\/\//i.test(asset.url) ? asset.url : undefined),
        };
    } catch {
        // Some providers serve downloadable media only from their own origin.
        return asset;
    }
}

export type LibraryImage = { id: string; name: string; source: Blob | string };

export async function readLibraryImages(): Promise<LibraryImage[]> {
    const db = await openAssets();
    try {
        return await new Promise((resolve, reject) => {
            const images: LibraryImage[] = [];
            const request = db.transaction(storeName, "readonly").objectStore(storeName).openCursor();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const entry = request.result;
                if (!entry) { resolve(images); return; }
                const asset = entry.value as StoredAsset;
                const id = String(entry.key);
                if (asset instanceof Blob) {
                    if (asset.type.startsWith("image/")) images.push({ id, name: asset instanceof File ? asset.name : "", source: asset });
                } else if (asset?.url) images.push({ id, name: asset.name, source: asset.url });
                entry.continue();
            };
        });
    } finally {
        db.close();
    }
}

export function subscribeLibrary(listener: () => void) {
    window.addEventListener(changedEvent, listener);
    return () => window.removeEventListener(changedEvent, listener);
}

const archived = new Set<string>();

/** Keep generated and URL-backed images even when their nodes leave the canvas. */
export function archiveCanvasImages(doc: CanvasDocument) {
    for (const node of doc.nodes) {
        if (node.data.type !== "image") continue;
        for (const asset of [...node.data.assets, ...(node.data.generationHistory ?? []).flatMap((batch) => batch.assets)]) {
            if (asset.localAssetId || !asset.url || asset.url.startsWith("blob:") || archived.has(asset.id)) continue;
            archived.add(asset.id);
            void archiveImage(asset, node.title).catch(() => archived.delete(asset.id));
        }
    }
}

async function archiveImage(asset: Asset, name: string) {
    const db = await openAssets();
    try {
        const exists = await new Promise<boolean>((resolve, reject) => {
            const request = db.transaction(storeName, "readonly").objectStore(storeName).getKey(asset.id);
            request.onsuccess = () => resolve(request.result !== undefined);
            request.onerror = () => reject(request.error);
        });
        if (exists) return;
    } finally {
        db.close();
    }

    let stored: StoredAsset = { url: asset.url, name };
    try {
        const response = await fetch(asset.url);
        if (response.ok) {
            const blob = await response.blob();
            if (blob.type.startsWith("image/")) stored = new File([blob], name, { type: blob.type });
        }
    } catch {
        // Retain the image link if the provider disallows cross-origin downloads.
    }
    await storeAsset(asset.id, stored);
}

export async function restoreLocalAssets(doc: CanvasDocument): Promise<CanvasDocument> {
    const ids = new Set<string>();
    for (const { data } of doc.nodes) {
        if (data.type !== "image" && data.type !== "video") continue;
        for (const asset of [...data.assets, ...(data.generationHistory ?? []).flatMap((batch) => batch.assets)]) {
            if (asset.localAssetId || asset.kind === "image") ids.add(asset.localAssetId ?? asset.id);
        }
    }
    if (!ids.size) return doc;

    const urls = new Map<string, string>();
    const db = await openAssets();
    try {
        const store = db.transaction(storeName, "readonly").objectStore(storeName);
        const results = await Promise.all([...ids].map((id) => new Promise<[string, Blob | undefined]>((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve([id, request.result instanceof Blob ? request.result : undefined]);
            request.onerror = () => reject(request.error);
        })));
        for (const [id, blob] of results) {
            if (blob) urls.set(id, URL.createObjectURL(blob));
        }
    } finally {
        db.close();
    }
    return {
        ...doc,
        nodes: doc.nodes.map((node) => {
            const data = node.data;
            if (data.type !== "image" && data.type !== "video") return node;
            const restore = (asset: Asset): Asset => {
                const id = asset.localAssetId ?? asset.id;
                const url = urls.get(id);
                if (url) {
                    const remoteUrl = asset.remoteUrl ?? (/^https?:\/\//i.test(asset.url) ? asset.url : undefined);
                    return { ...asset, url, localAssetId: id, remoteUrl };
                }
                return asset.remoteUrl && asset.url.startsWith("blob:") ? { ...asset, url: asset.remoteUrl } : asset;
            };
            return { ...node, data: { ...data, assets: data.assets.map(restore),
                generationHistory: data.generationHistory?.map((batch) => ({ ...batch, assets: batch.assets.map(restore) })),
            } };
        }),
    };
}
