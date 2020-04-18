import BackgroundChord from '../objects/BackgroundChord';
import IPositionObject from '../objects/IPositionObject';
import ISequencerObject from '../objects/ISequencerObject';
import PositionObject from '../objects/PositionObject';

import ControlObject from './controls/ControlObject';
import TimeSignatureControl from './controls/TimeSignatureControl';

import {
	gcd,
	getItemFromArray,
	isUndefined,
	loadBinaryFromFile,
	removeItemFromArray,
} from '../functions';
import MyWeakMap, {
	createWeakMap,
	getWeakMap,
	setWeakMap,
} from '../functions/MyWeakMap';

import EditorEventObjectMap from '../events/EditorEventObjectMap';
import EngineEventObjectMap from '../events/EngineEventObjectMap';
import EventObjectBase from '../events/EventObjectBase';
import MaxChangedEventObject from '../events/MaxChangedEventObject';
import ResizeEventObject from '../events/ResizeEventObject';
import ScrollEventObject from '../events/ScrollEventObject';

import BeatsCalculator from './BeatsCalculator';
import Engine, { sortNotesAndControls } from './Engine';
import NoteObject from './NoteObject';
import Part from './Part';

import Player from './Player';

declare global {
	interface HTMLElement {
		currentStyle?: CSSStyleDeclaration;
	}
	interface CSSStyleDeclaration {
		pixelLeft?: number;
		pixelTop?: number;
	}
	interface Window {
		scrollLeft?: number;
		scrollTop?: number;
	}
}

interface Coord {
	x: number;
	y: number;
}

const NOTE_HEIGHT = 16;
const NOTE_WIDTH = 60; // width of a quarter note
const NOTE_PADDING_X = 50;
const NOTE_PADDING_Y = 60;

export const enum MouseMode {
	MOUSEMODE_DRAW = 0,
	MOUSEMODE_MOVE = 1,
	MOUSEMODE_DELETE = 2,
}

const MAX_TOPMOST_VALUE = 127;
let MIN_TOPMOST_VALUE = 0;

function getScrollTop(): number {
	if (!isUndefined(window.scrollY)) {
		return window.scrollY;
	} else if (!isUndefined(window.scrollTop)) {
		return window.scrollTop;
	} else if (!isUndefined(document.body.scrollTop)) {
		if (
			document.documentElement &&
			!isUndefined(document.documentElement.scrollTop)
		) {
			return document.documentElement.scrollTop;
		}
		return document.body.scrollTop;
	}
	return 0;
}

function getLeft(elem: HTMLElement): number {
	if (!isUndefined(elem.offsetLeft)) {
		return elem.offsetLeft;
	}
	const cs = elem.style;
	return !isUndefined(cs.pixelLeft) ? cs.pixelLeft : 0;
}
function getTop(elem: HTMLElement): number {
	if (!isUndefined(elem.offsetTop)) {
		return elem.offsetTop;
	}
	const cs = elem.style;
	return !isUndefined(cs.pixelTop) ? cs.pixelTop : 0;
}
function getOffsetX(elem: HTMLElement, e: MouseEvent): number {
	return e.clientX + document.body.scrollLeft - getLeft(elem);
}
function getOffsetY(elem: HTMLElement, e: MouseEvent): number {
	return e.clientY + getScrollTop() - getTop(elem);
}

// 指定された座標を、指定された丸め値を使用した座標に丸めて返す
//   actX, actY: 編集領域の左上座標
// return: [object] ({ x: xVal, y: yVal })
function calcNotePosEx(actX: number, actY: number, denominator: number): Coord {
	const wd = (NOTE_WIDTH * 4) / denominator;
	return {
		x: Math.floor((actX - NOTE_PADDING_X) / wd) * wd + NOTE_PADDING_X,
		y:
			Math.floor((actY - NOTE_PADDING_Y) / NOTE_HEIGHT) * NOTE_HEIGHT +
			NOTE_PADDING_Y,
	};
}
// 指定された座標を、音符を配置できる座標に丸めて返す
//   actX, actY: 編集領域の左上座標
function calcNotePos(_this: EditorEngine, actX: number, actY: number): Coord {
	return calcNotePosEx(actX, actY, _this.notePosDenominator);
}
// 指定された座標を、音符の長さを設定できる座標に丸めて返す
//   actX, actY: 編集領域の左上座標
function calcNoteLength(
	_this: EditorEngine,
	actX: number,
	actY: number
): Coord {
	return calcNotePosEx(actX, actY, _this.noteLengthDenominator);
}

function notePosToX(posNumerator: number, posDenominator: number) {
	return ((posNumerator * 4) / posDenominator) * NOTE_WIDTH;
}

function noteXToNearestPos(x: number, posDen: number) {
	const wd = (NOTE_WIDTH * 4) / posDen;
	const pos = Math.floor(0.5 + x / wd);
	return pos;
}

function calcBackgroundPositionY(noteTopmostValue: number) {
	// 基準値が12の倍数(60)でないときは以下の処理を行う
	// noteTopmostValue -= 60; while (noteTopmostValue < 0) noteTopmostValue += 12;
	// 画像は11(=B)が一番上に来る
	noteTopmostValue++;
	noteTopmostValue %= 12;
	return noteTopmostValue * NOTE_HEIGHT;
}

function calcLabelPositionY(i: number, noteTopmostValue: number) {
	return (noteTopmostValue - i * 12) * NOTE_HEIGHT + NOTE_PADDING_Y;
}

