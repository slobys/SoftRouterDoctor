#!/bin/sh
# The LuCI action supplies the TCP peer, never an address from the request body.

LAN_DNS_DIR=/tmp/soft-router-doctor-lan-dns
LAN_DNS_TRACE=/usr/lib/soft-router-doctor-dns-trace.awk

lan_dns_query() {
	local id="$1" host="$2" resolver="$3" code=0 state
	LC_ALL=C timeout 3 nslookup -type=A "$host." "$resolver" > "$work/$id.raw" 2>&1 || code=$?
	LC_ALL=C awk '
		/^Name:[[:space:]]/ {answer=1}
		answer && $1=="Address:" && $2 ~ /^([0-9]{1,3}\.){3}[0-9]{1,3}$/ {print $2}
	' "$work/$id.raw" | sort -u | head -n 8 > "$work/$id.ip"
	if [ -s "$work/$id.ip" ]; then state=answered
	elif grep -qi NXDOMAIN "$work/$id.raw"; then state=nxdomain
	elif [ "$code" = 124 ] || [ "$code" = 143 ] || grep -qi 'timed out' "$work/$id.raw"; then state=timeout
	elif grep -Eqi 'SERVFAIL|REFUSED|FORMERR' "$work/$id.raw"; then state=error
	elif [ "$code" = 0 ] || grep -Eqi 'no answer|no records' "$work/$id.raw"; then state=no_records
	else state=unavailable
	fi
	printf '%s\n' "$state" > "$work/$id.state"
	rm -f "$work/$id.raw"
}

lan_dns_trace() {
	LC_ALL=C timeout 8 tcpdump -p -ni any -tt -l -s 384 -c 320 \
		"host $peer_address and port 53" 2>&1 |
		LC_ALL=C awk -v host="$host" -v canary="$canary" -v ready="$work/listening" -f "$LAN_DNS_TRACE" > "$work/trace"
}

lan_dns_evidence() {
	local id="$1" ip state=unavailable
	[ ! -s "$work/$id.state" ] || read -r state < "$work/$id.state"
	json_add_object "$id"
	json_add_string state "$state"
	json_add_array addresses
	if [ -s "$work/$id.ip" ]; then
		while IFS= read -r ip; do json_add_string '' "$ip"; done < "$work/$id.ip"
	fi
	json_close_array
	json_close_object
}

lan_dns_result() {
	local kind type protocol destination status reply seen=0
	json_init
	json_add_string state done
	json_add_string name "$host"
	json_add_string lan_address "$lan_address"
	json_add_string terminal "$peer_address"
	json_add_string interface "$peer_device"
	json_add_string public_control example.com
	json_add_object router
	lan_dns_evidence loopback_name
	lan_dns_evidence lan_name
	lan_dns_evidence loopback_public
	lan_dns_evidence lan_public
	json_close_object
	json_add_object observed
	if [ -e "$work/listening" ]; then json_add_boolean listening 1
	else json_add_boolean listening 0
	fi
	json_add_array packets
	if [ -s "$work/trace" ]; then
		while IFS='|' read -r kind type protocol destination status reply; do
			json_add_object ''
			json_add_string sample "$kind"
			json_add_string type "$type"
			json_add_string protocol "$protocol"
			json_add_string server "$destination"
			json_add_string status "$status"
			json_add_string reply_via "$reply"
			json_close_object
			seen=$((seen + 1))
			[ "$seen" -lt 16 ] || break
		done < "$work/trace"
	fi
	json_close_array
	json_close_object
	json_dump
}

lan_dns_worker() (
	[ "$directory_lock" = no ] || trap 'rmdir "$LAN_DNS_DIR/active"' EXIT
	trap 'exit 1' HUP INT TERM
	lan_dns_query loopback_name "$host" 127.0.0.1 &
	lan_dns_query loopback_public example.com 127.0.0.1 &
	if [ -n "$lan_address" ]; then
		lan_dns_query lan_name "$host" "$lan_address" &
		lan_dns_query lan_public example.com "$lan_address" &
	fi
	if [ "$trace" = yes ]; then lan_dns_trace & fi
	wait
	lan_dns_result > "$work/result.new" && mv "$work/result.new" "$work/result"
)

