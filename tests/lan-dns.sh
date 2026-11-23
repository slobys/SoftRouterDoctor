#!/bin/sh
set -eu
base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/srd-dns-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

awk -v host=nas.lan -v canary=srd-test.lan -v ready="$scratch/listening" -f "$base/payload/dns-trace.awk" <<'PACKETS' |
listening on any, link-type LINUX_SLL2, snapshot length 384 bytes
1.1 eth1 In IP 192.168.42.10.60001 > 192.168.42.1.53: 1+ A? ignored.lan. (25)
1.2 dae0 In IP 192.168.42.1.53 > 192.168.42.10.60001: 1 NXDomain 0/1/0 (100)
2.1 eth1 In IP 192.168.42.10.60002 > 192.168.42.1.53: 1+ A? nas.lan. (25)
2.2 dae0 In IP 192.168.42.1.53 > 192.168.42.10.60002: 1 NXDomain 0/1/0 (100)
2.3 eth1 Out IP 192.168.42.1.53 > 192.168.42.10.60002: 1 NXDomain 0/1/0 (100)
3.1 br-lan In IP6 fd42::10.60003 > fd42::1.53: 2+ AAAA? SRD-TEST.LAN. (30)
3.2 br-lan Out IP6 fd42::1.53 > fd42::10.60003: 2 0/1/0 (100)
4.1 eth1 In IP 192.168.42.10.9300 > 192.168.42.1.53: Flags [P.], seq 1:28, ack 1, win 502, length 27 8+ A? nas.lan. (25)
4.2 dae0 In IP 192.168.42.1.53 > 192.168.42.10.9300: Flags [P.], seq 1:103, ack 28, win 502, length 102 8 ServFail 0/1/0 (100)
5.1 eth1 In IP 192.168.42.10.60004 > 192.168.42.1.53: 2+ A? srd-test.lan. (30)
5.2 eth1 Out IP 192.168.42.1.53 > 192.168.42.10.60005: 2 1/0/0 (56)
PACKETS
	sort > "$scratch/actual"
cat > "$scratch/expected" <<'EXPECTED'
canary|AAAA|udp|fd42::1|no_records|
canary|A|udp|192.168.42.1|query_only|
name|A|tcp|192.168.42.1|error|dae0
name|A|udp|192.168.42.1|nxdomain|dae0
EXPECTED
test -s "$scratch/listening"
if ! cmp -s "$scratch/expected" "$scratch/actual"; then
	cat "$scratch/actual" >&2
	exit 1
fi
echo 'LAN DNS trace: exact names, IPv6, TCP, response matching and reply interface passed'
