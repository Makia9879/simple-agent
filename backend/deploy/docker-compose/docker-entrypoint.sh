#!/bin/sh
set -eu

# Named volumes are created root-owned. Fix only the PI state directory before
# dropping privileges so PI never needs to run as root.
mkdir -p /var/lib/tah/pi-sessions
chown -R tah:tah /var/lib/tah
chmod 0700 /var/lib/tah/pi-sessions
exec su-exec tah "$@"
