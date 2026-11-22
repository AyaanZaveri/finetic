"use client";

import type { OpenAIAuthMethod } from "@/lib/chatgpt-provider";
import React, { createContext, useContext, useState, useEffect } from "react";

import { SUBTITLE_SIZES, SUBTITLE_OUTLINES, SUBTITLE_WEIGHTS, SUBTITLE_COLORS, type SubtitleSize, type SubtitleOutline, type SubtitleWeight, type SubtitleColor } from "@/lib/subtitle-appearance";
import { SUBTITLE_POSITION, normalizeSubtitlePosition } from "@/lib/subtitle-appearance";

import { DEFAULT_PLAYBACK_PREFERENCES, readPlaybackPreferences, savePlaybackPreferences, normalizePlaybackPreferences, type PlaybackPreferences } from "@/lib/media/playback-preferences";

export interface BitrateOption {
  value: string;
  label: string;
  bitrate: number;
}

export const BITRATE_OPTIONS: BitrateOption[] = [
  { value: "auto", label: "Auto", bitrate: 0 },
  { value: "20000", label: "20 Mbps (4K)", bitrate: 20000000 },
  { value: "8000", label: "8 Mbps (1080p)", bitrate: 8000000 },
  { value: "4000", label: "4 Mbps (720p)", bitrate: 4000000 },
  { value: "2000", label: "2 Mbps (480p)", bitrate: 2000000 },
  { value: "1000", label: "1 Mbps (360p)", bitrate: 1000000 },
];

export type AIProvider =
  | "openai"
  | "gemini"
  | "ollama"
  | "groq"
  | "openrouter"
  | "cerebras"
  | "opencode";
export type OpenRouterReasoningEffort =
  | "default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type CerebrasReasoningEffort = "default" | "low" | "medium" | "high";

