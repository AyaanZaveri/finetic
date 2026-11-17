"use client";

import { UserRound } from "lucide-react";
import { ResultCard, ResultMeta } from "./result-card";

export function PersonCard({ person, index = 0 }: {
    person: { id: number; name: string; poster?: string; department?: string; biography?: string; birthday?: string; birthplace?: string; knownFor?: { name: string }[] };
    index?: number;
}) {
    return <ResultCard
        title={person.name}
        subtitle={person.knownFor?.length ? `Known for ${person.knownFor.map(title => title.name).join(", ")}` : undefined}
        icon={UserRound}
        image={person.poster}
        href={`/person/${person.id}`}
        index={index}
        metadata={person.department ? <ResultMeta>{person.department}</ResultMeta> : undefined}
        description={person.birthday || person.biography ? <>
            {person.birthday && <span className="block">Born {person.birthday}{person.birthplace ? ` · ${person.birthplace}` : ""}</span>}
            {person.biography && <span className="line-clamp-3">{person.biography}</span>}
        </> : undefined}
    />;
}
