# 预览版验证记录

## v0.14 NAS 文件共享分项诊断

2026-11-23，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上安装并验证提交 `ccdb5599cb8a0246e070a55adff2098bd8af963c`。真实 NAS 从软路由的 TCP 445 返回 SMB 3.1.1 协商响应。软路由本地 DNS 的 `nas.lan` 和目标网段的 `nas.local` SMB 通告均指向该 NAS。Windows 原生端口检查能连接 445，但单独向软路由地址查询 `nas.lan` 返回 NXDOMAIN。LuCI 因此保留软路由和终端的验证边界。

- 从实际 LuCI 点击检查，Windows 浏览器收到 NAS 网页响应，界面显示软路由的名称和协议证据。分别重测手填 `NAS.local` 与不存在的局域网名称，并在 390 像素视口核对布局。撤销拓扑读取权限后 RPC 被拒绝。
- 在浏览器选择文件管理器的模拟结果，验证按名称访问、网络列表发现、连接超时、登录、共享权限和共享名称各自的提示。实机探测停在 SMB 协商阶段，未尝试 NAS 登录或打开共享。
- R4S 的隔离测试覆盖名称匹配、不同或多个地址、无记录、公网名称拒绝、TCP 拒绝和 SMB 协商拒绝。接线图、拓扑和网站诊断的回归测试通过。安装前后 network、firewall、dhcp 配置摘要一致。

## v0.13 NAS 终端侧诊断

2026-11-23，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上安装提交 `2c9697c3323d7c5fec4e7086dfb42907d3d0a9fc`。从 Windows 上的 Chromium 打开 LuCI 选择真实 NAS，浏览器直接从 NAS 的 HTTP 5000 端口取得响应，软路由也返回 HTTP 200。软路由连通 SMB 445，HTTPS 443 返回证书校验失败。界面标注终端 SMB 待核对，并提供两个可在系统文件管理器里使用的地址格式。

- 实际 NAS 的 HTTP 80 跳转到另一个端口。浏览器探测的内容安全策略拦截了该跳转，浏览器未确认该项，但保留了软路由的 302 证据。检查浏览器只使用 HEAD，未携带 Cookie、Authorization 或 Referer。
- 模拟浏览器侧请求被拦截，界面保留软路由的成功证据，将本机标为未确认。移除拦截后复测恢复，桌面及 390 像素视口均通过。撤销拓扑读取权限后 RPC 被拒绝。现场验证使用 Windows 浏览器和手机尺寸模拟。
- 在 R4S 通过 `tests/lan-access.sh` 的网页端口、证书失败、无可用入口和越界目标测试。拓扑、接线图和指定网站回归测试通过。安装前后 network、firewall、dhcp 配置摘要一致。

## v0.12 家庭设备互访

2026-11-23，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上安装并验证提交 `0e8c26fb0d0c343180c7f3c627ac8a1baa606661`。实际 LuCI 会识别来源连接和目标设备处在同一 LAN。真实 NAS 出现在设备列表，选中后返回 Ping 有应答、TCP 445 可连接及 SMB mDNS 通告。安装前后 network、firewall、dhcp 配置摘要一致。

- 在桌面与 390 像素宽度完成诊断。页面拒绝公网地址，服务端拒绝软路由自身地址。撤销拓扑读取 RPC 权限后，诊断请求被拒绝。
- 在 R4S 运行 `tests/lan-access.sh`，用隔离数据验证访客网跨区转发、仅 IPv6 的转发规则、网关后的目标、端口拒绝或超时，以及其他网段的 mDNS 通告被忽略。`tests/topology.sh`、`tests/saved-topology.sh`、`tests/site.sh` 继续通过。访客网、打印与投屏场景的实机验证仍待补齐。

## v0.11 指定网站诊断

2026-11-23，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `3b86e2fb08a9d756840d1416d3cca57ec93b575e`。在 R4S 上查询并访问 `example.com`，IPv4 和 IPv6 均返回 HTTP 200。`ipv4.icanhazip.com` 的 IPv4 可用，IPv6 显示未发布 AAAA。保留后缀 `.invalid` 返回 NXDOMAIN，过期证书测试站点的 IPv4 建立了 TCP 连接，TLS 证书校验失败。

- 实机运行 `tests/site.sh`，覆盖 DNS 超时、SERVFAIL、无记录、TCP 超时、TLS 超时与证书失败、HTTPS 无响应、HTTP 403 和重定向，同时校验固定解析地址、公网出口和私有地址排除。`tests/quality.sh` 继续通过。
- 在实际 LuCI 核对完整网址仅提交域名、非标准端口与直接局域网 IP 的输入校验、诊断权限、双栈结果和 390 像素布局。用模拟结果检查 IPv4 成功而 IPv6 证书失败时的摘要。安装前后 network、firewall、dhcp 配置摘要一致。

