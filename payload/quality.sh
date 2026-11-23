#!/bin/sh
# Compare short ICMP samples to light-traffic samples from the same route.

QUALITY_DIR=/tmp/soft-router-doctor-quality
QUALITY_SYSFS=/sys/class/net

quality_time() {
	local time rest
	IFS=' ' read -r time rest < /proc/uptime && printf '%s\n' "$time"
}

quality_select_device() {
	awk '
	$1 !~ /^(local|unreachable|blackhole|prohibit)$/ {
		for (i=1;i<NF;i++) if ($i=="dev" && $(i+1)!="lo") {print $(i+1); break}
	}'
}

quality_v6_route() {
	local target="$1" device source result
	for device in $(route_signature 6 | quality_select_device | awk '!seen[$0]++'); do
		valid_interface_name "$device" || continue
		source=$(ip -6 addr show dev "$device" scope global 2>/dev/null | awk '
			$1 == "inet6" && $2 ~ /^[23][0-9a-f]*:/ && !/(tentative|dadfailed|deprecated)/ {
				sub(/\/.*/, "", $2); print $2; exit
			}')
		case "$source" in ''|*[!0-9a-fA-F:]*) continue ;; esac
		result=$(ip -6 route get "$target" from "$source" oif "$device" 2>/dev/null | head -n 1)
		if [ -n "$(printf '%s\n' "$result" | quality_select_device)" ]; then
			printf '%s|%s\n' "$source" "$result"
			return
		fi
	done
}

quality_route() {
	local family="$1" target="$2" route source='' device binding key
	route=$(ip "-$family" route get "$target" 2>/dev/null | head -n 1)
	device=$(printf '%s\n' "$route" | quality_select_device)
	if [ -z "$device" ] && [ "$family" = 6 ]; then
		IFS='|' read -r source route <<EOF
$(quality_v6_route "$target")
EOF
		device=$(printf '%s\n' "$route" | quality_select_device)
	fi
	valid_interface_name "$device" || return 1
	binding=${source:-$device}
	key=$(printf '%s|%s\n' "$binding" "$route" | sha256sum | cut -d ' ' -f 1)
	[ -n "$key" ] || return 1
	printf '%s|%s|%s\n' "$device" "$binding" "$key"
}

quality_counters() {
	local device="$1" rx tx time
	IFS= read -r rx 2>/dev/null < "$QUALITY_SYSFS/$device/statistics/rx_bytes" || return 1
	IFS= read -r tx 2>/dev/null < "$QUALITY_SYSFS/$device/statistics/tx_bytes" || return 1
	time=$(quality_time) || return 1
	printf '%s %s %s\n' "$time" "$rx" "$tx"
}

quality_rates() {
	printf '%s\n%s\n' "$1" "$2" | LC_ALL=C awk '
	NF == 3 && $1 ~ /^[0-9]+(\.[0-9]+)?$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
		if (NR == 1) {t=$1; rx=$2; tx=$3; first=1}
		if (NR == 2 && first && $1-t >= 1 && $2 >= rx && $3 >= tx)
			printf "%.0f|%.0f\n", ($3-tx)*.008/($1-t), ($2-rx)*.008/($1-t)
	}'
}

quality_rtts() {
	LC_ALL=C awk '
	{
		seq=""; rtt=""
		for (i=1;i<=NF;i++) {
			if ($i ~ /^(icmp_)?seq=[0-9]+$/) { seq=$i; sub(/.*=/,"",seq) }
			if ($i ~ /^time[=<][0-9]+(\.[0-9]+)?$/) { rtt=$i; sub(/^time[=<]/,"",rtt) }
		}
		if (seq != "" && rtt != "" && !(seq in seen)) { seen[seq]=1; print rtt }
	}' "$1" | LC_ALL=C sort -n | LC_ALL=C awk '
	{sample[NR]=$1}
	END {
		if (NR) printf "%d|%.2f|%.2f\n", NR, (sample[int((NR+1)/2)]+sample[int(NR/2)+1])/2, sample[NR]
		else print "0||"
	}'
}

quality_reference() {
	local label="$1" key="$2" median="$3" sent="$4" replies="$5" up="$6" down="$7"
	local path="$QUALITY_DIR/ref.$label" now old_key old_time prior baseline='' age='' saved=0
	now=$(quality_time) || return 0
	if [ -r "$path" ]; then
		IFS='|' read -r old_key old_time prior < "$path"
		if [ "$old_key" = "$key" ]; then
			age=$(LC_ALL=C awk -v a="$now" -v b="$old_time" 'BEGIN {
				if (a ~ /^[0-9]+(\.[0-9]+)?$/ && b ~ /^[0-9]+(\.[0-9]+)?$/ &&
					a>=b && a-b<=14400) printf "%.0f", a-b
			}')
			[ -z "$age" ] || baseline=$prior
		fi
	fi
	if [ "$sent" -ge 3 ] && [ "$replies" -eq "$sent" ] && [ -n "$up" ] && [ -n "$down" ] &&
		[ "$up" -le 500 ] && [ "$down" -le 500 ] &&
		LC_ALL=C awk -v a="$median" -v b="$baseline" 'BEGIN {exit !(b=="" || a+0<b+0)}'; then
		if printf '%s|%s|%s\n' "$key" "$now" "$median" > "$root/ref.$label" &&
			mv -f "$root/ref.$label" "$path" && [ -z "$baseline" ]; then
			baseline=$median; age=0; saved=1
		fi
	fi
	printf '%s|%s|%s\n' "$baseline" "$age" "$saved"
}

