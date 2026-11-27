/** Geometry for a detached, content-sized panel. Keep every edge inside the safe area. */
export function seasonSheetLayout(
  width: number, height: number, insets: { left: number; right: number; top: number; bottom: number },
  seasonCount: number, fontScale = 1,
) {
  const availableWidth = Math.max(1, width - insets.left - insets.right);
  const margin = availableWidth >= 720 ? Math.max(12, (availableWidth - 560) / 2) : 12;
  const topInset = insets.top + 12;
  // The system bottom inset already includes the home/gesture area. Do not
  // add another full gutter on top of it; keep a small floor on edge-to-edge
  // windows so the fourth rounded edge remains visible.
  const bottomInset = Math.max(insets.bottom, availableWidth >= 720 ? 12 : 8);
  const availableHeight = Math.max(1, height - topInset - bottomInset);
  const rowHeight = Math.max(56, 48 * fontScale + 8);
  const headerAndPadding = 92 + Math.max(0, fontScale - 1) * 32;
  const contentHeight = Math.max(148, headerAndPadding + Math.max(0, seasonCount) * rowHeight);
  return {
    marginLeft: insets.left + margin,
    marginRight: insets.right + margin,
    topInset,
    bottomInset,
    snapHeight: Math.min(availableHeight * 0.65, contentHeight),
  };
}
