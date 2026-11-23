#!/bin/sh
# Loaded by soft-router-doctor for the saved topology RPCs.

SAVED_TOPOLOGY=/etc/soft-router-doctor/topology
SAVED_TOPOLOGY_LOCK=/tmp/soft-router-doctor-topology-edit

saved_topology_snapshot() {
	: > "$root/nodes" || return 1
	[ ! -L "$SAVED_TOPOLOGY" ] || return 1
	if [ -e "$SAVED_TOPOLOGY" ]; then
		[ -f "$SAVED_TOPOLOGY" ] && cp "$SAVED_TOPOLOGY" "$root/nodes" || return 1
	fi
	revision=$(sha256sum "$root/nodes") || return 1
	revision=${revision%% *}
}

saved_lan_scopes() {
	local iface info device address mask
	local_interfaces | LC_ALL=C sort -u | while IFS= read -r iface; do
		valid_interface_name "$iface" || continue
		info=$(ubus -S call "network.interface.$iface" status 2>/dev/null) || continue
		[ "$(field "$info" '@.up')" = true ] || continue
		device=$(field "$info" '@.l3_device')
		valid_interface_name "$device" || continue
		address=$(field "$info" '@["ipv4-address"][0].address')
		mask=$(field "$info" '@["ipv4-address"][0].mask')
		[ -n "$address" ] && [ -n "$mask" ] && printf '%s %s %s %s\n' "$device" "$address" "$mask" "$iface"
	done
}

saved_topology_observations() {
	local leases=$LEASE_FILE
	[ -r "$leases" ] || leases=/dev/null
	ip -4 neigh show > "$root/live-neighbours" 2>/dev/null || :
	LC_ALL=C awk -v now="$(date +%s)" '
	function ipnum(s, a, i, n) {
		if (split(s, a, "\\.") != 4) return -1
		for (i=1; i<=4; i++) {
			if (a[i] !~ /^(0|[1-9][0-9]{0,2})$/ || a[i]+0 > 255) return -1
			n = 256*n + a[i]
		}
		return n
	}
	function in_lan(ip, device, i, n) {
		n = ipnum(ip)
		if (n < 0) return 0
		for (i=1; i<=scopes; i++)
			if ((!device || dev[i] == device) && n != localip[i] && n > base[i] &&
				n < base[i] + block[i] - 1) return 1
		return 0
	}
	function add(ip, mac, kind, key) {
		mac = tolower(mac)
		if (mac !~ /^([0-9a-f][0-9a-f]:){5}[0-9a-f][0-9a-f]$/ ||
			mac == "00:00:00:00:00:00" || mac == "ff:ff:ff:ff:ff:ff") return
		key = ip SUBSEP mac
		if (!(key in evidence)) owners[ip]++
		if (key in evidence && evidence[key] != kind) evidence[key] = "both"
		else evidence[key] = kind
	}
	FILENAME == ARGV[1] {
		n = ipnum($2)
		if (n >= 0 && $3 ~ /^[0-9]+$/ && $3 >= 8 && $3 <= 30) {
			scopes++
			dev[scopes] = $1
			localip[scopes] = n
			block[scopes] = 2^(32-$3)
			base[scopes] = int(n / block[scopes]) * block[scopes]
		}
		next
	}
	FILENAME == ARGV[2] {
		if ($1 ~ /^[0-9]+$/ && ($1 == 0 || $1 > now) && in_lan($3, "")) add($3, $2, "lease")
		next
	}
	$NF == "REACHABLE" {
		port = mac = ""
		for (i=1; i<NF; i++) {
			if ($i == "dev") port = $(i+1)
			if ($i == "lladdr") mac = $(i+1)
		}
		if (port && in_lan($1, port)) add($1, mac, "neighbor")
	}
	END {
		for (key in evidence) {
			split(key, pair, SUBSEP)
			print pair[1] "|" pair[2] "|" (owners[pair[1]] > 1 ? "conflict" : evidence[key])
		}
	}' "$root/lan-scopes" "$leases" "$root/live-neighbours" > "$root/observations"
}

