import {
  AdditiveBlending,
  AlwaysDepth,
  Color,
  NearestFilter,
  NoBlending,
  RawShaderMaterial,
  Texture,
  VertexColors,
} from 'three';
import { CLASSIFICATION } from './classification';
import { ClipMode, IClipBox } from './clipping';
import { PointColorType, PointShape, PointSizeType, TreeType } from './enums';
import { GRADIENTS } from './gradients';
import {
  generateClassificationTexture,
  generateDataTexture,
  generateGradientTexture,
} from './texture-generation';
import { Gradient, IClassification, IUniform } from './types';

export interface IPointCloudMaterialParameters {
  size: number;
  minSize: number;
  maxSize: number;
  treeType: TreeType;
}

export interface IPointCloudMaterialUniforms {
  [name: string]: IUniform<any>;
  level: IUniform<number>;
  vnStart: IUniform<number>;
  spacing: IUniform<number>;
  blendHardness: IUniform<number>;
  blendDepthSupplement: IUniform<number>;
  fov: IUniform<number>;
  screenWidth: IUniform<number>;
  screenHeight: IUniform<number>;
  near: IUniform<number>;
  far: IUniform<number>;
  uColor: IUniform<Color>;
  opacity: IUniform<number>;
  size: IUniform<number>;
  minSize: IUniform<number>;
  maxSize: IUniform<number>;
  octreeSize: IUniform<number>;
  bbSize: IUniform<[number, number, number]>;
  heightMin: IUniform<number>;
  heightMax: IUniform<number>;
  clipBoxCount: IUniform<number>;
  visibleNodes: IUniform<Texture>;
  pcIndex: IUniform<number>;
  gradient: IUniform<Texture>;
  classificationLUT: IUniform<Texture>;
  clipBoxes: IUniform<Float32Array>;
  toModel: IUniform<number[]>;
  depthMap: IUniform<Texture | null>;
  diffuse: IUniform<[number, number, number]>;
  transition: IUniform<number>;
  intensityRange: IUniform<[number, number]>;
  intensityGamma: IUniform<number>;
  intensityContrast: IUniform<number>;
  intensityBrightness: IUniform<number>;
  rgbGamma: IUniform<number>;
  rgbContrast: IUniform<number>;
  rgbBrightness: IUniform<number>;
  wRGB: IUniform<number>;
  wIntensity: IUniform<number>;
  wElevation: IUniform<number>;
  wClassification: IUniform<number>;
  wReturnNumber: IUniform<number>;
  wSourceID: IUniform<number>;
}

export class PointCloudMaterial extends RawShaderMaterial {
  lights = false;
  fog = false;

  // Clipping
  numClipBoxes: number = 0;
  clipBoxes: IClipBox[] = [];
  private _clipMode: ClipMode = ClipMode.DISABLED;
  private _useClipBox: boolean = false;

  // Textures
  visibleNodesTexture: Texture;
  private _gradient = GRADIENTS.SPECTRAL;
  gradientTexture = generateGradientTexture(this._gradient);
  private _classification: IClassification = CLASSIFICATION.DEFAULT;
  classificationTexture: Texture = generateClassificationTexture(this._classification);

