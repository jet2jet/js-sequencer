export default abstract class EventObjectBase {
	private _preventDefault = false;
	private _stopPropagation = false;

	/**
	 * Prevent the default action for this event.
	 * For status-update events, this method affects nothing.
	 */
	public preventDefault(): void {
		this._preventDefault = true;
	}
	/**
	 * Stop calling all following event handlers.
	 */
	public stopPropagation(): void {
		this._stopPropagation = true;
	}
	public isDefaultPrevented(): boolean {
		return this._preventDefault;
	}
	public isPropagationStopped(): boolean {
		return this._stopPropagation;
	}
}
