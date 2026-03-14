import React, { useEffect, useRef, useCallback, useState } from 'react';
import { CameraState } from '../types';

// 3Dmol.js types
declare global {
  interface Window {
    $3Dmol: any;
  }
}

interface FastViewportProps {
  pdbContent: string | null;
  camera: CameraState;
  onCameraChange: (camera: CameraState) => void;
}

const FastViewport: React.FC<FastViewportProps> = ({
  pdbContent,
  camera,
  onCameraChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const isUserInteracting = useRef(false);
  const [viewerReady, setViewerReady] = useState(false);
  const initAttempted = useRef(false);

  // Use ref to avoid stale closure in event listeners
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  // Initialize 3Dmol viewer
  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    // Load 3Dmol.js from CDN if not available
    if (!window.$3Dmol) {
      const script = document.createElement('script');
      script.src = 'https://3dmol.org/build/3Dmol-min.js';
      script.onload = () => {
        // Wait for next frame to ensure DOM is ready
        requestAnimationFrame(() => {
          requestAnimationFrame(() => initViewer());
        });
      };
      document.head.appendChild(script);
    } else {
      // Already loaded, init on next frame
      requestAnimationFrame(() => initViewer());
    }

    function initViewer() {
      const container = containerRef.current;
      if (!container) {
        console.warn('3Dmol container not ready, retrying...');
        setTimeout(() => initViewer(), 100);
        return;
      }

      // Ensure container has dimensions
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        console.warn('3Dmol container has no size, retrying...');
        setTimeout(() => initViewer(), 100);
        return;
      }

      try {
        const config = {
          backgroundColor: 'white',
          antialias: true
        };

        viewerRef.current = window.$3Dmol.createViewer(container, config);
        if (viewerRef.current) {
          viewerRef.current.setViewStyle({ style: 'outline' });
          viewerRef.current.render();
          setViewerReady(true);

          // Add mouse event listeners for camera tracking
          setupMouseTracking();
        }
      } catch (err) {
        console.error('Failed to initialize 3Dmol viewer:', err);
      }
    }

    return () => {
      if (viewerRef.current) {
        // Cleanup if needed
      }
    };
  }, []);

  // Setup mouse tracking for camera sync
  const setupMouseTracking = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDragging = false;

    container.addEventListener('mousedown', () => {
      isDragging = true;
      isUserInteracting.current = true;
    });

    container.addEventListener('mouseup', () => {
      isDragging = false;
      setTimeout(() => {
        isUserInteracting.current = false;
        // Emit camera change on mouse up
        emitCameraChange();
      }, 50);
    });

    container.addEventListener('mousemove', () => {
      if (isDragging) {
        // Debounced camera emit during drag
        requestAnimationFrame(emitCameraChange);
      }
    });

    container.addEventListener('wheel', () => {
      emitCameraChange();
    });
  }, []);

  // Emit camera change to parent (uses ref to avoid stale closure)
  const emitCameraChange = useCallback(() => {
    if (!viewerRef.current) return;

    try {
      const view = viewerRef.current.getView();
      // view is [x, y, z, zoom, qx, qy, qz, qw]

      const newCamera: CameraState = {
        position: {
          x: view[0] || 0,
          y: view[1] || 0,
          z: view[2] || 0
        },
        rotation: {
          x: view[4] || 0,
          y: view[5] || 0,
          z: view[6] || 0,
          w: view[7] || 1
        },
        zoom: view[3] || 1
      };

      onCameraChangeRef.current(newCamera);
    } catch (e) {
      console.error('Failed to get camera:', e);
    }
  }, []);

  // Load structure when PDB content is received
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || !pdbContent) return;

    try {
      viewerRef.current.removeAllModels();
      viewerRef.current.addModel(pdbContent, 'pdb');

      // Pt atoms - gray spheres (match VMD ColorID 2)
      viewerRef.current.setStyle({ elem: 'Pt' }, {
        sphere: { color: 0x808080, radius: 1.2 }
      });

      // Carbon atoms - dark gray (match VMD ColorID 16)
      viewerRef.current.setStyle({ elem: 'C' }, {
        stick: { color: 0x1a1a1a, radius: 0.15 },
        sphere: { color: 0x1a1a1a, radius: 0.4 }
      });

      // Nitrogen atoms - blue (match VMD ColorID 0)
      viewerRef.current.setStyle({ elem: 'N' }, {
        sphere: { color: 0x0000ff, radius: 0.5 }
      });

      // Hydrogen atoms - white (match VMD ColorID 8)
      viewerRef.current.setStyle({ elem: 'H' }, {
        sphere: { color: 0xffffff, radius: 0.25 }
      });

      viewerRef.current.zoomTo();
      viewerRef.current.render();
    } catch (err) {
      console.error('Failed to load structure:', err);
    }
  }, [pdbContent, viewerReady]);

  // Sync camera from parent (when VMD updates)
  useEffect(() => {
    if (!viewerReady || !viewerRef.current || isUserInteracting.current) return;

    try {
      viewerRef.current.setView([
        camera.position.x,
        camera.position.y,
        camera.position.z,
        camera.zoom,
        camera.rotation.x,
        camera.rotation.y,
        camera.rotation.z,
        camera.rotation.w
      ]);
      viewerRef.current.render();
    } catch (e) {
      // Ignore errors during rapid updates
    }
  }, [camera, viewerReady]);

  return (
    <div
      ref={containerRef}
      className="viewport-canvas"
      style={{ width: '100%', height: '100%' }}
    />
  );
};

export default FastViewport;
