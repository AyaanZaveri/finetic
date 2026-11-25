"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import BoringAvatar from "boring-avatars";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { PanInfo, Transition, Variants } from "motion/react";
import { ChevronDown, LoaderCircle, LogOut, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ArtworkImage } from "@/components/artwork-image";
import styles from "./user-menu.module.css";
import SegmentedControl from "../segmented-control/segmented-control";

export type UserStatus = "available" | "busy" | "away";
export type ThemePreference = "light" | "dark" | "system";

/** Statuses in menu order. Each one has its own dot shape as well as color: solid, barred, or hollow. */
export const userStatuses: { value: UserStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
  { value: "away", label: "Away" },
];

const themes: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={14} strokeWidth={1.75} aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} strokeWidth={1.75} aria-hidden="true" /> },
  { value: "system", label: "System", icon: <Monitor size={14} strokeWidth={1.75} aria-hidden="true" /> },
];

export interface UserMenuUser { name: string; email: string; plan?: string; avatarSrc?: string; avatarSrcSet?: string }
export interface UserMenuItem { label: string; icon?: ReactNode; keys?: string[]; onSelect?: () => void }

/**
 * The account menu behind a person's photo in an app's top bar. It holds a compact identity header, a short group of account
 * destinations, an inline theme switch, and sign out. On screens narrower than 640px it opens as a bottom sheet instead.
 * Theme and status choices keep the menu open; everything else closes it and returns focus to the trigger.
 * When `onSignOut` returns a promise, the item shows its progress and the menu closes once it settles.
 */
export interface UserMenuProps {
  user: UserMenuUser;
  /** Presence status. Passing `status` or `onStatusChange` shows the presence dot and an inline status switch. */
  status?: UserStatus;
  defaultStatus?: UserStatus;
  onStatusChange?: (status: UserStatus) => void;
  theme?: ThemePreference;
  defaultTheme?: ThemePreference;
  /** Reports the choice. Applying it to the page is up to the app. */
  onThemeChange?: (theme: ThemePreference) => void;
  /** Shows the inline light, dark, and system switch. */
  showTheme?: boolean;
  /** Account destinations with optional shortcut hints, such as ["⌘", ","]. Keep it to three or four. */
  items?: UserMenuItem[];
  onSignOut?: () => void | Promise<unknown>;
  signOutKeys?: string[];
  align?: "start" | "center" | "end";
  /** Shows the name and a chevron beside the avatar from 640px up. */
  showName?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders the desktop panel in a portal on the body. Pass false to keep it inside the trigger's wrapper. */
  portal?: boolean;
  /** The trigger button, for returning focus after the menu is swapped out. */
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}

type Highlight = { top: number; height: number; tone?: string; glide: boolean };
type OpenReason = "first" | "last" | "pointer" | null;

const compactQuery = "(max-width: 639px)";
const subscribeCompact = (change: () => void) => { const query = window.matchMedia(compactQuery); query.addEventListener("change", change); return () => query.removeEventListener("change", change); };
const subscribeNothing = () => () => {};
const statusLabel = (status: UserStatus) => userStatuses.find(option => option.value === status)?.label ?? status;
const enter = [...motionTokens.ease.enter] as [number, number, number, number];
const standard = [...motionTokens.ease.standard] as [number, number, number, number];
const menuEase = [...motionTokens.ease.out] as [number, number, number, number];
const drawerEase = [...motionTokens.ease.drawer] as [number, number, number, number];

