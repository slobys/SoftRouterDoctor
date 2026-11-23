#!/bin/sh
set -e

base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/srd-monitor-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
. /usr/share/libubox/jshn.sh
. "$base/payload/monitor.sh"
MONITOR_DIR="$scratch/history"
NET_SYSFS="$scratch/net"
MONITOR_INIT="$scratch/init"
mkdir -p "$MONITOR_DIR" "$NET_SYSFS/eth0/device" "$NET_SYSFS/br-lan"

valid_interface_name() {
	case "$1" in ''|*[!A-Za-z0-9_.:@-]*) return 1 ;; *) return 0 ;; esac
}
field() { printf '%s\n' "$1" | jsonfilter -e "$2" 2>/dev/null || :; }
monitor_uptime() { printf '%s\n' "$tick"; }
monitor_is_running() { return 0; }
service_https() {
	printf '%s|%s\n' "$1" "${2:-primary}" >> "$scratch/probes"
	[ -f "$scratch/web-online" ]
}
sample() {
	printf '%s\n' "$1" > "$NET_SYSFS/eth0/carrier"
	printf '%s\n' "$2" > "$NET_SYSFS/eth0/speed"
	printf '%s\n' "$3" > "$NET_SYSFS/eth0/carrier_down_count"
	monitor_port eth0
}
clock() { tick=$1; wall=$((1800000000 + tick)); }

clock 100
sample 1 1000 30
monitor_metric route4 '' ok 1 1
monitor_metric route6 '' bad 1 1
monitor_pppoe '{"proto":"pppoe","up":true,"uptime":80}' eth0
test ! -s "$MONITOR_DIR/events"

clock 115
sample 1 100 30
test ! -s "$MONITOR_DIR/events"
clock 130
sample 1 100 31
grep -qxF '1800000115|port_speed|started|eth0|0|1000|100' "$MONITOR_DIR/events"
grep -qxF '1800000130|port_flap|observed|eth0|0|0|1' "$MONITOR_DIR/events"
clock 145
sample 0 0 32
monitor_metric route4 '' bad 1 1
monitor_pppoe '{"proto":"pppoe","up":false}' eth0
grep -qxF '1800000145|port_link|started|eth0|0|0|0' "$MONITOR_DIR/events"
grep -qxF '1800000145|pppoe|started|eth0|0|0|0' "$MONITOR_DIR/events"
clock 160
sample 1 1000 32
monitor_metric route4 '' ok 1 1
monitor_pppoe '{"proto":"pppoe","up":true,"uptime":3}' eth0
grep -qxF '1800000160|port_speed|restored|eth0|45|100|1000' "$MONITOR_DIR/events"
grep -qxF '1800000160|port_link|restored|eth0|15|0|0' "$MONITOR_DIR/events"
grep -qxF '1800000160|route4|restored||15|0|0' "$MONITOR_DIR/events"
grep -qxF '1800000160|pppoe|restored|eth0|15|0|0' "$MONITOR_DIR/events"
! grep -q 'route6' "$MONITOR_DIR/events"
! grep -q 'pppoe_reconnect' "$MONITOR_DIR/events"
clock 175
monitor_pppoe '{"proto":"pppoe","up":true,"uptime":2}' eth0
grep -qxF '1800000175|pppoe_reconnect|observed|eth0|0|0|0' "$MONITOR_DIR/events"

clock 200
monitor_metric dns '' bad 2 0
monitor_web 4 ok bad
monitor_web 6 bad ok
test ! -f "$scratch/probes"
clock 260
monitor_metric dns '' bad 2 0
grep -qxF '1800000200|dns|started||0|0|0' "$MONITOR_DIR/events"
clock 320
monitor_metric dns '' ok 2 0
monitor_web 4 ok ok
test "$(wc -l < "$scratch/probes")" -eq 2
! grep -q 'web4' "$MONITOR_DIR/events"
clock 380
monitor_web 4 ok ok
grep -qxF '1800000320|web4|started||0|0|0' "$MONITOR_DIR/events"
touch "$scratch/web-online"
clock 440
monitor_web 4 ok ok
grep -qxF '1800000440|web4|restored||120|0|0' "$MONITOR_DIR/events"
! grep -q 'web6' "$MONITOR_DIR/events"
! physical_port_sample br-lan
printf '%s|%s\n' "$wall" "$tick" > "$MONITOR_DIR/heartbeat"
status=$(monitor_status)
test "$(printf '%s' "$status" | jsonfilter -e '@.running')" = true
test "$(printf '%s' "$status" | jsonfilter -e '@.sample_age')" = 0
test "$(printf '%s' "$status" | jsonfilter -e '@.events[0].kind')" = port_flap
json_init
add_port_metrics eth0
test "$(json_dump | jsonfilter -e '@.drops_observed')" = 2

i=0
while [ "$i" -lt 99 ]; do
	monitor_event port_flap observed eth0 0 0 1
	i=$((i+1))
done
test "$(wc -l < "$MONITOR_DIR/events")" -eq 96
echo 'PASS: speed baseline, transient link loss, PPPoE re-establishment, isolated DNS and HTTPS observations, and bounded history'
