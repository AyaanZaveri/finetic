import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export default function StatesLayout({ children }: { children: ReactNode }) {
    if (process.env.NODE_ENV !== "development") notFound();
    return children;
}