interface SettingsContextType {
  playbackPreferences: PlaybackPreferences;
  updatePlaybackPreferences: (preferences: Partial<PlaybackPreferences>) => void;
  subtitlePosition: number;
  setSubtitlePosition: (position: number) => void;
  subtitleSize: SubtitleSize;
  setSubtitleSize: (size: SubtitleSize) => void;
  subtitleOutline: SubtitleOutline;
  setSubtitleOutline: (outline: SubtitleOutline) => void;
  subtitleWeight: SubtitleWeight;
  setSubtitleWeight: (weight: SubtitleWeight) => void;
  subtitleColor: SubtitleColor;
  setSubtitleColor: (color: SubtitleColor) => void;
  resetSubtitleAppearance: () => void;
  videoBitrate: string;
  setVideoBitrate: (bitrate: string) => void;
  navigatorEnabled: boolean;
  setNavigatorEnabled: (enabled: boolean) => void;
  aiProvider: AIProvider;
  setAiProvider: (provider: AIProvider) => void;
  // model settings
  openaiBaseUrl: string;
  setOpenaiBaseUrl: (url: string) => void;
  openaiAuthMethod: OpenAIAuthMethod;
  setOpenaiAuthMethod: (method: OpenAIAuthMethod) => void;
  chatGPTModel: string;
  setChatGPTModel: (model: string) => void;
  openaiModel: string;
  setOpenaiModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  ollamaBaseUrl: string;
  setOllamaBaseUrl: (url: string) => void;
  ollamaModel: string;
  setOllamaModel: (model: string) => void;
  groqModel: string;
  setGroqModel: (model: string) => void;
  openrouterModel: string;
  setOpenrouterModel: (model: string) => void;
  openrouterReasoningEffort: OpenRouterReasoningEffort;
  setOpenrouterReasoningEffort: (effort: OpenRouterReasoningEffort) => void;
  cerebrasModel: string;
  setCerebrasModel: (model: string) => void;
  cerebrasReasoningEffort: CerebrasReasoningEffort;
  setCerebrasReasoningEffort: (effort: CerebrasReasoningEffort) => void;
  opencodeModel: string;
  setOpencodeModel: (model: string) => void;
  // API keys
  ollamaApiKey: string;
  setOllamaApiKey: (key: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  googleApiKey: string;
  setGoogleApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  openrouterApiKey: string;
  setOpenrouterApiKey: (key: string) => void;
  cerebrasApiKey: string;
  setCerebrasApiKey: (key: string) => void;
  opencodeApiKey: string;
  setOpencodeApiKey: (key: string) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [playbackPreferences, setPlaybackPreferences] = useState<PlaybackPreferences>(DEFAULT_PLAYBACK_PREFERENCES);
  const updatePlaybackPreferences = (patch: Partial<PlaybackPreferences>) => {
    setPlaybackPreferences(previous => {
      const next = normalizePlaybackPreferences({ ...previous, ...patch });
      savePlaybackPreferences(next);
      return next;
    });
  };
  useEffect(() => { setPlaybackPreferences(readPlaybackPreferences()); }, []);
  const [subtitlePosition, setSubtitlePositionState] = useState<number>(SUBTITLE_POSITION.default);
  const setSubtitlePosition = (value: number) => {
    const position = normalizeSubtitlePosition(value);
    setSubtitlePositionState(position);
    try { localStorage.setItem("navigator-subtitle-position", String(position)); } catch { /* Keep the current preference when storage is unavailable. */ }
  };
  const [subtitleSize, setSubtitleSizeState] = useState<SubtitleSize>("standard");
  const [subtitleOutline, setSubtitleOutlineState] = useState<SubtitleOutline>("thin");
  const setSubtitleSize = (value: SubtitleSize) => {
    setSubtitleSizeState(value);
    try { localStorage.setItem("navigator-subtitle-size", value); } catch { /* Keep the current preference when storage is unavailable. */ }
  };
  const setSubtitleOutline = (value: SubtitleOutline) => {
    setSubtitleOutlineState(value);
    try { localStorage.setItem("navigator-subtitle-outline", value); } catch { /* Keep the current preference when storage is unavailable. */ }
  };
  const [subtitleWeight, setSubtitleWeightState] = useState<SubtitleWeight>("medium");
  const [subtitleColor, setSubtitleColorState] = useState<SubtitleColor>("white");
  const setSubtitleWeight = (value: SubtitleWeight) => {
    setSubtitleWeightState(value);
    try { localStorage.setItem("navigator-subtitle-weight", value); } catch { /* Keep the current preference when storage is unavailable. */ }
  };
  const setSubtitleColor = (value: SubtitleColor) => {
    setSubtitleColorState(value);
    try { localStorage.setItem("navigator-subtitle-color", value); } catch { /* Keep the current preference when storage is unavailable. */ }
  };
  const resetSubtitleAppearance = () => {
    setSubtitlePosition(SUBTITLE_POSITION.default);
    setSubtitleSize("standard");
    setSubtitleOutline("thin");
    setSubtitleWeight("medium");
    setSubtitleColor("white");
  };
  const [videoBitrate, setVideoBitrateState] = useState<string>("auto");
  const [navigatorEnabled, setNavigatorEnabledState] = useState<boolean>(true);
  const [aiProvider, setAiProviderState] = useState<AIProvider>("openai");
  const [openaiBaseUrl, setOpenaiBaseUrlState] = useState<string>(
    "https://api.openai.com/v1"
  );
  const [openaiAuthMethod, setOpenaiAuthMethodState] = useState<OpenAIAuthMethod>("api-key");
  const [chatGPTModel, setChatGPTModelState] = useState("");
  const [openaiModel, setOpenaiModelState] = useState<string>("gpt-4o-mini");
  const [geminiModel, setGeminiModelState] = useState<string>(
    "gemini-flash-lite-latest"
  );
  const [ollamaBaseUrl, setOllamaBaseUrlState] = useState<string>(
    "http://localhost:11434"
  );
  const [ollamaModel, setOllamaModelState] = useState<string>("phi3");
  const [groqModel, setGroqModelState] = useState<string>("llama3-8b-8192");
  const [openrouterModel, setOpenrouterModelState] = useState<string>(
    "qwen/qwen3-coder:free"
  );
  const [openrouterReasoningEffort, setOpenrouterReasoningEffortState] =
    useState<OpenRouterReasoningEffort>("default");
  const [cerebrasModel, setCerebrasModelState] = useState<string>("gpt-oss-120b");
  const [cerebrasReasoningEffort, setCerebrasReasoningEffortState] =
    useState<CerebrasReasoningEffort>("default");
  const [opencodeModel, setOpencodeModelState] = useState<string>("gpt-5.6-luna");

  // API Key states
  const [ollamaApiKey, setOllamaApiKeyState] = useState<string>("");
  const [openaiApiKey, setOpenaiApiKeyState] = useState<string>("");
  const [googleApiKey, setGoogleApiKeyState] = useState<string>("");
  const [groqApiKey, setGroqApiKeyState] = useState<string>("");
  const [openrouterApiKey, setOpenrouterApiKeyState] = useState<string>("");
  const [cerebrasApiKey, setCerebrasApiKeyState] = useState<string>("");
  const [opencodeApiKey, setOpencodeApiKeyState] = useState<string>("");

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const position = localStorage.getItem("navigator-subtitle-position");
      if (position?.trim()) setSubtitlePositionState(normalizeSubtitlePosition(Number(position)));
      const weight = localStorage.getItem("navigator-subtitle-weight");
      const color = localStorage.getItem("navigator-subtitle-color");
      if (SUBTITLE_WEIGHTS.some(option => option.value === weight)) setSubtitleWeightState(weight as SubtitleWeight);
      if (SUBTITLE_COLORS.some(option => option.value === color)) setSubtitleColorState(color as SubtitleColor);
      const size = localStorage.getItem("navigator-subtitle-size");
      const outline = localStorage.getItem("navigator-subtitle-outline");
      if (SUBTITLE_SIZES.some(option => option.value === size)) setSubtitleSizeState(size as SubtitleSize);
      if (SUBTITLE_OUTLINES.some(option => option.value === outline)) setSubtitleOutlineState(outline as SubtitleOutline);
    } catch { /* Use defaults if local preferences cannot be read. */ }
    const savedBitrate = localStorage.getItem("navigator-video-bitrate");
    if (
      savedBitrate &&
      BITRATE_OPTIONS.some((option) => option.value === savedBitrate)
    ) {
      setVideoBitrateState(savedBitrate);
    }

