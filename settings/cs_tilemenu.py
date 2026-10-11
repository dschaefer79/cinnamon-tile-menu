#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 dschaefer79
# Written entirely with Claude Code (Anthropic).
# System Settings > Window Tiling: every setting of the Window Tiling applet,
# the same as its own settings window. Also builds the Resolution Menu page
# (cs_resolutionmenu.py). Installed by cinnamon-tile-menu.

import json
import os
import subprocess

from gi.repository import Gio, GLib, Gtk

# Cinnamon 6.6 and later import the settings helpers from bin; earlier
# versions (Debian 13) have bin itself on the path and no KeybindingTable.
try:
    from bin.JsonSettingsWidgets import *  # noqa: F401,F403 (widgets and pages)
    from bin.SettingsWidgets import SidePage
except ImportError:
    from JsonSettingsWidgets import *  # noqa: F401,F403
    from SettingsWidgets import SidePage
try:
    from bin import KeybindingTable
except ImportError:
    KeybindingTable = None

APPLETS_DIR = "/usr/share/cinnamon/applets"
SPICES_DIR = os.path.join(GLib.get_user_config_dir(), "cinnamon", "spices")

# The same widgets as Cinnamon's applet settings windows (xlet-settings).
WIDGETS = {
    "entry": "JSONSettingsEntry",
    "textview": "JSONSettingsTextView",
    "checkbox": "JSONSettingsSwitch",
    "switch": "JSONSettingsSwitch",
    "spinbutton": "JSONSettingsSpinButton",
    "scale": "JSONSettingsRange",
    "radiogroup": "JSONSettingsComboBox",
    "combobox": "JSONSettingsComboBox",
    "keybinding": "JSONSettingsKeybinding",
    "list": "JSONSettingsList",
}

# Settings that change Cinnamon itself: done here too, so they also work
# while the applet is not on the panel.
PANEL_SWITCHES = {"showTilingMenu": "tiling", "showResolutionMenu": "resolution"}


def instance_id(uuid):
    """The applet's instance id on the panel, or None."""
    for entry in Gio.Settings(schema_id="org.cinnamon").get_strv("enabled-applets"):
        parts = entry.split(":")
        if len(parts) >= 5 and parts[3] == uuid:
            return parts[4]
    return None


def settings_file(uuid, instance):
    for name in (uuid, instance):
        if name:
            path = os.path.join(SPICES_DIR, uuid, f"{name}.json")
            if os.path.exists(path):
                return path
    return None


def cinnamon_call(method, signature, *args):
    try:
        Gio.DBus.session.call_sync(
            "org.Cinnamon", "/org/Cinnamon", "org.Cinnamon", method,
            GLib.Variant(signature, args), None, Gio.DBusCallFlags.NONE, 2000, None)
    except GLib.Error:
        pass  # Cinnamon or the applet is not running.


class CallbackButton(Button):
    """A settings button that calls the applet, like in its own window."""

    def __init__(self, item, uuid, instance):
        super().__init__(item["description"])
        self.uuid, self.instance, self.xlet_callback = uuid, instance, str(item["callback"])

    def on_activated(self):
        cinnamon_call("activateCallback", "(sss)", self.xlet_callback, self.uuid, self.instance or "")


def build_applet_pages(side_page, uuid, name, panel_name):
    """Fill side_page with the settings of applet uuid, as laid out in its
    settings-schema.json."""
    instance = instance_id(uuid)
    path = settings_file(uuid, instance)
    if not path:
        page = SettingsPage()
        side_page.add_widget(page)
        section = page.add_section(name)
        section.add_row(Text(_("The %s applet has no settings yet: put it on the panel first.") % name))
        button = Button(_("Put the %s on the panel") % name.lower(),
                        lambda *_: subprocess.Popen(["cinnamon-tile-menu", "setup", panel_name]))
        section.add_row(button)
        return

    def changed(handler, key, value):
        cinnamon_call("updateSetting", "(ssss)", uuid, instance or "", key, json.dumps(value))
        if key in PANEL_SWITCHES:
            subprocess.Popen(["cinnamon-tile-menu", "setup" if value else "quit", PANEL_SWITCHES[key]])
        elif key == "windowEffects":
            Gio.Settings(schema_id="org.cinnamon").set_boolean("desktop-effects", value)

    # Cinnamon's shortcut editor knows applets by their settings file's name
    # (the uuid, or the instance id for applets that can be added more than
    # once); changes still go to the applet by its instance id.
    config_id = os.path.basename(path)[:-len(".json")]
    try:
        handler = JSONSettingsHandler(path, uuid, config_id, changed)
    except TypeError:  # Cinnamon before 6.6: the file and the callback only
        handler = JSONSettingsHandler(path, changed)
    with open(os.path.join(APPLETS_DIR, uuid, "settings-schema.json")) as f:
        schema = json.load(f)
    # Only settings the applet's file has (an older file may lack new ones).
    present = handler.settings

    # Cinnamon's shortcut editor knows the shortcuts of applets on the panel.
    shortcut_note = []

    def widget_for(key, item):
        kind = item.get("type")
        if kind == "button":
            return CallbackButton(item, uuid, instance)
        if kind == "label":
            return Text(_(item["description"]))
        if kind == "keybinding" and KeybindingTable and (
                not instance or KeybindingTable.get_default()
                .lookup_json_keybinding(uuid, config_id, key) is None):
            if shortcut_note:
                return None
            shortcut_note.append(key)
            return Text(_("Keyboard shortcuts can be changed here while the %s is on the panel.") % name.lower())
        if kind in WIDGETS and key in present:
            return globals()[WIDGETS[kind]](key, handler, item)
        return None

    def add(section, key, item):
        widget = widget_for(key, item)
        if widget is None:
            return
        if "dependency" in item and item["dependency"].lstrip("!") in present:
            section.add_reveal_row(widget, revealer=JSONSettingsRevealer(handler, item["dependency"]))
        else:
            section.add_row(widget)

    layout = schema.get("layout")
    if layout:
        side_page.stack = SettingsStack()
        side_page.add_widget(side_page.stack)
        for page_key in layout["pages"]:
            page_def = layout[page_key]
            page = SettingsPage()
            for section_key in page_def["sections"]:
                section_def = layout[section_key]
                section = page.add_section(_(section_def["title"]))
                for key in section_def["keys"]:
                    add(section, key, schema[key])
            side_page.stack.add_titled(page, page_key, _(page_def["title"]))
    else:
        page = SettingsPage()
        side_page.add_widget(page)
        section = None
        for key, item in schema.items():
            if not isinstance(item, dict) or "type" not in item:
                continue
            if item["type"] in ("section", "header"):
                section = page.add_section(_(item.get("title") or item.get("description", "")))
                continue
            if section is None:
                section = page.add_section(name)
            add(section, key, item)


class Module:
    name = "tilemenu"
    category = "prefs"
    comment = _("Tile windows into columns, rows or a grid, and the Window Tiling menu.")

    def __init__(self, content_box):
        keywords = _("tile, tiling, windows, columns, rows, grid, snap, shortcuts")
        self.sidePage = SidePage(_("Window Tiling"), "view-grid", keywords, content_box, module=self)

    def on_module_selected(self):
        if not self.loaded:
            build_applet_pages(self.sidePage, "tilemenu@dschaefer79", _("Window Tiling menu"), "tiling")
