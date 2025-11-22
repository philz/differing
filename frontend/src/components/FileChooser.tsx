import React from 'react';
import { FileInfo } from '../types';

interface FileChooserProps {
  files: FileInfo[];
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

const getStatusSymbol = (status: string) => {
  switch (status) {
    case 'added':
      return '+';
    case 'deleted':
      return '-';
    case 'modified':
      return '~';
    default:
      return '';
  }
};

const FileChooser: React.FC<FileChooserProps> = ({ files, selectedFile, onSelectFile }) => {
  if (files.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        <label style={{ fontSize: '14px', color: '#495057', fontWeight: 'bold' }}>Files</label>
        <div style={{
          padding: '8px',
          backgroundColor: '#f8f9fa',
          border: '1px solid #ced4da',
          borderRadius: '4px',
          color: '#6c757d',
          fontSize: '14px'
        }}>
          No files to display. Select a diff first.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }}>
      <label style={{ fontSize: '14px', color: '#495057', fontWeight: 'bold' }}>Files ({files.length})</label>
      <select
        value={selectedFile || ''}
        onChange={(e) => onSelectFile(e.target.value)}
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
        <option value="">Choose a file...</option>
        {files.map((file) => (
          <option key={file.path} value={file.path}>
            {getStatusSymbol(file.status)} {file.path}
            {file.status !== 'deleted' && file.additions > 0 && ` (+${file.additions})`}
            {file.status !== 'added' && file.deletions > 0 && ` (-${file.deletions})`}
          </option>
        ))}
      </select>
    </div>
  );
};

export default FileChooser;
