import Channel from '../objects/Channel';
import IPositionObject from '../objects/IPositionObject';
import ISequencerObject from '../objects/ISequencerObject';
import PositionObject from '../objects/PositionObject';

import { TimeRationalValue, TimeValue } from '../types';

import * as TimeRational from '../functions/timeRational';

import AftertouchControl from './controls/AftertouchControl';
import ControllerControl from './controls/ControllerControl';
import ControlObject, {
	getControlFromJSONObject,
} from './controls/ControlObject';
import EOTObject from './controls/EOTObject';
import KeySignatureControl from './controls/KeySignatureControl';
import PitchWheelControl from './controls/PitchWheelControl';
import PressureControl from './controls/PressureControl';
import ProgramChangeControl from './controls/ProgramChangeControl';
import SysExControl from './controls/SysExControl';
import SysMsgControl from './controls/SysMsgControl';
import TempoControl from './controls/TempoControl';
import TimeSignatureControl from './controls/TimeSignatureControl';

import BeatsCalculator from './BeatsCalculator';
import DummyNoteStopObject from './DummyNoteStopObject';
import NoteObject from './NoteObject';
import NoteObjectBase from './NoteObjectBase';
import Part from './Part';

import EngineEventObjectMap from '../events/EngineEventObjectMap';
import EventObjectBase from '../events/EventObjectBase';
import SimpleEventObject from '../events/SimpleEventObject';

import { gcd } from '../functions';

let _controlDataId = 0;

export function updateControlArray(arr: ControlObject[]) {
	arr.forEach((c) => {
		c.parentArray = arr;
	});
}

export function addToControlArray(arr: ControlObject[], obj: ControlObject) {
	if (!(obj instanceof ControllerControl)) {
		for (const c of arr) {
			if (c.isSimilar(obj)) return;
			// if (arr[i].isEqualType(obj) && arr[i].isEqualPosition(obj)) {
			// 	arr[i] = obj;
			// 	obj.parentArray = arr;
			// 	return;
			// }
		}
	}
	obj.idData = _controlDataId++;
	arr.push(obj);
	obj.parentArray = arr;
}

export function sortNotesAndControls(arr: ISequencerObject[]): void {
	const compare = (a: ISequencerObject, b: ISequencerObject) => {
		const pos1 = a.notePosNumerator * b.notePosDenominator;
		const pos2 = b.notePosNumerator * a.notePosDenominator;
		if (pos1 === pos2) {
			if (a.isEqualType?.(b)) {
				if (a.compareTo) return a.compareTo(b);
			}
			if (a instanceof ControlObject) {
				if (!(b instanceof ControlObject)) return -1;
			} else if (b instanceof ControlObject) return 1;
			return a.idData! - b.idData!;
		}
		return pos1 - pos2;
	};
	arr.sort(compare);
}

/** Returns the time seconds from position 'valFromNum/valFromDen' to 'valToNum/valToDen' */
export function calcTimeExFromSMFTempo2(
	smfTempo: number,
	valFromNum: number,
	valFromDen: number,
	valToNum: number,
	valToDen: number
): TimeRationalValue {
	// return (240 / (60000000 / smfTempo)) * (valToNum / valToDen - valFromNum / valFromDen);
	// return (smfTempo) * ((valToNum * valFracFrom - valFromNum * valToDen) / (250000 * valToDen * valFromDen));
	return {
		num: (valToNum * valFromDen - valFromNum * valToDen) * smfTempo,
		den: 250000 * valToDen * valFromDen,
	};
}

/** Returns the time seconds from position 'valFromNum/valFromDen' to 'valToNum/valToDen' */
export function calcTimeExFromSMFTempo(
	smfTempo: number,
	valFromNum: number,
	valFromDen: number,
	valToNum: number,
	valToDen: number
): TimeValue {
	const r = calcTimeExFromSMFTempo2(
		smfTempo,
		valFromNum,
		valFromDen,
		valToNum,
		valToDen
	);
	return r.num / r.den;
}

// return: sec
export function calcHoldTime2(
	note: NoteObject,
	currentSMFTempo: number,
	isHolding: boolean,
	arr: ISequencerObject[],
	fromIndex: number,
	disableHold: boolean | undefined
): TimeRationalValue {
	let tm: TimeRationalValue = { num: 0, den: 1 };
	const pos = new PositionObject(
		note.notePosNumerator,
		note.notePosDenominator
	);
	const posTo = pos.addPositionDirect(
		note.noteLengthNumerator,
		note.noteLengthDenominator
	);
	if (!disableHold) {
		for (; fromIndex < arr.length; ++fromIndex) {
			const n = arr[fromIndex];
			if (n.channel !== note.channel) continue;
			if (!isHolding) {
				// Stop calculation if the note just after 'posTo' is found with non-hold status
				if (
					posTo.numerator * n.notePosDenominator <=
					n.notePosNumerator * posTo.denominator
				) {
					break;
				}
			}
			if (n instanceof TempoControl) {
				tm = TimeRational.add(
					tm,
					calcTimeExFromSMFTempo2(
						currentSMFTempo,
						pos.numerator,
						pos.denominator,
						n.notePosNumerator,
						n.notePosDenominator
					)
				);
				currentSMFTempo = n.value;
				pos.numerator = n.notePosNumerator;
				pos.denominator = n.notePosDenominator;
				continue;
			}
			if (!(n instanceof ControllerControl)) continue;
			if (n.value1 !== 0x40) continue;
			isHolding = n.value2 >= 64;
			if (!isHolding) {
				// replace 'posTo' value if the hold status is changed to 'OFF' and
				// its position is after 'posTo'
				if (
					posTo.numerator * n.notePosDenominator <=
					n.notePosNumerator * posTo.denominator
				) {
					posTo.numerator = n.notePosNumerator;
					posTo.denominator = n.notePosDenominator;
				}
			}
		}
	}
	return TimeRational.add(
		tm,
		calcTimeExFromSMFTempo2(
			currentSMFTempo,
			pos.numerator,
			pos.denominator,
			posTo.numerator,
			posTo.denominator
		)
	);
}

// return: sec
export function calcHoldTime(
	note: NoteObject,
	currentSMFTempo: number,
	isHolding: boolean,
	arr: ISequencerObject[],
	fromIndex: number,
	disableHold: boolean | undefined
) {
	const r = calcHoldTime2(
		note,
		currentSMFTempo,
		isHolding,
		arr,
		fromIndex,
		disableHold
	);
	return r.num / r.den;
}

