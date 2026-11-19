const mentionPattern = /@\[([^\]\n]+)\]\(([^)\n]+)\)/g;

type Preview = { label: string; kind: string; thumbnail?: string };

const iconPaths: Record<string, string> = {
    text: "M6 3h8l4 4v14H6z M9 11h6 M9 15h6",
    image: "M3 4h18v16H3z M3 17l5-5 4 4 4-5 5 5 M8 8h.01",
    video: "M7 4l13 8-13 8z",
};

export function promptText(root: Node): string {
    if (root instanceof Text) return root.data.replace(/\u00a0/g, " ");
    if (root instanceof HTMLElement && root.dataset.mention) return root.dataset.mention;
    if (root instanceof HTMLBRElement) return root.nextSibling ? "\n" : "";
    let value = "";
    for (const child of root.childNodes) {
        if (child instanceof HTMLDivElement && child.previousSibling) value += "\n";
        value += promptText(child);
    }
    return value;
}

export function promptSelection(editor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.setStart(editor, 0);
    return promptText(range.cloneContents());
}

export function mentionChip(token: string, preview: Preview) {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.className = "mf-prompt-mention";
    chip.dataset.mention = token;
    updateMentionChip(chip, preview);
    return chip;
}

function updateMentionChip(chip: HTMLElement, { label, kind, thumbnail }: Preview) {
    if (chip.dataset.preview === JSON.stringify([label, kind, thumbnail])) {
        const image = chip.querySelector("img");
        if (image) {
            if (image.complete && image.naturalWidth === 0) image.remove();
            else image.onerror = () => image.remove();
        }
        return;
    }
    chip.dataset.preview = JSON.stringify([label, kind, thumbnail]);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(icon.namespaceURI, "path");
    path.setAttribute("d", iconPaths[kind] ?? iconPaths.text);
    icon.append(path);
    const name = document.createElement("span");
    name.textContent = label;
    chip.replaceChildren(icon, name);
    if (thumbnail) {
        const image = new Image();
        image.alt = "";
        image.draggable = false;
        image.onerror = () => image.remove();
        image.src = thumbnail;
        chip.prepend(image);
    }
}

export function syncPromptEditor(editor: HTMLElement, prompt: string, getPreview: (label: string, id: string) => Preview) {
    if (promptText(editor) === prompt) {
        for (const chip of editor.querySelectorAll<HTMLElement>("[data-mention]")) {
            const match = [...(chip.dataset.mention ?? "").matchAll(mentionPattern)][0];
            if (match) updateMentionChip(chip, getPreview(match[1], match[2]));
        }
        return;
    }
    const contents = document.createDocumentFragment();
    let start = 0;
    for (const match of prompt.matchAll(mentionPattern)) {
        contents.append(prompt.slice(start, match.index), mentionChip(match[0], getPreview(match[1], match[2])));
        start = match.index + match[0].length;
    }
    contents.append(prompt.slice(start));
    editor.replaceChildren(contents);
}

function promptBoundary(editor: HTMLElement, offset: number) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.closest("[data-mention]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const prefix = document.createRange();
    prefix.selectNodeContents(editor);
    while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        prefix.setEnd(text, 0);
        const length = promptText(prefix.cloneContents()).length;
        if (offset >= length && offset <= length + text.length) return { text, offset: offset - length };
    }
    return null;
}

export function promptMentionRect(editor: HTMLElement, start: number) {
    const end = promptBoundary(editor, start + 1);
    if (!end || end.text.data[end.offset - 1] !== "@") return null;
    const range = document.createRange();
    range.setStart(end.text, end.offset - 1);
    range.setEnd(end.text, end.offset);
    return range.getBoundingClientRect();
}

export function replacePromptMention(editor: HTMLElement, start: number, end: number, chip: HTMLElement) {
    const range = document.createRange();
    const from = promptBoundary(editor, start);
    const to = promptBoundary(editor, end);
    if (!from || !to) return false;
    editor.focus({ preventScroll: true });
    range.setStart(from.text, from.offset);
    range.setEnd(to.text, to.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    chip.dataset.insertedMention = "";
    document.execCommand("insertHTML", false, chip.outerHTML + "&nbsp;");
    const inserted = editor.querySelector<HTMLElement>("[data-inserted-mention]");
    if (inserted) {
        inserted.removeAttribute("data-inserted-mention");
        const next = inserted.nextSibling;
        if (next instanceof Text && /^[ \u00a0]/.test(next.data)) selection?.collapse(next, 1);
        else selection?.collapse(inserted.parentNode, Array.from(inserted.parentNode!.childNodes).indexOf(inserted) + 1);
    }
    return Boolean(inserted);
}
