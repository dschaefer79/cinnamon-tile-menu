# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 dschaefer79
# Written entirely with Claude Code (Anthropic).

%global applets %{_datadir}/cinnamon/applets

Name:           cinnamon-tile-menu
Version:        1.17
Release:        1%{?dist}
Summary:        Cinnamon panel applets for window tiling and screen resolution
License:        GPL-3.0-or-later
BuildArch:      noarch
Source0:        %{name}-%{version}.tar.gz

BuildRequires:  desktop-file-utils
BuildRequires:  python3
Requires:       cinnamon >= 6.0
Requires:       /usr/bin/gdbus
Requires:       /usr/bin/gsettings
Requires:       python3
Requires:       python3-gobject
Requires(posttrans): systemd
Requires(posttrans): /usr/bin/gdbus
Requires(posttrans): /usr/sbin/runuser
Recommends:     libnotify
# Switching resolutions and adding new ones in a Cinnamon X11 session
Recommends:     xrandr
Recommends:     cvt

%description
Two Cinnamon panel applets, the counterparts of plasma-tile-menu's widgets:

Window Tiling tiles the windows of the current workspace into side-by-side
columns, rows stacked top to bottom, or a grid of both: automatically (3
columns on screens at least 5120 pixels wide, such as 5120x1440, and 2
otherwise; rows follow the same rule by screen height), or into 4, 3 or 2
columns, 3 or 2 rows, or a 2x2, 3x2 or 4x2 grid directly, and puts them back with
Restore. New windows can be tiled automatically as they open, into the
layout last used on their screen. Its settings turn columns and rows on or
off, set the auto rules and the gap between windows (in pixels or
millimetres), and can turn on snapping: a window dragged with the mouse and
dropped fills the column, row or grid cell under the pointer. Snapping can
be limited to drops with Shift held, and Shift can swap columns and rows.
Every action can have a keyboard shortcut.

Resolution Menu switches the screen resolution from a list you edit in its
settings (1920x1080, 1900x1000 and 5120x1440 by default). In an X11
session, sizes the screen does not offer are added to it with xrandr, when
picked or right away from the settings. On Wayland, only sizes the screen
offers can be used.

Both applets are put on each user's panel, next to the system tray, at
their next login, or right away by running cinnamon-tile-menu setup.

This project was written entirely with Claude Code, Anthropic's AI coding assistant.

%prep
%autosetup

%build

%install
install -Dpm 0755 cinnamon-tile-menu %{buildroot}%{_bindir}/cinnamon-tile-menu
install -Dpm 0644 cinnamon-tile-menu.desktop %{buildroot}%{_datadir}/applications/cinnamon-tile-menu.desktop
install -Dpm 0644 cinnamon-resolution-menu.desktop %{buildroot}%{_datadir}/applications/cinnamon-resolution-menu.desktop
install -Dpm 0644 cinnamon-tile-menu-setup.desktop %{buildroot}%{_sysconfdir}/xdg/autostart/cinnamon-tile-menu-setup.desktop
install -dm 0755 %{buildroot}%{applets}
cp -pr applets/tilemenu@dschaefer79 applets/resolutionmenu@dschaefer79 %{buildroot}%{applets}/
install -Dpm 0644 -t %{buildroot}%{_datadir}/cinnamon/cinnamon-settings/modules settings/cs_tilemenu.py settings/cs_resolutionmenu.py

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/cinnamon-tile-menu.desktop
desktop-file-validate %{buildroot}%{_datadir}/applications/cinnamon-resolution-menu.desktop
desktop-file-validate %{buildroot}%{_sysconfdir}/xdg/autostart/cinnamon-tile-menu-setup.desktop
for f in $(find %{buildroot}%{applets} -name '*.json'); do
    python3 -m json.tool "$f" >/dev/null
done

%posttrans
# Reload the applets for users who have them on their panel, so the new
# version is used without restarting Cinnamon.
for uid in $(loginctl list-users --no-legend 2>/dev/null | awk '{print $1}'); do
    bus=/run/user/$uid/bus
    [ -S "$bus" ] || continue
    user=$(id -nu "$uid" 2>/dev/null) || continue
    running=$(runuser -u "$user" -- env DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
        gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
        --method org.Cinnamon.GetRunningXletUUIDs applet 2>/dev/null) || continue
    for uuid in tilemenu@dschaefer79 resolutionmenu@dschaefer79; do
        case $running in
            *"'$uuid'"*)
                runuser -u "$user" -- env DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" \
                    gdbus call --session --dest org.Cinnamon --object-path /org/Cinnamon \
                    --method org.Cinnamon.ReloadXlet "$uuid" APPLET >/dev/null 2>&1 || : ;;
        esac
    done
done
:

