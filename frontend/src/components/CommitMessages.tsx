import React, { useState } from 'react';
import { CommitInfo } from '../types';

interface CommitMessagesProps {
  commits: CommitInfo[];
  onAmendMessage: (commitId: string, message: string) => Promise<void>;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}

const CommitMessages: React.FC<CommitMessagesProps> = ({ commits, onAmendMessage, saveStatus }) => {
  const [editingCommit, setEditingCommit] = useState<string | null>(null);
  const [editedMessage, setEditedMessage] = useState<string>('');

  if (commits.length === 0) {
    return null;
  }

  const handleStartEdit = (commit: CommitInfo) => {
    if (!commit.isHead) return; // Only HEAD can be edited
    setEditingCommit(commit.id);
    setEditedMessage(commit.message);
  };

  const handleCancelEdit = () => {
    setEditingCommit(null);
    setEditedMessage('');
  };

  const handleSaveEdit = async () => {
    if (!editingCommit || !editedMessage.trim()) return;

    try {
      await onAmendMessage(editingCommit, editedMessage);
      setEditingCommit(null);
      setEditedMessage('');
    } catch (err) {
      // Error handled by parent
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEdit();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSaveEdit();
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }}>
      <label style={{ fontSize: '14px', color: '#495057', fontWeight: 'bold' }}>
        Commits ({commits.length})
      </label>
      <div style={{
        backgroundColor: '#ffffff',
        border: '1px solid #ced4da',
        borderRadius: '4px',
        maxHeight: '200px',
        overflowY: 'auto'
      }}>
        {commits.map((commit, index) => (
          <div
            key={commit.id}
            style={{
              padding: '8px 12px',
              borderBottom: index < commits.length - 1 ? '1px solid #e9ecef' : 'none',
              backgroundColor: commit.isHead ? '#f0f7ff' : 'transparent'
            }}
          >
            {editingCommit === commit.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea
                  value={editedMessage}
                  onChange={(e) => setEditedMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  style={{
                    width: '100%',
                    minHeight: '60px',
                    padding: '8px',
                    border: '1px solid #007bff',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box'
                  }}
                  placeholder="Enter commit message..."
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '11px', color: '#6c757d', alignSelf: 'center' }}>
                    Ctrl+Enter to save, Esc to cancel
                  </span>
                  <button
                    onClick={handleCancelEdit}
                    style={{
                      padding: '4px 12px',
                      backgroundColor: '#6c757d',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saveStatus === 'saving' || !editedMessage.trim()}
                    style={{
                      padding: '4px 12px',
                      backgroundColor: saveStatus === 'saving' ? '#6c757d' : '#007bff',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: saveStatus === 'saving' || !editedMessage.trim() ? 'not-allowed' : 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {saveStatus === 'saving' ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => handleStartEdit(commit)}
                style={{
                  cursor: commit.isHead ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}
                title={commit.isHead ? 'Click to edit (HEAD commit)' : 'Only HEAD commit can be edited'}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#6c757d',
                    backgroundColor: '#f1f3f5',
                    padding: '2px 6px',
                    borderRadius: '3px'
                  }}>
                    {commit.id.substring(0, 7)}
                  </span>
                  {commit.isHead && (
                    <span style={{
                      fontSize: '10px',
                      color: '#ffffff',
                      backgroundColor: '#007bff',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontWeight: 'bold'
                    }}>
                      HEAD
                    </span>
                  )}
                  <span style={{
                    fontSize: '11px',
                    color: '#868e96'
                  }}>
                    {commit.author}
                  </span>
                </div>
                <div style={{
                  fontSize: '13px',
                  color: '#212529',
                  marginTop: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span style={{ flex: 1 }}>{commit.message}</span>
                  {commit.isHead && (
                    <span style={{
                      fontSize: '11px',
                      color: '#007bff',
                      opacity: 0.7
                    }}>
                      (click to edit)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CommitMessages;
