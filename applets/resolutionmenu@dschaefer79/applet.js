// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dschaefer79
// Written entirely with Claude Code (Anthropic).
// Resolution applet for the Cinnamon panel, the counterpart of
// plasma-tile-menu's Resolution widget. On X11, cinnamon-tile-menu switches
// with xrandr and adds sizes the screen does not offer; on Wayland, Muffin
// can only switch to sizes the screen offers (display.js).

const Applet = imports.ui.applet;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;

const Me = imports.ui.extension.getCurrentExtension();
const Display = Me.imports.display;
const System = Me.imports.system;

const SIZE_PATTERN = /^[1-9][0-9]{2,4}x[1-9][0-9]{2,4}$/;

const DBUS_PATH = '/org/dschaefer/ResolutionMenu';
const DBUS_XML = `<node>
  <interface name="org.dschaefer.ResolutionMenu">
    <method name="SetResolution">
      <arg type="s" direction="in" name="size"/>
    </method>
  </interface>
</node>`;

class ResolutionMenuApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.wayland = Meta.is_wayland_compositor();
        this.display = new Display.DisplayConfig(Gio, GLib, 'org.cinnamon.Muffin.DisplayConfig');
        this._sizes = null;

        this.set_applet_icon_symbolic_name('video-display-symbolic');
        this.set_applet_tooltip(_('Resolution: switch the screen resolution'));
        this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this.settings.bind('resolutions', 'resolutions', () => this._resolutionsChanged());
        this.settings.bind('addToScreen', 'addToScreen');
        this._known = new Set(this._list());
        this.system = new System.SystemSettings(this, {Gio, Util}, false);

        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_XML, {
            SetResolutionAsync: ([size], invocation) => this.setResolution(size).then(
                () => invocation.return_value(null),
                e => invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, e.message)),
        });

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupIconMenuItem(_('Settings…'),
            'preferences-system-symbolic', St.IconType.SYMBOLIC);
        settings.connect('activate', () => this.configureApplet());
        this.menu.addMenuItem(settings);
        // Take the applet off the panel; "Resolution Menu" in the
        // applications menu puts it back.
        const quit = new PopupMenu.PopupIconMenuItem(_('Quit'),
            'application-exit-symbolic', St.IconType.SYMBOLIC);
        quit.connect('activate', () => Util.spawn(['cinnamon-tile-menu', 'quit', 'resolution']));
        this.menu.addMenuItem(quit);
        this._rebuild();
    }

    on_applet_added_to_panel() {
        this._dbus.export(Gio.DBus.session, DBUS_PATH);
    }

    on_applet_removed_from_panel() {
        this._dbus.unexport();
        this.system.destroy();
        this.settings.finalize();
    }

    on_applet_clicked() {
        if (!this.menu.isOpen)
            this._refresh();
        this.menu.toggle();
    }

    // The sizes in the settings, in order, as "WIDTHxHEIGHT".
    _list() {
        return (this.resolutions || [])
            .map(r => String(r.size || '').replace(/\s/g, '').replace('×', 'x'))
            .filter(size => SIZE_PATTERN.test(size));
    }

    // Find out which sizes the screen offers and which one it uses.
    async _refresh() {
        try {
            this._sizes = await this.display.sizes();
        } catch (e) {
            this._sizes = null;
        }
        this._rebuild();
    }

    _rebuild() {
        this._section.removeAll();
        for (const size of this._list()) {
            // Only Wayland cannot add sizes the screen does not offer.
            const offered = !this.wayland || !this._sizes || this._sizes.offered.has(size);
            const text = size.replace('x', ' × ') + (offered ? '' : _(' (not offered by the screen)'));
            const item = new PopupMenu.PopupIconMenuItem(text, 'video-display-symbolic', St.IconType.SYMBOLIC);
            item.setSensitive(offered);
            if (this._sizes && this._sizes.current === size)
                item.setShowDot(true);
            // setResolution reports failures itself.
            item.connect('activate', () => this.setResolution(size).catch(() => {}));
            this._section.addMenuItem(item);
        }
    }

    _resolutionsChanged() {
        const sizes = this._list();
        // Add new sizes to the screen right away, if wanted (X11 only).
        if (this.addToScreen && !this.wayland) {
            for (const size of sizes.filter(s => !this._known.has(s)))
                this._helper(['add-mode', size]).then(out => Main.notify(_('Resolution'), out), () => {});
        }
        this._known = new Set(sizes);
        this._rebuild();
    }

    // Run cinnamon-tile-menu; resolves with its output, rejects with its
    // error (which it also shows as a notification).
    _helper(args) {
        return new Promise((resolve, reject) => {
            Util.spawnAsyncIO(['cinnamon-tile-menu', ...args], (stdout, stderr, status) => {
                if (status === 0)
                    resolve(stdout.trim());
                else
                    reject(new Error(stderr.trim().replace(/^cinnamon-tile-menu: /, '')));
            });
        });
    }

    async setResolution(size) {
        if (!SIZE_PATTERN.test(size))
            throw new Error(`invalid resolution: ${size}`);
        if (!this.wayland)
            return this._helper(['resolution', size]);
        try {
            await this.display.setResolution(size);
        } catch (e) {
            Main.notifyError(_('Resolution'), e.message);
            throw e;
        }
    }

    // The settings' "Save settings to file…" and "Load settings from file…".
    saveSettingsFile() {
        Util.spawn(['cinnamon-tile-menu', 'save-dialog']);
    }

    loadSettingsFile() {
        Util.spawn(['cinnamon-tile-menu', 'load-dialog']);
    }

    // The settings' "Add to the screen now" button (X11 only).
    addAllNow() {
        if (this.wayland) {
            Main.notify(_('Resolution'), _('On Wayland, Cinnamon can only use sizes the screen offers.'));
            return;
        }
        Promise.allSettled(this._list().map(size => this._helper(['add-mode', size]))).then(results => {
            const lines = results.filter(r => r.status === 'fulfilled').map(r => r.value);
            if (lines.length)
                Main.notify(_('Resolution'), lines.join('\n'));
        });
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new ResolutionMenuApplet(metadata, orientation, panelHeight, instanceId);
}
