import { ShaderMaterial, Texture } from 'three';
import { IUniform } from './types';

// see http://john-chapman-graphics.blogspot.co.at/2013/01/ssao-tutorial.html

export interface IBlurMaterialUniforms {
  [name: string]: IUniform<any>;
  near: IUniform<number>;
  far: IUniform<number>;
  screenWidth: IUniform<number>;
  screenHeight: IUniform<number>;
  map: IUniform<Texture | null>;
}

export class BlurMaterial extends ShaderMaterial {
  vertexShader = require('raw-loader!./shaders/blur.vs');
  fragmentShader = require('raw-loader!./shaders/blur.fs');
  uniforms: IBlurMaterialUniforms = {
    near: { type: 'f', value: 0 },
    far: { type: 'f', value: 0 },
    screenWidth: { type: 'f', value: 0 },
    screenHeight: { type: 'f', value: 0 },
    map: { type: 't', value: null },
  };
}
