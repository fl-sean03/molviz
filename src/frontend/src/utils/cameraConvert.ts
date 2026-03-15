/**
 * Camera conversion utilities between 3Dmol.js and VMD formats.
 */

import { CameraState, VMDCameraMatrix, Quaternion, Vector3 } from '../types';

/**
 * Convert quaternion to 4x4 rotation matrix.
 */
function quaternionToMatrix(q: Quaternion): number[][] {
  const { x, y, z, w } = q;

  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;

  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0],
    [0, 0, 0, 1]
  ];
}

/**
 * Extract rotation quaternion from 4x4 matrix.
 */
function matrixToQuaternion(m: number[][]): Quaternion {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let w, x, y, z;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m[2][1] - m[1][2]) * s;
    y = (m[0][2] - m[2][0]) * s;
    z = (m[1][0] - m[0][1]) * s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2.0 * Math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]);
    w = (m[2][1] - m[1][2]) / s;
    x = 0.25 * s;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = 2.0 * Math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]);
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = 0.25 * s;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]);
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = 0.25 * s;
  }

  return { x, y, z, w };
}

/**
 * Create identity 4x4 matrix.
 */
function identityMatrix(): number[][] {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ];
}

// Translation matrix factory - exported for potential future use
export function createTranslationMatrix(x: number, y: number, z: number): number[][] {
  return [
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, z],
    [0, 0, 0, 1]
  ];
}

/**
 * Create scale matrix.
 */
function scaleMatrix(s: number): number[][] {
  return [
    [s, 0, 0, 0],
    [0, s, 0, 0],
    [0, 0, s, 0],
    [0, 0, 0, 1]
  ];
}

// Store VMD's initial scale after structure load
let vmdInitialScale: number[][] | null = null;
let vmdInitialCenter: number[][] | null = null;
let initialWebGLZoom: number | null = null;

/**
 * Set VMD's initial camera state (called after structure load).
 */
export function setVMDInitialCamera(scale: number[][], center: number[][]): void {
  vmdInitialScale = scale;
  vmdInitialCenter = center;
}

/**
 * Set the initial WebGL zoom value (called after structure load).
 */
export function setInitialWebGLZoom(zoom: number): void {
  initialWebGLZoom = zoom;
}

/**
 * Apply zoom ratio to a scale matrix.
 */
function applyZoomToScale(baseScale: number[][], zoomRatio: number): number[][] {
  return [
    [baseScale[0][0] * zoomRatio, baseScale[0][1], baseScale[0][2], baseScale[0][3]],
    [baseScale[1][0], baseScale[1][1] * zoomRatio, baseScale[1][2], baseScale[1][3]],
    [baseScale[2][0], baseScale[2][1], baseScale[2][2] * zoomRatio, baseScale[2][3]],
    [baseScale[3][0], baseScale[3][1], baseScale[3][2], baseScale[3][3]]
  ];
}

/**
 * Convert 3Dmol.js camera state to VMD matrix format.
 *
 * VMD and 3Dmol.js use different coordinate systems:
 * - 3Dmol.js: OpenGL style (Y up, Z toward viewer)
 * - VMD: X right, Y up, Z out of screen
 *
 * We sync both rotation and zoom.
 */
export function cameraToVMDMatrix(camera: CameraState): VMDCameraMatrix {
  // Convert quaternion with coordinate system adjustment
  // VMD expects rotations in its own coordinate space
  // Negate Y and Z components to match VMD's convention
  const adjustedQ: Quaternion = {
    x: camera.rotation.x,
    y: -camera.rotation.y,
    z: -camera.rotation.z,
    w: camera.rotation.w
  };

  // Rotation matrix from adjusted quaternion
  const rotate = quaternionToMatrix(adjustedQ);

  // Calculate zoom ratio relative to initial zoom
  // 3Dmol.js zoom: higher value = camera further = zoomed out
  // VMD scale: higher value = molecule larger = zoomed in
  // To sync: when WebGL zooms in (zoom decreases), VMD should zoom in (scale increases)
  let zoomRatio = 1.0;
  if (initialWebGLZoom && initialWebGLZoom > 0 && camera.zoom > 0) {
    // Use current/initial so that:
    // - Zoom in (smaller zoom value) → smaller ratio → VMD scales down... wait that's wrong
    // Actually: when user zooms IN, 3Dmol zoom value INCREASES (not decreases)
    // So: current > initial means zoomed in, use current/initial
    zoomRatio = camera.zoom / initialWebGLZoom;
    // Clamp to prevent extreme values
    zoomRatio = Math.max(0.1, Math.min(10.0, zoomRatio));
  }

  // Apply zoom ratio to VMD's initial scale
  const baseScale = vmdInitialScale || scaleMatrix(1.0);
  const scale = applyZoomToScale(baseScale, zoomRatio);

  const center = vmdInitialCenter || identityMatrix();

  // Global is typically identity
  const global_ = identityMatrix();

  return { rotate, center, scale, global: global_ };
}

/**
 * Convert VMD matrix format to 3Dmol.js camera state.
 */
export function vmdMatrixToCamera(matrix: VMDCameraMatrix): CameraState {
  // Extract rotation from matrix
  const rotation = matrixToQuaternion(matrix.rotate);

  // Extract position from center matrix
  // Assuming center matrix has translation in the last column
  const position: Vector3 = {
    x: -matrix.center[0][3],
    y: -matrix.center[1][3],
    z: -matrix.center[2][3]
  };

  // Extract zoom from scale matrix
  // Assuming uniform scale
  const zoom = matrix.scale[0][0];

  return { position, rotation, zoom };
}

/**
 * Interpolate between two camera states.
 */
export function interpolateCamera(
  from: CameraState,
  to: CameraState,
  t: number
): CameraState {
  // Linear interpolation for position
  const position: Vector3 = {
    x: from.position.x + (to.position.x - from.position.x) * t,
    y: from.position.y + (to.position.y - from.position.y) * t,
    z: from.position.z + (to.position.z - from.position.z) * t
  };

  // SLERP for rotation (simplified linear for now)
  const rotation: Quaternion = {
    x: from.rotation.x + (to.rotation.x - from.rotation.x) * t,
    y: from.rotation.y + (to.rotation.y - from.rotation.y) * t,
    z: from.rotation.z + (to.rotation.z - from.rotation.z) * t,
    w: from.rotation.w + (to.rotation.w - from.rotation.w) * t
  };

  // Normalize quaternion
  const len = Math.sqrt(rotation.x**2 + rotation.y**2 + rotation.z**2 + rotation.w**2);
  rotation.x /= len;
  rotation.y /= len;
  rotation.z /= len;
  rotation.w /= len;

  // Linear interpolation for zoom
  const zoom = from.zoom + (to.zoom - from.zoom) * t;

  return { position, rotation, zoom };
}
