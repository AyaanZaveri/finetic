"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/arc/select/select";
import { SETTINGS_CATEGORIES, isSettingsCategory, settingsCategoryFromPath, type SettingsCategory } from "@/lib/settings-navigation";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import styles from "@/app/(main)/settings/settings.module.css";

type SettingsNavigation = {
    category: SettingsCategory;
    href: (category: SettingsCategory) => string;
    select: (category: SettingsCategory) => void;
};

export function SettingsShell({ children, navigation }: { children: ReactNode; navigation?: SettingsNavigation }) {
    const pathname = usePathname();
    const router = useRouter();
    const active = navigation?.category ?? settingsCategoryFromPath(pathname);
    const category = SETTINGS_CATEGORIES.find(category => category.id === active)!;
    const titleRef = useRef<HTMLHeadingElement>(null);
    const currentLocation = navigation?.category ?? pathname;
    const previousLocation = useRef(currentLocation);
    const selectionId = useId();
    const reducedMotion = useReducedMotion();
    const [animateSelection, setAnimateSelection] = useState(true);

    useEffect(() => {
        document.title = `${category.label} settings · Navigator`;
        if (previousLocation.current !== currentLocation) {
            document.querySelector<HTMLElement>("[data-page-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
            titleRef.current?.focus({ preventScroll: true });
        }
        previousLocation.current = currentLocation;
    }, [currentLocation, category.label]);

    return <div className={styles.page}>
        <div className={`${styles.content} ${styles.workspace}`}>
            <aside className={styles.sidebar}>
                <nav aria-label="Settings"
                    onKeyDownCapture={() => setAnimateSelection(false)}
                    onPointerDownCapture={() => setAnimateSelection(true)}>
                    <LayoutGroup id={selectionId}><ul className={styles.navigationList}>
                        {SETTINGS_CATEGORIES.map(item => <li key={item.id}>
                            <Link draggable={false} className={styles.navigationLink} href={navigation?.href(item.id) ?? `/settings/${item.id}`}
                                prefetch={navigation ? false : undefined}
                                onNavigate={navigation ? event => { event.preventDefault(); navigation.select(item.id); } : undefined}
                                aria-current={active === item.id ? "page" : undefined}>
                                {active === item.id && <motion.span className={styles.navigationSelection}
                                    layoutId="settings-selection" layoutDependency={active} initial={false}
                                    transition={reducedMotion || !animateSelection ? { duration: 0 } : motionTokens.spring.snappy}
                                    aria-hidden="true" />}
                                <span className={styles.navigationLabel}>{item.label}</span>
                            </Link>
                        </li>)}
                    </ul></LayoutGroup>
                </nav>
            </aside>
            <div className={styles.mobileNavigation}>
                <Select id="settings-category" label="Settings" value={active}
                    onValueChange={value => {
                        if (navigation) {
                            if (isSettingsCategory(value)) navigation.select(value);
                        }
                        else router.push(`/settings/${value}`);
                    }}
                    options={SETTINGS_CATEGORIES.map(category => ({ value: category.id, label: category.label }))} />
            </div>
            <div className={styles.panel} data-category={active}>
                <header className={styles.pageHeader}>
                    <h1 ref={titleRef} tabIndex={-1} className={styles.pageTitle}>{category.label}</h1>
                </header>
                <div className={styles.sections}>{children}</div>
            </div>
        </div>
    </div>;
}
