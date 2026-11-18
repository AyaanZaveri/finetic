"use client";

import { Children, useId, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { ResultCardEntranceContext } from "./result-card-motion";
import {
  ArrowUpRight,
  Film,
  BookOpen,
  Layers,
  List,
  Palette,
  Play,
  Radio,
  ScanText,
  Search,
  Subtitles,
} from "lucide-react";
import { MediaLinkCard } from "./media-link-card";
import { MediaDetailsCard } from "./media-details-card";
import { SeasonCard } from "./season-card";
import { StreamListCard } from "./stream-list-card";
import { NavigationCard } from "./navigation-card";
import { PlayMediaCard } from "./play-media-card";
import { ThemeToggleCard } from "./theme-toggle-card";
import { SubtitleTrackCard } from "./subtitle-track-card";
import { SubtitleSkipCard } from "./subtitle-skip-card";
import { SceneExplainCard } from "./scene-explain-card";
import { MediaAnalysisCard } from "./media-analysis-card";
import { PersonCard } from "./person-card";
import { WebSourceCard } from "./web-source-card";
import { EpisodeMetadataCard } from "./episode-metadata-card";
import { actionToolNames, displayNavigatorText } from "@/lib/navigator-chat";
import { sceneProgressLabel, type SceneProgress } from "@/lib/navigator-scene-progress";
import { Accordion } from "@/components/arc/accordion/accordion";
import { Button } from "@/components/ui/button";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  typeof value === "object" && value !== null ? (value as RecordValue) : {};
const text = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
const list = (value: unknown): RecordValue[] =>
  Array.isArray(value) ? value.map(record) : [];

type Trace = {
  label: string;
  detail?: string;
  phase: "running" | "completed" | "error" | "stopped";
  icon: ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
};
export type NavigatorSegment =
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "trace"; key: string; trace: Trace }
  | { kind: "lookup"; key: string; trace: Trace; cards: ReactNode }
  | { kind: "results"; key: string; results: { cards: ReactNode } };

const lookupTools = new Set([
  "searchPeople", "getPersonDetails", "getFilmography", "searchMedia",
  "getMediaDetails", "getSeasons", "getEpisodes", "findEpisodeByTitle", "findEpisode", "getEpisodeCatalog", "verifyEpisode", "searchMediaWeb", "readMediaWebSources",
]);

