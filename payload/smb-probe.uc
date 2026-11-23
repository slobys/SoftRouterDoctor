'use strict';

// MS-SMB2 2.1 and 2.2.3. Send one Direct TCP NEGOTIATE and close.
// The probe never starts a session or accesses a share.
const socket = require('socket');
const fs = require('fs');
const zeros = (count) => substr('\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 0, count);
const le16 = (value) => chr(value & 255, value >> 8);
const read16 = (bytes, offset) => ord(bytes, offset) | (ord(bytes, offset + 1) << 8);
const versions = { '514': '2.0.2', '528': '2.1', '768': '3.0', '770': '3.0.2', '785': '3.1.1' };

function readExactly(peer, amount) {
	let bytes = '';
	while (length(bytes) < amount) {
		const chunk = peer.recv(amount - length(bytes));
		if (!length(chunk))
			return null;
		bytes += chunk;
	}
	return bytes;
}

function request(guid, salt) {
	const empty16 = zeros(16);
	const header = '\xfeSMB' + le16(64) + zeros(8) + le16(1) + empty16 + empty16 + empty16;
	const offered = le16(0x0202) + le16(0x0210) + le16(0x0300) + le16(0x0302) + le16(0x0311);
	const preauthOffset = chr(112, 0, 0, 0);
	const body = le16(36) + le16(5) + le16(1) + zeros(6) + guid + preauthOffset + le16(1) + zeros(2);
	const preauth = le16(1) + le16(38) + zeros(4) + le16(1) + le16(32) + le16(1) + salt;
	const message = header + body + offered + zeros(2) + preauth;
	return chr(0, 0, 0, length(message)) + message;
}

function probe(peer) {
	const random = fs.open('/dev/urandom');
	if (!random) return 'unavailable';
	const bytes = random.read(48);
	random.close();
	if (length(bytes) !== 48) return 'unavailable';
	const guid = substr(bytes, 0, 7) + chr((ord(bytes, 7) & 15) | 64, (ord(bytes, 8) & 63) | 128) + substr(bytes, 9, 7);
	const packet = request(guid, substr(bytes, 16));
	if (peer.send(packet) !== length(packet)) return 'unconfirmed';
	const prefix = readExactly(peer, 4);
	if (!prefix || ord(prefix, 0) !== 0) return 'unconfirmed';
	const size = (ord(prefix, 1) << 16) | (ord(prefix, 2) << 8) | ord(prefix, 3);
	if (size < 64 || size > 4096) return 'unconfirmed';
	const reply = readExactly(peer, size);
	if (!reply || substr(reply, 0, 4) !== '\xfeSMB' || read16(reply, 4) !== 64 ||
		read16(reply, 12) !== 0 || !(ord(reply, 16) & 1) || substr(reply, 24, 8) !== zeros(8))
		return 'unconfirmed';
	if (substr(reply, 8, 4) !== zeros(4)) return 'rejected';
	if (size < 128 || read16(reply, 64) !== 65) return 'unconfirmed';
	const version = versions[read16(reply, 68)];
	const signing = (read16(reply, 66) & 2) ? 'required' : 'optional';
	return version ? 'confirmed ' + version + ' ' + signing : 'unconfirmed';
}

const peer = socket.create(socket.AF_INET, socket.SOCK_STREAM, 0);
if (!peer || !peer.setopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, ARGV[1])) {
	print('unavailable');
	exit(0);
}
print(peer.connect(ARGV[0], 445) ? probe(peer) : 'unconfirmed');
peer.close();