  uniforms: IPointCloudMaterialUniforms = {
    level: { type: 'f', value: 0.0 },
    vnStart: { type: 'f', value: 0.0 },
    spacing: { type: 'f', value: 1.0 },
    blendHardness: { type: 'f', value: 2.0 },
    blendDepthSupplement: { type: 'f', value: 0.0 },
    fov: { type: 'f', value: 1.0 },
    screenWidth: { type: 'f', value: 1.0 },
    screenHeight: { type: 'f', value: 1.0 },
    near: { type: 'f', value: 0.1 },
    far: { type: 'f', value: 1.0 },
    uColor: { type: 'c', value: new Color(0xffffff) },
    opacity: { type: 'f', value: 1.0 },
    size: { type: 'f', value: 1 },
    minSize: { type: 'f', value: 2.0 },
    maxSize: { type: 'f', value: 50.0 },
    octreeSize: { type: 'f', value: 0 },
    bbSize: { type: 'fv', value: [0, 0, 0] },
    heightMin: { type: 'f', value: 0.0 },
    heightMax: { type: 'f', value: 1.0 },
    clipBoxCount: { type: 'f', value: 0 },
    visibleNodes: { type: 't', value: this.visibleNodesTexture },
    pcIndex: { type: 'f', value: 0 },
    gradient: { type: 't', value: this.gradientTexture },
    classificationLUT: { type: 't', value: this.classificationTexture },
    clipBoxes: { type: 'Matrix4fv', value: [] as any },
    toModel: { type: 'Matrix4f', value: [] },
    depthMap: { type: 't', value: null },
    diffuse: { type: 'fv', value: [1, 1, 1] },
    transition: { type: 'f', value: 0.5 },
    intensityRange: { type: 'fv', value: [0, 65000] },
    intensityGamma: { type: 'f', value: 1 },
    intensityContrast: { type: 'f', value: 0 },
    intensityBrightness: { type: 'f', value: 0 },
    rgbGamma: { type: 'f', value: 1 },
    rgbContrast: { type: 'f', value: 0 },
    rgbBrightness: { type: 'f', value: 0 },
    wRGB: { type: 'f', value: 1 },
    wIntensity: { type: 'f', value: 0 },
    wElevation: { type: 'f', value: 0 },
    wClassification: { type: 'f', value: 0 },
    wReturnNumber: { type: 'f', value: 0 },
    wSourceID: { type: 'f', value: 0 },
  };

  attributes = {
    position: { type: 'fv', value: [] },
    color: { type: 'fv', value: [] },
    normal: { type: 'fv', value: [] },
    intensity: { type: 'f', value: [] },
    classification: { type: 'f', value: [] },
    returnNumber: { type: 'f', value: [] },
    numberOfReturns: { type: 'f', value: [] },
    pointSourceID: { type: 'f', value: [] },
    indices: { type: 'fv', value: [] },
  };

  private _pointSizeType: PointSizeType = PointSizeType.FIXED;
  private _shape: PointShape = PointShape.SQUARE;
  private _pointColorType: PointColorType = PointColorType.RGB;
  private _weighted = false;
  private _treeType: TreeType = TreeType.OCTREE;
  private _useEDL = false;

  constructor(parameters: Partial<IPointCloudMaterialParameters> = {}) {
    super();

    this.visibleNodesTexture = generateDataTexture(2048, 1, new Color(0xffffff));
    this.visibleNodesTexture.minFilter = NearestFilter;
    this.visibleNodesTexture.magFilter = NearestFilter;

    this.uniforms.visibleNodes.value = this.visibleNodesTexture;

    function getValid<T>(a: T | undefined, b: T): T {
      return a === undefined ? b : a;
    }

    this.treeType = getValid(parameters.treeType, TreeType.OCTREE);
    this.size = getValid(parameters.size, 1.0);
    this.minSize = getValid(parameters.minSize, 2.0);
    this.maxSize = getValid(parameters.maxSize, 50.0);

    this.classification = CLASSIFICATION.DEFAULT;

    this.defaultAttributeValues.normal = [0, 0, 0];
    this.defaultAttributeValues.classification = [0, 0, 0];
    this.defaultAttributeValues.indices = [0, 0, 0, 0];

    this.vertexColors = VertexColors;

    this.needsUpdate = true;
  }

  updateShaderSource() {
    this.vertexShader = this.applyDefines(require('raw-loader!./shaders/pointcloud.vs'));
    this.fragmentShader = this.applyDefines(require('raw-loader!./shaders/pointcloud.fs'));

    if (this.opacity === 1.0) {
      this.blending = NoBlending;
      this.transparent = false;
      this.depthTest = true;
      this.depthWrite = true;
    } else if (this.opacity < 1.0 && !this.useEDL) {
      this.blending = AdditiveBlending;
      this.transparent = true;
      this.depthTest = false;
      this.depthWrite = true;
      this.depthFunc = AlwaysDepth;
    }

    if (this.weighted) {
      this.blending = AdditiveBlending;
      this.transparent = true;
      this.depthTest = true;
      this.depthWrite = false;
    }

    this.needsUpdate = true;
  }

