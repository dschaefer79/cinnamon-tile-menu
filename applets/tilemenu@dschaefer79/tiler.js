// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dschaefer79
// Written entirely with Claude Code (Anthropic).
// Window tiling for GNOME Shell (Mutter) and Cinnamon (Muffin), the
// counterpart of plasma-tile-menu's KWin script: tile the windows of the
// current workspace into side-by-side columns, stacked rows or a grid of
// both, put them back, tile new windows as they open, and optionally snap
// windows dropped with the mouse into the column, row or cell under the
// pointer.
//
// gnome-tile-menu and cinnamon-tile-menu ship the same file; only the
// export at the end differs (an ES module there, a legacy import here).

// Fixed layouts for the menu entries and shortcuts: [columns, rows], where
// "auto" is the count for the screen size (or 1 for a direction that is
// turned off).
var LAYOUTS = {
    'auto': ['auto', 'auto'],
    '4': [4, 'auto'],
    '3': [3, 'auto'],
    '2': [2, 'auto'],
    'rows-3': ['auto', 3],
    'rows-2': ['auto', 2],
    'grid-2x2': [2, 2],
    'grid-3x2': [3, 2],
    'grid-4x2': [4, 2],
};

function near(a, b) {
    const slack = 16;
    return Math.abs(a.x - b.x) <= slack && Math.abs(a.y - b.y) <= slack &&
        Math.abs(a.width - b.width) <= slack && Math.abs(a.height - b.height) <= slack;
}

function rect(r) {
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}

// Split length into count parts with gaps around them; the last part gets
// any leftover pixels from rounding. Returns [{start, size}].
function split(start, length, count, gap) {
    const size = Math.floor((length - gap * (count + 1)) / count);
    const parts = [];
    for (let i = 0; i < count; i++) {
        const from = start + gap + i * (size + gap);
        parts.push({start: from, size: i < count - 1 ? size : start + length - gap - from});
    }
    return parts;
}

function cellBox(area, columns, rows, col, row, gap) {
    const xs = split(area.x, area.width, columns, gap)[col];
    const ys = split(area.y, area.height, rows, gap)[row];
    return {x: xs.start, y: ys.start, width: xs.size, height: ys.size};
}

// The column and row of the cell under the point x, y: {col, row}.
function cellAt(area, columns, rows, x, y) {
    const col = Math.floor((x - area.x) * columns / Math.max(area.width, 1));
    const row = Math.floor((y - area.y) * rows / Math.max(area.height, 1));
    return {
        col: Math.min(Math.max(col, 0), columns - 1),
        row: Math.min(Math.max(row, 0), rows - 1),
    };
}

