#!/bin/sh
# Scope active probes to one RFC1918 address directly attached to a known LAN.

LAN_ACCESS_LOCK=/tmp/soft-router-doctor-lan-access.lock

lan_access_scope() {
	local address="$1" device="$2"
	LC_ALL=C awk -v device="$device" -v address="$address" '
	function number(s, a, i) {
		if (split(s,a,"\\.")!=4) return -1
		for (i=1;i<=4;i++) if (a[i] !~ /^[0-9]+$/ || a[i]>255) return -1
		return ((a[1]*256+a[2])*256+a[3])*256+a[4]
	}
	$1==device && $3 ~ /^[0-9]+$/ && $3>=8 && $3<=30 {
		own=number($2); ip=number(address); size=2^(32-$3); base=int(own/size)*size
		if (own>=0 && ip>base && ip<base+size-1 && ip!=own && $3>best) {
			best=$3; record=$4 "|" $2 "/" $3
		}
	}
	END {if (best) print record}' "$root/scopes"
}

lan_access_zone() {
	local network="$1" section item names='' name count=0
	[ -n "$network" ] || return 0
	for section in $(printf '%s\n' "$firewall_config" | sed -n 's/^\(firewall\.[^=]*\)=zone$/\1/p'); do
		[ "$(uci -q get "$section.enabled")" != 0 ] || continue
		for item in $(uci -q get "$section.network"); do
			[ "$item" = "$network" ] || continue
			name=$(uci -q get "$section.name")
			if valid_interface_name "$name"; then names="$name"; count=$((count + 1)); fi
			break
		done
	done
	[ "$count" -ne 1 ] || printf '%s\n' "$names"
}

lan_access_forwarding() {
	local source="$1" destination="$2" section family
	[ -n "$source" ] && [ -n "$destination" ] || { printf unknown; return; }
	[ "$source" != "$destination" ] || { printf same_zone; return; }
	for section in $(printf '%s\n' "$firewall_config" | sed -n 's/^\(firewall\.[^=]*\)=forwarding$/\1/p'); do
		[ "$(uci -q get "$section.enabled")" != 0 ] || continue
		family=$(uci -q get "$section.family")
		[ "$family" != ipv6 ] || continue
		if [ "$(uci -q get "$section.src")" = "$source" ] && [ "$(uci -q get "$section.dest")" = "$destination" ]; then
			printf configured
			return
		fi
	done
	printf no_zone_forwarding
}

lan_access_socket() {
	local address="$1" port="$2" device="$3" result=0 value
	command -v ucode >/dev/null 2>&1 || { printf unavailable; return; }
	value=$(timeout 3 ucode -e '
		const socket = require("socket");
		const peer = socket.create(socket.AF_INET, socket.SOCK_STREAM, 0);
		if (!peer || !peer.setopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, ARGV[2])) {
			print("unavailable"); exit(0);
		}
		if (peer.connect(ARGV[0], +ARGV[1])) print("open");
		else {
			const code = peer.error(true);
			print(code == 111 ? "refused" : code == 110 ? "timeout" : "failed");
		}
		peer.close();
	' "$address" "$port" "$device" 2>/dev/null) || result=$?
	case "$result:$value" in
		0:open|0:refused|0:timeout|0:failed|0:unavailable) printf '%s' "$value" ;;
		124:*|143:*) printf timeout ;;
		*) printf unavailable ;;
	esac
}

lan_access_mdns() {
	local types="$1" address="$2" device="$3" type status seen=0 complete=0 started=0
	command -v avahi-browse >/dev/null 2>&1 || { printf unavailable; return; }
	for type in $types; do
		status=0
		LC_ALL=C timeout 4 avahi-browse -rptk "$type" > "$root/avahi" 2>/dev/null || status=$?
		if LC_ALL=C awk -F ';' -v ip="$address" -v dev="$device" -v service="$type" '
			$1=="=" && $2==dev && $3=="IPv4" && $5==service && $8==ip {found=1}
			END {exit !found}' "$root/avahi"; then
			printf '%s\n' "$type" >> "$root/announcements"
			seen=1
		fi
		case "$status" in
			0) complete=$((complete + 1)); started=1 ;;
			124|143) started=1 ;;
		esac
	done
	if [ "$seen" = 1 ]; then printf observed
	elif [ "$complete" -gt 0 ] && [ "$complete" -eq "$(printf '%s\n' "$types" | awk '{print NF}')" ]; then printf not_seen
	elif [ "$started" = 1 ]; then printf incomplete
	else printf unavailable
	fi
}