function calculatePositionImpl2(
	notesAndControls: ISequencerObject[],
	smfTempoFirst: number,
	posFrom: TimeRationalValue | IPositionObject,
	posTo: TimeRationalValue | IPositionObject | null,
	returnGreaterOrEqual: boolean,
	disableHold?: boolean
): {
	from: IPositionObject;
	to: IPositionObject;
	timeFrom: TimeRationalValue;
	timeTo: TimeRationalValue;
	timeStartOffset: TimeRationalValue;
	duration: TimeRationalValue;
} | null {
	let tFrom: TimeRationalValue | null = null;
	let tTo: TimeRationalValue | null = null;
	let retFrom: IPositionObject | null = null;
	let retTo: IPositionObject | null = null;
	let isPosSeconds: boolean;
	if ('numerator' in posFrom || (posTo && 'numerator' in posTo)) {
		retFrom = posFrom as IPositionObject;
		retTo = posTo as IPositionObject;
		isPosSeconds = false;
	} else {
		if (posTo && TimeRational.compare(posFrom, posTo) > 0) return null;
		tFrom = posFrom;
		tTo = posTo;
		isPosSeconds = true;
	}
	let timeStartOffset: TimeRationalValue | null = null;
	let duration: TimeRationalValue | null = null;
	let posNum = 0;
	let posDen = 1;
	let curTempo = smfTempoFirst;
	let time: TimeRationalValue = { num: 0, den: 1 };
	let timeFinish: TimeRationalValue | null = tTo;
	const chTempData: Array<Channel | undefined> = [];
	chTempData.length = 16;
	for (let i = 0; i < chTempData.length; ++i) {
		chTempData[i] = {
			rpnValue: null,
			rpnLsb: null,
			rpnMsb: null,
			nrpnLsb: null,
			nrpnMsb: null,
			isHolding: false,
			bank: null,
			pitchMIDIValue: null,
			pitchRange: null,
			preset: null,
			volume: null,
		};
	}

	for (let i = 0; i < notesAndControls.length; ++i) {
		const note = notesAndControls[i];
		if (note instanceof TempoControl) {
			curTempo = note.value;
		}
		if (isPosSeconds) {
			if (!retFrom && TimeRational.compare(time, tFrom!) >= 0) {
				if (returnGreaterOrEqual) {
					posNum = note.notePosNumerator;
					posDen = note.notePosDenominator;
				}
				retFrom = new PositionObject(posNum, posDen);
				timeStartOffset = TimeRational.sub(time, tFrom!);
			} else if (
				retFrom &&
				!retTo &&
				tTo &&
				TimeRational.compare(time, tTo) >= 0
			) {
				if (returnGreaterOrEqual) {
					posNum = note.notePosNumerator;
					posDen = note.notePosDenominator;
				}
				retTo = new PositionObject(posNum, posDen);
				duration = TimeRational.sub(timeFinish!, tFrom!);
				break;
			}
		} else {
			if (
				tFrom === null &&
				note.notePosNumerator * retFrom!.denominator >=
					retFrom!.numerator * note.notePosDenominator
			) {
				if (returnGreaterOrEqual) {
					posNum = note.notePosNumerator;
					posDen = note.notePosDenominator;
				}
				const t = calcTimeExFromSMFTempo2(
					curTempo,
					note.notePosNumerator,
					note.notePosDenominator,
					retFrom!.numerator,
					retFrom!.denominator
				);
				tFrom = time;
				timeStartOffset = TimeRational.sub(t, tFrom);
			} else if (
				tFrom !== null &&
				tTo === null &&
				retTo &&
				note.notePosNumerator * retTo.denominator >=
					retTo.numerator * note.notePosDenominator
			) {
				if (returnGreaterOrEqual) {
					posNum = note.notePosNumerator;
					posDen = note.notePosDenominator;
				}
				const t = calcTimeExFromSMFTempo2(
					curTempo,
					note.notePosNumerator,
					note.notePosDenominator,
					retFrom!.numerator,
					retFrom!.denominator
				);
				tTo = time;
				duration = TimeRational.sub(TimeRational.add(time, t), tFrom);
				break;
			}
		}
		if (note instanceof ProgramChangeControl) {
			// do nothing
		} else if (note instanceof ControllerControl) {
			if (note.channel < 16) {
				const ch = chTempData[note.channel];
				if (ch) {
					switch (note.value1) {
						case 0x07: // volume
							break;
						case 0x06: // DATA MSB
							// console.log("DATA MSB: channel = " + note.channel + ", value = " + note.value2);
							if (ch.rpnValue === null) break;
							switch (ch.rpnValue) {
								case 0x0000: // Pitch bend range: RPN 00(MSB), 00(LSB) [no DATA LSB]
									// ch.pitchRange = note.value2;
									break;
							}
							break;
						case 0x24: // DATA LSB
							if (ch.rpnValue === null) break;
							// not implemented
							break;
						case 0x40: // Dumper pedal on/off (Hold)
							if (!disableHold) ch.isHolding = note.value2 >= 64;
							break;
						case 0x62: // NRPN LSB
							if (note.value2 >= 0 && note.value2 <= 0x7f) {
								ch.nrpnLsb = note.value2;
								if (ch.nrpnMsb !== null) {
									ch.rpnValue =
										0x4000 + ch.nrpnMsb * 0x80 + ch.nrpnLsb;
								}
							}
							break;
						case 0x63: // NRPN MSB
							if (note.value2 >= 0 && note.value2 <= 0x7f) {
								ch.nrpnMsb = note.value2;
								if (ch.nrpnLsb !== null) {
									ch.rpnValue =
										0x4000 + ch.nrpnMsb * 0x80 + ch.nrpnLsb;
								}
							}
							break;
						case 0x64: // RPN LSB
							// console.log("RPN LSB: channel = " + note.channel + ", value = " + note.value2);
							if (note.value2 >= 0 && note.value2 <= 0x7f) {
								ch.rpnLsb = note.value2;
								if (ch.rpnMsb !== null) {
									ch.rpnValue = ch.rpnMsb * 0x80 + ch.rpnLsb;
									if (ch.rpnValue === 0x3fff) {
										// RPN NULL
										ch.rpnValue = null;
									}
								}
							}
							break;
						case 0x65: // RPN MSB
							// console.log("RPN MSB: channel = " + note.channel + ", value = " + note.value2);
							if (note.value2 >= 0 && note.value2 <= 0x7f) {
								ch.rpnMsb = note.value2;
								if (ch.rpnLsb !== null) {
									ch.rpnValue = ch.rpnMsb * 0x80 + ch.rpnLsb;
									if (ch.rpnValue === 0x3fff) {
										// RPN NULL
										ch.rpnValue = null;
									}
								}
							}
							break;
						default:
							// console.log("ControllerControl: " + note.value1 + ", " + note.value2);
							break;
					}
				}
			} else {
				// console.log("ControllerControl: channel = " + note.channel + ", " + note.value1 + ", " + note.value2);
			}
		} else if (note instanceof PitchWheelControl) {
			// do nothing
		}
		if (note instanceof NoteObject) {
			// 120: tempo
			// let tm = calcTime(curTempo, note.noteLength, note.noteLengthFraction);
			const ch = chTempData[note.channel];
			const tm = calcHoldTime2(
				note,
				curTempo,
				ch?.isHolding || false,
				notesAndControls,
				i,
				disableHold
			);
			const timeEnd = TimeRational.add(tm, time);
			if (timeFinish && TimeRational.compare(timeFinish, timeEnd) < 0) {
				timeFinish = timeEnd;
			}
		}
		if (i + 1 < notesAndControls.length) {
			const nextNote = notesAndControls[i + 1];
			const nextTime = calcTimeExFromSMFTempo2(
				curTempo,
				note.notePosNumerator,
				note.notePosDenominator,
				nextNote.notePosNumerator,
				nextNote.notePosDenominator
			);
			time = TimeRational.normalize(TimeRational.add(time, nextTime));
		}
		posNum = note.notePosNumerator;
		posDen = note.notePosDenominator;
	}
	if (retFrom === null) return null;
	if (retTo === null) {
		if (isPosSeconds) {
			retTo = new PositionObject(posNum, posDen);
		} else {
			tTo = time;
		}
		duration = TimeRational.sub(time, tFrom!);
	}
	return {
		from: retFrom,
		to: retTo!,
		timeFrom: tFrom!,
		timeTo: tTo!,
		timeStartOffset: timeStartOffset!,
		duration: duration!,
	};
}

function calculatePositionImpl(
	notesAndControls: ISequencerObject[],
	smfTempoFirst: number,
	posFrom: TimeValue | IPositionObject,
	posTo: TimeValue | IPositionObject | null,
	returnGreaterOrEqual: boolean,
	disableHold?: boolean
): {
	from: IPositionObject;
	to: IPositionObject;
	timeFrom: TimeValue;
	timeTo: TimeValue;
	timeStartOffset: TimeValue;
	duration: TimeValue;
} | null {
	const r = calculatePositionImpl2(
		notesAndControls,
		smfTempoFirst,
		typeof posFrom === 'number'
			? TimeRational.fromNumber(posFrom)
			: posFrom,
		posTo === null
			? null
			: typeof posTo === 'number'
			? TimeRational.fromNumber(posTo)
			: posTo,
		returnGreaterOrEqual,
		disableHold
	);
	if (!r) {
		return null;
	}
	return {
		from: r.from,
		to: r.to,
		timeFrom: r.timeFrom.num / r.timeFrom.den,
		timeTo: r.timeTo.num / r.timeTo.den,
		timeStartOffset: r.timeStartOffset.num / r.timeStartOffset.den,
		duration: r.duration.num / r.duration.den,
	};
}

