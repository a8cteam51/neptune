import test from 'ava';
import {Buffer} from 'node:buffer';
import {
	parseInstanceSize,
	readPngSize,
} from '../../source/commands/verify-screenshots.js';

test('parseInstanceSize: extracts width/height from first <instance>', t => {
	t.deepEqual(
		parseInstanceSize('<instance id="1" width="1440" height="900" />'),
		{width: 1440, height: 900},
	);
});

test('parseInstanceSize: handles attributes in any order', t => {
	t.deepEqual(
		parseInstanceSize(
			'<instance height="900" name="Frame" width="1440" id="1" />',
		),
		{width: 1440, height: 900},
	);
});

test('parseInstanceSize: returns null when tag is missing', t => {
	t.is(parseInstanceSize('<frame width="100" height="100" />'), null);
});

test('parseInstanceSize: returns null when one attr is missing', t => {
	t.is(
		parseInstanceSize('<instance id="1" width="1440" />'),
		null,
	);
});

test('parseInstanceSize: rejects non-numeric values', t => {
	t.is(
		parseInstanceSize('<instance width="abc" height="100" />'),
		null,
	);
});

test('parseInstanceSize: matches the FIRST <instance> only', t => {
	const xml =
		'<instance width="100" height="200" /><instance width="999" height="999" />';
	t.deepEqual(parseInstanceSize(xml), {width: 100, height: 200});
});

test('readPngSize: parses IHDR width/height', t => {
	const png = Buffer.alloc(33);
	png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
	png.writeUInt32BE(13, 8); // IHDR length
	png.write('IHDR', 12, 'ascii');
	png.writeUInt32BE(1440, 16);
	png.writeUInt32BE(900, 20);
	t.deepEqual(readPngSize(png), {width: 1440, height: 900});
});

test('readPngSize: returns null on too-small buffer', t => {
	t.is(readPngSize(Buffer.alloc(10)), null);
});

test('readPngSize: returns null on missing PNG signature', t => {
	const buf = Buffer.alloc(33);
	buf.write('IHDR', 12, 'ascii');
	t.is(readPngSize(buf), null);
});

test('readPngSize: returns null when IHDR chunk is missing', t => {
	const png = Buffer.alloc(33);
	png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
	png.write('NOPE', 12, 'ascii');
	t.is(readPngSize(png), null);
});
