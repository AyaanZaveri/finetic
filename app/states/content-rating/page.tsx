import { notFound } from "next/navigation";
import ContentRatingWorkbench from "./workbench";

export default function ContentRatingStatesPage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <ContentRatingWorkbench />;
}