export function calculatePositionFromSeconds2(
	notesAndControls: ISequencerObject[],
	smfTempoFirst: number,
	timeSecondsFrom: TimeRationalValue,
	timeSecondsTo: TimeRationalValue | null,
	returnGreaterOrEqual: boolean,
	disableHold?: boolean
): {
	from: IPositionObject;
	to: IPositionObject;
	timeStartOffset: TimeRationalValue;
	duration: TimeRationalValue;
} | null {
	if (
		timeSecondsTo &&
		TimeRational.compare(timeSecondsFrom, timeSecondsTo) > 0
	) {
		return null;
	}
	return calculatePositionImpl2(
		notesAndControls,
		smfTempoFirst,
		timeSecondsFrom,
		timeSecondsTo,
		returnGreaterOrEqual,
		disableHold
	);
}

export function calculatePositionFromSeconds(
	notesAndControls: ISequencerObject[],
	smfTempoFirst: number,
	timeSecondsFrom: TimeValue,
	timeSecondsTo: TimeValue,
	returnGreaterOrEqual: boolean,
	disableHold?: boolean
): {
	from: IPositionObject;
	to: IPositionObject;
	timeStartOffset: TimeValue;
	duration: TimeValue;
} | null {
	if (
		typeof timeSecondsFrom !== typeof 0 ||
		typeof timeSecondsTo !== typeof 0 ||
		timeSecondsFrom > timeSecondsTo
	) {
		return null;
	}
	return calculatePositionImpl(
		notesAndControls,
		smfTempoFirst,
		timeSecondsFrom,
		timeSecondsTo,
		returnGreaterOrEqual,
		disableHold
	);
}

export function calculateSecondsFromPosition2(
	notesAndControls: ISequencerObject[],
	smfTempoFirst: number,
	posFrom: IPositionObject,
	posTo: IPositionObject | null,
	returnGreaterOrEqual: boolean,
	disableHold?: boolean
): {
	timeFrom: TimeRationalValue;
	timeTo: TimeRationalValue;
	timeStartOffset: TimeRationalValue;
	duration: TimeRationalValue;
} | null {
	if (
		posTo &&
		posFrom.numerator * posTo.denominator >=
			posFrom.denominator * posTo.numerator
	) {
		return null;
	}
	return calculatePositionImpl2(
		notesAndControls,
		smfTempoFirst,
		posFrom,
		posTo,
		returnGreaterOrEqual,
		disableHold
	);
}

function _getPosData(deltaTime: number, division: number): IPositionObject {
	division *= 4; // division は4分音符1つ当たりの時間
	const g = gcd(deltaTime, division);
	return { numerator: deltaTime / g, denominator: division / g };
}

// return: deltaTime
function _getDeltaTime(
	posNum: number,
	posDen: number,
	division: number
): number {
	return (posNum * division * 4) / posDen;
}

function _addNoteFromDeltaTime(
	notesArray: NoteObject[],
	noteValue: number,
	deltaTime: number,
	noteLengthTime: number,
	division: number,
	velocity: number,
	channel: number
) {
	let p = _getPosData(deltaTime, division);
	const posNum = p.numerator;
	const posDen = p.denominator;
	p = _getPosData(noteLengthTime, division);
	const noteLengthNum = p.numerator;
	const noteLengthDen = p.denominator;
	const n = new NoteObject(
		posNum,
		posDen,
		noteLengthNum,
		noteLengthDen,
		noteValue,
		channel
	);
	n.velocity = velocity;
	notesArray.push(n);
	// debugText(n.noteValue + ", " + posNum + "/" + posDen + ", " + noteLengthNum + "/" + noteLengthDen);
}

export interface ILoadSMFContext {
	smfBuffer: ArrayBuffer | null;
	format: number;
	startOffset: number;
	trackCount: number;
	division: number;
	loading: boolean;
	error?: any;
}

function _startLoadSMFData(
	ctx: ILoadSMFContext,
	smfBuffer: ArrayBuffer,
	offset: number
): ILoadSMFContext | null {
	if (smfBuffer.byteLength - offset < 8) return null;
	const dv = new DataView(smfBuffer, offset);
	// check data header
	if (dv.getUint32(0, true) !== 0x6468544d) {
		// "MThd"
		return null;
	}
	const len = dv.getUint32(4, false);
	if (smfBuffer.byteLength - offset - 8 < len) return null;
	if (len !== 6) return null;
	const format = dv.getUint16(8, false);
	if (format >= 2) {
		// only supports format = 0 or format = 1
		return null;
	}
	const trackCount = dv.getUint16(10, false);
	const division = dv.getUint16(12, false);
	if (!division) return null;

	ctx.smfBuffer = smfBuffer;
	ctx.format = format;
	ctx.startOffset = offset;
	ctx.trackCount = trackCount;
	ctx.division = division;
	ctx.loading = false;
	return ctx;
}

