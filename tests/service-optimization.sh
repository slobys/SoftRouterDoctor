#!/bin/sh
# Replay service operations and network probes inside a temporary fixture.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d /tmp/soft-router-service-test.XXXXXX)
trap 'rm -rf "$work"' EXIT
export SRD_SERVICE_TEST="$work"
mkdir "$work/bin" "$work/init" "$work/rc"

sed \
	-e "s|^PATH=|PATH=$work/bin:|" \
	-e "s|^INIT_DIR=.*|INIT_DIR=$work/init|" \
	-e "s|^RC_DIR=.*|RC_DIR=$work/rc|" \
	-e "s|^OPTIMIZE_LOCK=.*|OPTIMIZE_LOCK=$work/lock|" \
	-e "s|^APK_CACHE=.*|APK_CACHE=$work/no-cache|" \
	"$root/payload/doctor" > "$work/doctor"

cat > "$work/init/samba4" <<'INIT'
#!/bin/sh
fixture=$SRD_SERVICE_TEST
case "$1" in
	enabled) test -f "$fixture/enabled" ;;
	enable) touch "$fixture/enabled" ;;
	disable) rm -f "$fixture/enabled" ;;
	start) touch "$fixture/running" ;;
	stop) rm -f "$fixture/running" ;;
	*) exit 1 ;;
esac
INIT
chmod +x "$work/init/samba4"
ln -s ../init/samba4 "$work/rc/S90samba4"
ln -s ../init/dnsmasq "$work/rc/S19dnsmasq"

cat > "$work/bin/mock" <<'MOCK'
#!/bin/sh
fixture=$SRD_SERVICE_TEST
case "${0##*/}:$*" in
	'apk:info --who-owns '*/samba4) printf '%s is owned by samba4-server-4.22.7-r3\n' "$3" ;;
	'apk:--version') echo 'apk-tools 3.0.5' ;;
	'ubus:-S call service list {"name":"samba4"}')
		if [ -f "$fixture/running" ]; then
			echo '{"samba4":{"instances":{"main":{"running":true,"pid":12345}}}}'
		else
			echo '{}'
		fi ;;
	'ip:-4 route show default') echo 'default via 192.0.2.1 dev wan' ;;
	'ip:-6 route show default') echo 'default via 2001:db8::1 dev wan expires 200sec' ;;
	'nslookup:example.com')
		test ! -f "$fixture/no-dns" && printf 'Name: example.com\nAddress: 192.0.2.2\n' ;;
	'curl:-q -6 '*)
		if [ -f "$fixture/fail-after-stop" ] && [ ! -f "$fixture/running" ]; then exit 28; fi
		printf '200' ;;
	'curl:-q -4 '*) printf '200' ;;
	*) exit 1 ;;
esac
MOCK
chmod +x "$work/bin/mock"
for program in apk ubus ip nslookup curl; do ln -s mock "$work/bin/$program"; done

value() { printf '%s\n' "$report" | jsonfilter -e "$1"; }
expect() {
	[ "$1" = "$2" ] || { printf 'Expected %s, got %s\n' "$2" "$1" >&2; exit 1; }
}

touch "$work/enabled" "$work/running"
report=$(sh "$work/doctor" accelerate)
token=$(value '@.services[@.id="samba4"].token')
test "${#token}" -eq 64
expect "$(value '@.services[@.id="samba4"].enabled')" true
expect "$(value '@.services[@.id="samba4"].running')" true
test -n "$(value '@.top_memory[0].name')"
for expression in '@.top_cpu[*].cpu_percent' '@.top_memory[*].rss_kib'; do
	value "$expression" | awk 'NR > 1 && ($1+0) > last { unsorted=1 } { last=$1+0 } END { exit unsorted }'
done
test -n "$(value '@.startups[*]' | grep -x dnsmasq)"

report=$(sh "$work/doctor" optimize-service dnsmasq "$token" true true)
expect "$(value '@.state')" rejected
report=$(sh "$work/doctor" optimize-service samba4 wrong true true)
expect "$(value '@.state')" rejected
touch "$work/no-dns"
report=$(sh "$work/doctor" optimize-service samba4 "$token" true true)
expect "$(value '@.state')" rejected
test -f "$work/enabled"
test -f "$work/running"
rm -f "$work/no-dns"
echo 'PASS: protected services, stale plans and failed network baseline are rejected'

report=$(sh "$work/doctor" optimize-service samba4 "$token" false true)
expect "$(value '@.state')" applied
test ! -f "$work/enabled"
test -f "$work/running"
touch "$work/enabled"

report=$(sh "$work/doctor" optimize-service samba4 "$token" true false)
expect "$(value '@.state')" applied
test -f "$work/enabled"
test ! -f "$work/running"
touch "$work/running"
echo 'PASS: stop-now and disable-autostart are independent actions'

touch "$work/fail-after-stop"
report=$(sh "$work/doctor" optimize-service samba4 "$token" true true)
expect "$(value '@.state')" reverted
test -f "$work/enabled"
test -f "$work/running"
test ! -d "$work/lock"
echo 'PASS: losing working IPv6 HTTPS restores both initial service states'