saved_topology() (
	root=$(mktemp -d /tmp/soft-router-doctor-saved.XXXXXX) || {
		repair_result unavailable '暂时无法读取接线图。'; exit
	}
	trap 'rm -rf "$root"' EXIT
	saved_topology_snapshot || { repair_result unavailable '接线图文件不可读取。'; exit; }
	: > "$root/resolved"
	if [ -s "$root/nodes" ]; then
		saved_lan_scopes > "$root/lan-scopes"
		saved_topology_observations
		awk -F '|' '
		FILENAME == ARGV[1] {
			owner[$1] = $2
			if ($3 == "conflict") { disputed[$1] = 1; next }
			count[$2]++
			current[$2] = $1
			source[$2] = $3
			next
		}
		{
			entered = $2; mac = $3
			ip = ""; proof = ""
			if (mac == "") state = "unbound"
			else if (count[mac] > 1) state = "ambiguous"
			else if (count[mac] == 1) {
				ip = current[mac]; proof = source[mac]
				state = ip == entered ? "confirmed" : "updated"
			}
			else if (disputed[entered] || ((entered in owner) && owner[entered] != mac)) state = "conflict"
			else state = "unseen"
			print $0 "|" ip "|" proof "|" state
		}' "$root/observations" "$root/nodes" > "$root/resolved"
	fi
	json_init
	json_add_string revision "$revision"
	json_add_array nodes
	while IFS='|' read -r id entered mac mode name ip proof state; do
		json_add_object ''
		json_add_string id "$id"
		json_add_string entered "$entered"
		json_add_string mac "$mac"
		json_add_string mode "$mode"
		json_add_string name "$name"
		json_add_string address "$ip"
		json_add_string source "$proof"
		json_add_string state "$state"
		json_close_object
	done < "$root/resolved"
	json_close_array
	json_dump
)

valid_saved_address() {
	printf '%s\n' "$1" | awk -F '.' '
	NR==1 && NF==4 {
		for (i=1; i<=4; i++) if ($i !~ /^(0|[1-9][0-9]{0,2})$/ || $i+0 > 255) exit 1
		ok = ($1 == 10 || ($1 == 192 && $2 == 168) || ($1 == 172 && $2 >= 16 && $2 <= 31))
	}
	END { exit !(ok && NR==1) }'
}

mac_at_saved_address() {
	local address="$1" mac
	read_client_route "$address"
	[ -z "$peer_gateway" ] && [ -n "$peer_device" ] || return 0
	saved_lan_scopes > "$root/lan-scopes"
	awk -v dev="$peer_device" -v ip="$address" '
	function number(s, a) { split(s,a,"\\."); return ((a[1]*256+a[2])*256+a[3])*256+a[4] }
	$1 == dev && $3 >= 8 && $3 <= 30 {
		b = 2^(32-$3); n = number(ip); own = number($2)
		base = int(own/b)*b
		if (n != own && n > base && n < base+b-1) found=1
	}
	END { exit !found }' "$root/lan-scopes" || return 0
	timeout 2 ping -4 -I "$peer_device" -c 1 -W 1 "$address" >/dev/null 2>&1 || :
	saved_topology_observations
	mac=$(awk -F '|' -v ip="$address" '$1 == ip && ($3 == "neighbor" || $3 == "both") {print $2}' "$root/observations")
	if [ -z "$mac" ] && ip -4 neigh show to "$address" dev "$peer_device" 2>/dev/null |
		awk '$NF=="DELAY" || $NF=="PROBE" {pending=1} END {exit !pending}'; then
		# Let the kernel finish revalidating an old ARP entry.
		sleep 6
		saved_topology_observations
		mac=$(awk -F '|' -v ip="$address" '$1 == ip && ($3 == "neighbor" || $3 == "both") {print $2}' "$root/observations")
	fi
	printf '%s' "$mac"
}