function initControlObjectElement(
	c: ControlObject,
	controlElementMap: MyWeakMap<HTMLElement, ControlObject>
) {
	if (c.element) {
		c.textNode!.nodeValue = c.getText();
		return;
	}
	c.element = document.createElement('span');
	setWeakMap(controlElementMap, c.element, c);
	c.element.style.cursor = 'default';
	c.element.style.position = 'absolute';
	c.element.style.fontSize = '11pt';
	c.element.style.whiteSpace = 'noWrap';

	c.textNode = document.createTextNode(c.getText());
	c.element.appendChild(c.textNode);
}
function moveControlObject(c: ControlObject, x: number, y: number) {
	c.x = x;
	c.y = y;
	if (!c.element) {
		return;
	}
	const l = NOTE_PADDING_X;
	const t = 0;
	c.element.style.left = x + l + 'px';
	c.element.style.top = y + t + 'px';
	// if (!this.txtNode) { this.txtNode = document.createTextNode(""); this.element.appendChild(this.txtNode); }
	// this.txtNode.nodeValue = l + ", " + t;
	c.element.style.display =
		x < -NOTE_WIDTH ||
		x >= (c.engine as EditorEngine).getEditWidth() ||
		y < 0 ||
		y >= (c.engine as EditorEngine).getEditHeight()
			? 'none'
			: '';
}
function updateControlObjectPosition(obj: ControlObject) {
	let c: ControlObject | null;
	const j = obj.parentArray ? getItemFromArray(obj.parentArray, obj) : -1;
	if (j > 0) {
		c = obj.parentArray![j - 1];
	} else {
		c = null;
	}
	let y = 1;
	if (
		c !== null &&
		c.notePosNumerator * obj.notePosDenominator ===
			obj.notePosNumerator * c.notePosDenominator &&
		c.y > 0
	) {
		y = c.y + 13;
	}
	moveControlObject(
		obj,
		notePosToX(obj.notePosNumerator, obj.notePosDenominator) -
			(obj.engine as EditorEngine).scrollPosX,
		y
	);

	if (obj.textNode) {
		obj.textNode.nodeValue = obj.getText();
	}
}

function initNoteObjectElement(
	n: NoteObject,
	noteElementMap: MyWeakMap<HTMLElement, NoteObject>
) {
	if (n.element) {
		return;
	}

	n.element = document.createElement('span');
	setWeakMap(noteElementMap, n.element, n);
	const wd =
		((n.noteLengthNumerator * 4) / n.noteLengthDenominator) * NOTE_WIDTH;
	{
		const s = n.element.style;
		s.display = 'block';
		s.position = 'absolute';
		s.width = wd + 'px';
		s.height = NOTE_HEIGHT + 'px';
		s.backgroundColor = '#ff00ff';
		s.borderColor = '#000000';
		s.borderStyle = 'solid';
		s.borderWidth = '1px';
		s.fontSize = '6pt';
		s.boxSizing = 'border-box';
	}
}

function moveNoteObject(n: NoteObject, x: number, y: number) {
	n.x = x;
	n.y = y;

	if (!n.element) {
		return;
	}
	const l = 0;
	const t = 1;
	// let wd = (n.noteLengthNumerator * 4 / n.noteLengthDenominator) * NOTE_WIDTH;
	n.element.style.left = x + l + 'px';
	n.element.style.top = y + t + 'px';
	// if (!this.txtNode) { this.txtNode = document.createTextNode(""); n.element.appendChild(this.txtNode); }
	// n.txtNode.nodeValue = l + ", " + t;
	// n.element.style.display = (x + wd < 0 || x >= this.sequencer._width ||
	// 	y < NOTE_PADDING_Y || y >= this.sequencer._height) ? "none" : "block";
	n.element.style.display = 'block';
}
function updateNoteObjectPosition(n: NoteObject) {
	// moveNoteObject(n, notePosToX(n.notePosNumerator, n.notePosDenominator) + NOTE_PADDING_X,
	// 	(n.engine.noteTopmostValue - n.noteValue) * NOTE_HEIGHT + NOTE_PADDING_Y);
	moveNoteObject(
		n,
		notePosToX(n.notePosNumerator, n.notePosDenominator) + NOTE_PADDING_X,
		(MAX_TOPMOST_VALUE - n.noteValue) * NOTE_HEIGHT + NOTE_PADDING_Y
	);
}
function updateNoteObjectLength(n: NoteObject) {
	if (!n.element) {
		return;
	}

	const wd =
		((n.noteLengthNumerator * 4) / n.noteLengthDenominator) * NOTE_WIDTH;
	n.element.style.width = wd + 'px';
}

// valが極力1になるように値を調整する
// return: [object] ({ value: val, fraction: frac })
function normalizeDenominator(val: number, denominator: number) {
	if (!val) {
		return { value: val, denominator: denominator };
	}
	// val===fracなら1
	if (val === denominator) {
		val = denominator = 1;
	} else {
		// 最大公約数で割る
		const q = gcd(val, denominator);
		val /= q;
		denominator /= q;
	}
	return { value: val, denominator: denominator };
}

function _initPartList(
	listElement: HTMLSelectElement,
	parts: Part[],
	curPart: Part
) {
	while (listElement.options.length > 0) {
		listElement.removeChild(listElement.options[0]);
	}

	parts.forEach((p, i) => {
		const opt = document.createElement('option');
		opt.value = i.toString();
		opt.appendChild(document.createTextNode('Part ' + (i + 1).toString()));
		if (p === curPart) {
			opt.selected = true;
		}
		listElement.appendChild(opt);
	});
}

export default class EditorEngine extends Engine {
	public backgroundChords: BackgroundChord[] = [];
	public backgroundEndPos: IPositionObject | null = null;

	public scrollPosX: number;
	public scrollPosY: number;

	public notePosDenominator: number = 4;
	public noteLengthDenominator: number = 4;

	private player: Player | null;
	private playerNote: Player | null;
	private sfontMapData: Array<[number, number, number]> = [];
	private sfontMapDataId: number = 1;
	private curPart: Part | null = null;
	private baseElement: HTMLElement;
	private parentElement: HTMLElement;
	private markerBeforeCPElement: HTMLElement;
	private controlParentElement: HTMLElement;
	private pianoElement: HTMLElement;
	private beatPositionLabels: HTMLElement[];
	private keyPositionLabels: HTMLElement[];
	private linesHorizontal: HTMLElement[];
	private linesVertical: HTMLElement[];
	private listElement: HTMLSelectElement | null;
	private _width: number;
	private _height: number;
	private noteTopmostValue: number; // 画面で一番上に来る音符の値
	private noteDragging: NoteObject | null; // マウスのボタンが押された瞬間に選択している音符
	private controlElementMap: MyWeakMap<HTMLElement, ControlObject>; // ControlObjectとHTMLElementのWeakMap
	private noteElementMap: MyWeakMap<HTMLElement, NoteObject>; // NoteObjectとHTMLElementのWeakMap
	// private xRelative: number;          // マウスのボタンが押された瞬間に選択した音符からのマウスの相対x座標
	private mouseMode: MouseMode; // マウスによる編集モード
	private isMoveDragMode: boolean; // 音符をドラッグして移動するモードかどうか
	private maxScrollX: number;
	private maxScrollY: number;
	private _evtScrollX: Array<(e: ScrollEventObject) => void>;
	private _evtScrollY: Array<(e: ScrollEventObject) => void>;
	private _evtResize: Array<(e: ResizeEventObject) => void>;
	private _evtMaxChanged: Array<(e: MaxChangedEventObject) => void>;