## v0.10 卡顿诊断与轻载参考

2026-11-23，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `4c2bccaa51a6a1ba396b10d7a5ab958e394175bc`。R4S 实际通过 `pppoe-wan` 取得四个固定 IPv4/IPv6 目标的回包、往返时间和接口流量。IPv6 使用源地址路由查询，四个目标都已建立轻载参考。安装前后 network、firewall、dhcp 配置摘要一致。

- `tests/quality.sh` 验证了 IPv4 出口和依赖源地址的 IPv6 出口、重复回包排除、字节计数回退时忽略速率、参考过期与路由隔离、流量方向及丢包判定。`tests/monitor.sh` 继续通过。
- 在实际 LuCI 里验证一键采样、同源四次 HTTP HEAD 管理连接采样、390 像素布局和诊断权限。上行流量伴随延迟升高、丢包、无回应及测试中出口切换用模拟结果验证。未主动占满家庭带宽或切换实际出口。

## v0.9 网络异常回放与网口速率

2026-11-23，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `afd1cea52a07c849758bf5abd5d9a1e825178eb9`。实际观察到 procd 记录服务持续产生采样，`eth0` 和 `eth1` 均读到 1000 Mbps。安装及升级前后 network、firewall、dhcp 配置摘要一致。

- R4S 上运行 `tests/monitor.sh`，覆盖从 1000 降到 100 Mbps、协商速率恢复、两次采样之间的掉链、PPPoE 重新建立、DNS/HTTPS 样本异常、IPv4-only 环境、恢复时长和 96 条保留上限。故障由隔离数据模拟，家中网络未被断开。
- 在真实 LuCI 验证实时采样状态、模拟事件的回放与恢复时长、拓扑降速和掉链提示、桌面与 390 像素布局、事件脱敏下载及独立写权限。
- 在实机验证暂停、同版安装保留暂停状态、启用后恢复采样，以及升级保留服务自启。继续运行 `tests/topology.sh`、`tests/router-discovery.sh`、`tests/saved-topology.sh` 和 `tests/service-optimization.sh`，结果通过。

## v0.8 可编辑接线图与 IP 同步

在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `ab0f906819ea7a5fa49d7564e7f11c1920692554`。用两台实际 TP-Link 的管理地址在隔离文件中录入，确认绑定到两个不同的 MAC。正式接线图未写入测试节点，升级前后的 network、firewall、dhcp 配置摘要一致。

- 实机运行 `tests/saved-topology.sh`，用隔离租约和邻居表模拟记录清空及同一设备重新获得新 IP，验证名称、模式、接线顺序和身份记录继续保留。还验证旧 IP 被复用、同一 MAC 多地址、跨路由地址保持待绑定、重复设备及过期编辑拒绝覆盖。未实际重启家庭路由器或改动 DHCP 租约。
- 在实际 LuCI 上检查读取和写入权限、正常的一键拓扑以及 390 像素宽度。使用独立的浏览器测试记录验证添加、改名、调整模式和顺序、删除，以及无需再次点击的 IP 刷新，真实接线图保持空白。

## v0.7 浏览器内一键发现拓扑

在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `4642e0cbe14ceb95cc3d322fe6fbabb528f53828`。Windows Chromium 从局域网直接打开 LuCI，点击一次 **网络拓扑** 后，从本次 LuCI 连接识别出电脑地址，并在 R4S 邻居表和桥接表中关联到 `eth1`。测试期间未运行电脑检测脚本，也未导入报告。

- 实际从 R4S 的 LAN 口识别 TP-Link TL-XDR5430 的无线 AP 通告，以及 IEEE 1905.1 Supported Service 中的 Multi-AP 控制器通告。识别到 360 路由器管理页，页面将工作模式标为待核实。电脑一侧上一版通过本机抓包识别的另一台 TP-Link 未获得足以定位的证据，界面用虚线标明中间顺序待确认。
- 验证了未登录和缺少拓扑读取权限时均不能取得连接来源，客户端附带的转发头不会覆盖真实连接地址。实际页面在桌面和 390 像素宽度显示正常。
- 实机运行 `tests/topology.sh` 和 `tests/router-discovery.sh`，在隔离数据中覆盖 IPv4/IPv6 邻居、经 LAN 返回的下一跳、回环、无效地址、Mesh 控制器与代理节点通告，以及对转发帧和截断帧的排除。Mesh 代理节点和 IPv6 页面连接未做实机业务验证。安装前后 network、firewall、dhcp 配置摘要一致。

