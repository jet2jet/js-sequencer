export function isObject(o: unknown): o is object {
	return typeof o === 'object' && o != null;
}

function _funcForTypeofType() {
	return typeof {};
}

type TypeofType = ReturnType<typeof _funcForTypeofType>;

interface TypeofTypeMap {
	number: number;
	string: string;
	boolean: boolean;
	bigint: bigint;
	object: object | null;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	function: Function;
	symbol: symbol;
	undefined: undefined;
}

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

type AnyConstructor<T extends object = object> = { new (...args: any[]): T };

type DefinitionType = TypeofType | AnyConstructor;

interface SimpleObjectDefinition {
	[key: string]: DefinitionType | [DefinitionType];
}

type DefinitionTypeToType<T extends DefinitionType | [DefinitionType]> =
	T extends TypeofType
		? TypeofTypeMap[T]
		: T extends AnyConstructor<infer O>
			? O
			: T extends [infer U extends DefinitionType]
				? DefinitionTypeToType<U> | undefined
				: never;

type ExtractOptionalsImpl<
	D extends SimpleObjectDefinition,
	K extends keyof D,
> = K extends keyof D ? (D[K] extends [any] ? K : never) : never;
type ExtractOptionals<D extends SimpleObjectDefinition> = ExtractOptionalsImpl<
	D,
	keyof D
>;
type SimpleObjectDefinitionToObjectType<D extends SimpleObjectDefinition> = {
	[P in Exclude<keyof D, ExtractOptionals<D>>]: DefinitionTypeToType<D[P]>;
} & {
	[P in ExtractOptionals<D>]?: DefinitionTypeToType<D[P]>;
};

export function isObjectWithFields<D extends SimpleObjectDefinition>(
	o: unknown,
	definition: D
): o is Simplify<SimpleObjectDefinitionToObjectType<D>> {
	if (!isObject(o)) {
		return false;
	}
	for (const key in definition) {
		if (!(key in o)) {
			return false;
		}
		const d = definition[key as keyof D];
		if (typeof d === 'string') {
			// eslint-disable-next-line valid-typeof
			if (typeof (o as Record<string, unknown>)[key] !== d) {
				return false;
			}
		} else if (typeof d === 'function') {
			if (!(o instanceof d)) {
				return false;
			}
		} else {
			return false;
		}
	}
	return true;
}
