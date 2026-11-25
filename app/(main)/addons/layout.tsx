import type { ReactNode } from "react";
import { AddonDirectory } from "@/components/addons-list";

export default function AddonsLayout({ children }: { children: ReactNode }) {
    return (
        <div className="relative px-[var(--page-gutter)] py-6">
            <div className="relative z-10 flex w-full min-w-0 flex-col gap-6 pb-10">
                <header>
                    <h1 className="font-poppins text-3xl font-medium tracking-tight">Add-ons</h1>
                </header>
                <AddonDirectory>{children}</AddonDirectory>
            </div>
        </div>
    );
}
