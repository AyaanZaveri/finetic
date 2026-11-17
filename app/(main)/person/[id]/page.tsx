import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTMDBFilmographyItems, getTMDBPerson } from "@/lib/tmdb-discovery";
import { getTMDBWebsiteKnownFor } from "@/lib/tmdb-known-for";
import { ArtworkImage } from "@/components/artwork-image";
import { PersonCreditsBoundary } from "@/components/person-credits-boundary";
import { PersonCreditsSample } from "@/components/person-credits-sample";
import { PersonFilmography } from "@/components/person-filmography";
import { MediaSection } from "@/components/media-section";
import { Accordion } from "@/components/arc/accordion/accordion";
import { ImdbIcon } from "@/components/icons/imdb";
import { TmdbIcon } from "@/components/icons/tmdb";
import { HomeInitialPalette } from "@/components/home-palette-provider";
import { Button } from "@/components/ui/button";
import { PersonRetryButton } from "@/components/person-page-controls";
import styles from "@/components/person-page.module.css";

const getPerson = cache(getTMDBPerson);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return { title: "Person · Navigator" };
    const person = await getPerson(Number(id)).catch(() => null);
    return { title: person ? `${person.name} · Navigator` : "Person · Navigator" };
}

function dateLabel(value: string) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

async function Filmography({ id, name }: { id: number; name: string }) {
    let items;
    let knownFor;
    try {
        items = await getTMDBFilmographyItems(id);
        knownFor = await getTMDBWebsiteKnownFor(id, name, items).catch(() => []);
    } catch (error) {
        return <div className={styles.message} role="alert"><p>{error instanceof Error ? error.message : "Filmography could not load."}</p><PersonRetryButton /></div>;
    }
    return <>
        {!!knownFor.length && <MediaSection sectionName="Known for" mediaItems={knownFor} revealArtwork={false} />}
        <section id="filmography" aria-labelledby="filmography-heading" className={styles.section}>
            <PersonFilmography key={id} id={id} items={items} />
        </section>
    </>;
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) notFound();
    const id = Number(rawId);
    let person;
    let failure: string | undefined;
    try { person = await getPerson(id); }
    catch (error) { failure = error instanceof Error ? error.message : "Person details could not load."; }
    if (failure?.includes("not found on TMDB")) notFound();
    if (!person) return <div className={styles.page}><div className={styles.message} role="alert">
        <h1 className="text-2xl font-semibold">Person details couldn’t load</h1><p>{failure}</p>
        <div className={styles.links}><PersonRetryButton /><Button asChild variant="outline"><Link href="/settings/connections">Connection settings</Link></Button></div>
    </div></div>;
    const biography = person.biography?.trim();
    const paragraphEnd = biography?.indexOf("\n\n") ?? -1;
    const breakAt = paragraphEnd > 0 && paragraphEnd < 650 ? paragraphEnd : biography?.lastIndexOf(" ", 650) ?? -1;
    const expandable = !!biography && biography.length > 700 && breakAt > 0;
    return <div className={styles.page}>
        <HomeInitialPalette primary={person.poster} resetInteraction />
        <header className={styles.profile}>
            <ArtworkImage src={person.poster} alt={person.name} fallbackText="Photo unavailable" width={300} height={450} className={styles.portrait} reveal={false} />
            <div className={styles.copy}>
                {person.department && <p className={styles.department}>{person.department}</p>}
                <h1 className={styles.name}>{person.name}</h1>
                <dl className={styles.facts}>
                    {person.birthday && <div><dt>Born</dt><dd><time dateTime={person.birthday}>{dateLabel(person.birthday)}</time></dd></div>}
                    {person.deathday && <div><dt>Died</dt><dd><time dateTime={person.deathday}>{dateLabel(person.deathday)}</time></dd></div>}
                    {person.birthplace && <div><dt>Place of birth</dt><dd>{person.birthplace}</dd></div>}
                </dl>
                <div className={styles.links}>
                    {person.imdbUrl && <Button asChild variant="ghost" size="md"><a draggable={false} href={person.imdbUrl} target="_blank" rel="noopener noreferrer" aria-label="IMDb (opens in a new tab)" className={styles.brandLink}><span aria-hidden="true"><ImdbIcon size={40} className="size-auto" /></span><span className="sr-only"> (opens in a new tab)</span></a></Button>}
                    <Button asChild variant="ghost" size="md"><a draggable={false} href={person.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="TMDB (opens in a new tab)" className={styles.brandLink}><span aria-hidden="true"><TmdbIcon size={30} className="size-auto" /></span><span className="sr-only"> (opens in a new tab)</span></a></Button>
                </div>
                <div className={styles.biography}>
                    {biography ? <p>{expandable ? biography.slice(0, breakAt) : biography}</p> : <p>No biography is available on TMDB.</p>}
                    <div className={styles.disclosures}><Accordion size="sm" flush defaultOpen={-1} items={[
                        ...(expandable ? [{ title: `More about ${person.name}`, content: <p>{biography!.slice(breakAt).trim()}</p> }] : []),
                        ...(person.aliases.length ? [{ title: "Also known as", content: <p>{person.aliases.join(" · ")}</p> }] : []),
                    ]} /></div>
                </div>
            </div>
        </header>
        <PersonCreditsBoundary sample={<PersonCreditsSample />}>
            <Filmography id={id} name={person.name} />
        </PersonCreditsBoundary>
    </div>;
}
