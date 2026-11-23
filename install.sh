#!/bin/sh
# Install the development build from GitHub or an extracted copy of this repository.

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

REPO=slobys/SoftRouterDoctor
BRANCH=codex%2Fpreview
INSTALL_DIR=/usr/share/soft-router-doctor
MARKER=$INSTALL_DIR/installed
LOCK=/var/lock/soft-router-doctor-install
MONITOR_INIT=/etc/init.d/soft-router-doctor-monitor

fail() {
	printf '安装器：%s\n' "$*" >&2
	exit 1
}

layout() {
	cat <<'FILES'
payload/doctor|/usr/sbin/soft-router-doctor|755
payload/topology.sh|/usr/lib/soft-router-doctor-topology.sh|644
payload/monitor.sh|/usr/lib/soft-router-doctor-monitor.sh|644
payload/quality.sh|/usr/lib/soft-router-doctor-quality.sh|644
payload/monitor.init|/etc/init.d/soft-router-doctor-monitor|755
payload/rpc|/usr/libexec/rpcd/soft-router-doctor|755
payload/acl.json|/usr/share/rpcd/acl.d/luci-app-soft-router-doctor.json|644
payload/menu.json|/usr/share/luci/menu.d/luci-app-soft-router-doctor.json|644
payload/view.js|/www/luci-static/resources/view/status/soft-router-doctor.js|644
payload/peer.ut|/usr/share/ucode/luci/template/soft-router-doctor-peer.ut|644
install.sh|/usr/share/soft-router-doctor/manage.sh|755
FILES
}

get_file() {
	if command -v curl >/dev/null 2>&1 &&
		curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 8 --max-time 25 -o "$2" "$1"; then
		return 0
	fi
	if command -v uclient-fetch >/dev/null 2>&1; then
		uclient-fetch -4 -q -T 12 -O "$2" "$1" ||
			uclient-fetch -6 -q -T 12 -O "$2" "$1"
		return
	fi
	command -v wget >/dev/null 2>&1 && wget -q -T 20 -O "$2" "$1"
}

valid_revision() {
	case "$1" in
		''|*[!0-9a-f]*) return 1 ;;
		*) [ "${#1}" -eq 40 ] ;;
	esac
}

sha() {
	raw_hash=$(sha256sum "$1") || return 1
	printf '%s\n' "${raw_hash%% *}"
}

safe_destination() {
	[ ! -L "$1" ] && { [ ! -e "$1" ] || [ -f "$1" ]; }
}

place_file() {
	next_file=$(mktemp "$2.srd.XXXXXX") || return 1
	if cp -p "$1" "$next_file" && mv -f "$next_file" "$2"; then
		return 0
	fi
	rm -f "$next_file"
	return 1
}

refresh_luci() {
	rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* || return 1
	/etc/init.d/rpcd restart
}

monitor_running() {
	ubus -S call service list '{"name":"soft-router-doctor-monitor"}' 2>/dev/null |
		jsonfilter -e '@["soft-router-doctor-monitor"].instances.*.running' 2>/dev/null |
		grep -qx true
}

remember_monitor() {
	monitor_existed=0
	monitor_enabled=0
	monitor_started=0
	if [ -x "$MONITOR_INIT" ]; then
		monitor_existed=1
		if "$MONITOR_INIT" enabled >/dev/null 2>&1; then monitor_enabled=1; fi
		if monitor_running; then monitor_started=1; fi
	fi
}

restore() {
	restored=1
	if [ -x "$MONITOR_INIT" ]; then
		if monitor_running; then "$MONITOR_INIT" stop >/dev/null 2>&1 || restored=0; fi
		"$MONITOR_INIT" disable >/dev/null 2>&1 || restored=0
	fi
	while IFS='|' read -r rel dest mode; do
		if [ -f "$stage/backup/$rel" ]; then
			place_file "$stage/backup/$rel" "$dest" || restored=0
		else
			rm -f "$dest" || restored=0
		fi
	done < "$stage/layout"
	if [ "$had_install" -eq 1 ]; then
		place_file "$stage/old-marker" "$MARKER" || restored=0
	else
		rm -f "$MARKER" || restored=0
	fi
	refresh_luci >/dev/null 2>&1 || restored=0
	if [ "$monitor_enabled" -eq 1 ]; then "$MONITOR_INIT" enable >/dev/null 2>&1 || restored=0; fi
	if [ "$monitor_started" -eq 1 ]; then "$MONITOR_INIT" start >/dev/null 2>&1 || restored=0; fi
	[ "$restored" -eq 1 ]
}

