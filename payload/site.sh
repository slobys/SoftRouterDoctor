#!/bin/sh
# Diagnose the public HTTPS endpoint of one validated website.

SITE_LOCK=/tmp/soft-router-doctor-site.lock

site_host() {
	local host="$1"
	[ "${#host}" -le 254 ] || return 1
	host=$(printf '%s' "${host%.}" | LC_ALL=C tr 'A-Z' 'a-z')
	case "$host" in
		''|*[!a-z0-9.-]*|*.local|*.localhost|*.home.arpa) return 1 ;;
	esac
	printf '%s\n' "$host" | LC_ALL=C awk -F '.' '
	NF >= 2 && length($0) <= 253 && $NF ~ /^[a-z]/ {
		for (i=1;i<=NF;i++)
			if (length($i)>63 || $i !~ /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/) exit 1
		print
		ok=1
	}
	END {exit !ok}'
}

site_public_answers() {
	LC_ALL=C awk -v family="$1" '
	function hex(s, i, n, d) {
		for (i=1;i<=length(s);i++) {
			d=index("0123456789abcdef",substr(s,i,1))-1
			if (d<0) return -1
			n=n*16+d
		}
		return n
	}
	function public4(ip, a, i) {
		if (split(ip,a,"\\.")!=4) return 0
		for (i=1;i<=4;i++) if (a[i] !~ /^(0|[1-9][0-9]{0,2})$/ || a[i]+0>255) return 0
		if (a[1]==0 || a[1]==10 || a[1]==127 || a[1]>=224 ||
			(a[1]==100 && a[2]>=64 && a[2]<=127) || (a[1]==169 && a[2]==254) ||
			(a[1]==172 && a[2]>=16 && a[2]<=31)) return 0
		if (a[1]==192 && (a[2]==168 || (a[2]==0 && (a[3]==0 || a[3]==2)) ||
			(a[2]==88 && a[3]==99))) return 0
		if ((a[1]==198 && (a[2]==18 || a[2]==19 || (a[2]==51 && a[3]==100))) ||
			(a[1]==203 && a[2]==0 && a[3]==113)) return 0
		return 1
	}
	function public6(ip, a, n, i, second) {
		ip=tolower(ip)
		if (length(ip)>39 || ip !~ /^[23][a-f0-9]{3}:[a-f0-9:]+$/ || ip ~ /:::/) return 0
		n=split(ip,a,":")
		if (n>8 || (ip !~ /::/ && n!=8)) return 0
		for(i=1;i<=n;i++) if (length(a[i])>4) return 0
		second=hex(a[2])
		if (a[1]=="2001" && (second<=511 || second==3512)) return 0
		return a[1]!="2002" && a[1]!="3fff"
	}
	(family==4 && public4($0)) || (family==6 && public6($0)) {
		ip=tolower($0)
		if (!(ip in seen)) print ip
		seen[ip]=1
	}'
}

site_dns() {
	local family="$1" host="$2" type=A status=0
	[ "$family" != 6 ] || type=AAAA
	LC_ALL=C timeout 4 nslookup "-type=$type" "$host." > "$root/dns.$family" 2>&1 || status=$?
	LC_ALL=C awk -v family="$family" '
		/^Name:[[:space:]]/ {answer=1}
		answer && $1=="Address:" {
			if (family==4 && $2 ~ /^[0-9.]+$/) print $2
			if (family==6 && $2 ~ /:/) print $2
		}' "$root/dns.$family" | LC_ALL=C sort -u > "$root/answers.$family"
	site_public_answers "$family" < "$root/answers.$family" > "$root/public.$family"
	if [ -s "$root/public.$family" ]; then printf resolved
	elif [ -s "$root/answers.$family" ]; then printf restricted
	elif grep -qi 'NXDOMAIN' "$root/dns.$family"; then printf nxdomain
	elif [ "$status" -eq 124 ] || [ "$status" -eq 143 ] || grep -Eqi 'timed out|no servers could be reached' "$root/dns.$family"; then printf timeout
	elif grep -Eqi 'server failed|SERVFAIL|REFUSED|FORMERR|NOTIMP' "$root/dns.$family"; then printf error
	elif [ "$status" -eq 0 ] || grep -Eqi 'no (answer|address|data)' "$root/dns.$family"; then printf no_records
	else printf unavailable
	fi
}

site_egress() {
	local family="$1" address="$2" route device via
	route=$(ip "-$family" route get "$address" 2>/dev/null | head -n 1)
	if [ -z "$route" ] && [ "$family" = 6 ] && command -v quality_v6_route >/dev/null 2>&1; then
		route=$(quality_v6_route "$address")
		route=${route#*|}
	fi
	[ -n "$route" ] || return 1
	case "${route%% *}" in
		local|broadcast|multicast) return 2 ;;
		unreachable|prohibit|blackhole|throw) return 1 ;;
	esac
	IFS='|' read -r device via <<EOF
$(printf '%s\n' "$route" | awk '{
	for (i=1; i<NF; i++) {
		if ($i=="dev") dev=$(i+1)
		if ($i=="via") via=1
	}
	print dev "|" via
}')
EOF
	valid_interface_name "$device" && [ "$device" != lo ] || return 2
	if [ "$via" != 1 ] &&
		! ip -o link show dev "$device" 2>/dev/null | grep -Eq '(<|,)POINTOPOINT(,|>)'; then
		return 2
	fi
	printf '%s\n' "$device"
}

