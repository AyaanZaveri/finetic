/** Watch the selected browser audio track until playback resumes. AudioTrack
 * selection can update immediately even while the decoder is still buffering. */
export function watchBrowserAudioSwitch(media: HTMLVideoElement, trackList: EventTarget | undefined,
    selected: () => boolean, setLoading: (_loading: boolean) => void) {
    let position = media.currentTime;
    let advances = 0;
    let stalled = false;
    let visible = false;
    const show = () => {
        if (!visible) {
            visible = true;
            setLoading(true);
        }
    };
    const update = () => {
        if (media.seeking || (!media.paused && media.readyState < 3)) return;
        const at = media.currentTime;
        if (selected() && (media.paused || (at > position && ++advances >= (stalled ? 1 : 2)))) finish();
        position = at;
    };
    const wait = () => {
        if (media.paused) return;
        stalled = true;
        advances = 0;
        show();
    };
    const showTimer = setTimeout(show, 400);
    const expiryTimer = setTimeout(finish, 15_000);
    function finish() {
        clearTimeout(showTimer);
        clearTimeout(expiryTimer);
        trackList?.removeEventListener("change", update);
        media.removeEventListener("timeupdate", update);
        media.removeEventListener("pause", update);
        media.removeEventListener("waiting", wait);
        media.removeEventListener("emptied", finish);
        media.removeEventListener("error", finish);
        if (visible) {
            visible = false;
            setLoading(false);
        }
    }
    trackList?.addEventListener("change", update);
    media.addEventListener("timeupdate", update);
    media.addEventListener("pause", update);
    media.addEventListener("waiting", wait);
    media.addEventListener("emptied", finish);
    media.addEventListener("error", finish);
    return { update, finish };
}
