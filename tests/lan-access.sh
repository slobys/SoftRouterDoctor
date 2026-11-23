#!/bin/sh
# Run on OpenWrt to exercise the diagnostic with isolated routes and services.
set -eu
base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/srd-lan-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
export SRD_LAN_TEST="$scratch"
mkdir "$scratch/bin"
sed -e "s|^PATH=|PATH=$scratch/bin:|" \
	-e "s|^SAVED_TOPOLOGY_LIB=.*|SAVED_TOPOLOGY_LIB=$base/payload/topology.sh|" \
	-e "s|^LAN_ACCESS_LIB=.*|LAN_ACCESS_LIB=$scratch/lan-access.sh|" "$base/payload/doctor" > "$scratch/doctor"
sed "s|^LAN_ACCESS_LOCK=.*|LAN_ACCESS_LOCK=$scratch/lock|" "$base/payload/lan-access.sh" > "$scratch/lan-access.sh"

cat > "$scratch/bin/stub" <<'STUB'
#!/bin/sh
case "${0##*/}:$*" in
	'ubus:-S call network.interface.lan status')
		echo '{"up":true,"l3_device":"br-lan","ipv4-address":[{"address":"192.168.42.1","mask":24}]}' ;;
	'ubus:-S call network.interface.guest status')
		echo '{"up":true,"l3_device":"br-guest","ipv4-address":[{"address":"192.168.43.1","mask":24}]}' ;;
	'uci:-q show firewall')
		printf '%s\n' 'firewall.home=zone' "firewall.home.name='lan'" 'firewall.visitor=zone' "firewall.visitor.name='guest'"
		[ ! -r "$SRD_LAN_TEST/forward" ] || echo 'firewall.permit=forwarding' ;;
	'uci:-q get firewall.home.network'|'uci:-q get firewall.home.name'|'uci:-q get firewall.permit.dest') echo lan ;;
	'uci:-q get firewall.visitor.network'|'uci:-q get firewall.visitor.name'|'uci:-q get firewall.permit.src') echo guest ;;
	'uci:-q get firewall.permit.family') cat "$SRD_LAN_TEST/forward" ;;
	'ip:-4 route get 192.168.42.'*) printf '%s dev br-lan src 192.168.42.1\n' "$4" ;;
	'ip:-4 route get 192.168.43.'*) printf '%s dev br-guest src 192.168.43.1\n' "$4" ;;
	'ip:-4 route get 192.168.99.9') echo '192.168.99.9 via 192.168.42.10 dev br-lan' ;;
	'ip:-4 neigh show to 192.168.42.20 dev br-lan') echo '192.168.42.20 lladdr 02:01:02:03:04:05 STALE' ;;
	'ping:'*)
		printf '%s\n' "$*" >> "$SRD_LAN_TEST/probes"
		[ ! -f "$SRD_LAN_TEST/silent" ] ;;
	'ucode:'*)
		for last; do address=$port; port=$device; device=$last; done
		printf 'tcp %s %s %s\n' "$address" "$port" "$device" >> "$SRD_LAN_TEST/probes"
		if [ -r "$SRD_LAN_TEST/tcp" ]; then cat "$SRD_LAN_TEST/tcp"; else printf open; fi ;;
	'avahi-browse:-rptk _smb._tcp')
		echo '=;br-guest;IPv4;Unequal;_smb._tcp;local;Other.local;192.168.42.20;445;'
		[ -f "$SRD_LAN_TEST/silent" ] ||
			echo '=;br-lan;IPv4;NAS;_smb._tcp;local;NAS.local;192.168.42.20;445;' ;;
	'avahi-browse:-rptk _airplay._tcp') exit 124 ;;
	'avahi-browse:-rptk _googlecast._tcp') exit 0 ;;
	'curl:-q -4 -I -s --noproxy * --interface if!br-lan --proto =http,https --connect-timeout 2 --max-time 3 -o /dev/null -w %{http_code} '*)
		for url; do :; done
		printf 'web %s\n' "$url" >> "$SRD_LAN_TEST/probes"
		[ ! -f "$SRD_LAN_TEST/bad-curl" ] || exit 45
		[ ! -f "$SRD_LAN_TEST/no-web" ] || exit 7
		case "$url" in
			http://192.168.42.20:80/) printf 302 ;;
			http://192.168.42.20:5000/) printf 200 ;;
			https://192.168.42.20:443/) exit 60 ;;
			*) exit 7 ;;
		esac ;;
	*) exit 1 ;;
