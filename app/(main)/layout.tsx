import { MetadataPreloadPolicy } from "@/components/metadata-preload";
import type { ReactNode } from "react";
import { JotaiProvider } from "@/components/jotai-provider";
import { FullscreenDetector } from "@/components/fullscreen-detector";
import { SettingsShortcut } from "@/components/settings-shortcut";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { LayoutContent } from "@/components/layout-content";
import { WatchHistoryProvider } from "@/contexts/watch-history-context";
import { AccountProvider } from "@/components/account-provider";

import { getAuthData } from "@/lib/server/auth";
import { StreamQueryProvider } from "@/components/stream-query-provider";

export default async function MainLayout({
    children,
}: {
  children: ReactNode;
}) {
    const session = await getAuthData().catch(() => null);
    const user = session?.user;
    const scope = session ? `${session.user._id}:${session.issuedAt}` : "anonymous";

    return (
        <JotaiProvider key={scope}>
            <StreamQueryProvider key={scope} scope={scope}>
                <AccountProvider key={user?._id ?? "anonymous"} authenticated={Boolean(user)}>
                    <MetadataPreloadPolicy />
                    <FullscreenDetector />
                    <KeyboardShortcuts />
                    <SettingsShortcut />
                    <WatchHistoryProvider key={user?._id ?? "anonymous"} enabled={Boolean(user)}>
                        <LayoutContent email={user?.email ?? ""} userId={user?._id ?? ""}>{children}</LayoutContent>
                    </WatchHistoryProvider>
                </AccountProvider>
            </StreamQueryProvider>
        </JotaiProvider>
    );
}