## v0.6 路由设备自动发现

在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `b727df4232e9df1bb6c7d2d6d1a03a31a47a3bc6`。从 R4S 的 LAN 口和 Windows 电脑网卡分别收到同型号的两台 TP-Link TL-XDR5430 的 LLDP 通告。两台设备使用不同的管理地址和 MAC，各自通告启用了 WLAN AP。在实际浏览器验证两台设备分别显示在拓扑的两端，中间接线显示为待确认。360 T7 由 DHCP 自报名和管理页识别，并显示为接线位置待核实。

- Windows 脚本实测确认 R4S 为电脑的默认网关和第一个 IPv4 跳点。桥接表显示电脑流量来自 R4S 的 `eth1`。实测 Windows 支持已安装的 Wireshark/Npcap。
- 实际 LuCI 验证一键发现、同型号设备的区分、可选报告导入、设备发现权限及 390 像素布局。安装前后 network、firewall、dhcp 配置摘要一致。
- R4S 上的 `tests/router-discovery.sh` 使用隔离数据验证探测范围、管理页识别、LLDP 解析及仅监听的重试。`tests/topology.sh` 验证路由优先级、设备地址归并和桥接端口展示。

## v0.5 家庭网络拓扑

2026-11-22，在 NanoPi R4S 的 iStoreOS 25.12.6 和 Argon 上验证提交 `574ff37324789239c883110c36485a7864ee3f0e`。实机读取了 `pppoe-wan` 双栈出口、`br-lan`、桥接端口 `eth1`，以及这一轮的 19 台设备记录。安装前后的网络、防火墙和 DHCP 配置摘要一致。

- 在实机 LuCI 打开拓扑、展开设备清单，核对桌面与手机布局。撤销单独的拓扑读取权限后，RPC 拒绝返回设备地址。
- 用模拟响应分别验证 WAN 无链路、DNS 解析失败和 LAN 无载波。异常定位到对应节点，相关下游状态保持为需核对或未验证。实机网络保持联通。
- 在 R4S 上运行 `sh tests/topology.sh`，验证了默认出口优先级、旁路由式出口、不同 LAN 分支租约、同一设备 IPv4/IPv6 记录合并，以及无路由与读取失败的区别。

## v0.4 进程排行与自启动优化

2026-11-22，在 NanoPi R4S 的 iStoreOS 25.12.6 上验证提交 `54774298af83ef78a0f85a783f684e49e170970e`。实机读取了按数值降序的进程 CPU 与 RSS 排名，以及启用的自启动项。识别到的可选服务包括 Samba、Avahi 和 Windows 网络发现。升级前后的网络配置与自启动项一致。

- 在真实 Argon 页面验证进程和可选服务展示、默认未勾选、影响确认、手机布局及只读 RPC 权限。浏览器的写操作和批量中断使用模拟响应，生产服务保持原状态。
- 在 R4S 的隔离目录运行 `sh tests/service-optimization.sh`，验证拒绝受保护服务、过期计划和联网基线异常。停止当前服务与关闭自启分别测试。模拟优化后原有 IPv6 HTTPS 路径失效，验证运行状态和自启均恢复。
- 优化前后记录路由器默认路由、DNS 和原本通过的 HTTPS 地址族。只读启动项清单供核对，其余服务仍可通过 LuCI 的原生启动项管理。

## v0.3 一键加速

2026-11-22，在 NanoPi R4S 的 iStoreOS 25.12.6 / Argon 上验证提交 `c78c042af22bac6dece161b57b5911888e1184aa`。实际 APK 缓存目录位于 `/tmp`，本轮为空。LuCI 正确显示资源读数和暂无可回收项。只读会话可以查看状态，回收 RPC 由写入权限控制。

`sh tests/acceleration.sh` 使用实机 APK 工具和独立数据库验证：预览保持文件、过期计划被拒绝、数据库锁占用时暂停、确认后两份符合条件的缓存被移除，并测得缓存占用下降。普通文件、符号链接和自定义离线缓存保留。桌面和手机的可回收界面用模拟 RPC 验证；真实 R4S 没有待回收缓存。

实机升级前后，网络、防火墙、DHCP、Argon 及 APK 已安装包数据库的摘要一致。

## v0.2 软路由体检

