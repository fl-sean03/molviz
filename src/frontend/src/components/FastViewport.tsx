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

/**
 * Check if WebGL is available in the browser
 */
function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl !== null;
  } catch (e) {
    return false;
  }
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
  const [webglError, setWebglError] = useState<string | null>(null);
  const initRetryCount = useRef(0);
  const maxRetries = 5;

  // Use ref to avoid stale closure in event listeners
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  // Initialize 3Dmol viewer
  useEffect(() => {
    // Check WebGL availability first
    if (!isWebGLAvailable()) {
      setWebglError('WebGL is not available in your browser');
      return;
    }

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
      script.onerror = () => {
        setWebglError('Failed to load 3Dmol.js library');
      };
      document.head.appendChild(script);
    } else {
      // Already loaded, init on next frame
      requestAnimationFrame(() => initViewer());
    }

    function initViewer() {
      const container = containerRef.current;
      if (!container) {
        if (initRetryCount.current < maxRetries) {
          initRetryCount.current++;
          console.warn(`3Dmol container not ready, retry ${initRetryCount.current}/${maxRetries}...`);
          setTimeout(() => initViewer(), 100);
        } else {
          setWebglError('Failed to initialize viewer: container not available');
        }
        return;
      }

      // Ensure container has dimensions
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        if (initRetryCount.current < maxRetries) {
          initRetryCount.current++;
          console.warn(`3Dmol container has no size, retry ${initRetryCount.current}/${maxRetries}...`);
          setTimeout(() => initViewer(), 100);
        } else {
          setWebglError('Failed to initialize viewer: container has no dimensions');
        }
        return;
      }

      // Clean up any existing canvas elements from previous failed attempts
      const existingCanvas = container.querySelector('canvas');
      if (existingCanvas) {
        existingCanvas.remove();
      }

      try {
        const config = {
          backgroundColor: 'white',
          antialias: true
        };

        viewerRef.current = window.$3Dmol.createViewer(container, config);

        // Verify the viewer was created properly with a valid GL context
        if (!viewerRef.current) {
          throw new Error('createViewer returned null');
        }

        // Try a test render to verify GL context is valid
        viewerRef.current.setViewStyle({ style: 'outline' });
        viewerRef.current.render();

        setViewerReady(true);
        setWebglError(null);

        // Add mouse event listeners for camera tracking
        setupMouseTracking();
      } catch (err) {
        console.error('Failed to initialize 3Dmol viewer:', err);

        // Clean up failed viewer
        if (viewerRef.current) {
          try {
            viewerRef.current.clear();
          } catch (e) {
            // Ignore cleanup errors
          }
          viewerRef.current = null;
        }

        // Retry initialization
        if (initRetryCount.current < maxRetries) {
          initRetryCount.current++;
          console.warn(`Retrying viewer init ${initRetryCount.current}/${maxRetries}...`);
          setTimeout(() => initViewer(), 200);
        } else {
          setWebglError(`WebGL initialization failed: ${err}`);
        }
      }
    }

    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.clear();
        } catch (e) {
          // Ignore cleanup errors
        }
        viewerRef.current = null;
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

      // Emit initial camera state after structure loads
      // This ensures the correct initial zoom is captured for sync
      setTimeout(() => {
        emitCameraChange();
      }, 100);
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

  // Show error message if WebGL failed
  if (webglError) {
    return (
      <div
        className="viewport-canvas"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f5f5',
          color: '#666',
          padding: '20px',
          textAlign: 'center'
        }}
      >
        <div>
          <div style={{ fontSize: '14px', marginBottom: '8px' }}>⚠️ WebGL Error</div>
          <div style={{ fontSize: '12px' }}>{webglError}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="viewport-canvas"
      style={{ width: '100%', height: '100%' }}
    />
  );
};

export default FastViewport;
