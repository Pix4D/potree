const Potree = {
  pointBudget: 1 * 1000 * 1000,
  framenumber: 0,

  numNodesLoading: 0,
  maxNodesLoading: 4,

  Shaders: {},

  webgl: {
    shaders: {},
    vaos: {},
    vbos: {}
  },

  debug: {},

  CameraMode: {
    ORTHOGRAPHIC: 0,
    PERSPECTIVE: 1
  },

  ClipTask: {
    NONE: 0,
    HIGHLIGHT: 1,
    SHOW_INSIDE: 2,
    SHOW_OUTSIDE: 3
  },

  ClipMethod: {
    INSIDE_ANY: 0,
    INSIDE_ALL: 1
  },

  MOUSE: {
    LEFT: 0b0001,
    RIGHT: 0b0010,
    MIDDLE: 0b0100
  },

  timerQueries: {},
  measureTimings: false
};

export default Potree;

export function startQuery(name, gl) {
  let ext = gl.getExtension('EXT_disjoint_timer_query');

  if (!ext) {
    return;
  }

  if (Potree.timerQueries[name] === undefined) {
    Potree.timerQueries[name] = [];
  }

  let query = ext.createQueryEXT();
  ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, query);

  Potree.timerQueries[name].push(query);

  return query;
}

export function endQuery(query, gl) {
  let ext = gl.getExtension('EXT_disjoint_timer_query');

  if (!ext) {
    return;
  }

  ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
}

export function resolveQueries(gl) {
  let ext = gl.getExtension('EXT_disjoint_timer_query');

  let resolved = new Map();

  for (let name in Potree.timerQueries) {
    let queries = Potree.timerQueries[name];

    let remainingQueries = [];
    for (let query of queries) {
      let available = ext.getQueryObjectEXT(
        query,
        ext.QUERY_RESULT_AVAILABLE_EXT
      );
      let disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);

      if (available && !disjoint) {
        // See how much time the rendering of the object took in nanoseconds.
        let timeElapsed = ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT);
        let miliseconds = timeElapsed / (1000 * 1000);

        if (!resolved.get(name)) {
          resolved.set(name, []);
        }
        resolved.get(name).push(miliseconds);
      } else {
        remainingQueries.push(query);
      }
    }

    if (remainingQueries.length === 0) {
      delete Potree.timerQueries[name];
    } else {
      Potree.timerQueries[name] = remainingQueries;
    }
  }

  return resolved;
}

export function updatePointClouds(pointclouds, camera, renderer) {
  if (!Potree.lru) {
    Potree.lru = new LRU();
  }

  for (let pointcloud of pointclouds) {
    let start = performance.now();

    for (let profileRequest of pointcloud.profileRequests) {
      profileRequest.update();

      let duration = performance.now() - start;
      if (duration > 5) {
        break;
      }
    }
  }

  let result = updateVisibility(pointclouds, camera, renderer);

  for (let pointcloud of pointclouds) {
    pointcloud.updateMaterial(
      pointcloud.material,
      pointcloud.visibleNodes,
      camera,
      renderer
    );
    pointcloud.updateVisibleBounds();
  }

  getLRU().freeMemory();

  return result;
}

export function getLRU() {
  if (!Potree.lru) {
    Potree.lru = new LRU();
  }

  return Potree.lru;
}

function updateVisibilityStructures(pointclouds, camera, renderer) {
  let frustums = [];
  let camObjPositions = [];
  let priorityQueue = new BinaryHeap(function(x) {
    return 1 / x.weight;
  });

  for (let i = 0; i < pointclouds.length; i++) {
    let pointcloud = pointclouds[i];

    if (!pointcloud.initialized()) {
      continue;
    }

    pointcloud.numVisibleNodes = 0;
    pointcloud.numVisiblePoints = 0;
    pointcloud.deepestVisibleLevel = 0;
    pointcloud.visibleNodes = [];
    pointcloud.visibleGeometry = [];

    // frustum in object space
    camera.updateMatrixWorld();
    let frustum = new THREE.Frustum();
    let viewI = camera.matrixWorldInverse;
    let world = pointcloud.matrixWorld;

    // use close near plane for frustum intersection
    let frustumCam = camera.clone();
    frustumCam.near = Math.min(camera.near, 0.1);
    frustumCam.updateProjectionMatrix();
    let proj = camera.projectionMatrix;

    let fm = new THREE.Matrix4()
      .multiply(proj)
      .multiply(viewI)
      .multiply(world);
    frustum.setFromMatrix(fm);
    frustums.push(frustum);

    // camera position in object space
    let view = camera.matrixWorld;
    let worldI = new THREE.Matrix4().getInverse(world);
    let camMatrixObject = new THREE.Matrix4().multiply(worldI).multiply(view);
    let camObjPos = new THREE.Vector3().setFromMatrixPosition(camMatrixObject);
    camObjPositions.push(camObjPos);

    if (pointcloud.visible && pointcloud.root !== null) {
      priorityQueue.push({
        pointcloud: i,
        node: pointcloud.root,
        weight: Number.MAX_VALUE
      });
    }

    // hide all previously visible nodes
    // if(pointcloud.root instanceof Potree.PointCloudOctreeNode){
    //	pointcloud.hideDescendants(pointcloud.root.sceneNode);
    // }
    if (pointcloud.root.isTreeNode()) {
      pointcloud.hideDescendants(pointcloud.root.sceneNode);
    }

    for (let j = 0; j < pointcloud.boundingBoxNodes.length; j++) {
      pointcloud.boundingBoxNodes[j].visible = false;
    }
  }

  return {
    frustums: frustums,
    camObjPositions: camObjPositions,
    priorityQueue: priorityQueue
  };
}

