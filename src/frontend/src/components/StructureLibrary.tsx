import React, { useState, useEffect } from 'react';

interface StructureLibraryProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

interface StructureEntry {
  id: number;
  name: string;
  path: string;
  atom_count: number;
  created_at: string;
}

const StructureLibrary: React.FC<StructureLibraryProps> = ({ onSelect, onClose }) => {
  const [structures, setStructures] = useState<StructureEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [customPath, setCustomPath] = useState('');

  // Fetch structures from database
  useEffect(() => {
    // TODO: Fetch from API
    // For now, use sample data
    setStructures([
      {
        id: 1,
        name: 'Flat on 111',
        path: '/home/sf2/LabWork/Workspace/31-Hydrogenation/presentations/2026-03-13-comprehensive-update/figures/vmd_configs/final/01_flat_6deg.pdb',
        atom_count: 601,
        created_at: '2026-03-13'
      },
      {
        id: 2,
        name: 'Tilted 36°',
        path: '/home/sf2/LabWork/Workspace/31-Hydrogenation/presentations/2026-03-13-comprehensive-update/figures/vmd_configs/final/07_tilted_36deg.pdb',
        atom_count: 580,
        created_at: '2026-03-13'
      },
      {
        id: 3,
        name: 'Edge-on 82°',
        path: '/home/sf2/LabWork/Workspace/31-Hydrogenation/presentations/2026-03-13-comprehensive-update/figures/vmd_configs/final/12_edge_on_82deg.pdb',
        atom_count: 595,
        created_at: '2026-03-13'
      }
    ]);
  }, []);

  const filteredStructures = structures.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleLoadCustomPath = () => {
    if (customPath.trim()) {
      onSelect(customPath.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Structure Library</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Search */}
          <div className="search-box">
            <input
              type="text"
              placeholder="Search structures..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Structure list */}
          <div className="structure-list">
            {filteredStructures.map(structure => (
              <div
                key={structure.id}
                className="structure-item"
                onClick={() => onSelect(structure.path)}
              >
                <div className="structure-icon">🧬</div>
                <div className="structure-info">
                  <div className="structure-name">{structure.name}</div>
                  <div className="structure-meta">
                    {structure.atom_count} atoms • {structure.created_at}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Custom path input */}
          <div className="custom-path-section">
            <h3>Load from Path</h3>
            <div className="custom-path-input">
              <input
                type="text"
                placeholder="/path/to/structure.pdb"
                value={customPath}
                onChange={e => setCustomPath(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLoadCustomPath()}
              />
              <button onClick={handleLoadCustomPath}>Load</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StructureLibrary;
