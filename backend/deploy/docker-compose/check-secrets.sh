#!/bin/sh
set -eu
for f in secrets/mysql_password secrets/mysql_root_password secrets/bootstrap_admin_password secrets/pi_models.json; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
  mode=$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")
  [ "$mode" = 600 ] || [ "$mode" = 400 ] || { echo "$f must be mode 0600 or 0400 (is $mode)" >&2; exit 1; }
done
