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

## 家庭网络拓扑

在体检页点 **网络拓扑**。页面把主路由表的 IPv4/IPv6 默认出口、本机路由器和 LAN 分支画在一起，并结合体检标出 WAN 链路、域名解析、IPv6 前缀分配或网页探测异常。展开 LAN 分支可查看从本机邻居表和有效 DHCP 租约识别出的设备。旁路由经 LAN 出口时，页面会显示对应的接入方式。

设备状态按近期响应、已有邻居记录、邻居解析未确认或仅有租约显示。支持时，页面还会显示桥接表学到的端口，以及已收到的 LLDP 邻居通告。

点 **自动发现路由设备** 一次即可识别设备。工具从标准 LAN 接口向私有 `/24` 到 `/30` 网段发送一次连通性探测，读取部分同网段设备的公开 HTTP 首页。路由器已有 `tcpdump` 时，同时在最多四个有链路的 LAN 端口上监听约 23 秒的 LLDP 通告，显示对端自报型号、管理地址和已启用能力。已有 `lldpd` 时也可读取其邻居表。第一轮未收到通告时，工具会自动再监听一轮。

如果需要从电脑那端核对接线，可运行 [Windows 检测脚本](tools/windows-path.ps1) 的 `./windows-path.ps1 -OutputPath ./client-path.json`，再在拓扑中选择 **导入电脑检测报告**。脚本自动读取网卡和网关，对固定目标 `1.1.1.1` 测前五跳。如果电脑已有 Wireshark 的 `tshark` 和可用的 Npcap，脚本同时采集当前网口的 LLDP 通告。两端各收到唯一的邻居通告时，拓扑会显示两端看到的设备，并标出中间待核实的接线。整个流程无需填写路由器型号或 IP。Windows 报告由当前浏览器读取，设备身份和地址保留在拓扑界面及本地报告中。

## 一键加速

在体检页点击 **一键加速**，查看进程 CPU 排行、常驻内存排行、可写空间和自启动清单。CPU 百分比按全机总量计算，内存排行按进程 RSS 排序。短时排名会随负载变化。

**可选后台服务**仅允许操作已识别软件包提供的文件共享、局域网发现、下载、媒体或统计服务。管理员可分别勾选 **停止当前服务** 和 **关闭开机自启**，查看影响后确认优化。每项都检查当前服务状态、路由、DNS 和至少一个正常的 HTTPS 路径。复测失败时尝试恢复此服务原状，并暂停后续项。联网复测以路由器本机为准，文件共享和其他可选服务的使用影响请在确认时核对。

**APK 缓存**支持 apk 3 标准目录中过期的安装缓存。检测到可回收项时点 **确认回收**，即可查看处理数量和占用变化。

APK 自定义离线缓存会保留。回收的缓存如需使用，可从软件源重新下载。缓存位于 `/tmp` 时，界面会标明减少的是临时空间占用。

SSH 下可执行 `soft-router-doctor accelerate` 查看同一份只读结果。

## 卸载

~~~sh
sh /usr/share/soft-router-doctor/manage.sh --uninstall
~~~

## 兼容和验证

本项目处于开发预览阶段。已实机验证 NanoPi R4S 的 iStoreOS 25.12.6。其他固件、版本及硬件的验证进度见下方记录。安装要求设备有 LuCI、rpcd 和标准 OpenWrt 用户态工具。详见 [验证记录](docs/VALIDATION.md) 与 [后续开发优先级](docs/ROADMAP.md)。
