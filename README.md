# cinnamon-tile-menu

Two applets for the Cinnamon panel: **Window Tiling** arranges the windows of
the current workspace, and **Resolution** switches the screen resolution.
Works in Cinnamon on X11 and on Wayland.

This project was written entirely with
[Claude Code](https://claude.com/claude-code), Anthropic's AI coding
assistant: all code, packaging and documentation.

## Window Tiling

- **Layouts:** tile automatically, or into 4, 3 or 2 columns, 3 or 2 rows, or a
  2 × 2, 3 × 2 or 4 × 2 grid. "Automatically" picks the number of columns and
  rows from the screen size (3 columns from 5120 pixels wide, otherwise 2, by
  default).
- **All windows are tiled:** the most recently used windows fill the layout,
  and the others go into the cell under their middle, behind them.
- **Restore windows** puts every window back where it was, maximized or
  fullscreen again if it was.
- **Tile new windows:** each window that opens is tiled with the others, in
  the layout last used on its screen.
- **Snapping:** a window dragged with the mouse and dropped fills the column,
  row or grid cell under the pointer. Optionally only with Shift held, or with
  Shift swapping columns and rows.
- **Resize neighbouring windows together:** dragging the edge of a window also
  moves the edge of the window beside it.
- **Gap** between windows, in pixels or millimetres.
- **Window effects:** turns Cinnamon's window effects on or off (the same as
  System Settings > Effects).
- **Keyboard shortcuts** for every action, shown in the menu. Default keys:
  Super+Alt+A (auto), Super+Alt+2/3/4 (columns), Super+Ctrl+Alt+2/3 (rows),
  Super+Ctrl+2/3/4 (grids), Super+Alt+0 (restore).
- **Disable tiling** turns all tiling and snapping off; Restore still works.

## Resolution

- Switches to the resolutions in your list (1920 × 1080, 1900 × 1000 and
  5120 × 1440 by default).
- On X11, sizes the screen does not offer are added to it with xrandr, when
  picked or right away. On Wayland, Cinnamon can only use sizes the screen
  offers; others are greyed out.

## Settings and menus

- **System Settings** has a "Window Tiling" page (Preferences) and a
  "Resolution Menu" page (Hardware) with every setting, the same as each
  applet's own settings window.
- **Panel** switches in the settings show whether each menu is on the panel,
  and put it there or take it off.
- **Save settings to file… / Load settings from file…** keep a copy of the
  settings of both applets and the shortcuts, or move them to another computer.
- **Quit** at the bottom of each menu takes that applet off the panel.
  "Window Tiling Menu" and "Resolution Menu" in the applications menu put
  them back.

## Command line

`cinnamon-tile-menu` runs the same actions: `tile auto|4|3|2|rows-3|rows-2|grid-2x2|grid-3x2|grid-4x2|restore`,
`resolution WIDTHxHEIGHT`, `add-mode WIDTHxHEIGHT` (X11), `toggle snap|tileNew|disabled`,
`settings`, `shortcuts`, `setup [tiling|resolution]`, `quit [tiling|resolution]`,
`remove`, `export FILE` and `import FILE`.

## Building the RPM

```
git archive --prefix=cinnamon-tile-menu-1.14/ -o ~/rpmbuild/SOURCES/cinnamon-tile-menu-1.14.tar.gz HEAD
rpmbuild -ba cinnamon-tile-menu.spec
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
Copyright (C) 2026 dschaefer79.
