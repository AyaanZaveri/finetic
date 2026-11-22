import { redirect } from "next/navigation";
import { timingStates } from "../player-selection/subtitle-fixtures";

export default async function SubtitleTimingStates({ searchParams }: {
    searchParams: Promise<{ __state?: string | string[] }>;
}) {
    const { __state: state } = await searchParams;
    const timing = timingStates.find(item => item.id === `timing-${state}`) ?? timingStates[0];
    redirect(`/states/player-selection?__state=${timing.id}`);
}
