
interface EventListenerOptions {
	capture?: boolean;
}

interface AddEventListenerOptions extends EventListenerOptions {
	once?: boolean;
	passive?: boolean;
}

interface EventListener {
	(evt: Event): void;
}

interface EventListenerObject {
	handleEvent(evt: Event): void;
}

interface EventInit {
	bubbles?: boolean;
	cancelable?: boolean;
	composed?: boolean;
}

interface Event {
	/**
	 * Returns true or false depending on how event was initialized. True if event goes through its target's ancestors in reverse tree order, and false otherwise.
	 */
	readonly bubbles: boolean;
	cancelBubble: boolean;
	readonly cancelable: boolean;
	/**
	 * Returns true or false depending on how event was initialized. True if event invokes listeners past a ShadowRoot node that is the root of its target, and false otherwise.
	 */
	readonly composed: boolean;
	/**
	 * Returns the object whose event listener's callback is currently being
	 * invoked.
	 */
	readonly currentTarget: EventTarget | null;
	readonly defaultPrevented: boolean;
	readonly eventPhase: number;
	/**
	 * Returns true if event was dispatched by the user agent, and
	 * false otherwise.
	 */
	readonly isTrusted: boolean;
	returnValue: boolean;
	/**
	 * Returns the object to which event is dispatched (its target).
	 */
	readonly target: EventTarget | null;
	/**
	 * Returns the event's timestamp as the number of milliseconds measured relative to
	 * the time origin.
	 */
	readonly timeStamp: number;
	/**
	 * Returns the type of event, e.g.
	 * "click", "hashchange", or
	 * "submit".
	 */
	readonly type: string;
	composedPath(): EventTarget[];
	initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
	preventDefault(): void;
	/**
	 * Invoking this method prevents event from reaching
	 * any registered event listeners after the current one finishes running and, when dispatched in a tree, also prevents event from reaching any
	 * other objects.
	 */
	stopImmediatePropagation(): void;
	/**
	 * When dispatched in a tree, invoking this method prevents event from reaching any objects other than the current object.
	 */
	stopPropagation(): void;
	readonly AT_TARGET: number;
	readonly BUBBLING_PHASE: number;
	readonly CAPTURING_PHASE: number;
	readonly NONE: number;
}

declare var Event: {
	prototype: Event;
	new(type: string, eventInitDict?: EventInit): Event;
	readonly AT_TARGET: number;
	readonly BUBBLING_PHASE: number;
	readonly CAPTURING_PHASE: number;
	readonly NONE: number;
};


interface EventTarget {
	/**
	 * Appends an event listener for events whose type attribute value is type. The callback argument sets the callback that will be invoked when the event is dispatched.
	 * The options argument sets listener-specific options. For compatibility this can be a
	 * boolean, in which case the method behaves exactly as if the value was specified as options's capture.
	 * When set to true, options's capture prevents callback from being invoked when the event's eventPhase attribute value is BUBBLING_PHASE. When false (or not present), callback will not be invoked when event's eventPhase attribute value is CAPTURING_PHASE. Either way, callback will be invoked if event's eventPhase attribute value is AT_TARGET.
	 * When set to true, options's passive indicates that the callback will not cancel the event by invoking preventDefault(). This is used to enable performance optimizations described in §2.8 Observing event listeners.
	 * When set to true, options's once indicates that the callback will only be invoked once after which the event listener will
	 * be removed.
	 * The event listener is appended to target's event listener list and is not appended if it has the same type, callback, and capture.
	 */
	addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
	/**
	 * Dispatches a synthetic event event to target and returns true
	 * if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise.
	 */
	dispatchEvent(event: Event): boolean;
	/**
	 * Removes the event listener in target's event listener list with the same type, callback, and options.
	 */
	removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
}

declare var EventTarget: {
	prototype: EventTarget;
	new(): EventTarget;
};

declare type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

interface MessageChannel {
	readonly port1: MessagePort;
	readonly port2: MessagePort;
}

declare var MessageChannel: {
	prototype: MessageChannel;
	new(): MessageChannel;
};

interface MessageEventInit extends EventInit {
	data?: any;
	lastEventId?: string;
	origin?: string;
	ports?: MessagePort[];
	source?: MessageEventSource | null;
}

interface MessageEvent extends Event {
    /**
     * Returns the data of the message.
     */
	readonly data: any;
    /**
     * Returns the last event ID string, for
     * server-sent events.
     */
	readonly lastEventId: string;
    /**
     * Returns the origin of the message, for server-sent events and
     * cross-document messaging.
     */
	readonly origin: string;
    /**
     * Returns the MessagePort array sent with the message, for cross-document
     * messaging and channel messaging.
     */
	readonly ports: ReadonlyArray<MessagePort>;
    /**
     * Returns the WindowProxy of the source window, for cross-document
     * messaging, and the MessagePort being attached, in the connect event fired at
     * SharedWorkerGlobalScope objects.
     */
	readonly source: MessageEventSource | null;
}

declare var MessageEvent: {
	prototype: MessageEvent;
	new(type: string, eventInitDict?: MessageEventInit): MessageEvent;
};

declare type MessageEventSource = MessagePort;
declare type Transferable = ArrayBuffer | MessagePort;

interface MessagePortEventMap {
	'message': MessageEvent;
	'messageerror': MessageEvent;
}

interface MessagePort extends EventTarget {
	onmessage: ((this: MessagePort, ev: MessageEvent) => any) | null;
	onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null;
    /**
     * Disconnects the port, so that it is no longer active.
     */
	close(): void;
    /**
     * Posts a message through the channel. Objects listed in transfer are
     * transferred, not just cloned, meaning that they are no longer usable on the sending side.
     * Throws a 'DataCloneError' DOMException if
     * transfer contains duplicate objects or port, or if message
     * could not be cloned.
     */
	postMessage(message: any, transfer?: Transferable[]): void;
    /**
     * Begins dispatching messages received on the port.
     */
	start(): void;
	addEventListener<K extends keyof MessagePortEventMap>(type: K, listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
	removeEventListener<K extends keyof MessagePortEventMap>(type: K, listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

declare var MessagePort: {
	prototype: MessagePort;
	new(): MessagePort;
};

////////////////////////////////////////////////////////////////////////////////

interface AudioNodeOptions {
	channelCount?: number;
	channelCountMode?: 'max' | 'clamped-max' | 'explicit';
	channelInterpretation?: 'speakers' | 'discrete';
}

interface AudioWorkletNodeOptions extends AudioNodeOptions {
	numberOfInputs?: number;
	numberOfOutputs?: number;
	outputChannelCount?: number[];
	parameterData?: { [key: string]: number; };
	processorOptions?: any;
}

abstract class AudioWorkletProcessor {
	public port: MessagePort;

	constructor(options: AudioWorkletNodeOptions);
	public abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: any): boolean;
}

type ProcessorConstructor<T extends AudioWorkletProcessor> = {
	new(options: AudioWorkletNodeOptions): T;
};

declare function registerProcessor<T extends AudioWorkletProcessor>(name: string, ctor: ProcessorConstructor<T>): void;
declare const currentFrame: number;
declare const currentTime: number;
declare const sampleRate: number;

interface AudioWorkletGlobalScopeObject {
	[key: string]: any;
	registerProcessor<T extends AudioWorkletProcessor>(name: string, ctor: ProcessorConstructor<T>): void;
	currentFrame: number;
	currentTime: number;
	sampleRate: number;
}

declare const AudioWorkletGlobalScope: AudioWorkletGlobalScopeObject;