    const savedNavigatorEnabled = localStorage.getItem(
      "navigator-navigator-enabled"
    );
    if (savedNavigatorEnabled !== null) {
      setNavigatorEnabledState(savedNavigatorEnabled === "true");
    }

    const savedAiProvider = localStorage.getItem(
      "navigator-ai-provider"
    ) as AIProvider;
    if (
      savedAiProvider &&
      ["openai", "gemini", "ollama", "groq", "openrouter", "cerebras", "opencode"].includes(
        savedAiProvider
      )
    ) {
      setAiProviderState(savedAiProvider);
    }

    const savedOpenaiBaseUrl = localStorage.getItem("navigator-openai-base-url");
    if (savedOpenaiBaseUrl) {
      setOpenaiBaseUrlState(savedOpenaiBaseUrl);
    }

    if (localStorage.getItem("navigator-openai-auth-method") === "chatgpt") setOpenaiAuthMethodState("chatgpt");
    setChatGPTModelState(localStorage.getItem("navigator-chatgpt-model") ?? "");

    const savedOpenaiModel = localStorage.getItem("navigator-openai-model");
    if (savedOpenaiModel) {
      setOpenaiModelState(savedOpenaiModel);
    }

    const savedGeminiModel = localStorage.getItem("navigator-gemini-model");
    if (savedGeminiModel) {
      setGeminiModelState(savedGeminiModel);
    }

    const savedOllamaBaseUrl = localStorage.getItem("navigator-ollama-base-url");
    if (savedOllamaBaseUrl) {
      setOllamaBaseUrlState(savedOllamaBaseUrl);
    }

    const savedOllamaModel = localStorage.getItem("navigator-ollama-model");
    if (savedOllamaModel) {
      setOllamaModelState(savedOllamaModel);
    }

    const savedGroqModel = localStorage.getItem("navigator-groq-model");
    if (savedGroqModel) {
      setGroqModelState(savedGroqModel);
    }

