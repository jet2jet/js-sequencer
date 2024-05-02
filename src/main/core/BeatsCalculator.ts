import { gcd } from '../functions';

export default class BeatsCalculator {
	public posNumerator: number = 0;
	public posDenominator: number = 4;
	public beatsNumerator: number = 4;
	public beatsDenominator: number = 4;
	public posDenPerGcd: number = 1; // posDenominator / gcd

	public incrementPosition(delta: number): void {
		this.posNumerator += delta * this.posDenPerGcd;
	}
	public changeTimeSignature(
		beatsNumerator: number,
		beatsDenominator: number,
		posNumerator: number,
		posDenominator: number
	): void {
		const g = gcd(posDenominator, beatsDenominator);
		const q = beatsDenominator / g;
		this.posNumerator = posNumerator * q;
		this.posDenominator = posDenominator * q;
		this.posDenPerGcd =
			this.posDenominator / gcd(this.posDenominator, beatsDenominator);
		this.beatsNumerator = beatsNumerator;
		this.beatsDenominator = beatsDenominator;
	}
}
