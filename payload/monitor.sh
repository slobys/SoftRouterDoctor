#!/bin/sh
# Read-only network observations for this boot. Loaded by soft-router-doctor.

MONITOR_DIR=/tmp/soft-router-doctor-monitor
MONITOR_INIT=/etc/init.d/soft-router-doctor-monitor
NET_SYSFS=/sys/class/net

monitor_uint() {
	case "$1" in ''|*[!0-9]*) return 1 ;; *) [ "${#1}" -le 10 ] ;; esac
}

monitor_uptime() {
	local uptime rest
	IFS=' ' read -r uptime rest < /proc/uptime || return 1
	printf '%s\n' "${uptime%%.*}"
}

physical_port_sample() {
	local path carrier speed drops
	valid_interface_name "$1" || return 1
	path="$NET_SYSFS/$1"
	[ -e "$path/device" ] || [ -e "$path/phydev" ] ||
		[ -n "$(cat "$path/phys_switch_id" 2>/dev/null)" ] || return 1
	IFS= read -r carrier 2>/dev/null < "$path/carrier" || return 1
	case "$carrier" in 0|1) ;; *) return 1 ;; esac
	speed=0
	if [ "$carrier" = 1 ]; then
		speed=$(cat "$path/speed" 2>/dev/null)
		monitor_uint "$speed" || speed=0
	fi
	drops=$(cat "$path/carrier_down_count" 2>/dev/null)
	monitor_uint "$drops" || drops=''
	printf '%s|%s|%s\n' "$carrier" "$speed" "$drops"
}

monitor_dir_readable() {
	[ -d "$MONITOR_DIR" ] && [ ! -L "$MONITOR_DIR" ] &&
		[ "$(stat -c %u "$MONITOR_DIR" 2>/dev/null)" = 0 ]
}

add_port_metrics() {
	local port="$1" sample carrier speed drops highest=0 prior_down prior_carrier initial
	sample=$(physical_port_sample "$port") || return 0
	IFS='|' read -r carrier speed drops <<EOF
$sample
EOF
	json_add_int speed_mbps "$speed"
	if monitor_dir_readable && [ -r "$MONITOR_DIR/port.$port" ]; then
		IFS='|' read -r highest prior_down prior_carrier initial < "$MONITOR_DIR/port.$port"
		monitor_uint "$highest" && json_add_int best_mbps "$highest"
		if monitor_uint "$drops" && monitor_uint "$initial" && [ "$drops" -ge "$initial" ]; then
			json_add_int drops_observed "$((drops - initial))"
		fi
	fi
}

monitor_event() {
	local kind="$1" transition="$2" port="$3" duration="$4" from="$5" to="$6" when="${7:-$wall}"
	{
		[ ! -f "$MONITOR_DIR/events" ] || tail -n 95 "$MONITOR_DIR/events"
		printf '%s|%s|%s|%s|%s|%s|%s\n' "$when" "$kind" "$transition" "$port" "$duration" "$from" "$to"
	} > "$MONITOR_DIR/.events" && mv -f "$MONITOR_DIR/.events" "$MONITOR_DIR/events"
}

monitor_metric() {
	local kind="$1" port="$2" outcome="$3" threshold="$4" baseline="$5"
	local from="${6:-0}" to="${7:-0}" path="$MONITOR_DIR/metric.$1.$2"
	local state=unknown seen=0 count=0 first_tick=0 first_wall=0 observed_from observed_to
	if [ -r "$path" ]; then
		IFS='|' read -r state seen count first_tick first_wall observed_from observed_to < "$path"
	fi
	case "$outcome" in
		ok)
			if [ "$state" = active ]; then
				monitor_event "$kind" restored "$port" "$((tick - first_tick))" "${observed_to:-0}" "$to"
			fi
			seen=1; state=ok; count=0 ;;
		bad)
			[ "$state" != active ] || return 0
			[ "$baseline" = 0 ] || [ "$seen" = 1 ] || return 0
			if [ "$count" -eq 0 ]; then
				first_tick=$tick; first_wall=$wall
				observed_from=$from; observed_to=$to
			fi
			count=$((count + 1))
			if [ "$count" -ge "$threshold" ]; then
				monitor_event "$kind" started "$port" 0 "$observed_from" "$observed_to" "$first_wall"
				state=active
			fi ;;
		*)
			[ "$state" != active ] || return 0
			[ "$count" -ne 0 ] || return 0
			count=0 ;;
	esac
	printf '%s|%s|%s|%s|%s|%s|%s\n' "$state" "$seen" "$count" "$first_tick" "$first_wall" \
		"${observed_from:-0}" "${observed_to:-0}" > "$path.next" && mv -f "$path.next" "$path"
}