site_positive_time() {
	LC_ALL=C awk -v v="$1" 'BEGIN {exit !(v ~ /^[0-9]+(\.[0-9]+)?$/ && v+0>0)}'
}

site_https_address() {
	local family="$1" host="$2" address="$3" route_status=0 device pin raw result=0
	local tcp=untested tls=untested https=untested code='' connect='' handshake='' score=0
	device=$(site_egress "$family" "$address") || route_status=$?
	case "$route_status" in
		1) tcp=no_route ;;
		2) tcp=scope_unverified ;;
		0)
			pin=$address
			if [ "$family" = 6 ]; then pin="[$address]"; fi
			raw=$(LC_ALL=C curl -q "-$family" --noproxy '*' --proto '=https' \
				--interface "if!$device" --resolve "$host:443:$pin" --head --max-redirs 0 \
				--connect-timeout 2 --max-time 4 --silent --output /dev/null \
				--write-out '%{http_code}|%{time_connect}|%{time_appconnect}' "https://$host/" 2>/dev/null) || result=$?
			IFS='|' read -r code connect handshake <<EOF
$raw
EOF
			case "$code" in [1-5][0-9][0-9]) ;; *) code='' ;; esac
			if [ -n "$code" ]; then
				tcp=passed; tls=passed; https=response; score=3
			elif site_positive_time "$handshake"; then
				tcp=passed; tls=passed; https=no_response; score=2
			elif site_positive_time "$connect"; then
				tcp=passed; score=1
				case "$result" in
					51|60) tls=certificate ;;
					77) tls=local_ca ;;
					28) tls=timeout ;;
					35|52|56) tls=failed ;;
					*) tls=unavailable ;;
				esac
			else
				case "$result" in
					7) tcp=failed ;;
					28) tcp=timeout ;;
					*) tcp=unavailable ;;
				esac
			fi ;;
	esac
	printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$score" "$address" "$device" "$tcp" "$tls" "$https" "$code" "$connect" "$handshake"
}

site_family() (
	local family="$1" host="$2" dns addresses eligible attempted=0 address score=-1 row
	local best='' rank device tcp=untested tls=untested https=untested code=''
	local connect='' handshake=''
	dns=$(site_dns "$family" "$host")
	addresses=$(awk 'END { print NR+0 }' "$root/answers.$family")
	eligible=$(awk 'END { print NR+0 }' "$root/public.$family")
	if [ "$dns" = resolved ]; then
		if command -v curl >/dev/null 2>&1; then
			head -n 2 "$root/public.$family" > "$root/targets.$family"
			while IFS= read -r address; do
				attempted=$((attempted + 1))
				row=$(site_https_address "$family" "$host" "$address")
				rank=${row%%|*}
				if [ "$rank" -gt "$score" ]; then best=$row; score=$rank; fi
				[ "$rank" -ne 3 ] || break
			done < "$root/targets.$family"
		else
			https=tool_missing
		fi
	fi
	address=''
	if [ -n "$best" ]; then IFS='|' read -r rank address device tcp tls https code connect handshake <<EOF
$best
EOF
	fi
	printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$family" "$dns" "$addresses" "$eligible" \
		"$attempted" "$address" "$tcp" "$tls" "$https" "$code" "$connect" "$handshake" > "$root/result.$family"
)

diagnose_site() (
	local host root='' file family dns answers eligible attempts address tcp tls https code connect handshake
	host=$(site_host "$1") || { repair_result rejected '请输入带域名的公网网址。'; return; }
	umask 077
	mkdir "$SITE_LOCK" 2>/dev/null || { repair_result busy '已有网站诊断正在运行，请稍后重试。'; return; }
	trap '[ -z "$root" ] || rm -rf "$root"; rmdir "$SITE_LOCK"' EXIT
	trap 'exit 1' HUP INT TERM
	root=$(mktemp -d /tmp/soft-router-doctor-site.XXXXXX) || {
		repair_result unavailable '暂时无法启动网站诊断。'; return
	}
	site_family 4 "$host" &
	site_family 6 "$host" &
	wait
	json_init
	json_add_string host "$host"
	json_add_array families
	for file in "$root/result.4" "$root/result.6"; do
		[ -s "$file" ] || continue
		IFS='|' read -r family dns answers eligible attempts address tcp tls https code connect handshake < "$file"
		json_add_object ''
		json_add_int family "$family"
		json_add_string dns "$dns"
		json_add_int records "$answers"
		json_add_int eligible "$eligible"
		json_add_int tried_addresses "$attempts"
		[ -z "$address" ] || json_add_string address "$address"
		json_add_string tcp "$tcp"
		json_add_string tls "$tls"
		json_add_string https "$https"
		[ -z "$code" ] || json_add_int http_code "$code"
		if site_positive_time "$connect"; then
			json_add_int tcp_ms "$(LC_ALL=C awk -v t="$connect" 'BEGIN{printf "%.0f",t*1000}')"
		fi
		if site_positive_time "$handshake"; then
			json_add_int tls_ms "$(LC_ALL=C awk -v t="$handshake" -v c="$connect" 'BEGIN{printf "%.0f",(t-c)*1000}')"
		fi
		json_close_object
	done
	json_close_array
	json_dump
)
