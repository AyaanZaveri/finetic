import { notFound } from "next/navigation";
import ArtworkRevealFixture from "./fixture";

export default function ArtworkRevealPage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <ArtworkRevealFixture />;
}