monitor_port() {
	local port="$1" sample carrier speed drops best=0 prev_drop='' prev_carrier='' initial=''
	sample=$(physical_port_sample "$port") || return 0
	IFS='|' read -r carrier speed drops <<EOF
$sample
EOF
	if [ -r "$MONITOR_DIR/port.$port" ]; then
		IFS='|' read -r best prev_drop prev_carrier initial < "$MONITOR_DIR/port.$port"
	fi
	if monitor_uint "$drops"; then
		if ! monitor_uint "$initial" || ! monitor_uint "$prev_drop" || [ "$drops" -lt "$prev_drop" ]; then
			initial=$drops
		elif [ "$drops" -gt "$prev_drop" ] && [ "$carrier" = 1 ] && [ "$prev_carrier" = 1 ]; then
			monitor_event port_flap observed "$port" 0 0 "$((drops - prev_drop))"
		fi
	fi
	if [ "$carrier" = 0 ]; then
		monitor_metric port_link "$port" bad 1 1
		monitor_metric port_speed "$port" unknown 2 0
	else
		monitor_metric port_link "$port" ok 1 1
		if [ "$speed" -gt 0 ]; then
			if [ "$speed" -lt "$best" ]; then
				monitor_metric port_speed "$port" bad 2 0 "$best" "$speed"
			else
				monitor_metric port_speed "$port" ok 2 0 "$best" "$speed"
				best=$speed
			fi
		fi
	fi
	printf '%s|%s|%s|%s\n' "$best" "$drops" "$carrier" "$initial" > "$MONITOR_DIR/.port.$port" &&
		mv -f "$MONITOR_DIR/.port.$port" "$MONITOR_DIR/port.$port"
}

monitor_pppoe() {
	local wan="$1" port="$2" up duration start='' previous previous_up
	[ "$(field "$wan" '@.proto')" = pppoe ] || return 0
	up=$(field "$wan" '@.up')
	case "$up" in true|false) ;; *) return 0 ;; esac
	if [ "$up" = true ]; then
		monitor_metric pppoe "$port" ok 1 1
		duration=$(field "$wan" '@.uptime')
		if monitor_uint "$duration" && [ "$duration" -le "$tick" ]; then
			start=$((tick - duration))
			if [ -r "$MONITOR_DIR/pppoe.$port" ]; then
				IFS='|' read -r previous_up previous < "$MONITOR_DIR/pppoe.$port"
				if [ "$previous_up" = true ] && monitor_uint "$previous" && [ "$start" -gt "$((previous + 2))" ]; then
					monitor_event pppoe_reconnect observed "$port" 0 0 0
				fi
			fi
		fi
	else
		monitor_metric pppoe "$port" bad 1 1
	fi
	printf '%s|%s\n' "$up" "$start" > "$MONITOR_DIR/pppoe.$port"
}

monitor_default_route() {
	local route
	route=$(route_signature "$1") || { printf unknown; return; }
	if [ -n "$route" ]; then printf ok; else printf bad; fi
}

monitor_web() {
	local family="$1" route="$2" dns="$3" outcome=unknown
	if [ "$route" = ok ] && [ "$dns" = ok ] && command -v curl >/dev/null 2>&1; then
		if service_https "$family" || service_https "$family" https://www.iana.org/; then
			outcome=ok
		else
			outcome=bad
		fi
	fi
	monitor_metric "web$family" '' "$outcome" 2 0
}