    const savedOpenrouterModel = localStorage.getItem(
      "navigator-openrouter-model"
    );
    if (savedOpenrouterModel) {
      setOpenrouterModelState(savedOpenrouterModel);
    }

    const savedOpenrouterReasoningEffort = localStorage.getItem(
      "navigator-openrouter-reasoning-effort"
    ) as OpenRouterReasoningEffort | null;
    if (
      savedOpenrouterReasoningEffort &&
      ["default", "none", "minimal", "low", "medium", "high", "xhigh"].includes(
        savedOpenrouterReasoningEffort
      )
    ) {
      setOpenrouterReasoningEffortState(savedOpenrouterReasoningEffort);
    }
    const savedCerebrasModel = localStorage.getItem("navigator-cerebras-model");
    if (savedCerebrasModel) {
      setCerebrasModelState(savedCerebrasModel);
    }
    const savedCerebrasReasoningEffort = localStorage.getItem(
      "navigator-cerebras-reasoning-effort"
    ) as CerebrasReasoningEffort | null;
    if (
      savedCerebrasReasoningEffort &&
      ["default", "low", "medium", "high"].includes(savedCerebrasReasoningEffort)
    ) {
      setCerebrasReasoningEffortState(savedCerebrasReasoningEffort);
    }
    const savedOpencodeModel = localStorage.getItem("navigator-opencode-model");
    if (savedOpencodeModel) {
      setOpencodeModelState(savedOpencodeModel);
    }

    // Load API key settings
    setOllamaApiKeyState(localStorage.getItem("navigator-ollama-api-key") || "");
    const savedOpenaiApiKey = localStorage.getItem("navigator-openai-api-key");
    if (savedOpenaiApiKey) {
      setOpenaiApiKeyState(savedOpenaiApiKey);
    }

    const savedGoogleApiKey = localStorage.getItem("navigator-google-api-key");
    if (savedGoogleApiKey) {
      setGoogleApiKeyState(savedGoogleApiKey);
    }

    const savedGroqApiKey = localStorage.getItem("navigator-groq-api-key");
    if (savedGroqApiKey) {
      setGroqApiKeyState(savedGroqApiKey);
    }

