# Match only the requested name or per-run marker. Correlate replies by
# transport, resolver, client port and transaction identifier in memory.
function address(endpoint) {
	sub(/\.[0-9]+:?$/, "", endpoint)
	return endpoint
}
function port(endpoint) {
	sub(/:$/, "", endpoint)
	sub(/^.*\./, "", endpoint)
	return endpoint
}
function tx(field) {
	sub(/[^0-9].*$/, "", field)
	return field
}
/^(tcpdump: )?listening on / {
	print "ready" > ready
	close(ready)
	next
}
$3 ~ /^(In|Out)$/ && $4 ~ /^IP6?$/ && $6==">" {
	src=address($5); dst=address($7); sport=port($5); dport=port($7)
	transport=$8=="Flags" ? "tcp" : "udp"
	pos=8
	if (transport=="tcp") {
		for (pos=8; pos<=NF && $pos!="length"; pos++) {}
		pos+=2
	}
	transaction=tx($pos)
	if (transaction=="") next
	if (dport==53) {
		sample=""; querytype=""
		for (i=pos+1; i<NF; i++) if ($i ~ /^[A-Z0-9]+\?$/) {
			query=tolower($(i+1)); sub(/\.$/,"",query)
			if (query==host) sample="name"
			else if (query==canary) sample="canary"
			querytype=$i; sub(/\?$/,"",querytype)
			break
		}
		if (sample=="" || sport !~ /^[0-9]+$/) next
		key=transport SUBSEP dst SUBSEP src SUBSEP sport SUBSEP transaction
		kind[key]=sample; resolver[key]=dst; proto[key]=transport; qtype[key]=querytype
		next
	}
	if (sport!=53) next
	key=transport SUBSEP src SUBSEP dst SUBSEP dport SUBSEP transaction
	if (!(key in kind)) next
	for (i=pos+1; i<=NF; i++) {
		if ($i=="NXDomain") {status[key]="nxdomain"; break}
		if ($i~/^(ServFail|Refused|FormErr|NotImp)$/) {status[key]="error"; break}
		if ($i ~ /^[0-9]+\/[0-9]+\/[0-9]+$/) {
			status[key]=($i ~ /^0\// ? "no_records" : "answered")
			break
		}
	}
	if ($3=="In" && $2 ~ /^[A-Za-z0-9_.:@-]+$/) replyvia[key]=$2
}
END {
	for (key in kind)
		print kind[key] "|" qtype[key] "|" proto[key] "|" resolver[key] "|" \
			(status[key] ? status[key] : "query_only") "|" replyvia[key]
}
