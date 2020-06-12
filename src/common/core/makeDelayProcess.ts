import makeDelayProcessRaw, {
	DelayMillisecFunction,
	CancelDelayMillisecFunction,
} from './makeDelayProcessRaw';

/**
 * @param callback A callback function called when the time has passed
 * @return `[<delayProcessFn>, <cancelDelayProcess>]`
 */
export default function makeDelayProcess(
	callback: () => void
): [DelayMillisecFunction, CancelDelayMillisecFunction] {
	return makeDelayProcessRaw(callback, setTimeout, clearTimeout);
}