/** The dropdown stays anchored to its avatar; closing is shorter than opening. */
const panelMotion: Variants = {
  closed: { opacity: 0, transform: "scale(0.96)" },
  open: {
    opacity: 1,
    transform: "scale(1)",
    transition: { duration: motionTokens.duration.menuOpen, ease: menuEase },
  },
  exit: {
    opacity: 0,
    transform: "scale(0.98)",
    transition: { duration: motionTokens.duration.menuClose, ease: menuEase },
  },
};
// Keep Motion's y value for the existing interruptible drag-to-dismiss gesture.
const sheetMotion: Variants = {
  closed: { opacity: 0, y: "100%" },
  open: { opacity: 1, y: 0, transition: { duration: motionTokens.duration.menuOpen, ease: drawerEase } },
  exit: { opacity: 0, y: "100%", transition: { duration: motionTokens.duration.menuClose, ease: drawerEase } },
};
const stillMotion: Variants = { closed: { opacity: 0 }, open: { opacity: 1, transition: { duration: motionTokens.duration.instant } }, exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

/** A presence mark that morphs between statuses: the color crossfades while a hole opens for away and a bar slides in for busy. */
export function PresenceDot({ status, className }: { status: UserStatus | "offline"; className?: string }) {
  return <span className={[styles.dot, className].filter(Boolean).join(" ")} data-status={status} aria-hidden="true" />;
}

function Portrait({ user }: { user: UserMenuUser }) {
  const [failed, setFailed] = useState<string>();
  const unavailable = useCallback(() => setFailed(user.avatarSrc), [user.avatarSrc]);
  if (!user.avatarSrc || failed === user.avatarSrc) {
    // Navigator keeps its username-seeded marble image inside Arc's Face.
    return <BoringAvatar
      className={styles.portrait}
      size={32}
      name={user.name.toLowerCase()}
      variant="marble"
      colors={["#064e3b", "#059669", "#34d399", "#99f6e4", "#0d9488"]}
    />;
  }
  return <ArtworkImage className={styles.portrait} src={user.avatarSrc} srcSet={user.avatarSrcSet} alt="" decoding="async" draggable={false}
    reveal="late" waitForDecode fallbackText="" onUnavailable={unavailable} />;
}

function Face({ user, status, size }: { user: UserMenuUser; status?: UserStatus; size: "sm" | "md" }) {
  return <span className={styles.face} data-size={size}><Portrait user={user} />{status && <PresenceDot status={status} />}</span>;
}

/** Changing text rises out of a small blur while the old text lifts away. */
function Rise({ text, reduced }: { text: string; reduced: boolean }) {
  return <AnimatePresence mode="popLayout" initial={false}>
    <motion.span key={text} className={styles.rise} initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em", filter: `blur(${motionTokens.blur.subtle}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.35em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: standard } }}
      transition={reduced ? { duration: 0 } : { duration: motionTokens.duration.standard, ease: enter }}>{text}</motion.span>
  </AnimatePresence>;
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <KbdGroup className={styles.keys} aria-hidden="true">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>
          {key === "," ? <span className={styles.commaGlyph}>{key}</span> : key}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

/** A compact inline switch. It is one stop in the menu: up and down pass over it, left and right choose within it. */
function MenuSegments<T extends string>({ label, icon, value, options, onChange, variants }: { label: string; icon: ReactNode; value: T; options: { value: T; label: string; icon: ReactNode }[]; onChange: (value: T) => void; variants?: Variants }) {
  return <motion.div className={styles.row} data-stop="group" data-label={label} variants={variants}>
    <span className={styles.icon} aria-hidden="true">{icon}</span>
    <span className={styles.rowLabel} aria-hidden="true">{label}</span>
    <SegmentedControl
      className={styles.themeControl}
      label={label}
      value={value}
      onValueChange={next => { const option = options.find(item => item.value === next); if (option) onChange(option.value); }}
      options={options.map(option => ({ value: option.value, label: option.label, accessory: <span className={styles.segmentIcon} aria-hidden="true">{option.icon}</span> }))}
    />
  </motion.div>;
}

const getStops = (root: HTMLElement | null) => Array.from(root?.querySelectorAll<HTMLElement>("[data-stop]") ?? []);
function focusStop(stop: HTMLElement | undefined) {
  if (!stop) return;
  const target = stop.dataset.stop === "group" ? stop.querySelector<HTMLElement>('[aria-pressed="true"]') ?? stop.querySelector<HTMLElement>("button") : stop;
  target?.focus({ preventScroll: true });
}

export function UserMenu({ user, status: statusProp, defaultStatus = "available", onStatusChange, theme: themeProp, defaultTheme = "system", onThemeChange, showTheme = true, items = [], onSignOut, signOutKeys, align = "end", showName = false, open: openProp, defaultOpen = false, onOpenChange, portal = true, ref, className }: UserMenuProps) {
  const id = useId();
  const menuId = `${id}-menu`;
  const triggerId = `${id}-trigger`;
  const reduced = !!useReducedMotion();
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const compact = useSyncExternalStore(subscribeCompact, () => window.matchMedia(compactQuery).matches, () => false);
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const [innerStatus, setInnerStatus] = useState(defaultStatus);
  const [innerTheme, setInnerTheme] = useState(defaultTheme);
  const [signingOut, setSigningOut] = useState(false);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const open = openProp ?? innerOpen;
  const showStatus = statusProp !== undefined || onStatusChange !== undefined;
  const status = statusProp ?? innerStatus;
  const theme = themeProp ?? innerTheme;
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reason = useRef<OpenReason>(null);
  const typed = useRef({ text: "", timer: 0 });
  const mounted = useRef(true);
  const pending = useRef(false);
  const sheet = hydrated && compact;
  const inline = !portal && !sheet;

  useEffect(() => { mounted.current = true; const current = typed.current; return () => { mounted.current = false; window.clearTimeout(current.timer); }; }, []);

  function setTriggerRef(node: HTMLButtonElement | null) {
    triggerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as { current: HTMLButtonElement | null }).current = node;
  }

  function setOpen(next: boolean, why: OpenReason = null) {
    reason.current = next ? why : null;
    if (next) setSigningOut(pending.current);
    setHighlight(null);
    setInnerOpen(next);
    onOpenChange?.(next);
  }
  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  // Focus moves in only when a person opened the menu, so a menu that starts open never steals focus or scrolls the page.
  useEffect(() => {
    if (!open) return;
    const why = reason.current;
    reason.current = null;
    if (!why) return;
    const frame = requestAnimationFrame(() => {
      const stops = getStops(listRef.current);
      if (why === "first") focusStop(stops[0]);
      else if (why === "last") focusStop(stops.at(-1));
      else surfaceRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, sheet]);

  // The panel is placed against the trigger and scales from the avatar's center, flipping above when there is no room below.
  useLayoutEffect(() => {
    if (!open || sheet) return;
    const place = () => {
      const panel = surfaceRef.current, trigger = triggerRef.current;
      if (!panel || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = panel.offsetWidth, height = panel.offsetHeight;
      let left: number, top: number;
      if (inline) {
        const root = rootRef.current?.getBoundingClientRect();
        left = (root?.left ?? 0) + panel.offsetLeft;
        top = (root?.top ?? 0) + panel.offsetTop;
      } else {
        const wanted = align === "start" ? rect.left : align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.right - width;
        left = Math.min(Math.max(12, wanted), window.innerWidth - width - 12);
        const below = rect.bottom + 8;
        top = below + height > window.innerHeight - 12 && rect.top - 8 - height > 12 ? rect.top - 8 - height : below;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      }
      const faceCenter = rect.left + Math.min(rect.width, 40) / 2;
      const originX = align === "end" && rect.width > 40 ? rect.right - 20 - left : faceCenter - left;
      panel.style.setProperty("--origin-x", `${Math.min(Math.max(0, originX), width)}px`);
      panel.style.setProperty("--origin-y", top < rect.top ? `${height}px` : "0px");
    };
    place();
    if (inline) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, sheet, inline, align]);

  // Outside presses close the panel. The sheet has its own scrim.
  useEffect(() => {
    if (!open || sheet) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      reason.current = null;
      setHighlight(null);
      setInnerOpen(false);
      onOpenChange?.(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, sheet, onOpenChange]);

  // The page behind the sheet stays put.
  useEffect(() => {
    if (!open || !sheet) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, [open, sheet]);

  function changeStatus(value: UserStatus) { setInnerStatus(value); onStatusChange?.(value); }
  function changeTheme(value: ThemePreference) { setInnerTheme(value); onThemeChange?.(value); }

  function signOut() {
    if (pending.current) return;
    const result = onSignOut?.();
    if (!result || typeof result.then !== "function") { close(true); return; }
    // Async sign out keeps the menu open with its progress on the item, then closes once it settles.
    pending.current = true;
    setSigningOut(true);
    const done = () => { pending.current = false; if (mounted.current) close(false); };
    result.then(done, done);
  }

  function onListFocus(event: FocusEvent<HTMLDivElement>) {
    const stop = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-stop]") : null;
    if (!stop || stop.dataset.stop === "group") { setHighlight(null); return; }
    setHighlight(current => ({ top: stop.offsetTop, height: stop.offsetHeight, tone: stop.dataset.tone, glide: current !== null }));
  }

  // Focus follows a mouse or pen, so the keyboard carries on from wherever the pointer left the highlight.
  function onItemPointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
  }
  // The inline switches are not rows, so the pointer over them releases the highlight instead of dragging it along.
  function onListPointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch" || !highlight) return;
    const group = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-stop="group"]') : null;
    if (!group || group.contains(document.activeElement)) return;
    setHighlight(null);
    surfaceRef.current?.focus({ preventScroll: true });
  }
  function onListPointerLeave(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    setHighlight(null);
    surfaceRef.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    const stops = getStops(listRef.current);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = active?.closest<HTMLElement>("[data-stop]") ?? null;
    const index = current ? stops.indexOf(current) : -1;
    const step = (to: HTMLElement | undefined) => { event.preventDefault(); focusStop(to); };
    switch (event.key) {
      case "ArrowDown": return step(stops[(index + 1) % stops.length]);
      case "ArrowUp": return step(stops[index <= 0 ? stops.length - 1 : index - 1]);
      case "Home": return step(stops[0]);
      case "End": return step(stops.at(-1));
      case "Escape": case "Tab": event.preventDefault(); return close(true);

    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === " ") return;
    // Typeahead: letters jump to the next row whose label starts with what was typed.
    const memory = typed.current;
    window.clearTimeout(memory.timer);
    memory.text += event.key.toLowerCase();
    memory.timer = window.setTimeout(() => { memory.text = ""; }, 500);
    const ordered = [...stops.slice(index + 1), ...stops.slice(0, index + 1)];
    const search = memory.text.length > 1 && current?.dataset.label?.toLowerCase().startsWith(memory.text) ? [current] : ordered;
    const match = search.find(stop => stop.dataset.label?.toLowerCase().startsWith(memory.text));
    if (match) step(match);
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    if (open) { close(false); return; }
    setOpen(true, event.detail === 0 ? "first" : "pointer");
  }
  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true, event.key === "ArrowDown" ? "first" : "last");
  }

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > 80 || info.velocity.y > 500) close(true);
  }

  const glide: Transition = highlight?.glide && !reduced ? motionTokens.spring.snappy : { duration: 0 };
  const row = undefined;
  const menuProps = { id: menuId, role: "menu", "aria-labelledby": triggerId, tabIndex: -1, onKeyDown };

  const content = <>
    <motion.div className={styles.header} variants={row}>
      <Face user={user} status={showStatus ? status : undefined} size="md" />
      <div className={styles.identity}>
        <div className={styles.nameRow}><span className={styles.name}>{user.name}</span>{user.plan && <span className={styles.plan}>{user.plan}</span>}</div>
        <span className={styles.email} title={user.email}>{user.email}</span>
      </div>
    </motion.div>
    <div ref={listRef} className={styles.list} onFocus={onListFocus} onPointerMove={onListPointerMove} onPointerLeave={onListPointerLeave}>
      <motion.span className={styles.highlight} data-tone={highlight?.tone} aria-hidden="true" initial={false}
        animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }}
        transition={{ default: glide, opacity: { duration: reduced ? 0 : motionTokens.duration.instant } }} />
      {items.length > 0 && <>
        <div className={styles.separator} role="separator" />
        {items.map(item => <motion.button key={item.label} type="button" role="menuitem" tabIndex={-1} className={styles.item} data-stop="item" data-label={item.label} variants={row}
          onPointerMove={onItemPointerMove} onClick={() => { close(true); item.onSelect?.(); }} draggable={false}>
          <span className={styles.icon} aria-hidden="true">{item.icon}</span>
          <span className={styles.itemLabel}>{item.label}</span>
          {item.keys && <Keys keys={item.keys} />}
        </motion.button>)}
      </>}
      {(showTheme || showStatus) && <>
        <div className={styles.separator} role="separator" />
        {showStatus && <MenuSegments label="Status" icon={<PresenceDot status={status} />} value={status} onChange={changeStatus}
          options={userStatuses.map(option => ({ ...option, icon: <PresenceDot status={option.value} /> }))} variants={row} />}
        {showTheme && <MenuSegments label="Theme" icon={<SunMoon size={16} strokeWidth={1.75} />} value={theme} onChange={changeTheme} options={themes} variants={row} />}
      </>}
      <div className={styles.separator} role="separator" />
      <motion.button type="button" role="menuitem" tabIndex={-1} className={styles.item} data-stop="item" data-tone="danger" data-label="Sign out" variants={row}
        aria-busy={signingOut || undefined} onPointerMove={onItemPointerMove} onClick={signOut} draggable={false}>
        <span className={styles.icon} aria-hidden="true">{signingOut ? <LoaderCircle className={styles.spinner} size={16} strokeWidth={1.75} /> : <LogOut size={16} strokeWidth={1.75} />}</span>
        <span className={styles.itemLabel}><Rise text={signingOut ? "Signing out" : "Sign out"} reduced={reduced} /></span>
        {signOutKeys && <Keys keys={signOutKeys} />}
      </motion.button>
    </div>
  </>;

  const panel = <AnimatePresence>
    {open && !sheet && <motion.div key="panel" ref={surfaceRef} {...menuProps} className={styles.panel} data-inline={inline || undefined} data-align={align}
      variants={reduced ? stillMotion : panelMotion} initial="closed" animate="open" exit="exit">
      {content}
    </motion.div>}
  </AnimatePresence>;

  const bottomSheet = <AnimatePresence>
    {open && sheet && <motion.div key="scrim" className={styles.scrim} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduced ? .1 : .2, ease: standard }} onClick={() => close(true)} />}
    {open && sheet && <motion.div key="sheet" data-slot="user-menu-sheet" ref={surfaceRef} {...menuProps} className={`${styles.panel} ${styles.sheet}`} aria-modal="true"
      variants={reduced ? stillMotion : sheetMotion} initial="closed" animate="open" exit="exit"
      drag={reduced ? false : "y"} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: .04, bottom: .9 }} dragMomentum={false} onDragEnd={onDragEnd}>
      <span className={styles.handle} aria-hidden="true" />
      {content}
    </motion.div>}
  </AnimatePresence>;

  return <span ref={rootRef} className={styles.root}>
    <button ref={setTriggerRef} id={triggerId} type="button" className={[styles.trigger, className].filter(Boolean).join(" ")} data-state={open ? "open" : "closed"} data-name={showName || undefined}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={`Account menu, ${user.name}${showStatus ? `, ${statusLabel(status)}` : ""}`}
      onClick={onTriggerClick} onKeyDown={onTriggerKeyDown} draggable={false}>
      <Face user={user} status={showStatus ? status : undefined} size="sm" />
      {showName && <><span className={styles.triggerName}>{user.name}</span><ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" /></>}
    </button>
    {sheet ? createPortal(bottomSheet, document.body) : inline ? panel : hydrated ? createPortal(panel, document.body) : null}
  </span>;
}

export default UserMenu;
