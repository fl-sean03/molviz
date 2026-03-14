/**
 * MolViz Type Definitions
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CameraState {
  position: Vector3;
  rotation: Quaternion;
  zoom: number;
}

export interface VMDCameraMatrix {
  rotate: number[][];
  center: number[][];
  scale: number[][];
  global?: number[][];
}

export interface StructureInfo {
  mol_id: number;
  path: string;
  atom_count: number;
  residue_count: number;
  bounds: number[];
}

export interface Representation {
  selection: string;
  style: string;
  color: string;
  material?: string;
}

export interface SavedView {
  id: string;
  name: string;
  structure_path: string;
  camera: VMDCameraMatrix;
  representation?: Representation[];
  thumbnail?: string;
  created_at: string;
}

export interface WSMessage {
  type: string;
  data?: any;
  message?: string;
  timestamp?: number;
}
