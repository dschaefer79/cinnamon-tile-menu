#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 dschaefer79
# Written entirely with Claude Code (Anthropic).
# Build cinnamon-tile-menu as a .deb for Linux Mint 22.3 (needs dpkg-deb).
#   build-deb.sh SOURCE_TARBALL VERSION OUTDIR
# The tarball is a git archive with the top directory cinnamon-tile-menu-VERSION.
set -eu
tarball=$1 version=$2 out=$3
name=cinnamon-tile-menu
revision=1
work=$(mktemp -d)
tar xzf "$tarball" -C "$work"
src=$work/$name-$version
root=$work/root

# The files, where the RPM puts them.
install -Dm 0755 "$src/$name" "$root/usr/bin/$name"
# Debian wants the shell at /bin/sh.
sed -i '1s|^#!/usr/bin/sh$|#!/bin/sh|' "$root/usr/bin/$name"
install -Dm 0644 "$src/$name.desktop" "$root/usr/share/applications/$name.desktop"
install -Dm 0644 "$src/cinnamon-resolution-menu.desktop" "$root/usr/share/applications/cinnamon-resolution-menu.desktop"
install -Dm 0644 "$src/$name-setup.desktop" "$root/etc/xdg/autostart/$name-setup.desktop"
mkdir -p "$root/usr/share/cinnamon/applets"
cp -r "$src/applets/tilemenu@dschaefer79" "$src/applets/resolutionmenu@dschaefer79" "$root/usr/share/cinnamon/applets/"
install -Dm 0644 -t "$root/usr/share/cinnamon/cinnamon-settings/modules" \
    "$src/settings/cs_tilemenu.py" "$src/settings/cs_resolutionmenu.py"
find "$root/usr/share/cinnamon/applets" -type d -exec chmod 0755 {} +
find "$root/usr/share/cinnamon/applets" -type f -exec chmod 0644 {} +

# Documentation, as Debian wants it.
doc=$root/usr/share/doc/$name
install -Dm 0644 "$src/README.md" "$doc/README.md"
cat > "$doc/copyright" <<EOF
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: $name
Upstream-Contact: dschaefer79 <7472357+dschaefer79@users.noreply.github.com>
Source: https://github.com/dschaefer79/$name
Comment: Written entirely with Claude Code, Anthropic's AI coding assistant.

Files: *
Copyright: 2026 dschaefer79
License: GPL-3.0-or-later

License: GPL-3.0-or-later
 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 .
 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.
 .
 On Debian systems, the complete text of the GNU General Public License
 version 3 can be found in "/usr/share/common-licenses/GPL-3".
EOF
cat > "$work/changelog" <<EOF
$name ($version-$revision) noble; urgency=medium

  * Package for Linux Mint 22.3 (Ubuntu 24.04 noble), built from
    https://github.com/dschaefer79/$name tag v$version.

 -- dschaefer79 <7472357+dschaefer79@users.noreply.github.com>  $(date -R)
EOF
gzip -9n -c "$work/changelog" > "$doc/changelog.Debian.gz"
chmod 0644 "$doc/changelog.Debian.gz"

# Control files.
mkdir -p "$root/DEBIAN"
size=$(du -sk --exclude=DEBIAN "$root" | cut -f1)
cat > "$root/DEBIAN/control" <<EOF
Package: $name
Version: $version-$revision
Architecture: all
Maintainer: dschaefer79 <7472357+dschaefer79@users.noreply.github.com>
Installed-Size: $size
Depends: cinnamon (>= 6.0), libglib2.0-bin, python3, python3-gi, gir1.2-gtk-3.0
Recommends: libnotify-bin, x11-xserver-utils, xcvt
Section: x11
Priority: optional
Homepage: https://github.com/dschaefer79/$name
Description: Cinnamon panel applets for window tiling and screen resolution
 Two applets for the Cinnamon panel. Window Tiling tiles the windows of the
 current workspace into columns, rows or a grid (automatically, 2, 3 or 4
 columns, 2 or 3 rows, a 2 x 2, 3 x 2 or 4 x 2 grid), puts them back with
 Restore, can tile new windows as they open and snap dropped windows into
 place, with keyboard shortcuts for every action. Resolution switches the
 screen resolution from a list you edit, adding sizes the screen does not
 offer with xrandr on X11.
 .
 Both have pages in System Settings. Works on X11 and Wayland.
 .
 Written entirely with Claude Code, Anthropic's AI coding assistant.
EOF
echo /etc/xdg/autostart/$name-setup.desktop > "$root/DEBIAN/conffiles"
cat > "$root/DEBIAN/postinst" <<'EOF'
#!/bin/sh
# Reload the applets for users who have them on their panel, so the new
# version is used without restarting Cinnamon.
set -e
if [ "$1" = configure ] && command -v loginctl >/dev/null 2>&1; then
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
fi
exit 0
EOF
chmod 0755 "$root/DEBIAN/postinst"

mkdir -p "$out"
dpkg-deb --root-owner-group --build "$root" "$out/${name}_${version}-${revision}_all.deb"
rm -rf "$work"
