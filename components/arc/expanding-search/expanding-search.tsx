"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, Ref, RefObject } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import type { MotionValue } from "motion/react";
import { Search, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { BorderBeam } from "border-beam";
import { useTheme } from "next-themes";
import { navigatorBeamColors } from "@/lib/navigator-beam";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./expanding-search.module.css";

export interface ExpandingSearchItem {
  id: string;
  title: string;
  /** One short line under the title, such as the type, owner, or last edit. */
  meta?: string;
  /** Optional visual metadata; retain meta for plain-text filtering. */
  metaContent?: ReactNode;
  /** Results gather under this heading, in the order groups first appear in `items`. */
  group?: string;
  icon?: ReactNode;
  /** Extra words that should also find this item. */
  keywords?: string[];
}

/**
 * A search that waits as an icon button until it is needed. Use it in headers and toolbars where a full field would crowd the layout.
 * The button morphs into the field, results unfold beneath it, and Escape, choosing a result, or leaving the field empty folds it back into the icon.
 * Place it in the space the field may grow into; it fills that space's width and keeps the button on the `anchor` edge.
 */
export interface ExpandingSearchProps {
  /** Names the button, the field, and the results, such as "Search projects and docs". */
  label: string;
  items: ExpandingSearchItem[];
  /** Navigator extension: controlled async queries, without filtering server-ranked results again. */
  value?: string;
  onValueChange?: (value: string) => void;
  loading?: boolean;
  filterResults?: boolean;
  minQueryLength?: number;
  onSubmit?: (query: string) => void;
  /** Keep the field visible in the app header; only the results panel closes. */
  persistent?: boolean;
  /** Let the slash key open and focus this search from elsewhere on the page. */
  keyboardShortcut?: boolean;
  ref?: Ref<HTMLInputElement>;
  /** Shown before anything is typed, such as recent searches. */
  suggestions?: ExpandingSearchItem[];
  suggestionsLabel?: string;
  placeholder?: string;
  onSelect?: (item: ExpandingSearchItem) => void;
  /** A hovered or keyboard-active item; null cancels obsolete speculative work. */
  onItemIntent?: (_item: ExpandingSearchItem | null) => void;
  onExpandedChange?: (expanded: boolean) => void;
  /** The widest the field grows. It never grows past its container. */
  expandedWidth?: number;
  maxResults?: number;
  /** The edge the button sits on; the field grows away from it. */
  anchor?: "start" | "end";
  /** A short tip under the empty state. */
  emptyHint?: string;
  className?: string;
}

type Group = { name: string; items: ExpandingSearchItem[] };
type Mode = "suggestions" | "results" | "empty" | "loading";

const enter = [...motionTokens.ease.enter] as [number, number, number, number];
const standard = [...motionTokens.ease.standard] as [number, number, number, number];
const FALLBACK_SIZE = 44;

/** Title starts beat word starts, which beat matches inside a word, which beat keyword and meta matches. Ties keep the original order. */
function rank(items: ExpandingSearchItem[], query: string, limit: number) {
  const q = query.toLocaleLowerCase();
  const scored: { item: ExpandingSearchItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const title = item.title.toLocaleLowerCase();
    const at = title.indexOf(q);
    const extra = [item.meta ?? "", ...(item.keywords ?? [])].some(word => word.toLocaleLowerCase().includes(q));
    const score = at === 0 ? 0 : at > 0 && /[\s\-/]/.test(title[at - 1]!) ? 1 : at > 0 ? 2 : extra ? 3 : -1;
    if (score >= 0) scored.push({ item, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).slice(0, limit).map(entry => entry.item);
}

function groupBy(list: ExpandingSearchItem[], source: ExpandingSearchItem[]): Group[] {
  const order = new Map<string, number>();
  source.forEach((item, index) => { const name = item.group ?? ""; if (!order.has(name)) order.set(name, index); });
  const groups = new Map<string, ExpandingSearchItem[]>();
  list.forEach(item => { const name = item.group ?? ""; groups.set(name, [...(groups.get(name) ?? []), item]); });
  return [...groups].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).map(([name, items]) => ({ name, items }));
}

function Match({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
  if (at < 0) return text;
  return <>{text.slice(0, at)}<mark className={styles.mark}>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

/** The panel shares the field's width value, so on first open it unfolds out of the field; afterwards only its height follows the content. */
function Panel({ width, reduced, loading, children }: { width: MotionValue<number>; reduced: boolean; loading: boolean; children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  useLayoutEffect(() => {
    const panel = panelRef.current, body = bodyRef.current;
    if (!panel || !body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const surface = body.parentElement;
      const next = body.offsetHeight + (surface ? surface.offsetHeight - surface.clientHeight : 0);
      if (reduced) height.jump(next);
      else animate(height, next, motionTokens.spring.smooth);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [height, reduced]);
  // Reduced motion skips the unfold: the panel is its content's height from the first frame and only fades.
  return <motion.div ref={panelRef} className={styles.panel} style={{ width, height: reduced ? "auto" : height }} aria-busy={loading}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1, transition: { duration: reduced ? .15 : motionTokens.duration.fast, ease: enter } }}
    exit={{ opacity: 0, transition: { duration: reduced ? .1 : motionTokens.duration.instant, ease: standard } }}>
    <BorderBeam
      active={loading && !reduced}
      size="md"
      css={navigatorBeamColors}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      staticColors
      duration={4}
      strength={1}
      glowSize={1}
      className={styles.panelBeam}
    >
      <div className={styles.panelSurface}>
        <div ref={bodyRef} className={styles.body}>{children}</div>
      </div>
    </BorderBeam>
  </motion.div>;
}

/** Offsets ignore transforms, so they describe where rows sit in the list, not where a gliding row happens to be mid-flight. */
function offsetWithin(node: HTMLElement, container: HTMLElement) {
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== container) { top += current.offsetTop; current = current.offsetParent as HTMLElement | null; }
  return top;
}

interface ListboxProps { id: string; label: string; groups: Group[]; query: string; activeIndex: number; optionId: (item: ExpandingSearchItem) => string; reduced: boolean; keyboard: RefObject<boolean>; onHover: (index: number) => void; onChoose: (item: ExpandingSearchItem) => void }

function Listbox({ id, label, groups, query, activeIndex, optionId, reduced, keyboard, onHover, onChoose }: ListboxProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const flat = groups.flatMap(group => group.items);
  const layoutKey = flat.map(item => item.id).join("|");
  const activeItem = flat[activeIndex];
  const activeId = activeItem ? optionId(activeItem) : "";
  /** The highlight lives inside the active row, so it rides that row wherever it glides. Moving to another row, it starts where the old one was and springs home. */
  const travel = useMotionValue(0);
  const fade = useMotionValue(1);
  const last = useRef<{ id: string; set: string; top: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = activeId ? document.getElementById(activeId) : null;
    if (!list || !row) { last.current = null; return; }
    const top = offsetWithin(row, list);
    const previous = last.current;
    last.current = { id: activeId, set: layoutKey, top };
    // Same row: its highlight is already in place, and any travel still in flight stays relative to it.
    if (previous?.id === activeId) return;
    if (previous && previous.set === layoutKey && !reduced) {
      const velocity = travel.getVelocity();
      travel.jump(previous.top + travel.get() - top);
      animate(travel, 0, { ...motionTokens.spring.snappy, velocity });
    } else {
      // Nothing was highlighted, or new results arrived: it fades in on its row, without travel.
      travel.jump(0);
      if (reduced) fade.jump(1); else { fade.jump(0); animate(fade, 1, { duration: motionTokens.duration.instant, ease: enter }); }
    }
    if (keyboard.current) row.scrollIntoView({ block: "nearest" });
  }, [activeId, layoutKey, reduced, travel, fade, keyboard]);

  return <div ref={listRef} id={id} role="listbox" aria-label={label} className={styles.listbox}
    onPointerLeave={() => { if (!keyboard.current) onHover(-1); }}>
    <AnimatePresence mode="popLayout" initial={false}>
      {groups.map(group => {
        const headingId = `${id}-${group.name || "results"}`.replace(/\s+/g, "-");
        return <motion.div key={group.name} role="group" aria-labelledby={group.name ? headingId : undefined} className={styles.group}
          layout={reduced ? false : "position"} layoutDependency={layoutKey}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .08 } }}
          transition={{ opacity: { duration: motionTokens.duration.fast, ease: enter }, layout: motionTokens.spring.smooth }}>
          {group.name && <div id={headingId} className={styles.groupLabel} role="presentation">{group.name}</div>}
          <AnimatePresence mode="popLayout" initial={false}>
            {group.items.map(item => {
              const position = flat.indexOf(item);
              const active = position === activeIndex;
              return <motion.div key={item.id} id={optionId(item)} role="option" aria-selected={active} data-active={active || undefined} className={styles.option}
                layout={reduced ? false : "position"} layoutDependency={layoutKey}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .08 } }}
                transition={{ opacity: { duration: motionTokens.duration.fast, ease: enter }, layout: motionTokens.spring.smooth }}
                onPointerEnter={event => { if (event.pointerType === "mouse" && !active) { keyboard.current = false; onHover(position); } }}
                onPointerMove={event => { if (event.pointerType === "mouse" && !active) { keyboard.current = false; onHover(position); } }}
                onMouseDown={event => event.preventDefault()}
                onClick={() => onChoose(item)}>
                {active && <motion.span className={styles.highlight} style={{ y: travel, opacity: fade }} aria-hidden="true" />}
                {item.icon && <span className={styles.optionIcon} aria-hidden="true">{item.icon}</span>}
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}><Match text={item.title} query={query} /></span>
                  {(item.meta || item.metaContent) && <span className={styles.optionMeta}>{item.metaContent ?? item.meta}</span>}
                </span>
              </motion.div>;
            })}
          </AnimatePresence>
        </motion.div>;
      })}
    </AnimatePresence>
  </div>;
}

