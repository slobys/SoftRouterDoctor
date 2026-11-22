#!/bin/sh
# Exercise the actual router's APK binary with an isolated package database.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/soft-router-acceleration-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
SRD_APK=$(command -v apk)
SRD_ROOT="$scratch/root"
export SRD_APK SRD_ROOT
cache="$SRD_ROOT/var/cache/apk"
mkdir -p "$cache" "$scratch/bin"
LC_ALL=C APK_CONFIG=/dev/null apk --root "$SRD_ROOT" --initdb --no-network --no-logfile add >/dev/null
[ -f "$SRD_ROOT/lib/apk/db/lock" ] || touch "$SRD_ROOT/lib/apk/db/lock"

sed \
	-e "s|^PATH=|PATH=$scratch/bin:|" \
	-e "s|^APK_CACHE=.*|APK_CACHE=$cache|" \
	-e "s|^APK_CUSTOM_CACHE=.*|APK_CUSTOM_CACHE=$scratch/custom-cache|" \
	-e "s|^APK_DB_LOCK=.*|APK_DB_LOCK=$SRD_ROOT/lib/apk/db/lock|" \
	-e "s|/tmp/cache/apk)|$cache)|" \
	"$root/payload/doctor" > "$scratch/doctor"

cat > "$scratch/bin/apk" <<'WRAPPER'
#!/bin/sh
if [ "$1" = --version ]; then
	exec "$SRD_APK" --version
fi
LC_ALL=C APK_CONFIG=/dev/null exec "$SRD_APK" --root "$SRD_ROOT" --cache-dir /var/cache/apk \
	--no-network --no-logfile -vv --simulate cache clean
WRAPPER
chmod +x "$scratch/bin/apk"

value() {
	printf '%s\n' "$report" | jsonfilter -e "$1"
}

expect() {
	[ "$1" = "$2" ] || { printf 'Expected %s, got %s\n' "$2" "$1" >&2; exit 1; }
}

report=$(sh "$scratch/doctor" accelerate)
expect "$(value '@.state')" empty
test "$(value '@.memory_available')" -ge 0
echo 'PASS: real APK cache preview and real resource counters on an empty cache'

dd if=/dev/zero of="$cache/obsolete-1.0-r0.a1b2c3d4.apk" bs=4096 count=2 2>/dev/null
printf 'unused index' > "$cache/APKINDEX.a1b2c3d4.tar.gz"
printf 'user file' > "$cache/keep-me.txt"
printf 'outside sentinel' > "$scratch/sentinel"
ln -s "$scratch/sentinel" "$cache/example-1.0-r0.a1b2c3d4.apk"

report=$(sh "$scratch/doctor" accelerate)
expect "$(value '@.state')" ready
expect "$(value '@.candidate_count')" 2
token=$(value '@.token')
test -s "$cache/APKINDEX.a1b2c3d4.tar.gz"

report=$(sh "$scratch/doctor" accelerate --apply wrong)
expect "$(value '@.state')" rejected
test -s "$cache/APKINDEX.a1b2c3d4.tar.gz"

printf ' newly written' >> "$cache/APKINDEX.a1b2c3d4.tar.gz"
report=$(sh "$scratch/doctor" accelerate --apply "$token")
expect "$(value '@.state')" changed
test -s "$cache/APKINDEX.a1b2c3d4.tar.gz"
echo 'PASS: preview never deletes files, and apply rejects a stale confirmation'

report=$(sh "$scratch/doctor" accelerate)
token=$(value '@.token')
report=$(
	( flock -n 8 && sh "$scratch/doctor" accelerate --apply "$token" ) 8< "$SRD_ROOT/lib/apk/db/lock"
)
expect "$(value '@.state')" busy
test -s "$cache/APKINDEX.a1b2c3d4.tar.gz"

report=$(sh "$scratch/doctor" accelerate --apply "$token")
expect "$(value '@.state')" applied
expect "$(value '@.removed')" 2
test "$(value '@.reclaimed_kib')" -gt 0
test ! -e "$cache/APKINDEX.a1b2c3d4.tar.gz"
test ! -e "$cache/obsolete-1.0-r0.a1b2c3d4.apk"
test -L "$cache/example-1.0-r0.a1b2c3d4.apk"
test -s "$cache/keep-me.txt"
test -s "$scratch/sentinel"
echo 'PASS: lock contention blocks apply, and only the two eligible files were removed'

ln -s "$cache" "$scratch/custom-cache"
report=$(sh "$scratch/doctor" accelerate)
expect "$(value '@.state')" unavailable
echo 'PASS: custom offline cache is outside the cleanup scope'
