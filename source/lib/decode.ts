// Tiny structural decoder. Each combinator takes an unknown plus a
// path string (for error messages) and returns the narrowed type or
// throws DecodeError with the path included. Callers build schemas by
// composing combinators; failures are loud by default. Use
// dArrayLenient when you want per-entry tolerance with visibility.
export class DecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecodeError';
	}
}

export type Decoder<T> = (value: unknown, path: string) => T;

function typeName(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v;
}

export const dString: Decoder<string> = (v, p) => {
	if (typeof v !== 'string') {
		throw new DecodeError(`${p}: expected string, got ${typeName(v)}`);
	}
	return v;
};

export const dBoolean: Decoder<boolean> = (v, p) => {
	if (typeof v !== 'boolean') {
		throw new DecodeError(`${p}: expected boolean, got ${typeName(v)}`);
	}
	return v;
};

export const dNumber: Decoder<number> = (v, p) => {
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		throw new DecodeError(`${p}: expected number, got ${typeName(v)}`);
	}
	return v;
};

// Treat null AND undefined (i.e. missing key) as null, otherwise apply
// inner. Lets schemas declare "field is required but may be null" and
// also tolerate the field being absent — JSON.stringify drops undefined.
export function dNullable<T>(inner: Decoder<T>): Decoder<T | null> {
	return (v, p) => (v === null || v === undefined ? null : inner(v, p));
}

export function dEnum<T extends string>(...values: readonly T[]): Decoder<T> {
	const set = new Set<string>(values);
	return (v, p) => {
		if (typeof v !== 'string' || !set.has(v)) {
			throw new DecodeError(
				`${p}: expected one of ${values.join(', ')}, got ${JSON.stringify(v)}`,
			);
		}
		return v as T;
	};
}

export function dArray<T>(inner: Decoder<T>): Decoder<T[]> {
	return (v, p) => {
		if (!Array.isArray(v)) {
			throw new DecodeError(`${p}: expected array, got ${typeName(v)}`);
		}
		return v.map((entry, i) => inner(entry, `${p}[${i}]`));
	};
}

// Like dArray, but per-entry decode failures are reported via onDrop
// and the entry is skipped. Use when one bad LLM-emitted entry should
// not invalidate an otherwise-valid response. Non-DecodeError throws
// still propagate.
export function dArrayLenient<T>(
	inner: Decoder<T>,
	onDrop: (path: string, error: DecodeError) => void,
): Decoder<T[]> {
	return (v, p) => {
		if (!Array.isArray(v)) {
			throw new DecodeError(`${p}: expected array, got ${typeName(v)}`);
		}
		const out: T[] = [];
		v.forEach((entry, i) => {
			const path = `${p}[${i}]`;
			try {
				out.push(inner(entry, path));
			} catch (err) {
				if (err instanceof DecodeError) {
					onDrop(path, err);
					return;
				}
				throw err;
			}
		});
		return out;
	};
}

type ObjectShape<T> = {[K in keyof T]: Decoder<T[K]>};

export function dObject<T extends Record<string, unknown>>(
	shape: ObjectShape<T>,
): Decoder<T> {
	return (v, p) => {
		if (typeof v !== 'object' || v === null || Array.isArray(v)) {
			throw new DecodeError(`${p}: expected object, got ${typeName(v)}`);
		}
		const obj = v as Record<string, unknown>;
		const out = {} as T;
		for (const key of Object.keys(shape) as Array<keyof T>) {
			const decoder = shape[key];
			out[key] = decoder(obj[key as string], `${p}.${String(key)}`);
		}
		return out;
	};
}

// Top-level entry point. Provided so call sites read consistently:
//   const result = decode(dShape, raw, 'agent-response');
export function decode<T>(
	decoder: Decoder<T>,
	value: unknown,
	label: string,
): T {
	return decoder(value, label);
}
