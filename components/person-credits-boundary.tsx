"use client";

import type { ReactNode } from "react";
import { SkeletonSuspense, SkulletProvider } from "skullet/react";
import styles from "./person-credits-boundary.module.css";

export function PersonCreditsBoundary({ children, sample }: { children: ReactNode; sample: ReactNode }) {
    return <div className={styles.surface}>
        <SkulletProvider theme={{ animation: "pulse", speed: "slow", radius: "4px" }}
            reveal={{ order: "together", duration: 180, hold: 150 }}>
            <SkeletonSuspense skeleton={sample} label="Loading person credits">
                {children}
            </SkeletonSuspense>
        </SkulletProvider>
    </div>;
}