edit_saved_topology() (
	local action="$1" wanted="$2" id="$3" entered="$4" name="$5" mode="$6"
	local row old_id old_ip mac old_mode old_name count next=''
	case "$action" in save|bind|up|down|remove) ;; *)
		repair_result rejected '无效的接线图操作。'; exit ;; esac
	if [ -n "$id" ]; then
		case "$id" in *[!0-9a-f]*) repair_result rejected '设备记录无效。'; exit ;; esac
		[ "${#id}" -eq 16 ] || { repair_result rejected '设备记录无效。'; exit; }
	elif [ "$action" != save ]; then
		repair_result rejected '缺少设备记录。'; exit
	fi
	umask 077
	mkdir "$SAVED_TOPOLOGY_LOCK" 2>/dev/null || { repair_result busy '接线图正在保存，请稍后重试。'; exit; }
	root=''
	trap '[ -z "$root" ] || rm -rf "$root"; [ -z "$next" ] || rm -f "$next"; rmdir "$SAVED_TOPOLOGY_LOCK"' EXIT
	trap 'exit 1' HUP INT TERM
	root=$(mktemp -d /tmp/soft-router-doctor-edit.XXXXXX) &&
		saved_topology_snapshot || { repair_result unavailable '无法暂存接线图。'; exit; }
	[ "$wanted" = "$revision" ] || { repair_result stale '接线图已更新，请核对当前内容后再试。'; exit; }
	row=$(awk -F '|' -v id="$id" '$1==id {print NR; exit}' "$root/nodes")
	if [ -n "$id" ] && [ -z "$row" ]; then
		repair_result stale '这条设备记录已不存在。'; exit
	fi
	count=$(awk 'END{ print NR+0 }' "$root/nodes")
	if [ -n "$row" ]; then
		IFS='|' read -r old_id old_ip mac old_mode old_name <<EOF
$(sed -n "${row}p" "$root/nodes")
EOF
	fi
	case "$action" in
		save)
			case "$mode" in unknown|ap|bridge|mesh|router) ;; *)
				repair_result rejected '请选择有效的工作模式。'; exit ;; esac
			clean_name=$(printf '%s' "$name" | LC_ALL=C tr -d '\000-\037\177|')
			[ "$name" = "$clean_name" ] && [ "${#name}" -le 96 ] ||
				{ repair_result rejected '设备名称过长或含有不支持的字符。'; exit; }
			[ -n "$name" ] || name='路由器'
			if [ -n "$row" ]; then
				entered=$old_ip
			else
				[ "$count" -lt 24 ] || { repair_result rejected '接线图最多保存 24 台设备。'; exit; }
				valid_saved_address "$entered" || { repair_result rejected '请输入私有 IPv4 管理地址。'; exit; }
				mac=$(mac_at_saved_address "$entered")
				id=$(tr -d '-' < /proc/sys/kernel/random/uuid | cut -c 1-16)
				[ "${#id}" -eq 16 ] || { repair_result unavailable '无法创建设备记录。'; exit; }
			fi ;;
		bind)
			valid_saved_address "$entered" || { repair_result rejected '请输入私有 IPv4 管理地址。'; exit; }
			mac=$(mac_at_saved_address "$entered")
			[ -n "$mac" ] || { repair_result rejected '暂未看到此 IP 的唯一在线设备，请在设备在线时再绑定。'; exit; }
			name=$old_name; mode=$old_mode ;;
	esac
	case "$action" in
		save|bind)
			if awk -F '|' -v id="$id" -v ip="$entered" -v mac="$mac" '
				$1 != id && ((mac && $3 == mac) || (!mac && $2 == ip)) {duplicate=1}
				END {exit !duplicate}' "$root/nodes"; then
				repair_result rejected '这台设备或待绑定地址已在接线图中。'; exit
			fi
			printf '%s|%s|%s|%s|%s\n' "$id" "$entered" "$mac" "$mode" "$name" > "$root/row"
			awk -v row="$row" 'FILENAME==ARGV[1] {entry=$0; next}
				{ print NR-1==row ? entry : $0 } END { if (!row) print entry }' \
				"$root/row" "$root/nodes" > "$root/result" || exit ;;
		remove)
			awk -v row="$row" 'NR!=row' "$root/nodes" > "$root/result" || exit ;;
		up|down)
			other=$((row - 1))
			[ "$action" != down ] || other=$((row + 1))
			[ "$other" -ge 1 ] && [ "$other" -le "$count" ] ||
				{ repair_result rejected '设备已经在接线图的边缘。'; exit; }
			awk -v a="$row" -v b="$other" '{line[NR]=$0}
				END {for(i=1;i<=NR;i++) print line[i==a ? b : i==b ? a : i]}' \
				"$root/nodes" > "$root/result" || exit ;;
	esac
	if mkdir -p "$(dirname "$SAVED_TOPOLOGY")" &&
		next=$(mktemp "$SAVED_TOPOLOGY.XXXXXX") && cp "$root/result" "$next" &&
		mv -f "$next" "$SAVED_TOPOLOGY"; then
		next=''
		repair_result applied '接线图已保存。'
	else
		repair_result unavailable '接线图无法写入，请核对软路由存储。'
	fi
)