function loadFromSMFTrack(
	trackBuffer: ArrayBuffer,
	offset: number,
	division: number
): { part: Part; mcontrols: ControlObject[] } {
	if (trackBuffer.byteLength - offset < 8) {
		throw new Error('Not enough track header data');
	}
	const dv = new DataView(trackBuffer, offset);
	// check header format
	if (dv.getUint32(0, true) !== 0x6b72544d) {
		// "MTrk"
		throw new Error('Invalid track header');
	}
	let len = dv.getUint32(4, false);
	if (trackBuffer.byteLength - offset - 8 < len) {
		throw new Error('Not enough track data');
	}
	len += 8;

	const retNotes: NoteObject[] = [];
	const retControls: ControlObject[] = [];
	const retMControls: ControlObject[] = [];

	let off = 8; // current offset
	let del = 0; // current delta-time
	let bmsg = 0; // previous message
	const curNotes: Array<Array<{ time: number; velocity: number }>> = [];
	// let firstTempo = -1;
	let firstChannel = -1;
	curNotes.length = 16;
	for (let j = 0; j < 16; ++j) {
		const a: Array<{ time: number; velocity: number }> = [];
		a.length = 0x80;
		curNotes[j] = a;
		for (let i = 0; i < 0x80; ++i) {
			a[i] = { time: 0, velocity: 0 };
		}
	}
	while (true) {
		let tm = 0;
		// read delta-time
		if (off >= len) {
			throw new Error(
				`Not enough data for time (offset = ${off.toString()})`
			);
		}
		let b = dv.getUint8(off++);
		while (b >= 0x80) {
			// variable-length quantity
			if (off >= len) {
				throw new Error(
					`Not enough data for variable number (offset = ${off.toString()})`
				);
			}
			tm += b & 0x7f;
			tm <<= 7;
			b = dv.getUint8(off++);
		}
		tm += b;
		del += tm;
		// read status
		if (off >= len) {
			throw new Error(
				`Not enough data for status (offset = ${off.toString()})`
			);
		}
		b = dv.getUint8(off++);
		if (b < 0x80 && !bmsg) {
			throw new Error(
				`Time data without status data: 0x${b.toString(16)}`
			);
		}
		let msg;
		if (b < 0x80) {
			msg = bmsg;
		} else {
			bmsg = msg = b;
			if (off >= len) {
				throw new Error(
					`Not enough second data (status omitted): status = 0x${msg.toString(
						16
					)} (offset = ${off.toString()})`
				);
			}
			b = dv.getUint8(off++);
		}
		const p = _getPosData(del, division);
		if (msg >= 0xf0) {
			if (msg === 0xff) {
				// 0xFF: meta events
				if (off >= len) {
					throw new Error(
						`Not enough data: status = 0x${msg.toString(
							16
						)} (offset = ${off.toString()})`
					);
				}
				// b: type, smsglen: data length
				const smsglen = dv.getUint8(off++);
				if (off + smsglen > len) {
					throw new Error(
						`Not enough second data: status = 0x${msg.toString(
							16
						)} (offset = ${off.toString()})`
					);
				}
				if (b === 0x2f) {
					// end of track
					addToControlArray(
						retControls,
						new EOTObject(p.numerator, p.denominator)
					);
					break;
				}
				switch (b) {
					case 0x51: // tempo
						{
							if (smsglen !== 3) {
								throw new Error(
									`Invalid length for FF 51: ${smsglen.toString()}`
								);
							}
							// read four-bytes from 'off - 1' in big-endian and chop the highest byte
							const tempo =
								dv.getUint32(off - 1, false) & 0x00ffffff;
							addToControlArray(
								retMControls,
								new TempoControl(
									p.numerator,
									p.denominator,
									tempo
								)
							);
						}
						break;
					case 0x58: // time signature
						{
							if (smsglen !== 4) {
								throw new Error(
									`Invalid length for FF 58: ${smsglen.toString()}`
								);
							}
							const beats = dv.getUint8(off);
							const beatsDen = Math.pow(2, dv.getUint8(off + 1));
							const clocks = dv.getUint8(off + 2);
							const num32nd = dv.getUint8(off + 3);
							addToControlArray(
								retMControls,
								new TimeSignatureControl(
									p.numerator,
									p.denominator,
									beats,
									beatsDen,
									clocks,
									num32nd
								)
							);
						}
						break;
					case 0x59: // signature
						{
							if (smsglen !== 2) {
								throw new Error(
									`Invalid length for FF 59: ${smsglen.toString()}`
								);
							}
							const sf = dv.getInt8(off);
							const ism = dv.getUint8(off + 1);
							addToControlArray(
								retMControls,
								new KeySignatureControl(
									p.numerator,
									p.denominator,
									sf,
									!!ism
								)
							);
						}
						break;
					default:
						addToControlArray(
							retControls,
							new SysMsgControl(
								p.numerator,
								p.denominator,
								b,
								trackBuffer,
								offset + off,
								smsglen
							)
						);
						break;
				}
				off += smsglen;
			} else if (msg === 0xf0) {
				// SysEx (F0 <len> [...] (<len> === length of [...]))
				// the first data is length of body
				let sysExMsgLen = 0;
				while (b >= 0x80) {
					// variable-length quantity
					if (off >= len) {
						throw new Error(
							`Not enough data for variable length in SysEx (offset = ${off.toString()})`
						);
					}
					sysExMsgLen += b & 0x7f;
					sysExMsgLen <<= 7;
					b = dv.getUint8(off++);
				}
				sysExMsgLen += b;
				if (off > len - sysExMsgLen) {
					throw new Error(
						`Not enough data: status = 0x${msg.toString(
							16
						)}, len = ${sysExMsgLen} (offset = ${off.toString()})`
					);
				}
				// re-generate data with 'F0 <data-with-sysExMsgLen>'
				const sysExData = new Uint8Array(sysExMsgLen + 1);
				sysExData[0] = 0xf0;
				sysExData.set(
					new Uint8Array(trackBuffer, offset + off, sysExMsgLen),
					1
				);
				addToControlArray(
					retMControls,
					new SysExControl(p.numerator, p.denominator, sysExData)
				);
				off += sysExMsgLen;
			} else if (msg === 0xf7) {
				// SysEx (F7 <len> ...)
				// the first data is length of body
				let sysExMsgLen = 0;
				while (b >= 0x80) {
					// variable-length quantity
					if (off >= len) {
						throw new Error(
							`Not enough data for variable length in SysEx (offset = ${off.toString()})`
						);
					}
					sysExMsgLen += b & 0x7f;
					sysExMsgLen <<= 7;
					b = dv.getUint8(off++);
				}
				sysExMsgLen += b;
				if (off > len - sysExMsgLen) {
					throw new Error(
						`Not enough data: status = 0x${msg.toString(
							16
						)}, len = ${sysExMsgLen} (offset = ${off.toString()})`
					);
				}
				addToControlArray(
					retMControls,
					new SysExControl(
						p.numerator,
						p.denominator,
						trackBuffer,
						offset + off,
						sysExMsgLen
					)
				);
			} else {
				throw new Error(
					`Unsupported or invalid MIDI message: 0x${msg.toString(16)}`
				);
			}
		} else {
			// MIDI messages
			if (firstChannel === -1) firstChannel = msg & 0x0f;
			switch (msg & 0xf0) {
				case 0x80: // Note off (with 2-bytes)
				case 0x90: // Note on (with 2-bytes)
					{
						const ch = msg & 0x0f;
						if (off >= len) {
							throw new Error(
								`Not enough data: status = 0x${msg.toString(
									16
								)} (offset = ${off.toString()})`
							);
						}
						let vel = dv.getUint8(off++);
						if (vel >= 0x80) {
							throw new Error(
								`Invalid velocity '${vel.toString()}': status = 0x${msg.toString(
									16
								)}`
							);
						}
						if ((msg & 0xf0) === 0x80) vel = 0;
						if (!vel && curNotes[ch][b].velocity) {
							_addNoteFromDeltaTime(
								retNotes,
								b,
								curNotes[ch][b].time,
								del - curNotes[ch][b].time,
								division,
								curNotes[ch][b].velocity,
								ch
							);
						} else if (!curNotes[ch][b].velocity) {
							curNotes[ch][b].time = del;
						}
						curNotes[ch][b].velocity = vel;
					}
					break;
				case 0xa0: // Aftertouch (with 2-bytes)
					{
						// skip 1 byte
						if (off >= len) {
							throw new Error(
								`Not enough data: status = 0x${msg.toString(
									16
								)} (offset = ${off.toString()})`
							);
						}
						const val = dv.getUint8(off++);
						addToControlArray(
							retControls,
							new AftertouchControl(
								p.numerator,
								p.denominator,
								b,
								msg & 0x0f,
								val
							)
						);
					}
					break;
				case 0xb0: // Controller (with 2-bytes)
					{
						// skip 1 byte
						if (off >= len) {
							throw new Error(
								`Not enough data: status = 0x${msg.toString(
									16
								)} (offset = ${off.toString()})`
							);
						}
						const val = dv.getUint8(off++);
						addToControlArray(
							retControls,
							new ControllerControl(
								p.numerator,
								p.denominator,
								msg & 0x0f,
								b,
								val
							)
						);
					}
					break;
				case 0xc0: // Program Change (with 1-byte)
					addToControlArray(
						retControls,
						new ProgramChangeControl(
							p.numerator,
							p.denominator,
							msg & 0x0f,
							b
						)
					);
					break;
				case 0xd0: // Channel Pressure (with 1-byte)
					addToControlArray(
						retControls,
						new PressureControl(
							p.numerator,
							p.denominator,
							msg & 0x0f,
							b
						)
					);
					break;
				case 0xe0: // Pitch Wheel (with 2-bytes)
					{
						// skip 1 byte
						if (off >= len) {
							throw new Error(
								`Not enough data: status = 0x${msg.toString(
									16
								)} (offset = ${off.toString()})`
							);
						}
						const val = dv.getUint8(off++);
						addToControlArray(
							retControls,
							new PitchWheelControl(
								p.numerator,
								p.denominator,
								msg & 0x0f,
								b | (val << 7)
							)
						);
					}
					break;
			}
		}
	}

	// sortNotesAndControls(retNotes);
	// sortNotesAndControls(retControls);
	const ret = new Part();
	ret.notes = retNotes;
	ret.controls = retControls;
	updateControlArray(retControls);
	ret.channel = firstChannel !== -1 ? firstChannel : 0;

	return { part: ret, mcontrols: retMControls };
}

function startLoadFromSMFFileImpl(
	fileObject: Blob,
	callback?: (ctx: ILoadSMFContext | null) => void
) {
	if (typeof FileReader === typeof void 0) {
		if (callback) {
			callback(null);
		}
		return null;
	}

	const ctx: ILoadSMFContext = {
		smfBuffer: null,
		format: 0,
		startOffset: 0,
		trackCount: 0,
		division: 0,
		loading: true,
	};

	const r = new FileReader();

	r.onloadend = () => {
		if (!_startLoadSMFData(ctx, r.result as ArrayBuffer, 0)) {
			ctx.loading = false;
			ctx.error = new Error('Invalid file format.');
		}
		if (callback) {
			callback(ctx);
		}
	};
	r.onerror = (e) => {
		// console.log(e);
		ctx.loading = false;
		ctx.error = e;
		if (callback) {
			callback(ctx);
		}
	};

	r.readAsArrayBuffer(fileObject);
	return ctx;
}