  // tslint:disable:prefer-switch
  applyDefines(shaderSrc: string): string {
    const parts: string[] = [];

    if (this.pointSizeType === PointSizeType.FIXED) {
      parts.push('#define fixed_point_size');
    } else if (this.pointSizeType === PointSizeType.ATTENUATED) {
      parts.push('#define attenuated_point_size');
    } else if (this.pointSizeType === PointSizeType.ADAPTIVE) {
      parts.push('#define adaptive_point_size');
    }

    if (this.shape === PointShape.SQUARE) {
      parts.push('#define square_point_shape');
    } else if (this.shape === PointShape.CIRCLE) {
      parts.push('#define circle_point_shape');
    } else if (this.shape === PointShape.PARABOLOID) {
      parts.push('#define paraboloid_point_shape');
    }

    if (this._useEDL) {
      parts.push('#define use_edl');
    }

    if (this._pointColorType === PointColorType.RGB) {
      parts.push('#define color_type_rgb');
    } else if (this._pointColorType === PointColorType.COLOR) {
      parts.push('#define color_type_color');
    } else if (this._pointColorType === PointColorType.DEPTH) {
      parts.push('#define color_type_depth');
    } else if (this._pointColorType === PointColorType.HEIGHT) {
      parts.push('#define color_type_height');
    } else if (this._pointColorType === PointColorType.INTENSITY) {
      parts.push('#define color_type_intensity');
    } else if (this._pointColorType === PointColorType.INTENSITY_GRADIENT) {
      parts.push('#define color_type_intensity_gradient');
    } else if (this._pointColorType === PointColorType.LOD) {
      parts.push('#define color_type_lod');
    } else if (this._pointColorType === PointColorType.POINT_INDEX) {
      parts.push('#define color_type_point_index');
    } else if (this._pointColorType === PointColorType.CLASSIFICATION) {
      parts.push('#define color_type_classification');
    } else if (this._pointColorType === PointColorType.RETURN_NUMBER) {
      parts.push('#define color_type_return_number');
    } else if (this._pointColorType === PointColorType.SOURCE) {
      parts.push('#define color_type_source');
    } else if (this._pointColorType === PointColorType.NORMAL) {
      parts.push('#define color_type_normal');
    } else if (this._pointColorType === PointColorType.PHONG) {
      parts.push('#define color_type_phong');
    } else if (this._pointColorType === PointColorType.RGB_HEIGHT) {
      parts.push('#define color_type_rgb_height');
    } else if (this._pointColorType === PointColorType.COMPOSITE) {
      parts.push('#define color_type_composite');
    }

    if (this.clipMode === ClipMode.DISABLED) {
      parts.push('#define clip_disabled');
    } else if (this.clipMode === ClipMode.CLIP_OUTSIDE) {
      parts.push('#define clip_outside');
    } else if (this.clipMode === ClipMode.HIGHLIGHT_INSIDE) {
      parts.push('#define clip_highlight_inside');
    }

    if (this._treeType === TreeType.OCTREE) {
      parts.push('#define tree_type_octree');
    } else if (this._treeType === TreeType.KDTREE) {
      parts.push('#define tree_type_kdtree');
    }

    if (this.weighted) {
      parts.push('#define weighted_splats');
    }

    if (this.numClipBoxes > 0) {
      parts.push('#define use_clip_box');
    }

    parts.push(shaderSrc);

    return parts.join('\n');
  }
  // tslint:enable:prefer-switch

  setClipBoxes(clipBoxes: IClipBox[]): void {
    if (!clipBoxes) {
      return;
    }

    this.clipBoxes = clipBoxes;

    const doUpdate =
      this.numClipBoxes !== clipBoxes.length && (clipBoxes.length === 0 || this.numClipBoxes === 0);

    this.numClipBoxes = clipBoxes.length;
    this.uniforms.clipBoxCount.value = this.numClipBoxes;

    if (doUpdate) {
      this.updateShaderSource();
    }

    this.uniforms.clipBoxes.value = new Float32Array(this.numClipBoxes * 16);

    for (let i = 0; i < this.numClipBoxes; i++) {
      const box = clipBoxes[i];

      this.uniforms.clipBoxes.value.set(box.inverse.elements, 16 * i);
    }

    for (let i = 0; i < this.uniforms.clipBoxes.value.length; i++) {
      if (Number.isNaN(this.uniforms.clipBoxes.value[i])) {
        this.uniforms.clipBoxes.value[i] = Infinity;
      }
    }
  }

