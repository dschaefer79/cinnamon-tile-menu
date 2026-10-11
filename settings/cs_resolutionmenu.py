#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 dschaefer79
# Written entirely with Claude Code (Anthropic).
# System Settings > Resolution Menu: every setting of the Resolution applet,
# the same as its own settings window. Installed by cinnamon-tile-menu.

from bin.SettingsWidgets import SidePage
from cs_tilemenu import build_applet_pages


class Module:
    name = "resolutionmenu"
    category = "hardware"
    comment = _("The resolutions in the Resolution menu.")

    def __init__(self, content_box):
        keywords = _("resolution, screen, display, xrandr, menu")
        self.sidePage = SidePage(_("Resolution Menu"), "video-display", keywords, content_box, module=self)

    def on_module_selected(self):
        if not self.loaded:
            build_applet_pages(self.sidePage, "resolutionmenu@dschaefer79", _("Resolution menu"), "resolution")
