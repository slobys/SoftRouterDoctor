'use strict';
'require view';
'require rpc';
'require ui';
'require dom';

const scan = rpc.declare({ object: 'soft-router-doctor', method: 'scan', reject: true });
const scanLocal = rpc.declare({ object: 'soft-router-doctor', method: 'scanLocal', reject: true });
const repairDns = rpc.declare({
	object: 'soft-router-doctor', method: 'repairDns', params: [ 'confirm' ], reject: true
});
const accelerationPlan = rpc.declare({
	object: 'soft-router-doctor', method: 'accelerationPlan', reject: true
});
const applyAcceleration = rpc.declare({
	object: 'soft-router-doctor', method: 'applyAcceleration', params: [ 'confirm', 'token' ], reject: true
});

const groups = [
	{ id: 'uplink', title: '接入与路由', ids: ['wan_link', 'wan', 'route_v4', 'route_v6'] },
	{ id: 'dns', title: 'DNS 与站点访问', ids: ['dnsmasq', 'dns', 'https_v4', 'https_v6', 'internet_v4', 'internet_v6'] },
	{ id: 'ipv6', title: 'IPv6 前缀', ids: ['wan6', 'prefix', 'lan_prefix'] },
	{ id: 'system', title: '系统资源', ids: ['writable', 'storage', 'memory'] }
];

const names = {
	wan_link: 'WAN 网口', wan: 'WAN IPv4 地址', wan6: 'WAN6 IPv6 地址',
	prefix: '上游 IPv6 委派', lan_prefix: 'LAN IPv6 分配',
	route_v4: 'IPv4 默认路由', route_v6: 'IPv6 默认路由',
	dnsmasq: 'dnsmasq 服务', dns: '域名解析',
	https_v4: 'IPv4 HTTPS', https_v6: 'IPv6 HTTPS',
	internet_v4: 'IPv4 Ping', internet_v6: 'IPv6 Ping',
	writable: '系统可写层', storage: '可写空间', memory: '可用内存'
};

const labels = { passed: '通过', warning: '需核对', failed: '异常', skipped: '未验证' };
const phases = [
	{ title: '接口与系统', detail: '链路、网关与资源' },
	{ title: '公网与网页', detail: '解析、IPv4 和 IPv6 HTTPS' }
];

