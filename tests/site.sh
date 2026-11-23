#!/bin/sh
set -e

base=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d /tmp/srd-site-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
mkdir "$scratch/bin"
export SRD_SITE_TEST="$scratch"
export PATH="$scratch/bin:$PATH"
. /usr/share/libubox/jshn.sh
. "$base/payload/site.sh"
SITE_LOCK="$scratch/lock"

valid_interface_name() { case "$1" in ''|*[!A-Za-z0-9_.:@-]*) return 1 ;; *) return 0 ;; esac; }
repair_result() { json_init; json_add_string state "$1"; json_add_string detail "$2"; json_dump; }
expect() { [ "$1" = "$2" ] || { printf 'Expected %s, got %s\n' "$2" "$1" >&2; exit 1; }; }
field() { printf '%s\n' "$report" | jsonfilter -e "$1"; }

cat > "$scratch/bin/nslookup" <<'STUB'
#!/bin/sh
printf 'Server: resolver\nAddress: 9.9.9.9:53\n\n'
case "$2" in
	no-dns.example.) echo "** server can't find $2: NXDOMAIN"; exit 1 ;;
	dns-timeout.example.) echo 'connection timed out; no servers could be reached'; exit 1 ;;
	dns-fail.example.) echo "** server can't find $2: SERVFAIL"; exit 1 ;;
esac
echo 'Non-authoritative answer:'
case "$1:$2" in
	-type=A:blocked.example.) printf 'Name: blocked.example\nAddress: 192.168.1.1\n' ;;
	-type=AAAA:blocked.example.) printf 'Name: blocked.example\nAddress: fd00::1\n' ;;
	-type=AAAA:only4.example.) exit 0 ;;
	-type=AAAA:local-path.example.) printf 'Name: local-path.example\nAddress: 2001:4860:abc::2\n' ;;
	-type=A:alternate.example.) printf 'Name: alternate.example\nAddress: 8.8.8.8\nName: alternate.example\nAddress: 9.9.9.9\n' ;;
	-type=A:*) printf 'Name: %s\nAddress: 8.8.8.8\n' "$2" ;;
	-type=AAAA:*) printf 'Name: %s\nAddress: 2606:4700::1111\n' "$2" ;;
esac
STUB
cat > "$scratch/bin/ip" <<'STUB'
#!/bin/sh
case "$*" in
	'-4 route get '*) printf '%s via 192.168.1.1 dev wan0\n' "$4" ;;
	'-6 route get 2001:4860:abc::2') echo '2001:4860:abc::2 dev br-lan' ;;
	'-6 route get '*) printf '%s dev pppoe-wan\n' "$4" ;;
	'-o link show dev pppoe-wan') echo '14: pppoe-wan: <POINTOPOINT,MULTICAST,NOARP,UP>' ;;
	'-o link show dev br-lan') echo '14: br-lan: <BROADCAST,MULTICAST,UP>' ;;
	*) exit 1 ;;
esac
STUB
cat > "$scratch/bin/curl" <<'STUB'
#!/bin/sh
while [ "$#" -gt 0 ]; do
	case "$1" in
		--resolve) pin="$2"; shift ;;
		--interface) device="$2"; shift ;;
		--head) head=true ;;
		-L|--location|-k|--insecure) exit 90 ;;
		https://*) url="$1" ;;
	esac
	shift
done
test "$head" = true && test "$url" = "https://${pin%%:*}/" || exit 91
case "$pin:$device" in
	*:443:8.8.8.8:if!wan0|*:443:9.9.9.9:if!wan0|*:443:\[2606:4700::1111\]:if!pppoe-wan) ;;
	*) exit 92 ;;
esac
printf '%s\n' "$pin" >> "$SRD_SITE_TEST/connections"
case "$url:$pin" in
	https://alternate.example/:*:8.8.8.8) printf '000|0.000000|0.000000'; exit 7 ;;
	https://tcp-timeout.example/:*) printf '000|0.000000|0.000000'; exit 28 ;;
	https://bad-cert.example/:*) printf '000|0.030000|0.000000'; exit 60 ;;
	https://tls-timeout.example/:*) printf '000|0.030000|0.000000'; exit 28 ;;
	https://no-http.example/:*) printf '000|0.030000|0.090000'; exit 28 ;;
	https://http-denied.example/:*) printf '403|0.030000|0.090000' ;;
	https://redirect.example/:*) printf '302|0.030000|0.090000' ;;
	*) printf '200|0.030000|0.090000' ;;
esac
STUB
chmod +x "$scratch/bin/"*

expect "$(site_host 'Example.COM.')" example.com
! site_host 'user@public.example'
! site_host '192.168.1.1'
! site_host 'https://example.com/path?q=x'
! site_host 'a.-bad.example'
expect "$(printf '%s\n' 0.0.0.0 127.1.1.1 100.111.5.4 169.254.169.254 172.17.1.1 198.18.2.3 203.0.113.8 8.8.4.4 | site_public_answers 4)" 8.8.4.4
expect "$(printf '%s\n' ::ffff:127.0.0.1 fc00::1 2001:db8::2 2001:0::1234 2002:c0a8:101:: 3fff::8 2606:4700::1111 | site_public_answers 6)" '2606:4700::1111'

report=$(diagnose_site blocked.example)
expect "$(field '@.families[0].dns')" restricted
expect "$(field '@.families[1].dns')" restricted
test ! -e "$scratch/connections"
report=$(diagnose_site local-path.example)
expect "$(field '@.families[1].tcp')" scope_unverified
expect "$(field '@.families[0].http_code')" 200
test "$(wc -l < "$scratch/connections")" -eq 1
report=$(diagnose_site only4.example)
expect "$(field '@.families[0].https')" response
expect "$(field '@.families[1].dns')" no_records
expect "$(field '@.families[1].tcp')" untested
for item in no-dns:nxdomain dns-timeout:timeout dns-fail:error; do
	report=$(diagnose_site "${item%:*}.example")
	expect "$(field '@.families[0].dns')" "${item#*:}"
	expect "$(field '@.families[1].tried_addresses')" 0
done
report=$(diagnose_site alternate.example)
expect "$(field '@.families[0].tried_addresses')" 2
expect "$(field '@.families[0].address')" 9.9.9.9
expect "$(field '@.families[0].tcp_ms')" 30
expect "$(field '@.families[0].tls_ms')" 60
report=$(diagnose_site tcp-timeout.example)
expect "$(field '@.families[0].tcp')" timeout
expect "$(field '@.families[0].tls')" untested
report=$(diagnose_site bad-cert.example)
expect "$(field '@.families[0].tcp')" passed
expect "$(field '@.families[0].tls')" certificate
report=$(diagnose_site tls-timeout.example)
expect "$(field '@.families[0].tls')" timeout
report=$(diagnose_site no-http.example)
expect "$(field '@.families[0].tls')" passed
expect "$(field '@.families[0].https')" no_response
report=$(diagnose_site http-denied.example)
expect "$(field '@.families[0].http_code')" 403
expect "$(field '@.families[0].https')" response
report=$(diagnose_site redirect.example)
expect "$(field '@.families[1].http_code')" 302
echo 'PASS: DNS, separate TCP/TLS/HTTP states, address fallback, pinned public route, no private probe'
