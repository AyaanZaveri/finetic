"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import type { ProductionCompany } from "@/lib/tmdb-discovery";
import titleStyles from "./title-detail.module.css";

function ProductionCompanyLogo({ company }: { company: ProductionCompany }) {
    const [failed, setFailed] = useState<string>();
    const logo = company.logo && failed !== company.logo ? company.logo : undefined;
    return <span className={`flex h-14 w-full items-center justify-center rounded-md px-3 py-2 ${logo ? "bg-white" : "bg-muted"}`}>
        {logo ? <img src={logo} alt="" loading="lazy" decoding="async" draggable={false}
            onError={() => setFailed(logo)} className="max-h-full max-w-full object-contain" />
            : <Building2 className="size-5 text-muted-foreground" aria-hidden="true" />}
    </span>;
}

export function ProductionCompaniesSection({ companies }: { companies: ProductionCompany[] }) {
    if (!companies.length) return null;
    return <section aria-label="Production companies" className={`${titleStyles.sectionGutter} relative z-10 mt-6 mb-8 px-4 md:px-10`}>
        <h2 className="mb-4 text-xl font-semibold sm:text-2xl">Production companies</h2>
        <ul className="m-0 flex list-none flex-wrap gap-4 p-0">
            {companies.map(company => <li key={company.id} className="flex w-28 max-w-full min-w-0 flex-col gap-2">
                <ProductionCompanyLogo company={company} />
                <span className="wrap-anywhere text-xs font-medium text-muted-foreground">{company.name}</span>
            </li>)}
        </ul>
    </section>;
}
