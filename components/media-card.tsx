"use client";

import React from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";
import { Progress } from "./ui/progress";
import { JellyfinItem } from "@/types/jellyfin";

interface MediaCardProps {
  item: JellyfinItem;
}

export function MediaCard({ item }: MediaCardProps) {
  const { getImageUrl } = useAuthStore();
  const imageUrl = item.ImageTags?.Primary
    ? getImageUrl(item.Id, "Primary", item.ImageTags.Primary)
    : "";

  const href =
    item.Type === "Movie"
      ? `/movie/${item.Id}`
      : item.Type === "Episode"
      ? `/tv/${item.SeriesId}`
      : `/tv/${item.Id}`;

  const progress =
    item.UserData?.PlaybackPositionTicks && item.RunTimeTicks
      ? (item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100
      : 0;

  return (
    <Link href={href}>
      <div className="cursor-pointer group overflow-hidden rounded-lg w-72 transition active:scale-[0.98] select-none">
        <div className="relative aspect-video w-full">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={item.Name}
              className="w-full h-full object-cover transition duration-300 shadow-lg hover:brightness-85"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              draggable="false"
            />
          ) : (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center rounded-lg shadow-lg">
              <div className="text-white/60 text-sm">No Image</div>
            </div>
          )}
          {progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
              <Progress value={progress} className="h-1" />
            </div>
          )}
        </div>
        <div className="p-2">
          <h3 className="text-lg font-semibold truncate">{item.Name}</h3>
          <p className="text-sm text-muted-foreground">
            {item.Type === "Episode" ? `${item.SeriesName} - ${item.Name}` : item.Name}
          </p>
        </div>
      </div>
    </Link>
  );
}
