"use client";

import { useEffect } from "react";
import { installButtonDragPrevention } from "@/lib/button-drag";
import { installInputModality } from "@/lib/input-modality";

export function InputModality() {
    useEffect(() => {
        const removeModality = installInputModality(document);
        const removeDragPrevention = installButtonDragPrevention(document);
        return () => { removeModality(); removeDragPrevention(); };
    }, []);
    return null;
}
