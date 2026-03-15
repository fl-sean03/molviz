import { useState, useEffect, useCallback, useRef } from 'react';
import { CameraState, StructureInfo, WSMessage } from '../types';
import { cameraToVMDMatrix, setVMDInitialCamera, setInitialWebGLZoom } from '../utils/cameraConvert';

interface UseVMDConnectionReturn {
  connected: boolean;
  vmdFrame: string | null;
  pdbContent: string | null;
  loading: boolean;
  loadStructure: (path: string) => Promise<StructureInfo | null>;
  updateCamera: (camera: CameraState) => void;
  requestFrame: (width?: number, height?: number, quality?: string) => void;
  resetView: () => void;
  executeCommand: (command: string) => void;
}

export function useVMDConnection(url: string): UseVMDConnectionReturn {
  const [connected, setConnected] = useState(false);
  const [vmdFrame, setVmdFrame] = useState<string | null>(null);
  const [pdbContent, setPdbContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingResolversRef = useRef<Map<string, (value: any) => void>>(new Map());
  const initialZoomCapturedRef = useRef<boolean>(false);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('VMD connection established');
      setConnected(true);
    };

    ws.onclose = () => {
      console.log('VMD connection closed');
      setConnected(false);
      // Attempt reconnect after 2 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = (error) => {
      console.error('VMD connection error:', error);
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    wsRef.current = ws;
  }, [url]);

  // Handle incoming messages
  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case 'frame':
        setVmdFrame(message.data);
        setLoading(false);
        break;

      case 'structure_loaded':
        // Store PDB content for WebGL viewport
        if (message.data?.pdb_content) {
          setPdbContent(message.data.pdb_content);
        }
        const resolver = pendingResolversRef.current.get('load_structure');
        if (resolver) {
          resolver(message.data);
          pendingResolversRef.current.delete('load_structure');
        }
        break;

      case 'camera_update':
        // Capture VMD's camera state (scale/center) for proper sync
        if (message.data?.scale && message.data?.center) {
          setVMDInitialCamera(message.data.scale, message.data.center);
        }
        break;

      case 'error':
        console.error('VMD error:', message.message);
        setLoading(false);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }, []);

  // Send message to server
  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Load structure
  const loadStructure = useCallback((path: string): Promise<StructureInfo | null> => {
    // Reset zoom capture flag for new structure
    initialZoomCapturedRef.current = false;

    return new Promise((resolve) => {
      pendingResolversRef.current.set('load_structure', (data: StructureInfo) => {
        // Request VMD's camera state after structure loads
        // This gives us the proper scale/center for the molecule
        send({ type: 'get_camera' });
        resolve(data);
      });
      setLoading(true);
      send({ type: 'load_structure', data: { path } });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingResolversRef.current.has('load_structure')) {
          pendingResolversRef.current.delete('load_structure');
          resolve(null);
        }
      }, 10000);
    });
  }, [send]);

  // Update camera (debounced on server side)
  const updateCamera = useCallback((camera: CameraState) => {
    // Capture initial zoom on first camera update after structure load
    if (!initialZoomCapturedRef.current && camera.zoom > 0) {
      setInitialWebGLZoom(camera.zoom);
      initialZoomCapturedRef.current = true;
    }

    const vmdMatrix = cameraToVMDMatrix(camera);
    setLoading(true);
    send({ type: 'set_camera', data: vmdMatrix });
  }, [send]);

  // Request frame render
  const requestFrame = useCallback((
    width: number = 800,
    height: number = 600,
    quality: string = 'fast'
  ) => {
    setLoading(true);
    send({ type: 'request_frame', data: { width, height, quality } });
  }, [send]);

  // Reset view
  const resetView = useCallback(() => {
    setLoading(true);
    send({ type: 'reset_view' });
  }, [send]);

  // Execute arbitrary Tcl command
  const executeCommand = useCallback((command: string) => {
    send({ type: 'execute_tcl', data: { command } });
  }, [send]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    connected,
    vmdFrame,
    pdbContent,
    loading,
    loadStructure,
    updateCamera,
    requestFrame,
    resetView,
    executeCommand
  };
}
