import type { Memory } from './memory.js';

export interface CallFrame {
	local: Int16Array;
	pc: number;
	ds: number[];
	/** v5+: true for call_vn/call_vn2/call_1n/call_2n — return value is dropped, not stored. */
	discardResult: boolean;
	/** Number of arguments actually passed to this routine (for v5 check_arg_count). */
	argCount: number;
}

/**
 * Verify the story file checksum against the header-declared value.
 * The stored file length is scaled by version: v1-3 → bytes/2, v4-5 → bytes/4, v6-8 → bytes/8.
 */
export function verify(memInit: Uint8Array, mem: Memory): boolean {
	const version = memInit[0]!;
	const lengthScale = version <= 3 ? 2 : version <= 5 ? 4 : 8;
	const plenth = mem.getu(26);
	let pchksm = mem.getu(28);
	let i = 64;
	while (i < plenth * lengthScale) pchksm = (pchksm - memInit[i++]!) & 65535;
	return !pchksm;
}

// Per-frame fixed header: pc(4) + localByte(1) + dsLen(1–2 via Uint16 at +4) + argCount(1).
// Total 7 bytes before variable-length ds and locals.
const FRAME_HEADER_BYTES = 7;

export function serialize(mem: Memory, ds: number[], cs: CallFrame[], pc: number): Uint8Array {
	const purbot = mem.getu(14);
	const total =
		purbot +
		cs.reduce((p, c) => p + 2 * (c.ds.length + c.local.length) + FRAME_HEADER_BYTES, 0) +
		2 * ds.length +
		8;
	const ar = new Uint8Array(total);
	ar.set(new Uint8Array(mem.bytes.buffer, 0, purbot));
	const vi = new DataView(ar.buffer);
	let e = purbot;
	vi.setUint32(e, pc);
	vi.setUint16(e + 4, cs.length);
	vi.setUint16(e + 6, ds.length);
	for (let i = 0; i < ds.length; i++) vi.setInt16(e + i * 2 + 8, ds[i]!);
	e += ds.length * 2 + 8;
	for (let i = 0; i < cs.length; i++) {
		const f = cs[i]!;
		vi.setUint32(e, f.pc);
		// `localByte` reuses the high byte of the pc word: low 4 bits = local count
		// (max 15), bit 7 = discardResult flag.
		vi.setUint8(e, f.local.length | (f.discardResult ? 0x80 : 0));
		vi.setUint16(e + 4, f.ds.length);
		vi.setUint8(e + 6, f.argCount & 0xff);
		for (let j = 0; j < f.ds.length; j++) vi.setInt16(e + j * 2 + FRAME_HEADER_BYTES, f.ds[j]!);
		for (let j = 0; j < f.local.length; j++)
			vi.setInt16(e + f.ds.length * 2 + j * 2 + FRAME_HEADER_BYTES, f.local[j]!);
		e += (f.ds.length + f.local.length) * 2 + FRAME_HEADER_BYTES;
	}
	return ar;
}

export function deserialize(mem: Memory, ar: Uint8Array): [number[], CallFrame[], number] | null {
	try {
		const vi = new DataView(ar.buffer);
		let e = mem.getu(14);
		if (ar[2] !== mem.bytes[2] || ar[3] !== mem.bytes[3]) return null; // ZORKID mismatch
		const g16s = () => ((e += 2), vi.getInt16(e - 2));
		const g16 = () => ((e += 2), vi.getUint16(e - 2));
		const g24 = () => ((e += 3), vi.getUint32(e - 4) & 0xffffff);
		const g32 = () => ((e += 4), vi.getUint32(e - 4));
		const g8 = () => ar[e++]!;
		const pc = g32();
		const cs: CallFrame[] = Array.from({ length: g16() });
		const ds: number[] = Array.from({ length: g16() }, g16s);
		for (let i = 0; i < cs.length; i++) {
			const localByte = g8();
			const local = new Int16Array(localByte & 0x7f);
			const discardResult = !!(localByte & 0x80);
			const framePc = g24();
			const dsFrame = Array.from({ length: g16() }, g16s);
			const argCount = g8();
			for (let j = 0; j < local.length; j++) local[j] = g16s();
			cs[i] = { local, pc: framePc, ds: dsFrame, discardResult, argCount };
		}
		const purbot = mem.getu(14);
		mem.bytes.set(new Uint8Array(ar.buffer, 0, purbot));
		return [ds, cs, pc];
	} catch {
		return null;
	}
}