export function isPlaybackRequest(value: string): boolean {
  return /^(?:(?:please|can you|could you|would you|i want to|i[’']d like to)\s+)*(?:play|watch|put on|start playback)\b/i.test(value.trim());
}

const toolLabels: Record<string, [string, string, Trace["icon"]]> = {
  searchPeople: ["Searching TMDB people", "Found people", Search],
  getPersonDetails: ["Reading person details", "Read person details", BookOpen],
  getFilmography: ["Reading filmography", "Found filmography", Film],
  searchMedia: ["Searching media", "Searched media", Search],
  getMediaDetails: ["Reading title details", "Read title details", Search],
  getSeasons: ["Getting seasons", "Found seasons", Layers],
  getEpisodes: ["Getting episodes", "Found episodes", List],
  findEpisodeByTitle: ["Finding the episode", "Found the episode", Search],
  findEpisode: ["Finding the episode", "Found the episode", Search],
  getEpisodeCatalog: ["Reading episode catalog", "Read episode catalog", List],
  verifyEpisode: ["Verifying episode evidence", "Verified episode evidence", Search],
  searchMediaWeb: ["Searching the web", "Found web results", Search],
  readMediaWebSources: ["Reading web pages", "Read web pages", BookOpen],
  getMediaStreams: ["Finding streams", "Found streams", Radio],
  navigateToMedia: ["Opening title", "Opened title", ArrowUpRight],
  navigateToEpisode: ["Opening episode", "Opened episode", ArrowUpRight],
  navigateToPerson: ["Opening profile", "Opened profile", ArrowUpRight],
  navigateToMediaByQuery: [
    "Finding and opening title",
    "Opened title",
    ArrowUpRight,
  ],
  playMedia: ["Starting playback", "Started playback", Play],
  skipToSubtitleContent: ["Searching subtitles", "Found the moment", Subtitles],
  explainScene: ["Reading scene context", "Read scene context", BookOpen],
  analyzeMedia: ["Analyzing media", "Analyzed media", ScanText],
  themeToggle: ["Changing theme", "Theme changed", Palette],
  presentMediaResults: ["Preparing selected titles", "Selected titles", List],
};

function baseToolCards(
  name: string,
  output: RecordValue,
  input: RecordValue,
): ReactNode {
  // Reuse Navigator's original cards, including their navigation and playback behavior.
  switch (name) {
    case "searchPeople":
      return list(output.results).map(person => <PersonCard key={text(person.id)} person={person as ComponentProps<typeof PersonCard>["person"]} />);
    case "getPersonDetails":
      return output.person ? <PersonCard person={output.person as ComponentProps<typeof PersonCard>["person"]} /> : null;
    case "getMediaStreams":
      return (
        <StreamListCard
          result={output as ComponentProps<typeof StreamListCard>["result"]}
        />
      );
    case "navigateToMedia":
    case "navigateToEpisode":
    case "navigateToPerson":
    case "navigateToMediaByQuery":
      return (
        <NavigationCard
          result={output as ComponentProps<typeof NavigationCard>["result"]}
        />
      );
    case "playMedia":
      return (
        <PlayMediaCard
          result={output as ComponentProps<typeof PlayMediaCard>["result"]}
        />
      );
    case "themeToggle":
      return output.success ? <ThemeToggleCard /> : null;
    case "skipToSubtitleContent":
      return (
        <SubtitleSkipCard
          result={output as ComponentProps<typeof SubtitleSkipCard>["result"]}
        />
      );
    case "explainScene":
      return (
        <SceneExplainCard
          result={output as ComponentProps<typeof SceneExplainCard>["result"]}
        />
      );
    case "analyzeMedia":
      return (
        <MediaAnalysisCard
          result={output as ComponentProps<typeof MediaAnalysisCard>["result"]}
        />
      );
    case "searchMediaWeb":
    case "readMediaWebSources":
      return list(output.results || output.sources).map((source, index) => <WebSourceCard key={text(source.url)} source={{ url: text(source.url), title: text(source.title) }} index={index} />);
    case "getMediaDetails": {
      if (!output.success || !output.details) return null;
      const details = record(output.details);
      return (
        <MediaDetailsCard
          media={
            {
              ...details,
              seasonNumber: details.seasonNumber ?? details.season,
              episodeNumber: details.episodeNumber ?? details.episode,
              type:
                text(details.type).toLowerCase() === "series"
                  ? "Series"
                  : text(details.type).toLowerCase() === "episode"
                    ? "Episode"
                    : "Movie",
            } as ComponentProps<typeof MediaDetailsCard>["media"]
          }
        />
      );
    }
    case "getSeasons": {
      const seasons = list(output.seasons);
      if (!output.success || !seasons.length) return null;
      return seasons.map((season, index) => (
        <SeasonCard
          key={text(season.id) || index}
          season={season as ComponentProps<typeof SeasonCard>["season"]}
          seriesId={text(input.tvShowId) || undefined}
          index={index}
        />
      ));
    }
    default: {
      if (output.success === false && output.status !== "ambiguous") return null;
      const items = Array.isArray(output.results)
        ? list(output.results)
        : list(output.episodes);
      if (!items.length) return null;
      return items.map((item, index) => (
        <MediaLinkCard
          key={`${text(item.id || item.Id)}-${index}`}
          item={
            {
              ...item,
              source: item.source || output.source,
              id: text(item.id || item.Id),
              ...(Array.isArray(output.episodes) ? { type: "Episode" } : {}),
            } as ComponentProps<typeof MediaLinkCard>["item"]
          }
          index={index}
        />
      ));
    }
  }
}

function toolCards(name: string, output: RecordValue, input: RecordValue): ReactNode {
  const cards = baseToolCards(name, output, input);
  if (["findEpisode", "findEpisodeByTitle", "getEpisodeCatalog", "verifyEpisode", "navigateToEpisode", "playMedia", "searchMediaWeb", "readMediaWebSources"].includes(name)) return cards;
  const sources = [...list(output.evidence), ...list(output.sources)].filter((item, index, all) =>
    /^https:\/\//.test(text(item.url)) && all.findIndex(other => other.url === item.url) === index);
  if (!sources.length) return cards;
  return [cards, ...sources.map((source, index) => (
    <WebSourceCard
      key={text(source.url)}
      source={{ url: text(source.url), title: text(source.title) }}
      index={index}
    />
  ))];
}

export function toNavigatorSegments(
  parts: ReadonlyArray<unknown>,
  options: { playbackRequest?: boolean; turnParts?: ReadonlyArray<unknown>; cancelled?: boolean } = {},
): NavigatorSegment[] {
  const segments: NavigatorSegment[] = [];
  const records = (options.turnParts ?? parts).map(record);
  const toolName = (part: RecordValue) => part.type === "dynamic-tool" ? text(part.toolName) : text(part.type).replace(/^tool-/, "");
  const successful = (part: RecordValue) => part.state === "output-available" && record(part.output).success === true;
  const episodeTools = new Set(["findEpisode", "findEpisodeByTitle", "verifyEpisode", "navigateToEpisode"]);
  const recovered = (part: RecordValue) => {
    const name = toolName(part), index = records.indexOf(part);
    const input = record(part.input);
    return records.slice(index + 1).some(next => {
      const target = { ...record(next.input), ...record(next.output) };
      if (input.seriesId && target.seriesId && input.seriesId !== target.seriesId) return false;
      const leftName = text(input.seriesQuery), rightName = text(target.seriesQuery || target.seriesName);
      if (leftName && rightName && leftName.toLocaleLowerCase() !== rightName.toLocaleLowerCase()) return false;
      return successful(next) && (toolName(next) === name || (episodeTools.has(name) && episodeTools.has(toolName(next))));
    });
  };
  const selectedList = records.some(part => toolName(part) === "presentMediaResults" && successful(part));
  const verifiedEntries = records.filter(part => part.type === "data-episodeProgress" && record(part.data).stage === "verify" && record(part.data).state === "completed");
  const sameEpisodeTarget = (target: RecordValue, episode: RecordValue, input: RecordValue = {}) => {
    const type = text(target.mediaType || target.type).toLowerCase();
    if (type && type !== "episode") return false;
    // Different coordinates are never aliases, even when a caller retained
    // a stale ID. Names alone are not sufficient evidence of equivalence.
    if (["seasonNumber", "episodeNumber"].some(key => typeof target[key] === "number" &&
      typeof episode[key] === "number" && target[key] !== episode[key])) return false;
    if (episode.id && (target.mediaId || target.id) === episode.id) return true;
    if (episode.seriesId && target.seriesId === episode.seriesId &&
      target.seasonNumber === episode.seasonNumber && target.episodeNumber === episode.episodeNumber) return true;
    // playMedia translates canonical TMDB inputs into IMDb playback IDs. The
    // scene tool's own input links those identities; no lookup/name guessing.
    const canonicalInput = (!!episode.id && input.mediaId === episode.id) || (!!episode.seriesId && input.mediaId === episode.seriesId &&
      input.seasonNumber === episode.seasonNumber && input.episodeNumber === episode.episodeNumber);
    return !!canonicalInput && text(input.mediaType).toLowerCase() === "episode" &&
      typeof episode.seasonNumber === "number" && typeof episode.episodeNumber === "number" &&
      target.seasonNumber === episode.seasonNumber && target.episodeNumber === episode.episodeNumber;
  };
  const matchesEpisode = (action: RecordValue, episode: RecordValue, verification?: RecordValue) => {
    const output = record(action.output);
    if (output.mediaType && text(output.mediaType).toLowerCase() !== "episode") return false;
    return (!!verification && typeof action.toolCallId === "string" && action.toolCallId === record(verification.data).toolCallId) ||
      sameEpisodeTarget(output, episode, record(action.input));
  };
  const episodeAction = (episode: RecordValue, verification?: RecordValue) => records.findLast(part =>
    ["navigateToEpisode", "playMedia"].includes(toolName(part)) && successful(part) &&
    (!options.cancelled || record(part.output).execution === "completed") && matchesEpisode(part, episode, verification));
  const verifiedEpisode = (toolCallId: unknown) => {
    const verification = records.find(part => part.type === "data-episodeProgress" &&
      record(part.data).toolCallId === toolCallId && record(part.data).stage === "verify" && record(part.data).state === "completed");
    if (!verification) return null;
    const episode = record(record(verification.data).episode);
    if (episode.id) return episode;
    // Saved messages from before episode progress carried its own result.
    const sceneTitle = records.find(part => part.type === "data-sceneProgress" &&
      record(part.data).toolCallId === toolCallId && record(part.data).stage === "title" && record(part.data).state === "completed");
    const media = record(record(sceneTitle?.data).media);
    return media.id ? media : null;
  };
  const collapseLookups = options.playbackRequest || parts.some(raw => {
    const part = record(raw);
    return part.type === "tool-playMedia" || (part.type === "dynamic-tool" && part.toolName === "playMedia");
  });
  // Progress belongs before its final playback card, even though the tool input arrived first.
  const ordered = parts.flatMap(raw => {
    const part = record(raw);
    if (part.type === "data-sceneProgress" || part.type === "data-episodeProgress") return [];
    const progress = records.filter(candidate => ["data-sceneProgress", "data-episodeProgress"].includes(text(candidate.type)) && record(candidate.data).toolCallId === part.toolCallId);
    if (progress.some(candidate => candidate.type === "data-episodeProgress")) {
      // Updated streaming parts retain their first insertion position. Display the
      // dependency order so a completed title never jumps ahead of its evidence.
      const rank = (candidate: RecordValue) => {
        const stage = text(record(candidate.data).stage);
        return candidate.type === "data-episodeProgress" ? ["episodes", "search", "web", "verify"].indexOf(stage)
          : 4 + ["title", "subtitles", "scene"].indexOf(stage);
      };
      progress.sort((a, b) => rank(a) - rank(b));
    }
    return [...progress, raw];
  });
  ordered.forEach((raw, index) => {
    const part = record(raw);
    if (part.type === "data-episodeProgress") {
      const progress = record(part.data);
      const labels: Record<string, string[]> = { episodes: ["Reading episode metadata", "Read episode metadata"], search: ["Searching the web", "Found web results"], web: ["Checking web sources", "Checked web sources"], verify: ["Verifying the episode", "Found the episode"] };
      const labelsForStage = labels[text(progress.stage)];
      if (!labelsForStage || !["running", "completed", "error"].includes(text(progress.state))) return;
      const toolPart = records.find(candidate => candidate.toolCallId === progress.toolCallId &&
        (text(candidate.type).startsWith("tool-") || candidate.type === "dynamic-tool"));
      const didRecover = progress.state === "error" && !!toolPart && recovered(toolPart);
      const episode = progress.stage === "verify" && progress.state === "completed" ? verifiedEpisode(progress.toolCallId) : null;
      const canonicalAction = episode ? episodeAction(episode, part) : null;
      if (!canonicalAction) segments.push({ kind: "trace", key: `episode-progress-${text(part.id) || index}`, trace: {
        label: didRecover ? "Recovered episode lookup" : options.cancelled && progress.state === "running" ? "Stopped before this step completed"
          : progress.state === "error" ? displayNavigatorText(text(progress.detail)) || "Could not verify the episode" : labelsForStage[progress.state === "completed" ? 1 : 0],
        phase: didRecover ? "completed" : options.cancelled && progress.state === "running" ? "stopped" : progress.state as Trace["phase"], icon: Search,
      } });
      const output = record(toolPart?.output);
      const input = record(toolPart?.input);
      if (episode && !canonicalAction) segments.push({ kind: "results", key: `episode-match-${text(part.id) || index}`, results: {
        cards: <MediaLinkCard item={{ ...episode, type: "Episode" } as ComponentProps<typeof MediaLinkCard>["item"]} />,
      } });
      if (progress.stage === "episodes" && progress.state === "completed") {
        const catalog = Object.keys(record(progress.catalog)).length ? record(progress.catalog) : {
          seriesId: output.seriesId || input.seriesId,
          seriesName: output.seriesName || input.seriesQuery,
        };
        segments.push({ kind: "results", key: `episode-catalog-${index}`, results: {
          cards: <EpisodeMetadataCard catalog={{ ...catalog, seasonNumber: typeof (catalog.seasonNumber ?? input.seasonNumber) === "number" ? Number(catalog.seasonNumber ?? input.seasonNumber) : undefined }} />,
        } });
      }
      if (progress.stage === "web" || progress.stage === "search") {
        const sources = (Array.isArray(progress.sources) ? list(progress.sources) : [...list(output.sources), ...list(output.evidence)])
          .filter((source, index, all) => /^https:\/\//.test(text(source.url)) &&
            all.findIndex(other => other.url === source.url) === index);
        if (sources.length) segments.push({ kind: "results", key: `episode-sources-${index}`, results: {
          cards: sources.map(source => <WebSourceCard key={text(source.url)} source={{ url: text(source.url), title: text(source.title) }} />),
        } });
      }
      return;
    }
    if (part.type === "data-sceneProgress") {
      const progress = record(part.data) as unknown as SceneProgress;
      if (!["title", "subtitles", "scene"].includes(progress.stage) || !["running", "completed", "error"].includes(progress.state)) return;
      if (progress.stage === "title" && progress.state !== "error") {
        const media = record(progress.media);
        const sceneTool = records.find(candidate => toolName(candidate) === "skipToSubtitleContent" && candidate.toolCallId === record(part.data).toolCallId);
        // The agent can verify the episode in one call and load its subtitles
        // in another. Reconcile by identity across the user turn, not call ID
        // or display titles (which can include a series-name prefix).
        const alreadyVerified = verifiedEntries.some(entry => {
          if (record(entry.data).toolCallId === record(part.data).toolCallId) return true;
          const episode = record(verifiedEpisode(record(entry.data).toolCallId));
          if (text(media.type).toLowerCase() !== "episode") return false;
          return sameEpisodeTarget(media, episode, record(sceneTool?.input));
        });
        if (alreadyVerified) return;
      }
      segments.push({ kind: "trace", key: `progress-${text(part.id) || index}`, trace: {
        label: options.cancelled && progress.state === "running" ? "Stopped before this step completed" : progress.state === "error" ? displayNavigatorText(progress.detail || sceneProgressLabel(progress)) : sceneProgressLabel(progress), detail: progress.detail,
        phase: options.cancelled && progress.state === "running" ? "stopped" : progress.state, icon: progress.stage === "title" ? Search : Subtitles,
      } });
      if (progress.state === "completed") {
        const cards = progress.stage === "title" && progress.media
          ? <MediaLinkCard item={progress.media} />
          : progress.stage === "subtitles" && progress.subtitles
            ? <SubtitleTrackCard track={progress.subtitles} />
            : progress.stage === "scene" && progress.scene
              ? <SubtitleSkipCard result={{ success: true, ...progress.scene }} /> : null;
        if (cards) segments.push({ kind: "results", key: `progress-results-${text(part.id) || index}`, results: { cards } });
      }
      return;
    }
    if (part.type === "text") {
      if (text(part.text).trim())
        segments.push({
          kind: "text",
          key: `text-${index}`,
           text: displayNavigatorText(text(part.text)),
          streaming: part.state === "streaming",
        });
      return;
    }
    if (
      typeof part.type !== "string" ||
      (!part.type.startsWith("tool-") && part.type !== "dynamic-tool")
    )
      return;
    const name =
      part.type === "dynamic-tool" ? text(part.toolName) : part.type.slice(5);
    const output = record(part.output);
    const input = record(part.input);
    // Legacy handoff parts are transport details, never a second visible action.
    if (name === "completeAction") return;
    if (actionToolNames.has(name)) {
      const legacyAcknowledgement = parts.map(record).find(candidate => candidate.type === "tool-completeAction"
        && (candidate.state === "output-available" || candidate.state === "output-error")
        && (record(candidate.output).preparedToolCallId || record(candidate.input).preparedToolCallId) === part.toolCallId);
      const result = legacyAcknowledgement ? { ...output, ...record(legacyAcknowledgement.output), execution: "completed",
        ...(legacyAcknowledgement.state === "output-error" ? { success: false, error: legacyAcknowledgement.errorText } : {}),
      } : output;
      const failed = part.state === "output-error" || part.state === "output-denied" || result.success === false;
      if (failed) {
        if (recovered(part)) {
          segments.push({ kind: "trace", key: `recovered-${index}`, trace: { label: episodeTools.has(name) ? "Recovered episode lookup" : "Recovered action attempt", phase: "completed", icon: Search } });
          return;
        }
        if (parts.some(candidate => record(candidate).type === "data-sceneProgress" && record(record(candidate).data).toolCallId === part.toolCallId && record(record(candidate).data).state === "error")) return;
        if (parts.some(candidate => record(candidate).type === "data-episodeProgress" && record(record(candidate).data).toolCallId === part.toolCallId && record(record(candidate).data).state === "error")) {
          // The progress row already describes this failure. A failed action has
          // no playable target and must never create a placeholder media card.
          return;
        }
        const detail = displayNavigatorText(text(part.errorText || result.error || result.message)) || "Unable to complete this action";
        segments.push({ kind: "trace", key: `trace-${index}`, trace: {
          label: detail, detail, phase: "error", icon: toolLabels[name]?.[2] || Search,
        } });
        return;
      }
      if (part.state !== "output-available") return;
      const applied = result.execution === "completed" || !result.preparedToolCallId;
      if (options.cancelled && !applied) {
        segments.push({ kind: "trace", key: `stopped-action-${index}`, trace: { label: "Stopped before this action was applied", phase: "stopped", icon: toolLabels[name]?.[2] || Search } });
        return;
      }
      // Show the existing theme controls only after the browser has applied the change.
      const sceneAlreadyShown = name === "skipToSubtitleContent" && parts.some(candidate => {
        const data = record(record(candidate).data);
        return record(candidate).type === "data-sceneProgress" && data.toolCallId === part.toolCallId
          && data.stage === "scene" && data.state === "completed" && !!data.scene;
      });
      const verification = verifiedEntries.find(entry => matchesEpisode(part, record(record(entry.data).episode), entry));
      const episode = record(record(verification?.data).episode);
      const sameCallEpisode = verifiedEpisode(part.toolCallId);
      const primaryAction = verification ? episodeAction(episode, verification) : null;
      const episodeAlreadyShown = primaryAction ? primaryAction !== part : !!sameCallEpisode;
      const enriched = verification ? { ...result, seriesName: episode.seriesName, thumbnail: result.thumbnail || episode.thumbnail, verified: true } : result;
      const cards = !sceneAlreadyShown && !episodeAlreadyShown && (name !== "themeToggle" || applied) ? toolCards(name, enriched, input) : null;
      if (cards) segments.push({ kind: "results", key: `results-${index}`, results: { cards } });
      const hasAnswer = parts.some(rawPart => record(rawPart).type === "text" && text(record(rawPart).text).trim());
      if (applied && name !== "themeToggle" && result.message && !hasAnswer) {
        segments.push({ kind: "text", key: `action-text-${index}`, text: displayNavigatorText(text(result.message)), streaming: false });
      }
      return;
    }
    if (["findEpisode", "findEpisodeByTitle", "verifyEpisode"].includes(name) && verifiedEpisode(part.toolCallId)) return;
    const failed = part.state === "output-error" || part.state === "output-denied" || output.success === false;
    const complete = part.state === "output-available" || failed;
    if (failed && recovered(part)) {
      if (records.some(candidate => candidate.type === "data-episodeProgress" && record(candidate.data).toolCallId === part.toolCallId && record(candidate.data).state === "error")) return;
      segments.push({ kind: "trace", key: `recovered-${index}`, trace: { label: episodeTools.has(name) ? "Recovered episode lookup" : "Recovered lookup attempt", phase: "completed", icon: Search } });
      return;
    }
    const [running, completed, icon] = toolLabels[name] ?? [
      "Working",
      "Completed step",
      Search,
    ];
    const webResultsAlreadyShown = ["searchMediaWeb", "readMediaWebSources"].includes(name) && records.some(candidate =>
      candidate.type === "data-episodeProgress" && record(candidate.data).toolCallId === part.toolCallId
      && record(candidate.data).stage === (name === "searchMediaWeb" ? "search" : "web") && record(candidate.data).state === "completed");
    const finalEpisodeAction = successful(part) && list(output.episodes).length === 1 && episodeAction(list(output.episodes)[0]);
    if (finalEpisodeAction && episodeTools.has(name)) return;
    const cards =
      part.state === "output-available" && !webResultsAlreadyShown ? toolCards(name, output, input) : null;
    const resultCount =
      [output.results, output.episodes, output.seasons, output.streams].find(
        Array.isArray,
      )?.length ?? 0;
    const count = resultCount
      ? ` · ${resultCount} ${resultCount === 1 ? "result" : "results"}`
      : "";
    const detail = displayNavigatorText(text(
      part.errorText ||
        output.error ||
        input.query ||
        input.question ||
        output.message,
    ));
    const trace: Trace = {
      label: failed
        ? detail || "Unable to complete this step"
        : options.cancelled && !complete ? "Stopped before this step completed"
        : part.state === "approval-requested" ? "Awaiting approval"
        : `${name === "presentMediaResults" && complete ? text(output.heading) || completed : complete ? completed : running}${count}`,
      detail: detail || undefined,
      phase: failed ? "error" : complete ? "completed" : options.cancelled ? "stopped" : "running",
      icon,
    };
    if (complete && !failed && cards && lookupTools.has(name) && (selectedList || (collapseLookups && Children.count(cards) > 3))) {
      segments.push({ kind: "lookup", key: `lookup-${index}`, trace: selectedList ? { ...trace, label: `Research · ${trace.label}` } : trace, cards });
    } else {
      const hasProgressError = failed && parts.some(candidate => record(candidate).type === "data-episodeProgress"
        && record(record(candidate).data).toolCallId === part.toolCallId && record(record(candidate).data).state === "error");
      if (!hasProgressError && !webResultsAlreadyShown) segments.push({ kind: "trace", key: `trace-${index}`, trace });
      if (cards) {
        segments.push({
          kind: "results",
          key: `results-${index}`,
          results: { cards },
        });
      }
    }
    // Tool-only replies still expose their user-facing result, without duplicating assistant text.
    const hasAnswer = parts.some((rawPart) => {
      const p = record(rawPart);
      return p.type === "text" && text(p.text).trim();
    });
    const resultText = displayNavigatorText(text(
      output.explanation || output.analysis || output.answer || output.message,
    ));
    if (complete && !failed && resultText && !hasAnswer)
      segments.push({
        kind: "text",
        key: `tool-text-${index}`,
        text: resultText,
        streaming: false,
      });
  });
  return segments;
}

export function NavigatorTraceRow({ trace }: { trace: Trace }) {
  const Icon = trace.icon;
  return (
    <p
      aria-busy={trace.phase === "running"}
      aria-live={trace.phase === "running" ? "off" : "polite"}
      className={`flex min-h-7 items-center gap-2 px-2 py-1 text-sm font-medium leading-[1.4] text-muted-foreground ${trace.phase === "error" ? "text-destructive" : ""}`}
      role="status"
      title={trace.detail}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 stroke-[1.5]" />
      <span className="min-w-0 truncate">{trace.label}</span>
    </p>
  );
}

export function NavigatorLookup({ trace, cards }: { trace: Trace; cards: ReactNode }) {
  const Icon = trace.icon;
  const [open, setOpen] = useState(false);
  return (
    <Accordion
      defaultOpen={-1}
      onOpenChange={index => setOpen(index !== null)}
      size="sm"
      items={[{
        title: trace.label,
        icon: <Icon aria-hidden="true" className="size-4 shrink-0 stroke-[1.5]" />,
        content: <NavigatorResultCards cards={cards} revealed={open} />,
      }]}
    />
  );
}

export function NavigatorResultCards({ cards, revealed = true }: { cards: ReactNode; revealed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const listId = useId();
  const items = Children.toArray(cards);
  const remaining = items.length - 5;
  const hidden = { opacity: 0, transform: reduced ? "none" : "translateY(10px)" };
  const visible = { opacity: 1, transform: reduced ? "none" : "translateY(0)" };
  return (
    <div className="flex w-full flex-col gap-0.5">
      <div id={listId} className="flex w-full flex-col gap-0.5">
        {(expanded ? items : items.slice(0, 5)).map((card, index) => (
          <motion.div
            key={typeof card === "object" && card !== null && "key" in card ? card.key : index}
            initial={hidden}
            animate={revealed ? visible : hidden}
            transition={{
              duration: 0.18,
              ease: motionTokens.ease.out,
              delay: !reduced && revealed && index < 5 ? Math.min(index * 0.05, 0.15) : 0,
            }}
          >
            <ResultCardEntranceContext.Provider value={false}>{card}</ResultCardEntranceContext.Provider>
          </motion.div>
        ))}
      </div>
      {remaining > 0 && (
        <div className="flex self-start py-1 pl-2 pr-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={listId}
            className="-ml-3"
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? "Show fewer results" : `Show ${remaining} more ${remaining === 1 ? "result" : "results"}`}
          </Button>
        </div>
      )}
    </div>
  );
}
