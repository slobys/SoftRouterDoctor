# SoftRouterDoctor · 软路由检测

适用于带 LuCI 的 OpenWrt 系软路由。本地体检将线路、DNS、双栈网页访问和资源状态归纳成可排查的问题，并保留检查依据和脱敏报告。

## 安装预览版

在软路由的 **root SSH 终端**粘贴下面整段。安装需要访问 GitHub，完成后打开 **LuCI → 状态 → 软路由检测**。

~~~sh
(
  script=$(mktemp /tmp/soft-router-doctor-bootstrap.XXXXXX) || exit 1
  trap 'rm -f "$script"' EXIT
  url=https://raw.githubusercontent.com/slobys/SoftRouterDoctor/refs/heads/codex/preview/install.sh
  if command -v curl >/dev/null 2>&1 &&
    curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 8 --max-time 25 -o "$script" "$url"; then
    :
  elif command -v uclient-fetch >/dev/null 2>&1; then
    uclient-fetch -4 -q -T 12 -O "$script" "$url" ||
      uclient-fetch -6 -q -T 12 -O "$script" "$url" || exit 1
  else
    wget -q -T 20 -O "$script" "$url" || exit 1
  fi
  sh "$script"
)
~~~

预览入口跟随开发分支。安装器先把分支解析成完整提交，再从同一提交下载清单和对应文件。校验通过后才写入。指定已知提交时可以运行 `sh install.sh --ref <40位提交号>`。如果路由器无法访问 GitHub，可以在电脑下载并解压完整仓库，把目录传到路由器后用 `sh install.sh --local /path/to/SoftRouterDoctor` 安装。

重复运行上面的命令可以更新。安装器会备份旧插件文件，并在 LuCI RPC 注册失败时恢复。安装时会短暂重启 LuCI 的 RPC 服务，建议打开页面后刷新一次。预览版直接安装文件，固件升级后如插件消失，重新执行安装命令即可。

## 体检和修复

- **开始体检**先读取接口、IPv6 前缀分配、服务和系统资源，再分别查询 DNS、发送少量 ICMP，并通过 IPv4、IPv6 向 `example.com` 发送 HTTPS HEAD 请求。HTTPS 需要路由器已有 `curl`，缺少时会标记为未验证。
- **查看问题与建议**可以优先处理 WAN 无链路、DNS 解析失败、单一地址族网页探测异常，以及 WAN 有委派前缀但 LAN 未显示分配等问题。关联的原始结论可从问题下方展开。
- **只查本机**跳过公网访问。界面以已检查的项目计算通过数，未验证的检查会单独计数。终端的实际连通性需要从相应终端复测。
- **启动并复测 DNS**只对满足条件的停运 dnsmasq 实例显示。管理员确认后沿用现有配置启动，然后实际查询域名并复查。下载报告从浏览器本地生成，包含硬件型号、固件描述、检测时间和脱敏结论。

SSH 下也可以运行以下命令。

~~~sh
soft-router-doctor scan
soft-router-doctor scan --local
soft-router-doctor status
~~~

## 一键加速

在体检页点击 **一键加速**，查看一秒 CPU 采样、可用内存、可写分区剩余空间和可回收项。当前支持 apk 3 标准目录中过期的安装缓存。检测到可回收项时，管理员可点 **确认回收**，界面会显示实际处理数量和缓存占用变化。

APK 自定义离线缓存会保留。回收的缓存如需使用，可从软件源重新下载。缓存位于 `/tmp` 时，界面会标明减少的是临时空间占用。

SSH 下可执行 `soft-router-doctor accelerate` 查看同一份只读结果。

## 卸载

~~~sh
sh /usr/share/soft-router-doctor/manage.sh --uninstall
~~~

## 兼容和验证

本项目处于开发预览阶段。已实机验证 NanoPi R4S 的 iStoreOS 25.12.6。其他固件、版本及硬件的验证进度见下方记录。安装要求设备有 LuCI、rpcd 和标准 OpenWrt 用户态工具。详见 [验证记录](docs/VALIDATION.md) 与 [后续开发优先级](docs/ROADMAP.md)。
