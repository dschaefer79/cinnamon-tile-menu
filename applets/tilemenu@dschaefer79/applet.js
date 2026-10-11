// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dschaefer79
// Written entirely with Claude Code (Anthropic).
// Window Tiling applet for the Cinnamon panel, the counterpart of
// plasma-tile-menu's widget. The tiling itself runs in tiler.js;
// cinnamon-tile-menu (the command) reaches it over D-Bus.

const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const St = imports.gi.St;

const Me = imports.ui.extension.getCurrentExtension();
const Tiling = Me.imports.tiler;
const System = Me.imports.system;

const DBUS_PATH = '/org/dschaefer/TileMenu';
const DBUS_XML = `<node>
  <interface name="org.dschaefer.TileMenu">
    <method name="Tile">
      <arg type="s" direction="in" name="action"/>
    </method>
    <method name="Toggle">
      <arg type="s" direction="in" name="key"/>
      <arg type="b" direction="out" name="on"/>
    </method>
  </interface>
</node>`;

// Settings bound to properties of the applet, by plasma-tile-menu's names.
const KEYS = ['disabled', 'tileNew', 'showAuto', 'vertical', 'horizontal',
    'wideMinWidth', 'wideColumns', 'normalColumns',
    'tallMinHeight', 'tallRows', 'normalRows',
    'gap', 'gapUnit', 'gapMm', 'snap', 'snapShiftOnly', 'snapShiftSwap', 'resizeNeighbours'];

// Shortcut settings and the tile action each runs.
const TILE_SHORTCUTS = {
    'kbTileAuto': 'auto',
    'kbTile4': '4',
    'kbTile3': '3',
    'kbTile2': '2',
    'kbTileRows3': 'rows-3',
    'kbTileRows2': 'rows-2',
    'kbTileGrid2x2': 'grid-2x2',
    'kbTileGrid3x2': 'grid-3x2',
    'kbTileGrid4x2': 'grid-4x2',
    'kbRestore': 'restore',
};

// Bump when the default keys change, so _defaultShortcuts runs again.
const DEFAULT_SHORTCUTS_VERSION = 1;

const TOGGLES = {
    'snap': {shortcut: 'kbToggleSnap', label: _('Automatic tiling')},
    'tileNew': {shortcut: 'kbToggleTileNew', label: _('Tile new windows')},
    'disabled': {shortcut: 'kbToggleDisabled', label: _('Disable tiling')},
};

// A shortcut such as "<Super><Alt>4" as shown in the menu: "Super+Alt+4".
// Cinnamon keeps several shortcuts as "first::second"; show the first.
function accelLabel(accel) {
    let rest = (accel || '').split('::')[0];
    if (!rest)
        return '';
    const mods = [];
    for (let m; (m = /^<([^>]+)>/.exec(rest)); rest = rest.slice(m[0].length))
        mods.push(m[1].toLowerCase());
    const names = [
        ['Super', ['super', 'mod4']],
        ['Ctrl', ['primary', 'control', 'ctrl']],
        ['Alt', ['alt', 'mod1']],
        ['Shift', ['shift']],
    ];
    const parts = names.filter(([, ids]) => ids.some(id => mods.includes(id))).map(([name]) => name);
    parts.push(rest.length === 1 ? rest.toUpperCase() : rest);
    return parts.join('+');
}

// Pages of the settings dialog, as numbered in settings-schema.json.
const PAGE_TILING = 0;
const PAGE_SHORTCUTS = 2;

class TileMenuApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this._path = metadata.path;
        // The layout icons are symbolic icons of this applet.
        Gtk.IconTheme.get_default().append_search_path(`${metadata.path}/icons`);

        this.set_applet_icon_symbolic_name('view-grid-symbolic');
        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        for (const key of KEYS)
            this.settings.bind(key, key, () => this._settingsChanged());
        this._defaultShortcuts();
        for (const key of Object.keys(TILE_SHORTCUTS).concat(Object.values(TOGGLES).map(t => t.shortcut)))
            this.settings.bind(key, key, () => this._updateShortcuts());

        this.system = new System.SystemSettings(this, {Gio, Util}, true);
        this.tiler = new Tiling.Tiler({Meta, GLib, Clutter, config: () => this});
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_XML, {
            Tile: action => this.tiler.run(action),
            Toggle: key => this.toggle(key),
        });

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._buildMenu();
        this._update();
    }

    // Settings saved before the tiling shortcuts had default keys keep them
    // empty; give those their default key once.
    _defaultShortcuts() {
        if (this.settings.getValue('defaultShortcuts') >= DEFAULT_SHORTCUTS_VERSION)
            return;
        for (const key of Object.keys(TILE_SHORTCUTS)) {
            if (!this.settings.getValue(key))
                this.settings.setValue(key, this.settings.getDefaultValue(key));
        }
        this.settings.setValue('defaultShortcuts', DEFAULT_SHORTCUTS_VERSION);
    }

    on_applet_added_to_panel() {
        this.tiler.enable();
        this._dbus.export(Gio.DBus.session, DBUS_PATH);
        this._updateShortcuts();
        // A gap in millimetres needs the screens' physical sizes.
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            this.tiler.monitorsChanged();
            this._updateWidths();
        });
        this._updateWidths();
    }

    on_applet_removed_from_panel() {
        this._dbus.unexport();
        Main.layoutManager.disconnect(this._monitorsId);
        this._removeShortcuts();
        this.tiler.disable();
        this.system.destroy();
        this.settings.finalize();
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    _buildMenu() {
        // Each entry shows its keyboard shortcut on the right.
        this._accels = [];
        const tileItem = (text, icon, action) => {
            const item = new PopupMenu.PopupIconMenuItem(text, icon, St.IconType.SYMBOLIC);
            item.connect('activate', () => this.tiler.run(action));
            const shortcut = Object.keys(TILE_SHORTCUTS).find(k => TILE_SHORTCUTS[k] === action);
            const accel = new St.Label({style: 'padding-left: 2em; color: rgba(128, 128, 128, 1);'});
            item.addActor(accel, {expand: true, span: -1, align: St.Align.END});
            this._accels.push([accel, shortcut]);
            this.menu.addMenuItem(item);
            return item;
        };
        const switchItem = key => {
            const item = new PopupMenu.PopupSwitchMenuItem(TOGGLES[key].label, this[key]);
            // Settings changed here do not call the bind callback.
            item.connect('toggled', (i, state) => {
                this[key] = state;
                this._update();
            });
            this.menu.addMenuItem(item);
            return item;
        };

        this._auto = tileItem(_('Tile automatically'), 'view-app-grid-symbolic', 'auto');
        this._columns = [
            tileItem(_('Tile in 4 columns'), 'tilemenu-columns-4-symbolic', '4'),
            tileItem(_('Tile in 3 columns'), 'tilemenu-columns-3-symbolic', '3'),
            tileItem(_('Tile in 2 columns'), 'tilemenu-columns-2-symbolic', '2'),
        ];
        this._rows = [
            tileItem(_('Tile in 3 rows'), 'tilemenu-rows-3-symbolic', 'rows-3'),
            tileItem(_('Tile in 2 rows'), 'tilemenu-rows-2-symbolic', 'rows-2'),
        ];
        this._grids = [
            tileItem(_('Tile in 2 × 2 grid'), 'tilemenu-grid-2x2-symbolic', 'grid-2x2'),
            tileItem(_('Tile in 3 × 2 grid'), 'tilemenu-grid-3x2-symbolic', 'grid-3x2'),
            tileItem(_('Tile in 4 × 2 grid'), 'tilemenu-grid-4x2-symbolic', 'grid-4x2'),
        ];
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        tileItem(_('Restore windows'), 'view-restore-symbolic', 'restore');
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        // Snap windows into place when they are dropped.
        this._snap = switchItem('snap');
        // Tile each window that opens together with the others.
        this._tileNew = switchItem('tileNew');
        this._disabled = switchItem('disabled');
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._hint = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._hint.label.clutter_text.line_wrap = true;
        this._hint.label.set_style('font-size: smaller; max-width: 20em;');
        this.menu.addMenuItem(this._hint);
        const shortcuts = new PopupMenu.PopupIconMenuItem(_('Keyboard shortcuts…'),
            'preferences-desktop-keyboard-shortcuts-symbolic', St.IconType.SYMBOLIC);
        shortcuts.connect('activate', () => this.configureApplet(PAGE_SHORTCUTS));
        this.menu.addMenuItem(shortcuts);
        const settings = new PopupMenu.PopupIconMenuItem(_('Settings…'),
            'preferences-system-symbolic', St.IconType.SYMBOLIC);
        settings.connect('activate', () => this.configureApplet(PAGE_TILING));
        this.menu.addMenuItem(settings);
        // Take the applet off the panel; "Window Tiling Menu" in the
        // applications menu puts it back.
        const quit = new PopupMenu.PopupIconMenuItem(_('Quit'),
            'application-exit-symbolic', St.IconType.SYMBOLIC);
        quit.connect('activate', () => Util.spawn(['cinnamon-tile-menu', 'quit']));
        this.menu.addMenuItem(quit);
        this._updateAccels();
    }

    // The settings' "Save settings to file…" and "Load settings from file…".
    saveSettingsFile() {
        Util.spawn(['cinnamon-tile-menu', 'save-dialog']);
    }

    loadSettingsFile() {
        Util.spawn(['cinnamon-tile-menu', 'load-dialog']);
    }

    _updateAccels() {
        for (const [accel, shortcut] of this._accels)
            accel.text = accelLabel(this[shortcut]);
    }

    // Settings come from the bound properties.
    _settingsChanged() {
        this._update();
    }

    _update() {
        const disabled = this.disabled;
        // With both off the tiling uses columns.
        const rows = this.horizontal;
        const columns = this.vertical || !rows;
        this._auto.actor.visible = this.showAuto;
        this._columns.forEach(item => (item.actor.visible = columns));
        this._rows.forEach(item => (item.actor.visible = rows));
        for (const item of [this._auto, ...this._columns, ...this._rows, ...this._grids,
            this._snap, this._tileNew])
            item.setSensitive(!disabled);
        this._snap.setToggleState(this.snap);
        this._tileNew.setToggleState(this.tileNew);
        this._disabled.setToggleState(disabled);
        const hint = this._snapHint();
        this._hint.label.text = hint;
        this._hint.actor.visible = hint !== '';
        this.set_applet_tooltip(disabled ? _('Window Tiling: tiling is disabled')
            : hint ? `${_('Window Tiling')}\n${hint}` : _('Window Tiling'));
    }

    // How dropping a window works with the current settings.
    _snapHint() {
        if (this.disabled || !this.snap)
            return '';
        const rows = this.horizontal;
        const columns = this.vertical || !rows;
        const swapped = columns && rows ? _('with columns and rows swapped')
            : columns ? _('into rows') : _('into columns');
        if (this.snapShiftOnly && this.snapShiftSwap)
            return _('Hold Shift while dropping a window to snap it %s.').format(swapped);
        if (this.snapShiftOnly)
            return _('Hold Shift while dropping a window to snap it.');
        if (this.snapShiftSwap)
            return _('Drop a window to snap it; hold Shift to snap it %s.').format(swapped);
        return _('Drop a window to snap it into place.');
    }

    _updateShortcuts() {
        this._updateAccels();
        for (const [key, action] of Object.entries(TILE_SHORTCUTS))
            Main.keybindingManager.addXletHotKey(this, key, this[key], () => this.tiler.run(action));
        for (const [name, {shortcut}] of Object.entries(TOGGLES))
            Main.keybindingManager.addXletHotKey(this, shortcut, this[shortcut], () => this.toggle(name));
    }

    _removeShortcuts() {
        for (const key of Object.keys(TILE_SHORTCUTS))
            Main.keybindingManager.removeXletHotKey(this, key);
        for (const {shortcut} of Object.values(TOGGLES))
            Main.keybindingManager.removeXletHotKey(this, shortcut);
    }

    // Physical screen widths from Muffin's DisplayConfig, by monitor index.
    _updateWidths() {
        const service = 'org.cinnamon.Muffin.DisplayConfig';
        Gio.DBus.session.call(service, '/org/cinnamon/Muffin/DisplayConfig', service,
            'GetResources', null, null, Gio.DBusCallFlags.NONE, 10000, null, (bus, result) => {
                try {
                    const [, , outputs] = bus.call_finish(result).recursiveUnpack();
                    const manager = Meta.MonitorManager.get();
                    const widths = new Map();
                    for (const output of outputs) {
                        const index = manager.get_monitor_for_connector(output[4]);
                        if (index >= 0 && output[7]['width-mm'] > 0)
                            widths.set(index, output[7]['width-mm']);
                    }
                    this.tiler.setScreenWidthsMm(widths);
                } catch (e) {
                    global.logWarning(`tilemenu: could not read the screen sizes: ${e.message}`);
                }
            });
    }

    // Flip a switch (snap, tileNew or disabled), say so on screen and
    // return its new state.
    toggle(key) {
        if (!TOGGLES[key])
            throw new Error(`unknown switch: ${key}`);
        this[key] = !this[key];
        this._update();
        Main.osdWindowManager.show(-1, Gio.ThemedIcon.new('view-grid-symbolic'),
            `${TOGGLES[key].label}: ${this[key] ? _('on') : _('off')}`);
        return this[key];
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new TileMenuApplet(metadata, orientation, panelHeight, instanceId);
}
