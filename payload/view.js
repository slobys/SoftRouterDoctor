'use strict';
'require view';
'require rpc';
'require request';
'require ui';
'require dom';

const networkMap = rpc.declare({ object: 'soft-router-doctor', method: 'networkMap', params: ['peer'], reject: true });
async function discoverRouters(listenOnly = false) {
	const response = await request.post(rpc.getBaseURL(), {
		jsonrpc: '2.0', id: 1, method: 'call',
		params: [rpc.getSessionID(), 'soft-router-doctor', 'discoverRouters', { listenOnly }]
	}, { timeout: 28000, credentials: true, nobatch: true });
	const message = response.json();
	if (!response.ok || message.jsonrpc !== '2.0' || message.result?.[0] !== 0)
		throw new Error('router discovery RPC failed');
	return message.result[1];
}
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
const optimizeService = rpc.declare({
	object: 'soft-router-doctor', method: 'optimizeService',
	params: [ 'confirm', 'service', 'token', 'stop', 'disable' ], reject: true
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
	'.srd-ranks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin:14px 0 18px}.srd-root .srd-rank-title{font-size:.98rem;font-weight:750;margin-bottom:4px}',
	'.srd-rank-list,.srd-service-results,.srd-service-list{padding:0;margin:0;list-style:none}.srd-rank-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:8px;padding:5px 0;border-top:1px solid var(--line);line-height:1.5}.srd-rank-list li span:first-child{overflow-wrap:anywhere}.srd-rank-list small{color:var(--muted);margin-inline-start:6px}.srd-rank-value{color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums}',
	'.srd-service-list li{padding:10px 0;border-top:1px solid var(--line)}.srd-service-heading{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px}.srd-service-actions{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:3px}.srd-service-toggle{display:inline-flex;align-items:center;gap:6px;min-height:44px;cursor:pointer}.srd-service-toggle input{margin:0;accent-color:var(--accent)}.srd-service-toggle input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}',
	'.srd-root .srd-service-controls{margin:10px 0 14px}.srd-startups{color:var(--muted);font-size:.8rem;overflow-wrap:anywhere}.srd-service-results li{margin-bottom:5px}',
	'.srd-map-path{display:grid;grid-template-columns:minmax(0,.93fr) 24px minmax(0,.83fr) 24px minmax(0,1.27fr);align-items:start;margin:9px 0 12px}.srd-map-node{min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--quiet);padding:12px;overflow-wrap:anywhere}.srd-map-node[data-state="warning"]{border-color:var(--warn)}.srd-map-node[data-state="failed"]{border-color:var(--bad)}',
	'.srd-map-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 7px;margin:0 0 4px}.srd-root .srd-map-heading .srd-rank-title{margin:0}.srd-map-link{height:1px;margin-top:24px;background:var(--accent);opacity:.65}.srd-map-segments{display:grid;gap:9px}.srd-map-meta{display:block;color:var(--muted);font-size:.8rem}.srd-map-node .srd-map-meta{margin-top:3px}',
	'.srd-map-outlets{display:grid;gap:4px;margin:6px 0}.srd-map-outlets>div{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;font-size:.82rem}.srd-map-outlets dt{font-weight:700}.srd-map-outlets dd{margin:0;color:var(--muted)}',
	'.srd-path-evidence{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.srd-path-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:6px 0}.srd-root .srd-path-fact{font-size:.92rem;margin-top:8px}.srd-path-devices{list-style:none;padding:0;margin:4px 0 0}.srd-path-devices li{padding:8px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.srd-root .srd-path-actions p{margin:0}.srd-mode-label{display:inline-block;margin-inline-start:10px;font-size:.8rem;color:var(--accent);font-weight:600}',
	'.srd-root .srd-pc-path{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:10px 0;padding:0}.srd-pc-path li{display:grid;align-content:start;gap:3px;flex:1 1 136px;min-width:0;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--quiet);overflow-wrap:anywhere}.srd-pc-path li[data-state=unknown]{border-style:dashed;background:transparent}.srd-pc-path strong{font-size:.84rem;color:var(--ink)}.srd-pc-path li span{font-size:.77rem;color:var(--muted)}',
	'.srd-map-clients{margin:0;padding:0;list-style:none}.srd-map-clients li{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding:6px 0;border-top:1px solid var(--line)}.srd-map-clients li>div{min-width:0}.srd-map-clients strong{font-size:.87rem}',
	'@media(max-width:960px){.srd-map-path{grid-template-columns:minmax(0,1fr)}.srd-map-link{height:14px;width:1px;margin:0 23px}.srd-map-node,.srd-map-segments{width:100%}}',
	'@media(max-width:560px){.srd-accel{padding:12px}.srd-accel-stat{padding:8px}.srd-accel-stat dt{font-size:.73rem}.srd-accel-stat dd{font-size:.92rem}.srd-ranks{grid-template-columns:1fr}.srd-service-toggle{font-size:.85rem}}',
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

function renderRanking(title, entries, metric, namesByPid) {
	return E('section', {}, [
		text('h4', title, 'srd-rank-title'),
		entries.length ? E('ul', { 'class': 'srd-rank-list' }, entries.map(item => E('li', {}, [
			E('span', {}, [ item.name + ' ', text('small', 'PID ' + item.pid +
				(namesByPid.has(item.pid) ? ' · ' + namesByPid.get(item.pid) : '')) ]),
			text('span', metric === 'cpu' ? formatPercent(Number(item.cpu_percent)) : formatKiB(item.rss_kib), 'srd-rank-value')
		]))) : text('p', '本轮未取得可排名的样本。', 'srd-accel-copy')
	]);
}

function renderServiceOptions(plan, onOptimize) {
	const services = plan.services || [];
	const known = new Set(services.map(service => service.id));
	const protectedNames = [...new Set(plan.startups || [])].filter(name => !known.has(name)).sort();
	const selections = [];
	const action = button('优化选中项', () => onOptimize(selections.map(({ service, stop, disable }) => ({
		...service, stop: !!stop?.checked, disable: !!disable?.checked
	})).filter(service => service.stop || service.disable)), true);
	action.disabled = true;

	function checkbox(label, service) {
		const input = E('input', {
			'type': 'checkbox', 'aria-label': service.label + '：' + label,
			'change': () => { action.disabled = !selections.some(item => item.stop?.checked || item.disable?.checked); }
		});
		return { input, label: E('label', { 'class': 'srd-service-toggle' }, [ input, label ]) };
	}

	const rows = services.map(service => {
		const stop = onOptimize && service.running ? checkbox('停止当前服务', service) : null;
		const disable = onOptimize && service.enabled ? checkbox('关闭开机自启', service) : null;
		selections.push({ service, stop: stop?.input, disable: disable?.input });
		return E('li', {}, [
			E('div', { 'class': 'srd-service-heading' }, [
				text('strong', service.label),
				chip('skipped', [service.running ? '正在运行' : '未运行', service.enabled ? '已自启' : '自启关闭'].join(' · '))
			]),
			text('p', service.impact, 'srd-accel-copy'),
			stop || disable ? E('div', { 'class': 'srd-service-actions' }, [stop?.label, disable?.label].filter(Boolean)) : ''
		]);
	});
	return E('section', { 'class': 'srd-service-controls' }, [
		text('h4', '可选后台服务', 'srd-rank-title'),
		rows.length ? E('ul', { 'class': 'srd-service-list' }, rows) :
			text('p', '未发现已运行或已自启的可选服务。', 'srd-accel-copy'),
		rows.length && onOptimize ? E('div', { 'class': 'srd-accel-action' }, [ action,
			text('span', '逐项应用并从路由器复测 DNS 和网页访问。', 'srd-accel-copy') ]) : '',
		protectedNames.length ? E('details', { 'class': 'srd-evidence' }, [
			text('summary', '其余自启动项（' + protectedNames.length + '，仅查看）'),
			text('p', protectedNames.join('、'), 'srd-startups')
		]) : ''
	]);
}

function renderAcceleration(plan, result, confirm, onOptimize, serviceResults) {
	const stats = [
		['CPU 忙碌率', formatPercent(plan.cpu_busy)],
		['可用内存', formatPercent(plan.memory_available)],
		['可写分区剩余', formatKiB(plan.storage_free_kib)]
	];
	const nodes = [];
	if (serviceResults.length) {
		nodes.push(E('ul', { 'class': 'srd-service-results', 'role': 'status' }, serviceResults.map(entry =>
			E('li', { 'class': 'srd-accel-result', 'data-state': entry.state }, entry.label + '：' + entry.detail))));
	}
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
	const namesByPid = new Map((plan.services || []).flatMap(service =>
		(service.pids || []).map(pid => [pid, service.label])));
	nodes.push(E('div', { 'class': 'srd-ranks' }, [
		renderRanking('CPU 排行 · 全机比例', plan.top_cpu || [], 'cpu', namesByPid),
		renderRanking('内存排行 · 常驻内存', plan.top_memory || [], 'memory', namesByPid)
	]));
	nodes.push(renderServiceOptions(plan, onOptimize), text('h4', 'APK 缓存', 'srd-rank-title'));
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

function mapHeading(title, status, description) {
	return E('div', { 'class': 'srd-map-heading' }, [
		text('h4', title, 'srd-rank-title'), chip(status, description)
	]);
}

function mapHealth(topology, report) {
	const checks = new Map((report?.checks || []).map(check => [check.id, check]));
	const state = id => checks.get(id)?.state;
	const active = topology.outlets.filter(item => item.present);
	const dnsFailed = state('dns') === 'warning';
	const pastWeb = ['https_v4', 'https_v6'].filter(id => state(id) === 'passed').length;
	const failedWeb = ['https_v4', 'https_v6'].filter(id => state(id) === 'warning').length;
	const carrierDown = topology.wan_carrier === 'false';
	const missingOutlet = !active.length && topology.outlets.every(item => item.readable);
	let outlet = { state:'skipped', label:'待测公网', detail:'显示路由器主路由表中的默认出口。' };
	if (missingOutlet) {
		outlet = { state:'failed', label:carrierDown ? 'WAN 无链路' : '未找到默认出口',
			detail:carrierDown ? '先检查 WAN 网线和上级设备。' : '检查上网接口和默认路由。自定义策略路由需单独核对。' };
	} else if (carrierDown && active.some(item => item.device === topology.wan_l3 || item.device === topology.wan_device)) {
		outlet = { state:'failed', label:'WAN 无链路', detail:'当前默认出口的 WAN 设备未报告载波。' };
	} else if (pastWeb && failedWeb) {
		outlet = { state:'warning', label:state('https_v6') === 'warning' ? 'IPv6 网页需核对' : 'IPv4 网页需核对',
			detail:checks.get(state('https_v6') === 'warning' ? 'https_v6' : 'https_v4').detail };
	} else if (pastWeb) {
		outlet = { state:'passed', label:pastWeb === 2 ? '双栈网页可达' : '网页探测通过', detail:'路由器收到了测试站点的 HTTPS 响应。' };
	} else if (dnsFailed) {
		outlet = { state:'skipped', label:'先检查 DNS', detail:'解析未通过，暂不能单独判断公网网页链路。' };
	} else if (failedWeb) {
		outlet = { state:'warning', label:'网页探测需核对',
			detail:checks.get(state('https_v4') === 'warning' ? 'https_v4' : 'https_v6').detail };
	} else if (active.length && report) {
		outlet = { state:'skipped', label:'已识别出口', detail:'本轮没有通过网页访问探测。' };
	}
	let dns = { state:'skipped', label:'DNS 待测', detail:'联网体检完成后显示实际解析结果。' };
	if (state('dnsmasq') === 'failed') {
		dns = { state:'failed', label:'DNS 服务异常', detail:checks.get('dnsmasq').detail };
	} else if (dnsFailed) {
		dns = { state:missingOutlet ? 'warning' : 'failed', label:'DNS 解析失败',
			detail:missingOutlet ? '缺少默认出口，请先排查上游。' : (report.findings || []).find(finding =>
				finding.id === 'dns_resolution')?.advice || checks.get('dns').detail };
	} else if (state('dns') === 'passed') {
		dns = { state:'passed', label:'DNS 解析通过', detail:checks.get('dns').detail };
	}
	return { active, outlet, dns, checks };
}

function renderMapSegment(segment, prefixCheck, open) {
	let status = { state:'skipped', label:'接口状态未确认' };
	if (segment.up === 'false' || segment.carrier === 'false')
		status = { state:segment.id === 'lan' ? 'failed' : 'warning', label:segment.up === 'false' ? '接口未运行' : '无链路' };
	else if (segment.id === 'lan' && prefixCheck?.state === 'warning')
		status = { state:'warning', label:'IPv6 分配需核对' };
	else if (segment.up === 'true') status = { state:'passed', label:'接口运行中' };

	const clientState = {
		recent: ['passed','近期有响应'], known: ['skipped','有邻居记录'],
		lease: ['skipped','仅有租约'], unresolved: ['warning','邻居解析未确认']
	};
	const portLine = segment.ports.map(port => port.name +
		(port.carrier === 'false' ? '（无载波）' : port.carrier === 'true' ? '（有载波）' : '')).join(' · ');
	return E('article', { 'class': 'srd-map-node', 'data-state': status.state }, [
		mapHeading(segment.id === 'lan' ? '家庭局域网' : segment.id, status.state, status.label),
		text('p', [segment.device, segment.gateway].filter(Boolean).join(' · ') || '地址或设备尚未确认', 'srd-accel-copy'),
		portLine ? text('p', '桥接端口：' + portLine, 'srd-map-meta') : '',
		segment.id === 'lan' && prefixCheck?.state === 'warning' ? text('p', prefixCheck.detail, 'srd-map-meta') : '',
		segment.clients.length ? E('details', { 'class': 'srd-evidence', 'data-segment': segment.id, 'open': open || null }, [
			text('summary', '查看设备（' + segment.client_count + '）'),
			E('ul', { 'class': 'srd-map-clients' }, segment.clients.map(client => {
				const [tone, label] = clientState[client.state] || clientState.known;
				const address = client.address || client.ipv6;
				return E('li', {}, [
					E('div', {}, [text('strong', client.host || address || '未知设备'),
						text('span', [client.host && address ? address : 'MAC 尾号 ' + client.mac_tail,
							client.learned_port ? '从 ' + client.learned_port + ' 方向学到' : ''].filter(Boolean).join(' · '), 'srd-map-meta')]),
					chip(tone, label)
				]);
			})),
			segment.client_count > segment.clients.length ? text('p', '显示前 ' + segment.clients.length + ' 台设备。', 'srd-map-meta') : ''
		]) : text('p', '尚未观察到设备记录。', 'srd-map-meta')
	]);
}

function renderNetworkMap(map, report, checking, expanded = new Set()) {
	const { active, outlet, dns, checks } = mapHealth(map, report);
	const bypass = active.some(item => map.segments.some(segment => segment.device && segment.device === item.device));
	const outlets = map.outlets.map(item => {
		let description = '未发现默认路由';
		if (!item.readable) description = '未能读取默认路由';
		else if (item.present) description = [item.device || '设备待核对', item.gateway].filter(Boolean).join(' · ');
		if (item.route_count > 1) description += '（共 ' + item.route_count + ' 条默认路由）';
		return E('div', {}, [ text('dt', 'IPv' + item.family), text('dd', description) ]);
	});
	return [
		E('div', { 'class': 'srd-map-path' }, [
			E('article', { 'class': 'srd-map-node', 'data-state': outlet.state }, [
				mapHeading('上游出口', outlet.state, outlet.label),
				E('dl', { 'class': 'srd-map-outlets' }, outlets),
				map.wan_protocol === 'pppoe' && !bypass ? text('p', 'PPPoE 拨号' + (map.wan_device ? ' · ' + map.wan_device : ''), 'srd-map-meta') : '',
				bypass ? text('p', '默认出口经过 LAN，可能是旁路由或单臂接入。', 'srd-map-meta') : '',
				text('p', outlet.detail, 'srd-accel-copy')
			]),
			E('div', { 'class': 'srd-map-link', 'aria-hidden': 'true' }),
			E('article', { 'class': 'srd-map-node', 'data-state': dns.state }, [
				mapHeading('本机路由器', dns.state, dns.label),
				text('p', map.model || '软路由', 'srd-accel-copy'),
				text('p', dns.detail, 'srd-map-meta')
			]),
			E('div', { 'class': 'srd-map-link', 'aria-hidden': 'true' }),
			E('div', { 'class': 'srd-map-segments' }, map.segments.length ?
				map.segments.map(segment => renderMapSegment(segment, checks.get('lan_prefix'), expanded.has(segment.id))) : [
					E('article', { 'class': 'srd-map-node' }, [
						mapHeading('局域网络', 'skipped', '未识别'),
						text('p', '未读到常用 LAN 接口。自定义接口可能分在其他防火墙区域。', 'srd-accel-copy')
					])
				])
		]),
		E('p', { 'class': 'srd-map-meta', 'role': 'status' }, checking ? '正在复测 DNS 和公网链路…' :
			report ? '设备来自本机邻居表与 DHCP 租约。AP 或交换机之后的物理连接需要从对应设备确认。' :
				'本轮公网检查未返回，图中保留了路由器已读取的结构。')
	];
}

async function readBrowserPeer() {
	const response = await request.get(L.url('admin/status/soft-router-doctor/peer'), {
		timeout: 4500, credentials: true, nobatch: true
	});
	if (!response.ok) return '';
	const { address } = response.json() || {};
	return typeof address === 'string' && /^[0-9a-f:.]{1,45}$/i.test(address) ? address : '';
}

function observedDevices(map, discovery) {
	const devices = [];
	for (const item of discovery?.lldp || []) {
		const prior = item.mac && devices.find(device => device.mac === item.mac && device.port === item.port);
		if (prior) {
			prior.name ||= item.name;
			prior.address ||= item.address;
			prior.capabilities ||= item.capabilities;
			prior.advertised_port ||= item.advertised_port;
		} else {
			devices.push({ ...item, lldp: true, mesh: [] });
		}
	}
	for (const item of map?.lldp || []) {
		if (!devices.some(device => device.port === item.port && (device.name === item.name ||
			(device.name && item.name.startsWith(device.name))))) devices.push({ ...item, lldp: true, mesh: [] });
	}
	for (const item of discovery?.mesh || []) {
		const device = devices.find(device => device.mac === item.mac && device.port === item.port);
		if (device) {
			device.address ||= item.address;
			if (!device.mesh.includes(item.role)) device.mesh.push(item.role);
		} else {
			devices.push({ ...item, mesh: [item.role] });
		}
	}
	for (const item of discovery?.routers || []) {
		const sameAddress = devices.filter(device => device.address && device.address === item.address);
		if (sameAddress.length === 1) Object.assign(sameAddress[0], { host: item.host, title: item.title });
		else devices.push({ ...item, mesh: [] });
	}
	return devices;
}

function deviceName(device) {
	return device.title || device.host || device.name || device.address || device.mac || '未命名设备';
}

function observedMode(device) {
	const flags = (device.capabilities || '').split(',').map(flag => flag.trim());
	const modes = [];
	if (flags.includes('Router')) modes.push('路由');
	if (flags.includes('Bridge')) modes.push('桥接');
	if (flags.includes('WLAN AP')) modes.push('无线 AP');
	if (device.mesh.includes('controller')) modes.push('Mesh 控制器');
	if (device.mesh.includes('agent')) modes.push('Mesh 代理节点');
	if (device.nextHop) modes.push('已观测到路由转发');
	return modes.length ? modes.join('、') : '模式待核实';
}

function renderObservedPath(map, peer, devices) {
	const steps = [];
	const add = (name, detail, unknown = false) => steps.push(E('li', unknown ? { 'data-state': 'unknown' } : {},
		[text('strong', name), text('span', detail)]));
	const segment = map.segments.find(item => item.id === peer.lan);
	const gateway = segment?.gateway?.split('/')[0];
	add('本机软路由', [gateway, peer.port && '接入端口 ' + peer.port].filter(Boolean).join(' · ') || peer.lan);
	const near = devices.filter(item => item.lldp && peer.port && item.port === peer.port);
	if (peer.state === 'routed') {
		const hop = devices.find(item => item.address === peer.next_hop);
		add(hop ? deviceName(hop) : '返回路径下一跳', peer.next_hop + ' · 软路由路由表');
	} else if (near.length === 1) {
		add(deviceName(near[0]), [near[0].address, '软路由侧收到 LLDP'].filter(Boolean).join(' · '));
	}
	add('接线顺序待确认', peer.state === 'routed' ? '下一跳后的链路缺少证据' : '中间桥接、AP 或交换机缺少逐段证据', true);
	add(peer.host || '当前浏览器连接', peer.address);
	return E('ol', { 'class': 'srd-pc-path', 'aria-label': '从软路由到当前浏览器的观测路径' }, steps);
}

function renderPathEvidence(map, discovery) {
	if (!map) return [];
	const peer = map.browser_peer;
	const devices = observedDevices(map, discovery);
	const nodes = [];
	const local = [];
	if (map.wan_up === 'true' && map.wan_protocol === 'pppoe') local.push('WAN 正在 PPPoE 拨号');
	if (map.forwarding === '1' && map.wan_up === 'true' && map.wan_nat === '1') local.push('路由转发已启用 · WAN 配置了源地址转换');
	if (map.segments.some(segment => segment.ports?.length)) local.push('LAN 使用桥接接口');
	if (map.wireless_modes?.includes('ap')) local.push('本机运行无线 AP 接口');
	if (map.wireless_modes?.includes('mesh')) local.push('本机运行 802.11s Mesh 接口');
	if (local.length) nodes.push(text('p', '本机 · ' + local.join(' · '), 'srd-path-fact'));

	if (peer?.state === 'neighbor_observed' || peer?.state === 'routed' || peer?.state === 'on_link') {
		nodes.push(renderObservedPath(map, peer, devices));
		const via = peer.state === 'routed' ? '返回路由经过 ' + peer.next_hop + '，已观测到一层转发。' :
			peer.state === 'neighbor_observed' ? '同一局域网内观察到当前连接的邻居记录。' :
				'当前连接的地址位于局域网，邻居记录尚未取得。';
		nodes.push(text('p', via + '地址来自当前 LuCI 会话。若经过代理或下级 NAT，显示的是软路由看到的连接来源。', 'srd-map-meta'));
	} else {
		const message = peer?.state === 'outside' ? '当前连接无法关联到本机 LAN。通过代理、回环或外部网络访问时，终端接线顺序待确认。' :
			'当前 LuCI 未提供浏览器连接来源，终端接线顺序待确认。';
		nodes.push(text('p', message, 'srd-map-meta'));
	}
	if (devices.length) {
		nodes.push(text('h5', '发现的网络设备', 'srd-path-fact'));
		nodes.push(E('ul', { 'class': 'srd-path-devices' }, devices.map(device => {
			const address = device.address && device.address !== deviceName(device) ? device.address : '';
			const nextHop = peer?.state === 'routed' && peer.next_hop === device.address;
			const mode = observedMode({ ...device, nextHop });
			const sources = [device.lldp && 'LLDP' + (device.port ? ' · ' + device.port : ''),
				device.mesh.length && 'IEEE 1905.1', device.title && '管理页', device.host && 'DHCP 自报名',
				nextHop && '本机返回路由的下一跳'];
			const details = [address, ...sources, device.advertised_port && '对端公布端口 ' + device.advertised_port].filter(Boolean);
			return E('li', {}, [text('strong', deviceName(device)), text('span', mode, 'srd-mode-label'),
				text('span', details.join(' · '), 'srd-map-meta')]);
		})));
	} else if (discovery) {
		nodes.push(text('p', '本轮未收到设备身份或模式通告。局域网接口和普通设备仍可在上方查看。', 'srd-map-meta'));
	}
	if (discovery) nodes.push(text('p', '探测 ' + discovery.hosts_probed + ' 个本地地址，读取 ' + discovery.pages_checked +
		' 个候选管理页，监听 ' + discovery.lldp_ports + ' 个 LAN 端口。', 'srd-map-meta'));
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
		let mapping = false;
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
		const mapButton = button('网络拓扑', () => runTopology());
		mapButton.setAttribute('aria-controls', 'srd-network-map');
		mapButton.setAttribute('aria-expanded', 'false');
		speedButton.setAttribute('aria-controls', 'srd-accel');
		speedButton.setAttribute('aria-expanded', 'false');

		const speedContent = E('div');
		const speedPanel = E('section', {
			'class': 'srd-accel', 'id': 'srd-accel', 'aria-labelledby': 'srd-accel-title', 'hidden': true
		}, [
			E('div', { 'class': 'srd-accel-top' }, [
				E('h3', { 'class': 'srd-section-title', 'id': 'srd-accel-title' }, '进程、自启动与缓存'),
				button('收起', () => {
					speedPanel.hidden = true;
					speedButton.setAttribute('aria-expanded', 'false');
					speedButton.focus();
				})
			]),
			speedContent
		]);

		const mapContent = E('div');
		let latestMap = null;
		let discovery = null;
		const pathStatus = E('p', { 'class': 'srd-map-meta', 'role': 'status' });
		const pathEvidence = E('div');
		const discoverButton = button('重新检测', runTopology);
		const mapPanel = E('section', { 'class': 'srd-accel', 'id': 'srd-network-map',
			'aria-labelledby': 'srd-network-map-title', 'hidden': true }, [
			E('div', { 'class': 'srd-accel-top' }, [
				E('h3', { 'class': 'srd-section-title', 'id': 'srd-network-map-title' }, '家庭网络拓扑'),
				button('收起', () => {
					mapPanel.hidden = true;
					mapButton.setAttribute('aria-expanded', 'false');
					mapButton.focus();
				})
			]),
			mapContent,
			E('section', { 'class': 'srd-path-evidence' }, [
				text('h4', '接线与工作模式', 'srd-rank-title'),
				E('div', { 'class': 'srd-path-actions' }, [discoverButton, pathStatus]),
				pathEvidence
			])
		]);

		function updateTopology(map, health, checking = false) {
			latestMap = map;
			const expanded = new Set([...mapContent.querySelectorAll('details[open]')].map(item => item.dataset.segment));
			dom.content(mapContent, renderNetworkMap(map, health, checking, expanded));
			dom.content(pathEvidence, renderPathEvidence(latestMap, discovery));
		}

		async function runTopology() {
			if (busy || accelerating || mapping) return;
			mapping = true;
			discovery = null;
			mapPanel.hidden = false;
			mapButton.setAttribute('aria-expanded', 'true');
			speedPanel.hidden = true;
			speedButton.setAttribute('aria-expanded', 'false');
			dom.content(mapContent, E('p', { 'role': 'status' }, '正在读取接口、默认路由和当前连接。'));
			dom.content(pathEvidence, []);
			pathStatus.textContent = '';
			update();
			try {
				const peer = await readBrowserPeer().catch(() => '');
				const map = await networkMap(peer);
				if (!Array.isArray(map?.outlets) || !Array.isArray(map.segments)) throw new Error('invalid network map');
				updateTopology(map, null, true);
				const health = scan().catch(() => null);
				health.then(report => updateTopology(latestMap, report));
				pathStatus.textContent = '正在发现路由设备和邻居通告。';
				try {
					discovery = await discoverRouters();
					if (!Array.isArray(discovery?.routers)) {
						discovery = null;
						throw new Error('invalid router discovery');
					}
					const sampled = discovery;
					dom.content(pathEvidence, renderPathEvidence(latestMap, discovery));
					if (sampled.lldp_ports && !sampled.lldp?.length) {
						pathStatus.textContent = '正在等待下一轮 LLDP 通告。';
						const repeat = await discoverRouters(true).catch(() => null);
						if (repeat?.lldp?.length) sampled.lldp = repeat.lldp;
						if (repeat?.mesh?.length) sampled.mesh = (sampled.mesh || []).concat(repeat.mesh);
					}
					const refreshed = await networkMap(peer).catch(() => null);
					if (Array.isArray(refreshed?.segments) && Array.isArray(refreshed?.outlets)) latestMap = refreshed;
					pathStatus.textContent = '自动检测完成。';
				} catch (error) {
					pathStatus.textContent = '设备发现未完成，已保留本机的拓扑信息。';
					console.error(error);
				}
				updateTopology(latestMap, await health);
			} catch (error) {
				dom.content(mapContent, E('p', { 'role': 'status' }, '无法读取拓扑。请重新登录或核对拓扑查看权限。'));
				console.error(error);
			} finally {
				mapping = false;
				update();
			}
		}

		function confirmOptimization(items) {
			ui.showModal('确认优化选中项', [
				text('p', '请确认下列服务的功能目前用不到。每项都会先检查联网，再应用并复测。'),
				E('ul', {}, items.map(item => text('li', item.label + '：' +
					[item.stop ? '停止当前服务' : '', item.disable ? '关闭开机自启' : ''].filter(Boolean).join('、') +
					'。' + item.impact))),
				E('div', { 'class': 'right' }, [
					E('button', { 'type': 'button', 'class': 'cbi-button', 'click': () => ui.hideModal() }, '取消'),
					' ',
					E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': () => {
						ui.hideModal();
						runAcceleration(null, items);
					} }, '确认优化')
				])
			]);
		}

		async function runAcceleration(plan, items = []) {
			if (busy || accelerating || mapping) return;
			accelerating = true;
			mapPanel.hidden = true;
			mapButton.setAttribute('aria-expanded', 'false');
			speedPanel.hidden = false;
			speedButton.setAttribute('aria-expanded', 'true');
			dom.content(speedContent, E('p', { 'role': 'status', 'class': 'srd-accel-copy' },
				plan ? '正在回收并复查缓存占用。' : items.length ?
					'正在优化选中服务并复测网络。' : '正在读取进程、自启动和缓存。'));
			update();
			let result;
			const serviceResults = [];
			try {
				if (plan) result = await applyAcceleration(true, plan.token);
				for (const [index, item] of items.entries()) {
					speedContent.firstChild.textContent = '正在处理 ' + (index + 1) + '/' + items.length + ' · ' + item.label;
					let outcome;
					try {
						outcome = await optimizeService(true, item.id, item.token, item.stop, item.disable);
					} catch {
						outcome = { state: 'attention', detail: '未取得服务复测结果，请核对启动状态。' };
					}
					serviceResults.push({ ...outcome, label: item.label });
					if (outcome.state !== 'applied') {
						if (index < items.length - 1) serviceResults.push({ label: '后续项目', detail: '已暂停执行。' });
						break;
					}
				}
				const next = await accelerationPlan();
				if (!next || typeof next.state !== 'string') throw new Error('invalid acceleration plan');
				const confirm = next.state === 'ready' && next.token && L.hasViewPermission() ?
					() => runAcceleration(next) : null;
				const onOptimize = L.hasViewPermission() ? confirmOptimization : null;
				dom.content(speedContent, renderAcceleration(next, result, confirm, onOptimize, serviceResults));
			}
			catch (error) {
				const message = serviceResults.length ? serviceResults.map(entry => entry.label + '：' + entry.detail).join(' ') :
					result?.detail || '暂时无法取得加速结果。请检查登录状态后重试。';
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
			primary.disabled = local.disabled = speedButton.disabled = mapButton.disabled = busy || accelerating || mapping;
			discoverButton.disabled = busy || accelerating || mapping;
			exportButton.disabled = busy || accelerating || mapping || !report;
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
				const fix = !busy && !accelerating && !mapping && report.can_start_dnsmasq && L.hasViewPermission() ? showConfirmation : null;
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
			if (busy || accelerating || mapping) return;
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
			if (busy || accelerating || mapping) return;
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
			if (busy || accelerating || mapping) return;
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
					E('div', { 'class': 'srd-actions' }, [ primary, local, mapButton, speedButton, exportButton ]),
					meta
				]),
				dial
			]),
			steps, live, notice, mapPanel, speedPanel, results
		]);
	}
});
