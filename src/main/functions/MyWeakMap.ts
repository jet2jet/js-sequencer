declare global {
	interface WeakMap<K extends object, V> {
		delete(key: K): boolean;
		get(key: K): V | undefined;
		has(key: K): boolean;
		set(key: K, value: V): this;
	}

	interface WeakMapConstructor {
		readonly prototype: WeakMap<object, any>;
		new (): WeakMap<object, any>;
		new <K extends object, V>(entries?: Array<[K, V]>): WeakMap<K, V>;
	}
	// eslint-disable-next-line no-var
	var WeakMap: WeakMapConstructor;
}

type MyWeakMapBase<K extends object, V> = WeakMap<K, V>;

interface MyPolyfillWeakMap {
	_hash: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export default interface MyWeakMap<_K extends object, _V> {}

const _isWeakMapSupported = typeof WeakMap !== typeof void 0;

let _myWeakMapId = 0;

function isMyWeakMap(map: any): map is MyPolyfillWeakMap {
	return !!map._hash;
}

function throwIfKeyIsNull(key: any) {
	if (key == null) {
		throw new TypeError(key + ' is not a non-null object');
	}
}

export function createWeakMap<K extends object, V>(): MyWeakMap<K, V> {
	if (_isWeakMapSupported) {
		return new WeakMap<K, V>();
	}
	const o: MyPolyfillWeakMap = {
		_hash:
			'_my_weakmap_' +
			(++_myWeakMapId).toString() +
			'_' +
			Math.floor(Math.random() * 0x7fffffff)
				.toString(16)
				.toLowerCase(),
	};
	return o;
}

export function setWeakMap<K extends object, V>(
	map: MyWeakMap<K, V>,
	key: K,
	value: V
): MyWeakMap<K, V> {
	if (_isWeakMapSupported) {
		return (map as MyWeakMapBase<K, V>).set(key, value);
	}
	if (!isMyWeakMap(map)) throw new TypeError('map is not a weak map');
	throwIfKeyIsNull(key);

	(key as any)[map._hash] = value;
	return map;
}

export function getWeakMap<K extends object, V>(
	map: MyWeakMap<K, V>,
	key: K
): V | undefined {
	if (_isWeakMapSupported) {
		return (map as MyWeakMapBase<K, V>).get(key);
	}
	if (!isMyWeakMap(map)) throw new TypeError('map is not a weak map');
	throwIfKeyIsNull(key);

	return (key as any)[map._hash];
}

export function hasWeakMapKey<K extends object, V>(
	map: MyWeakMap<K, V>,
	key: K
): boolean {
	if (_isWeakMapSupported) {
		return (map as MyWeakMapBase<K, V>).has(key);
	}
	if (!isMyWeakMap(map)) throw new TypeError('map is not a weak map');
	throwIfKeyIsNull(key);

	if (Object.prototype.hasOwnProperty)
		return Object.prototype.hasOwnProperty.call(key, map._hash);
	for (const k in key as any) {
		if (k === map._hash) return true;
	}
	return false;
}

export function deleteWeakMapKey<K extends object, V>(
	map: MyWeakMap<K, V>,
	key: K
): boolean {
	if (_isWeakMapSupported) {
		return (map as MyWeakMapBase<K, V>).delete(key);
	}
	if (!isMyWeakMap(map)) throw new TypeError('map is not a weak map');
	throwIfKeyIsNull(key);

	return hasWeakMapKey(map, key) && delete (key as any)[map._hash];
}
