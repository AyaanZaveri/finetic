/** Controls remain active even when a mouse stops moving over their hit area. */
export const playerControlSelector = ':is([data-player-close], [data-slot="media-player-controls"] :is(button, a[href], [role="button"], [data-slider]))';

export function playerControlsActive(root: HTMLElement | null) {
    if (root?.querySelector(`${playerControlSelector}:hover`)) return true;
    // Some track/cast menus are portalled and do not use the player's menu store.
    if (document.querySelector('[data-state="open"]:is([role="menu"], [role="dialog"], [role="listbox"], [data-slot="popover-content"]), [data-slot="drawer-popup"][data-open]')) return true;
    const focused = document.activeElement;
    return focused instanceof Element && !!root?.contains(focused)
        && !!focused.closest(playerControlSelector) && focused.matches(':focus-visible');
}
