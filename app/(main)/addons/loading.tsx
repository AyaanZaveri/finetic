import { Skeleton } from "@/components/ui/skeleton";
import styles from "@/components/addons-list.module.css";

export default function AddonsLoading() {
    return (
        <>
            <p role="status" className="sr-only">Loading add-ons…</p>
            <ul aria-hidden="true" className={styles.list}>
                {Array.from({ length: 6 }, (_, index) => (
                    <li key={index} className={styles.row}>
                        <Skeleton className="size-10 rounded-[10px]" />
                        <div className={styles.identity}>
                            <div className="flex h-[22.5px] items-center gap-2">
                                <Skeleton className="h-4 w-[28%]" />
                                <Skeleton className="h-3 w-12" />
                            </div>
                            <div className="mt-1.5 flex h-[22.4px] items-center">
                                <Skeleton className="h-3.5 w-[70%] max-w-sm" />
                            </div>
                            <div className="mt-2 flex h-[18px] items-center">
                                <Skeleton className="h-3 w-[40%]" />
                            </div>
                        </div>
                        <div className={styles.metadata}>
                            <div className={styles.capabilities}>
                                <Skeleton className="h-[22px] w-16 rounded-full" />
                                <Skeleton className="h-[22px] w-[70px] rounded-full" />
                            </div>
                            <div className={styles.actions}>
                                <Skeleton className="h-9 w-[86px] rounded-xl" />
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}
