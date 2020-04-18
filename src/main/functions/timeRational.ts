import { TimeRationalValue } from '../types';

function gcd(m: number, n: number) {
	if (m < n) {
		const x = m;
		m = n;
		n = x;
	}
	while (n) {
		const r = m % n;
		m = n;
		n = r;
	}
	return m;
}

export function clone(val: Readonly<TimeRationalValue>): TimeRationalValue {
	return { num: val.num, den: val.den };
}

export function add(
	a: TimeRationalValue,
	b: Readonly<TimeRationalValue>
): TimeRationalValue {
	if (!b.num) {
		return a;
	}
	const g = gcd(a.den, b.den);
	return {
		num: (a.num * b.den + b.num * a.den) / g,
		den: (a.den * b.den) / g,
	};
}

export function sub(
	a: TimeRationalValue,
	b: Readonly<TimeRationalValue>
): TimeRationalValue {
	if (!b.num) {
		return a;
	}
	const g = gcd(a.den, b.den);
	return {
		num: (a.num * b.den - b.num * a.den) / g,
		den: (a.den * b.den) / g,
	};
}

export function mul(
	a: TimeRationalValue,
	b: Readonly<TimeRationalValue>
): TimeRationalValue {
	return normalize({
		num: a.num * b.num,
		den: a.den * b.den,
	});
}

export function div(
	a: TimeRationalValue,
	b: Readonly<TimeRationalValue>
): TimeRationalValue {
	return normalize({
		num: a.num * b.den,
		den: a.den * b.num,
	});
}

export function compare(
	a: Readonly<TimeRationalValue>,
	b: Readonly<TimeRationalValue>
): number {
	return a.num * b.den - b.num * a.den;
}

export function normalize(val: TimeRationalValue): TimeRationalValue {
	if (val.den < 0) {
		val.num = -val.num;
		val.den = -val.den;
	}
	if (!val.num) {
		val.num = 0;
		val.den = 1;
	} else if (val.num === val.den) {
		val.num = val.den = 1;
	} else {
		const g = gcd(val.num, val.den);
		val.num /= g;
		val.den /= g;
	}
	return val;
}

export function fromNumber(val: number): TimeRationalValue {
	val = Number(val);
	if (isNaN(val) || !isFinite(val)) {
		throw new Error('Unexpected value');
	}
	let s = val.toString();
	const i = s.indexOf('.');
	const e = s.indexOf('e');
	let eVal = 0;
	if (e >= 0) {
		eVal = Number(s.substring(e + 1));
		s = s.substring(0, e);
	}

	let r: TimeRationalValue;
	if (i < 0) {
		r = { num: val, den: 1 };
	} else {
		const denominatorDigits = s.length - i;
		r = {
			num: Number(s.substring(0, i) + s.substring(i + 1)),
			den: Math.pow(10, denominatorDigits),
		};
	}
	if (eVal > 0) {
		r.num *= Math.pow(10, eVal);
	} else if (eVal < 0) {
		r.den *= Math.pow(10, -eVal);
	}
	return r;
}