function copyUint8ArrayToDataView(
	dvOut: DataView,
	offsetOut: number,
	arr: Uint8Array
) {
	new Uint8Array(
		dvOut.buffer,
		dvOut.byteOffset + offsetOut,
		arr.byteLength
	).set(arr);
	return offsetOut + arr.byteLength;
}

function divideNoteObjects(notes: NoteObject[]) {
	const arr: NoteObjectBase[] = [];
	arr.length = notes.length * 2;
	let j = 0;
	notes.forEach((n) => {
		arr[j++] = n;
		arr[j++] = new DummyNoteStopObject(
			n.notePosNumerator * n.noteLengthDenominator +
				n.noteLengthNumerator * n.notePosDenominator,
			n.notePosDenominator * n.noteLengthDenominator,
			n.channel,
			n.noteValue
		);
	});
	return arr;
}

// return: length (including End of Track; not including track header)
function calcTrackLength(
	notesAndControls: ISequencerObject[],
	division: number
): number {
	let before: ISequencerObject | null = null;
	let ret = 0;
	let beforePosNum = 0;
	let beforePosDen = 4;
	notesAndControls.forEach((o) => {
		let bf: ISequencerObject | null = o;
		let len = 0;

		let dt = 0;
		if (
			beforePosNum * o.notePosDenominator !==
			o.notePosNumerator * beforePosDen
		) {
			dt = _getDeltaTime(
				o.notePosNumerator * beforePosDen -
					beforePosNum * o.notePosDenominator,
				beforePosDen * o.notePosDenominator,
				division
			);
			beforePosNum = o.notePosNumerator;
			beforePosDen = o.notePosDenominator;
		}
		// variable-length quantity
		ret++;
		// tslint:disable-next-line:no-conditional-assignment
		while ((dt >>= 7)) {
			ret++;
		}

		if (o instanceof NoteObject || o instanceof DummyNoteStopObject) {
			if (
				before != null &&
				(before instanceof NoteObject ||
					before instanceof DummyNoteStopObject) &&
				o.channel === before.channel
			) {
				len = 2;
			} else len = 3;
		} else if (o instanceof AftertouchControl) {
			if (
				before != null &&
				before instanceof AftertouchControl &&
				before.channel === o.channel
			) {
				len = 2;
			} else len = 3;
		} else if (o instanceof ControllerControl) {
			if (
				before != null &&
				before instanceof ControllerControl &&
				before.channel === o.channel
			) {
				len = 2;
			} else len = 3;
		} else if (o instanceof ProgramChangeControl) {
			if (
				before != null &&
				before instanceof ProgramChangeControl &&
				before.channel === o.channel
			) {
				len = 1;
			} else len = 2;
		} else if (o instanceof PressureControl) {
			if (
				before != null &&
				before instanceof PressureControl &&
				before.channel === o.channel
			) {
				len = 1;
			} else len = 2;
		} else if (o instanceof PitchWheelControl) {
			if (
				before != null &&
				before instanceof PitchWheelControl &&
				before.channel === o.channel
			) {
				len = 2;
			} else len = 3;
		} else {
			bf = null;
			if (o instanceof TempoControl) len += 6;
			else if (o instanceof TimeSignatureControl) len += 7;
			else if (o instanceof KeySignatureControl) len += 5;
			else if (o instanceof SysMsgControl) {
				len += 3 + o.rawData.byteLength;
			} else if (o instanceof SysExControl) {
				const rawData = o.rawData;
				let mlen = rawData.byteLength;
				// variable-length quantity
				++len;
				// tslint:disable-next-line:no-conditional-assignment
				while ((mlen >>= 7)) {
					++len;
				}
				len += rawData.byteLength;
			}
		}
		ret += len;
		before = bf;
	});
	return ret + 4; // 4: "00 FF 2F 00"
}

// return: new offset
function outputTrackToDataView(
	dv: DataView,
	offset: number,
	notesAndControls: ISequencerObject[],
	division: number
): number {
	let before: ISequencerObject | null = null;
	let beforePosNum = 0;
	let beforePosDen = 4;
	const tmpBuf: number[] = [];
	notesAndControls.forEach((o) => {
		let bf: ISequencerObject | null = o;

		let dt = 0;
		if (
			beforePosNum * o.notePosDenominator !==
			o.notePosNumerator * beforePosDen
		) {
			dt = _getDeltaTime(
				o.notePosNumerator * beforePosDen -
					beforePosNum * o.notePosDenominator,
				beforePosDen * o.notePosDenominator,
				division
			);
			beforePosNum = o.notePosNumerator;
			beforePosDen = o.notePosDenominator;
		}
		// variable-length quantity
		{
			// push the 7-lowest bits of dt(DeltaTime) to the array, and output in reverse order
			// (add 0x80 to the all value but the first value)
			let dp = 0;
			while (true) {
				if (tmpBuf.length === dp) {
					++tmpBuf.length;
				}
				tmpBuf[dp] = dt & 0x7f;
				if (dp > 0) {
					tmpBuf[dp] |= 0x80;
				}
				++dp;
				dt >>= 7;
				if (!dt) {
					break;
				}
			}
			for (--dp; dp >= 0; --dp) {
				dv.setUint8(offset++, tmpBuf[dp]);
			}
		}

		if (o instanceof NoteObject || o instanceof DummyNoteStopObject) {
			if (
				!(
					before != null &&
					(before instanceof NoteObject ||
						before instanceof DummyNoteStopObject) &&
					o.channel === before.channel
				)
			) {
				dv.setUint8(offset++, 0x90 | o.channel);
			}
			dv.setUint8(offset++, o.noteValue);
			let vel = 0;
			if (o instanceof NoteObject) vel = o.velocity;
			dv.setUint8(offset++, vel);
		} else if (o instanceof AftertouchControl) {
			if (
				!(
					before != null &&
					before instanceof AftertouchControl &&
					before.channel === o.channel
				)
			) {
				dv.setUint8(offset++, 0xa0 | o.channel);
			}
			dv.setUint8(offset++, o.noteValue);
			dv.setUint8(offset++, o.value);
		} else if (o instanceof ControllerControl) {
			if (
				!(
					before != null &&
					before instanceof ControllerControl &&
					before.channel === o.channel
				)
			) {
				dv.setUint8(offset++, 0xb0 | o.channel);
			}
			dv.setUint8(offset++, o.value1);
			dv.setUint8(offset++, o.value2);
		} else if (o instanceof ProgramChangeControl) {
			if (
				!(
					before != null &&
					before instanceof ProgramChangeControl &&
					before.channel === o.channel
				)
			) {
				dv.setUint8(offset++, 0xc0 | o.channel);
			}
			dv.setUint8(offset++, o.value);
		} else if (o instanceof PressureControl) {
			if (
				!(
					before != null &&
					before instanceof PressureControl &&
					before.channel === o.channel
				)
			) {
				dv.setUint8(offset++, 0xd0 | o.channel);
			}
			dv.setUint8(offset++, o.value);
		} else if (o instanceof PitchWheelControl) {
			if (
				!(
					before != null &&
					before instanceof PitchWheelControl &&
					before.channel === o.channel
				)
			) {
				dv.setUint8(offset++, 0xc0 | o.channel);
			}
			dv.setUint8(offset++, o.value & 0x7f);
			dv.setUint8(offset++, (o.value >> 7) & 0x7f);
		} else {
			bf = null;
			if (o instanceof SysExControl) {
				let rawOffset = 0;
				if (o.rawData.length > 0 && o.rawData[0] === 0xf0) {
					++rawOffset;
					dv.setUint8(offset++, 0xf0);
				}
				// variable-length quantity
				let rawDataLen = o.rawData.length;
				{
					// push the 7-lowest bits of rawDataLen to the array, and output in reverse order
					// (add 0x80 to the all value but the first value)
					let dp = 0;
					while (true) {
						if (tmpBuf.length === dp) {
							++tmpBuf.length;
						}
						tmpBuf[dp] = rawDataLen & 0x7f;
						if (dp > 0) {
							tmpBuf[dp] |= 0x80;
						}
						++dp;
						rawDataLen >>= 7;
						if (!rawDataLen) {
							break;
						}
					}
					for (--dp; dp >= 0; --dp) {
						dv.setUint8(offset++, tmpBuf[dp]);
					}
				}
				offset = copyUint8ArrayToDataView(
					dv,
					offset,
					o.rawData.subarray(rawOffset)
				);
			} else {
				dv.setUint8(offset++, 0xff);
				if (o instanceof TempoControl) {
					dv.setUint8(offset++, 0x51);
					const tempo = Math.floor(o.value);
					dv.setUint32(offset, 0x03000000 | tempo, false);
					offset += 4;
				} else if (o instanceof TimeSignatureControl) {
					dv.setUint8(offset++, 0x58);
					dv.setUint8(offset++, 0x04);
					dv.setUint8(offset++, o.beatsNumerator);
					let v = 0;
					let x = 1;
					while (x < o.beatsDenominator) {
						++v;
						x <<= 1;
					}
					dv.setUint8(offset++, v);
					dv.setUint8(offset++, o.clocks);
					dv.setUint8(offset++, o.num32ndInQuater);
				} else if (o instanceof KeySignatureControl) {
					dv.setUint8(offset++, 0x59);
					dv.setUint8(offset++, 0x02);
					dv.setInt8(offset++, o.sharpFlat);
					dv.setUint8(offset++, o.isMinor ? 1 : 0);
				} else if (o instanceof SysMsgControl) {
					dv.setUint8(offset++, o.msgType);
					dv.setUint8(offset++, o.rawData.byteLength);
					offset = copyUint8ArrayToDataView(dv, offset, o.rawData);
				} else {
					--offset;
				}
			}
		}
		before = bf;
	});
	dv.setUint8(offset++, 0x00);
	dv.setUint8(offset++, 0xff);
	dv.setUint8(offset++, 0x2f);
	dv.setUint8(offset++, 0x00);
	return offset;
}