monitor_sample() {
	local probe="$1" wan wan_port lan members lan_data ip4 ip6 dns=unknown
	wall=$(date +%s) && tick=$(monitor_uptime) || return 1
	monitor_uint "$wall" && monitor_uint "$tick" || return 1
	wan=$(ubus -S call network.interface.wan status 2>/dev/null)
	wan_port=$(field "$wan" '@.device')
	if valid_interface_name "$wan_port"; then monitor_pppoe "$wan" "$wan_port"; fi
	lan=$(ubus -S call network.interface.lan status 2>/dev/null)
	lan=$(field "$lan" '@.l3_device')
	lan_data=$(if_device_status "$lan")
	members=$(field "$lan_data" '@["bridge-members"][*]')
	{
		printf '%s\n' "$wan_port"
		if [ -n "$members" ]; then printf '%s\n' $members; else printf '%s\n' "$lan"; fi
	} | LC_ALL=C sort -u | head -n 16 | while IFS= read -r port; do monitor_port "$port"; done
	ip4=$(monitor_default_route 4)
	ip6=$(monitor_default_route 6)
	monitor_metric route4 '' "$ip4" 1 1
	monitor_metric route6 '' "$ip6" 1 1
	if [ "$probe" = 1 ]; then
		if [ "$ip4" = ok ] || [ "$ip6" = ok ]; then
			if resolve_name example.com || resolve_name iana.org; then dns=ok; else dns=bad; fi
		fi
		monitor_metric dns '' "$dns" 2 0
		monitor_web 4 "$ip4" "$dns"
		monitor_web 6 "$ip6" "$dns"
	fi
	printf '%s|%s\n' "$wall" "$tick" > "$MONITOR_DIR/.heartbeat" &&
		mv -f "$MONITOR_DIR/.heartbeat" "$MONITOR_DIR/heartbeat"
}

monitor_loop() {
	local iteration=0 sleep_pid=''
	umask 077
	[ ! -L "$MONITOR_DIR" ] && mkdir -p "$MONITOR_DIR" && monitor_dir_readable || return 1
	if [ -r "$MONITOR_DIR/heartbeat" ]; then
		wall=$(date +%s)
		monitor_event monitor_gap observed '' 0 0 0
		rm -f "$MONITOR_DIR"/metric.* "$MONITOR_DIR"/pppoe.*
	fi
	trap '[ -z "$sleep_pid" ] || kill "$sleep_pid" 2>/dev/null; exit 0' TERM INT HUP
	while :; do
		monitor_sample "$((iteration == 0))"
		if [ "$iteration" -eq 0 ] && command -v quality_probe >/dev/null 2>&1; then
			quality_probe baseline
		fi
		iteration=$(((iteration + 1) % 4))
		sleep 15 &
		sleep_pid=$!
		wait "$sleep_pid"
		sleep_pid=''
	done
}

monitor_is_running() {
	ubus -S call service list '{"name":"soft-router-doctor-monitor"}' 2>/dev/null |
		jsonfilter -e '@["soft-router-doctor-monitor"].instances.*.running' 2>/dev/null |
		grep -qx true
}

monitor_status() (
	local now at sampled age running=0 kind state port duration from to
	monitor_is_running && running=1
	json_init
	json_add_boolean running "$running"
	if [ -x "$MONITOR_INIT" ] && "$MONITOR_INIT" enabled >/dev/null 2>&1; then
		json_add_boolean enabled 1
	else
		json_add_boolean enabled 0
	fi
	if monitor_dir_readable && [ -r "$MONITOR_DIR/heartbeat" ]; then
		IFS='|' read -r at sampled < "$MONITOR_DIR/heartbeat"
		now=$(monitor_uptime)
		if monitor_uint "$now" && monitor_uint "$sampled" && monitor_uint "$at" && [ "$now" -ge "$sampled" ]; then
			age=$((now - sampled))
			json_add_int sampled_at "$at"
			json_add_int sample_age "$age"
		fi
	fi
	json_add_array events
	if monitor_dir_readable && [ -r "$MONITOR_DIR/events" ]; then
		while IFS='|' read -r at kind state port duration from to; do
			monitor_uint "$at" && monitor_uint "$duration" && monitor_uint "$from" && monitor_uint "$to" || continue
			json_add_object ''
			json_add_int time "$at"
			json_add_string kind "$kind"
			json_add_string transition "$state"
			json_add_string port "$port"
			json_add_int duration "$duration"
			json_add_int from "$from"
			json_add_int to "$to"
			json_close_object
		done < "$MONITOR_DIR/events"
	fi
	json_close_array
	json_dump
)

monitor_set() {
	[ -x "$MONITOR_INIT" ] || { repair_result unavailable '系统没有安装记录服务。'; return; }
	case "$1" in
		true)
			if "$MONITOR_INIT" enable >/dev/null 2>&1 && "$MONITOR_INIT" start >/dev/null 2>&1; then
				repair_result applied '网络记录已启用。'; return
			fi ;;
		false)
			if "$MONITOR_INIT" stop >/dev/null 2>&1 && "$MONITOR_INIT" disable >/dev/null 2>&1; then
				repair_result applied '网络记录已暂停。'; return
			fi ;;
		*) repair_result rejected '请选择是否启用网络记录。'; return ;;
	esac
	repair_result unavailable '无法保存记录服务状态。'
}