cleanup() {
	exit_status=$?
	trap - EXIT
	if [ "$changed" -eq 1 ]; then
		if restore; then
			echo '已恢复安装前的插件文件。' >&2
		else
			echo "自动恢复未完成，备份保留在 $stage/backup。" >&2
			rmdir "$LOCK"
			exit 1
		fi
	fi
	[ -z "$stage" ] || rm -rf "$stage"
	rmdir "$LOCK"
	exit "$exit_status"
}

check_preflight() {
	[ "$(id -u)" = 0 ] || fail '请在软路由的 root 终端运行。'
	[ -r /etc/openwrt_release ] && [ -r /usr/share/libubox/jshn.sh ] &&
		[ -x /etc/init.d/rpcd ] && [ -d /www/luci-static/resources/view ] &&
		[ -d /usr/share/luci/menu.d ] && [ -d /usr/share/rpcd/acl.d ] &&
		[ -d /usr/libexec/rpcd ] || fail '需要带 LuCI 和 rpcd 的 OpenWrt 或其衍生固件。'
	for tool in sha256sum ubus uci jsonfilter jshn timeout ping nslookup pidof ip awk sed grep cmp; do
		command -v "$tool" >/dev/null 2>&1 || fail "缺少 $tool。"
	done
}

backup_files() {
	while IFS='|' read -r rel dest mode; do
		safe_destination "$dest" || fail "路径类型冲突：$dest"
		if [ -f "$dest" ]; then
			[ "$had_install" -eq 1 ] || fail "发现现有文件，拒绝覆盖：$dest"
			mkdir -p "$stage/backup/$(dirname "$rel")" || fail '无法创建备份目录。'
			cp -p "$dest" "$stage/backup/$rel" || fail "无法备份：$dest"
		fi
	done < "$stage/layout"
}

prepare_payload() {
	if [ -n "$local_dir" ]; then
		cp "$local_dir/SHA256SUMS" "$stage/SHA256SUMS" || fail '本地 SHA256SUMS 不可读取。'
	else
		if ! command -v curl >/dev/null 2>&1 &&
			! command -v uclient-fetch >/dev/null 2>&1 &&
			! command -v wget >/dev/null 2>&1; then
			fail '找不到下载器。可使用 --local 离线安装。'
		fi
		if [ -z "$revision" ]; then
			get_file "https://api.github.com/repos/$REPO/commits/$BRANCH" "$stage/commit.json" ||
				fail '无法解析 GitHub 预览分支。可通过 --ref 指定已知的完整提交。'
			revision=$(jsonfilter -i "$stage/commit.json" -e '@.sha' 2>/dev/null)
		fi
		valid_revision "$revision" || fail '无法确认完整 Git 提交号。'
		download_root=https://raw.githubusercontent.com/$REPO/$revision
		get_file "$download_root/SHA256SUMS" "$stage/SHA256SUMS" || fail '无法下载 SHA256SUMS。'
	fi

	while IFS='|' read -r rel dest mode; do
		target="$stage/payload/$rel"
		mkdir -p "$(dirname "$target")" || fail '无法创建暂存目录。'
		expected=$(awk -v path="$rel" '$2 == path { print $1 }' "$stage/SHA256SUMS")
		case "$expected" in
			''|*[!0-9a-f]*) fail "摘要格式错误：$rel" ;;
		esac
		[ "${#expected}" -eq 64 ] || fail "摘要长度错误：$rel"
		if [ -n "$local_dir" ]; then
			cp "$local_dir/$rel" "$target" || fail "无法读取文件：$rel"
		else
			get_file "$download_root/$rel" "$target" || fail "下载失败：$rel"
		fi
		[ -s "$target" ] && [ "$(sha "$target")" = "$expected" ] || fail "摘要校验失败：$rel"
		chmod "$mode" "$target" || fail "无法设置权限：$rel"
	done < "$stage/layout"

	if [ -n "$local_dir" ] && [ -z "$revision" ]; then
		local_hash=$(sha "$stage/SHA256SUMS") || fail '无法计算本地清单指纹。'
		revision=local-$local_hash
	fi
	for program in payload/doctor payload/topology.sh payload/monitor.sh payload/monitor.init payload/quality.sh payload/rpc install.sh; do
		sh -n "$stage/payload/$program" || fail "Shell 语法错误：$program"
	done
}

is_current() {
	[ "$had_install" -eq 1 ] && [ "$old_revision" = "$revision" ] || return 1
	while IFS='|' read -r rel dest mode; do
		[ -f "$dest" ] && cmp -s "$dest" "$stage/payload/$rel" || return 1
	done < "$stage/layout"
	[ "$(registered_revision)" = "$revision" ]
}

