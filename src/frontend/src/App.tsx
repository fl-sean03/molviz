import React, { useState, useCallback } from 'react';
import FastViewport from './components/FastViewport';
import VMDViewport from './components/VMDViewport';
import Toolbar from './components/Toolbar';
import StructureLibrary from './components/StructureLibrary';
import SettingsModal from './components/SettingsModal';
import { useVMDConnection } from './hooks/useVMDConnection';
import { useSettings } from './hooks/useSettings';
import { CameraState } from './types';

const App: React.FC = () => {
  const [structurePath, setStructurePath] = useState<string | null>(null);
  const [structureData, setStructureData] = useState<any>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [camera, setCamera] = useState<CameraState>({
    position: { x: 0, y: 0, z: 50 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    zoom: 1.0
  });

  // Settings (configurable backend URL)
  const { backendUrl, setBackendUrl, resetBackendUrl } = useSettings();

  const {
    connected,
    vmdFrame,
    pdbContent,
    loading,
    loadStructure,
    updateCamera,
    resetView
  } = useVMDConnection(backendUrl);

  // Handle structure loading
  const handleLoadStructure = useCallback(async (path: string) => {
    setStructurePath(path);
    const info = await loadStructure(path);
    setStructureData(info);
    setShowLibrary(false);
  }, [loadStructure]);

  // Handle camera changes from fast viewport
  const handleCameraChange = useCallback((newCamera: CameraState) => {
    setCamera(newCamera);
    updateCamera(newCamera);
  }, [updateCamera]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.pdb') || file.name.endsWith('.xyz'))) {
      console.log('Dropped file:', file.name);
    }
  }, []);

  // Handle settings save (triggers reconnect)
  const handleSettingsSave = useCallback((url: string) => {
    setBackendUrl(url);
    // Connection will automatically reconnect with new URL
  }, [setBackendUrl]);

  return (
    <div
      className="app-container"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Toolbar */}
      <Toolbar
        onOpenLibrary={() => setShowLibrary(true)}
        onResetView={resetView}
        onSaveView={() => console.log('Save view')}
        onOpenSettings={() => setShowSettings(true)}
        structurePath={structurePath}
      />

      {/* Main viewport area */}
      <div className="viewport-container">
        {/* Fast WebGL Viewport */}
        <div className="viewport-panel">
          <div className="viewport-header">
            <span className="viewport-label">Preview (WebGL)</span>
            <span className="viewport-fps">60 fps</span>
          </div>
          <FastViewport
            pdbContent={pdbContent}
            camera={camera}
            onCameraChange={handleCameraChange}
          />
        </div>

        {/* Divider */}
        <div className="viewport-divider" />

        {/* VMD Quality Viewport */}
        <div className="viewport-panel">
          <div className="viewport-header">
            <span className="viewport-label">VMD Quality</span>
            <span className="viewport-fps">{loading ? 'Rendering...' : 'Ready'}</span>
          </div>
          <VMDViewport
            frameData={vmdFrame}
            loading={loading}
          />
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="status-bar">
        <button
          className={`connection-status ${connected ? 'connected' : 'disconnected'}`}
          onClick={() => setShowSettings(true)}
          title="Click to configure backend"
        >
          {connected ? '● Connected' : '○ Disconnected'}
        </button>
        {structureData && (
          <span className="structure-info">
            {structureData.atom_count} atoms
          </span>
        )}
        <span className="camera-info">
          Zoom: {camera.zoom.toFixed(2)}x
        </span>
      </div>

      {/* Structure Library Modal */}
      {showLibrary && (
        <StructureLibrary
          onSelect={handleLoadStructure}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          backendUrl={backendUrl}
          onSave={handleSettingsSave}
          onReset={resetBackendUrl}
          onClose={() => setShowSettings(false)}
          connected={connected}
        />
      )}
    </div>
  );
};

export default App;