esac
STUB
chmod +x "$scratch/bin/stub"
for cmd in ip ping ubus uci ucode avahi-browse curl; do ln -s stub "$scratch/bin/$cmd"; done
: > "$scratch/probes"

run() { answer=$(sh "$scratch/doctor" lan-access "$@"); }
expect() {
	actual=$(printf '%s\n' "$answer" | jsonfilter -e "$1") || actual=''
	[ "$actual" = "$2" ] || { printf '%s expected %s, got %s\n%s\n' "$1" "$2" "$actual" "$answer" >&2; exit 1; }
}

run 192.168.42.10 192.168.42.20 smb
expect '@.relationship' same_link
expect '@.source.interface' lan
expect '@.target.icmp' reply
expect '@.target.neighbor' cached
expect '@.service.tcp' open
expect '@.service.announcements[0]' _smb._tcp
grep -qx 'tcp 192.168.42.20 445 br-lan' "$scratch/probes"
if grep -q '^web ' "$scratch/probes"; then exit 1; fi

run 192.168.42.10 192.168.42.20 smb true
expect '@.web.state' checked
expect '@.web.endpoints[0].status' 302
expect '@.web.endpoints[1].port' 5000
expect '@.web.endpoints[1].status' 200
expect '@.web.endpoints[2].scheme' https
expect '@.web.endpoints[2].state' certificate
expect '@.web.endpoints[3].state' ''
[ "$(grep -c '^web ' "$scratch/probes")" -eq 6 ]

touch "$scratch/no-web"
run 192.168.42.10 192.168.42.20 smb true
expect '@.web.state' checked
expect '@.web.endpoints[0].state' ''
touch "$scratch/bad-curl"
run 192.168.42.10 192.168.42.20 smb true
expect '@.web.state' unavailable
expect '@.web.endpoints[0].state' ''

run 192.168.43.10 192.168.42.20 reach
expect '@.relationship' cross_network
expect '@.source.zone' guest
expect '@.target.zone' lan
expect '@.forwarding' no_zone_forwarding
echo ipv6 > "$scratch/forward"
run 192.168.43.10 192.168.42.20 reach
expect '@.forwarding' no_zone_forwarding
echo any > "$scratch/forward"
run 192.168.43.10 192.168.42.20 reach
expect '@.forwarding' configured

touch "$scratch/silent"
printf refused > "$scratch/tcp"
run '' 192.168.42.20 smb
expect '@.relationship' unknown
expect '@.target.icmp' no_reply
expect '@.service.tcp' refused
expect '@.service.mdns' not_seen
run '' 192.168.42.20 cast
expect '@.service.mdns' incomplete
expect '@.service.tcp' untested
printf timeout > "$scratch/tcp"
run '' 192.168.42.20 print
expect '@.service.tcp' timeout
expect '@.service.mdns' unavailable
grep -qx 'tcp 192.168.42.20 631 br-lan' "$scratch/probes"

: > "$scratch/probes"
run 192.168.42.10 192.168.99.9 smb true
expect '@.state' outside
run '' 192.168.42.255 smb
expect '@.state' outside
run '' 192.168.42.1 smb
expect '@.state' outside
run '' 8.8.8.8 smb true
expect '@.state' rejected
run '' 192.168.42.20 arbitrary-service
expect '@.state' rejected
[ ! -s "$scratch/probes" ]
echo 'lan access scenarios passed'
