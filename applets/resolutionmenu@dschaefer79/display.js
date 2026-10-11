// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dschaefer79
// Written entirely with Claude Code (Anthropic).
// Screen resolutions through the compositor's DisplayConfig D-Bus API, the
// one the display settings use: org.gnome.Mutter.DisplayConfig on GNOME,
// org.cinnamon.Muffin.DisplayConfig on Cinnamon. Neither can add sizes a
// screen does not offer, so only offered sizes can be switched to.
//
// gnome-tile-menu and cinnamon-tile-menu ship the same file; only the
// export at the end differs.

// Method for ApplyMonitorsConfig: 1 applies the change for this session
// without asking to keep it, like xrandr; 2 would save it and ask.
const TEMPORARY = 1;

var DisplayConfig = class DisplayConfig {
    // service: "org.gnome.Mutter.DisplayConfig" or
    // "org.cinnamon.Muffin.DisplayConfig".
    constructor(Gio, GLib, service) {
        this._Gio = Gio;
        this._GLib = GLib;
        this._service = service;
        this._path = '/' + service.replace(/\./g, '/');
    }

    _call(method, params) {
        return new Promise((resolve, reject) => {
            this._Gio.DBus.session.call(this._service, this._path, this._service,
                method, params, null, this._Gio.DBusCallFlags.NONE, 10000, null,
                (bus, result) => {
                    try {
                        resolve(bus.call_finish(result).recursiveUnpack());
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    // {serial, monitors, logical, properties}, with the screen to switch:
    // the first monitor of the primary logical monitor.
    async _state() {
        const [serial, monitors, logical, properties] = await this._call('GetCurrentState', null);
        const primary = logical.find(l => l[4]) || logical[0];
        if (!primary)
            throw new Error('no enabled screen found');
        return {serial, monitors, logical, properties, primary};
    }

    // Sizes the primary screen offers and the one it uses, as
    // {offered: Set, current} of "WIDTHxHEIGHT".
    async sizes() {
        const {monitors, primary} = await this._state();
        const monitor = monitors.find(m => m[0][0] === primary[5][0][0]);
        const modes = monitor ? monitor[1] : [];
        const current = modes.find(m => m[6]['is-current']);
        return {
            offered: new Set(modes.map(m => `${m[1]}x${m[2]}`)),
            current: current ? `${current[1]}x${current[2]}` : '',
        };
    }

    // Physical width in mm of each screen, by connector name.
    async widthsMm() {
        const [, , outputs] = await this._call('GetResources', null);
        const widths = new Map();
        for (const output of outputs) {
            const mm = output[7]['width-mm'];
            if (output[4] && mm > 0)
                widths.set(output[4], mm);
        }
        return widths;
    }

    // Switch the primary screen to size ("WIDTHxHEIGHT") at its fastest
    // refresh rate. Screens to its right or below are moved along so the
    // layout stays connected.
    async setResolution(size) {
        const [width, height] = size.split('x').map(Number);
        const {serial, monitors, logical, properties, primary} = await this._state();
        const layoutMode = properties['layout-mode'] || 1;
        const current = connector => {
            const monitor = monitors.find(m => m[0][0] === connector);
            const mode = monitor && monitor[1].find(m => m[6]['is-current']);
            if (!mode)
                throw new Error(`screen ${connector} has no current mode`);
            return mode;
        };

        // The new mode for each screen of the primary logical monitor
        // (more than one when they mirror each other).
        const chosen = new Map();
        for (const [connector] of primary[5]) {
            const monitor = monitors.find(m => m[0][0] === connector);
            const modes = (monitor ? monitor[1] : []).filter(m => m[1] === width && m[2] === height);
            if (modes.length === 0)
                throw new Error(`screen ${connector} does not offer ${width} × ${height}`);
            chosen.set(connector, modes.reduce((a, b) => b[3] > a[3] ? b : a));
        }
        const mode = chosen.get(primary[5][0][0]);
        // Keep the scale if the new mode supports it.
        let scale = primary[2];
        if (!mode[5].some(s => Math.abs(s - scale) < 0.001))
            scale = mode[4];

        const logicalSize = (m, s) => layoutMode === 1
            ? [Math.round(m[1] / s), Math.round(m[2] / s)] : [m[1], m[2]];
        const [oldW, oldH] = logicalSize(current(primary[5][0][0]), primary[2]);
        const [newW, newH] = logicalSize(mode, scale);
        const right = primary[0] + oldW;
        const bottom = primary[1] + oldH;

        const config = logical.map(l => {
            const isPrimary = l === primary;
            let [x, y] = l;
            if (!isPrimary && x >= right)
                x += newW - oldW;
            if (!isPrimary && y >= bottom)
                y += newH - oldH;
            const screens = l[5].map(([connector]) => [connector,
                (isPrimary ? chosen.get(connector) : current(connector))[0], {}]);
            return [x, y, isPrimary ? scale : l[2], l[3], l[4], screens];
        });
        const props = {};
        if (properties['supports-changing-layout-mode'])
            props['layout-mode'] = new this._GLib.Variant('u', layoutMode);
        await this._call('ApplyMonitorsConfig', new this._GLib.Variant(
            '(uua(iiduba(ssa{sv}))a{sv})', [serial, TEMPORARY, config, props]));
    }
};