// Scoped with the view so older preview installers can also upgrade it in one transaction.
const styles = [
	'.srd-root{--ink:#152c3c;--muted:#435e6e;--line:#cbdbe2;--paper:#fff;--wash:#edf5f8;--quiet:#f5f8fa;--subtle:#d6e6ec;--accent:#075873;--accent-hover:#06465d;--accent-ink:#fff;--good:#176149;--warn:#805017;--bad:#a33d24;max-width:1150px;margin:0 auto 30px;font:inherit;color:var(--ink)}',
	'.srd-root *{box-sizing:border-box}.srd-root ::selection{background:var(--subtle);color:var(--ink)}',
	'.srd-root :is(h2,h3,h4){margin:0;padding:0;border:0;box-shadow:none;background:none}.srd-root p{margin:0}.srd-root p{line-height:1.62}.srd-root [hidden]{display:none!important}',
	'.srd-hero{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:28px;align-items:center;padding:28px 32px;background:var(--wash);border:1px solid var(--line);border-radius:16px}',
	'.srd-root .srd-title{font-size:1.85rem;font-weight:750;letter-spacing:-.03em;line-height:1.2;margin-bottom:8px;color:var(--ink)}',
	'.srd-root .srd-hero-message{max-width:52ch;color:var(--muted);font-size:1rem}',
	'.srd-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:19px 0 11px}',
	'.srd-root .srd-button,.srd-root .srd-primary{appearance:none;cursor:pointer;font:inherit;font-weight:650;min-height:44px;padding:8px 15px;border:1px solid var(--line);border-radius:9px;color:var(--ink);background:var(--paper);white-space:normal;text-align:center;transition:background-color .16s ease,color .16s ease,border-color .16s ease}',
	'.srd-root .srd-button:hover:not(:disabled){background:var(--quiet);border-color:var(--accent)}',
	'.srd-root .srd-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}',
	'.srd-root .srd-primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover)}',
	'.srd-root button:disabled{opacity:.58;cursor:default}.srd-root :is(button,summary):focus-visible{outline:2px solid var(--accent);outline-offset:3px}',
	'.srd-root .srd-meta{color:var(--muted);font-size:.82rem;overflow-wrap:anywhere}',
	'.srd-dial{display:grid;width:156px;height:156px;place-items:center;justify-self:center;position:relative;border-radius:50%;background:conic-gradient(var(--dial,var(--accent)) var(--fill,0%),var(--subtle) 0);color:var(--ink)}',
	'.srd-dial::before{content:"";position:absolute;inset:9px;border-radius:50%;background:var(--wash)}',
	'.srd-dial[data-state="good"]{--dial:var(--good)}.srd-dial[data-state="review"]{--dial:var(--warn)}',
	'.srd-dial-content{position:relative;text-align:center}.srd-dial-value{display:block;font-size:2.05rem;font-weight:750;line-height:1.05;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.srd-dial-label{display:block;margin-top:5px;font-size:.79rem;color:var(--muted);font-weight:650}',
	'.srd-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px;margin:13px 0 0;padding:0;list-style:none}',
	'.srd-step{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:9px;align-items:center;padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}',
	'.srd-step-marker{width:8px;height:8px;border-radius:50%;background:var(--subtle)}',
	'.srd-step[data-state="running"] .srd-step-marker{background:var(--accent);animation:srd-breathe 1.1s ease-in-out infinite alternate}',
	'.srd-step[data-state="done"] .srd-step-marker{background:var(--good)}.srd-step[data-state="failed"] .srd-step-marker{background:var(--bad)}',
	'.srd-step-title{display:block;font-size:.94rem;font-weight:700}.srd-step-detail,.srd-step-status{color:var(--muted);font-size:.78rem;line-height:1.3}.srd-step-status{white-space:nowrap}.srd-step-detail{display:block;margin-top:2px}',
	'@keyframes srd-breathe{from{opacity:.55}to{opacity:1}}',
	'.srd-notice{background:var(--quiet);border:1px solid var(--line);border-radius:10px;margin-top:14px!important;padding:11px 14px;color:var(--ink)}',
	'.srd-notice[data-state="error"]{color:var(--bad)}.srd-notice[data-state="success"]{color:var(--good)}',
	'.srd-results{display:grid;grid-template-columns:minmax(0,1fr) minmax(248px,.43fr);grid-template-rows:max-content 1fr;grid-template-areas:"findings overview" "technical overview";gap:19px 24px;margin-top:24px;align-items:start}.srd-findings{grid-area:findings}.srd-coverage{grid-area:overview}',
	'.srd-root .srd-section-title{font-size:1.17rem;font-weight:750;color:var(--ink);margin-bottom:10px}',
	'.srd-marks{display:grid;gap:9px}.srd-issue,.srd-empty{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:15px 17px}',
	'.srd-issue-heading{display:flex;align-items:baseline;gap:8px 11px;flex-wrap:wrap;margin-bottom:6px}.srd-issue-heading h4{color:var(--ink);line-height:1.38;font-size:1.01rem;font-weight:750}',
	'.srd-issue p,.srd-empty p{color:var(--muted);font-size:.91rem}.srd-empty strong{display:block;color:var(--ink);font-size:.97rem;margin-bottom:3px}',
	'.srd-chip{padding:3px 7px;border-radius:5px;background:var(--quiet);color:var(--muted);font-size:.73rem;font-weight:700;white-space:nowrap}',
	'.srd-chip[data-state="failed"]{color:var(--bad)}.srd-chip[data-state="warning"]{color:var(--warn)}.srd-chip[data-state="passed"]{color:var(--good)}',
	'.srd-root details{margin:0;border:0;background:none}.srd-root .srd-evidence{margin-top:8px}.srd-root summary{color:var(--accent);cursor:pointer;min-height:44px;padding:12px 2px;line-height:20px;font-weight:650}',
	'.srd-proof{margin:0;padding:0;list-style:none}.srd-proof li{padding:8px 0;border-top:1px solid var(--line)}',
	'.srd-proof strong{display:block;font-size:.83rem;font-weight:700}.srd-proof span{display:block;color:var(--muted);font-size:.82rem;line-height:1.52}',
	'.srd-fix{margin-top:4px}.srd-root .srd-fix button{margin:0}',
	'.srd-overview{border:1px solid var(--line);border-radius:12px;background:var(--paper);overflow:hidden}',
	'.srd-accel{margin-top:16px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px 18px}',
	'.srd-accel-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.srd-root .srd-accel-top .srd-section-title{margin:0}.srd-root .srd-accel-top .srd-button{flex:none;min-inline-size:64px;white-space:nowrap}',
	'.srd-accel-rows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0 0 12px;background:var(--quiet);border:1px solid var(--line);border-radius:9px}',
	'.srd-accel-stat{padding:10px 14px;min-width:0}.srd-accel-stat+.srd-accel-stat{border-inline-start:1px solid var(--line)}',
	'.srd-accel-stat dt{color:var(--muted);font-size:.8rem}.srd-accel-stat dd{margin:2px 0 0;font-weight:750;font-size:1.06rem;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
	'.srd-root .srd-accel-copy{color:var(--muted);font-size:.9rem}.srd-root .srd-accel-action{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px}',
	'.srd-root .srd-accel-result{margin-bottom:10px;padding:9px 12px;background:var(--quiet);border-radius:8px;color:var(--ink)}.srd-root .srd-accel-result[data-state="applied"]{color:var(--good)}',
	'@media(max-width:560px){.srd-accel{padding:12px}.srd-accel-stat{padding:8px}.srd-accel-stat dt{font-size:.73rem}.srd-accel-stat dd{font-size:.92rem}}',
	'.srd-root .srd-group-link{display:flex;justify-content:space-between;align-items:center;width:100%;min-height:49px;gap:8px;padding:9px 13px;text-align:left;border:0;border-radius:0;background:var(--paper);color:var(--ink);font:inherit;font-weight:650;cursor:pointer}',
	'.srd-root .srd-group-link:hover{background:var(--quiet)}.srd-root .srd-group-link:focus-visible{outline-offset:-3px}.srd-group-link+.srd-group-link{border-top:1px solid var(--line)}',
	'.srd-group-count{font-size:.77rem;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}.srd-root .srd-scope{margin-top:8px;font-size:.8rem;color:var(--muted)}',
	'.srd-technical{grid-area:technical}.srd-technical details{border-top:1px solid var(--line)}.srd-technical summary{padding-left:3px;color:var(--ink)}',
	'.srd-row{display:grid;grid-template-columns:minmax(108px,.72fr) max-content minmax(0,2.2fr);align-items:start;gap:9px 12px;padding:8px 4px;border-top:1px solid var(--line)}',
	'.srd-row strong{font-weight:650}.srd-row p{color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}',
	'.srd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
	'@media(prefers-color-scheme:dark){.srd-root{--ink:#e4f1f5;--muted:#adc4cf;--line:#38505b;--paper:#1a2830;--wash:#192f3b;--quiet:#233841;--subtle:#365362;--accent:#8bdeeb;--accent-hover:#a4e8f0;--accent-ink:#10252f;--good:#7ad3ac;--warn:#ffc580;--bad:#ffad95}}',
	'@media(max-width:820px){.srd-results{grid-template-columns:1fr;grid-template-rows:auto;grid-template-areas:"findings" "overview" "technical";gap:18px}.srd-hero{padding:24px;grid-template-columns:minmax(0,1fr) 148px;gap:16px}.srd-dial{width:135px;height:135px}}',
	'@media(max-width:560px){.srd-hero{grid-template-columns:minmax(0,1fr) auto;padding:18px 15px;gap:12px}.srd-hero-copy{display:contents}.srd-hero-intro{grid-column:1;grid-row:1}.srd-dial{width:89px;height:89px;grid-column:2;grid-row:1}.srd-dial::before{inset:6px}.srd-dial-value{font-size:1.26rem}.srd-dial-label{font-size:.66rem;margin-top:4px}.srd-root .srd-title{font-size:1.38rem;margin-bottom:5px}.srd-root .srd-hero-message{font-size:.85rem;line-height:1.48}.srd-actions,.srd-meta{grid-column:1/-1}.srd-actions{margin:0;gap:6px}.srd-root .srd-button,.srd-root .srd-primary{padding:7px 10px;font-size:.82rem}.srd-steps{gap:7px}.srd-step{grid-template-columns:8px minmax(0,1fr);gap:6px;padding:9px}.srd-step-status{grid-column:2}.srd-step-detail{display:none}.srd-results{margin-top:18px}.srd-row{grid-template-columns:minmax(0,1fr) max-content}.srd-row p{grid-column:1/-1}.srd-issue,.srd-empty{padding:13px}}',
	'@media(prefers-reduced-motion:reduce){.srd-root *{animation:none!important;transition:none!important}}'
].join('\n');

