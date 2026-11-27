import { notFound } from "next/navigation";
import CollectionWorkbench from "./workbench";

export default function Page() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <CollectionWorkbench />;
}
