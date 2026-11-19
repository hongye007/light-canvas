import type { Reference } from "../types";

export function removeReferenceMentions(prompt: string, shouldRemove: (encodedId: string) => boolean) {
    return prompt.replace(/@\[([^\]\n]+)\]\(([^)\n]+)\) ?/g, (token, _label: string, encodedId: string) =>
        shouldRemove(encodedId) ? "" : token);
}

export function resolveReferenceMentions(prompt: string, references: Reference[]) {
    return prompt.replace(/@\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_token, label: string, encodedId: string) => {
        const index = references.findIndex((ref) => encodeURIComponent(ref.nodeId) === encodedId);
        if (index < 0) throw new Error(`Referenced node “${label}” is disconnected or empty.`);
        return `Reference ${index + 1}`;
    });
}

export function promptWithImageReferences(prompt: string, references: Reference[], pictureTag: boolean) {
    return prompt.replace(/\bReference (\d+)\b/g, (label, number: string) => {
        const index = Number(number) - 1;
        if (references[index]?.kind !== "image") return label;
        const ordinal = references.slice(0, index + 1).filter((ref) => ref.kind === "image").length;
        return pictureTag ? `<Picture ${ordinal}>` : `Image ${ordinal}`;
    });
}
