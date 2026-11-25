"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ScanLibraryButtonProps {
  libraryId?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}

// Library scanning is not supported with Stremio.
export function ScanLibraryButton({
  variant = "outline",
  size = "default",
  className,
}: ScanLibraryButtonProps) {
  return (
    <Button
      onClick={() => toast.info("Library scanning is not available with Stremio")}
      variant={variant}
      size={size}
      className={className}
    >
      <RefreshCw className="h-4 w-4" />
      Scan Library
    </Button>
  );
}