Potree.getDEMWorkerInstance = function() {
  if (!Potree.DEMWorkerInstance) {
    let workerPath = Potree.scriptPath + '/workers/DEMWorker.js';
    Potree.DEMWorkerInstance = Potree.workerPool.getWorker(workerPath);
  }

  return Potree.DEMWorkerInstance;
};

function updateVisibility(pointclouds, camera, renderer) {
  let numVisiblePoints = 0;

  let numVisiblePointsInPointclouds = new Map(pointclouds.map(pc => [pc, 0]));

  let visibleNodes = [];
  let visibleGeometry = [];
  let unloadedGeometry = [];

  let lowestSpacing = Infinity;

  // calculate object space frustum and cam pos and setup priority queue
  let s = updateVisibilityStructures(pointclouds, camera, renderer);
  let frustums = s.frustums;
  let camObjPositions = s.camObjPositions;
  let priorityQueue = s.priorityQueue;

  let loadedToGPUThisFrame = 0;

  let domHeight = renderer.domElement.clientHeight;

  let pointcloudTransformChanged = new Map();

  while (priorityQueue.size() > 0) {
    let element = priorityQueue.pop();
    let node = element.node;
    let parent = element.parent;
    let pointcloud = pointclouds[element.pointcloud];

    // { // restrict to certain nodes for debugging
    //	let allowedNodes = ["r", "r0", "r4"];
    //	if(!allowedNodes.includes(node.name)){
    //		continue;
    //	}
    // }

    let box = node.getBoundingBox();
    let frustum = frustums[element.pointcloud];
    let camObjPos = camObjPositions[element.pointcloud];

    let insideFrustum = frustum.intersectsBox(box);
    let maxLevel = pointcloud.maxLevel || Infinity;
    let level = node.getLevel();
    let visible = insideFrustum;
    visible =
      visible && !(numVisiblePoints + node.getNumPoints() > Potree.pointBudget);
    visible =
      visible &&
      !(
        numVisiblePointsInPointclouds.get(pointcloud) + node.getNumPoints() >
        pointcloud.pointBudget
      );
    visible = visible && level < maxLevel;

    if (!window.warned125) {
      console.log('TODO');
      window.warned125 = true;
    }

    // visible = ["r", "r0", "r06", "r060"].includes(node.name);
    // visible = ["r"].includes(node.name);

    if (node.spacing) {
      lowestSpacing = Math.min(lowestSpacing, node.spacing);
    } else if (node.geometryNode && node.geometryNode.spacing) {
      lowestSpacing = Math.min(lowestSpacing, node.geometryNode.spacing);
    }

    if (numVisiblePoints + node.getNumPoints() > Potree.pointBudget) {
      break;
    }

    if (!visible) {
      continue;
    }

    // TODO: not used, same as the declaration?
    // numVisibleNodes++;
    numVisiblePoints += node.getNumPoints();
    let numVisiblePointsInPointcloud = numVisiblePointsInPointclouds.get(
      pointcloud
    );
    numVisiblePointsInPointclouds.set(
      pointcloud,
      numVisiblePointsInPointcloud + node.getNumPoints()
    );

    pointcloud.numVisibleNodes++;
    pointcloud.numVisiblePoints += node.getNumPoints();

    if (node.isGeometryNode() && (!parent || parent.isTreeNode())) {
      if (node.isLoaded() && loadedToGPUThisFrame < 2) {
        node = pointcloud.toTreeNode(node, parent);
        loadedToGPUThisFrame++;
      } else {
        unloadedGeometry.push(node);
        visibleGeometry.push(node);
      }
    }

    if (node.isTreeNode()) {
      getLRU().touch(node.geometryNode);
      node.sceneNode.visible = true;
      node.sceneNode.material = pointcloud.material;

      visibleNodes.push(node);
      pointcloud.visibleNodes.push(node);

      if (!pointcloudTransformChanged.has(pointcloud)) {
        let originalMatrixWorld = node.sceneNode.matrixWorld.clone();

        node.sceneNode.updateMatrix();
        node.sceneNode.matrixWorld.multiplyMatrices(
          pointcloud.matrixWorld,
          node.sceneNode.matrix
        );

        pointcloudTransformChanged.set(
          pointcloud,
          !originalMatrixWorld.equals(node.sceneNode.matrixWorld)
        );
      } else if (
        pointcloudTransformChanged.get(pointcloud) ||
        node.needsTransformUpdate
      ) {
        node.sceneNode.updateMatrix();
        node.sceneNode.matrixWorld.multiplyMatrices(
          pointcloud.matrixWorld,
          node.sceneNode.matrix
        );
        node.needsTransformUpdate = false;
      }

      if (
        pointcloud.showBoundingBox &&
        !node.boundingBoxNode &&
        node.getBoundingBox
      ) {
        let boxHelper = new Potree.Box3Helper(node.getBoundingBox());
        boxHelper.matrixAutoUpdate = false;
        pointcloud.boundingBoxNodes.push(boxHelper);
        node.boundingBoxNode = boxHelper;
        node.boundingBoxNode.matrix.copy(pointcloud.matrixWorld);
      } else if (pointcloud.showBoundingBox) {
        node.boundingBoxNode.visible = true;
        node.boundingBoxNode.matrix.copy(pointcloud.matrixWorld);
      } else if (!pointcloud.showBoundingBox && node.boundingBoxNode) {
        node.boundingBoxNode.visible = false;
      }
    }

    // add child nodes to priorityQueue
    let children = node.getChildren();
    for (let i = 0; i < children.length; i++) {
      let child = children[i];

      let weight = 0;
      if (camera.isPerspectiveCamera) {
        let sphere = child.getBoundingSphere();
        let center = sphere.center;
        //let distance = sphere.center.distanceTo(camObjPos);

        let dx = camObjPos.x - center.x;
        let dy = camObjPos.y - center.y;
        let dz = camObjPos.z - center.z;

        let dd = dx * dx + dy * dy + dz * dz;
        let distance = Math.sqrt(dd);

        let radius = sphere.radius;

        let fov = camera.fov * Math.PI / 180;
        let slope = Math.tan(fov / 2);
        let projFactor = 0.5 * domHeight / (slope * distance);
        let screenPixelRadius = radius * projFactor;

        if (screenPixelRadius < pointcloud.minimumNodePixelSize) {
          continue;
        }

        weight = screenPixelRadius;

        if (distance - radius < 0) {
          weight = Number.MAX_VALUE;
        }
      } else {
        // TODO ortho visibility
        let bb = child.getBoundingBox();
        let distance = child.getBoundingSphere().center.distanceTo(camObjPos);
        let diagonal = bb.max
          .clone()
          .sub(bb.min)
          .length();
        weight = diagonal / distance;
      }

      priorityQueue.push({
        pointcloud: element.pointcloud,
        node: child,
        parent: node,
        weight: weight
      });
    }
  } // end priority queue loop

  {
    // update DEM
    let maxDEMLevel = 4;
    let candidates = pointclouds.filter(
      p => p.generateDEM && p.dem instanceof Potree.DEM
    );
    for (let pointcloud of candidates) {
      let updatingNodes = pointcloud.visibleNodes.filter(
        n => n.getLevel() <= maxDEMLevel
      );
      pointcloud.dem.update(updatingNodes);
    }
  }

  for (
    let i = 0;
    i < Math.min(Potree.maxNodesLoading, unloadedGeometry.length);
    i++
  ) {
    unloadedGeometry[i].load();
  }

  return {
    visibleNodes: visibleNodes,
    numVisiblePoints: numVisiblePoints,
    lowestSpacing: lowestSpacing
  };
}

Potree.XHRFactory = {
  config: {
    withCredentials: false,
    customHeaders: [{ header: null, value: null }]
  },

  createXMLHttpRequest: function() {
    let xhr = new XMLHttpRequest();

    if (
      this.config.customHeaders &&
      Array.isArray(this.config.customHeaders) &&
      this.config.customHeaders.length > 0
    ) {
      let baseOpen = xhr.open;
      let customHeaders = this.config.customHeaders;
      xhr.open = function() {
        baseOpen.apply(this, [].slice.call(arguments));
        customHeaders.forEach(function(customHeader) {
          if (!!customHeader.header && !!customHeader.value) {
            xhr.setRequestHeader(customHeader.header, customHeader.value);
          }
        });
      };
    }

    return xhr;
  }
};
