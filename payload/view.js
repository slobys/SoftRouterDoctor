'use strict';
'require view';
'require rpc';
'require request';
'require ui';
'require dom';
'require poll';

const networkMap = rpc.declare({ object: 'soft-router-doctor', method: 'networkMap', params: ['peer'], reject: true });
const measureQuality = rpc.declare({ object: 'soft-router-doctor', method: 'quality', reject: true });
const diagnoseWebsite = rpc.declare({ object: 'soft-router-doctor', method: 'diagnoseSite', params: ['host'], reject: true });
const diagnoseLan = rpc.declare({ object: 'soft-router-doctor', method: 'lanAccess', params: ['peer', 'target', 'profile', 'clientCheck', 'name'], reject: true });
const monitorStatus = rpc.declare({ object: 'soft-router-doctor', method: 'monitorStatus', reject: true });
const monitorSet = rpc.declare({ object: 'soft-router-doctor', method: 'monitorSet', params: ['enabled'], reject: true });
const savedTopology = rpc.declare({ object: 'soft-router-doctor', method: 'savedTopology', reject: true });
const editTopology = rpc.declare({
	object: 'soft-router-doctor', method: 'editTopology',
	params: ['action', 'revision', 'id', 'address', 'name', 'mode'], reject: true
});
const topologyWriteAccess = rpc.declare({
	object: 'session', method: 'access', params: ['scope', 'object', 'function'], expect: { access: false }
});
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
	'.srd-saved{margin:2px 0 18px;padding-bottom:14px;border-bottom:1px solid var(--line)}.srd-saved-head{display:flex;justify-content:space-between;align-items:center;gap:8px 12px;flex-wrap:wrap}.srd-saved-head .srd-rank-title{margin:0}.srd-saved-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px}',
	'.srd-root .srd-saved-list{list-style:none;margin:8px 0;padding:0}.srd-saved-list>li{display:flex;justify-content:space-between;align-items:center;gap:6px 12px;flex-wrap:wrap;border-top:1px solid var(--line);padding:7px 0}.srd-saved-list strong{overflow-wrap:anywhere}.srd-root .srd-saved-list .srd-button{min-height:40px;padding:6px 10px;font-size:.8rem}',
	'.srd-saved-form{margin:10px 0;padding:10px 12px;background:var(--quiet);border-radius:8px}.srd-saved-fields{display:flex;flex-wrap:wrap;gap:8px 12px;margin:7px 0 10px}.srd-saved-fields label{display:grid;gap:4px;flex:1 1 150px;min-width:0;font-size:.82rem;color:var(--ink)}.srd-root .srd-saved-fields input,.srd-root .srd-saved-fields select{width:100%;box-sizing:border-box;min-height:40px;min-width:0;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:7px;padding:5px 8px}',
	'.srd-record-card{margin-top:14px;border:1px solid var(--line);border-radius:12px;background:var(--paper);padding:14px 16px}.srd-record-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;margin-bottom:5px}.srd-root .srd-record-head .srd-section-title{flex:1 1 12rem;width:auto;min-width:0;margin:0}.srd-record-summary{margin-top:6px;overflow-wrap:anywhere}.srd-record-summary strong{font-size:.96rem}.srd-record-summary .srd-map-meta{margin-top:3px}',
	'.srd-root .srd-record-items{list-style:none;margin:7px 0 12px;padding:0}.srd-record-items li{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 12px;padding:7px 0;border-top:1px solid var(--line)}.srd-record-items strong{font-size:.85rem}.srd-record-timeline .srd-button{margin-bottom:4px}',
	'.srd-quality-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;margin-bottom:10px}.srd-root .srd-quality-header .srd-section-title{flex:1 1 9rem;min-width:0;width:auto;margin:0}.srd-quality-actions{display:flex;gap:6px;flex-wrap:wrap}.srd-quality-summary{background:var(--quiet);border-radius:7px;padding:9px 11px}.srd-quality-summary strong{font-size:.96rem}.srd-quality-local{margin-top:10px;padding:7px 0}.srd-quality-local strong{font-size:.85rem}',
	'.srd-root .srd-quality-paths{list-style:none;margin:10px 0;padding:0}.srd-quality-paths li{border-top:1px solid var(--line);padding:9px 0;overflow-wrap:anywhere}.srd-quality-path-head{display:flex;align-items:center;flex-wrap:wrap;gap:4px 9px}.srd-quality-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,108px),1fr));gap:5px 10px;margin:6px 0 0}.srd-quality-stats dt{color:var(--muted);font-size:.76rem}.srd-quality-stats dd{margin:0;font-size:.85rem;font-weight:660;font-variant-numeric:tabular-nums}',
	'.srd-website-form{margin:9px 0 12px}.srd-website-form label{font-size:.85rem;font-weight:650}.srd-website-input{display:flex;flex-wrap:wrap;gap:6px 8px;margin:5px 0}.srd-root .srd-website-input input{flex:1 1 230px;min-width:0;min-height:44px;max-width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--ink);background:var(--paper)}.srd-root .srd-website-input input::placeholder{color:var(--muted)}.srd-root .srd-website-input input[aria-invalid=true]{border-color:var(--bad)}.srd-root .srd-website-input input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
	'.srd-website-result{padding:9px 11px;background:var(--quiet);border-radius:7px;overflow-wrap:anywhere}.srd-website-families{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:10px 22px;margin-top:12px}.srd-website-families section{min-width:0}.srd-website-families section>p{overflow-wrap:anywhere}.srd-website-steps{margin:5px 0 0}.srd-website-steps>div{display:grid;grid-template-columns:minmax(80px,.8fr) minmax(0,2fr);gap:4px 10px;padding:7px 0;border-top:1px solid var(--line)}.srd-website-steps dt{font-size:.83rem;color:var(--ink)}.srd-website-steps dd{margin:0;min-width:0}.srd-website-steps .srd-chip{white-space:normal;overflow-wrap:anywhere}',
	'.srd-lan-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:8px;margin:10px 0}.srd-lan-form label{display:grid;gap:4px;min-width:0;font-size:.85rem;font-weight:650}.srd-root .srd-lan-form :is(select,input){width:100%;max-width:100%;min-width:0;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:7px 9px;background-color:var(--paper);color:var(--ink)}.srd-root .srd-lan-form :is(select,input):focus-visible{outline:2px solid var(--accent);outline-offset:1px}.srd-root .srd-lan-form input[aria-invalid=true]{border-color:var(--bad)}.srd-lan-form .srd-primary{align-self:end;justify-self:start}.srd-lan-details dd{overflow-wrap:anywhere;color:var(--ink)}',
	'.srd-terminal{margin-top:16px}.srd-terminal .srd-rank-title{margin-bottom:5px}.srd-terminal .srd-website-steps{margin:8px 0}.srd-terminal .srd-terminal-line{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}.srd-terminal details{margin-top:8px}.srd-terminal summary{cursor:pointer}.srd-terminal code{overflow-wrap:anywhere;user-select:all}',
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