	private fnMouseDown: (e: MouseEvent) => void;
	private fnMouseUp: (e: MouseEvent) => void;
	private fnMouseMove: (e: MouseEvent) => void;
	private fnDblClick: (e: MouseEvent) => void;

	constructor(elementId: string) {
		super();

		this.player = null;
		this.playerNote = null;

		this.fnMouseDown = this.onMouseDown.bind(this);
		this.fnMouseUp = this.onMouseUp.bind(this);
		this.fnMouseMove = this.onMouseMove.bind(this);
		this.fnDblClick = this.onDblClick.bind(this);

		this.baseElement = document.getElementById(elementId)!;
		{
			const s = this.baseElement.style;
			s.display = 'block';
			s.position = 'relative';
			s.overflow = 'scroll';
		}
		this.listElement = null;
		this._width = this.baseElement.offsetWidth - 0;
		this._height = this.baseElement.offsetHeight - 0;
		MIN_TOPMOST_VALUE =
			Math.floor((this._height - NOTE_PADDING_Y) / NOTE_HEIGHT) - 1;
		if (MIN_TOPMOST_VALUE < 0) {
			MIN_TOPMOST_VALUE = 0;
		}

		this.noteTopmostValue = 78;
		this.noteDragging = null;
		this.controlElementMap = createWeakMap();
		this.noteElementMap = createWeakMap();
		// this.xRelative = 0;
		this.mouseMode = MouseMode.MOUSEMODE_DRAW;
		this.isMoveDragMode = false;
		this.maxScrollX = 10000;
		this.maxScrollY =
			(MAX_TOPMOST_VALUE + 1) * NOTE_HEIGHT +
			NOTE_PADDING_Y -
			this._height;
		this._evtScrollX = [];
		this._evtScrollY = [];
		this._evtResize = [];
		this._evtMaxChanged = [];

		this.parentElement = document.createElement('span');
		{
			const s = this.parentElement.style;
			s.display = 'block';
			s.position = 'absolute';
			s.left = '0px';
			s.top = '0px';
			s.width = (this.maxScrollX + this._width).toString() + 'px';
			s.height = (this.maxScrollY + this._height).toString() + 'px';
			s.overflow = 'hidden';
		}
		this.baseElement.appendChild(this.parentElement);

		this.markerBeforeCPElement = document.createElement('span');
		{
			const s = this.markerBeforeCPElement.style;
			s.display = 'none';
		}
		this.parentElement.appendChild(this.markerBeforeCPElement);

		this.controlParentElement = document.createElement('span');
		{
			const s = this.controlParentElement.style;
			s.display = 'block';
			s.overflow = 'hidden';
			s.position = 'absolute';
			s.left = (0).toString() + 'px';
			s.top = '0px';
			s.width = (this._width - 0).toString() + 'px';
			s.height = NOTE_PADDING_Y.toString() + 'px';
			const p = this.baseElement;
			let ss: CSSStyleDeclaration;
			if (window.getComputedStyle) {
				ss = window.getComputedStyle(p, null);
			} else if (p.currentStyle) {
				ss = p.currentStyle;
			} else {
				ss = p.style;
			}
			s.backgroundColor = ss.backgroundColor || '#fff';
		}
		this.parentElement.appendChild(this.controlParentElement);

		// ピアノ表示
		this.pianoElement = document.createElement('span');
		{
			const s = this.pianoElement.style;
			s.display = 'block';
			s.backgroundImage = 'url(pianor.png)';
			s.backgroundRepeat = 'repeat-y';
			s.position = 'absolute';
			s.left = '0px';
			s.top = NOTE_PADDING_Y.toString() + 'px';
			s.width = NOTE_PADDING_X.toString() + 'px';
			s.height = (this._height - NOTE_PADDING_Y).toString() + 'px';
		}
		this.parentElement.appendChild(this.pianoElement);

		this.beatPositionLabels = [];
		this.beatPositionLabels.length = 10;
		for (let i = 0; i < this.beatPositionLabels.length; ++i) {
			const m = document.createElement('span');
			{
				const s = m.style;
				s.fontSize = '14px';
				s.position = 'absolute';
				s.cursor = 'default';
				s.whiteSpace = 'noWrap';
				s.top = (NOTE_PADDING_Y - 16).toString() + 'px';
			}
			m.appendChild(document.createTextNode(''));
			this.controlParentElement.appendChild(m);
			this.beatPositionLabels[i] = m;
		}
		this.keyPositionLabels = [];
		this.keyPositionLabels.length = 11;
		for (let i = 0; i <= 10; ++i) {
			const m = document.createElement('span');
			{
				const s = m.style;
				s.fontSize = (NOTE_HEIGHT - 1).toString() + 'px';
				s.position = 'absolute';
				s.cursor = 'default';
				s.whiteSpace = 'noWrap';
				s.left = (NOTE_PADDING_X - 30).toString() + 'px';
				s.overflow = 'hidden';
			}
			m.appendChild(document.createTextNode('C' + (i - 1).toString()));
			this.parentElement.appendChild(m);
			this.keyPositionLabels[i] = m;
		}
		this.linesHorizontal = [];
		this.linesVertical = [];

		// this.scrollX(0);
		// this.scrollY(0);
		this.scrollPosX = 0;
		this.scrollPosY = this.baseElement.scrollTop =
			(MAX_TOPMOST_VALUE - this.noteTopmostValue) * NOTE_HEIGHT;

		this.parentElement.addEventListener('mousedown', this.fnMouseDown);
		// addEventHandler(this.baseElement, "mousemove", this.fnMouseMove);
		const rt = document.documentElement;
		rt.addEventListener('mousemove', this.fnMouseMove);
		this.parentElement.addEventListener('mouseup', this.fnMouseUp);
		this.baseElement.addEventListener(
			'scroll',
			this.onScrollParent.bind(this)
		);

		window.addEventListener('resize', this.onResize.bind(this));

		this.reset();
		this.calcLastScrollXWithSortedNotes();
		this.updateScrollStatus(true);
	}

