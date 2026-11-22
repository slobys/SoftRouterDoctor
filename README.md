# SoftRouterDoctor · 软路由检测

适用于带 LuCI 的 OpenWrt 系软路由。路由器上本地运行，可以检查链路、IPv4/IPv6、DNS、磁盘和内存，并下载便于分享的 JSON 报告。

## 安装预览版

在软路由的 **root SSH 终端**粘贴下面整段。安装需要访问 GitHub，完成后打开 **LuCI → 状态 → 软路由检测**。

~~~sh
(
  script=$(mktemp /tmp/soft-router-doctor-bootstrap.XXXXXX) || exit 1
  trap 'rm -f "$script"' EXIT
  url=https://raw.githubusercontent.com/slobys/SoftRouterDoctor/codex/preview/install.sh
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

## 检测和修复

- **一键检测**会读取路由器本机状态，查询测试域名 `openwrt.org` / `example.com`，并向最多四个固定公网地址发送少量 ICMP。结果能区分 DNS 解析和公网 IP 探测。
- **仅检查本机**跳过公网探测，适合断网时检查接口、路由、DNS 进程和资源状态。客户端实际连通性需要从相应客户端核实。
- **启动并复测 dnsmasq**只会对满足条件的停运实例显示。启用状态、配置形式、进程和 53 端口都通过检查后，管理员可确认启动。该动作使用已有 DNS/DHCP 配置，修复结果须通过实际 DNS 查询。
- **下载检测报告**在浏览器生成文件。报告包含硬件型号、固件描述、检测时间和结果，不采集原始配置、日志、IP、MAC、口令或订阅。

SSH 下也可以运行以下命令。

~~~sh
soft-router-doctor scan
soft-router-doctor scan --local
soft-router-doctor status
~~~

## 卸载

~~~sh
sh /usr/share/soft-router-doctor/manage.sh --uninstall
~~~

## 兼容和验证

本项目处于开发预览阶段。先验证 NanoPi R4S 的 iStoreOS 25.12.6，其他固件、版本及硬件按实际验证结果记录。安装要求设备有 LuCI、rpcd 和标准 OpenWrt 用户态工具。详见 [验证记录](docs/VALIDATION.md)。
