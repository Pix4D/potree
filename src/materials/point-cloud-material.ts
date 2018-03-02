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
import { PointColorType, PointShape, PointSizeType, TreeType } from './enums';
import { GRADIENTS } from './gradients';
import {
  generateClassificationTexture,
  generateDataTexture,
  generateGradientTexture,
} from './texture-generation';
import { Classification, Gradient } from './types';

export interface PointCloudMaterialParameters {
  size: number;
  minSize: number;
  maxSize: number;
  treeType: TreeType;
}

// tslint:disable:variable-name

export class PointCloudMaterial extends RawShaderMaterial {
  visibleNodesTexture: Texture;

  private _pointSizeType: PointSizeType = PointSizeType.FIXED;
  private _shape: PointShape = PointShape.SQUARE;
  private _pointColorType: PointColorType = PointColorType.RGB;

  private _weighted = false;
  private _gradient = GRADIENTS.SPECTRAL;
  gradientTexture = generateGradientTexture(this._gradient);

  private _classification: Classification = CLASSIFICATION.DEFAULT;
  classificationTexture: Texture = generateClassificationTexture(this._classification);

  lights = false;
  fog = false;
  defines = new Map<string, string>();

  private _treeType: TreeType = TreeType.OCTREE;
  private _useEDL = false;
  private _snapEnabled = false;
  private _numSnapshots = 0;

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

  constructor(parameters: Partial<PointCloudMaterialParameters> = {}) {
    super();

    this.visibleNodesTexture = generateDataTexture(2048, 1, new Color(0xffffff));
    this.visibleNodesTexture.minFilter = NearestFilter;
    this.visibleNodesTexture.magFilter = NearestFilter;

    function getValid<T>(a: T | undefined, b: T): T {
      return a === undefined ? b : a;
    }

    const pointSize = getValid(parameters.size, 1.0);
    const minSize = getValid(parameters.minSize, 2.0);
    const maxSize = getValid(parameters.maxSize, 50.0);

    this._treeType = getValid(parameters.treeType, TreeType.OCTREE);

    this.uniforms = {
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
      uOpacity: { type: 'f', value: 1.0 },
      size: { type: 'f', value: pointSize },
      minSize: { type: 'f', value: minSize },
      maxSize: { type: 'f', value: maxSize },
      octreeSize: { type: 'f', value: 0 },
      bbSize: { type: 'fv', value: [0, 0, 0] },
      elevationRange: { type: '2fv', value: [0, 0] },
      clipBoxCount: { type: 'f', value: 0 },
      clipPolygonCount: { type: 'i', value: 0 },
      visibleNodes: { type: 't', value: this.visibleNodesTexture },
      pcIndex: { type: 'f', value: 0 },
      gradient: { type: 't', value: this.gradientTexture },
      classificationLUT: { type: 't', value: this.classificationTexture },
      uHQDepthMap: { type: 't', value: null },
      clipBoxes: { type: 'Matrix4fv', value: [] },
      clipPolygons: { type: '3fv', value: [] },
      clipPolygonVCount: { type: 'iv', value: [] },
      clipPolygonVP: { type: 'Matrix4fv', value: [] },
      toModel: { type: 'Matrix4f', value: [] },
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
      useOrthographicCamera: { type: 'b', value: false },
      clipTask: { type: 'i', value: 1 },
      clipMethod: { type: 'i', value: 1 },
      uSnapshot: { type: 'tv', value: [] },
      uSnapshotDepth: { type: 'tv', value: [] },
      uSnapView: { type: 'Matrix4fv', value: [] },
      uSnapProj: { type: 'Matrix4fv', value: [] },
      uSnapProjInv: { type: 'Matrix4fv', value: [] },
      uSnapViewInv: { type: 'Matrix4fv', value: [] },
      uShadowColor: { type: '3fv', value: [0, 0, 0] },
    } as any;

    this.classification = CLASSIFICATION.DEFAULT;

    this.defaultAttributeValues.normal = [0, 0, 0];
    this.defaultAttributeValues.classification = [0, 0, 0];
    this.defaultAttributeValues.indices = [0, 0, 0, 0];

    this.vertexShader = this.getDefines() + require('raw-loader!./shaders/pointcloud.vs');
    this.fragmentShader = this.getDefines() + require('raw-loader!./shaders/pointcloud.fs');
    this.vertexColors = VertexColors;
  }

  setDefine(key: string, value: string): void {
    if (value !== undefined && value !== null) {
      if (this.defines.get(key) !== value) {
        this.defines.set(key, value);
        this.updateShaderSource();
      }
    } else {
      this.removeDefine(key);
    }
  }

  removeDefine(key: string): void {
    this.defines.delete(key);
  }

