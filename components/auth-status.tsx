"use client";

import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";

export function AuthStatus() {
  const { user, isAuthenticated, isLoading, logout, isTokenExpired } =
    useAuth();

  const handleLogout = async () => {
    logout();
  };

  if (isLoading) {
    return <div>Loading account status…</div>;
  }

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Account status</h2>

      {isAuthenticated ? (
        <div className="space-y-2">
          <div className="text-green-600">✓ Signed in</div>
          <div>
            <strong>Email:</strong> {user?.email}
          </div>
          <div>
            <strong>User ID:</strong> {user?._id}
          </div>
          <div>
            <strong>Token expired:</strong>{" "}
            {isTokenExpired() ? "Yes" : "No"}
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600" draggable={false}
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-red-600">✗ Signed out</div>
          <p className="text-muted-foreground">
            Sign in with your Stremio account
          </p>
        </div>
      )}
    </div>
  );
}