quality_result() {
	local sent="$1" replies="$2" median="$3" baseline="$4" up="$5" down="$6"
	if [ "$replies" -eq 0 ]; then printf no_reply; return; fi
	if [ "$replies" -lt "$sent" ]; then printf loss; return; fi
	if [ -z "$baseline" ]; then printf no_reference; return; fi
	if LC_ALL=C awk -v median="$median" -v base="$baseline" 'BEGIN {exit !(median-base>=20 && median>=1.5*base)}'; then
		if [ "${up:-0}" -ge 1000 ] && [ "${down:-0}" -ge 1000 ]; then printf elevated_both
		elif [ "${up:-0}" -ge 1000 ]; then printf elevated_upload
		elif [ "${down:-0}" -ge 1000 ]; then printf elevated_download
		else printf elevated
		fi
	else
		printf similar
	fi
}

quality_sample() (
	local family="$1" target="$2" label="$3" count="$4" path device binding key start end
	local sent replies median peak up='' down='' reference='' age='' result saved=0
	path=$(quality_route "$family" "$target") || return 0
	IFS='|' read -r device binding key <<EOF
$path
EOF
	start=$(quality_counters "$device") || start=''
	timeout "$((count + 3))" ping "-$family" -I "$binding" -c "$count" -W 1 -w "$((count + 2))" \
		"$target" > "$root/ping.$label" 2>/dev/null || :
	end=$(quality_counters "$device") || end=''
	sent=$(awk '/^[0-9]+ packets transmitted/ {print $1; exit}' "$root/ping.$label")
	case "$sent" in ''|0) sent=0 ;; esac
	IFS='|' read -r replies median peak <<EOF
$(quality_rtts "$root/ping.$label")
EOF
	result=unavailable
	if [ "$(quality_route "$family" "$target")" != "$path" ]; then
		result=path_changed
	elif [ "$sent" -gt 0 ] && [ "$replies" -le "$sent" ]; then
		IFS='|' read -r up down <<EOF
$(quality_rates "$start" "$end")
EOF
		IFS='|' read -r reference age saved <<EOF
$(quality_reference "$label" "$key" "$median" "$sent" "$replies" "$up" "$down")
EOF
		if [ "$saved" = 1 ]; then result=reference_saved
		else result=$(quality_result "$sent" "$replies" "$median" "$reference" "$up" "$down"); fi
	fi
	printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$family" "$target" "$device" \
		"$sent" "$replies" "$median" "$peak" "$up" "$down" "$reference" "$age" "$result" > "$root/row.$label"
)

quality_number() {
	[ -z "$2" ] || json_add_string "$1" "$2"
}

quality_probe() (
	local mode="$1" count=7 root='' lock='' waits=0
	local family target device sent received median peak up down reference age result file
	umask 077
	[ ! -L "$QUALITY_DIR" ] && mkdir -p "$QUALITY_DIR" &&
		[ "$(stat -c %u "$QUALITY_DIR")" = 0 ] || return 1
	if [ "$mode" = baseline ]; then count=3; fi
	until mkdir "$QUALITY_DIR/lock" 2>/dev/null; do
		if [ "$mode" = baseline ]; then return 0; fi
		waits=$((waits + 1))
		if [ "$waits" -gt 4 ]; then repair_result busy '另一轮正在采样，请稍后复测。'; return; fi
		sleep 1
	done
	lock="$QUALITY_DIR/lock"
	trap '[ -z "$root" ] || rm -rf "$root"; rmdir "$lock"' EXIT
	trap 'exit 1' HUP INT TERM
	root=$(mktemp -d "$QUALITY_DIR/sample.XXXXXX") || return 1
	quality_sample 4 1.1.1.1 v4a "$count" &
	quality_sample 4 223.5.5.5 v4b "$count" &
	quality_sample 6 2606:4700:4700::1111 v6a "$count" &
	quality_sample 6 2001:4860:4860::8888 v6b "$count" &
	wait
	[ "$mode" != baseline ] || return 0
	json_init
	json_add_array paths
	for file in "$root"/row.*; do
		[ -s "$file" ] || continue
		IFS='|' read -r family target device sent received median peak up down reference age result < "$file"
		json_add_object ''
		json_add_int family "$family"
		json_add_string target "$target"
		json_add_string device "$device"
		json_add_int sent "$sent"
		json_add_int received "$received"
		quality_number median_ms "$median"
		quality_number max_ms "$peak"
		quality_number upload_kbps "$up"
		quality_number download_kbps "$down"
		quality_number reference_ms "$reference"
		quality_number reference_age "$age"
		json_add_string result "$result"
		json_close_object
	done
	json_close_array
	json_dump
)