%files
%license LICENSE
%doc README.md
%{_bindir}/cinnamon-tile-menu
%{_datadir}/applications/cinnamon-tile-menu.desktop
%{_datadir}/applications/cinnamon-resolution-menu.desktop
%{_datadir}/cinnamon/cinnamon-settings/modules/cs_tilemenu.py
%{_datadir}/cinnamon/cinnamon-settings/modules/cs_resolutionmenu.py
%config(noreplace) %{_sysconfdir}/xdg/autostart/cinnamon-tile-menu-setup.desktop
%{applets}/tilemenu@dschaefer79/
%{applets}/resolutionmenu@dschaefer79/

%changelog
* Sun Oct 11 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.17-1
- Automatic tiling snaps dropped windows again, with and without Shift:
  Cinnamon 6.7 passes the display twice to the window drag signals, so the
  dropped window was never recognised
- Resolution: its settings window opens again. It is laid out in pages
  like the Window Tiling settings (Resolution, Settings file); before, the
  window stopped with an error, as Cinnamon looks for a description on
  section headers without a layout
- Packages for Fedora 44 and 45, Ubuntu 26.04 and 26.10, Debian 13 and
  Linux Mint 22.3

* Sun Oct 11 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.16-1
- Works with Cinnamon 6.4 (Debian 13) too: the shortcuts are bound with
  addHotKey where Cinnamon has no addXletHotKey, and the System Settings
  pages use the older settings modules there
- The .deb is built for Debian 13 and Linux Mint 22.3

* Sun Oct 11 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.15-1
- Works with Cinnamon 6.6 (Linux Mint 22.3): the applets load their own
  modules with require() where Cinnamon has no getCurrentExtension()
- packaging/build-deb.sh builds a .deb for Linux Mint 22.3

* Sun Oct 11 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.14-1
- License: GPL-3.0-or-later (was MIT), with the license text and a
  header in every source file
- README.md describing all features; the project was written entirely
  with Claude, Anthropic's AI assistant

* Sun Oct 11 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.13-1
- Cinnamon on Wayland: a window move the compositor drops (for instance
  while an app is still leaving maximized) is noticed and the window
  placed again; Restore also makes windows fullscreen again that were.
  Tested in a Cinnamon Wayland session: tiling, the 2 x 2 grid, tiling
  new windows, Restore and the Resolution menu

* Sun Oct 11 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.12-1
- System Settings: "Window Tiling" (Preferences) and "Resolution
  Menu" (Hardware) pages with every setting of the two applets, the
  same as their own settings windows, kept in step with them

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.11-1
- As in xfce-tile-menu: "Quit" in the Resolution menu; separate
  "Window Tiling Menu" and "Resolution Menu" entries in the
  applications menu, each putting its menu back on the panel; a Panel
  section in both applets' settings to show or hide each menu; and a
  Window effects switch (System Settings > Effects) in the Window
  Tiling settings. New: cinnamon-tile-menu setup|quit tiling|resolution

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.10-1
- "Save settings to file…" and "Load settings from file…" in the settings
  of both applets (a new "Settings file" page for Window Tiling): the
  settings of the tiling and resolution menus and the keyboard shortcuts
  in one file. New commands: cinnamon-tile-menu export|import FILE

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.9-1
- "Window Tiling Menu" in the applications menu (Utilities) puts the
  tiling menu on the panel, also after Quit

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.8-1
- Window Tiling: "Quit" at the end of the menu takes the applet off the panel, which also
  stops tiling and its shortcuts; "cinnamon-tile-menu setup" puts it
  back. New command: cinnamon-tile-menu quit

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.7-1
- Window Tiling: the menu shows the keyboard shortcut of each tiling
  entry and of Restore windows, on the right, and keeps it up to date

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.6-1
- Window Tiling: default keyboard shortcuts: Super+Alt+A tiles
  automatically, Super+Alt+2, 3 or 4 tiles in 2, 3 or 4 columns,
  Super+Ctrl+Alt+2 or 3 in 2 or 3 rows, Super+Ctrl+2, 3 or 4 in a 2 x 2,
  3 x 2 or 4 x 2 grid, and Super+Alt+0 restores the windows.
  Shortcuts still empty from earlier versions get their default key once

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.5-1
- Window Tiling: layouts keep their columns, rows and cells again (undoing
  the change of 1.4); the windows that do not fit are now tiled too,
  into the cell under their middle, behind the windows in front

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.4-1
- Window Tiling: the menu entries and shortcuts tile all windows on the
  screen, not only as many as the layout has cells; a column with more
  windows than rows splits its height among all of them

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.3-1
- Window Tiling: setting "Resize neighbouring windows together" (off by
  default): dragging the left or right edge of a window also moves the
  edge of the window beside it, keeping the gap, so windows side by side
  stay together

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.2-1
- Put the applets back on the panel at login when the panel layout was
  reset to Cinnamon's defaults (they stay off when removed by hand)

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.1-1
- Window Tiling: menu entries and shortcuts to tile in 4 columns and in a
  4 x 2 grid

* Sat Oct 10 2026 dschaefer79 <7472357+dschaefer79@users.noreply.github.com> - 1.0-1
- Initial package: Cinnamon port of plasma-tile-menu 1.12