	public static posToPixelX(pos: IPositionObject): number {
		return notePosToX(pos.numerator, pos.denominator);
	}

	public initializePlayer(
		workerJs: string,
		depsJs: string[],
		workletJs: string[],
		interval?: number
	) {
		return Player.instantiate(this, workerJs, depsJs, true, interval)
			.then((p) => {
				this.player = p;
				p.setAudioWorkletScripts(workletJs);
				return Player.instantiate(this, workerJs, depsJs, true, 15);
			})
			.then(
				(p) => {
					this.playerNote = p;
					p.setAudioWorkletScripts(workletJs);
					p.setRenderFrameCount(1024);
					p.setPlayOptions({
						prerenderSeconds: 0,
						maxQueueSeconds: 0.0625,
					});
				},
				(e) => {
					this.player!.close();
					this.player = null;
					return Promise.reject(e);
				}
			);
	}

	public getPlayer() {
		return this.player;
	}

	public getPlayerForNote() {
		return this.playerNote;
	}

	public loadSoundfont(bin: ArrayBuffer) {
		return this.player!.loadSoundfont(bin).then(() =>
			this.playerNote!.loadSoundfont(bin)
		);
	}

	public loadSoundfontFromFile(fileElemId: string | HTMLInputElement) {
		return loadBinaryFromFile(fileElemId).then((bin) =>
			this.loadSoundfont(bin)
		);
	}

	public unloadSoundfont() {
		return this.player!.unloadSoundfont().then(() =>
			this.playerNote!.unloadSoundfont()
		);
	}

	public isSoundfontLoaded() {
		return this.player!.isSoundfontLoaded();
	}

	public addSoundfontForMap(sfontBin: ArrayBuffer) {
		return this.player!.addSoundfontForMap(sfontBin).then((sf1) => {
			return this.playerNote!.addSoundfontForMap(sfontBin).then((sf2) => {
				const id = this.sfontMapDataId++;
				this.sfontMapData.push([id, sf1, sf2]);
				return id;
			});
		});
	}

	public addSoundfontForMapFromFile(fileElemId: string | HTMLInputElement) {
		return loadBinaryFromFile(fileElemId).then((bin) =>
			this.addSoundfontForMap(bin)
		);
	}

	public addPresetMapWithSoundfont(
		sfont: number,
		targetBank: number,
		targetPreset: number,
		bank: number,
		preset: number
	) {
		for (const m of this.sfontMapData) {
			if (m[0] === sfont) {
				this.player!.addPresetMapWithSoundfont(
					m[1],
					targetBank,
					targetPreset,
					bank,
					preset
				);
				this.playerNote!.addPresetMapWithSoundfont(
					m[2],
					targetBank,
					targetPreset,
					bank,
					preset
				);
				break;
			}
		}
	}

	public getAllMapForSoundfont(sfont: number) {
		let found = sfont < 0;
		if (!found) {
			for (const m of this.sfontMapData) {
				if (m[0] === sfont) {
					sfont = m[1];
					found = true;
					break;
				}
			}
		}
		if (found) {
			return this.player!.getAllMapForSoundfont(sfont);
		} else {
			return [];
		}
	}

	public removeProgramMap(
		sfont: number,
		targetBank?: number,
		targetPreset?: number
	) {
		for (let i = 0, len = this.sfontMapData.length; i < len; ++i) {
			const m = this.sfontMapData[i];
			if (m[0] === sfont) {
				const b1 = this.player!.removeProgramMap(
					m[1],
					targetBank,
					targetPreset
				);
				const b2 = this.playerNote!.removeProgramMap(
					m[2],
					targetBank,
					targetPreset
				);
				if (!b1 && !b2) {
					this.sfontMapData.splice(i, 1);
					return false;
				}
				return true;
			}
		}
		return true;
	}

	public reset() {
		super.reset();
		if (this.curPart) {
			this.curPart.detachEngine();
		}
		this.curPart = new Part();
		this.parts = [this.curPart];
		this.curPart.attachEngine(this);
		this.backgroundChords = [];
		this.backgroundEndPos = null;
	}

	public setBackgroundChords(
		chords: BackgroundChord[],
		endPos: IPositionObject
	) {
		this.backgroundChords = chords;
		this.backgroundEndPos = endPos;
	}

	public changeCurrentPart(index: number) {
		if (index < 0 || index >= this.parts.length) {
			return;
		}
		const p = this.parts[index];
		if (this.curPart !== p) {
			if (this.curPart) {
				this.curPart.detachEngine();
			}
			this.curPart = p;
			p.attachEngine(this);
		}
	}

	/** @internal */
	protected _afterLoadSMF() {
		super._afterLoadSMF();
		this.curPart = this.parts[0];
		if (this.baseElement) {
			this.calcLastScrollXWithSortedNotes();
			this.scrollX(0);
			if (this.listElement) {
				_initPartList(this.listElement, this.parts, this.curPart!);
			}
		}
	}

	/** @internal */
	public _afterAttachEngine(obj: ISequencerObject): void {
		if (obj instanceof ControlObject) {
			initControlObjectElement(obj, this.controlElementMap);
			if (obj.element) {
				this.appendControlElement(obj.element);
				updateControlObjectPosition(obj);
			}
		} else if (obj instanceof NoteObject) {
			initNoteObjectElement(obj, this.noteElementMap);
			const elem = obj.element!;
			this.appendNoteElement(elem);
			elem.addEventListener('mousedown', this.fnMouseDown);
			elem.addEventListener('mousemove', this.fnMouseMove);
			elem.addEventListener('mouseup', this.fnMouseUp);
			elem.addEventListener('dblclick', this.fnDblClick);
			updateNoteObjectLength(obj);
			updateNoteObjectPosition(obj);
		}
	}

