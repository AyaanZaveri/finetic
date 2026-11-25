import { notFound } from "next/navigation";
import MovieDetailWorkbench from "./workbench";

export default function MovieDetailStatesPage() {
    if (process.env.NODE_ENV !== "development") notFound();
    return <MovieDetailWorkbench />;
}
