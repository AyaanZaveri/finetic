import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppUpdateWorkbench } from "./workbench";

export default function AppUpdateStates() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <Suspense><AppUpdateWorkbench /></Suspense>;
}
