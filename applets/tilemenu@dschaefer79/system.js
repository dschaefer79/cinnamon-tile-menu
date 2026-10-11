// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dschaefer79
// Written entirely with Claude Code (Anthropic).
// Settings of the two applets that are Cinnamon's own, kept in step both
// ways: the "Panel" switches (is each menu on the panel?) and, for Window
// Tiling, "Window effects" (System Settings > Effects). Both applets ship
// the same file.

// Panel switch: the applet's uuid and its name for cinnamon-tile-menu.
var PANEL_SWITCHES = {
    showTilingMenu: ['tilemenu@dschaefer79', 'tiling'],
    showResolutionMenu: ['resolutionmenu@dschaefer79', 'resolution'],
};

var SystemSettings = class SystemSettings {
    // applet: has .settings (AppletSettings); effects: also windowEffects.
    constructor(applet, env, effects) {
        this._applet = applet;
        this._Util = env.Util;
        this._cinnamon = new env.Gio.Settings({schema_id: 'org.cinnamon'});
        this._ids = [];
        for (const key of Object.keys(PANEL_SWITCHES))
            applet.settings.bind(key, key, () => this._panelChanged(key));
        this._ids.push(this._cinnamon.connect('changed::enabled-applets', () => this.sync()));
        this._effects = effects;
        if (effects) {
            applet.settings.bind('windowEffects', 'windowEffects', () =>
                this._cinnamon.set_boolean('desktop-effects', applet.windowEffects));
            this._ids.push(this._cinnamon.connect('changed::desktop-effects', () => this.sync()));
        }
        this.sync();
    }

    _onPanel(uuid) {
        return this._cinnamon.get_strv('enabled-applets').some(e => e.split(':')[3] === uuid);
    }

    // Show Cinnamon's state in the settings. setValue does not call the
    // bind callbacks, so this changes nothing else.
    sync() {
        const set = (key, value) => {
            if (this._applet.settings.getValue(key) !== value)
                this._applet.settings.setValue(key, value);
        };
        for (const [key, [uuid]] of Object.entries(PANEL_SWITCHES))
            set(key, this._onPanel(uuid));
        if (this._effects)
            set('windowEffects', this._cinnamon.get_boolean('desktop-effects'));
    }

    // A Panel switch was flipped in the settings: put that menu on the
    // panel or take it off.
    _panelChanged(key) {
        const [uuid, name] = PANEL_SWITCHES[key];
        const on = this._applet[key];
        if (on !== this._onPanel(uuid))
            this._Util.spawn(['cinnamon-tile-menu', on ? 'setup' : 'quit', name]);
    }

    destroy() {
        for (const id of this._ids)
            this._cinnamon.disconnect(id);
        this._ids = [];
    }
};
