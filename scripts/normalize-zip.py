#!/usr/bin/env python3
"""Rewrite an extension zip in place so that the same sources always give the same bytes: entries sorted, fixed
timestamp, fixed permissions, directory entries dropped. The SHA-256 that scripts/release.sh pins in install.sh can
then be checked against the zip the release workflow rebuilds from the tag.

Usage: normalize-zip.py ZIP
"""
import sys
import zipfile

EPOCH = (1980, 1, 1, 0, 0, 0)  # the earliest date a zip entry can hold


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    with zipfile.ZipFile(path) as z:
        entries = {i.filename: z.read(i) for i in z.infolist() if not i.is_dir()}
    with zipfile.ZipFile(path, "w") as z:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3  # Unix, so that the permissions below are honoured
            info.external_attr = 0o100644 << 16
            z.writestr(info, entries[name], compresslevel=9)


if __name__ == "__main__":
    main()