registered_revision() {
	ubus -S call soft-router-doctor status 2>/dev/null | jsonfilter -e '@.revision' 2>/dev/null
}

usage() {
	printf '%s\n' '用法：sh install.sh [--ref 完整提交号] [--local 仓库目录] | --uninstall'
}

local_dir=
revision=
uninstall=0
while [ "$#" -gt 0 ]; do
	case "$1" in
		--ref)
			valid_revision "$2" || fail '--ref 需要 40 位小写十六进制提交号。'
			revision=$2
			shift ;;
		--local)
			[ -n "$2" ] && [ -d "$2" ] || fail '--local 需要仓库目录。'
			local_dir=$2
			shift ;;
		--uninstall) uninstall=1 ;;
		--help|-h) usage; exit 0 ;;
		*) usage >&2; exit 2 ;;
	esac
	shift
done

check_preflight
if [ "$uninstall" -eq 1 ] && { [ -n "$local_dir" ] || [ -n "$revision" ]; }; then
	fail '--uninstall 不能与安装参数同时使用。'
fi
mkdir -p /var/lock || fail '无法建立锁目录。'
mkdir "$LOCK" 2>/dev/null || fail '已有安装或卸载正在运行。'
stage=
changed=0
had_install=0
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
stage=$(mktemp -d /tmp/soft-router-doctor.XXXXXX) || fail '无法建立暂存目录。'
layout > "$stage/layout" || fail '无法写入文件清单。'

[ ! -L "$INSTALL_DIR" ] && safe_destination "$MARKER" || fail '安装记录路径冲突。'
if [ -f "$MARKER" ]; then
	had_install=1
	IFS= read -r old_revision < "$MARKER" || fail '安装记录不可读取。'
	cp -p "$MARKER" "$stage/old-marker" || fail '无法备份安装记录。'
fi

remember_monitor
if [ "$uninstall" -eq 1 ]; then
	if [ "$had_install" -eq 0 ]; then
		echo '软路由检测未安装。'
		exit 0
	fi
	backup_files
	changed=1
	if [ "$monitor_existed" -eq 1 ]; then
		if [ "$monitor_started" -eq 1 ]; then "$MONITOR_INIT" stop || fail '无法停止网络记录服务。'; fi
		"$MONITOR_INIT" disable || fail '无法取消网络记录服务自启。'
	fi
	while IFS='|' read -r rel dest mode; do
		rm -f "$dest" || fail "卸载失败：$dest"
	done < "$stage/layout"
	rm -f "$MARKER" || fail '无法删除安装记录。'
	refresh_luci || fail '刷新 LuCI 失败。'
	if ubus -S list soft-router-doctor 2>/dev/null | grep -qx soft-router-doctor; then
		fail 'RPC 接口仍然存在。'
	fi
	changed=0
	rmdir "$INSTALL_DIR" 2>/dev/null || true
	echo '软路由检测已卸载。'
	exit 0
fi

prepare_payload
backup_files
if is_current; then
	printf '软路由检测已安装，提交 %s。\n' "$revision"
	exit 0
fi

mkdir -p "$INSTALL_DIR" || fail '无法创建安装目录。'
printf '%s\n' "$revision" > "$stage/installed" || fail '无法暂存安装记录。'
chmod 644 "$stage/installed" || fail '无法设置安装记录权限。'
changed=1
if [ "$monitor_started" -eq 1 ]; then "$MONITOR_INIT" stop || fail '无法停止旧网络记录服务。'; fi
while IFS='|' read -r rel dest mode; do
	mkdir -p "$(dirname "$dest")" || fail "无法建立目录：$dest"
	place_file "$stage/payload/$rel" "$dest" || fail "无法安装：$dest"
done < "$stage/layout"
place_file "$stage/installed" "$MARKER" || fail '无法写入安装记录。'
refresh_luci || fail '刷新 LuCI 失败。'

ready=0
for check in 1 2 3 4 5; do
	if [ "$(registered_revision)" = "$revision" ]; then
		ready=1
		break
	fi
	sleep 1
done
[ "$ready" -eq 1 ] || fail '已写入文件，但 RPC 接口没有返回预期提交。'
if [ "$monitor_existed" -eq 0 ]; then
	"$MONITOR_INIT" enable && "$MONITOR_INIT" start || fail '无法启用网络记录服务。'
elif [ "$monitor_started" -eq 1 ]; then
	"$MONITOR_INIT" start || fail '无法恢复网络记录服务。'
fi
changed=0
printf '软路由检测安装完成。提交 %s。\n' "$revision"
echo '打开 LuCI 的「状态 → 软路由检测」。'
