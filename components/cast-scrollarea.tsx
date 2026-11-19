"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CarouselAction } from "@/components/carousel-action";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CastMember } from "@/lib/cast";

function CastRole({ role, name }: { role: string; name: string }) {
    const textRef = useRef<HTMLSpanElement>(null);
    const [truncated, setTruncated] = useState(false);
    const [open, setOpen] = useState(false);
    const openOnPress = useRef(false);

    useEffect(() => {
        const text = textRef.current;
        if (!text) return;
        const measure = () => setTruncated(text.scrollHeight > text.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(text);
        return () => observer.disconnect();
    }, [role, truncated]);

    const text = <span ref={textRef} className="line-clamp-2 break-words">{role}</span>;
    const className = "mt-1 block w-full text-center text-[13px] leading-snug text-muted-foreground";
    if (!truncated) return <p className={className}>{text}</p>;

    return (
        <Tooltip open={open} onOpenChange={setOpen} delayDuration={300}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className={`${className} cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/22`}
                    aria-label={`Show full role for ${name}`}
                    onPointerDown={() => { openOnPress.current = open; }}
                    onClick={event => {
                        // Radix normally closes tooltips on click; keep tapping
                        // usable as the equivalent of hover on touch screens.
                        event.preventDefault();
                        if (event.detail === 0) setOpen(current => !current);
                        else setOpen(!openOnPress.current);
                    }} draggable={false}
                >
                    {text}
                </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={2} collisionPadding={16} className="max-w-[min(20rem,calc(100vw-2rem))] break-words text-start leading-relaxed">
                <div className="max-h-[min(20rem,60dvh)] overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {role}
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

export function CastScrollArea({ cast }: { cast: CastMember[] }) {
    const headingId = useId();
    const viewport = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ start: true, end: false });
    const updatePosition = () => {
        const element = viewport.current;
        if (element) setPosition({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    };
    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const observer = new ResizeObserver(updatePosition);
        observer.observe(element);
        updatePosition();
        return () => observer.disconnect();
    }, [cast]);

    const scroll = (direction: number) => {
        const element = viewport.current;
        if (!element) return;
        element.scrollBy({
            left: direction * element.clientWidth * 0.8,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
    };

    if (!cast.length) return null;

    return (
        <section aria-labelledby={headingId} className="relative z-10">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id={headingId} className="font-poppins text-xl font-semibold text-foreground sm:text-2xl">Cast</h2>
                <div className="flex shrink-0 items-center gap-2">
                    <CarouselAction size="icon-sm" aria-label="Scroll cast left" disabled={position.start} onClick={() => scroll(-1)}>
                        <ChevronLeft className="size-4" />
                    </CarouselAction>
                    <CarouselAction size="icon-sm" aria-label="Scroll cast right" disabled={position.end} onClick={() => scroll(1)}>
                        <ChevronRight className="size-4" />
                    </CarouselAction>
                </div>
            </div>
            <div ref={viewport} onScroll={updatePosition} tabIndex={0} role="region" aria-label="Cast members" className="overflow-x-auto overscroll-x-contain rounded-lg pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/22">
                <ul className="flex w-max gap-6">
                    {cast.map((member) => (
                        <li key={member.id} className="w-28 shrink-0 text-center motion-safe:transition-[scale] motion-safe:duration-150 motion-safe:ease-[var(--ease-out)] motion-safe:has-[>a:active]:scale-[0.98]">
                            <CastProfile member={member} />
                            {member.role && <CastRole role={member.role} name={member.name} />}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

function CastProfile({ member }: { member: CastMember }) {
    const content = <>
        <Avatar className="mx-auto size-24 outline outline-1 -outline-offset-1 outline-black/5 dark:outline-transparent">
            {member.image && <AvatarImage src={member.image} alt="" loading="lazy" className="object-cover object-center" />}
            <AvatarFallback aria-hidden="true" className="text-2xl font-medium text-muted-foreground">
                {member.name.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join("")}
            </AvatarFallback>
        </Avatar>
        <p className="mt-3 break-words text-sm font-semibold leading-snug text-foreground">{member.name}</p>
    </>;
    // Add-on fallback names are not TMDB IDs and cannot open a person lookup.
    return /^[1-9]\d*$/.test(member.id)
        ? <Link href={`/person/${member.id}`} prefetch={false} draggable={false} className="block rounded-lg outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/22">{content}</Link>
        : <div>{content}</div>;
}