lan_dns() (
	local action="$1" peer="$2" nonce="$3" name="$4" work host canary lan_address trace=no directory_lock=no wait_count
	case "$nonce" in ''|*[!0-9a-f]*) repair_result rejected '无效的诊断标识。'; return ;; esac
	[ "${#nonce}" = 16 ] || { repair_result rejected '无效的诊断标识。'; return; }
	work="$LAN_DNS_DIR/run-$nonce"
	case "$action" in
		worker)
			[ -r "$work/params" ] && [ "$(cat "$work/peer")" = "$peer" ] || return 1
			IFS='|' read -r host canary lan_address trace peer_address peer_device directory_lock < "$work/params"
			lan_dns_worker
			return ;;
		result)
			if [ ! -r "$work/peer" ] || [ "$(cat "$work/peer")" != "$peer" ]; then
				repair_result expired '这次诊断已过期，请重新检查。'
			elif [ -s "$work/result" ]; then cat "$work/result"
			else repair_result running '诊断进行中。'
			fi
			return ;;
		start) ;;
		*) repair_result rejected '无效的诊断操作。'; return ;;
	esac
	name=$(printf '%s' "${name%.}" | LC_ALL=C tr 'A-Z' 'a-z')
	if ! lan_smb_name_valid "$name" || ! host=$(lan_smb_local_query "$name"); then
		repair_result rejected '请输入软路由本地域内的名称，例如 nas.lan。此项检查使用本地单播 DNS。'
		return
	fi
	canary="srd-$nonce.$(uci -q get 'dhcp.@dnsmasq[0].domain' | LC_ALL=C tr 'A-Z' 'a-z')"
	lan_smb_name_valid "$canary" || { repair_result unavailable '本地域配置暂不可用。'; return; }
	umask 077
	[ ! -L "$LAN_DNS_DIR" ] && mkdir -p "$LAN_DNS_DIR" ||
		{ repair_result unavailable '无法准备诊断目录。'; return; }
	if command -v flock >/dev/null 2>&1; then
		exec 9>"$LAN_DNS_DIR/lock"
		flock -n 9 || { repair_result busy '另一项局域网 DNS 诊断仍在进行。'; return; }
	else
		mkdir "$LAN_DNS_DIR/active" 2>/dev/null ||
			{ repair_result busy '另一项局域网 DNS 诊断仍在进行。'; return; }
		directory_lock=yes
	fi
	find "$LAN_DNS_DIR" -maxdepth 1 -type d -name 'run-*' -mmin +1 -exec rm -rf -- {} \; 2>/dev/null || :
	if ! mkdir "$work" || ! printf '%s\n' "$peer" > "$work/peer"; then
		[ "$directory_lock" = no ] || rmdir "$LAN_DNS_DIR/active"
		repair_result unavailable '无法准备本次诊断。'
		return
	fi
	read_client_route "$peer"
	saved_lan_scopes > "$work/scopes"
	if [ -n "$peer_device" ] && [ -z "$peer_gateway" ]; then
		lan_address=$(awk -v device="$peer_device" '$1==device {print $2; exit}' "$work/scopes")
		if [ -n "$lan_address" ] && command -v tcpdump >/dev/null 2>&1 && [ -r "$LAN_DNS_TRACE" ]; then trace=yes; fi
	fi
	if [ -z "$lan_address" ]; then lan_address=$(awk '$4=="lan" {print $2; exit}' "$work/scopes"); fi
	if ! printf '%s|%s|%s|%s|%s|%s|%s\n' "$host" "$canary" "$lan_address" "$trace" \
		"$peer_address" "$peer_device" "$directory_lock" > "$work/params"; then
		[ "$directory_lock" = no ] || rmdir "$LAN_DNS_DIR/active"
		repair_result unavailable '无法启动本次诊断。'
		return
	fi
	# Reexec so redirected BusyBox shell descriptors cannot keep LuCI's CGI pipe open.
	(exec /bin/sh "$0" lan-dns worker "$peer" "$nonce") </dev/null >/dev/null 2>&1 &
	if [ "$trace" = yes ]; then
		for wait_count in 1 2; do
			[ ! -e "$work/listening" ] || break
			sleep 1
		done
	fi
	json_init
	json_add_string state started
	json_add_string name "$host"
	json_add_string canary "$canary"
	if [ -e "$work/listening" ]; then json_add_boolean listening 1
	else json_add_boolean listening 0
	fi
	json_dump
)
