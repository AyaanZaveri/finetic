import { Skeleton } from "@/components/ui/skeleton";
import styles from "@/components/person-page.module.css";

export default function PersonLoading() {
    return <div className={styles.page} aria-busy="true" aria-label="Loading person details">
        <div className={styles.profile}>
            <Skeleton className={styles.portrait} />
            <div className="space-y-6"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24 w-full max-w-2xl" /></div>
        </div>
        <Skeleton className="mb-6 h-8 w-40" />
        <div className={styles.grid}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl" />)}</div>
    </div>;
}
