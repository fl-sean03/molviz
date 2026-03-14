import React from 'react';

interface ToolbarProps {
  onOpenLibrary: () => void;
  onResetView: () => void;
  onSaveView: () => void;
  structurePath: string | null;
}

const Toolbar: React.FC<ToolbarProps> = ({
  onOpenLibrary,
  onResetView,
  onSaveView,
  structurePath
}) => {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <button
          className="toolbar-btn primary"
          onClick={onOpenLibrary}
          title="Open Structure Library"
        >
          <span className="btn-icon">📂</span>
          <span className="btn-label">Open</span>
        </button>

        <button
          className="toolbar-btn"
          onClick={onResetView}
          disabled={!structurePath}
          title="Reset View"
        >
          <span className="btn-icon">🔄</span>
          <span className="btn-label">Reset</span>
        </button>

        <button
          className="toolbar-btn"
          onClick={onSaveView}
          disabled={!structurePath}
          title="Save Current View"
        >
          <span className="btn-icon">💾</span>
          <span className="btn-label">Save View</span>
        </button>
      </div>

      <div className="toolbar-section center">
        <span className="app-title">MolViz</span>
      </div>

      <div className="toolbar-section right">
        <button
          className="toolbar-btn"
          disabled={!structurePath}
          title="Render High Quality"
        >
          <span className="btn-icon">🎬</span>
          <span className="btn-label">Render HD</span>
        </button>

        <button
          className="toolbar-btn"
          disabled={!structurePath}
          title="Copy View for Claude"
        >
          <span className="btn-icon">📋</span>
          <span className="btn-label">Copy</span>
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
