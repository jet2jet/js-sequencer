export default interface ITimer<T = unknown> {
	set(cb: () => void, millisec: number): T;
	clear(t: T): void;
}
