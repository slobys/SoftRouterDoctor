#!/bin/sh
# Verify that active discovery stays on the attached private subnet and labels evidence.
set -eu
base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/soft-router-discovery-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
export SRD_DISCOVERY="$scratch"
mkdir "$scratch/bin"
: > "$scratch/leases"
sed -e "s|^PATH=|PATH=$scratch/bin:|" \
	-e "s|^LEASE_FILE=.*|LEASE_FILE=$scratch/leases|" \
	"$base/payload/doctor" > "$scratch/doctor"

cat > "$scratch/bin/stub" <<'STUB'
#!/bin/sh
case "${0##*/}:$*" in
	'ubus:-S call network.interface.lan status')
		echo '{"device":"br-lan","l3_device":"br-lan","up":true,"ipv4-address":[{"address":"192.0.2.1","mask":29}]}' |
			sed 's/192\.0\.2/192.168.96/g' ;;
	'ubus:-S call network.device status {"name":"br-lan"}') echo '{"carrier":true,"bridge-members":["eth1"]}' ;;
	'ubus:-S call network.device status {"name":"eth1"}') echo '{"carrier":true}' ;;
	'ubus:-S call system board') echo '{"model":"Fixture"}' ;;
	'ip:neigh show dev br-lan') printf '%s\n' \
		'192.168.96.2 lladdr 02:00:00:00:00:21 REACHABLE' \
		'192.168.96.3 lladdr 02:00:00:00:00:31 REACHABLE' \
		'192.168.97.2 lladdr 02:00:00:00:00:41 REACHABLE' ;;
	'ip:-4 route show default'|'ip:-6 route show default'|'uci:-q show firewall') ;;
	'ping:-4 -I br-lan -c 1 -W 1 '*) echo "$8" >> "$SRD_DISCOVERY/probes" ;;
	'curl:-q -4 -fs --noproxy * --interface br-lan --proto =http '*192.168.96.2/) echo '<html><title>Fixture Router</title></html>' ;;
	'curl:-q -4 -fs --noproxy * --interface br-lan --proto =http '*192.168.96.3/) echo '<title>Camera</title>' ;;
	'lldpcli:-f keyvalue show neighbors details') echo 'lldp.eth1.chassis.name=Fixture Switch' ;;
	'tcpdump:-p -i eth1 -enn -tt -vv -x -l -c 40 -s 512 '*0x88cc*0x893a*)
		cat <<'FRAME'
1710000050.000001 f4:2a:7d:75:18:0d > 01:80:c2:00:00:0e, ethertype LLDP (0x88cc), length 98
	Port Description TLV (4), length 5: Wired
	System Name TLV (5), length 16: Fixture AP
		Management Address length 5, AFI IPv4 (1): 192.168.96.4
		System  Capabilities [Bridge, WLAN AP] (0x000c)
		Enabled Capabilities [WLAN AP] (0x0008)
1710000051.000001 f4:2a:7d:75:18:0d > 01:80:c2:00:00:13, ethertype IEEE1905.1 (0x893a), length 39
	0x0000:  0000 0000 b2a9 0080 0100 06f4 2a7d 7518  ................
	0x0010:  0d80 0002 0100 0000 00                   .........
1710000052.000001 f4:2a:7d:75:18:0e > 01:80:c2:00:00:13, ethertype IEEE1905.1 (0x893a), length 39
	0x0000:  0000 0000 b2a9 0080 0100 06f4 2a7d 7518  ................
	0x0010:  0e80 0002 0101 0000 00                   .........
1710000053.000001 f4:2a:7d:75:18:0f > 01:80:c2:00:00:13, ethertype IEEE1905.1 (0x893a), length 39
	0x0000:  0000 0000 b2a9 00c0 0100 06f4 2a7d 7518  ................
	0x0010:  0f80 0002 0101 0000 00                   .........
1710000054.000001 f4:2a:7d:75:18:10 > 01:80:c2:00:00:13, ethertype IEEE1905.1 (0x893a), length 39
	0x0000:  0000 0000 b2a9 0080 0100 06f4 2a7d 7518  ................
	0x0010:  1080 0022 0101                           ......
FRAME
		;;
	*) exit 1 ;;
esac
STUB
chmod +x "$scratch/bin/stub"
for program in ubus ip uci ping curl lldpcli tcpdump; do ln -s stub "$scratch/bin/$program"; done

answer=$(sh "$scratch/doctor" discover-routers)
field() { printf '%s\n' "$answer" | jsonfilter -e "$1"; }
test "$(field '@.hosts_probed')" = 5
test "$(field '@.pages_checked')" = 2
test "$(field '@.routers[0].title')" = 'Fixture Router'
test "$(field '@.lldp_ports')" = 1
test "$(field '@.lldp[0].name')" = 'Fixture AP'
test "$(field '@.lldp[0].address')" = 192.168.96.4
test "$(field '@.lldp[0].capabilities')" = 'WLAN AP'
test "$(field '@.lldp[0].advertised_port')" = Wired
test "$(field '@.lldp[0].mac')" = 'f4:2a:7d:75:18:0d'
test "$(field '@.mesh[0].role')" = controller
test "$(field '@.mesh[1].role')" = agent
test -z "$(field '@.mesh[2].role' || true)"
test -z "$(field '@.routers[1].title' || true)"
test "$(sort "$scratch/probes")" = "$(printf '%s\n' 192.168.96.2 192.168.96.3 192.168.96.4 192.168.96.5 192.168.96.6)"
echo 'PASS: bounded private-subnet discovery, local interface binding and router identity without hostname input'

: > "$scratch/probes"
answer=$(sh "$scratch/doctor" discover-routers --listen-only)
test "$(field '@.hosts_probed')" = 0
test "$(field '@.pages_checked')" = 0
test "$(field '@.lldp[0].name')" = 'Fixture AP'
test ! -s "$scratch/probes"
echo 'PASS: LLDP retry sends no active network probes'

answer=$(sh "$scratch/doctor" topology)
test "$(field '@.lldp[0].port')" = eth1
test "$(field '@.lldp[0].name')" = 'Fixture Switch'
echo 'PASS: LLDP daemon fallback and distinct IEEE 1905.1 controller and agent observations'
