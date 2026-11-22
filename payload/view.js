'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

const scan = rpc.declare({ object: 'soft-router-doctor', method: 'scan', reject: true });
const scanLocal = rpc.declare({ object: 'soft-router-doctor', method: 'scanLocal', reject: true });
const repairDns = rpc.declare({
	object: 'soft-router-doctor',
	method: 'repairDns',
	params: [ 'confirm' ],
	reject: true
});

const names = {
	wan_link: 'WAN 链路',
	wan: 'WAN IPv4 地址',
	wan6: 'WAN6 IPv6 地址',
	prefix: 'IPv6 前缀',
	route_v4: 'IPv4 默认路由',
	route_v6: 'IPv6 默认路由',
	dnsmasq: 'dnsmasq 服务',
	dns: 'DNS 解析',
	internet_v4: 'IPv4 公网探测',
	internet_v6: 'IPv6 公网探测',
	storage: '磁盘空间',
	memory: '可用内存'
};

const states = {
	passed: [ '通过', 'label success' ],
	warning: [ '需核对', 'label warning' ],
	failed: [ '异常', 'label danger' ],
	skipped: [ '未验证', 'label' ]
};

function renderReport(report) {
	const counts = { passed: 0, warning: 0, failed: 0, skipped: 0 };
	const rows = report.checks.map(item => {
		const state = states[item.state] || states.skipped;
		counts[Object.hasOwn(states, item.state) ? item.state : 'skipped']++;
		return E('div', { 'class': 'tr', 'role': 'row' }, [
			E('div', { 'class': 'td', 'role': 'cell' }, names[item.id] || item.id),
			E('div', { 'class': 'td', 'role': 'cell' }, E('span', { 'class': state[1] }, state[0])),
			E('div', { 'class': 'td', 'role': 'cell' }, item.detail)
		]);
	});
	const countsLine = Object.keys(counts).map(state => counts[state] + ' 项' + states[state][0]).join(' · ');
	return [
		E('h3', {}, countsLine),
		E('p', {}, report.summary || ''),
		E('p', {}, [ report.model, report.firmware, report.timestamp ].filter(Boolean).join(' · ')),
		E('div', { 'class': 'table', 'role': 'table', 'aria-label': '检测明细' }, [
			E('div', { 'class': 'tr table-titles', 'role': 'row' }, [
				E('div', { 'class': 'th', 'role': 'columnheader' }, '检测项'),
				E('div', { 'class': 'th', 'role': 'columnheader' }, '状态'),
				E('div', { 'class': 'th', 'role': 'columnheader' }, '结果与排查建议')
			]),
			...rows
		])
	];
}

function downloadReport(report) {
	const url = URL.createObjectURL(new Blob([ JSON.stringify(report, null, 2) + '\n' ], {
		type: 'application/json'
	}));
	const link = E('a', { 'href': url, 'download': 'soft-router-doctor.json' });
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render() {
		let report = null;
		let running = false;
		const status = E('p', { 'role': 'status', 'aria-live': 'polite' });
		const details = E('div', { 'class': 'cbi-section' });
		const result = E('p', { 'role': 'status', 'aria-live': 'polite' });
		const fullScan = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': () => runScan(false)
		}, '一键检测');
		const localScan = E('button', {
			'type': 'button', 'class': 'cbi-button', 'click': () => runScan(true)
		}, '仅检查本机');
		const exportButton = E('button', {
			'type': 'button', 'class': 'cbi-button',
			'click': () => { if (report) downloadReport(report); }
		}, '下载检测报告');
		const repairButton = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': showConfirmation
		}, '启动并复测 dnsmasq');

		function updateControls() {
			fullScan.disabled = localScan.disabled = running;
			exportButton.disabled = running || !report;
			repairButton.hidden = !(report && report.can_start_dnsmasq && L.hasViewPermission());
			repairButton.disabled = running;
		}

		async function runScan(localOnly) {
			if (running) return;
			running = true;
			status.textContent = '正在检测，请稍候。';
			updateControls();
			try {
				const next = await (localOnly ? scanLocal() : scan());
				if (!next || !Array.isArray(next.checks))
					throw new Error('invalid diagnosis response');
				report = next;
				dom.content(details, renderReport(report));
				status.textContent = localOnly ? '本机检查完成。' : '检测完成。';
			}
			catch (error) {
				report = null;
				dom.content(details, []);
				status.textContent = '未能取得检测结果。请检查 LuCI 登录状态或重新加载页面。';
				console.error(error);
			}
			finally {
				running = false;
				updateControls();
			}
		}

		function showConfirmation() {
			ui.showModal('确认启动 dnsmasq', [
				E('p', {}, '只在 dnsmasq 已启用、没有运行且 DNS 端口空闲等条件满足时尝试启动。启动会启用已有的 DNS 和 DHCP 配置。'),
				E('div', { 'class': 'right' }, [
					E('button', { 'type': 'button', 'class': 'cbi-button', 'click': () => ui.hideModal() }, '取消'),
					' ',
					E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': runRepair }, '确认启动')
				])
			]);
		}

		async function runRepair() {
			ui.hideModal();
			if (running) return;
			running = true;
			result.textContent = '正在启动服务并复测 DNS。';
			updateControls();
			try {
				const response = await repairDns(true);
				result.textContent = response.detail || '没有收到修复结果，请重新检测。';
			}
			catch (error) {
				result.textContent = '未能执行修复。请检查权限和 LuCI 登录状态。';
				console.error(error);
			}
			finally {
				running = false;
				await runScan(true);
			}
		}

		updateControls();
		return E('div', {}, [
			E('h2', {}, '软路由检测'),
			E('p', {}, '检查 WAN、IPv6、DNS 和系统资源。一键检测会发送少量公网 ICMP 和 DNS 探测，所有结果从路由器本机采集。'),
			E('div', { 'class': 'cbi-page-actions' }, [ fullScan, ' ', localScan, ' ', exportButton, ' ', repairButton ]),
			status, result, details
		]);
	}
});
