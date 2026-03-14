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
    // Sample structures available on the cloud backend
    setStructures([
      {
        id: 1,
        name: 'Crambin',
        path: '/home/molviz/molviz/data/1crn.pdb',
        atom_count: 327,
        created_at: 'PDB: 1CRN'
      },
      {
        id: 2,
        name: 'Ubiquitin',
        path: '/home/molviz/molviz/data/1ubq.pdb',
        atom_count: 660,
        created_at: 'PDB: 1UBQ'
      },
      {
        id: 3,
        name: 'Porin',
        path: '/home/molviz/molviz/data/2por.pdb',
        atom_count: 4854,
        created_at: 'PDB: 2POR'
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