    const savedOpenrouterApiKey = localStorage.getItem("navigator-openrouter-api-key");
    if (savedOpenrouterApiKey) {
      setOpenrouterApiKeyState(savedOpenrouterApiKey);
    }
    const savedCerebrasApiKey = localStorage.getItem("navigator-cerebras-api-key");
    if (savedCerebrasApiKey) {
      setCerebrasApiKeyState(savedCerebrasApiKey);
    }
    const savedOpencodeApiKey = localStorage.getItem("navigator-opencode-api-key");
    if (savedOpencodeApiKey) {
      setOpencodeApiKeyState(savedOpencodeApiKey);
    }
  }, []);

  // Save to localStorage when states change
  const setVideoBitrate = (bitrate: string) => {
    setVideoBitrateState(bitrate);
    localStorage.setItem("navigator-video-bitrate", bitrate);
  };

  const setNavigatorEnabled = (enabled: boolean) => {
    setNavigatorEnabledState(enabled);
    localStorage.setItem("navigator-navigator-enabled", enabled.toString());
  };

  const setAiProvider = (provider: AIProvider) => {
    setAiProviderState(provider);
    localStorage.setItem("navigator-ai-provider", provider);
  };

  const setOpenaiBaseUrl = (url: string) => {
    setOpenaiBaseUrlState(url);
    localStorage.setItem("navigator-openai-base-url", url);
  };

  const setOpenaiAuthMethod = (method: OpenAIAuthMethod) => {
    setOpenaiAuthMethodState(method);
    localStorage.setItem("navigator-openai-auth-method", method);
  };

  const setChatGPTModel = (model: string) => {
    setChatGPTModelState(model);
    localStorage.setItem("navigator-chatgpt-model", model);
  };

  const setOpenaiModel = (model: string) => {
    setOpenaiModelState(model);
    localStorage.setItem("navigator-openai-model", model);
  };

  const setGeminiModel = (model: string) => {
    setGeminiModelState(model);
    localStorage.setItem("navigator-gemini-model", model);
  };

  const setOllamaBaseUrl = (url: string) => {
    setOllamaBaseUrlState(url);
    localStorage.setItem("navigator-ollama-base-url", url);
  };

  const setOllamaModel = (model: string) => {
    setOllamaModelState(model);
    localStorage.setItem("navigator-ollama-model", model);
  };

  const setGroqModel = (model: string) => {
    setGroqModelState(model);
    localStorage.setItem("navigator-groq-model", model);
  };

  const setOpenrouterModel = (model: string) => {
    setOpenrouterModelState(model);
    localStorage.setItem("navigator-openrouter-model", model);
  };

  const setOpenrouterReasoningEffort = (effort: OpenRouterReasoningEffort) => {
    setOpenrouterReasoningEffortState(effort);
    localStorage.setItem("navigator-openrouter-reasoning-effort", effort);
  };
  const setCerebrasModel = (model: string) => {
    setCerebrasModelState(model);
    localStorage.setItem("navigator-cerebras-model", model);
  };
  const setCerebrasReasoningEffort = (effort: CerebrasReasoningEffort) => {
    setCerebrasReasoningEffortState(effort);
    localStorage.setItem("navigator-cerebras-reasoning-effort", effort);
  };
  const setOpencodeModel = (model: string) => {
    setOpencodeModelState(model);
    localStorage.setItem("navigator-opencode-model", model);
  };

  // API Key setters
  const setOllamaApiKey = (key: string) => {
    setOllamaApiKeyState(key);
    localStorage.setItem("navigator-ollama-api-key", key);
  };
  const setOpenaiApiKey = (key: string) => {
    setOpenaiApiKeyState(key);
    localStorage.setItem("navigator-openai-api-key", key);
  };

  const setGoogleApiKey = (key: string) => {
    setGoogleApiKeyState(key);
    localStorage.setItem("navigator-google-api-key", key);
  };

  const setGroqApiKey = (key: string) => {
    setGroqApiKeyState(key);
    localStorage.setItem("navigator-groq-api-key", key);
  };

  const setOpenrouterApiKey = (key: string) => {
    setOpenrouterApiKeyState(key);
    localStorage.setItem("navigator-openrouter-api-key", key);
  };
  const setCerebrasApiKey = (key: string) => {
    setCerebrasApiKeyState(key);
    localStorage.setItem("navigator-cerebras-api-key", key);
  };
  const setOpencodeApiKey = (key: string) => {
    setOpencodeApiKeyState(key);
    localStorage.setItem("navigator-opencode-api-key", key);
  };

  return (
    <SettingsContext.Provider
      value={{
        playbackPreferences, updatePlaybackPreferences,
        subtitlePosition, setSubtitlePosition, subtitleSize, setSubtitleSize, subtitleOutline, setSubtitleOutline,
        subtitleWeight, setSubtitleWeight, subtitleColor, setSubtitleColor, resetSubtitleAppearance,
        videoBitrate,
        setVideoBitrate,
        navigatorEnabled,
        setNavigatorEnabled,
        aiProvider,
        setAiProvider,
        openaiBaseUrl,
        setOpenaiBaseUrl,
        openaiAuthMethod,
        setOpenaiAuthMethod,
        chatGPTModel,
        setChatGPTModel,
        openaiModel,
        setOpenaiModel,
        geminiModel,
        setGeminiModel,
        ollamaApiKey,
        setOllamaApiKey,
        ollamaBaseUrl,
        setOllamaBaseUrl,
        ollamaModel,
        setOllamaModel,
        groqModel,
        setGroqModel,
        openrouterModel,
        setOpenrouterModel,
        openrouterReasoningEffort,
        setOpenrouterReasoningEffort,
        cerebrasModel,
        setCerebrasModel,
        cerebrasReasoningEffort,
        setCerebrasReasoningEffort,
        opencodeModel,
        setOpencodeModel,
        openaiApiKey,
        setOpenaiApiKey,
        googleApiKey,
        setGoogleApiKey,
        groqApiKey,
        setGroqApiKey,
        openrouterApiKey,
        setOpenrouterApiKey,
        cerebrasApiKey,
        setCerebrasApiKey,
        opencodeApiKey,
        setOpencodeApiKey,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
