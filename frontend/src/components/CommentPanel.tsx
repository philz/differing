import React, { useState } from 'react';
import { Comment } from '../types';

interface CommentPanelProps {
  comments: Comment[];
  onDeleteComment: (commentId: string) => void;
}

const CommentPanel: React.FC<CommentPanelProps> = ({ comments, onDeleteComment }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const formatDate = (timestamp: string | Date) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    return date.toLocaleString();
  };

  return (
    <div style={{
      width: isCollapsed ? '200px' : '350px',
      maxHeight: '400px',
      backgroundColor: '#ffffff',
      border: '1px solid #ced4da',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #e5e5e5',
        borderRadius: '8px 8px 0 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{ margin: 0, color: '#495057', fontSize: '16px' }}>
          💬 Comments ({comments.length})
        </h3>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          style={{
            background: 'none',
            border: 'none',
            color: '#6c757d',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '4px'
          }}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▲' : '▼'}
        </button>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          maxHeight: '320px'
        }}>
          {comments.length === 0 ? (
            <p style={{ color: '#6c757d', fontStyle: 'italic', margin: 0, fontSize: '14px' }}>
              No comments yet. Ctrl+click on line numbers to add one.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  style={{
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #e9ecef',
                    borderRadius: '6px',
                    padding: '12px'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}>
                    <div style={{
                      fontSize: '12px',
                      color: '#6c757d'
                    }}>
                      <span style={{ fontWeight: 'bold', color: '#007bff' }}>
                        {comment.author}
                      </span>
                      {' '}on line{' '}
                      <span style={{ fontWeight: 'bold', color: '#495057' }}>
                        {comment.line}
                      </span>
                      {' '}({comment.side})
                    </div>
                    <button
                      onClick={() => onDeleteComment(comment.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc3545',
                        cursor: 'pointer',
                        fontSize: '16px',
                        padding: '2px'
                      }}
                      title="Delete comment"
                    >
                      ×
                    </button>
                  </div>
                  
                  <div style={{
                    color: '#495057',
                    fontSize: '14px',
                    lineHeight: '1.4',
                    marginBottom: '8px',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {comment.text}
                  </div>
                  
                  <div style={{
                    fontSize: '11px',
                    color: '#6c757d',
                    textAlign: 'right'
                  }}>
                    {formatDate(comment.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CommentPanel;
