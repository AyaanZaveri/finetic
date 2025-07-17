"use client";

import React, { useState, useEffect } from "use-strict";
import { useAuthStore } from "@/lib/auth-store";
import { JellyfinItem } from "@/types/jellyfin";
import { MediaCard } from "./media-card";
import { Skeleton } from "./ui/skeleton";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";

export function ContinueWatching() {
  const { fetchInProgressItems } = useAuthStore();
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadItems = async () => {
      setIsLoading(true);
      try {
        const inProgressItems = await fetchInProgressItems();
        setItems(inProgressItems);
      } catch (error) {
        console.error("Failed to load in-progress items:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadItems();
  }, [fetchInProgressItems]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/4" />
        <div className="flex space-x-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-40 w-72" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Continue Watching</h2>
      <ScrollArea>
        <div className="flex space-x-4 pb-4">
          {items.map((item) => (
            <MediaCard key={item.Id} item={item} />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