var Tiler = class Tiler {
    // env: {Meta, GLib, Clutter, config}. config() returns the settings as
    // an object with plasma-tile-menu's names (wideMinWidth, gap, snap...).
    constructor(env) {
        this._Meta = env.Meta;
        this._GLib = env.GLib;
        this._Clutter = env.Clutter;
        this._config = env.config;
        this.settings = {};
        // Original geometry of windows moved by tiling, by window id:
        // {geometry, maximized, placed, moved}. placed is where tiling put
        // the window; moved is set when the user drags or resizes it. A
        // window that was moved, or is no longer near where it was placed,
        // gets its current place saved as the one to restore at the next
        // tiling.
        this._saved = new Map();
        // Layout last used on each monitor index: {columns, rows}. New
        // windows are tiled into it; Restore forgets it.
        this._layouts = new Map();
        // Physical width of each monitor index in mm, for a gap in mm.
        this._widthsMm = new Map();
        this._grab = null;
        this._resize = null;
        // Counts tilings and restores: a late second placement (_place) is
        // dropped once a newer one has started.
        this._round = 0;
        this._signals = [];
        this._sources = new Set();
        this._enabled = false;
        const ops = this._Meta.GrabOp;
        this._moveOps = [ops.MOVING, ops.MOVING_UNCONSTRAINED, ops.KEYBOARD_MOVING]
            .filter(op => op !== undefined);
    }

    enable() {
        this._enabled = true;
        this.loadSettings();
        const display = global.display;
        this._connect(display, 'grab-op-begin', (d, w, op) => this._grabBegin(w, op));
        this._connect(display, 'grab-op-end', (d, w) => this._grabEnd(w));
        this._connect(display, 'window-created', (d, w) => this._windowCreated(w));
    }

    disable() {
        this._enabled = false;
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        for (const id of this._sources)
            this._GLib.source_remove(id);
        this._sources.clear();
        this._saved.clear();
        this._layouts.clear();
        this._grab = null;
        this._stopResize();
    }

    // Monitor indexes change meaning when screens come and go.
    monitorsChanged() {
        this._layouts.clear();
        this._widthsMm.clear();
    }

    // widths: Map of monitor index to physical width in mm.
    setScreenWidthsMm(widths) {
        this._widthsMm = widths;
    }

    loadSettings() {
        const c = this._config();
        const count = v => Math.max(1, Number(v) || 1);
        this.settings = {
            wideMinWidth: Number(c.wideMinWidth),
            wideColumns: count(c.wideColumns),
            normalColumns: count(c.normalColumns),
            tallMinHeight: Number(c.tallMinHeight),
            tallRows: count(c.tallRows),
            normalRows: count(c.normalRows),
            // Tiling needs at least one direction.
            vertical: !!c.vertical || !c.horizontal,
            horizontal: !!c.horizontal,
            gap: Math.max(0, Number(c.gap) || 0),
            gapUnit: c.gapUnit === 'mm' ? 'mm' : 'px',
            gapMm: Math.max(0, Number(c.gapMm) || 0),
            disabled: !!c.disabled,
            tileNew: !!c.tileNew,
            snap: !!c.snap,
            snapShiftOnly: !!c.snapShiftOnly,
            snapShiftSwap: !!c.snapShiftSwap,
            resizeNeighbours: !!c.resizeNeighbours,
        };
        return this.settings;
    }

    // action: a LAYOUTS name or "restore".
    run(action) {
        if (action === 'restore')
            this.restore();
        else if (LAYOUTS[action])
            this.tile(...LAYOUTS[action]);
        else
            throw new Error(`unknown tile action: ${action}`);
    }

    // columns and rows are numbers or "auto". Tiles the monitor under the
    // pointer unless monitor is given.
    tile(columns, rows, monitor) {
        const s = this.loadSettings();
        if (s.disabled)
            return;
        if (monitor === undefined || monitor < 0)
            monitor = global.display.get_current_monitor();
        if (columns === 'auto')
            columns = this._autoColumns(monitor);
        if (rows === 'auto')
            rows = this._autoRows(monitor);
        this._layouts.set(monitor, {columns, rows});
        this._round++;

        // Most recently used windows on this monitor and workspace fill the
        // grid; the others go into the cell under their middle, behind them.
        const workspace = global.workspace_manager.get_active_workspace();
        const candidates = workspace.list_windows()
            .filter(w => this._tileable(w) && w.get_monitor() === monitor);
        const stacked = global.display.sort_windows_by_stacking(candidates).reverse();
        const windows = stacked.slice(0, columns * rows);
        const background = stacked.slice(columns * rows);
        const centerX = w => {
            const r = w.get_frame_rect();
            return r.x + r.width / 2;
        };
        const centerY = w => {
            const r = w.get_frame_rect();
            return r.y + r.height / 2;
        };
        // Keep their left-to-right order across columns and top-to-bottom
        // order within a column. Windows are spread evenly over the
        // columns, so with fewer windows than cells the first columns get
        // the extra rows.
        windows.sort((a, b) => centerX(a) - centerX(b));
        const area = this._usableArea(monitor);
        const gap = this._gapFor(monitor);
        let next = 0;
        for (let col = 0; col < columns; col++) {
            const count = Math.floor(windows.length / columns) +
                (col < windows.length % columns ? 1 : 0);
            const inColumn = windows.slice(next, next + count);
            next += count;
            inColumn.sort((a, b) => centerY(a) - centerY(b));
            inColumn.forEach((w, row) => {
                this._tileInto(w, cellBox(area, columns, rows, col, row, gap));
            });
        }
        // Moving a window does not raise it, so these stay in the background.
        for (const w of background) {
            const {col, row} = cellAt(area, columns, rows, centerX(w), centerY(w));
            this._tileInto(w, cellBox(area, columns, rows, col, row, gap));
        }
    }

    _tileInto(w, box) {
        const id = w.get_id();
        // Keep the original position if the window stayed where an
        // earlier tiling put it.
        const current = rect(w.get_frame_rect());
        let entry = this._saved.get(id);
        if (!entry || entry.moved || !near(entry.placed, current)) {
            entry = {
                geometry: current, maximized: this._isMaximized(w),
                fullscreen: w.is_fullscreen(), moved: false,
            };
            this._saved.set(id, entry);
        }
        this._place(w, box);
        entry.placed = box;
    }

    restore() {
        this._round++;
        for (const actor of global.get_window_actors()) {
            const w = actor.get_meta_window();
            const entry = w && this._saved.get(w.get_id());
            if (!entry)
                continue;
            this._place(w, entry.geometry);
            if (entry.maximized)
                this._maximize(w);
            if (entry.fullscreen)
                w.make_fullscreen();
        }
        this._saved.clear();
        this._layouts.clear();
    }

    _connect(obj, signal, fn) {
        this._signals.push([obj, obj.connect(signal, fn)]);
    }

    // Run fn after delay milliseconds, unless disabled before then.
    _later(delay, fn) {
        const id = this._GLib.timeout_add(this._GLib.PRIORITY_DEFAULT, delay, () => {
            this._sources.delete(id);
            if (this._enabled)
                fn();
            return this._GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
    }

    // Column and row counts for the monitor size, whether or not that
    // direction is turned on.
    _columnsFor(monitor) {
        const wide = global.display.get_monitor_geometry(monitor).width >= this.settings.wideMinWidth;
        return wide ? this.settings.wideColumns : this.settings.normalColumns;
    }

    _rowsFor(monitor) {
        const tall = global.display.get_monitor_geometry(monitor).height >= this.settings.tallMinHeight;
        return tall ? this.settings.tallRows : this.settings.normalRows;
    }

    _autoColumns(monitor) {
        return this.settings.vertical ? this._columnsFor(monitor) : 1;
    }

    _autoRows(monitor) {
        return this.settings.horizontal ? this._rowsFor(monitor) : 1;
    }

    // The gap in pixels on this monitor. In millimetres it needs the
    // monitor's physical width; without it, assume 96 dpi.
    _gapFor(monitor) {
        const s = this.settings;
        if (s.gapUnit !== 'mm')
            return s.gap;
        let pxPerMm = 96 / 25.4;
        const mm = this._widthsMm.get(monitor);
        if (mm > 0)
            pxPerMm = global.display.get_monitor_geometry(monitor).width / mm;
        return Math.round(s.gapMm * pxPerMm);
    }

    _usableArea(monitor) {
        const workspace = global.workspace_manager.get_active_workspace();
        return rect(workspace.get_work_area_for_monitor(monitor));
    }

    _tileable(w) {
        return w.get_window_type() === this._Meta.WindowType.NORMAL &&
            !w.minimized && !w.is_skip_taskbar() && !w.get_transient_for() &&
            w.resizeable && w.allows_move();
    }

    // Mutter 49 and later take no directions for (un)maximizing; Muffin
    // and older Mutter do.
    _isMaximized(w) {
        const flags = w.get_maximize_flags ? w.get_maximize_flags() : w.get_maximized();
        return flags === this._Meta.MaximizeFlags.BOTH;
    }

    _maximize(w) {
        if (w.get_maximize_flags)
            w.maximize();
        else
            w.maximize(this._Meta.MaximizeFlags.BOTH);
    }

    _unmaximize(w) {
        const flags = w.get_maximize_flags ? w.get_maximize_flags() : w.get_maximized();
        if (!flags)
            return;
        if (w.get_maximize_flags)
            w.unmaximize();
        else
            w.unmaximize(this._Meta.MaximizeFlags.BOTH);
    }

    _place(w, box) {
        if (w.is_fullscreen())
            w.unmake_fullscreen();
        // Also takes windows out of the window manager's half-screen tiling.
        this._unmaximize(w);
        w.move_resize_frame(false, box.x, box.y, box.width, box.height);
        // On Wayland a move can be lost, such as while the app has not yet
        // answered leaving maximized or fullscreen: check, and place again.
        const round = this._round;
        for (const delay of [100, 400]) {
            this._later(delay, () => {
                if (round !== this._round || w.get_compositor_private() === null)
                    return;
                const r = w.get_frame_rect();
                if (r.x !== box.x || r.y !== box.y || r.width !== box.width || r.height !== box.height)
                    w.move_resize_frame(false, box.x, box.y, box.width, box.height);
            });
        }
    }

    // Columns and rows to snap into; swapped turns columns into rows and back.
    _snapGrid(monitor, swapped) {
        const s = this.settings;
        const columns = this._autoColumns(monitor);
        const rows = this._autoRows(monitor);
        if (!swapped)
            return {columns, rows};
        if (s.vertical && s.horizontal)
            return {columns: rows, rows: columns};
        if (s.vertical)
            return {columns: 1, rows: this._rowsFor(monitor)};
        return {columns: this._columnsFor(monitor), rows: 1};
    }

    // Cinnamon's own menus start grabs without a window.
    _isWindow(w) {
        return w instanceof this._Meta.Window;
    }

    _grabBegin(w, op) {
        this._grab = this._isWindow(w)
            ? {window: w, start: rect(w.get_frame_rect()), moving: this._moveOps.includes(op)} : null;
        if (this._grab && !this._grab.moving)
            this._startResize(w);
    }

    // Windows whose edge touches w's left or right edge, one gap apart and
    // overlapping it vertically: {left: [{window, rect}], right: [...]}.
    _neighbours(w) {
        const r = rect(w.get_frame_rect());
        const slack = this._gapFor(w.get_monitor()) + 8;
        const found = {left: [], right: []};
        const workspace = global.workspace_manager.get_active_workspace();
        for (const o of workspace.list_windows()) {
            if (o === w || !this._tileable(o) || o.get_monitor() !== w.get_monitor())
                continue;
            const q = rect(o.get_frame_rect());
            if (q.y >= r.y + r.height || q.y + q.height <= r.y)
                continue;
            if (Math.abs(q.x - (r.x + r.width)) <= slack)
                found.right.push({window: o, rect: q});
            else if (Math.abs(q.x + q.width - r.x) <= slack)
                found.left.push({window: o, rect: q});
        }
        return found;
    }

    // With "resize neighbouring windows together" on, follow a resize of w
    // and move the shared left or right edge of the windows beside it.
    _startResize(w) {
        this._stopResize();
        const s = this.loadSettings();
        if (s.disabled || !s.resizeNeighbours || !this._tileable(w))
            return;
        const neighbours = this._neighbours(w);
        if (!neighbours.left.length && !neighbours.right.length)
            return;
        const resize = {window: w, start: rect(w.get_frame_rect()), neighbours, ids: []};
        const step = () => this._resizeStep(resize);
        resize.ids.push(w.connect('size-changed', step), w.connect('position-changed', step));
        this._resize = resize;
    }

    _resizeStep(resize) {
        const minWidth = 50;
        const r = rect(resize.window.get_frame_rect());
        const s = resize.start;
        const right = r.x + r.width;
        const startRight = s.x + s.width;
        const fit = (n, x, width) => {
            if (width < minWidth)
                return;
            this._unmaximize(n.window);
            n.window.move_resize_frame(false, x, n.rect.y, width, n.rect.height);
        };
        if (right !== startRight) {
            for (const n of resize.neighbours.right) {
                // Keep the gap between the two windows as it was.
                const x = right + (n.rect.x - startRight);
                fit(n, x, n.rect.x + n.rect.width - x);
            }
        }
        if (r.x !== s.x) {
            for (const n of resize.neighbours.left) {
                const end = r.x - (s.x - (n.rect.x + n.rect.width));
                fit(n, n.rect.x, end - n.rect.x);
            }
        }
    }

    _stopResize() {
        const resize = this._resize;
        this._resize = null;
        if (!resize)
            return;
        for (const id of resize.ids)
            resize.window.disconnect(id);
        // The neighbours stay tiled: restore still knows where they were.
        for (const n of [...resize.neighbours.left, ...resize.neighbours.right]) {
            const entry = this._saved.get(n.window.get_id());
            if (entry)
                entry.placed = rect(n.window.get_frame_rect());
        }
    }

    _grabEnd(w) {
        const grab = this._grab;
        this._grab = null;
        this._stopResize();
        if (!this._isWindow(w) || !grab || grab.window !== w)
            return;
        const entry = this._saved.get(w.get_id());
        if (entry)
            entry.moved = true;
        const end = rect(w.get_frame_rect());
        const wasMove = grab.moving ||
            (grab.start.width === end.width && grab.start.height === end.height);
        const s = this.loadSettings();
        if (s.disabled || !s.snap || !wasMove || !this._tileable(w))
            return;
        const [x, y, mods] = global.get_pointer();
        // With both Shift options on, Shift snaps the other way and a plain
        // drop does not snap.
        const shift = (mods & this._Clutter.ModifierType.SHIFT_MASK) !== 0;
        if (s.snapShiftOnly && !shift)
            return;
        const swapped = shift && s.snapShiftSwap;
        const monitor = global.display.get_current_monitor();
        // Let the window manager finish the drop (such as its own edge
        // tiling) first, then put the window in place.
        this._later(0, () => {
            if (w.get_compositor_private() === null)
                return;
            const area = this._usableArea(monitor);
            const grid = this._snapGrid(monitor, swapped);
            const {col, row} = cellAt(area, grid.columns, grid.rows, x, y);
            this._place(w, cellBox(area, grid.columns, grid.rows, col, row, this._gapFor(monitor)));
        });
    }

    // Tile every new window with the others on its monitor, if turned on,
    // in the layout last used there (or the automatic one).
    _windowCreated(w) {
        const s = this.loadSettings();
        if (!s.tileNew || s.disabled)
            return;
        // Wait until the window is shown and has its first size. Muffin
        // does not say so for X11 windows: there, check a moment later.
        let id = 0;
        const shown = () => {
            if (!id)
                return;
            w.disconnect(id);
            id = 0;
            this._later(100, () => this._tileNew(w));
        };
        id = w.connect('shown', shown);
        this._later(400, () => {
            if (w.get_compositor_private() !== null && w.showing_on_its_workspace())
                shown();
        });
    }

    _tileNew(w) {
        const s = this.loadSettings();
        if (!s.tileNew || s.disabled || w.get_compositor_private() === null || !this._tileable(w))
            return;
        if (!w.located_on_workspace(global.workspace_manager.get_active_workspace()))
            return;
        const monitor = w.get_monitor();
        const layout = this._layouts.get(monitor);
        if (layout)
            this.tile(layout.columns, layout.rows, monitor);
        else
            this.tile('auto', 'auto', monitor);
    }
};