  get gradient(): Gradient {
    return this._gradient;
  }

  set gradient(value: Gradient) {
    if (this._gradient !== value) {
      this._gradient = value;
      this.gradientTexture = generateGradientTexture(this._gradient);
      this.uniforms.gradient.value = this.gradientTexture;
    }
  }

  get classification(): IClassification {
    return this._classification;
  }

  set classification(value: IClassification) {
    const copy: IClassification = {} as any;
    for (const key of Object.keys(value)) {
      copy[key] = value[key].clone();
    }

    let isEqual = false;
    if (this._classification === undefined) {
      isEqual = false;
    } else {
      isEqual = Object.keys(copy).length === Object.keys(this._classification).length;

      for (const key of Object.keys(copy)) {
        isEqual = isEqual && this._classification[key] !== undefined;
        isEqual = isEqual && copy[key].equals(this._classification[key]);
      }
    }

    if (!isEqual) {
      this._classification = copy;
      this.recomputeClassification();
    }
  }

  private recomputeClassification(): void {
    this.classificationTexture = generateClassificationTexture(this._classification);
    this.uniforms.classificationLUT.value = this.classificationTexture;
  }

  get spacing(): number {
    return this.uniforms.spacing.value;
  }

  set spacing(value: number) {
    this.uniforms.spacing.value = value;
  }

  get useClipBox(): boolean {
    return this._useClipBox;
  }

  set useClipBox(value: boolean) {
    if (this._useClipBox !== value) {
      this._useClipBox = value;
      this.updateShaderSource();
    }
  }

  get weighted(): boolean {
    return this._weighted;
  }

  set weighted(value: boolean) {
    if (this._weighted !== value) {
      this._weighted = value;
      this.updateShaderSource();
    }
  }

  get fov(): number {
    return this.uniforms.fov.value;
  }

  set fov(value: number) {
    this.uniforms.fov.value = value;
  }

  get screenWidth(): number {
    return this.uniforms.screenWidth.value;
  }

  set screenWidth(value: number) {
    this.uniforms.screenWidth.value = value;
  }

  get screenHeight(): number {
    return this.uniforms.screenHeight.value;
  }

  set screenHeight(value: number) {
    this.uniforms.screenHeight.value = value;
  }

  get near(): number {
    return this.uniforms.near.value;
  }

  set near(value: number) {
    this.uniforms.near.value = value;
  }

  get far(): number {
    return this.uniforms.far.value;
  }

  set far(value: number) {
    this.uniforms.far.value = value;
  }

  get opacity(): number {
    return this.uniforms.opacity.value;
  }

  set opacity(value: number) {
    if (this.uniforms && this.uniforms.opacity.value !== value) {
      this.uniforms.opacity.value = value;
      this.updateShaderSource();
    }
  }

  get pointColorType(): PointColorType {
    return this._pointColorType;
  }

  set pointColorType(value: PointColorType) {
    if (this._pointColorType !== value) {
      this._pointColorType = value;
      this.updateShaderSource();
    }
  }

  get depthMap(): Texture | null {
    return this.uniforms.depthMap.value;
  }

  set depthMap(value: Texture | null) {
    if (this.depthMap !== value) {
      this.uniforms.depthMap.value = value;
      this.updateShaderSource();
    }
  }

  get pointSizeType(): PointSizeType {
    return this._pointSizeType;
  }

  set pointSizeType(value: PointSizeType) {
    if (this._pointSizeType !== value) {
      this._pointSizeType = value;
      this.updateShaderSource();
    }
  }

  get clipMode(): ClipMode {
    return this._clipMode;
  }

  set clipMode(value: ClipMode) {
    if (this._clipMode !== value) {
      this._clipMode = value;
      this.updateShaderSource();
    }
  }

  get useEDL(): boolean {
    return this._useEDL;
  }

  set useEDL(value: boolean) {
    if (this._useEDL !== value) {
      this._useEDL = value;
      this.updateShaderSource();
    }
  }

  get color(): Color {
    return this.uniforms.uColor.value;
  }

