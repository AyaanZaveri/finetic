"use client";

import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import type { InputHTMLAttributes, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./combobox.module.css";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  keywords?: string[];
  icon?: ReactNode;
}

export interface ComboboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "placeholder"> {
  label: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (_value: string) => void;
  description?: string;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
}

/** Follows the listbox height with a critically damped spring, so filtering never snaps the menu. */
function AutoHeight({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean | null }) {
    const innerRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number | "auto">("auto");
    useEffect(() => {
        const inner = innerRef.current;
        if (!inner) return;
        const observer = new ResizeObserver(() => setHeight(inner.offsetHeight));
        observer.observe(inner);
        return () => observer.disconnect();
    }, []);
    return <motion.div className={styles.autoHeight} initial={false} animate={{ height }} transition={reduceMotion ? { duration: 0 } : motionTokens.spring.smooth}><div ref={innerRef}>{children}</div></motion.div>;
}

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
    {
        label,
        options,
        value: controlledValue,
        defaultValue = "",
        onValueChange,
        description,
        placeholder = "Search or select…",
        emptyMessage = "No matches found",
        id,
        className,
        disabled,
        onFocus,
        ...inputProps
    },
    forwardedRef,
) {
    const generatedId = useId();
    const controlId = id ?? generatedId;
    const listboxId = `${controlId}-listbox`;
    const hintId = description ? `${controlId}-description` : undefined;
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const reduceMotion = useReducedMotion();
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);
    const selectedValue = controlledValue ?? uncontrolledValue;
    const selectedOption = options.find((option) => option.value === selectedValue);

    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    // A chosen label settles into the field: it rises in from below with a soft blur. Clearing fades the
    // placeholder in instead of snapping from the old label.
    const settledValue = useRef(selectedValue);
    useEffect(() => {
        if (settledValue.current === selectedValue) return;
        settledValue.current = selectedValue;
        const input = inputRef.current;
        if (!input || reduceMotion || (selectedValue && open)) return;
        const controls = selectedValue
            ? animate(input, { opacity: [0, 1], y: ["0.35em", "0em"], filter: [`blur(${motionTokens.blur.soft}px)`, "blur(0px)"] }, { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] })
            : animate(input, { opacity: [0, 1] }, { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] });
        return () => controls.complete();
    }, [selectedValue, reduceMotion, open]);

    const filteredOptions = useMemo(() => {
        const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        const normalizedQuery = normalize(query);
        if (!normalizedQuery) return options;
        return options.filter((option) =>
            [option.label, ...(option.keywords ?? [])].some((term) => normalize(term).includes(normalizedQuery)),
        );
    }, [options, query]);

    const enabledIndices = filteredOptions.reduce<number[]>((indices, option, index) => {
        if (!option.disabled) indices.push(index);
        return indices;
    }, []);

    useEffect(() => {
        if (!open) return;
        const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
        const option = activeOption ? optionRefs.current[activeOption.value] : null;
        const listbox = option?.parentElement;
        if (option && listbox) {
            const top = option.offsetTop;
            const bottom = top + option.offsetHeight;
            if (top < listbox.scrollTop) listbox.scrollTop = top;
            else if (bottom > listbox.scrollTop + listbox.clientHeight) listbox.scrollTop = bottom - listbox.clientHeight;
        }
    }, [activeIndex, filteredOptions, open]);

    const choose = (option: ComboboxOption) => {
        if (option.disabled) return;
        setUncontrolledValue(option.value);
        onValueChange?.(option.value);
        setQuery("");
        setOpen(false);
        inputRef.current?.focus();
    };

    const clear = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        setUncontrolledValue("");
        onValueChange?.("");
        setQuery("");
        setOpen(true);
        inputRef.current?.focus();
    };

    const openMenu = () => {
        if (disabled) return;
        setOpen(true);
        setQuery("");
        setActiveIndex(-1);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
                openMenu();
                return;
            }
            if (!enabledIndices.length) return;
            const currentPosition = enabledIndices.indexOf(activeIndex);
            const nextPosition = event.key === "ArrowDown"
                ? (currentPosition + 1) % enabledIndices.length
                : (currentPosition - 1 + enabledIndices.length) % enabledIndices.length;
            setActiveIndex(enabledIndices[nextPosition]!);
            return;
        }
        if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            const option = filteredOptions[activeIndex];
            if (option) choose(option);
            return;
        }
        if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
            setQuery("");
            return;
        }
    };

    const inputValue = open ? query : selectedOption?.label ?? "";
    const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
            <div ref={rootRef} className={styles.field}>
                <label htmlFor={controlId}>{label}</label>
                <PopoverPrimitive.Anchor asChild>
                    <div className={[styles.control, open ? styles.open : "", disabled ? styles.disabled : "", className ?? ""].filter(Boolean).join(" ")}>
                        {selectedOption?.icon ? <span className={styles.optionIcon} aria-hidden="true">{selectedOption.icon}</span> : <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />}
                        <input
                            {...inputProps}
                            ref={inputRef}
                            id={controlId}
                            type="text"
                            role="combobox"
                            value={inputValue}
                            // While searching, the chosen label stays in place as muted placeholder copy instead of vanishing.
                            placeholder={selectedOption?.label ?? placeholder}
                            disabled={disabled}
                            aria-describedby={[hintId, inputProps["aria-describedby"]].filter(Boolean).join(" ") || undefined}
                            aria-expanded={open}
                            aria-controls={open ? listboxId : undefined}
                            aria-autocomplete="list"
                            aria-activedescendant={open && activeOption ? `${controlId}-option-${activeOption.value}` : undefined}
                            onFocus={(event) => {
                                onFocus?.(event);
                                openMenu();
                            }}
                            onClick={openMenu}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setOpen(true);
                                setActiveIndex(-1);
                            }}
                            onKeyDown={handleKeyDown}
                        />
                        <AnimatePresence initial={false}>
                            {selectedOption && !disabled && (
                                <motion.button
                                    type="button"
                                    className={styles.clear}
                                    aria-label="Clear selection"
                                    onMouseDown={event => event.preventDefault()}
                                    onClick={clear}
                                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, filter: `blur(${motionTokens.blur.subtle}px)` }}
                                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: reduceMotion ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast } } }}
                                    exit={{ opacity: 0, ...(reduceMotion ? {} : { scale: 0.6, filter: `blur(${motionTokens.blur.subtle}px)` }), transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
                                    whileTap={{ scale: reduceMotion ? 1 : 0.96, transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }} draggable={false}
                                >
                                    <X size={16} strokeWidth={1.75} aria-hidden="true" />
                                </motion.button>
                            )}
                        </AnimatePresence>
                        <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
                    </div>
                </PopoverPrimitive.Anchor>
                {description && <span id={hintId} className={styles.hint}>{description}</span>}
                <PopoverPrimitive.Portal forceMount>
                    <AnimatePresence initial={false}>
                        {open && (
                            <PopoverPrimitive.Content
                                asChild
                                forceMount
                                side="bottom"
                                align="start"
                                sideOffset={8}
                                collisionPadding={12}
                                onOpenAutoFocus={(event) => event.preventDefault()}
                                onCloseAutoFocus={(event) => event.preventDefault()}
                                onInteractOutside={(event) => {
                                    if (rootRef.current?.contains(event.target as Node)) event.preventDefault();
                                }}
                            >
                                <motion.div
                                    className={styles.popover}
                                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1, transition: reduceMotion ? { duration: motionTokens.duration.instant } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] } } }}
                                    exit={{ opacity: 0, ...(reduceMotion ? {} : { y: -4, scale: 0.98 }), transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } }}
                                    role="presentation"
                                >
                                    <AutoHeight reduceMotion={reduceMotion}>
                                        <div id={listboxId} className={styles.listbox} role="listbox" aria-label={`${label} options`}>
                                            {filteredOptions.length ? filteredOptions.map((option, index) => (
                                                <div
                                                    key={option.value}
                                                    ref={(element) => { optionRefs.current[option.value] = element; }}
                                                    id={`${controlId}-option-${option.value}`}
                                                    className={styles.option}
                                                    data-active={index === activeIndex ? "true" : undefined}
                                                    data-disabled={option.disabled ? "true" : undefined}
                                                    role="option"
                                                    aria-selected={option.value === selectedValue}
                                                    aria-disabled={option.disabled || undefined}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                                                    onClick={() => choose(option)}
                                                >
                                                    <span className={styles.optionLabel}>{option.icon && <span className={styles.optionIcon} aria-hidden="true">{option.icon}</span>}<span>{option.label}</span></span>
                                                    {option.value === selectedValue && <Check className={styles.check} size={16} strokeWidth={1.75} aria-hidden="true" />}
                                                </div>
                                            )) : <motion.div className={styles.empty} role="status" initial={reduceMotion ? false : { opacity: 0, y: 4, filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}>{emptyMessage}</motion.div>}
                                        </div>
                                    </AutoHeight>
                                </motion.div>
                            </PopoverPrimitive.Content>
                        )}
                    </AnimatePresence>
                </PopoverPrimitive.Portal>
            </div>
        </PopoverPrimitive.Root>
    );
});

Combobox.displayName = "Combobox";