lan_access() (
	local origin="$1" target="$2" profile="$3" port='' types='' root='' service neighbor icmp
	local target_device target_scope target_network target_subnet target_zone
	local source_device='' source_ip='' source_network='' source_subnet='' source_zone=''
	local relation=unknown policy=unknown firewall_config mdns=untested
	case "$profile" in
		reach) ;;
		smb) port=445; types='_smb._tcp' ;;
		print) port=631; types='_ipp._tcp _ipps._tcp' ;;
		cast) types='_airplay._tcp _googlecast._tcp' ;;
		*) repair_result rejected '请选择受支持的家庭服务。'; return ;;
	esac
	valid_saved_address "$target" || { repair_result rejected '请输入家庭局域网设备的私有 IPv4 地址。'; return; }
	umask 077
	mkdir "$LAN_ACCESS_LOCK" 2>/dev/null || { repair_result busy '其他设备正在诊断，请稍后重试。'; return; }
	trap '[ -z "$root" ] || rm -rf "$root"; rmdir "$LAN_ACCESS_LOCK"' EXIT
	trap 'exit 1' HUP INT TERM
	root=$(mktemp -d /tmp/soft-router-doctor-lan-access.XXXXXX) ||
		{ repair_result unavailable '暂时无法读取局域网状态。'; return; }
	saved_lan_scopes > "$root/scopes"
	read_client_route "$target"
	target_device=$peer_device
	target_scope=$(lan_access_scope "$target" "$target_device")
	if [ -n "$peer_gateway" ] || [ -z "$target_scope" ]; then
		repair_result outside '该地址不在软路由直接接入的家庭网段，暂未发起连接测试。'
		return
	fi
	IFS='|' read -r target_network target_subnet <<EOF
$target_scope
EOF

	read_client_route "$origin"
	source_ip=$peer_address
	if [ -n "$peer_device" ] && [ -z "$peer_gateway" ]; then
		source_device=$peer_device
		case "$source_ip" in
			*:*)
				source_network=$(awk -v dev="$source_device" '
					$1==dev && !(seen[$4]++) {name=$4; count++}
					END { if (count==1) print name }' "$root/scopes") ;;
			*)
				IFS='|' read -r source_network source_subnet <<EOF
$(lan_access_scope "$source_ip" "$source_device")
EOF
				;;
		esac
	fi
	firewall_config=$(uci -q show firewall)
	target_zone=$(lan_access_zone "$target_network")
	source_zone=$(lan_access_zone "$source_network")
	if [ -n "$source_network" ]; then
		if [ "$source_device" = "$target_device" ]; then relation=same_link; else relation=cross_network; fi
	fi
	if [ "$relation" = cross_network ]; then
		policy=$(lan_access_forwarding "$source_zone" "$target_zone")
	fi

	if timeout 3 ping -4 -I "$target_device" -c 1 -W 1 "$target" >/dev/null 2>&1; then
		icmp=reply
	else
		icmp=no_reply
	fi
	neighbor=$(ip -4 neigh show to "$target" dev "$target_device" 2>/dev/null | awk '
		$NF == "REACHABLE" { print "reachable"; exit }
		$NF ~ /^(STALE|DELAY|PROBE|PERMANENT)$/ && !seen { seen=1 }
		END { if (seen) print "cached" }' | head -n 1)
	: > "$root/announcements"
	service=untested
	[ -z "$port" ] || service=$(lan_access_socket "$target" "$port" "$target_device")
	[ -z "$types" ] || mdns=$(lan_access_mdns "$types" "$target" "$target_device")

	json_init
	json_add_string relationship "$relation"
	json_add_object source
	json_add_string address "$source_ip"
	json_add_string interface "$source_network"
	json_add_string subnet "$source_subnet"
	json_add_string zone "$source_zone"
	json_close_object
	json_add_object target
	json_add_string address "$target"
	json_add_string interface "$target_network"
	json_add_string subnet "$target_subnet"
	json_add_string zone "$target_zone"
	json_add_string icmp "$icmp"
	json_add_string neighbor "${neighbor:-unseen}"
	json_close_object
	json_add_string forwarding "$policy"
	json_add_object service
	json_add_string profile "$profile"
	if [ -n "$port" ]; then json_add_int port "$port"; fi
	json_add_string tcp "$service"
	json_add_string mdns "$mdns"
	json_add_array announcements
	while IFS= read -r service; do json_add_string '' "$service"; done < "$root/announcements"
	json_close_array
	json_close_object
	json_dump
)