2026-11-22，在 NanoPi R4S 的 iStoreOS 25.12.6 实测提交 `9f8bdb29402aa5fff212cf6b9ec5f78ac63da01a`。

- 联网体检显示 16 项通过，分别收到了 IPv4 和 IPv6 HTTPS 响应，并确认了 LAN 的全局 IPv6 前缀分配。仅查本机时显示 11/11，五项公网检查单独标记为未验证。
- 在真实 LuCI 中用 Chromium 核对了桌面和 390 像素宽视口。验证了阶段状态、分类跳转、问题卡片、证据展开及 JSON 下载。故障界面使用明确标记的 IPv6 超时模拟数据，实机网络保持联通。
- 在 R4S 的 BusyBox 隔离测试中，复现 DNS 解析失败、仅 IPv6 HTTPS 超时、只有 ULA 的 LAN、IPv4-only、Ping 无应答但 HTTPS 正常，以及几个 DNS 修复拦截情形。
- 升级前后，network、firewall、dhcp 三份配置的摘要一致。实际路由器的 dnsmasq 保持运行，DNS 启动和复测仍用隔离测试验证。

### Argon 页头遮挡修复

在同一台 R4S 的 Argon 2.2.12.4-r20260813 上复现了体检卡片里的蓝色横条。主题的全局 `header::after` 会给卡片生成蓝色装饰。提交 `c083919a0c0b2167638207bba683a0c4675fcf8b` 将体检卡片作为独立区块渲染，避开原生页头规则。

用完整 LuCI 页面在 2048 像素宽桌面和 390 像素宽手机视口复测。两种尺寸下，主题页头正常显示，卡片没有横条。桌面从主按钮上沿点击触发联网体检，手机触发本机体检，均返回完整结果。升级前后的 Argon、网络、防火墙和 DHCP 配置摘要一致。

## v0.1 实机

2026-11-22，在 FriendlyElec NanoPi R4S 上验证。固件为 iStoreOS 25.12.6，构建 2026110611，目标 rockchip/armv8，内核 6.12.112。被测应用和安装器源码提交为 `b841599f2d57bc1ee09a403db4456ddf798f0197`。

| 内容 | 实测结果 |
| --- | --- |
| GitHub 一键入口 | 路由器从公开地址下载安装器，解析预览分支，下载同一提交的文件并校验摘要后安装。 |
| 重复安装及卸载 | 重复安装识别出已安装的提交。卸载移除文件和 RPC，重复卸载成功退出。随后重新安装并读取到对应的提交。 |
| LuCI | 在 Chromium 中实际打开页面并触发本机、联网两种检测，均显示 12 项结果。下载的 JSON 包含本轮结果。只读会话调用修复 RPC 被拒绝。 |
| 路由与解析 | 实测报告识别了自动派生的 WAN6 和其 IPv6 前缀。IPv4、IPv6 各收到公网回包，路由器完成测试域名解析。 |
| 生产网络配置 | 安装、修复拦截及卸载重装前后，network、firewall、dhcp 的文件摘要一致。 |
| 现场修复边界 | 实机 dnsmasq 原本正常，接口拒绝启动操作。实际故障的恢复流程用隔离测试验证。 |

现场 GitHub API 直连的 IPv6 路径不可达，IPv4 可达。安装器使用 HTTPS 客户端的地址族选择或显式 IPv4/IPv6 回退，路由器配置保持原样。

## 隔离测试

- 在 R4S 的 BusyBox 环境执行 `sh tests/diagnosis.sh`。用替身模拟 DNS 查询失败但公网 IP 有回包、自动 WAN6、DNS 端口被占用和服务禁用。模拟启动后查询成功，已运行的实例不会重复启动。
- 在隔离的 Linux 文件目录里，运行同一份安装器逻辑，验证本地新版本更新、错误摘要拒绝写入，以及模拟 rpcd 刷新失败后恢复之前的插件文件与版本记录。
- 在 R4S 检查 Shell 语法与清单摘要。JavaScript 通过 Node.js 语法检查。

## 兼容范围

已做实机验证的环境为上表的 iStoreOS R4S。项目使用 Shell、LuCI JavaScript 和系统原生工具，预览版用文件清单管理安装。软件包构建、其他 iStoreOS 机型及其他 OpenWrt 固件需要分开实测。

[兼容性草稿](compatibility.json) 记录 OpenWrt 25.12.6 的 94 个官方目标及当前 iStoreOS R4S 目标。其他 iStoreOS 发布目标未完成枚举。矩阵中的正式结果在能绑定原始固件镜像摘要后再登记，设备观察结果见上面的实测表。
