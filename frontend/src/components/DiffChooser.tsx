import React from 'react';
import { DiffInfo } from '../types';

interface DiffChooserProps {
  diffs: DiffInfo[];
  selectedDiff: string | null;
  onSelectDiff: (diffId: string) => void;
}

const DiffChooser: React.FC<DiffChooserProps> = ({ diffs, selectedDiff, onSelectDiff }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }}>
      <label style={{ fontSize: '14px', color: '#495057', fontWeight: 'bold' }}>Base Commit</label>
      <select
        value={selectedDiff || ''}
        onChange={(e) => onSelectDiff(e.target.value)}
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: '#ffffff',
          color: '#495057',
          border: '1px solid #ced4da',
          borderRadius: '4px',
          fontSize: '14px'
        }}
      >
        <option value="">Choose base commit...</option>
        {diffs.map((diff) => {
          const stats = `${diff.filesCount} files, +${diff.additions}/-${diff.deletions}`;
          return (
            <option key={diff.id} value={diff.id}>
              {diff.id === 'working'
                ? `Working Changes (${stats})`
                : `${diff.message} - ${diff.author} (${stats})`}
            </option>
          );
        })}
      </select>
    </div>
  );
};

export default DiffChooser;
