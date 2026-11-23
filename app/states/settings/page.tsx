import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SettingsWorkbench } from "./workbench";

export default function SettingsStatesPage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <Suspense><SettingsWorkbench /></Suspense>;
}
