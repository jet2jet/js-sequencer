import { gcd, isUndefined } from '../functions';
import IPositionObject from './IPositionObject';

export default class PositionObject implements IPositionObject {
	public numerator: number;
	public denominator: number;
	public real?: number;

	constructor(num: number, den: number) {
		this.numerator = num;
		this.denominator = den;
	}
	public toJSON(): any {
		return this;
	}
	public fromJSONObject(obj: any) {
		if (!isUndefined(obj.numerator)) this.numerator = obj.numerator;
		else this.numerator = obj.position;
		if (!isUndefined(obj.denominator)) this.denominator = obj.denominator;
		else this.denominator = obj.positionFraction;
	}

	public addPosition(pos: IPositionObject) {
		const g = gcd(this.denominator, pos.denominator);
		return new PositionObject(
			(this.numerator * pos.denominator +
				pos.numerator * this.denominator) /
				g,
			(this.denominator * pos.denominator) / g
		);
	}
	public addPositionDirect(numerator: number, denominator: number) {
		const g = gcd(this.denominator, denominator);
		return new PositionObject(
			(this.numerator * denominator + numerator * this.denominator) / g,
			(this.denominator * denominator) / g
		);
	}
	public addPositionMe(pos: IPositionObject) {
		const g = gcd(this.denominator, pos.denominator);
		const n =
			(this.numerator * pos.denominator +
				pos.numerator * this.denominator) /
			g;
		const d = (this.denominator * pos.denominator) / g;
		this.numerator = n;
		this.denominator = d;
	}
	public addPositionMeDirect(numerator: number, denominator: number) {
		const g = gcd(this.denominator, denominator);
		const n =
			(this.numerator * denominator + numerator * this.denominator) / g;
		const d = (this.denominator * denominator) / g;
		this.numerator = n;
		this.denominator = d;
	}
}
