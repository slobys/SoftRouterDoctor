#!/bin/sh
set -e

base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/srd-quality-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
. "$base/payload/quality.sh"
QUALITY_DIR="$scratch/store"
root="$scratch/sample"
mkdir "$QUALITY_DIR" "$root"

expect() { [ "$1" = "$2" ] || { printf 'Expected %s, got %s\n' "$2" "$1" >&2; exit 1; }; }
valid_interface_name() { case "$1" in ''|*[!A-Za-z0-9_.:@-]*) return 1 ;; esac; }
route_signature() {
	printf '%s\n' 'default dev unused metric 10' 'default from 2001:db8::/64 dev wan6 metric 20'
}
ip() {
	case "$*" in
		'-6 addr show dev unused scope global') : ;;
		'-6 addr show dev wan6 scope global')
			printf '  inet6 2001:db8::2/64 scope global\n' ;;
		'-6 route get 2606:4700:4700::1111 from 2001:db8::2 oif wan6')
			printf '2606:4700:4700::1111 from 2001:db8::2 dev wan6\n' ;;
		'-4 route get 1.1.1.1') printf '1.1.1.1 via 192.0.2.1 dev pppoe-wan\n' ;;
		*) return 1 ;;
	esac
}
expect "$(quality_route 4 1.1.1.1 | cut -d '|' -f 1,2)" 'pppoe-wan|pppoe-wan'
expect "$(quality_route 6 2606:4700:4700::1111 | cut -d '|' -f 1,2)" 'wan6|2001:db8::2'
expect "$(quality_route 4 223.5.5.5)" ''

cat > "$root/ping" <<'OUT'
64 bytes from 1.1.1.1: seq=0 ttl=55 time=11.5 ms
64 bytes from 1.1.1.1: seq=1 ttl=55 time=80 ms
64 bytes from 1.1.1.1: seq=1 ttl=55 time=82 ms (DUP!)
64 bytes from 1.1.1.1: seq=2 ttl=55 time=12 ms
64 bytes from 1.1.1.1: seq=3 ttl=55 time=13 ms
7 packets transmitted, 4 packets received, 42% packet loss
OUT
expect "$(quality_rtts "$root/ping")" '4|12.50|80.00'
expect "$(quality_rates '110.25 1000 2000' '112.25 101000 252000')" '1000|400'
expect "$(quality_rates '110 1000 4000' '112 7000 1000')" ''
expect "$(quality_rates '' '112 7000 8000')" ''
expect "$(quality_rates '110 1000 2000' '110.15 9000 4000')" ''

fixture_time=100
quality_time() { printf '%s\n' "$fixture_time"; }
expect "$(quality_reference v4a pathA 12 3 3 30 450)" '12|0|1'
expect "$(quality_reference v6a pathC 19 3 3 30 520)" '||0'
expect "$(quality_reference v4a pathA 35 7 7 4000 200)" '12|0|0'
fixture_time=160
expect "$(quality_reference v4a pathA 19 3 3 40 65)" '12|60|0'
expect "$(quality_reference v4a pathB 35 7 7 4000 40)" '||0'
expect "$(quality_reference v4a pathB 35 3 2 30 40)" '||0'
expect "$(quality_reference v4a pathB 18 3 3 30 40)" '18|0|1'
fixture_time=14600
expect "$(quality_reference v4a pathB 35 7 7 4000 40)" '||0'
expect "$(quality_result 7 7 48 12 7300 250)" elevated_upload
expect "$(quality_result 7 7 48 12 73 2500)" elevated_download
expect "$(quality_result 7 7 48 12 7300 2500)" elevated_both
expect "$(quality_result 7 7 48 12 '' '')" elevated
expect "$(quality_result 7 7 14 10 7300 20)" similar
expect "$(quality_result 7 6 48 12 7300 250)" loss
expect "$(quality_result 7 0 '' 12 7300 250)" no_reply
expect "$(quality_result 7 7 12 '' 7300 250)" no_reference
echo 'PASS: selected IPv4 and source-specific IPv6 routes, RTT and loss parsing, byte rates, comparison and reference bounds'