/**
 * @param parts Array of Part
 * @param mcontrols Array of controls
 * @param div division (delta-time)
 */
function createMIDIData(
	parts: Part[],
	mcontrols: ControlObject[],
	div: number
): ArrayBuffer {
	const arr: Array<{ data: ISequencerObject[]; byteLength: number }> = [];
	arr.length = parts.length + 1;
	arr[0] = { data: mcontrols, byteLength: calcTrackLength(mcontrols, div) };
	parts.forEach((p, index) => {
		const d = ([] as ISequencerObject[])
			.concat(divideNoteObjects(p.notes))
			.concat(p.controls);
		sortNotesAndControls(d);
		arr[index + 1] = { data: d, byteLength: calcTrackLength(d, div) };
	});

	let totalSize = 14; // "MThd" + <hdr-size(4 bytes)> + <hdr(6 bytes)>
	arr.forEach((d) => {
		totalSize += 8; // "MTrk" + <data-size(4 bytes)>
		totalSize += d.byteLength;
	});

	const ab = new ArrayBuffer(totalSize);
	const dv = new DataView(ab);
	dv.setUint32(0, 0x6468544d, true); // "MThd"
	dv.setUint32(4, 6, false);
	dv.setUint16(8, 1, false); // format 1
	dv.setUint16(10, arr.length, false);
	dv.setUint16(12, div, false);

	let off = 14;
	arr.forEach((d) => {
		dv.setUint32(off, 0x6b72544d, true); // "MTrk"
		dv.setUint32(off + 4, d.byteLength, false);
		off += 8;
		off = outputTrackToDataView(dv, off, d.data, div);
	});

	return ab;
}

////////////////////////////////////////////////////////////////////////////////

function createURLForData(ab: ArrayBuffer, mime: string) {
	const blob = new Blob([ab], { type: mime });
	return URL.createObjectURL(blob);
}

function _toJSON(obj: any): string {
	return JSON.stringify(obj, (k, v) => (k === 'sequencer' ? void 0 : v));
}

function _fromJSON(text: string): any {
	return JSON.parse(text);
}

export default class Engine {
	/** BPM */
	public tempo = 120;

	public smfDivision = 0x120;

	public masterControls: ControlObject[] = [];

	public parts: Part[] = [];

	private readonly _evtFileLoaded: Array<
		(e: SimpleEventObject<Engine>) => void
	> = [];

	constructor() {
		this.reset();
	}

	public getTimeSignature(indexLast: number): TimeSignatureControl | null {
		const ctrls = this.masterControls;
		for (const c of ctrls) {
			if (c instanceof TimeSignatureControl) {
				if (!indexLast) return c;
				--indexLast;
			}
		}
		return null;
	}

	public getKeySignature(indexLast: number): KeySignatureControl | null {
		const ctrls = this.masterControls;
		for (const c of ctrls) {
			if (c instanceof KeySignatureControl) {
				if (!indexLast) return c;
				--indexLast;
			}
		}
		return null;
	}

	public getMeasureFromPosition(
		numerator: number,
		denominator: number
	): number;

	public getMeasureFromPosition(pos: PositionObject): number;

	public getMeasureFromPosition(
		numerator: number | PositionObject,
		denominator?: number
	): number {
		if (numerator instanceof PositionObject) {
			denominator = numerator.denominator;
			numerator = numerator.numerator;
		}
		let measure = -1;
		const ctrls = this.masterControls;
		let iCPos = 0;
		// let labelPos = 0;
		const bc = new BeatsCalculator();
		let nextPosNum = 0;
		let nextPosDen = 4;
		let iPos = 0;
		while (true) {
			if (
				iCPos < ctrls.length &&
				nextPosNum >= 0 &&
				bc.posNumerator * nextPosDen >= nextPosNum * bc.posDenominator
			) {
				while (iCPos < ctrls.length) {
					const c = ctrls[iCPos];
					if (c instanceof TimeSignatureControl) {
						if (
							bc.posNumerator * c.notePosDenominator >=
							c.notePosNumerator * bc.posDenominator
						) {
							bc.changeTimeSignature(
								c.beatsNumerator,
								c.beatsDenominator
							);
							iCPos++;
							if (iPos !== 0) {
								// prevent from increase measure count if
								// the time signature changes in the middle of a bar
								iPos = 0;
								measure--;
							}
							if (iCPos === ctrls.length) {
								nextPosNum = -1;
								break;
							}
						} else {
							nextPosNum = c.notePosNumerator;
							nextPosDen = c.notePosDenominator;
							break;
						}
					} else {
						iCPos++;
					}
				}
			}
			if (iPos === 0) {
				measure++;
			}
			if (++iPos === bc.beatsNumerator) {
				iPos = 0;
			}
			bc.incrementPosition(1);
			if (
				bc.posNumerator * denominator! >=
				numerator * bc.posDenominator
			) {
				return measure;
			}
		}
		// unreachable
	}

