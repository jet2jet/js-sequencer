export interface SynthEventProgramSelect {
	type: 'program';
	channel: number;
	sfontId: number;
	bank: number;
	preset: number;
}
export interface SynthEventControl {
	type: 'control';
	channel: number;
	control: number;
	value: number;
}
export interface SynthEventNoteOn {
	type: 'noteon';
	channel: number;
	key: number;
	velocity: number;
}
export interface SynthEventNoteOff {
	type: 'noteoff';
	channel: number;
	key: number;
}
export interface SynthEventAftertouch {
	type: 'aftertouch';
	channel: number;
	key: number;
	value: number;
}
export interface SynthEventPitch {
	type: 'pitch';
	channel: number;
	value: number;
}
export interface SynthEventPressure {
	type: 'pressure';
	channel: number;
	value: number;
}
export interface SynthEventUser {
	type: 'user';
	data: number;
}
export type SynthEvent =
	| SynthEventProgramSelect
	| SynthEventControl
	| SynthEventNoteOn
	| SynthEventNoteOff
	| SynthEventAftertouch
	| SynthEventPitch
	| SynthEventPressure
	| SynthEventUser;