function text(tag, value, css) {
	return E(tag, css ? { 'class': css } : {}, value);
}

function chip(state, label) {
	return E('span', { 'class': 'srd-chip', 'data-state': state }, label || labels[state] || labels.skipped);
}

function button(label, handler, primary) {
	return E('button', {
		'type': 'button', 'class': primary ? 'srd-primary' : 'srd-button', 'click': handler
	}, label);
}

function countsFor(checks) {
	const counts = { passed: 0, warning: 0, failed: 0, skipped: 0 };
	for (const check of checks)
		counts[Object.hasOwn(counts, check.state) ? check.state : 'skipped']++;
	return counts;
}

function subgroups(checks) {
	return groups.map(group => ({
		...group, checks: checks.filter(check => group.ids.includes(check.id))
	})).filter(group => group.checks.length);
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

function issueCard(issue, checkById, onRecover) {
	const severity = issue.level === 'high' ? 'failed' : 'warning';
	const evidence = (issue.evidence || []).map(id => checkById[id]).filter(Boolean);
	const elements = [
		E('div', { 'class': 'srd-issue-heading' }, [
			chip(severity, severity === 'failed' ? '优先处理' : '建议核对'), text('h4', issue.title)
		]),
		text('p', issue.advice)
	];
	if (evidence.length) {
		elements.push(E('details', { 'class': 'srd-evidence' }, [
			text('summary', '查看依据（' + evidence.length + '）'),
			E('ul', { 'class': 'srd-proof' }, evidence.map(item => E('li', {}, [
				text('strong', names[item.id] || item.id), text('span', item.detail)
			])))
		]));
	}
	if (issue.action === 'start_dnsmasq' && onRecover) {
		elements.push(E('div', { 'class': 'srd-fix' }, [
			button('启动并复测 DNS', onRecover, true)
		]));
	}
	return E('article', { 'class': 'srd-issue' }, elements);
}

function renderReport(report, onRecover) {
	const checks = report.checks;
	const findings = [...(report.findings || [])].sort((a, b) => Number(b.level === 'high') - Number(a.level === 'high'));
	const checkById = Object.fromEntries(checks.map(item => [item.id, item]));
	const buckets = subgroups(checks);
	const technical = buckets.map(group => E('details', { 'id': 'srd-detail-' + group.id }, [
		text('summary', group.title + ' · ' + group.checks.length + ' 项'),
		...group.checks.map(item => E('div', { 'class': 'srd-row' }, [
			text('strong', names[item.id] || item.id), chip(item.state), text('p', item.detail)
		]))
	]));
	const groupButtons = buckets.map((group, index) => {
		const counts = countsFor(group.checks);
		const verified = group.checks.length - counts.skipped;
		const status = verified ? counts.passed + '/' + verified + ' 通过' : '未验证';
		const tail = counts.failed + counts.warning ? ' · ' + (counts.failed + counts.warning) + ' 项需核对' : '';
		return E('button', {
			'type': 'button', 'class': 'srd-group-link', 'aria-controls': 'srd-detail-' + group.id,
			'click': () => {
				const detail = technical[index];
				detail.open = true;
				detail.querySelector('summary').focus();
			}
		}, [ text('span', group.title), text('span', status + tail, 'srd-group-count') ]);
	});
	const cards = findings.length ? findings.map(issue => issueCard(issue, checkById, onRecover)) : [
		E('div', { 'class': 'srd-empty' }, [
			text('strong', '本轮没有发现需处理的明确问题'),
			text('p', report.mode === 'local' ? '本机检查已完成。选择开始体检可以补做公网探测。' :
				'如有设备仍无法上网，请到故障设备上复测。下面可以展开查看每项依据。')
		])
	];
	return [
		E('div', { 'class': 'srd-results' }, [
			E('section', { 'class': 'srd-findings', 'aria-labelledby': 'srd-findings-title' }, [
				E('h3', { 'class': 'srd-section-title', 'id': 'srd-findings-title' },
					findings.length ? '问题与建议 · ' + findings.length : '问题与建议'),
				E('div', { 'class': 'srd-marks' }, cards)
			]),
			E('section', { 'class': 'srd-coverage', 'aria-labelledby': 'srd-overview-title' }, [
				E('h3', { 'class': 'srd-section-title', 'id': 'srd-overview-title' }, '本轮检查'),
				E('div', { 'class': 'srd-overview' }, groupButtons),
				text('p', '公网结果来自路由器本机。终端和指定应用的连通性需分别核实。', 'srd-scope')
			]),
			E('section', { 'class': 'srd-technical', 'aria-labelledby': 'srd-technical-title' }, [
				E('h3', { 'class': 'srd-section-title', 'id': 'srd-technical-title' }, '检查明细'),
				...technical
			])
		])
	];
}

function formatKiB(size) {
	if (!Number.isFinite(size) || size < 0) return '未测';
	if (size < 1024) return size + ' KiB';
	if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' MiB';
	return (size / (1024 * 1024)).toFixed(2) + ' GiB';
}

function formatPercent(value) {
	return Number.isFinite(value) && value >= 0 ? value + '%' : '未测';
}

function renderAcceleration(plan, result, confirm) {
	const stats = [
		['CPU 忙碌率', formatPercent(plan.cpu_busy)],
		['可用内存', formatPercent(plan.memory_available)],
		['可写分区剩余', formatKiB(plan.storage_free_kib)]
	];
	const nodes = [];
	if (result) {
		const numbers = result.removed > 0 ? '已处理 ' + result.removed + ' 项' +
			(result.reclaimed_kib >= 0 ? '，' + (result.temporary ? '临时' : '') +
				'缓存占用减少 ' + formatKiB(result.reclaimed_kib) : '') + '。' : '';
		nodes.push(E('p', { 'class': 'srd-accel-result', 'data-state': result.state, 'role': 'status' },
			numbers || result.detail));
		if (numbers && result.state !== 'applied') nodes.push(text('p', result.detail, 'srd-accel-copy'));
	}
	nodes.push(E('dl', { 'class': 'srd-accel-rows' }, stats.map(([label, value]) =>
		E('div', { 'class': 'srd-accel-stat' }, [ text('dt', label), text('dd', value) ]))));
	if (plan.cpu_iowait >= 20) {
		nodes.push(text('p', '本次采样的 I/O 等待为 ' + formatPercent(plan.cpu_iowait) +
			'。若卡顿持续，可优先排查存储读写。', 'srd-accel-copy'));
	} else if (plan.cpu_busy >= 85) {
		nodes.push(text('p', '本次采样 CPU 较忙。若卡顿持续，可在「状态 → 进程」查看高占用服务。', 'srd-accel-copy'));
	}
	if (plan.state === 'ready') {
		const capacity = plan.cache_kib >= 0 ? '，缓存目录当前占用 ' + formatKiB(plan.cache_kib) : '';
		nodes.push(text('p', '发现 ' + plan.candidate_count + ' 项可回收的过期 APK 缓存' + capacity + '。', 'srd-accel-copy'));
		if (confirm) {
			nodes.push(E('div', { 'class': 'srd-accel-action' }, [
				button('确认回收', confirm, true),
				text('span', '以后需要这些缓存时可重新下载。', 'srd-accel-copy')
			]));
		} else {
			nodes.push(text('p', '回收需要管理员权限。', 'srd-accel-copy'));
		}
	} else {
		nodes.push(text('p', plan.detail, 'srd-accel-copy'));
	}
	return nodes;
}

function stageItems(states) {
	const status = { ready: '待检查', running: '检查中', done: '完成', skipped: '未运行', failed: '未完成' };
	return phases.map((phase, index) => E('li', { 'class': 'srd-step', 'data-state': states[index] }, [
		E('span', { 'class': 'srd-step-marker', 'aria-hidden': 'true' }),
		E('span', {}, [ text('strong', phase.title, 'srd-step-title'), text('span', phase.detail, 'srd-step-detail') ]),
		text('span', status[states[index]], 'srd-step-status')
	]));
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render() {
		let report = null;
		let busy = false;
		let accelerating = false;
		let repairInFlight = false;
		let progress = ['ready', 'ready'];
		const live = E('div', { 'class': 'srd-sr', 'role': 'status', 'aria-live': 'polite' });
		const summary = text('p', '检查网络出口、DNS、网页访问和系统资源。', 'srd-hero-message');
		const meta = text('p', '公网断开时，仍可选择只查本机。', 'srd-meta');
		const value = text('strong', '—', 'srd-dial-value');
		const gaugeLabel = text('span', '待体检', 'srd-dial-label');
		const dial = E('div', { 'class': 'srd-dial', 'aria-hidden': 'true' }, [
			E('div', { 'class': 'srd-dial-content' }, [ value, gaugeLabel ])
		]);
		const steps = E('ol', { 'class': 'srd-steps', 'aria-label': '体检步骤' }, stageItems(progress));
		const notice = E('p', { 'class': 'srd-notice', 'role': 'status', 'hidden': true });
		const results = E('div');
		const primary = button('开始体检', () => runScan(false), true);
		const local = button('只查本机', () => runScan(true));
		const exportButton = button('下载报告', () => { if (report) downloadReport(report); });
		const speedButton = button('一键加速', () => runAcceleration());
		speedButton.setAttribute('aria-controls', 'srd-accel');
		speedButton.setAttribute('aria-expanded', 'false');

		const speedContent = E('div', { 'aria-live': 'polite' });
		const speedPanel = E('section', {
			'class': 'srd-accel', 'id': 'srd-accel', 'aria-labelledby': 'srd-accel-title', 'hidden': true
		}, [
			E('div', { 'class': 'srd-accel-top' }, [
				E('h3', { 'class': 'srd-section-title', 'id': 'srd-accel-title' }, '资源检查与回收'),
				button('收起', () => {
					speedPanel.hidden = true;
					speedButton.setAttribute('aria-expanded', 'false');
					speedButton.focus();
				})
			]),
			speedContent
		]);

		async function runAcceleration(plan) {
			if (busy || accelerating) return;
			accelerating = true;
			speedPanel.hidden = false;
			speedButton.setAttribute('aria-expanded', 'true');
			dom.content(speedContent, E('p', { 'role': 'status', 'class': 'srd-accel-copy' },
				plan ? '正在回收并复查缓存占用。' : '正在采样设备资源和可回收缓存。'));
			update();
			let result;
			try {
				if (plan) result = await applyAcceleration(true, plan.token);
				const next = await accelerationPlan();
				if (!next || typeof next.state !== 'string') throw new Error('invalid acceleration plan');
				const confirm = next.state === 'ready' && next.token && L.hasViewPermission() ?
					() => runAcceleration(next) : null;
				dom.content(speedContent, renderAcceleration(next, result, confirm));
			}
			catch (error) {
				const message = result?.detail || '暂时无法取得加速结果。请检查登录状态后重试。';
				dom.content(speedContent, E('p', { 'role': 'status', 'class': 'srd-accel-copy' }, message));
				console.error(error);
			}
			finally {
				accelerating = false;
				update();
			}
		}

		function setNotice(message, state) {
			notice.textContent = message;
			notice.hidden = !message;
			notice.dataset.state = state || '';
		}

		function update() {
			primary.textContent = busy ? (repairInFlight ? '正在修复' : '体检中') : report ? '重新体检' : '开始体检';
			primary.disabled = local.disabled = speedButton.disabled = busy || accelerating;
			exportButton.disabled = busy || accelerating || !report;
			dom.content(steps, stageItems(progress));

			if (busy) {
				const total = progress[1] === 'skipped' ? 1 : 2;
				const finished = progress.filter(state => state === 'done').length;
				value.textContent = repairInFlight ? '…' : finished + '/' + total;
				gaugeLabel.textContent = repairInFlight ? '复测中' : '体检进度';
				dial.dataset.state = '';
				dial.style.setProperty('--fill', (finished / total * 100) + '%');
			} else if (report) {
				const counts = countsFor(report.checks);
				const verified = report.checks.length - counts.skipped;
				value.textContent = verified ? counts.passed + '/' + verified : '—';
				gaugeLabel.textContent = verified ? '通过 / 已测' : '没有有效结果';
				dial.dataset.state = counts.failed + counts.warning ? 'review' : verified ? 'good' : '';
				dial.style.setProperty('--fill', (verified ? counts.passed / verified * 100 : 0) + '%');
				const scannedAt = new Date(report.timestamp);
				const localTime = Number.isNaN(scannedAt.getTime()) ? '' : scannedAt.toLocaleString('zh-CN', { hour12: false });
				const info = [ report.model, localTime, counts.skipped ? counts.skipped + ' 项未验证' : '' ];
				meta.textContent = info.filter(Boolean).join(' · ');
				live.textContent = verified + ' 项已测，' + counts.passed + ' 项通过，' + counts.skipped + ' 项未验证。';
			} else {
				value.textContent = '—';
				gaugeLabel.textContent = '待体检';
				dial.dataset.state = '';
				dial.style.setProperty('--fill', '0%');
			}

			if (report) {
				const fix = !busy && !accelerating && report.can_start_dnsmasq && L.hasViewPermission() ? showConfirmation : null;
				dom.content(results, renderReport(report, fix));
			}
		}

		async function readReport(request) {
			const data = await request();
			if (!data || !Array.isArray(data.checks) || !data.checks.length)
				throw new Error('invalid diagnosis response');
			return data;
		}

		async function runScan(localOnly, keepNotice) {
			if (busy || accelerating) return;
			busy = true;
			progress = [ 'running', localOnly ? 'skipped' : 'ready' ];
			if (!keepNotice) setNotice('');
			summary.textContent = '正在读取接口、系统与服务状态。';
			live.textContent = summary.textContent;
			update();
			try {
				report = await readReport(scanLocal);
				progress[0] = 'done';
				if (!localOnly) {
					progress[1] = 'running';
					summary.textContent = '正在验证域名解析和双栈网页访问。';
					live.textContent = summary.textContent;
					update();
					report = await readReport(scan);
					progress[1] = 'done';
				}
				summary.textContent = report.summary;
			}
			catch (error) {
				const failed = progress[0] === 'running' ? 0 : 1;
				progress[failed] = 'failed';
				if (failed === 0) progress[1] = 'skipped';
				summary.textContent = failed === 1 ? '公网阶段未完成，已保留本机结果。' : '本轮未能取得诊断结果。';
				const recovery = report && failed === 0 ? '下方是上一次可用的报告。请确认 LuCI 登录状态后重试。' :
					'可重试体检，也可以先检查 LuCI 登录和路由器连接。';
				setNotice(recovery, 'error');
				console.error(error);
			}
			finally {
				busy = false;
				update();
			}
		}

		function showConfirmation() {
			if (busy || accelerating) return;
			ui.showModal('启动 dnsmasq 并复测', [
				text('p', '启动会使用路由器现有的 DNS 和 DHCP 配置。继续前，请确认这台设备负责对应服务。'),
				E('div', { 'class': 'right' }, [
					E('button', { 'type': 'button', 'class': 'cbi-button', 'click': () => ui.hideModal() }, '取消'),
					' ',
					E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': runRepair }, '确认启动')
				])
			]);
		}

		async function runRepair() {
			ui.hideModal();
			if (busy || accelerating) return;
			const localOnly = report.mode === 'local';
			busy = repairInFlight = true;
			summary.textContent = '正在启动 DNS 服务并验证实际解析。';
			live.textContent = summary.textContent;
			update();
			try {
				const repair = await repairDns(true);
				setNotice(repair.detail || '未收到修复结果，请查看复查结果。',
					repair.state === 'repaired' ? 'success' : 'error');
			}
			catch (error) {
				setNotice('修复请求未执行，请检查登录和权限后重试。', 'error');
				console.error(error);
			}
			finally {
				busy = repairInFlight = false;
				await runScan(localOnly, true);
			}
		}

		update();
		return E('div', { 'class': 'srd-root' }, [
			E('style', {}, styles),
			// LuCI themes style the shell's header element globally.
			E('section', { 'class': 'srd-hero', 'aria-labelledby': 'srd-page-title' }, [
				E('div', { 'class': 'srd-hero-copy' }, [
					E('div', { 'class': 'srd-hero-intro' }, [
						E('h2', { 'class': 'srd-title', 'id': 'srd-page-title' }, '软路由体检'), summary
					]),
					E('div', { 'class': 'srd-actions' }, [ primary, local, speedButton, exportButton ]),
					meta
				]),
				dial
			]),
			steps, live, notice, speedPanel, results
		]);
	}
});