	public getPositionFromMeasure(measure: number): IPositionObject {
		const ctrls = this.masterControls;
		let iCPos = 0;
		// let labelPos = 0;
		const bc = new BeatsCalculator();
		let nextPosNum = 0;
		let nextPosDen = 4;
		let iPos = 0;
		while (true) {
			if (
				iCPos < ctrls.length &&
				nextPosNum >= 0 &&
				bc.posNumerator * nextPosDen >= nextPosNum * bc.posDenominator
			) {
				while (iCPos < ctrls.length) {
					const c = ctrls[iCPos];
					if (c instanceof TimeSignatureControl) {
						if (
							bc.posNumerator * c.notePosDenominator >=
							c.notePosNumerator * bc.posDenominator
						) {
							bc.changeTimeSignature(
								c.beatsNumerator,
								c.beatsDenominator
							);
							iCPos++;
							if (iPos !== 0) {
								// prevent from decrease remaining measure count if
								// the time signature changes in the middle of a bar
								iPos = 0;
								measure++;
							}
							if (iCPos === ctrls.length) {
								nextPosNum = -1;
								break;
							}
						} else {
							nextPosNum = c.notePosNumerator;
							nextPosDen = c.notePosDenominator;
							break;
						}
					} else {
						iCPos++;
					}
				}
			}
			if (iPos === 0) {
				measure--;
				if (measure < 0) {
					return new PositionObject(
						bc.posNumerator,
						bc.posDenominator
					);
				}
			}
			if (++iPos === bc.beatsNumerator) {
				iPos = 0;
			}
			bc.incrementPosition(1);
		}
		// unreachable
	}

	public updateMasterControls() {
		this.masterControls.forEach((o) => {
			o.attachEngine(this);
		});
	}

	public raiseEventFileLoaded() {
		const e = new SimpleEventObject(this);
		for (const fn of this._evtFileLoaded) {
			fn(e);
			if (e.isPropagationStopped()) break;
		}
		return !e.isDefaultPrevented();
	}

	public addEventHandler<T extends keyof EngineEventObjectMap>(
		name: T,
		fn: (e: EngineEventObjectMap[T]) => void
	): void;

	public addEventHandler(name: string, fn: (e: EventObjectBase) => void) {
		let arr: any[] | null = null;
		switch (name.toLowerCase()) {
			case 'fileloaded':
				arr = this._evtFileLoaded;
				break;
		}
		if (!arr) return;
		arr.push(fn);
	}

	public removeEventHandler<T extends keyof EngineEventObjectMap>(
		name: T,
		fn: (e: EngineEventObjectMap[T]) => void
	): void;

	public removeEventHandler(name: string, fn: (e: EventObjectBase) => void) {
		let arr: any[] | null = null;
		switch (name.toLowerCase()) {
			case 'fileloaded':
				arr = this._evtFileLoaded;
				break;
		}
		if (!arr) return;
		let i = -1;
		arr.forEach((f, index) => {
			if (f === fn) {
				i = index;
			}
		});
		if (i >= 0) arr.splice(i, 1);
	}

	public reset() {
		for (const c of this.masterControls) c.detachEngine();
		this.smfDivision = 0x120;
		this.tempo = 120;
		this.masterControls = [];
		this.parts = [];
	}

	public getAllNotes(): NoteObject[] {
		let ret: NoteObject[] = [];
		this.parts.forEach((p) => {
			ret = ret.concat(p.notes);
		});
		sortNotesAndControls(ret);
		return ret;
	}

	public getAllControls(): ControlObject[] {
		let ret: ControlObject[] = [];
		this.parts.forEach((p) => {
			ret = ret.concat(p.controls);
		});
		ret = ret.concat(this.masterControls);
		sortNotesAndControls(ret);
		return ret;
	}

	public getAllNotesAndControls(): ISequencerObject[] {
		let ret: ISequencerObject[] = [];
		this.parts.forEach((p) => {
			ret = ret.concat(p.notes);
			ret = ret.concat(p.controls);
		});
		ret = ret.concat(this.masterControls);
		sortNotesAndControls(ret);
		return ret;
	}

	public getAllNoteValues() {
		const a = this.getAllNotes();
		return a.map((note) => note.noteValue);
	}

	public getSequenceTitleData() {
		return this.getSequenceTrackName(0);
	}

	public getSequenceCopyrightData() {
		return this.getFirstMsgData(0, 2);
	}

	public getSequenceTrackName(partIndex: number) {
		return this.getFirstMsgData(partIndex, 3);
	}

	private getFirstMsgData(partIndex: number, msgType: number) {
		if (!(partIndex in this.parts)) {
			return null;
		}
		const part = this.parts[partIndex];
		for (const c of part.controls) {
			if (c instanceof SysMsgControl) {
				if (c.msgType === msgType) {
					return c.rawData;
				}
			}
		}
		return null;
	}

	public calculatePosition(
		timeFrom: TimeValue,
		timeTo: TimeValue,
		disableHold?: boolean
	): {
		from: IPositionObject;
		to: IPositionObject;
		timeStartOffset: TimeValue;
		duration: TimeValue;
	} | null {
		const r = this.calculatePositionEx(
			TimeRational.fromNumber(timeFrom),
			TimeRational.fromNumber(timeTo),
			disableHold
		);
		return r
			? {
					from: r.from,
					to: r.to,
					timeStartOffset:
						r.timeStartOffset.num / r.timeStartOffset.den,
					duration: r.duration.num / r.duration.den,
			  }
			: null;
	}

	public calculatePositionEx(
		timeFrom: TimeRationalValue,
		timeTo: TimeRationalValue,
		disableHold?: boolean
	): {
		from: IPositionObject;
		to: IPositionObject;
		timeStartOffset: TimeRationalValue;
		duration: TimeRationalValue;
	} | null {
		const arr: ISequencerObject[] = this.getAllNotesAndControls();

		const r = calculatePositionFromSeconds2(
			arr,
			60000000 / this.tempo,
			timeFrom,
			timeTo,
			true,
			disableHold
		);
		// if (!__PROD__ && r) {
		// 	console.log("From: " + r.from.numerator + "/" + r.from.denominator);
		// 	console.log("  StartOffset: " + r.timeStartOffset);
		// 	console.log("To: " + r.to.numerator + "/" + r.to.denominator);
		// 	console.log("  Duration: " + r.duration);
		// }
		return r;
	}

	public calculateSeconds(
		posFrom: IPositionObject,
		posTo: IPositionObject,
		disableHold?: boolean
	): {
		timeFrom: TimeValue;
		timeTo: TimeValue;
		timeStartOffset: TimeValue;
		duration: TimeValue;
	} | null {
		const r = this.calculateSecondsEx(posFrom, posTo, disableHold);
		return r
			? {
					timeFrom: r.timeFrom.num / r.timeFrom.den,
					timeTo: r.timeTo.num / r.timeTo.den,
					timeStartOffset:
						r.timeStartOffset.num / r.timeStartOffset.den,
					duration: r.duration.num / r.duration.den,
			  }
			: null;
	}

	public calculateSecondsEx(
		posFrom: IPositionObject,
		posTo: IPositionObject | null,
		disableHold?: boolean
	): {
		timeFrom: TimeRationalValue;
		timeTo: TimeRationalValue;
		timeStartOffset: TimeRationalValue;
		duration: TimeRationalValue;
	} | null {
		const arr: ISequencerObject[] = this.getAllNotesAndControls();

		const r = calculateSecondsFromPosition2(
			arr,
			60000000 / this.tempo,
			posFrom,
			posTo,
			true,
			disableHold
		);
		// if (!__PROD__ && r) {
		// 	console.log("From: " + r.timeFrom);
		// 	console.log("  StartOffset: " + r.timeStartOffset);
		// 	console.log("To: " + r.timeTo);
		// 	console.log("  Duration: " + r.duration);
		// }
		return r;
	}

	public calculateDuration(disableHold?: boolean): number {
		const r = this.calculateDurationEx(disableHold);
		return r.num / r.den;
	}

	public calculateDurationEx(disableHold?: boolean): TimeRationalValue {
		const arr: ISequencerObject[] = this.getAllNotesAndControls();

		const r = calculatePositionFromSeconds2(
			arr,
			60000000 / this.tempo,
			{ num: 0, den: 1 },
			null,
			true,
			disableHold
		);
		// if (!__PROD__ && r) {
		// 	console.log("From: " + r.from.numerator + "/" + r.from.denominator);
		// 	console.log("  StartOffset: " + r.timeStartOffset);
		// 	console.log("To: " + r.to.numerator + "/" + r.to.denominator);
		// 	console.log("  Duration: " + r.duration);
		// }
		return r?.duration || { num: 0, den: 1 };
	}

