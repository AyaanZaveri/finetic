import styles from "./person-page.module.css";
import carousel from "./media-section.module.css";

// Measurement-only markup. No real cards, image URLs, playback hooks, or
// observers: rendering the sample must never start media or metadata requests.
function PosterSample() {
    return <>
        <div skullet-block="" className="aspect-[2/3] w-full rounded-lg" />
        <div className="px-1">
            <p className="mt-2.5 text-sm font-medium leading-snug">A familiar title</p>
            <p className="mt-0.5 text-xs">2024 · Movie</p>
        </div>
    </>;
}

export function PersonCreditsSample() {
    return <>
        <section className="mb-8">
            <div className={styles.heading}><h2>Known for</h2></div>
            <div className={carousel.viewport}>
                <ul className={carousel.track}>
                    {Array.from({ length: 8 }, (_, index) => <li key={index} className="w-36 shrink-0"><PosterSample /></li>)}
                </ul>
            </div>
        </section>
        <section>
            <div className={styles.heading}><h2>Filmography</h2><span className={styles.count}>40 titles</span></div>
            <div className={styles.toolbar}>
                <div skullet-block="" className="h-10 w-56 max-w-full rounded-[var(--radius-control)]" />
                <div skullet-block="" className="h-10 w-60 max-w-full rounded-[var(--radius-control)]" />
            </div>
            <div className={styles.grid}>
                {Array.from({ length: 12 }, (_, index) => <div key={index} className="min-w-0"><PosterSample /></div>)}
            </div>
        </section>
    </>;
}
