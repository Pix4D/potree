import { Color, Vector4 } from 'three';

export type Gradient = [number, Color][];
export type Classification = { [value: string]: Vector4; DEFAULT: Vector4 };
