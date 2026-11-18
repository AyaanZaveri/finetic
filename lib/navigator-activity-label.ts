import { sceneProgressLabel, type SceneProgress } from "@/lib/navigator-scene-progress";

type ActivityMessage = {
  role: string;
  parts: ReadonlyArray<unknown>;
};

// Inspired by the concise verbs in claude-code-spinner-verbs. Pick one column
// per turn; never roll a new phrase during streaming or a React re-render.
const phrases = {
  initial: [
    "Pondering",
    "Perusing",
    "Mulling it over",
    "Considering",
    "Thinking it through",
    "Following the thread",
    "Deciphering",
    "Turning it over",
  ],
  page: [
    "Checking this page",
    "Reading this page",
    "Looking over this title",
    "Scanning this page",
    "Reading the title context",
    "Checking this title",
    "Taking in the page",
    "Looking at the details here",
  ],
  profile: [
    "Reading the title details",
    "Perusing the profile",
    "Picking out the details",
    "Looking over the profile",
    "Reading the title details",
    "Checking the page details",
    "Taking in the profile",
    "Reading what's on the page",
  ],
  results: [
    "Checking the results",
    "Reading what turned up",
    "Sorting through the results",
    "Looking over the results",
    "Taking stock of the results",
    "Reviewing what came back",
    "Checking the matches",
    "Reading the results",
  ],
  writing: [
    "Putting it into words",
    "Writing it up",
    "Composing the reply",
    "Summing it up",
    "Pulling the answer together",
    "Synthesizing the answer",
    "Shaping the response",
    "Putting the answer together",
  ],
} as const;

export const NAVIGATOR_ACTIVITY_VARIANT_COUNT = phrases.initial.length;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function initialLabel(
  _question: string,
  _pagePath: string | undefined,
  variant: number,
) {
  return phrases.initial[variant];
}

function activeToolLabel(part: Record<string, unknown>) {
  const name =
    part.type === "dynamic-tool"
      ? String(part.toolName)
      : String(part.type).replace(/^tool-/, "");
  const taskLabels: Record<string, string> = {
    searchPeople: "Finding people on TMDB",
    getPersonDetails: "Reading person details",
    getFilmography: "Exploring their filmography",
    searchMedia: "Finding something to watch",
    getMediaDetails: "Exploring the title",
    getSeasons: "Exploring the series",
    getEpisodes: "Finding the right episode",
    findEpisodeByTitle: "Finding the right episode",
    getMediaStreams: "Finding a way to watch",
    navigateToMedia: "Opening your selection",
    navigateToPerson: "Opening person profile",
    navigateToEpisode: "Opening your selection",
    navigateToMediaByQuery: "Opening your selection",
    playMedia: "Getting playback ready",
    completeAction: "Applying your request",
    skipToSubtitleContent: "Finding that moment",
    explainScene: "Making sense of the scene",
    analyzeMedia: "Exploring the story",
    themeToggle: "Updating the theme",
  };
  return taskLabels[name] ?? "Working on your request";
}

/** Status copy follows streamed, observable events rather than invented thoughts. */
export function getNavigatorActivityLabel(
  messages: ReadonlyArray<ActivityMessage>,
  variant = 0,
) {
  const phraseIndex =
    ((variant % NAVIGATOR_ACTIVITY_VARIANT_COUNT) +
      NAVIGATOR_ACTIVITY_VARIANT_COUNT) %
    NAVIGATOR_ACTIVITY_VARIANT_COUNT;
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const question =
    messages[lastUserIndex]?.parts
      .map((part) => record(part))
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join(" ") ?? "";
  const assistant = messages
    .slice(lastUserIndex + 1)
    .findLast((message) => message.role === "assistant");
  if (!assistant) return initialLabel(question, undefined, phraseIndex);

  for (const rawPart of [...assistant.parts].reverse()) {
    const part = record(rawPart);
    if (part.type === "data-sceneProgress") {
      const progress = record(part.data) as unknown as SceneProgress;
      if (["title", "subtitles", "scene"].includes(progress.stage) && ["running", "completed", "error"].includes(progress.state)) {
        if (progress.state === "running") return sceneProgressLabel(progress);
        const action = assistant.parts.map(record).find(candidate => candidate.toolCallId === record(part.data).toolCallId);
        if (progress.stage === "scene" && progress.state === "completed" && record(action?.output).execution === "prepared") return "Getting playback ready";
        return sceneProgressLabel(progress);
      }
    }
    if (
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim()
    ) {
      return phrases.writing[phraseIndex];
    }

    if (
      typeof part.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "dynamic-tool")
    ) {
      if (
        part.state === "input-streaming" ||
        part.state === "input-available"
      ) {
        return activeToolLabel(part);
      }
      if (part.state === "output-available" && record(part.output).execution === "prepared") return activeToolLabel(part);
      if (part.state === "output-available" || part.state === "output-error") {
        return phrases.results[phraseIndex];
      }
    }

    if (part.type === "data-pageContext") return phrases.profile[phraseIndex];
  }

  return initialLabel(question, undefined, phraseIndex);
}