	public startLoadSMFData(
		smfBuffer: ArrayBuffer,
		offset: number
	): ILoadSMFContext | null {
		const ctx: ILoadSMFContext = {
			smfBuffer: null,
			format: 0,
			startOffset: 0,
			trackCount: 0,
			division: 0,
			loading: false,
		};
		return _startLoadSMFData(ctx, smfBuffer, offset);
	}

	public canContinueLoadSMFData(ctx: ILoadSMFContext | null): boolean {
		return !!ctx && ctx.smfBuffer !== null;
	}

	public continueLoadSMFData(ctx: ILoadSMFContext): boolean {
		if (!ctx.smfBuffer) {
			ctx.error = new Error('Invalid context');
			return false;
		}
		const dv = new DataView(ctx.smfBuffer, ctx.startOffset + 14); // 14 == "MThd" + len + <header>
		let off = 0;
		let lenRemain = ctx.smfBuffer.byteLength - (ctx.startOffset + 14);
		const parts: Part[] = [];
		parts.length = ctx.trackCount;
		let mcontrols: ControlObject[] = [];
		for (let track = 0; track < ctx.trackCount; ++track) {
			// check data format
			if (lenRemain < 8) {
				ctx.error = new Error(
					'Not enough track header data: ' + track.toString()
				);
				return false;
			}
			if (dv.getUint32(off, true) !== 0x6b72544d) {
				// "MTrk"
				ctx.error = new Error('Invalid track header');
				return false;
			}
			const len = dv.getUint32(off + 4, false);
			lenRemain -= 8;
			if (lenRemain < len) {
				ctx.error = new Error(
					'Not enough track data: ' + track.toString()
				);
				return false;
			}
			try {
				const ret = loadFromSMFTrack(
					ctx.smfBuffer,
					off + ctx.startOffset + 14,
					ctx.division
				);
				parts[track] = ret.part;
				mcontrols = mcontrols.concat(ret.mcontrols);
			} catch (e) {
				ctx.error = e;
				return false;
			}
			off += 8 + len;
			lenRemain -= len;
		}

		this.masterControls.forEach((c) => {
			c.detachEngine();
		});
		this.parts = parts;
		parts[0].attachEngine(this);
		updateControlArray(mcontrols);
		sortNotesAndControls(mcontrols);
		this.masterControls = mcontrols;
		this.smfDivision = ctx.division;
		this.updateMasterControls();

		this._afterLoadSMF();

		return true;
	}

	public getErrorFromLoadSMFData(ctx: ILoadSMFContext | null): any {
		// ctx?.smfBuffer !== null is not correct
		// eslint-disable-next-line @typescript-eslint/prefer-optional-chain
		return ctx && ctx.smfBuffer !== null
			? ctx.error
			: new Error('Invalid context');
	}

	public startLoadFromSMFFile(fileObject: Blob): ILoadSMFContext | null {
		return startLoadFromSMFFileImpl(fileObject);
	}

	public isLoadingSMFData(ctx: ILoadSMFContext | null): boolean {
		return !!ctx && ctx.loading;
	}

	private loadContextCallbackImpl(
		ctx: ILoadSMFContext | null,
		callback: (err?: any) => void
	) {
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (!ctx || ctx.error) {
			// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
			callback(ctx?.error || new Error('Invalid data'));
			return;
		}
		window.setTimeout(() => {
			if (!this.canContinueLoadSMFData(ctx)) {
				callback(this.getErrorFromLoadSMFData(ctx));
			} else if (!this.continueLoadSMFData(ctx)) {
				callback(ctx.error);
			} else {
				callback();
			}
		}, 0);
	}

	private loadContextAsyncImpl(ctx: ILoadSMFContext | null) {
		return new Promise<void>((resolve, reject) => {
			this.loadContextCallbackImpl(ctx, (err) => {
				// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	public loadSMFData(
		smfBuffer: ArrayBuffer,
		offset: number,
		callback: (err?: any) => void
	) {
		return this.loadContextCallbackImpl(
			this.startLoadSMFData(smfBuffer, offset),
			callback
		);
	}

	public loadSMFDataPromise(smfBuffer: ArrayBuffer, offset: number) {
		return this.loadContextAsyncImpl(
			this.startLoadSMFData(smfBuffer, offset)
		);
	}

	public loadFromFile(
		fileElemId: string | HTMLInputElement,
		callback?: (error?: any) => void
	) {
		const f: HTMLInputElement | null =
			typeof fileElemId === 'string'
				? (document.getElementById(
						fileElemId
				  ) as HTMLInputElement | null)
				: fileElemId;
		if (!f || !f.files || !f.files.length) {
			return;
		}

		startLoadFromSMFFileImpl(f.files[0], (ctx) => {
			this.loadContextCallbackImpl(ctx, (err) => {
				// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				if (err) {
					if (callback) {
						callback(err);
					} else {
						alert(String(err));
					}
				} else {
					if (callback) {
						callback();
					}
					this.raiseEventFileLoaded();
				}
			});
		});
	}

	public loadFromFilePromise(fileElemId: string | HTMLInputElement) {
		return new Promise<void>((resolve, reject) => {
			const f: HTMLInputElement | null =
				typeof fileElemId === 'string'
					? (document.getElementById(
							fileElemId
					  ) as HTMLInputElement | null)
					: fileElemId;
			if (!f || !f.files || !f.files.length) {
				reject(new Error('Invalid file element'));
				return;
			}
			startLoadFromSMFFileImpl(f.files[0], (ctx) => {
				this.loadContextAsyncImpl(ctx).then(resolve, reject);
			});
		});
	}

	public isSaveAvailable(): boolean {
		return typeof URL !== 'undefined';
	}

	public exportSMFToArrayBuffer(): ArrayBuffer {
		return createMIDIData(
			this.parts,
			this.masterControls,
			this.smfDivision
		);
	}

	public makeSMFBlobURL(): string | null {
		if (!this.isSaveAvailable()) return null;

		const ab = this.exportSMFToArrayBuffer();
		return createURLForData(ab, 'audio/midi');
	}

	public saveAsMIDI(baseElement: HTMLElement) {
		const url = this.makeSMFBlobURL();
		if (url === null) return false;
		const frm = document.createElement('iframe');
		frm.src = url;
		baseElement.appendChild(frm);
		return true;
	}

	public loadFromJSON(text: string): boolean {
		const obj = _fromJSON(text);
		if (
			obj === null ||
			obj === undefined ||
			!(obj.parts instanceof Array) ||
			!(obj.masterControls instanceof Array) ||
			// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
			!(!obj.backgroundChords || obj.backgroundChords instanceof Array) ||
			// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
			!(!obj.backgroundEndPos || obj.backgroundEndPos instanceof Array)
		) {
			return false;
		}

		this.parts = [];
		this.parts.length = obj.parts.length;
		for (let i = 0; i < this.parts.length; ++i) {
			this.parts[i] = new Part();
			this.parts[i].fromJSONObject(obj.parts[i]);
		}
		this.parts[0].attachEngine(this);
		this.masterControls = [];
		this.masterControls.length = obj.masterControls.length;
		for (let i = 0; i < this.masterControls.length; ++i) {
			this.masterControls[i] = getControlFromJSONObject(
				obj.masterControls[i]
			);
		}
		updateControlArray(this.masterControls);
		sortNotesAndControls(this.masterControls);
		this.smfDivision = obj.smfDivision;
		this.tempo = obj.currentTempo;
		this.updateMasterControls();

		this._afterLoadSMF();

		this.raiseEventFileLoaded();
		return true;
	}

	public saveAsJSON(): string {
		const obj = {
			currentTempo: this.tempo,
			parts: this.parts,
			masterControls: this.masterControls,
			smfDivision: this.smfDivision,
		};
		return _toJSON(obj);
	}

	protected _afterLoadSMF(): void {
		// empty
	}

	public _afterAttachEngine(_obj: ISequencerObject) {
		//
	}

	public _beforeDetachEngine(_obj: ISequencerObject) {
		//
	}
}
