#!/bin/sh
# Exercise persisted identity and changing local lease/neighbor evidence.
set -eu
base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/srd-saved-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
export SRD_SAVED_TEST="$scratch"
mkdir "$scratch/bin"
: > "$scratch/leases"
: > "$scratch/neighbors"
sed -e "s|^PATH=|PATH=$scratch/bin:|" \
	-e "s|^SAVED_TOPOLOGY_LIB=.*|SAVED_TOPOLOGY_LIB=$scratch/topology.sh|" \
	-e "s|^LEASE_FILE=.*|LEASE_FILE=$scratch/leases|" "$base/payload/doctor" > "$scratch/doctor"
sed -e "s|^SAVED_TOPOLOGY=.*|SAVED_TOPOLOGY=$scratch/config/topology|" \
	-e "s|^SAVED_TOPOLOGY_LOCK=.*|SAVED_TOPOLOGY_LOCK=$scratch/lock|" \
	"$base/payload/topology.sh" > "$scratch/topology.sh"

cat > "$scratch/bin/stub" <<'STUB'
#!/bin/sh
case "${0##*/}:$*" in
	'ubus:-S call network.interface.lan status')
		echo '{"up":true,"l3_device":"br-fixture","ipv4-address":[{"address":"192.168.42.1","mask":24}]}' ;;
	'ip:-4 route get 192.168.42.'*) printf '%s dev br-fixture src 192.168.42.1\n' "$4" ;;
	'ip:-4 route get 192.168.99.9') echo '192.168.99.9 via 192.168.42.100 dev br-fixture' ;;
	'ip:-4 neigh show') cat "$SRD_SAVED_TEST/neighbors" ;;
	'ping:-4 -I br-fixture -c 1 -W 1 192.168.42.'*) echo "$8" >> "$SRD_SAVED_TEST/probed" ;;
	*) exit 1 ;;
esac
STUB
chmod +x "$scratch/bin/stub"
for cmd in ip ping ubus uci; do ln -s stub "$scratch/bin/$cmd"; done

read_map() { answer=$(sh "$scratch/doctor" saved-topology); }
field() { printf '%s\n' "$answer" | jsonfilter -e "$1"; }
edit() { answer=$(sh "$scratch/doctor" edit-topology "$@"); }
expect() { [ "$1" = "$2" ] || { printf 'Expected %s, got %s\n' "$2" "$1" >&2; exit 1; }; }
neighbor() { printf '%s dev br-fixture lladdr %s REACHABLE\n' "$1" "$2" >> "$scratch/neighbors"; }
lease() { printf '%s %s %s example *\n' "$1" "$2" "$3" >> "$scratch/leases"; }

first_mac=02:01:02:03:04:10
second_mac=02:01:02:03:04:11
neighbor 192.168.42.10 "$first_mac"
lease 4102444800 "$first_mac" 192.168.42.10
read_map
empty_revision=$(field '@.revision')
edit save "$empty_revision" '' 192.168.42.10 "客厅 AP's" ap
expect "$(field '@.state')" applied
read_map
id=$(field '@.nodes[0].id')
expect "$(field '@.nodes[0].mac')" "$first_mac"
expect "$(field '@.nodes[0].state')" confirmed
expect "$(field '@.nodes[0].source')" both
revision=$(field '@.revision')
edit save "$empty_revision" '' 192.168.42.20 '另一台' mesh
expect "$(field '@.state')" stale

# Simulate the volatile tables disappearing and dnsmasq learning a new lease.
: > "$scratch/neighbors"
: > "$scratch/leases"
read_map
expect "$(field '@.nodes[0].state')" unseen
expect "$(field '@.nodes[0].id')" "$id"
lease 1 "$first_mac" 192.168.42.10
lease 4102444800 "$second_mac" 192.168.42.10
lease 4102444800 "$first_mac" 192.168.42.99
read_map
expect "$(field '@.nodes[0].state')" updated
expect "$(field '@.nodes[0].address')" 192.168.42.99
expect "$(field '@.nodes[0].name')" "客厅 AP's"
expect "$(field '@.nodes[0].mode')" ap
expect "$(field '@.revision')" "$revision"

# Repeated/contradictory evidence cannot invent a new identity or address.
lease 4102444800 "$first_mac" 192.168.42.98
read_map
expect "$(field '@.nodes[0].state')" ambiguous
: > "$scratch/leases"
lease 4102444800 "$second_mac" 192.168.42.10
read_map
expect "$(field '@.nodes[0].state')" conflict
expect "$(field '@.nodes[0].address')" ''

edit save "$revision" '' 192.168.99.9 '后级路由' router
expect "$(field '@.state')" applied
expect "$(cat "$scratch/probed")" 192.168.42.10
read_map
later=$(field '@.nodes[1].id')
expect "$(field '@.nodes[1].state')" unbound
neighbor 192.168.42.20 "$second_mac"
edit bind "$(field '@.revision')" "$later" 192.168.42.20 '' ''
expect "$(field '@.state')" applied
read_map
expect "$(field '@.nodes[1].mac')" "$second_mac"
edit save "$(field '@.revision')" '' 192.168.42.20 duplicate bridge
expect "$(field '@.state')" rejected
read_map
edit up "$(field '@.revision')" "$later" '' '' ''
expect "$(field '@.state')" applied
read_map
expect "$(field '@.nodes[0].id')" "$later"
edit save "$(field '@.revision')" "$later" '' '房间 Mesh' mesh
expect "$(field '@.state')" applied
read_map
expect "$(field '@.nodes[0].mac')" "$second_mac"
expect "$(field '@.nodes[0].name')" '房间 Mesh'
edit remove "$(field '@.revision')" "$later" '' '' ''
expect "$(field '@.state')" applied
read_map
expect "$(field '@.nodes[0].id')" "$id"
echo 'PASS: MAC binding, persistent order and labels, changed lease, reuse conflict, ambiguity, rebind and write revision'
