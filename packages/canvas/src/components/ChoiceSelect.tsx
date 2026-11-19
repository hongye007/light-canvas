import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Choice = { value: string; label: string };

export function ChoiceSelect({ value, onChange, options, label }: {
    value: string;
    onChange: (value: string) => void;
    options: Choice[];
    label: string;
}) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [position, setPosition] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number }>();
    const trigger = useRef<HTMLButtonElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const id = useId();
    const selectedIndex = options.findIndex((item) => item.value === value);
    const selected = options[selectedIndex] ?? options[0];
    const portalHost = open ? trigger.current?.closest("dialog, .mf-root") ?? document.body : null;

    function close(restoreFocus = false) {
        setOpen(false);
        if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    }

    function openMenu() {
        if (options.length < 2) return;
        setActiveIndex(Math.max(0, selectedIndex));
        setOpen(true);
    }

    function choose(option: Choice) {
        if (option.value !== value) onChange(option.value);
        close(true);
    }

    useLayoutEffect(() => {
        if (!open || options.length < 2) return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (!rect) return;
            const gap = 6;
            const margin = 8;
            const labelWidth = Math.max(...options.map((option) =>
                [...option.label].reduce((size, character) => size + (character.codePointAt(0)! > 255 ? 12 : 7), 0),
            ));
            const width = Math.min(window.innerWidth - 2 * margin, Math.max(rect.width, 112, labelWidth + 44));
            const below = window.innerHeight - rect.bottom - gap - margin;
            const above = rect.top - gap - margin;
            const contentHeight = Math.min(236, options.length * 32 + 10);
            const upwards = below < contentHeight && above > below;
            setPosition({
                left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
                width,
                maxHeight: Math.min(236, Math.max(34, upwards ? above : below)),
                ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
            });
        };
        const pointer = (event: PointerEvent) => {
            if (event.target instanceof Node && !list.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
        };
        const scroll = (event: Event) => {
            if (event.target instanceof Node && list.current?.contains(event.target)) return;
            place();
        };
        place();
        document.addEventListener("pointerdown", pointer);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", scroll, true);
        return () => {
            document.removeEventListener("pointerdown", pointer);
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", scroll, true);
        };
    }, [open, options.length]);

    const positioned = Boolean(position);
    useEffect(() => {
        if (open && positioned) list.current?.focus({ preventScroll: true });
    }, [open, positioned]);

    useEffect(() => {
        if (open) list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open, positioned]);

    if (options.length < 2) {
        return <span className="mf-choice-static" aria-label={label} title={selected?.label ?? label}>
            {selected?.label ?? "–"}
        </span>;
    }

    return (
        <>
            <button type="button" className="mf-choice-trigger" ref={trigger}
                aria-label={label} title={selected.label} aria-haspopup="listbox" aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => open ? close(true) : openMenu()}
                onKeyDown={(event) => {
                    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                        event.preventDefault();
                        openMenu();
                    }
                }}>
                <span>{selected.label}</span>
                <ChevronDown size={13} aria-hidden />
            </button>
            {open && portalHost && positioned && createPortal(
                <div className="mf-choice-list" style={position} id={id} ref={list} role="listbox" aria-label={label}
                    tabIndex={-1} aria-activedescendant={`${id}-${activeIndex}`}
                    data-canvas-no-pan data-canvas-ignore-wheel
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close();
                    }}
                    onKeyDown={(event) => {
                        const key = event.key;
                        if (key === "Tab") { close(true); return; }
                        if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Escape"].includes(key)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (key === "Escape") close(true);
                        else if (key === "Enter" || key === " ") choose(options[activeIndex] ?? selected);
                        else if (key === "Home") setActiveIndex(0);
                        else if (key === "End") setActiveIndex(options.length - 1);
                        else setActiveIndex((index) => (index + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
                    }}>
                    {options.map((option, index) => (
                        <div className="mf-choice-option" key={option.value} id={`${id}-${index}`} role="option"
                            aria-selected={option.value === selected.value} data-active={index === activeIndex || undefined}
                            onPointerMove={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}>
                            <span>{option.label}</span>
                            {option.value === selected.value && <Check size={14} aria-hidden />}
                        </div>
                    ))}
                </div>, portalHost)}
        </>
    );
}
