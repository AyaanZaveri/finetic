"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import {
  Eye,
  Download,
  X,
  Copy,
  Search,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { fetchLogContent } from "@/app/actions/utils";
import { toast } from "sonner";
import type { LogEntry } from "./columns";
import { TextShimmer } from "../motion-primitives/text-shimmer";

interface LogViewerDialogProps {
  log: LogEntry;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LogViewerDialog({
  log,
  children,
  open: controlledOpen,
  onOpenChange,
}: LogViewerDialogProps) {
  const [logContent, setLogContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [internalOpen, setInternalOpen] = useState(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(true);
  const [isLiveMode, setIsLiveMode] = useState(true);
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const refreshIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? onOpenChange : setInternalOpen;

  useEffect(() => {
    if (open && !logContent) {
      loadLogContent(true);
    }

    if (open && isLiveMode) {
      refreshIntervalRef.current = setInterval(() => {
        loadLogContent(false);
      }, 1000);
    } else {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      if (!open) {
        setIsAutoScrolling(false);
        setShowScrollButton(true);
        setIsInitialLoad(true);
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [open, logContent, isLiveMode]);

  useEffect(() => {
    if (isAutoScrolling && logContent && !isInitialLoad) {
      scrollToBottom();
    }
  }, [logContent, isAutoScrolling, isInitialLoad]);

  const handleOpenChange = (newOpen: boolean) => {
    if (setOpen) {
      setOpen(newOpen);
    }
  };

  const loadLogContent = async (isInitial = false) => {
    if (isInitial) {
      setIsLoading(true);
      setIsInitialLoad(true);
    }
    try {
      const content = await fetchLogContent(log.Name!);
      setLogContent(content);
      if (isInitial) {
        setIsInitialLoad(false);
      }
    } catch (error) {
      console.error("Failed to load log content:", error);
      toast.error("Failed to load log content");
    } finally {
      if (isInitial) {
        setIsLoading(false);
      }
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(logContent);
    toast.success("Log content copied to clipboard");
  };

  const downloadLog = () => {
    const blob = new Blob([logContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = log.Name!;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  };

  const handleScrollToBottomClick = () => {
    setIsAutoScrolling(true);
    setShowScrollButton(false);
    scrollToBottom();
  };

  const highlightSearchTerm = (text: string) => {
    if (!searchTerm) return text;
    const regex = new RegExp(`(${searchTerm})`, "gi");
    return text.replace(
      regex,
      '<mark class="bg-yellow-300 dark:bg-yellow-600 rounded px-0.5">$1</mark>'
    );
  };

  const filteredContent = searchTerm
    ? logContent
        .split("\n")
        .filter((line) =>
          line.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .join("\n")
    : logContent;

  const lineCount = filteredContent.split("\n").length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl w-full max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {log.Name}
          </DialogTitle>
          <DialogDescription>
            Log file viewer
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={isLiveMode}
              onCheckedChange={setIsLiveMode}
              id="live-mode"
            />
            <label htmlFor="live-mode" className="text-sm">
              Live
            </label>
          </div>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={downloadLog}>
            <Download className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{lineCount} lines</Badge>
          {searchTerm && (
            <Badge variant="secondary">Filtered</Badge>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0 border rounded-md" ref={scrollAreaRef}>
          <div className="p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">Loading log content...</span>
              </div>
            ) : (
              <pre data-selectable-text="" className="text-xs font-mono whitespace-pre-wrap break-words">
                {searchTerm ? (
                  <span
                    dangerouslySetInnerHTML={{
                      __html: highlightSearchTerm(filteredContent),
                    }}
                  />
                ) : (
                  filteredContent || "No log content available."
                )}
              </pre>
            )}
          </div>
        </ScrollArea>

        {showScrollButton && !isLoading && logContent && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleScrollToBottomClick}
            >
              <ChevronDown className="h-4 w-4 mr-1" />
              Scroll to bottom
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