  set color(value: Color) {
    if (!this.uniforms.uColor.value.equals(value)) {
      this.uniforms.uColor.value.copy(value);
    }
  }

  get shape(): PointShape {
    return this._shape;
  }

  set shape(value: PointShape) {
    if (this._shape !== value) {
      this._shape = value;
      this.updateShaderSource();
    }
  }

  get treeType(): TreeType {
    return this._treeType;
  }

  set treeType(value: TreeType) {
    if (this._treeType !== value) {
      this._treeType = value;
      this.updateShaderSource();
    }
  }

  get bbSize(): [number, number, number] {
    return this.uniforms.bbSize.value;
  }

  set bbSize(value: [number, number, number]) {
    this.uniforms.bbSize.value = value;
  }

  get size(): number {
    return this.uniforms.size.value;
  }

  set size(value: number) {
    this.uniforms.size.value = value;
  }

  get elevationRange(): [number, number] {
    return [this.heightMin, this.heightMax];
  }

  set elevationRange(value: [number, number]) {
    this.heightMin = value[0];
    this.heightMax = value[1];
  }

  get heightMin(): number {
    return this.uniforms.heightMin.value;
  }

  set heightMin(value: number) {
    this.uniforms.heightMin.value = value;
  }

  get heightMax(): number {
    return this.uniforms.heightMax.value;
  }

  set heightMax(value: number) {
    this.uniforms.heightMax.value = value;
  }

  get transition(): number {
    return this.uniforms.transition.value;
  }

  set transition(value: number) {
    this.uniforms.transition.value = value;
  }

  get intensityRange(): [number, number] {
    return this.uniforms.intensityRange.value;
  }

  set intensityRange(value: [number, number]) {
    this.uniforms.intensityRange.value = value;
  }

  get intensityGamma(): number {
    return this.uniforms.intensityGamma.value;
  }

  set intensityGamma(value: number) {
    this.uniforms.intensityGamma.value = value;
  }

  get intensityContrast(): number {
    return this.uniforms.intensityContrast.value;
  }

  set intensityContrast(value: number) {
    this.uniforms.intensityContrast.value = value;
  }

  get intensityBrightness(): number {
    return this.uniforms.intensityBrightness.value;
  }

  set intensityBrightness(value: number) {
    this.uniforms.intensityBrightness.value = value;
  }

  get rgbGamma(): number {
    return this.uniforms.rgbGamma.value;
  }

  set rgbGamma(value: number) {
    this.uniforms.rgbGamma.value = value;
  }

  get rgbContrast(): number {
    return this.uniforms.rgbContrast.value;
  }

  set rgbContrast(value: number) {
    this.uniforms.rgbContrast.value = value;
  }

  get rgbBrightness(): number {
    return this.uniforms.rgbBrightness.value;
  }

  set rgbBrightness(value: number) {
    this.uniforms.rgbBrightness.value = value;
  }

  get weightRGB(): number {
    return this.uniforms.wRGB.value;
  }

  set weightRGB(value: number) {
    this.uniforms.wRGB.value = value;
  }

  get weightIntensity(): number {
    return this.uniforms.wIntensity.value;
  }

  set weightIntensity(value: number) {
    this.uniforms.wIntensity.value = value;
  }

  get weightElevation(): number {
    return this.uniforms.wElevation.value;
  }

  set weightElevation(value: number) {
    this.uniforms.wElevation.value = value;
  }

  get weightClassification(): number {
    return this.uniforms.wClassification.value;
  }

  set weightClassification(value: number) {
    this.uniforms.wClassification.value = value;
  }

  get weightReturnNumber(): number {
    return this.uniforms.wReturnNumber.value;
  }

  set weightReturnNumber(value: number) {
    this.uniforms.wReturnNumber.value = value;
  }

  get weightSourceID(): number {
    return this.uniforms.wSourceID.value;
  }

  set weightSourceID(value: number) {
    this.uniforms.wSourceID.value = value;
  }

  get minSize(): number {
    return this.uniforms.minSize.value;
  }

  set minSize(value: number) {
    this.uniforms.minSize.value = value;
  }

  get maxSize(): number {
    return this.uniforms.maxSize.value;
  }

  set maxSize(value: number) {
    this.uniforms.maxSize.value = value;
  }
}