	/** @internal */
	public _beforeDetachEngine(obj: ISequencerObject): void {
		if (obj instanceof ControlObject) {
			if (obj.element) {
				this.removeControlElement(obj.element);
			}
		} else if (obj instanceof NoteObject) {
			const elem = obj.element;
			if (elem) {
				elem.removeEventListener('mousedown', this.fnMouseDown);
				elem.removeEventListener('mousemove', this.fnMouseMove);
				elem.removeEventListener('mouseup', this.fnMouseUp);
				elem.removeEventListener('dblclick', this.fnDblClick);
				this.removeNoteElement(elem);
			}
		}
	}

	private _initHorizontalLines() {
		const lines = this.linesHorizontal;

		// let n = this.noteTopmostValue % 12;
		let actualValue =
			MAX_TOPMOST_VALUE -
			Math.floor(this.baseElement.scrollTop / NOTE_HEIGHT);
		let n = actualValue % 12;
		const iMax =
			Math.floor((this._height - NOTE_PADDING_Y) / NOTE_HEIGHT) + 1;
		let iElement = 0;
		for (let i = 0; i <= iMax; i++) {
			let bgColor = '#ffffff';
			// 黒鍵部分は色を変える
			if (n === 1 || n === 3 || n === 6 || n === 8 || n === 10) {
				// drawFillRect(ctx, "#c0c0c0", 0, i * NOTE_HEIGHT + NOTE_PADDING_Y,
				// 	this._width, (i + 1) * NOTE_HEIGHT + NOTE_PADDING_Y);
				bgColor = '#c0c0c0';
			}
			if (--n < 0) {
				n += 12;
			}
			let elem = lines[iElement];
			let s = elem && elem.style;
			if (!elem) {
				lines[iElement] = elem = document.createElement('span');
				s = elem.style;
				s.display = 'block';
				s.position = 'absolute';
				s.width = (this._width - NOTE_PADDING_X).toString() + 'px';
				s.height = NOTE_HEIGHT + 1 + 'px';
				s.boxSizing = s.webkitBoxSizing = 'border-box';
				s.borderTopStyle = 'solid';
				s.borderTopWidth = '1px';
				s.borderBottomStyle = 'solid';
				s.borderBottomWidth = '1px';
				s.overflow = 'hidden';
			}

			s.left = (NOTE_PADDING_X + this.scrollPosX).toString() + 'px';
			s.top =
				(
					(MAX_TOPMOST_VALUE - actualValue) * NOTE_HEIGHT +
					NOTE_PADDING_Y
				).toString() + 'px';
			s.borderColor = '#808080';
			s.backgroundColor = bgColor;
			if (!elem.parentNode) {
				// this.parentElement.insertBefore(elem, this.controlParentElement);
				this.parentElement.insertBefore(
					elem,
					this.markerBeforeCPElement
				);
			}
			++iElement;
			--actualValue;
		}
		for (; iElement < lines.length; ++iElement) {
			this.parentElement.removeChild(lines[iElement]);
		}
	}

