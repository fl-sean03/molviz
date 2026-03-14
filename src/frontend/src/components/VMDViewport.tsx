import React from 'react';

interface VMDViewportProps {
  frameData: string | null;
  loading: boolean;
}

const VMDViewport: React.FC<VMDViewportProps> = ({ frameData, loading }) => {
  return (
    <div className="viewport-canvas vmd-viewport">
      {frameData ? (
        <img
          src={`data:image/png;base64,${frameData}`}
          alt="VMD Render"
          className="vmd-frame"
          draggable={false}
        />
      ) : (
        <div className="viewport-placeholder">
          {loading ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <span>Rendering...</span>
            </div>
          ) : (
            <span>Load a structure to begin</span>
          )}
        </div>
      )}

      {loading && frameData && (
        <div className="loading-overlay">
          <div className="spinner small"></div>
        </div>
      )}
    </div>
  );
};

export default VMDViewport;
