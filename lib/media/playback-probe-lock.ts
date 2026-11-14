/** Limit expensive WebGPU probes to one decoder/GPU session at a time. The
 * caller's deadline includes time spent waiting for the previous probe. */
let tail = Promise.resolve();
export async function acquirePlaybackProbe(signal: AbortSignal): Promise<(() => void) | undefined> {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const previous = tail;
    tail = previous.then(() => next);
    let abort!: () => void;
    const cancelled = new Promise<false>(resolve => { abort = () => resolve(false); });
    signal.addEventListener("abort", abort, { once: true });
    const acquired = await Promise.race([previous.then(() => true), cancelled, ...(signal.aborted ? [Promise.resolve(false)] : [])]);
    signal.removeEventListener("abort", abort);
    if (!acquired || signal.aborted) { release(); return; }
    return release;
}
