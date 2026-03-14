import React, { useState } from 'react';
import { BACKEND_PRESETS } from '../hooks/useSettings';

interface SettingsModalProps {
  backendUrl: string;
  onSave: (url: string) => void;
  onReset: () => void;
  onClose: () => void;
  connected: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  backendUrl,
  onSave,
  onReset,
  onClose,
  connected
}) => {
  const [url, setUrl] = useState(backendUrl);

  const handleSave = () => {
    onSave(url);
    onClose();
  };

  const handlePreset = (presetUrl: string) => {
    setUrl(presetUrl);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Connection Status */}
          <div className="settings-section">
            <h3>Connection Status</h3>
            <div className={`connection-badge ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? '● Connected' : '○ Disconnected'}
            </div>
          </div>

          {/* Backend URL */}
          <div className="settings-section">
            <h3>Backend Server URL</h3>
            <p className="settings-description">
              Configure the WebSocket URL for the VMD rendering backend.
            </p>

            <div className="settings-input-group">
              <input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="ws://localhost:8765"
                className="settings-input"
              />
            </div>

            {/* Presets */}
            <div className="settings-presets">
              <span className="presets-label">Presets:</span>
              <button
                className="preset-btn"
                onClick={() => handlePreset(BACKEND_PRESETS.local)}
              >
                Local
              </button>
              {/* Add more presets as backends are deployed */}
            </div>
          </div>

          {/* Actions */}
          <div className="settings-actions">
            <button className="btn-secondary" onClick={onReset}>
              Reset to Default
            </button>
            <button className="btn-primary" onClick={handleSave}>
              Save & Reconnect
            </button>
          </div>

          {/* Help */}
          <div className="settings-help">
            <h3>Running Your Own Backend</h3>
            <p>To run the VMD backend locally:</p>
            <code>
              conda run -n vmd-env python frame_server.py
            </code>
            <p className="settings-link">
              <a href="https://github.com/fl-sean03/molviz" target="_blank" rel="noopener noreferrer">
                View documentation on GitHub →
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
