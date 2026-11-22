#!/bin/sh
# Runs the real diagnosis logic with substituted command output and temporary files.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/soft-router-doctor-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
export SRD_TEST="$scratch"
mkdir "$scratch/bin" "$scratch/net"

sed \
	-e 's|^PATH=|PATH=$SRD_TEST/bin:|' \
	-e 's|^REVISION_FILE=.*|REVISION_FILE=$SRD_TEST/installed|' \
	-e 's|^REPAIR_LOCK=.*|REPAIR_LOCK=$SRD_TEST/repair|' \
	-e 's|/etc/init.d/dnsmasq|$SRD_TEST/bin/dnsmasq|g' \
	-e 's|/proc/net/|$SRD_TEST/net/|g' \
	"$root/payload/doctor" > "$scratch/doctor"

cat > "$scratch/bin/reply" <<'MOCK'
#!/bin/sh
case "${0##*/}:$*" in
	'ubus:-S call system board') echo '{"model":"Test board","release":{"description":"Test OpenWrt"}}' ;;
	'ubus:-S call network.interface.wan status') echo '{"up":true,"device":"eth0","ipv4-address":[{"address":"192.0.2.2"}]}' ;;
	'ubus:-S call network.interface.wan6 status') echo '{"up":false}' ;;
	'ubus:-S call network.interface.wan_6 status')
		if [ -f "$SRD_TEST/no-ipv6" ]; then
			echo '{"up":false}'
		else
			echo '{"up":true,"ipv6-address":[{"address":"2001:db8::2"}],"ipv6-prefix":[{"address":"2001:db8::"}]}'
		fi ;;
	'ubus:-S call network.interface.lan status')
		if [ -f "$SRD_TEST/no-lan-prefix" ]; then
			echo '{"up":true}'
		else
			echo '{"up":true,"ipv6-prefix-assignment":[{"address":"2001:db8:1::"}]}'
		fi ;;
	'ubus:-S call network.device status '*) echo '{"carrier":true}' ;;
	'ubus:-S call service list '*) echo '{}' ;;
	'ip:-4 route show default') echo 'default via 192.0.2.1' ;;
	'ip:-6 route show default')
		if [ ! -f "$SRD_TEST/no-ipv6" ]; then echo 'default via 2001:db8::1'; fi ;;
	'ping:-4 '*|'ping:-6 '*) exit 0 ;;
	'curl:-q -4 '*)
		if [ -f "$SRD_TEST/no-dns" ]; then exit 6; fi
		printf '200 0.1320' ;;
	'curl:-q -6 '*)
		if [ -f "$SRD_TEST/no-dns" ]; then exit 6; fi
		if [ -f "$SRD_TEST/no-web-v6" ]; then exit 28; fi
		printf '200 0.1430' ;;
	'uci:-q show dhcp') echo 'dhcp.@dnsmasq[0]=dnsmasq' ;;
	'pidof:dnsmasq') test -f "$SRD_TEST/running" ;;
	'dnsmasq:enabled') test ! -f "$SRD_TEST/disabled" ;;
	'dnsmasq:start') touch "$SRD_TEST/running" ;;
	'nslookup:'*)
		printf 'Server: 127.0.0.1\nAddress: 127.0.0.1:53\n'
		test -f "$SRD_TEST/running" && test ! -f "$SRD_TEST/no-dns" &&
			printf 'Name: fixture.example\nAddress: 192.0.2.2\n' ;;
	*) exit 1 ;;
esac
MOCK
chmod +x "$scratch/bin/reply"
for command in ubus ip ping curl uci pidof dnsmasq nslookup; do
	ln -s reply "$scratch/bin/$command"
done

printf '%s\n' 'sl local_address rem_address st' > "$scratch/net/tcp"
cp "$scratch/net/tcp" "$scratch/net/udp"
cp "$scratch/net/tcp" "$scratch/net/tcp6"
cp "$scratch/net/tcp" "$scratch/net/udp6"

read_field() {
	printf '%s\n' "$report" | jsonfilter -e "$1"
}

expect() {
	[ "$1" = "$2" ] || {
		printf 'Expected %s, got %s\n' "$2" "$1" >&2
		exit 1
	}
}

report=$(sh "$scratch/doctor" scan)
expect "$(read_field '@.can_start_dnsmasq')" true
expect "$(read_field '@.checks[@.id="dns"].state')" warning
expect "$(read_field '@.checks[@.id="internet_v4"].state')" passed
expect "$(read_field '@.checks[@.id="wan6"].state')" passed
expect "$(read_field '@.checks[@.id="prefix"].state')" passed
expect "$(read_field '@.checks[@.id="lan_prefix"].state')" passed
expect "$(read_field '@.findings[@.id="dns_service_stopped"].action')" start_dnsmasq
printf '%s\n' "$report" | grep -E '192\.0\.2\.|2001:db8' && exit 1
echo 'PASS: separates DNS failure and IP reachability, detects automatic IPv6, redacts addresses'

printf '%s\n' '0: 00000000:0035 00000000:0000 07' >> "$scratch/net/udp6"
report=$(sh "$scratch/doctor" fix-dns --confirm)
expect "$(read_field '@.state')" rejected
test ! -e "$scratch/running"
cp "$scratch/net/tcp" "$scratch/net/udp6"
touch "$scratch/disabled"
report=$(sh "$scratch/doctor" fix-dns --confirm)
expect "$(read_field '@.state')" rejected
test ! -e "$scratch/running"
rm -f "$scratch/disabled"
echo 'PASS: blocks recovery with a conflicting IPv6 DNS port or disabled service'

report=$(sh "$scratch/doctor" fix-dns --confirm)
expect "$(read_field '@.state')" repaired
test -f "$scratch/running"
report=$(sh "$scratch/doctor" fix-dns --confirm)
expect "$(read_field '@.state')" rejected
echo 'PASS: starts the isolated test service, verifies DNS and leaves a running service alone'

touch "$scratch/no-dns"
report=$(sh "$scratch/doctor" scan)
expect "$(read_field '@.findings[@.id="dns_resolution"].level')" high
expect "$(read_field '@.checks[@.id="https_v4"].state')" warning
rm -f "$scratch/no-dns"

touch "$scratch/no-web-v6" "$scratch/no-lan-prefix"
report=$(sh "$scratch/doctor" scan)
expect "$(read_field '@.checks[@.id="https_v4"].state')" passed
expect "$(read_field '@.checks[@.id="internet_v6"].state')" passed
expect "$(read_field '@.findings[@.id="ipv6_web"].level')" review
expect "$(read_field '@.findings[@.id="missing_lan_prefix"].level')" review
rm -f "$scratch/no-web-v6" "$scratch/no-lan-prefix"
echo 'PASS: groups DNS failure, an IPv6 HTTPS timeout with working Ping, and missing LAN prefix'

touch "$scratch/no-ipv6"
report=$(sh "$scratch/doctor" scan)
expect "$(read_field '@.checks[@.id="route_v6"].state')" skipped
expect "$(read_field '@.checks[@.id="https_v6"].state')" skipped
expect "$(read_field '@.findings[@.id="ipv6_web"].level' || true)" ''
rm -f "$scratch/no-ipv6"
echo 'PASS: an IPv4-only path does not produce an IPv6 website fault'

report=$(sh "$scratch/doctor" scan --local)
expect "$(read_field '@.mode')" local
expect "$(read_field '@.checks[@.id="dns"].state')" skipped
expect "$(read_field '@.checks[@.id="https_v4"].state')" skipped
echo 'PASS: local mode skips public DNS and HTTPS probes'
