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
		beatsDenominator: number
	): void {
		const g = gcd(this.posDenominator, beatsDenominator);
		const q = beatsDenominator / g;
		// this.posDenominator = this.posDenominator / g;
		this.posNumerator *= q;
		this.posDenominator *= q;
		this.posDenPerGcd =
			this.posDenominator / gcd(this.posDenominator, beatsDenominator);
		this.beatsNumerator = beatsNumerator;
		this.beatsDenominator = beatsDenominator;
	}
}