  updateShaderSource() {
    this.vertexShader = this.getDefines() + require('raw-loader!./shaders/pointcloud.vs');
    this.fragmentShader = this.getDefines() + require('raw-loader!./shaders/pointcloud.fs');

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
  getDefines() {
    const defines: string[] = [];

    if (this.pointSizeType === PointSizeType.FIXED) {
      defines.push('#define fixed_point_size');
    } else if (this.pointSizeType === PointSizeType.ATTENUATED) {
      defines.push('#define attenuated_point_size');
    } else if (this.pointSizeType === PointSizeType.ADAPTIVE) {
      defines.push('#define adaptive_point_size');
    }

    if (this.shape === PointShape.SQUARE) {
      defines.push('#define square_point_shape');
    } else if (this.shape === PointShape.CIRCLE) {
      defines.push('#define circle_point_shape');
    } else if (this.shape === PointShape.PARABOLOID) {
      defines.push('#define paraboloid_point_shape');
    }

    if (this._useEDL) {
      defines.push('#define use_edl');
    }

    if (this._snapEnabled) {
      defines.push('#define snap_enabled');
    }

    if (this._pointColorType === PointColorType.RGB) {
      defines.push('#define color_type_rgb');
    } else if (this._pointColorType === PointColorType.COLOR) {
      defines.push('#define color_type_color');
    } else if (this._pointColorType === PointColorType.DEPTH) {
      defines.push('#define color_type_depth');
    } else if (this._pointColorType === PointColorType.HEIGHT) {
      defines.push('#define color_type_height');
    } else if (this._pointColorType === PointColorType.INTENSITY) {
      defines.push('#define color_type_intensity');
    } else if (this._pointColorType === PointColorType.INTENSITY_GRADIENT) {
      defines.push('#define color_type_intensity_gradient');
    } else if (this._pointColorType === PointColorType.LOD) {
      defines.push('#define color_type_lod');
    } else if (this._pointColorType === PointColorType.POINT_INDEX) {
      defines.push('#define color_type_point_index');
    } else if (this._pointColorType === PointColorType.CLASSIFICATION) {
      defines.push('#define color_type_classification');
    } else if (this._pointColorType === PointColorType.RETURN_NUMBER) {
      defines.push('#define color_type_return_number');
    } else if (this._pointColorType === PointColorType.SOURCE) {
      defines.push('#define color_type_source');
    } else if (this._pointColorType === PointColorType.NORMAL) {
      defines.push('#define color_type_normal');
    } else if (this._pointColorType === PointColorType.PHONG) {
      defines.push('#define color_type_phong');
    } else if (this._pointColorType === PointColorType.RGB_HEIGHT) {
      defines.push('#define color_type_rgb_height');
    } else if (this._pointColorType === PointColorType.COMPOSITE) {
      defines.push('#define color_type_composite');
    }

    if (this._treeType === TreeType.OCTREE) {
      defines.push('#define tree_type_octree');
    } else if (this._treeType === TreeType.KDTREE) {
      defines.push('#define tree_type_kdtree');
    }

    if (this.weighted) {
      defines.push('#define weighted_splats');
    }

    Array.from(this.defines.values()).forEach(value => defines.push(value));

    return defines.join('\n');
  }
  // tslint:enable:prefer-switch

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

  get useOrthographicCamera(): boolean {
    return this.uniforms.useOrthographicCamera.value;
  }

  set useOrthographicCamera(value: boolean) {
    if (this.uniforms.useOrthographicCamera.value !== value) {
      this.uniforms.useOrthographicCamera.value = value;
    }
  }

  get classification(): Classification {
    return this._classification;
  }

  set classification(value: Classification) {
    const copy: Classification = {} as any;
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

  get numSnapshots(): number {
    return this._numSnapshots;
  }

  set numSnapshots(value: number) {
    this._numSnapshots = value;
  }

  get snapEnabled(): boolean {
    return this._snapEnabled;
  }

  set snapEnabled(value: boolean) {
    if (this._snapEnabled !== value) {
      this._snapEnabled = value;
      this.updateShaderSource();
    }
  }

  get spacing(): number {
    return this.uniforms.spacing.value;
  }

  set spacing(value: number) {
    this.uniforms.spacing.value = value;
  }

  get clipTask(): number {
    return this.uniforms.clipTask.value;
  }

  set clipTask(mode: number) {
    this.uniforms.clipTask.value = mode;
  }

  get clipMethod(): number {
    return this.uniforms.clipMethod.value;
  }

  set clipMethod(mode: number) {
    this.uniforms.clipMethod.value = mode;
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
    return this.uniforms.uOpacity.value;
  }

  set opacity(value: number) {
    if (this.uniforms && this.uniforms.opacity) {
      if (this.uniforms.uOpacity.value !== value) {
        this.uniforms.uOpacity.value = value;
        this.updateShaderSource();
      }
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

  get pointSizeType(): PointSizeType {
    return this._pointSizeType;
  }

  set pointSizeType(value: PointSizeType) {
    if (this._pointSizeType !== value) {
      this._pointSizeType = value;
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

  get bbSize(): number {
    return this.uniforms.bbSize.value;
  }

  set bbSize(value: number) {
    this.uniforms.bbSize.value = value;
  }

  get size(): number {
    return this.uniforms.size.value;
  }

  set size(value: number) {
    this.uniforms.size.value = value;
  }

  get elevationRange(): [number, number] {
    return this.uniforms.elevationRange.value;
  }

  set elevationRange(value: [number, number]) {
    if (Array.isArray(value) && value.length === 2) {
      this.uniforms.elevationRange.value = value;
    }
  }

  get heightMin(): number {
    return this.uniforms.elevationRange.value[0];
  }

  set heightMin(value: number) {
    this.elevationRange = [value, this.elevationRange[1]];
  }

  get heightMax(): number {
    return this.uniforms.elevationRange.value[1];
  }

  set heightMax(value: number) {
    this.elevationRange = [this.elevationRange[0], value];
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

  copyFrom(from: PointCloudMaterial) {
    Object.keys(this.uniforms).forEach(key => {
      this.uniforms[key].value = from.uniforms[key].value;
    });
  }
}
