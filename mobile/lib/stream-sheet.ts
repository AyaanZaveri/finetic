import { seasonSheetLayout } from './season-sheet';

/** Same detached margins as the season picker, with room for a scrolling result list. */
export function streamSheetLayout(
  width: number, height: number, insets: { left: number; right: number; top: number; bottom: number },
) {
  const layout = seasonSheetLayout(width, height, insets, 1);
  const availableHeight = Math.max(1, height - layout.topInset - layout.bottomInset);
  return { ...layout, snapHeight: Math.min(availableHeight, Math.round(availableHeight * 0.94)) };
}