	private _initVerticalLines() {
		const lines = this.linesVertical;

		const bc = new BeatsCalculator();
		let nextPosNumerator = 0;
		let nextPosDenominator = 4;
		let x = NOTE_PADDING_X - this.scrollPosX;
		let i = 0;
		let iCPos = 0;
		const ctrls = this.masterControls ? this.masterControls : null;
		let iElement = 0;
		while (true) {
			if (x > this._width) {
				break;
			}
			if (
				ctrls &&
				nextPosNumerator >= 0 &&
				bc.posNumerator * nextPosDenominator >=
					nextPosNumerator * bc.posDenominator
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
							i = 0;
							iCPos++;
							if (iCPos === ctrls.length) {
								nextPosNumerator = -1;
								break;
							}
						} else {
							nextPosNumerator = c.notePosNumerator;
							nextPosDenominator = c.notePosDenominator;
							break;
						}
					} else {
						iCPos++;
					}
				}
			}
			if (x >= NOTE_PADDING_X - 3) {
				const isFirstBeat = i % bc.beatsNumerator === 0;

				let elem = lines[iElement];
				if (!elem) {
					lines[iElement] = elem = document.createElement('span');
					elem.style.display = 'block';
					elem.style.position = 'absolute';
					elem.style.width = '1px';
					// elem.style.height = (MAX_TOPMOST_VALUE * NOTE_HEIGHT + NOTE_PADDING_Y).toString() + "px";
					elem.style.height =
						this.baseElement.offsetHeight.toString() + 'px';
					elem.style.borderLeftStyle = 'solid';
					elem.style.borderLeftWidth = '1px';
					elem.style.overflow = 'hidden';
				}

				elem.style.top = this.scrollPosY.toString() + 'px';
				elem.style.left = (x + this.scrollPosX).toString() + 'px';
				elem.style.borderColor = isFirstBeat ? '#0000ff' : '#404040';
				if (!elem.parentNode) {
					this.parentElement.insertBefore(elem, this.pianoElement);
				}
				// this.parentElement.appendChild(elem);
				++iElement;
			}
			// x += NOTE_WIDTH * 4 / bc.beatsFraction;
			bc.incrementPosition(1);
			++i;
			x =
				NOTE_PADDING_X -
				this.scrollPosX +
				(NOTE_WIDTH * 4 * bc.posNumerator) / bc.posDenominator;
		}
		for (; iElement < lines.length; ++iElement) {
			if (lines[iElement].parentNode) {
				this.parentElement.removeChild(lines[iElement]);
			}
		}
	}

	// this : Sequencer
	private onResize(_e: Event) {
		this.resize();
	}

	// this : Sequencer
	private onMouseDown(e: MouseEvent) {
		const x = getOffsetX(this.baseElement, e);
		const y = getOffsetY(this.baseElement, e);
		const sx = x + this.scrollPosX;
		const sy = y + this.scrollPosY;
		if (
			x >= NOTE_PADDING_X &&
			x < this._width &&
			y >= NOTE_PADDING_Y &&
			y < this._height
		) {
			const a = calcNotePos(this, sx, sy);
			const t = e.target || e.srcElement;
			let n: NoteObject | null | undefined;
			if (this.mouseMode === MouseMode.MOUSEMODE_DELETE) {
				if (t) {
					n = getWeakMap(this.noteElementMap, t);
					if (n) {
						n.detachEngine();
						removeItemFromArray(this.curPart!.notes, n);
					}
				}
			} else {
				// let noteValue = this.noteTopmostValue - Math.floor((a.y - NOTE_PADDING_Y) / NOTE_HEIGHT);
				const noteValue = Math.floor(
					MAX_TOPMOST_VALUE - (a.y - NOTE_PADDING_Y) / NOTE_HEIGHT
				);
				n = t && getWeakMap(this.noteElementMap, t);
				if (n) {
					// this.xRelative = (sx) - n.x;
				} else {
					const _curPart = this.curPart!;
					const pos = noteXToNearestPos(
						a.x - NOTE_PADDING_X,
						this.notePosDenominator
					);
					n = new NoteObject(
						pos,
						this.notePosDenominator,
						1,
						this.noteLengthDenominator,
						noteValue,
						_curPart.channel
					);
					n.attachEngine(this);
					_curPart.notes.push(n);
					// this.xRelative = 0;
				}
				this.isMoveDragMode =
					(this.mouseMode === MouseMode.MOUSEMODE_MOVE) ===
					!e.shiftKey;
				this.noteDragging = n;
				if (this.playerNote) {
					this.playerNote.playNote(n);
				}
			}
		}
		e.preventDefault();
	}

	// クリックアンドドラッグで音符を移動させる場合の処理
	private onMouseMoveForMoveMode(e: MouseEvent) {
		if (!this.noteDragging) {
			return;
		}
		let x = getOffsetX(this.baseElement, e);
		let y = getOffsetY(this.baseElement, e);
		const sx = x + this.scrollPosX;
		const sy = y + this.scrollPosY;
		if (x < NOTE_PADDING_X) {
			// スクロール
			if (this.scrollPosX > 0) {
				x = NOTE_PADDING_X;
				this.scrollX(-((NOTE_WIDTH * 4) / this.notePosDenominator));
			}
		} else if (x >= this._width) {
			// スクロール
			x = this._width - 1;
			this.scrollX((NOTE_WIDTH * 4) / this.notePosDenominator);
		}
		if (y < NOTE_PADDING_Y) {
			// スクロール
			if (this.noteTopmostValue < MAX_TOPMOST_VALUE) {
				y = NOTE_PADDING_Y;
				this.scrollY(-NOTE_HEIGHT);
			}
		} else if (y >= this._height) {
			// スクロール
			if (this.noteTopmostValue > MIN_TOPMOST_VALUE) {
				y = this._height - 1;
				this.scrollY(NOTE_HEIGHT);
			}
		}
		if (
			x >= NOTE_PADDING_X &&
			x < this._width &&
			y >= NOTE_PADDING_Y &&
			y < this._height
		) {
			const n = this.noteDragging;
			const a = calcNotePos(this, sx, sy);
			if (a.x !== n.x || a.y !== n.y) {
				if (a.y !== n.y) {
					// let noteValue = this.noteTopmostValue - Math.floor((a.y - NOTE_PADDING_Y) / NOTE_HEIGHT);
					const noteValue = Math.floor(
						MAX_TOPMOST_VALUE - (a.y - NOTE_PADDING_Y) / NOTE_HEIGHT
					);
					n.setNoteValue(noteValue);
					if (this.playerNote) {
						this.playerNote.playNote(n);
					}
				}

				const pos = noteXToNearestPos(
					a.x - NOTE_PADDING_X,
					this.notePosDenominator
				);
				n.setPosition(pos, this.notePosDenominator);
				updateNoteObjectPosition(n);
			}
		}
		e.preventDefault();
	}

	// クリックアンドドラッグで音符を伸縮させる場合の処理
	private onMouseMoveForDrawMode(e: MouseEvent) {
		const x = getOffsetX(this.baseElement, e);
		const y = getOffsetY(this.baseElement, e);
		const sx = x + this.scrollPosX;
		const sy = y + this.scrollPosY;
		if (!this.noteDragging) {
			return;
		}
		const n = this.noteDragging;
		const a = calcNoteLength(this, sx, sy);
		// 音符の長さを描画の幅から計算
		let len =
			((a.x - n.x) * this.noteLengthDenominator) / (4 * NOTE_WIDTH) + 1;
		// 設定可能な長さより小さくなったら最小値にする
		if (len < 1) {
			len = 1;
		}
		if (
			n.noteLengthNumerator / n.noteLengthDenominator !==
			len / this.noteLengthDenominator
		) {
			const b = normalizeDenominator(len, this.noteLengthDenominator);
			n.setLength(b.value, b.denominator);
			updateNoteObjectLength(n);
		}
		e.preventDefault();
	}

	private onMouseMove(e: MouseEvent) {
		if (
			this.isMoveDragMode !==
			((this.mouseMode === MouseMode.MOUSEMODE_MOVE) === !e.shiftKey)
		) {
			e.preventDefault();
			return;
		}
		if (this.isMoveDragMode) {
			return this.onMouseMoveForMoveMode(e);
		} else {
			return this.onMouseMoveForDrawMode(e);
		}
	}

	private onMouseUp(e: MouseEvent) {
		if (this.playerNote) {
			this.playerNote.stopPlayingNote(true);
		}
		this.noteDragging = null;
		sortNotesAndControls(this.curPart!.notes);
		this.calcLastScrollXWithSortedNotes();
		e.preventDefault();
	}

	// this : Sequencer
	private onDblClick(e: MouseEvent) {
		const x = getOffsetX(this.baseElement, e);
		const y = getOffsetY(this.baseElement, e);
		// let sx = x + this.scrollX;
		// let sy = y + this.scrollY;
		if (
			x >= NOTE_PADDING_X &&
			x < this._width &&
			y >= NOTE_PADDING_Y &&
			y < this._height
		) {
			// let a = calcNotePos(this, sx, y);
			const t = e.target || e.srcElement;
			const n = t && (getWeakMap(this.noteElementMap, t) as NoteObject);
			if (n) {
				n.detachEngine();
				removeItemFromArray(this.curPart!.notes, n);
			}
		}
		e.preventDefault();
	}

	private updateScrollStatusX() {
		this.controlParentElement.style.left =
			this.scrollPosX.toString() + 'px';
		this.pianoElement.style.left = this.scrollPosX.toString() + 'px';

		let x = -this.scrollPosX + 2;
		let measure = 0;
		const ctrls = this.masterControls ? this.masterControls : null;
		let iCPos = 0;
		let labelPos = 0;
		const bc = new BeatsCalculator();
		let nextPos = 0;
		let nextPosFraction = 4;
		let iPos = 0;
		while (true) {
			if (
				ctrls &&
				nextPos >= 0 &&
				bc.posNumerator * nextPosFraction >= nextPos * bc.posDenominator
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
								// 小節の途中で拍子が変わった場合はリセットして小節数を増やさない
								iPos = 0;
								measure--;
							}
							if (iCPos === ctrls.length) {
								nextPos = -1;
								break;
							}
						} else {
							nextPos = c.notePosNumerator;
							nextPosFraction = c.notePosDenominator;
							break;
						}
					} else {
						iCPos++;
					}
				}
			}
			if (iPos === 0) {
				const sx = x;
				if (x >= -20) {
					const b = this.beatPositionLabels[labelPos];
					b.style.left =
						Math.floor(sx + NOTE_PADDING_X).toString() + 'px';
					b.style.display =
						x < -20 || x + 20 >= this._width ? 'none' : '';
					b.childNodes[0].nodeValue = measure.toString();
					labelPos++;
					if (labelPos >= this.beatPositionLabels.length) {
						break;
					}
				}
				measure++;
			}
			if (++iPos === bc.beatsNumerator) {
				iPos = 0;
			}
			// x += NOTE_WIDTH * bc.beatsNumerator * 4 / bc.beatsDenominator;
			bc.incrementPosition(1);
			x =
				2 -
				this.scrollPosX +
				(NOTE_WIDTH * 4 * bc.posNumerator) / bc.posDenominator;
		}

		const _sx = this.scrollPosX;
		this.keyPositionLabels.forEach((o) => {
			o.style.left = (NOTE_PADDING_X - 30 + _sx).toString() + 'px';
		});
	}

	private updateScrollStatusY() {
		this.controlParentElement.style.top = this.scrollPosY.toString() + 'px';

		const noteTopmostValue =
			MAX_TOPMOST_VALUE - this.scrollPosY / NOTE_HEIGHT;
		this.noteTopmostValue = noteTopmostValue;
		this.pianoElement.style.backgroundPosition =
			'0px ' +
			calcBackgroundPositionY(noteTopmostValue).toString() +
			'px';
		// this.pianoElement.style.backgroundPosition = "0px " + (this.scrollY).toString() + "px";
		this.pianoElement.style.top =
			(this.scrollPosY + NOTE_PADDING_Y).toString() + 'px';
		for (let i = 0; i < this.keyPositionLabels.length; ++i) {
			const t = calcLabelPositionY(i, noteTopmostValue);
			const vis =
				t >= NOTE_PADDING_Y && t <= this._height - (NOTE_HEIGHT - 1);
			{
				const s = this.keyPositionLabels[i].style;
				s.display = vis ? '' : 'none';
				s.top = (0 + t + this.scrollPosY).toString() + 'px';
			}
		}
	}

	private updateScrollStatus(force?: boolean) {
		let needUpdateX = !!force;
		let needUpdateY = !!force;
		{
			const newVal = this.baseElement.scrollLeft;
			if (this.scrollPosX !== newVal) {
				if (!this.raiseEventScrollX(newVal)) {
					return;
				}
				this.scrollPosX = newVal;
				needUpdateX = true;
			}
		}
		{
			const newVal = this.baseElement.scrollTop;
			if (this.scrollPosY !== newVal) {
				if (!this.raiseEventScrollY(newVal)) {
					return;
				}
				this.scrollPosY = newVal;
				needUpdateY = true;
			}
		}

		this._initHorizontalLines();
		this._initVerticalLines();

		if (needUpdateX) {
			this.updateScrollStatusX();
		}
		if (needUpdateY) {
			this.updateScrollStatusY();
		}
		this.masterControls.forEach((c) => {
			updateControlObjectPosition(c);
		});
		const p = this.curPart!;
		p.controls.forEach((c) => {
			updateControlObjectPosition(c);
		});
		p.notes.forEach((n) => {
			updateNoteObjectPosition(n);
		});
	}

	private onScrollParent(_e: Event) {
		this.updateScrollStatus();
	}

	public scrollX(delta: number) {
		this.baseElement.scrollLeft += delta;
	}

	public scrollY(delta: number) {
		this.baseElement.scrollTop += delta;
	}

	public getEditWidth(): number {
		return this._width;
	}
	public getEditHeight(): number {
		return this._height;
	}
	public getNotePaddingX(): number {
		return NOTE_PADDING_X;
	}
	public getXFromPosition(posNum: number, posDen: number): number;
	public getXFromPosition(pos: PositionObject): number;
	public getXFromPosition(
		posNum: number | PositionObject,
		posDen?: number
	): number {
		if (posNum instanceof PositionObject) {
			posDen = posNum.denominator;
			posNum = posNum.numerator;
		}
		return (NOTE_WIDTH * 4 * posNum) / posDen!;
	}

	public getMouseMode(): MouseMode {
		return this.mouseMode;
	}
	public setMouseMode(val: MouseMode) {
		if (
			val >= MouseMode.MOUSEMODE_DRAW &&
			val <= MouseMode.MOUSEMODE_DELETE
		)
			this.mouseMode = val;
	}

	public initPartList(listElementId: string) {
		if (!listElementId || !this.baseElement) {
			return;
		}

		const lst = document.getElementById(listElementId) as HTMLSelectElement;
		if (!lst) {
			return;
		}
		_initPartList(lst, this.parts, this.curPart!);

		this.listElement = lst;
	}

	public resetAll() {
		// super.resetAll();
		if (this.player) {
			this.player.resetAll();
		}
		if (this.listElement) {
			_initPartList(this.listElement, this.parts, this.curPart!);
		}
	}

	public resize() {
		if (!this.baseElement) {
			return;
		}
		this._width = this.baseElement.offsetWidth;
		this._height = this.baseElement.offsetHeight;
		MIN_TOPMOST_VALUE =
			Math.floor((this._height - NOTE_PADDING_Y) / NOTE_HEIGHT) - 1;
		if (MIN_TOPMOST_VALUE < 0) {
			MIN_TOPMOST_VALUE = 0;
		}
		this.controlParentElement.style.width =
			(this._width - NOTE_PADDING_X).toString() + 'px';

		this.calcLastScrollXWithSortedNotes();
		this.scrollX(0);
		this.scrollY(0);
		this.updateScrollStatus();

		this.raiseEventResize();
	}

	private appendNoteElement(elem: HTMLElement) {
		if (!this.baseElement) {
			return;
		}
		this.parentElement.insertBefore(elem, this.controlParentElement);
	}
	private removeNoteElement(elem: HTMLElement) {
		if (!this.baseElement) {
			return;
		}
		this.parentElement.removeChild(elem);
	}
	private appendControlElement(elem: HTMLElement) {
		if (!this.baseElement) {
			return;
		}
		this.controlParentElement.appendChild(elem);
	}
	private removeControlElement(elem: HTMLElement) {
		if (!this.baseElement) {
			return;
		}
		this.controlParentElement.removeChild(elem);
	}

	private calcLastScrollXWithSortedNotes() {
		if (!this.baseElement) {
			return;
		}

		let scMax = 0;
		let maxNote: NoteObject | null = null;
		this.parts.forEach((p) => {
			const n = p.notes[p.notes.length - 1];
			if (n) {
				const sc = notePosToX(n.notePosNumerator, n.notePosDenominator);
				if (scMax < sc) {
					scMax = sc;
					maxNote = n;
				}
			}
		});
		if (scMax < 1000) {
			scMax = 1000;
		}
		scMax = scMax + this._width;
		this.maxScrollX = scMax;
		this.parentElement.style.width = scMax.toString() + 'px';
		this.raiseEventMaxChanged(scMax, maxNote);
	}
	private raiseEventScrollX(value: number) {
		const e = new ScrollEventObject(this, value);
		for (const fn of this._evtScrollX) {
			fn(e);
			if (e.isPropagationStopped()) {
				break;
			}
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventScrollY(value: number) {
		const e = new ScrollEventObject(this, value);
		for (const fn of this._evtScrollY) {
			fn(e);
			if (e.isPropagationStopped()) {
				break;
			}
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventResize() {
		const e = new ResizeEventObject(this, this._width, this._height);
		for (const fn of this._evtResize) {
			fn(e);
			if (e.isPropagationStopped()) {
				break;
			}
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventMaxChanged(val: number, note: NoteObject | null) {
		let posNum: number;
		let posDen: number;
		if (!note) {
			posNum = 0;
			posDen = this.notePosDenominator;
		} else {
			const q = gcd(note.notePosDenominator, note.noteLengthDenominator);
			posNum =
				(note.notePosNumerator * note.noteLengthDenominator +
					note.noteLengthNumerator * note.notePosDenominator) /
				q;
			posDen = (note.notePosDenominator * note.noteLengthDenominator) / q;
		}
		const e = new MaxChangedEventObject(this, val, posNum, posDen);
		for (const fn of this._evtMaxChanged) {
			fn(e);
			if (e.isPropagationStopped()) {
				break;
			}
		}
		return !e.isDefaultPrevented();
	}

	public addEventHandler<T extends keyof EngineEventObjectMap>(
		name: T,
		fn: (e: EngineEventObjectMap[T]) => void
	): void;
	public addEventHandler<T extends keyof EditorEventObjectMap>(
		name: T,
		fn: (e: EditorEventObjectMap[T]) => void
	): void;
	public addEventHandler(name: string, fn: (e: EventObjectBase) => void) {
		let arr: any[] | null = null;
		switch (name.toLowerCase()) {
			case 'scrollx':
				arr = this._evtScrollX;
				break;
			case 'scrolly':
				arr = this._evtScrollY;
				break;
			case 'resize':
				arr = this._evtResize;
				break;
			case 'maxchanged':
				arr = this._evtMaxChanged;
				break;
		}
		if (!arr) {
			super.addEventHandler(name as keyof EngineEventObjectMap, fn);
			return;
		}
		arr.push(fn);
	}

	public removeEventHandler<T extends keyof EngineEventObjectMap>(
		name: T,
		fn: (e: EngineEventObjectMap[T]) => void
	): void;
	public removeEventHandler<T extends keyof EditorEventObjectMap>(
		name: T,
		fn: (e: EditorEventObjectMap[T]) => void
	): void;
	public removeEventHandler(name: string, fn: (e: EventObjectBase) => void) {
		let arr: any[] | null = null;
		switch (name.toLowerCase()) {
			case 'scrollx':
				arr = this._evtScrollX;
				break;
			case 'scrolly':
				arr = this._evtScrollY;
				break;
			case 'resize':
				arr = this._evtResize;
				break;
			case 'maxchanged':
				arr = this._evtMaxChanged;
				break;
		}
		if (!arr) {
			super.removeEventHandler(name as keyof EngineEventObjectMap, fn);
			return;
		}
		for (let i = arr.length - 1; i >= 0; --i) {
			if (arr[i] === fn) {
				arr.splice(i, 1);
				break;
			}
		}
	}

	public playSequenceRange(
		from?: IPositionObject | null,
		to?: IPositionObject | null
	) {
		const player = this.player;
		if (!player) {
			return;
		}
		player.playSequenceRange(
			from,
			to,
			void 0,
			this.backgroundChords,
			this.backgroundEndPos
		);
	}

	public playSequence() {
		this.playSequenceRange(null, null);
	}

	public playCurrentPartRange(
		from?: IPositionObject | null,
		to?: IPositionObject | null
	) {
		const player = this.player;
		if (!player || !this.curPart) {
			return;
		}
		player.playPartRange(
			this.curPart,
			from,
			to,
			this.backgroundChords,
			this.backgroundEndPos
		);
	}

	public playCurrentPart() {
		this.playCurrentPartRange(null, null);
	}
}
