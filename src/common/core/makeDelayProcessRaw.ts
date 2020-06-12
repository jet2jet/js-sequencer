export type DelayMillisecFunction =
	/**
	 * @param delayMillisec delay time in millisec
	 */
	(delayMillisec: number) => void;
export type CancelDelayMillisecFunction = () => void;

/**
 * @param callback A callback function called when the time has passed
 * @return `[<delayProcessFn>, <cancelDelayProcess>]`
 */
export default function makeDelayProcessRaw<T>(
	callback: () => void,
	fnSetTimeout: T extends null
		? never
		: (fn: () => void, millisec: number) => T,
	fnClearTimeout: (timerId: T) => void
): [DelayMillisecFunction, CancelDelayMillisecFunction] {
	let _timerId: T | null = null;

	return [
		function delayProcess(delayMillisec) {
			if (_timerId !== null) {
				return;
			}
			_timerId = fnSetTimeout(() => {
				_timerId = null;
				callback();
			}, delayMillisec);
		},
		function cancelDelayProcess() {
			if (_timerId !== null) {
				fnClearTimeout(_timerId);
				_timerId = null;
			}
		},
	];
}
