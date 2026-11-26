import styles from "./home-catalog-skeleton.module.css";

export const CATALOG_ROW_HEIGHT = 360;

export function HomeCatalogSkeleton() {
    return <div aria-hidden="true" data-home-catalog-placeholder="" className={styles.placeholder} style={{ minHeight: CATALOG_ROW_HEIGHT }} />;
}
