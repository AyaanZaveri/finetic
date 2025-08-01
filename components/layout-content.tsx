"use client";

import { useAtom } from "jotai";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import AIAsk from "@/components/ai-ask";
import { GlobalMediaPlayer } from "@/components/global-media-player";
import {
  isAIAskOpenAtom,
  isElectronMacAtom,
  isElectronFullscreenAtom,
  isFullscreenAtom,
} from "@/lib/atoms";

interface LayoutContentProps {
  children: React.ReactNode;
}

export function LayoutContent({ children }: LayoutContentProps) {
  const [isAIAskOpen, setIsAIAskOpen] = useAtom(isAIAskOpenAtom);
  const [isElectronMac] = useAtom(isElectronMacAtom);
  const [isElectronFullscreen] = useAtom(isElectronFullscreenAtom);
  const [isFullscreen] = useAtom(isFullscreenAtom);

  // Function to handle opening AI Ask with fullscreen exit if needed
  const handleToggleAIAsk = async () => {
    if (isFullscreen && !isAIAskOpen) {
      // Exit fullscreen first when opening AI Ask
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
        // Wait a bit for fullscreen to exit, then open AI Ask
        setTimeout(() => {
          setIsAIAskOpen(true);
        }, 100);
      } catch (error) {
        console.warn("Failed to exit fullscreen:", error);
        // Still try to open AI Ask even if fullscreen exit fails
        setIsAIAskOpen((prev) => !prev);
      }
    } else {
      setIsAIAskOpen((prev) => !prev);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <SidebarProvider>
        <AppSidebar
          isElectronMac={isElectronMac}
          isElectronFullscreen={isElectronFullscreen}
        />
        <SidebarInset
          className={`flex-1 overflow-hidden ${isElectronMac && !isElectronFullscreen ? "pl-2.5" : ""}`}
        >
          <div className="flex-1 overflow-y-auto no-scrollbar">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <AIAsk />
      <GlobalMediaPlayer onToggleAIAsk={handleToggleAIAsk} />
    </div>
  );
}
