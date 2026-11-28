import { seasonSheetLayout } from './season-sheet';

type Insets = { left: number; right: number; top: number; bottom: number };

/** Same detached margins as the season picker, with room for a scrolling result list. */
export function streamSheetLayout(width: number, height: number, insets: Insets) {
  const layout = seasonSheetLayout(width, height, insets, 1);
  const availableHeight = Math.max(1, height - layout.topInset - layout.bottomInset);
  return { ...layout, snapHeight: Math.min(availableHeight, Math.round(availableHeight * 0.94)) };
}

/** The account form measures its own height and stays narrow on tablets. */
export function signInSheetLayout(width: number, height: number, insets: Insets) {
  const layout = seasonSheetLayout(width, height, insets, 1);
  const margin = Math.max(12, (width - insets.left - insets.right - 440) / 2);
  return {
    ...layout,
    marginLeft: insets.left + margin,
    marginRight: insets.right + margin,
    snapHeight: Math.max(1, height - layout.topInset - layout.bottomInset),
  };
}