function downloadReport(report, filename = 'soft-router-doctor.json') {
	const url = URL.createObjectURL(new Blob([ JSON.stringify(report, null, 2) + '\n' ], {
		type: 'application/json'
	}));
	const link = E('a', { 'href': url, 'download': filename });
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

function linkSpeed(value) {
	return value >= 1000 ? (value / 1000) + ' Gbps' : value + ' Mbps';
}

function portDetails(port) {
	if (!port?.name) return '';
	const details = [port.name];
	if (port.carrier === 'false') details.push('无载波');
	else if (port.speed_mbps > 0) {
		details.push(linkSpeed(port.speed_mbps));
		if (port.best_mbps > port.speed_mbps) details.push('速率低于曾测 ' + linkSpeed(port.best_mbps));
	} else if (port.carrier === 'true') details.push('有载波');
	if (port.drops_observed > 0) details.push('观察到掉链 ' + port.drops_observed + ' 次');
	return details.join(' · ');
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
	const portLine = segment.ports.map(portDetails).filter(Boolean);
	return E('article', { 'class': 'srd-map-node', 'data-state': status.state }, [
		mapHeading(segment.id === 'lan' ? '家庭局域网' : segment.id, status.state, status.label),
		text('p', [segment.device, segment.gateway].filter(Boolean).join(' · ') || '地址或设备尚未确认', 'srd-accel-copy'),
		portLine.length ? E('div', {}, [text('p', '桥接端口', 'srd-map-meta'), ...portLine.map(line => text('p', line, 'srd-map-meta'))]) : '',
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
				Number.isFinite(map.wan_port?.speed_mbps) ?
					text('p', portDetails({ ...map.wan_port, carrier: map.wan_carrier }), 'srd-map-meta') : '',
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

const savedModes = { unknown: '待确认', ap: '无线 AP', bridge: '桥接', mesh: 'Mesh', router: '路由' };
const savedStates = {
	confirmed: '身份已匹配', updated: 'IP 已同步', unbound: '等待绑定 MAC',
	ambiguous: '有多个候选 IP', conflict: '录入 IP 已有其他设备', unseen: '暂未找到此 MAC'
};
const savedProof = { lease: 'DHCP 租约', neighbor: 'ARP 邻居', both: 'DHCP 与 ARP' };

function savedNetworkDiagram(canEdit) {
	let snapshot = null;
	let reading = null;
	let generation = 0;
	let writing = false;
	const status = E('p', { class: 'srd-map-meta', role: 'status' });
	const diagram = E('div');
	const entries = E('div');
	const editor = E('div', { hidden: true, class: 'srd-saved-form' });
	const add = button('添加路由器', () => openEditor(null, 'save'));
	const refreshButton = button('刷新地址', () => refresh());
	const root = E('section', { class: 'srd-saved', 'aria-labelledby': 'srd-saved-title' }, [
		E('div', { class: 'srd-saved-head' }, [
			E('h4', { class: 'srd-rank-title', id: 'srd-saved-title' }, '我的接线图'),
			E('div', { class: 'srd-saved-controls' }, canEdit ? [add, refreshButton] : [refreshButton])
		]),
		status, diagram, editor, entries
	]);
	add.disabled = true;

	function render() {
		add.disabled = !snapshot || writing || snapshot.nodes.length >= 24;
		refreshButton.disabled = writing;
		if (!snapshot) return;
		const { nodes } = snapshot;
		if (!nodes.length) {
			dom.content(diagram, text('p', canEdit ? '按接线顺序添加路由器。绑定 MAC 后，管理 IP 会自动更新。' :
				'尚未保存接线图。', 'srd-map-meta'));
			dom.content(entries, []);
			return;
		}

		const steps = [E('li', {}, [text('strong', '本机软路由'), text('span', '接线起点')])];
		for (const node of nodes) {
			const caption = node.address || ('录入 IP ' + node.entered);
			steps.push(E('li', node.address ? {} : { 'data-state': 'unknown' }, [
				text('strong', node.name), text('span', caption), text('span', savedModes[node.mode] || savedModes.unknown)
			]));
		}
		dom.content(diagram, [
			text('p', '接线顺序按你的设置显示。', 'srd-map-meta'),
			E('ol', { class: 'srd-pc-path', 'aria-label': '已保存的接线顺序' }, steps)
		]);
		dom.content(entries, E('ul', { class: 'srd-saved-list' }, nodes.map((node, index) => {
			const facts = [
				node.address ? '当前 IP ' + node.address : '录入 IP ' + node.entered,
				savedModes[node.mode], savedStates[node.state], savedProof[node.source]
			].filter(Boolean);
			const content = [E('div', {}, [text('strong', node.name), text('span', facts.join(' · '), 'srd-map-meta')])];
			if (canEdit) {
				const edit = button('编辑', () => openEditor(node, 'save'));
				const bind = button(node.mac ? '更换绑定' : '绑定设备', () => openEditor(node, 'bind'));
				const up = button('上移', () => write('up', snapshot.revision, node.id));
				const down = button('下移', () => write('down', snapshot.revision, node.id));
				const remove = button('删除', () => confirmRemove(node, snapshot.revision));
				up.disabled = writing || index === 0;
				down.disabled = writing || index === nodes.length - 1;
				for (const control of [edit, bind, remove]) control.disabled = writing;
				for (const control of [edit, bind, up, down, remove])
					control.setAttribute('aria-label', control.textContent + ' ' + node.name);
				content.push(E('div', { class: 'srd-saved-controls' }, [edit, bind, up, down, remove]));
			}
			return E('li', { 'data-node-id': node.id }, content);
		})));
	}

	function refresh(force = false) {
		if ((writing || reading) && !force) return reading;
		const ticket = ++generation;
		reading = savedTopology().then(data => {
			if (ticket !== generation) return;
			if (!Array.isArray(data?.nodes) || typeof data.revision !== 'string')
				throw new Error(data?.detail || 'saved topology unavailable');
			if (force || JSON.stringify(snapshot) !== JSON.stringify(data)) {
				snapshot = data;
				render();
			}
		}).catch(error => {
			if (ticket === generation) status.textContent = snapshot ?
				'暂时无法刷新设备地址。' : '无法读取接线图，请检查拓扑读取权限。';
			console.error(error);
		}).finally(() => {
			if (ticket === generation) reading = null;
		});
		return reading;
	}

	function openEditor(node, action) {
		if (!snapshot || writing) return;
		const revision = snapshot.revision;
		const binding = action === 'bind';
		const changingAddress = binding || !node;
		const address = E('input', { type: 'text', inputmode: 'decimal', maxlength: 15,
			placeholder: '例如 192.168.2.10', value: node?.address || node?.entered || '' });
		const name = E('input', { type: 'text', maxlength: 32, placeholder: '例如 客厅路由器', value: node?.name || '' });
		const mode = E('select', {}, Object.entries(savedModes).map(([value, label]) => E('option', { value }, label)));
		mode.value = node?.mode || 'unknown';
		const fields = [];
		if (changingAddress) fields.push(E('label', {}, [text('span', '管理 IPv4 地址'), address]));
		if (!binding) fields.push(E('label', {}, [text('span', '设备名称'), name]),
			E('label', {}, [text('span', '工作模式'), mode]));
		const submit = button(binding ? '确认绑定' : '保存设备', async () => {
			if (changingAddress && !address.value.trim()) { address.focus(); return; }
			submit.disabled = true;
			try {
				if (await write(action, revision, node?.id || '', address.value.trim(), name.value.trim(), mode.value))
					editor.hidden = true;
			} finally {
				submit.disabled = false;
			}
		}, true);
		dom.content(editor, [
			text('strong', binding ? '按管理 IP 绑定设备' : node ? '编辑设备信息' : '添加路由器'),
			binding ? text('p', '请确认这个 IP 当前属于要绑定的路由器。', 'srd-map-meta') : null,
			E('div', { class: 'srd-saved-fields' }, fields),
			E('div', { class: 'srd-saved-controls' }, [submit, button('取消', () => { editor.hidden = true; })])
		].filter(Boolean));
		editor.hidden = false;
		(changingAddress ? address : name).focus();
	}

	function confirmRemove(node, revision) {
		ui.showModal('从接线图删除设备', [
			text('p', '删除「' + node.name + '」的接线图记录？'),
			E('div', { class: 'srd-modal-actions' }, [
				button('取消', () => ui.hideModal()),
				button('删除记录', () => { ui.hideModal(); write('remove', revision, node.id); }, true)
			])
		]);
	}

	async function write(action, revision, id, address = '', name = '', mode = 'unknown') {
		if (writing) return false;
		writing = true;
		status.textContent = action === 'save' || action === 'bind' ? '正在保存并核对设备身份…' : '正在保存接线图…';
		render();
		try {
			const result = await editTopology(action, revision, id, address, name, mode);
			if (!result?.detail) throw new Error('invalid topology save response');
			if (result.state === 'applied' || result.state === 'stale') await refresh(true);
			status.textContent = result.detail;
			if (result.state === 'stale') editor.hidden = true;
			return result.state === 'applied';
		} catch (error) {
			status.textContent = '无法保存接线图，请确认具备拓扑写入权限后重试。';
			console.error(error);
			return false;
		} finally {
			writing = false;
			render();
		}
	}

	return { root, refresh, hasNodes: () => Boolean(snapshot?.nodes.length) };
}

const eventKinds = {
	port_link: '网口链路', port_flap: '网口发生短时掉链', port_speed: '网口协商速率',
	pppoe: 'PPPoE 会话', pppoe_reconnect: '观察到 PPPoE 重拨',
	route4: 'IPv4 默认路由', route6: 'IPv6 默认路由', dns: 'DNS 样本解析',
	web4: 'IPv4 HTTPS 样本', web6: 'IPv6 HTTPS 样本', monitor_gap: '网络记录已重新开始'
};

function eventTitle(event) {
	const label = [event.port, eventKinds[event.kind]].filter(Boolean).join(' ');
	if (event.kind === 'port_speed' && event.transition === 'started')
		return event.port + ' 速率由 ' + linkSpeed(event.from) + ' 降至 ' + linkSpeed(event.to);
	if (event.kind === 'port_speed' && event.transition === 'restored')
		return event.port + ' 速率恢复至 ' + linkSpeed(event.to);
	if (event.kind === 'port_flap') return label + ' ' + event.to + ' 次';
	return label + (event.transition === 'started' ? '异常' : event.transition === 'restored' ? '恢复' : '');
}

function eventDuration(seconds) {
	if (seconds < 60) return seconds + ' 秒';
	if (seconds < 3600) return Math.floor(seconds / 60) + ' 分 ' + seconds % 60 + ' 秒';
	return Math.floor(seconds / 3600) + ' 小时 ' + Math.floor(seconds / 60) % 60 + ' 分';
}

function eventTime(event) {
	return new Date(event.time * 1000).toLocaleString('zh-CN', { hour12: false });
}

function incidentRecorder(canEdit) {
	let state = null;
	let reading = null;
	let changing = false;
	let unreadable = false;
	let snapshotKey = '';
	const status = E('p', { class: 'srd-map-meta', role: 'status' });
	const header = E('div', { class: 'srd-record-summary' });
	const timeline = E('div');
	const note = E('p', { class: 'srd-map-meta', role: 'status', hidden: true });
	const toggle = button('暂停记录', change);
	toggle.hidden = true;
	const card = E('section', { class: 'srd-record-card', 'aria-labelledby': 'srd-record-title' }, [
		E('div', { class: 'srd-record-head' }, [
			E('h3', { class: 'srd-section-title', id: 'srd-record-title' }, '网络异常回放'), toggle
		]),
		status, header, timeline, note
	]);
	status.textContent = '正在读取本次开机的网络记录。';

	function draw() {
		if (!state) {
			if (unreadable) status.textContent = '暂时无法读取网络记录。';
			return;
		}
		const recent = state.events.filter(item => Object.hasOwn(eventKinds, item.kind));
		const active = new Map();
		for (const item of recent) {
			const key = item.kind + '/' + item.port;
			if (item.kind === 'monitor_gap') active.clear();
			else if (item.transition === 'started') active.set(key, item);
			else if (item.transition === 'restored') active.delete(key);
		}
		const activeEvent = [...active.values()].sort((a, b) => b.time - a.time)[0];
		const sorted = recent.slice().reverse().sort((a, b) => b.time - a.time);
		const working = state.running && Number.isFinite(state.sample_age) && state.sample_age < 45;
		const latest = (working && activeEvent) || sorted.find(item => item.kind !== 'monitor_gap');
		status.textContent = unreadable ? '暂时无法刷新。以下是上次读取的记录。' :
			working ? '记录中 · 本次开机' : state.running ? '等待采样 · 本次开机' :
				state.enabled ? '服务未运行 · 本次开机记录可查看' : '记录已暂停 · 本次开机记录可查看';
		if (canEdit) {
			toggle.hidden = false;
			toggle.textContent = state.running ? '暂停记录' : '启用记录';
			toggle.disabled = changing;
		}
		dom.content(header, latest ? [
			text('strong', eventTitle(latest)),
			text('span', eventTime(latest) + (latest.transition === 'restored' ?
				' · 样本异常约 ' + eventDuration(latest.duration) : latest === activeEvent && working ? ' · 等待复测恢复' : ''), 'srd-map-meta')
		] : text('p', working ? '本次开机未记录到网络异常。' : '暂时没有网络异常记录。', 'srd-accel-copy'));
		const wasOpen = timeline.querySelector('details')?.open;
		dom.content(timeline, sorted.length ? E('details', { class: 'srd-record-timeline', open: wasOpen || null }, [
			text('summary', '查看事件（' + sorted.length + '）'),
			text('p', '记录来自软路由的接口状态和固定探测样本，时间为采样时间。', 'srd-map-meta'),
			E('ol', { class: 'srd-record-items' }, sorted.map(item => E('li', {}, [
				text('strong', eventTitle(item)), text('span', eventTime(item) +
					(item.transition === 'restored' ? ' · 约 ' + eventDuration(item.duration) : ''), 'srd-map-meta')
			]))),
			button('导出事件', () => downloadReport({ events: sorted.map(({ time, kind, transition, duration, from, to }) =>
				({ time, kind, transition, duration, from, to }))
			}, 'soft-router-doctor-events.json'))
		]) : []);
	}

	function refresh() {
		if (reading) return reading;
		reading = monitorStatus().then(next => {
			if (!Array.isArray(next?.events)) throw new Error('invalid monitor response');
			const key = JSON.stringify([next.running, next.enabled, next.sample_age < 45, next.events]);
			state = next;
			if (key !== snapshotKey || unreadable) {
				snapshotKey = key;
				unreadable = false;
				draw();
			}
		}).catch(() => {
			unreadable = true;
			draw();
		}).finally(() => { reading = null; });
		return reading;
	}

	async function change() {
		if (changing || !state) return;
		changing = true;
		toggle.disabled = true;
		note.hidden = false;
		note.textContent = '正在更新记录服务…';
		try {
			const result = await monitorSet(!state.running);
			note.textContent = result?.detail || '未取得记录服务状态。';
			if (reading) await reading;
			await refresh();
		} catch {
			note.textContent = '无法更改记录状态，请核对写入权限。';
		} finally {
			changing = false;
			toggle.disabled = false;
		}
	}

	return { card, refresh };
}

const qualityLabels = {
	similar: '接近本机轻载参考', reference_saved: '已保存本轮轻载参考',
	no_reference: '等待轻载参考', elevated: '高于轻载参考',
	elevated_upload: '上行流量伴随延迟升高', elevated_download: '下行流量伴随延迟升高',
	elevated_both: '双向流量伴随延迟升高', loss: '样本出现丢包',
	no_reply: '探测包未收到回包', unavailable: '未取得有效样本', path_changed: '测试期间出口变化'
};

function qualityValue(value, unit) {
	if (value == null || !Number.isFinite(Number(value))) return '未测';
	const amount = Number(value);
	if (unit === 'kbps') return amount < 1000 ? amount + ' kbps' : (amount / 1000).toFixed(2) + ' Mbps';
	return amount.toFixed(1) + ' ms';
}

async function measureBrowserPath() {
	const samples = [];
	const count = 4;
	const url = new URL(L.resource('view/status/soft-router-doctor.js'), location.href);
	if (url.origin !== location.origin) return null;
	for (let index = 0; index < count; index++) {
		const controller = new AbortController();
		const timer = window.setTimeout(() => controller.abort(), 1200);
		const start = performance.now();
		try {
			const response = await fetch(url, { method: 'HEAD', cache: 'no-store',
				credentials: 'same-origin', signal: controller.signal });
			if (response.ok) samples.push(performance.now() - start);
		} catch {
			// Keep other samples when a request times out.
		} finally {
			window.clearTimeout(timer);
		}
	}
	samples.sort((a, b) => a - b);
	const half = Math.floor(samples.length / 2);
	const median = samples.length % 2 ? samples[half] : (samples[half - 1] + samples[half]) / 2;
	return { received: samples.length, count, median };
}

function renderQuality(paths, localPath) {
	const local = localPath ? E('div', { class: 'srd-quality-local' }, [
		text('strong', '浏览器 → 软路由'),
		text('span', (localPath.received ? '请求耗时中位数 ' + qualityValue(localPath.median, 'ms') + ' · ' : '') +
			localPath.received + ' / ' + localPath.count + ' 次有响应 · 含浏览器和管理服务处理时间', 'srd-map-meta')
	]) : null;
	if (!paths.length) return [local, text('p', '没有找到可用于探测的公网出口。', 'srd-accel-copy')].filter(Boolean);
	const overlap = paths.filter(item => ['elevated_upload', 'elevated_download', 'elevated_both'].includes(item.result));
	const lost = paths.filter(item => item.result === 'loss');
	const comparable = paths.filter(item => item.reference_ms != null && item.result !== 'reference_saved');
	let title = '本轮没有拿到足够的对照样本';
	let detail = '工具会在出口流量较低时保存延迟参考。可在卡顿出现时再测一次。';
	if (overlap.length) {
		const same = overlap.every(item => item.result === overlap[0].result);
		title = same ? qualityLabels[overlap[0].result] : '有流量时，多个样本的延迟升高';
		detail = overlap.length + ' 个探测目标的延迟明显高于各自的轻载参考。可在相关上传或下载暂停时复测，验证是否随流量回落。';
	} else if (lost.length) {
		title = lost.length > 1 ? '多个探测目标出现丢包' : '有一个探测目标出现丢包';
		detail = '查看下方各个目标的回包数。不同目标的表现可帮助区分单个路径和更广泛的异常。';
	} else if (paths.some(item => item.result === 'elevated')) {
		title = '部分样本延迟高于轻载参考';
		detail = '本轮流量不足以判断方向，可结合故障时段和另一次采样对照。';
	} else if (paths.some(item => item.result === 'similar')) {
		title = '有对照的样本接近轻载参考';
		detail = comparable.length + ' 个目标有同出口轻载记录。可在卡顿发生时复测，比较该时刻的延迟和流量。';
	} else if (paths.some(item => item.result === 'reference_saved')) {
		title = '已保存本轮轻载参考';
		detail = '下次在同一出口和目标上采样时，就可以对比延迟变化。';
	} else if (paths.every(item => ['no_reply', 'unavailable'].includes(item.result))) {
		title = '这轮探测未取得有效回包';
		detail = '探测目标可能过滤 ICMP。可结合体检中的网页访问结果进一步核对。';
	} else if (paths.every(item => item.result === 'path_changed')) {
		title = '测试期间公网出口发生变化';
		detail = '出口稳定后复测可获得可比较的结果。';
	}
	return [
		E('div', { class: 'srd-quality-summary' }, [
			text('strong', title), text('p', detail, 'srd-accel-copy')
		]),
		local,
		E('ul', { class: 'srd-quality-paths' }, paths.map(item => {
			const facts = [
				['往返中位数', qualityValue(item.median_ms, 'ms')],
				['最高', qualityValue(item.max_ms, 'ms')],
				['轻载参考', qualityValue(item.reference_ms, 'ms')],
				['回包', item.sent ? item.received + ' / ' + item.sent : '未测'],
				['上行流量', qualityValue(item.upload_kbps, 'kbps')],
				['下行流量', qualityValue(item.download_kbps, 'kbps')]
			];
			const warning = ['loss', 'no_reply', 'elevated', 'elevated_upload', 'elevated_download',
				'elevated_both', 'path_changed'].includes(item.result);
			return E('li', {}, [
				E('div', { class: 'srd-quality-path-head' }, [
					text('strong', 'IPv' + item.family + ' · ' + item.target),
					text('span', item.device, 'srd-map-meta'),
					chip(warning ? 'warning' : 'skipped', qualityLabels[item.result] || '待确认')
				]),
				E('dl', { class: 'srd-quality-stats' }, facts.map(([label, value]) => E('div', {}, [
					text('dt', label), text('dd', value)
				])))
			]);
		})),
		text('p', '以上是软路由到固定目标的往返样本，以及对应出口在采样期间的平均流量。', 'srd-map-meta')
	].filter(Boolean);
}

function websiteHost(value) {
	const input = value.trim();
	if (!input || /[\x00-\x20\x7f]/.test(input)) return null;
	try {
		const qualified = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
		const url = new URL(qualified ? input : input.startsWith('//') ? 'https:' + input : 'https://' + input);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
		const host = url.hostname.replace(/\.$/, '');
		const labels = host.split('.');
		if (host.length > 253 || labels.length < 2 || !/^[a-z]/i.test(labels.at(-1))) return null;
		if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
		return host;
	} catch {
		return null;
	}
}

function websiteSteps(family) {
	const record = family.family === 6 ? 'AAAA' : 'A';
	const dns = {
		resolved: ['passed', family.eligible + ' 个公网 ' + record + ' 地址'],
		no_records: ['skipped', '站点未发布 ' + record + ' 记录'],
		nxdomain: ['failed', 'DNS 返回域名不存在'],
		timeout: ['failed', 'DNS 查询超时'],
		error: ['failed', 'DNS 服务器返回错误'],
		restricted: ['warning', 'DNS 仅返回非公网地址'],
		unavailable: ['skipped', '未取得可识别的 DNS 答复']
	};
	const tcp = {
		passed: ['passed', '已连到站点的 443 端口'],
		no_route: ['failed', '路由器未找到可用出口'],
		scope_unverified: ['skipped', '该地址未走可确认的公网出口'],
		timeout: ['failed', '建立 TCP 连接超时'],
		failed: ['failed', '路由器未能建立 TCP 连接'],
		unavailable: ['skipped', '未确认连接结果']
	};
	const tls = {
		passed: ['passed', '握手与证书验证通过'],
		certificate: ['failed', '站点证书校验未通过'],
		local_ca: ['failed', '路由器无法读取本机 CA 证书'],
		timeout: ['failed', 'TCP 已连接，TLS 握手超时'],
		failed: ['failed', 'TCP 已连接，TLS 握手失败'],
		unavailable: ['skipped', '未确认握手结果']
	};
	let http = ['skipped', '未进入 HTTPS 响应阶段'];
	if (family.https === 'response') {
		const status = family.http_code;
		const suffix = status >= 500 ? '站点返回服务错误' : status === 405 ? '站点拒绝 HEAD 请求' :
			status >= 400 ? '站点返回请求状态' : status >= 300 ? '站点返回重定向' : '首页返回响应';
		http = [status >= 400 ? 'warning' : 'passed', 'HTTP ' + status + ' · ' + suffix];
	} else if (family.https === 'no_response') {
		http = ['failed', 'TLS 已成功，未取得 HTTP 状态'];
	} else if (family.https === 'tool_missing') {
		http = ['skipped', '需要路由器提供 curl'];
	}
	return [
		['DNS 解析', ...(dns[family.dns] || ['skipped', '未验证'])],
		['TCP 443', ...(tcp[family.tcp] || ['skipped', '等待可用地址']), family.tcp_ms],
		['TLS 握手', ...(tls[family.tls] || ['skipped', '未进入 TLS 阶段']), family.tls_ms],
		['HTTPS 响应', ...http]
	];
}

function websiteSummary(families, reports) {
	const completed = families.filter(item => item.https === 'response');
	const firstFailure = reports.flat().find(step => step[1] === 'failed');
	const failedFamilies = families.filter((_, index) => reports[index].some(step => step[1] === 'failed'));
	if (completed.length && failedFamilies.length) {
		const done = completed.map(item => 'IPv' + item.family).join('、');
		const failed = failedFamilies.map(item => {
			const stage = reports[families.indexOf(item)].find(step => step[1] === 'failed');
			return 'IPv' + item.family + ' ' + stage[0] + '失败';
		}).join('、');
		return done + ' 已返回 HTTPS 响应，' + failed;
	}
	if (completed.length) {
		const rejected = completed.filter(item => item.http_code >= 400);
		if (rejected.length === completed.length) return 'HTTPS 已连接，站点返回 HTTP ' + rejected.map(item => item.http_code).join(' / ');
		if (rejected.length) return '各协议已连接 HTTPS，站点响应状态不同';
		return completed.map(item => 'IPv' + item.family).join('、') + ' 已返回 HTTPS 响应';
	}
	if (firstFailure) return '本轮在 ' + firstFailure[0] + ' 阶段发现问题';
	if (families.some(item => item.dns === 'restricted')) return 'DNS 返回的地址不在公网探测范围';
	return '本轮未取得 HTTPS 响应，请查看两种协议的检测明细';
}

function renderWebsite(report) {
	const families = report.families;
	const reports = families.map(websiteSteps);
	return [
		E('div', { class: 'srd-website-result' }, [
			text('strong', websiteSummary(families, reports)),
			text('p', report.host + ' · 由软路由发起', 'srd-map-meta')
		]),
		E('div', { class: 'srd-website-families' }, families.map((family, index) => E('section', {}, [
			text('h4', 'IPv' + family.family, 'srd-rank-title'),
			family.address ? text('p', family.address + (family.tried_addresses > 1 ?
				' · 共核对 ' + family.tried_addresses + ' 个地址' : ''), 'srd-map-meta') : null,
			E('dl', { class: 'srd-website-steps' }, reports[index].map(([label, state, detail, elapsed]) => E('div', {}, [
				text('dt', label),
				E('dd', {}, [chip(state, detail),
					Number.isFinite(elapsed) ? text('span', elapsed + ' ms', 'srd-map-meta') : null].filter(Boolean))
			])))
		].filter(Boolean))))
	];
}

const lanProfiles = {
	reach: '设备响应',
	smb: 'NAS / SMB 文件共享',
	print: '网络打印 / AirPrint',
	cast: 'AirPlay / Chromecast 投屏'
};
const lanAnnouncements = { '_smb._tcp': 'SMB', '_ipp._tcp': 'IPP', '_ipps._tcp': 'IPPS',
	'_airplay._tcp': 'AirPlay', '_googlecast._tcp': 'Chromecast' };

function privateIPv4(value) {
	const parts = (value || '').split('.');
	if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || +part > 255)) return false;
	const [first, second] = parts.map(Number);
	return first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

function lanSummary(data) {
	const { target, service } = data;
	if (data.relationship === 'cross_network')
		return '当前连接和目标设备位于不同网段';
	if (service.tcp === 'open') return '软路由可以连接目标设备的服务端口';
	if (service.tcp === 'refused') return '目标的 TCP 连接被拒绝';
	if (service.tcp === 'timeout' || service.tcp === 'failed') return '软路由未能连通目标的服务端口';
	if (service.mdns === 'observed') return '软路由看到了目标设备的服务通告';
	if (target.icmp === 'reply') return '目标设备回应了软路由';
	return '本轮未收到目标设备的 Ping 应答';
}

async function terminalWebProbe(context, url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);
	try {
		const response = await context.fetch(url, {
			method: 'HEAD', mode: 'no-cors', credentials: 'omit',
			cache: 'no-store', referrerPolicy: 'no-referrer', targetAddressSpace: 'local', signal: controller.signal
		});
		if (response.type === 'opaque' || response.status >= 100) return 'response';
		return 'unclear';
	} catch {
		if (window.isSecureContext && navigator.permissions?.query) {
			try {
				const permission = await navigator.permissions.query({ name: 'local-network' });
				if (permission.state === 'denied') return 'permission';
			} catch { /* Older browsers may not expose this permission. */ }
		}
		return controller.signal.aborted ? 'timeout' : 'unclear';
	} finally {
		clearTimeout(timer);
	}
}

async function checkTerminalWeb(address, report) {
	if (!privateIPv4(address) || report?.state !== 'checked' || !Array.isArray(report.endpoints)) return [];
	const ports = { http: [80, 5000, 8080], https: [443, 5001, 8443] };
	const endpoints = report.endpoints.filter(item =>
		Object.hasOwn(ports, item.scheme) && ports[item.scheme].includes(item.port) &&
		(item.state === 'response' || item.state === 'certificate'));
	if (!endpoints.length) return [];
	const origins = endpoints.map(item => new URL(item.scheme + '://' + address + ':' + item.port).origin);
	const frame = E('iframe', { hidden: true, title: 'NAS 网页探测', sandbox: 'allow-same-origin' });
	// Cross-origin no-cors requests must use redirect: follow. Enforce the
	// selected NAS origins in an isolated document so redirects cannot leave them.
	frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src ' +
		origins.join(' ') + '">';
	let loadTimer;
	const loaded = new Promise(resolve => {
		frame.addEventListener('load', () => resolve(true), { once: true });
		loadTimer = setTimeout(() => resolve(false), 1500);
	});
	try {
		document.body.appendChild(frame);
		const ready = await loaded;
		return await Promise.all(endpoints.map(async (endpoint, index) => ({
			...endpoint, client: ready ? await terminalWebProbe(frame.contentWindow, origins[index] + '/') : 'unclear'
		})));
	} finally {
		clearTimeout(loadTimer);
		frame.remove();
	}
}

function renderTerminalAccess(data, checks) {
	const { web } = data;
	const answered = checks.some(check => check.client === 'response');
	const comparable = checks.some(check => check.state === 'response');
	const permission = checks.some(check => check.client === 'permission');
	const title = answered ? '本机收到了 NAS 网页的响应' :
		comparable ? '软路由收到 NAS 网页响应，本机未确认' : '本机到 NAS 的路径暂未确认';
	const explanation = answered ?
		'网页响应说明这台手机或电脑能访问 NAS 的网页端口。SMB 445 端口、登录和共享权限仍需单独核对。' :
		permission ? '浏览器的本地网络权限显示为阻止。可在当前 LuCI 的站点设置里核对权限，然后重试。' :
		comparable ? '本机未取得可判断的响应。浏览器策略、证书、Wi-Fi 隔离或网络规则都可能影响探测。' :
		checks.length ? '软路由只确认有 HTTPS 证书校验问题。使用 IP 时，证书可能与地址不匹配，无法据此判断本机是否被隔离。' :
		web?.state === 'checked' ? '常见网页端口没有返回可用的对照结果。NAS 仍可能只提供文件共享，或使用其他端口。' :
		'本轮没有软路由网页探测结果，暂时无法自动对照两侧路径。';
	const clientLabels = {
		response: ['passed', '本机有响应'],
		timeout: ['skipped', '本机等待超时，原因待确认'], unclear: ['skipped', '本机未确认'],
		permission: ['skipped', '本地网络权限显示为阻止']
	};
	return E('section', { class: 'srd-terminal', 'aria-labelledby': 'srd-terminal-title' }, [
		E('h4', { class: 'srd-rank-title', id: 'srd-terminal-title' }, 'NAS 网页连通性对照'),
		E('div', { class: 'srd-website-result' }, [text('strong', title), text('p', explanation, 'srd-map-meta')]),
		checks.length ? E('dl', { class: 'srd-website-steps srd-lan-details' },
			checks.map(check => E('div', {}, [
				text('dt', check.scheme.toUpperCase() + ' ' + check.port),
				E('dd', { class: 'srd-terminal-line' }, [
					text('span', check.state === 'response' ? '软路由 HTTP ' + check.status : '软路由证书校验未通过'),
					chip(...clientLabels[check.client]),
					check.status >= 300 && check.status < 400 && check.client !== 'response' ?
						text('span', '该入口返回跳转。本机仅检查已确认的 NAS 网页端口。', 'srd-map-meta') : ''
				])
			]))) : ''
	]);
}

function smbNameEvidence(name) {
	const source = name.method === 'mdns' ? '同网段 mDNS' : '软路由 DNS';
	const answer = name.addresses?.length ? name.query + ' → ' + name.addresses.join('、') : '';
	const outcomes = {
		matched: [source + ' 指向目标', answer],
		different: [source + ' 指向其他设备地址', answer],
		multiple: [source + ' 返回多个地址', answer],
		not_seen: [name.method === 'mdns' ? '本轮未见该名称的 SMB 通告' : '软路由 DNS 未查到 IPv4 记录', name.query],
		unsupported: ['无法自动核对这个名称', '可填写简单设备名、软路由本地域名或带 .local 的名称。']
	};
	return outcomes[name.state] || ['未能核对名称', name.query];
}

function smbTerminalFinding(ip, byName) {
	if (ip === 'opened' && byName === 'failed')
		return ['按名称访问有问题', '同一共享用 IP 可以打开。请核对设备名、终端的名称解析或 SMB 名称别名设置。'];
	if ((!ip || ip === 'opened') && byName === 'list_missing')
		return ['网络列表的发现有问题', '该共享可以手动打开。请核对终端的网络发现、Wi-Fi 隔离和跨网段发现。'];
	const outcomes = {
		opened: ['用 IP 可以打开共享', '本次在文件管理器里打开了这个共享。可以再用名称试一次。'],
		prompt: ['需要核对登录', '在文件管理器完成登录后，选择实际出现的结果。'],
		auth: ['优先核对账号登录', '文件管理器提示凭据无效。请核对 NAS 账号、账号格式和终端保存的旧凭据。'],
		denied: ['优先核对共享权限', '已经登录，但这个共享被拒绝访问。请核对 NAS 上账号与用户组的共享权限和目录权限。'],
		missing: ['优先核对共享名', '已连接到 NAS，但没有看到预期共享。请核对共享名称、共享是否启用和账号的可见权限。'],
		connect: ['终端的 445 或 SMB 协商待核对', '使用 IP 仍提示连接失败或超时。还需核对终端到 NAS 的网络规则、TCP 445，以及客户端的 SMB 版本和策略。']
	};
	return outcomes[ip] || ['等待终端复核', '浏览器无法读取文件管理器的连接和登录结果。'];
}

function renderSmbAccess(data) {
	const { service, target } = data;
	const protocol = data.smb || {};
	const name = data.name || {};
	const [nameTitle, nameDetail] = smbNameEvidence(name);
	const ports = { open: '软路由 TCP 445 可连接', refused: '软路由 TCP 445 被拒绝',
		timeout: '软路由 TCP 445 连接超时', failed: '软路由 TCP 445 未连上', unavailable: '软路由 TCP 445 未验证' };
	const negotiation = {
		confirmed: '协商结果为 SMB ' + protocol.dialect + (protocol.signing === 'required' ? ' · 服务器要求签名' : ''),
		rejected: '服务端回应但拒绝了 SMB 协商',
		unconfirmed: '端口可连接，暂未确认 SMB 版本',
		unavailable: '此固件未能运行 SMB 协商检查'
	}[protocol.state];
	const ip = E('select', { id: 'srd-smb-ip-result', change: updateFinding }, Object.entries({
		'': '还没试或结果不清楚', opened: '已经打开同一个共享', prompt: '只看到账号输入框',
		auth: '明确提示账号或密码错误', denied: '登录后，共享提示拒绝访问',
		missing: '已连接，找不到预期共享', connect: '连接失败或超时'
	}).map(([value, label]) => E('option', { value }, label)));
	const nameResult = E('select', { id: 'srd-smb-name-result', change: updateFinding }, Object.entries({
		'': '还没试或结果不清楚', failed: '手动输入名称也打不开',
		list_missing: '手输名称能打开，网络列表里找不到'
	}).map(([value, label]) => E('option', { value }, label)));
	const finding = E('div', { class: 'srd-website-result', 'aria-live': 'polite' });
	function updateFinding() {
		const [title, detail] = smbTerminalFinding(ip.value, nameResult.value);
		dom.content(finding, [text('strong', title), text('p', detail, 'srd-map-meta')]);
	}
	updateFinding();

	const rows = [
		['名称与发现', nameTitle, [nameDetail, name.advertised && '目标网段通告 ' + name.advertised].filter(Boolean).join(' · '), '本机名称待核对'],
		['SMB 端口', ports[service.tcp], negotiation, '本机 TCP 445 待核对'],
		['账号与权限', '请在文件管理器核对登录和指定共享的访问结果', '', '待核对']
	];
	return E('section', { class: 'srd-terminal', 'aria-labelledby': 'srd-smb-title' }, [
		E('h4', { class: 'srd-rank-title', id: 'srd-smb-title' }, 'NAS 文件共享'),
		E('dl', { class: 'srd-website-steps srd-lan-details' }, rows.map(([label, value, detail, pending]) =>
			E('div', {}, [text('dt', label), E('dd', {}, [
				E('div', { class: 'srd-terminal-line' }, [text('span', value), chip('skipped', pending)]),
				detail ? text('span', detail, 'srd-map-meta') : ''
			])]))),
		E('details', {}, [
			text('summary', '用 IP 核对并判断故障'),
			E('p', {}, ['在 Windows 文件资源管理器输入 ', text('code', '\\\\' + target.address),
				'，在手机 SMB 客户端或 macOS 输入 ', text('code', 'smb://' + target.address), '。请尝试打开原来失败的共享。']),
			E('div', { class: 'srd-lan-form' }, [
				E('label', {}, ['用 IP 打开时', ip]),
				E('label', {}, ['用名称或网络列表时', nameResult])
			]),
			finding
		])
	]);
}

function renderLanAccess(data, terminal = []) {
	const { source, target, service } = data;
	const endpoint = item => [item.address, item.interface, item.zone && '防火墙区 ' + item.zone, item.subnet]
		.filter(Boolean).join(' · ') || '未取得';
	const relationship = {
		same_link: '同一局域网接口，仍可能受 Wi-Fi 或交换机隔离影响。',
		cross_network: {
			configured: '配置中有此方向的通用跨区转发。具体规则仍可能限制连接，mDNS 跨网段也需要额外配置。',
			no_zone_forwarding: '未找到此方向的通用跨区转发。单独的防火墙规则仍可能放行，mDNS 跨网段也需要额外配置。',
			same_zone: '两个网段在同一防火墙区。请核对区内转发策略和 mDNS 跨网段配置。',
			unknown: '未能确定防火墙区的对应关系。请核对来源网段、目标网段及 mDNS 配置。'
		}[data.forwarding],
		unknown: '未能确认浏览器所属的局域网接口。目标检查仍从软路由发起。'
	}[data.relationship];
	const tcp = { open: '可连接', refused: '被拒绝', timeout: '连接超时', failed: '连接失败', unavailable: '未验证' };
	const announcements = service.announcements.map(item => lanAnnouncements[item]).filter(Boolean);
	const discovery = { observed: '看到 ' + announcements.join('、') + ' mDNS 通告',
		not_seen: '本轮未看到目标的 mDNS 通告',
		incomplete: 'mDNS 检查未完成',
		unavailable: '当前固件的 Avahi 发现工具不可用' };
	const neighbor = { reachable: 'ARP 邻居可达', cached: '发现 ARP 缓存', unseen: '未取得有效 ARP 邻居记录' };
	const rows = [
		['当前连接', endpoint(source)],
		['目标设备', endpoint(target)],
		['设备响应', (target.icmp === 'reply' ? 'Ping 有应答' : 'Ping 无应答') + ' · ' + neighbor[target.neighbor]],
		service.port && service.profile !== 'smb' && ['服务端口', 'TCP ' + service.port + ' ' + tcp[service.tcp]],
		service.profile !== 'smb' && discovery[service.mdns] && ['自动发现', discovery[service.mdns]]
	].filter(Boolean);
	return [
		E('div', { class: 'srd-website-result' }, [
			text('strong', lanSummary(data)),
			text('p', relationship, 'srd-map-meta')
		]),
		E('dl', { class: 'srd-website-steps srd-lan-details' }, rows.map(([label, value]) =>
			E('div', {}, [text('dt', label), text('dd', value)]))),
		text('p', '上方的 Ping、ARP 和服务发现由软路由测得。', 'srd-map-meta'),
		...(service.profile === 'smb' ? [renderSmbAccess(data), renderTerminalAccess(data, terminal)] : [])
	];
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

	load() {
		return topologyWriteAccess('ubus', 'soft-router-doctor', 'editTopology').catch(() => false);
	},

	render(canEditTopology) {
		let report = null;
		let busy = false;
		let accelerating = false;
		let mapping = false;
		let measuringQuality = false;
		let checkingWebsite = false;
		let checkingLan = false;
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
		const recorder = incidentRecorder(L.hasViewPermission());
		poll.add(recorder.refresh, 15);
		recorder.refresh();
		const results = E('div');
		const primary = button('开始体检', () => runScan(false), true);
		const local = button('只查本机', () => runScan(true));
		const exportButton = button('下载报告', () => { if (report) downloadReport(report); });
		const speedButton = button('一键加速', () => runAcceleration());
		const mapButton = button('网络拓扑', () => runTopology());
		const qualityButton = button('卡顿诊断', runQuality);
		const websiteButton = button('网站诊断', openWebsite);
		const lanButton = button('设备互访', openLan);
		lanButton.setAttribute('aria-controls', 'srd-lan-access');
		lanButton.setAttribute('aria-expanded', 'false');
		websiteButton.setAttribute('aria-controls', 'srd-website');
		websiteButton.setAttribute('aria-expanded', 'false');
		qualityButton.setAttribute('aria-controls', 'srd-quality');
		qualityButton.setAttribute('aria-expanded', 'false');
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
		const qualityContent = E('div', { 'aria-live': 'polite' });
		const qualityAgain = button('重新采样', runQuality);
		const qualityPanel = E('section', { class: 'srd-accel', id: 'srd-quality', hidden: true,
			'aria-labelledby': 'srd-quality-title' }, [
			E('div', { class: 'srd-quality-header' }, [
				E('h3', { class: 'srd-section-title', id: 'srd-quality-title' }, '卡顿诊断'),
				E('div', { class: 'srd-quality-actions' }, [qualityAgain, button('收起', () => {
					hideQuality();
					qualityButton.focus();
				})])
			]),
			qualityContent
		]);
		const websiteInput = E('input', { id: 'srd-website-url', type: 'text', inputmode: 'url',
			maxlength: 512, autocomplete: 'off', spellcheck: 'false', placeholder: '例如 https://example.com',
			'aria-describedby': 'srd-website-hint' });
		const websiteSubmit = E('button', { type: 'submit', class: 'srd-primary' }, '开始诊断');
		const websiteContent = E('div', { 'aria-live': 'polite' });
		const websitePanel = E('section', { class: 'srd-accel', id: 'srd-website', hidden: true,
			'aria-labelledby': 'srd-website-title' }, [
			E('div', { class: 'srd-quality-header' }, [
				E('h3', { class: 'srd-section-title', id: 'srd-website-title' }, '网站诊断'),
				button('收起', () => { hideWebsite(); websiteButton.focus(); })
			]),
			E('form', { class: 'srd-website-form', submit: event => { event.preventDefault(); runWebsite(); } }, [
				E('label', { for: 'srd-website-url' }, '网址或域名'),
				E('div', { class: 'srd-website-input' }, [websiteInput, websiteSubmit]),
				E('p', { id: 'srd-website-hint', class: 'srd-map-meta' }, '按域名检测公网 HTTPS 首页，忽略网址中的路径和参数。')
			]),
			websiteContent
		]);
		const lanDevices = E('select', { change: () => {
			lanManual.hidden = Boolean(lanDevices.value);
			dom.content(lanContent, []);
		} }, [E('option', { value: '' }, '手动输入 IPv4 地址')]);
		const lanInput = E('input', { type: 'text', inputmode: 'decimal', maxlength: 15,
			autocomplete: 'off', spellcheck: 'false', placeholder: '例如 192.168.1.50' });
		const lanManual = E('label', {}, ['设备 IPv4 地址', lanInput]);
		const lanProfile = E('select', { change: () => {
			lanNameField.hidden = lanProfile.value !== 'smb';
			dom.content(lanContent, []);
		} },
			Object.entries(lanProfiles).map(([id, label]) => E('option', { value: id }, label)));
		const lanName = E('input', { type: 'text', maxlength: 253, autocomplete: 'off', spellcheck: 'false',
			placeholder: '例如 NAS 或 nas.local' });
		const lanNameField = E('label', { hidden: true }, ['平时使用的设备名（选填）', lanName]);
		const lanSubmit = E('button', { type: 'submit', class: 'srd-primary' }, '检查设备');
		const lanInventory = E('p', { class: 'srd-map-meta', role: 'status' });
		const lanContent = E('div', { 'aria-live': 'polite' });
		const lanPanel = E('section', { class: 'srd-accel', id: 'srd-lan-access', hidden: true,
			'aria-labelledby': 'srd-lan-title' }, [
			E('div', { class: 'srd-quality-header' }, [
				E('h3', { class: 'srd-section-title', id: 'srd-lan-title' }, '设备互访'),
				button('收起', () => { hideLan(); lanButton.focus(); })
			]),
			text('p', '手机找不到电视、打印机或 NAS 时，可以检查目标设备的网段、响应和服务发现。', 'srd-accel-copy'),
			text('p', '排查 NAS 时，在连不上的手机或电脑上打开此页，并选择「NAS / SMB 文件共享」。', 'srd-map-meta'),
			E('form', { class: 'srd-lan-form', submit: event => { event.preventDefault(); runLan(); } }, [
				E('label', {}, ['目标设备', lanDevices]), lanManual, E('label', {}, ['要检查的服务', lanProfile]), lanNameField, lanSubmit
			]),
			lanInventory,
			lanContent
		]);
		let readingLanDevices = false;

		function hideLan() {
			lanPanel.hidden = true;
			lanButton.setAttribute('aria-expanded', 'false');
		}

		async function openLan() {
			if (checkingLan || checkingWebsite || measuringQuality || busy || accelerating || mapping) return;
			lanPanel.hidden = false;
			lanButton.setAttribute('aria-expanded', 'true');
			hideWebsite();
			hideQuality();
			speedPanel.hidden = mapPanel.hidden = true;
			speedButton.setAttribute('aria-expanded', 'false');
			mapButton.setAttribute('aria-expanded', 'false');
			lanDevices.focus();
			if (readingLanDevices) return;
			readingLanDevices = true;
			lanInventory.textContent = '正在读取已知设备…';
			try {
				const [map, saved] = await Promise.all([networkMap('').catch(() => null), savedTopology().catch(() => null)]);
				const devices = new Map();
				for (const segment of map?.segments || [])
					for (const item of segment.clients || [])
						if (privateIPv4(item.address)) devices.set(item.address, item.host);
				for (const item of saved?.nodes || [])
					if (privateIPv4(item.address)) devices.set(item.address, item.name);
				const selected = lanDevices.value;
				const options = [E('option', { value: '' }, '手动输入 IPv4 地址')];
				for (const [address, name] of devices)
					options.push(E('option', { value: address }, name ? name + ' · ' + address : address));
				dom.content(lanDevices, options);
				if (devices.has(selected)) lanDevices.value = selected;
				lanManual.hidden = Boolean(lanDevices.value);
				lanInventory.textContent = devices.size || checkingLan || lanContent.childNodes.length ? '' :
					'暂时没有可选的设备，可手动输入目标地址。';
			} finally {
				readingLanDevices = false;
			}
		}

		async function runLan() {
			if (checkingLan || checkingWebsite || measuringQuality || busy || accelerating || mapping) return;
			const target = lanDevices.value || lanInput.value.trim();
			const valid = privateIPv4(target);
			lanInput.setAttribute('aria-invalid', valid ? 'false' : 'true');
			if (!valid) {
				dom.content(lanContent, text('p', '请输入家庭设备的私有 IPv4 地址。', 'srd-accel-copy'));
				lanInput.focus();
				return;
			}
			checkingLan = true;
			lanInventory.textContent = '';
			dom.content(lanContent, text('p', '正在核对所在网段和所选服务…', 'srd-accel-copy'));
			update();
			try {
				const peer = await readBrowserPeer().catch(() => '');
				const profile = lanProfile.value;
				const data = await diagnoseLan(peer, target, profile, profile === 'smb', profile === 'smb' ? lanName.value.trim() : '');
				if (data?.target?.address !== target || !data.service) {
					dom.content(lanContent, text('p', data?.detail || '本轮未取得检查结果。', 'srd-accel-copy'));
					return;
				}
				if (data.web?.endpoints?.length)
					dom.content(lanContent, text('p', '软路由检查完成，正在从本机浏览器对照 NAS 网页响应…', 'srd-accel-copy'));
				const terminal = await checkTerminalWeb(target, data.web);
				dom.content(lanContent, renderLanAccess(data, terminal));
			} catch {
				dom.content(lanContent, text('p', '暂时无法完成检查，请核对 LuCI 登录状态及拓扑查看权限。', 'srd-accel-copy'));
			} finally {
				checkingLan = false;
				update();
			}
		}

		function hideWebsite() {
			websitePanel.hidden = true;
			websiteButton.setAttribute('aria-expanded', 'false');
		}

		function openWebsite() {
			if (checkingLan || checkingWebsite || measuringQuality || busy || accelerating || mapping) return;
			hideLan();
			websitePanel.hidden = false;
			websiteButton.setAttribute('aria-expanded', 'true');
			hideQuality();
			speedPanel.hidden = mapPanel.hidden = true;
			speedButton.setAttribute('aria-expanded', 'false');
			mapButton.setAttribute('aria-expanded', 'false');
			websiteInput.focus();
		}

		async function runWebsite() {
			if (checkingLan || checkingWebsite || measuringQuality || busy || accelerating || mapping) return;
			const host = websiteHost(websiteInput.value);
			websiteInput.setAttribute('aria-invalid', host ? 'false' : 'true');
			if (!host) {
				dom.content(websiteContent, text('p', '请输入含公网域名的网址，使用默认 HTTP 或 HTTPS 端口。', 'srd-accel-copy'));
				websiteInput.focus();
				return;
			}
			checkingWebsite = true;
			dom.content(websiteContent, text('p', '正在查询 DNS 并分别检测 IPv4 和 IPv6…', 'srd-accel-copy'));
			update();
			try {
				const result = await diagnoseWebsite(host);
				dom.content(websiteContent, Array.isArray(result?.families) && result.families.length ?
					renderWebsite(result) : text('p', result?.detail || '本轮未取得网站诊断结果。', 'srd-accel-copy'));
			} catch {
				dom.content(websiteContent, text('p', '暂时无法完成网站诊断，请检查登录状态后重试。', 'srd-accel-copy'));
			} finally {
				checkingWebsite = false;
				update();
			}
		}

		function hideQuality() {
			qualityPanel.hidden = true;
			qualityButton.setAttribute('aria-expanded', 'false');
		}

		async function runQuality() {
			if (checkingLan || measuringQuality || checkingWebsite || busy || accelerating || mapping) return;
			hideLan();
			hideWebsite();
			measuringQuality = true;
			qualityPanel.hidden = false;
			qualityButton.setAttribute('aria-expanded', 'true');
			speedPanel.hidden = mapPanel.hidden = true;
			speedButton.setAttribute('aria-expanded', 'false');
			mapButton.setAttribute('aria-expanded', 'false');
			dom.content(qualityContent, text('p', '正在采样管理连接、出口流量和公网回包，约需 8 秒。', 'srd-accel-copy'));
			update();
			try {
				const [result, localPath] = await Promise.all([measureQuality(), measureBrowserPath().catch(() => null)]);
				dom.content(qualityContent, Array.isArray(result?.paths) ? renderQuality(result.paths, localPath) :
					text('p', result?.detail || '本轮未取得卡顿诊断结果。', 'srd-accel-copy'));
			} catch {
				dom.content(qualityContent, text('p', '暂时无法完成卡顿诊断，请稍后复测。', 'srd-accel-copy'));
			} finally {
				measuringQuality = false;
				update();
			}
		}

		const saved = savedNetworkDiagram(canEditTopology === true);
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
			saved.root,
			mapContent,
			E('section', { 'class': 'srd-path-evidence' }, [
				text('h4', '自动发现记录', 'srd-rank-title'),
				E('div', { 'class': 'srd-path-actions' }, [discoverButton, pathStatus]),
				pathEvidence
			])
		]);

		poll.add(() => {
			if (!mapPanel.hidden && saved.hasNodes()) return saved.refresh();
		}, 25);

		function updateTopology(map, health, checking = false) {
			latestMap = map;
			const expanded = new Set([...mapContent.querySelectorAll('details[open]')].map(item => item.dataset.segment));
			dom.content(mapContent, renderNetworkMap(map, health, checking, expanded));
			dom.content(pathEvidence, renderPathEvidence(latestMap, discovery));
		}

		async function runTopology() {
			if (busy || accelerating || mapping || measuringQuality || checkingWebsite || checkingLan) return;
			hideLan();
			hideWebsite();
			mapping = true;
			hideQuality();
			discovery = null;
			mapPanel.hidden = false;
			saved.refresh();
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
					saved.refresh();
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
			if (busy || accelerating || mapping || measuringQuality || checkingWebsite || checkingLan) return;
			hideLan();
			hideWebsite();
			hideQuality();
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
			primary.disabled = local.disabled = speedButton.disabled = mapButton.disabled =
				qualityButton.disabled = qualityAgain.disabled = websiteButton.disabled = websiteSubmit.disabled =
					lanButton.disabled = lanSubmit.disabled =
					busy || accelerating || mapping || measuringQuality || checkingWebsite || checkingLan;
			lanDevices.disabled = lanInput.disabled = lanProfile.disabled = lanName.disabled = checkingLan;
			websiteInput.disabled = checkingWebsite;
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
				const fix = !busy && !accelerating && !mapping && !checkingLan && report.can_start_dnsmasq && L.hasViewPermission() ? showConfirmation : null;
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
			if (busy || accelerating || mapping || measuringQuality || checkingWebsite || checkingLan) return;
			hideLan();
			hideWebsite();
			hideQuality();
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
			if (busy || accelerating || mapping || measuringQuality || checkingLan) return;
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
			if (busy || accelerating || mapping || measuringQuality || checkingLan) return;
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
					E('div', { 'class': 'srd-actions' }, [ primary, local, mapButton, lanButton, qualityButton, websiteButton, speedButton, exportButton ]),
					meta
				]),
				dial
			]),
			steps, live, notice, lanPanel, websitePanel, qualityPanel, recorder.card, mapPanel, speedPanel, results
		]);
	}
});
