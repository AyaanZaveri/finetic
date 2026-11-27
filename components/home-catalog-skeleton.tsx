import styles from "./home-catalog-skeleton.module.css";
import { MediaSectionSkeleton } from "@/components/media-section-skeleton";

export const CATALOG_ROW_HEIGHT = 360;

export function HomeCatalogSkeleton() {
    return <div aria-hidden="true" data-home-catalog-placeholder="" className={styles.placeholder} style={{ minHeight: CATALOG_ROW_HEIGHT }}>
        <MediaSectionSkeleton />
    </div>;
}
