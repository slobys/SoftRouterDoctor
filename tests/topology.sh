#!/bin/sh
# Compare topology using isolated routes, leases and neighbor records.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
fixture=$(mktemp -d /tmp/soft-router-topology-test.XXXXXX)
trap 'rm -rf "$fixture"' EXIT
export SRD_TOPOLOGY_FIXTURE="$fixture"
mkdir "$fixture/bin"

sed -e "s|^PATH=|PATH=$fixture/bin:|" \
	-e "s|^LEASE_FILE=.*|LEASE_FILE=$fixture/leases|" "$root/payload/doctor" > "$fixture/doctor"

cat > "$fixture/bin/mock" <<'MOCK'
#!/bin/sh
case "${0##*/}:$*" in
	'ubus:-S call system board') echo '{"model":"Topology fixture"}' ;;
	'ubus:-S call network.interface.wan status') echo '{"device":"eth0","l3_device":"pppoe-wan","proto":"pppoe"}' ;;
	'ubus:-S call network.interface.lan status') echo '{"up":true,"device":"br-lan","l3_device":"br-lan","ipv4-address":[{"address":"192.0.2.1","mask":24}]}' ;;
	'ubus:-S call network.interface.office status') echo '{"up":false,"device":"br-office","ipv4-address":[{"address":"198.51.100.1","mask":24}]}' ;;
	'ubus:-S call network.device status {"name":"eth0"}') echo '{"carrier":false}' ;;
	'ubus:-S call network.device status {"name":"br-lan"}') echo '{"carrier":true,"bridge-members":["eth1"]}' ;;
	'ubus:-S call network.device status {"name":"eth1"}') echo '{"carrier":true}' ;;
	'ubus:-S call network.device status {"name":"br-office"}') echo '{"carrier":false}' ;;
	'uci:-q show firewall') echo "firewall.@zone[3].name='guest'" ;;
	'uci:-q get firewall.@zone[3].network') echo office ;;
	'ip:-4 route show default')
		printf '%s\n' 'default dev pppoe-wan metric 90' 'default via 192.0.2.254 dev br-lan metric 20' ;;
	'ip:-6 route show default') if [ -f "$SRD_TOPOLOGY_FIXTURE/route-error" ]; then exit 1; fi ;;
	'ip:neigh show dev br-lan')
		printf '%s\n' '192.0.2.11 lladdr 02:00:00:00:00:11 REACHABLE' \
			'2001:db8::11 lladdr 02:00:00:00:00:11 STALE' \
			'192.0.2.12 FAILED' \
			'192.0.2.21 lladdr 02:00:00:00:00:21 STALE' \
			'192.0.2.22 FAILED' ;;
	'ip:neigh show dev br-office') ;;
	*) exit 1 ;;
esac
MOCK
chmod +x "$fixture/bin/mock"
for program in ip ubus uci; do ln -s mock "$fixture/bin/$program"; done
cat > "$fixture/leases" <<'LEASES'
4102444800 02:00:00:00:00:11 192.0.2.11 phone *
4102444800 02:00:00:00:00:12 192.0.2.12 printer *
4102444800 02:00:00:00:00:13 192.0.2.13 laptop *
1 02:00:00:00:00:19 192.0.2.19 expired *
4102444800 02:00:00:00:00:31 198.51.100.31 office_pc *
LEASES

value() { printf '%s\n' "$report" | jsonfilter -e "$1"; }
expect() {
	[ "$1" = "$2" ] || { printf 'Expected %s, got %s\n' "$2" "$1" >&2; exit 1; }
}

report=$(sh "$fixture/doctor" topology)
expect "$(value '@.outlets[0].device')" br-lan
expect "$(value '@.outlets[0].route_count')" 2
expect "$(value '@.outlets[1].readable')" true
expect "$(value '@.outlets[1].present')" false
expect "$(value '@.wan_carrier')" false
expect "$(value '@.segments[0].ports[0].name')" eth1
expect "$(value '@.segments[0].client_count')" 4
expect "$(value '@.segments[0].clients[0].host')" printer
expect "$(value '@.segments[0].clients[0].state')" unresolved
expect "$(value '@.segments[0].clients[@.host="phone"].ipv6')" 2001:db8::11
expect "$(value '@.segments[0].clients[@.host="laptop"].state')" lease
expect "$(value '@.segments[0].clients[@.address="192.0.2.21"].state')" known
expect "$(value '@.segments[1].clients[0].host')" office_pc
expect "$(value '@.segments[1].up')" false
echo 'PASS: preferred LAN route, bridge membership, segmented leases, IPv4/IPv6 merge and distinct device evidence'

touch "$fixture/route-error"
report=$(sh "$fixture/doctor" topology)
expect "$(value '@.outlets[1].readable')" false
echo 'PASS: a failed route read remains distinct from an unconfigured IPv6 route'
