"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownRight } from "lucide-react";
import { SubtitleTimingPopover } from "@/components/subtitle-timing-popover";
import { Button } from "@/components/ui/button";
import switcher from "../player-settings/states.module.css";
import { cues, groups, states, type State } from "./fixtures";
import styles from "./states.module.css";

function TimingState({ state }: { state: State }) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState<number>(state.seconds);
  const [caption, setCaption] = useState("");

  useEffect(() => {
    const video = mediaRef.current;
    if (!video) return;
    let previous = video.currentTime;
    let frame: number;
    const update = () => {
      const time = video.currentTime;
      const audio = audioRef.current;
      if (audio?.state === "running" && !video.paused && time - previous < .5
        && cues.some(cue => previous < cue.at && time >= cue.at)) {
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        const now = audio.currentTime;
        tone.frequency.value = 660;
        gain.gain.setValueAtTime(.12, now);
        gain.gain.exponentialRampToValueAtTime(.001, now + .18);
        tone.connect(gain).connect(audio.destination);
        tone.start(now);
        tone.stop(now + .18);
      }
      previous = time;
      const subtitleTime = time - state.drift - seconds;
      setCaption(state.available ? cues.find(cue => subtitleTime >= cue.at && subtitleTime < cue.at + 2.3)?.text ?? "" : "");
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [state, seconds]);

  useEffect(() => () => {
    void audioRef.current?.close();
    audioRef.current = null;
  }, []);

  return <div ref={setContainer} className={styles.stage} data-slot="media-player">
    <video ref={mediaRef} className={styles.video} src="/images/player-workbench-preview.mp4"
      muted playsInline loop preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    <p className={styles.caption}>{caption}</p>
    <div className={styles.controls}>
      <Button variant="secondary" size="sm" onClick={() => {
        const video = mediaRef.current;
        if (!video) return;
        if (!video.paused) { video.pause(); return; }
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume();
        void video.play();
      }}>{playing ? "Pause demo" : "Play demo"}</Button>
      <Button variant="secondary" size="sm" data-slot="media-player-subtitles"
        onClick={() => setOpen(true)}>Subtitle timing</Button>
      <p className={styles.hint}>Each beep stands in for a spoken line.</p>
    </div>
    {container && <SubtitleTimingPopover open={open} onOpenChange={setOpen} seconds={seconds} onChange={setSeconds}
      available={state.available} container={container} mediaRef={mediaRef} sourceKey={state.id} />}
  </div>;
}

function readState(): State {
  const id = new URL(window.location.href).searchParams.get("__state");
  return states.find(state => state.id === id) ?? states[0];
}

export default function SubtitleTimingStates() {
  const [active, setActive] = useState<State>(states[0]);
  const [hidden, setHidden] = useState(false);
  const switcherRef = useRef<HTMLElement>(null);
  const choose = (state: State) => {
    const url = new URL(window.location.href);
    url.searchParams.set("__state", state.id);
    window.history.pushState(null, "", url);
    setActive(state);
  };
  useEffect(() => {
    const onPop = () => setActive(readState());
    onPop();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (event.key.toLowerCase() === "h") { setHidden(value => !value); return; }
      const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const index = states.indexOf(active);
      choose(states[(index + direction + states.length) % states.length]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  useEffect(() => {
    switcherRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return <div className={switcher.page} data-switcher-hidden={hidden || undefined}>
    <div className={switcher.layout}>
      <nav ref={switcherRef} className={switcher.switcher} aria-label="States">
        {groups.map(group => <div key={group.title} className={switcher.group} role="group" aria-label={group.title}>
          <span className={switcher.heading}><CornerDownRight aria-hidden="true" size={12} />{group.title}</span>
          {group.states.map(state => <button key={state.id} type="button" aria-pressed={state.id === active.id}
            onClick={() => choose(state)}>{state.label}</button>)}
        </div>)}
      </nav>
      <div className={switcher.select}>
        <select aria-label="State" value={active.id} onChange={event => choose(states.find(state => state.id === event.target.value) ?? states[0])}>
          {groups.map(group => <optgroup key={group.title} label={group.title}>
            {group.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}
          </optgroup>)}
        </select>
      </div>
      <TimingState key={active.id} state={active} />
    </div>
  </div>;
}