export function ExpandingSearch({ label, items, suggestions = [], suggestionsLabel = "Recent", placeholder, onSelect, onItemIntent, onExpandedChange, expandedWidth = 360, maxResults = 6, anchor = "end", emptyHint = "Try a shorter word or check the spelling.", className, value, onValueChange, loading = false, filterResults = true, minQueryLength = 1, onSubmit, persistent = false, keyboardShortcut = persistent, ref }: ExpandingSearchProps) {
  const id = useId();
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(persistent);
  const [focused, setFocused] = useState(false);
  const [innerQuery, setInnerQuery] = useState("");
  const query = value ?? innerQuery;
  const setQuery = (next: string) => { setInnerQuery(next); onValueChange?.(next); };
  useImperativeHandle(ref, () => inputRef.current!, []);
  const [active, setActive] = useState(-1);
  const open = useRef(persistent);
  const size = useRef({ collapsed: FALLBACK_SIZE, expanded: expandedWidth });
  const width = useMotionValue(FALLBACK_SIZE);
  /** True while the last highlight move came from the keyboard, so only keyboard moves scroll the list. */
  const keyboard = useRef(false);

  useEffect(() => {
    if (!keyboardShortcut) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const focused = document.activeElement;
      if (focused?.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
        || (focused instanceof HTMLElement && focused.isContentEditable)) return;
      event.preventDefault();
      if (open.current) inputRef.current?.focus({ preventScroll: true });
      else buttonRef.current?.click();
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [keyboardShortcut]);

  // The corner radius follows the width: a circle while collapsed, the control radius once open. It rides the same spring, so the two never drift apart.
  const syncShape = useCallback((value: number) => {
    const { collapsed, expanded: full } = size.current;
    shellRef.current?.style.setProperty("--es-open", String(Math.min(1, Math.max(0, (value - collapsed) / Math.max(1, full - collapsed)))));
  }, []);
  useMotionValueEvent(width, "change", syncShape);

  // The field grows to its own limit or its container, whichever is smaller. Container resizes are followed at once; they are not the person's action.
  useLayoutEffect(() => {
    const root = rootRef.current, shell = shellRef.current;
    if (!root || !shell) return;
    const measure = () => {
      const collapsed = shell.offsetHeight || FALLBACK_SIZE;
      const full = Math.max(collapsed, Math.min(expandedWidth, root.clientWidth));
      size.current = { collapsed, expanded: full };
      root.style.setProperty("--es-width", `${full}px`);
      const goal = open.current ? full : collapsed;
      if (width.isAnimating()) animate(width, goal, motionTokens.spring.morph);
      else width.jump(goal);
      syncShape(width.get());
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [expandedWidth, width, syncShape]);

  // Opening grows on the morph spring with a hint of overshoot; folding back settles without one, so the circle never dips below its own size.
  const morphTo = (goal: number) => { if (reduced) width.jump(goal); else animate(width, goal, goal >= width.get() ? motionTokens.spring.morph : motionTokens.spring.smooth); };

  // Focus moves inside the same click, so touch keyboards open; the field is inert until this flush makes it focusable.
  function expand() {
    if (open.current) return;
    open.current = true;
    flushSync(() => { setExpanded(true); setFocused(true); });
    inputRef.current?.focus({ preventScroll: true });
    morphTo(size.current.expanded);
    onExpandedChange?.(true);
  }

  function collapse(returnFocus: boolean) {
    if (!open.current) return;
    if (persistent) {
      setFocused(false);
      setActive(-1);
      if (returnFocus) inputRef.current?.blur();
      return;
    }
    open.current = false;
    flushSync(() => { setExpanded(false); setFocused(false); setQuery(""); setActive(-1); });
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
    morphTo(size.current.collapsed);
    onExpandedChange?.(false);
  }

  const trimmed = query.trim();
  const results = useMemo(() => trimmed ? (filterResults ? rank(items, trimmed, maxResults) : items.slice(0, maxResults)) : [], [items, trimmed, maxResults, filterResults]);
  const mode: Mode | null = !trimmed ? (suggestions.length ? "suggestions" : null) : trimmed.length < minQueryLength ? null : results.length ? "results" : loading ? "loading" : "empty";
  const groups = useMemo<Group[]>(() => mode === "suggestions" ? [{ name: suggestionsLabel, items: suggestions }] : mode === "results" ? groupBy(results, items) : [], [mode, suggestions, suggestionsLabel, results, items]);
  const flat = groups.flatMap(group => group.items);
  const activeIndex = Math.min(active, flat.length - 1);
  const activeItem = flat[activeIndex];
  const optionId = (item: ExpandingSearchItem) => `${id}-${mode}-${item.id}`;
  const listboxId = `${id}-${mode}-listbox`;
  const panelOpen = expanded && focused && mode !== null;
  const intendedItem = useRef(activeItem);
  useLayoutEffect(() => { intendedItem.current = activeItem; }, [activeItem]);
  useEffect(() => {
    onItemIntent?.(panelOpen ? intendedItem.current ?? null : null);
    return () => onItemIntent?.(null);
  }, [panelOpen, activeItem?.id, onItemIntent]);
  const announcement = !panelOpen ? "" : mode === "loading" ? `Searching for ${trimmed}` : mode === "empty" ? `No results for ${trimmed}` : mode === "results" ? `${flat.length} ${flat.length === 1 ? "result" : "results"}` : `${flat.length} ${suggestionsLabel.toLocaleLowerCase()} ${flat.length === 1 ? "item" : "items"}`;

  function choose(item: ExpandingSearchItem) {
    collapse(true);
    onSelect?.(item);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); collapse(true); return; }
    if (event.key === "Enter" && !activeItem && trimmed && onSubmit) {
      event.preventDefault();
      collapse(false);
      inputRef.current?.blur();
      onSubmit(trimmed);
      return;
    }
    if (!panelOpen || !flat.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      keyboard.current = true;
      setActive(activeIndex < 0 ? (step > 0 ? 0 : flat.length - 1) : (activeIndex + step + flat.length) % flat.length);
    } else if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      choose(activeItem);
    }
  }

  const clearHidden = reduced ? { opacity: 0 } : { opacity: 0, scale: .6, filter: `blur(${motionTokens.blur.subtle}px)` };

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} data-anchor={anchor} data-persistent={persistent || undefined}>
    <motion.div ref={shellRef} className={styles.shell} data-slot="expanding-search-shell" data-expanded={expanded || undefined} style={{ width: persistent ? "100%" : width }}>
      <button ref={buttonRef} type="button" className={styles.trigger} aria-label={label} aria-keyshortcuts={keyboardShortcut ? "/" : undefined}
        hidden={expanded} onClick={expand} draggable={false} />
      <Search className={styles.icon} data-slot="expanding-search-icon" width={18} height={18} strokeWidth={1.75} aria-hidden="true" />
      {/* The placeholder waits for the shape to start moving, then fades in; on close it leaves first. */}
      <motion.input ref={inputRef} className={styles.input} type="search" role="combobox" inert={!expanded} value={query} placeholder={placeholder ?? label}
        aria-keyshortcuts={keyboardShortcut ? "/" : undefined}
        aria-label={label} aria-expanded={panelOpen} aria-controls={panelOpen && (mode === "results" || mode === "suggestions") ? listboxId : undefined} aria-autocomplete="list"
        aria-activedescendant={panelOpen && activeItem ? optionId(activeItem) : undefined}
        name="media-search" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
        data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"
        initial={false} animate={{ opacity: expanded ? 1 : 0 }}
        transition={expanded ? { duration: reduced ? .15 : .2, ease: enter, delay: reduced ? 0 : .08 } : { duration: reduced ? .1 : .08, ease: standard }}
        onChange={event => { const next = event.target.value; setQuery(next); setActive(!filterResults ? -1 : next.trim() ? 0 : -1); keyboard.current = false; }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Switching windows keeps the search as it was; the field refocuses on return.
          if (typeof document !== "undefined" && !document.hasFocus()) return;
          setFocused(false);
          if (open.current && !inputRef.current?.value.trim()) collapse(false);
        }}
        onKeyDown={handleKeyDown} />
      {persistent && keyboardShortcut && expanded && !query && <span className={styles.shortcut} aria-hidden="true"><Kbd>/</Kbd></span>}
      <AnimatePresence initial={false}>
        {expanded && query && <motion.button key="clear" type="button" tabIndex={-1} className={styles.clear} aria-label="Clear search"
          onMouseDown={event => event.preventDefault()}
          onClick={() => { setQuery(""); setActive(-1); inputRef.current?.focus({ preventScroll: true }); }}
          initial={clearHidden} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ ...clearHidden, transition: { duration: reduced ? .1 : motionTokens.duration.instant, ease: standard } }}
          transition={reduced ? { duration: .15 } : { ...motionTokens.spring.snappy, opacity: { duration: motionTokens.duration.fast }, filter: { duration: motionTokens.duration.fast } }} draggable={false}>
          <X width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
        </motion.button>}
      </AnimatePresence>
    </motion.div>
    <AnimatePresence>
      {panelOpen && <Panel key="panel" width={width} reduced={reduced} loading={loading}>
        <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={mode} className={styles.view}
              initial={reduced ? { opacity: 0 } : { opacity: 0, filter: `blur(${motionTokens.blur.subtle}px)` }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, transition: { duration: .1, ease: standard } }}
              transition={{ duration: reduced ? .15 : motionTokens.duration.fast, ease: enter }}>
              {mode === "loading"
                ? <div className={styles.empty} role="status"><p className={styles.emptyTitle}>Searching…</p></div>
                : mode === "empty"
                ? <div className={styles.empty}><p className={styles.emptyTitle}>No results for “{trimmed}”</p><p className={styles.emptyHint}>{emptyHint}</p></div>
                : <Listbox id={listboxId} label={mode === "suggestions" ? suggestionsLabel : `Results for ${trimmed}`} groups={groups} query={mode === "results" ? trimmed : ""} activeIndex={activeIndex} optionId={optionId} reduced={reduced} keyboard={keyboard} onHover={setActive} onChoose={choose} />}
            </motion.div>
        </AnimatePresence>
      </Panel>}
    </AnimatePresence>
    <span className={styles.srOnly} role="status" aria-live="polite">{announcement}</span>
  </div>;
}

export default ExpandingSearch;
