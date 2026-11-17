"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CaptionsOff, CornerDownRight, Settings } from "lucide-react";
import { PlayerSettingsMenu } from "@/components/player-settings-menu";
import { SubtitleTimingPopover } from "@/components/subtitle-timing-popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/arc/dropdown-menu/dropdown-menu";
import { Button } from "@/components/ui/button";
import menuStyles from "@/components/player-settings-menu.module.css";
import { fixture, groups, readState, states, type StateId } from "./fixtures";
import styles from "./states.module.css";

// Throwaway visual workbench. Remove this folder when the user is finished.
// Only the real menu's public props supply fixtures; production is untouched.
function SettingsState({ id }: { id: StateId }) {
  const data = fixture(id);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [timingOpen, setTimingOpen] = useState(data.timingOpen);
  const [seconds, setSeconds] = useState(data.seconds);
  const [speed, setSpeed] = useState(data.speed);
  const [selected, setSelected] = useState(data.selected);
  const [quality, setQuality] = useState("auto");
  return <div ref={setContainer} className={styles.stage} data-slot="media-player">
    <DropdownMenu modal={false} open={open} onOpenChange={next => { setOpen(next); if (!next) setTimingOpen(false); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings" data-slot="media-player-settings"><Settings /></Button>
      </DropdownMenuTrigger>
      {container && <DropdownMenuContent container={container} align="end" side="top" sideOffset={10}
        data-player-native-glass="" aria-label="Playback settings" className={menuStyles.settingsMenu}
        onInteractOutside={event => {
          if ((event.target as HTMLElement).closest?.("[data-subtitle-timing]")) event.preventDefault();
        }}>
        <DropdownMenuLabel className="sr-only">Playback settings</DropdownMenuLabel>
        <DropdownMenuGroup>
          <PlayerSettingsMenu portalContainer={container} speed={speed} speeds={[.25, .5, .75, 1, 1.25, 1.5, 1.75, 2]}
            onSpeedChange={setSpeed} disabled={data.disabled}
            quality={data.quality ? { value: quality, onChange: setQuality, options: [
              { value: "auto", label: "Auto" }, { value: "1080", label: "1080p" }, { value: "720", label: "720p" },
            ] } : undefined}
            subtitles={{ value: selected, onChange: setSelected, options: [
              { value: "off", label: "Off", icon: <CaptionsOff size={14} strokeWidth={1.75} /> }, ...data.options,
            ] }}
            subtitleTiming={data.hasTiming ? { seconds, open: timingOpen, onOpen: () => setTimingOpen(true), onClose: () => setTimingOpen(false) } : undefined} />
        </DropdownMenuGroup>
      </DropdownMenuContent>}
    </DropdownMenu>
    {container && <SubtitleTimingPopover container={container} open={timingOpen && open} onOpenChange={setTimingOpen}
      seconds={seconds} onChange={setSeconds} available={data.timingAvailable && selected !== "off"} />}
  </div>;
}

export default function PlayerSettingsStates() {
  const [active, setActive] = useState<StateId>("normal");
  const [hidden, setHidden] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const choose = useCallback((id: StateId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("__state", id);
    window.history.pushState(null, "", url);
    setActive(readState());
  }, []);
  useEffect(() => {
    const sync = () => setActive(readState());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="menu"]')) return;
      if (event.key.toLowerCase() === "h") { event.preventDefault(); setHidden(value => !value); return; }
      const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 0;
      if (direction) {
        event.preventDefault();
        const index = states.findIndex(state => state.id === active);
        choose(states[(index + direction + states.length) % states.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, choose]);
  useEffect(() => {
    const list = nav.current;
    const button = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !button) return;
    const top = button.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + button.offsetHeight - list.clientHeight;
  }, [active]);
  return <div className={styles.page} data-switcher-hidden={hidden || undefined}>
    <div className={styles.layout}>
      <nav ref={nav} className={styles.switcher} aria-label="States">
        {groups.map(group => <div key={group.title} role="group" aria-labelledby={`states-${group.title.replaceAll(" ", "-")}`} className={styles.group}>
          <span id={`states-${group.title.replaceAll(" ", "-")}`} className={styles.heading}><CornerDownRight size={12} />{group.title}</span>
          {group.states.map(state => <button key={state.id} type="button" data-state={state.id} aria-pressed={active === state.id}
            onClick={() => choose(state.id)} draggable={false}>{state.label}</button>)}
        </div>)}
      </nav>
      <div className={styles.select}>
        <select aria-label="State" value={active} onChange={event => choose(event.target.value as StateId)}>
          {groups.map(group => <optgroup key={group.title} label={group.title}>
            {group.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}
          </optgroup>)}
        </select>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg>
      </div>
      <SettingsState key={active} id={active} />
    </div>
  </div>;
}
