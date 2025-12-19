import React, { useState, useRef, useEffect } from 'react';
import { Comment } from '../types';

interface FloatingCommentPanelProps {
  comments: Comment[];
  isVisible: boolean;
  onClose: () => void;
  currentFile: string;
  onCommentTextChange: (text: string) => void;
}

const FloatingCommentPanel: React.FC<FloatingCommentPanelProps> = ({
  comments,
  isVisible,
  onClose,
  currentFile: _currentFile,
  onCommentTextChange
}) => {
  const [position, setPosition] = useState({ x: 50, y: window.innerHeight - 500 });
  const [size, setSize] = useState({ width: 500, height: 400 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y
        });
      } else if (isResizing) {
        const newWidth = Math.max(300, e.clientX - position.x);
        const newHeight = Math.max(200, e.clientY - position.y);
        setSize({ width: newWidth, height: newHeight });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, position]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('drag-handle')) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
  };

  const [commentText, setCommentText] = useState('');
  
  // Update comment text when comments change
  useEffect(() => {
    // Group comments by file
    const commentsByFile = comments.reduce((acc, comment) => {
      if (!acc[comment.filePath]) {
        acc[comment.filePath] = [];
      }
      acc[comment.filePath].push(comment);
      return acc;
    }, {} as Record<string, Comment[]>);

    const text = Object.entries(commentsByFile).map(([filePath, fileComments]: [string, Comment[]]) => {
      const fileSection = fileComments.map((comment: Comment) => {
        const sideLabel = comment.side === 'left' ? 'old' : 'new';
        let result = `> ${filePath} (${sideLabel}):\n`;

        // Add line-numbered code
        if (comment.selectedText) {
          const lines = comment.selectedText.split('\n');
          const startLine = comment.startLine || comment.line;
          lines.forEach((line, idx) => {
            result += `${startLine + idx}: ${line}\n`;
          });
        } else {
          result += `${comment.line}: (no code selected)\n`;
        }

        result += '\n' + comment.text + '\n';
        return result;
      }).join('\n---\n\n');

      return fileSection;
    }).join('\n---\n\n');
    
    setCommentText(text || 'No comments yet. Click on a line\'s glyph margin to add a comment.');
    onCommentTextChange(text);
  }, [comments, onCommentTextChange]);

  if (!isVisible) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        backgroundColor: '#ffffff',
        border: '2px solid #007bff',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2000,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      {/* Header with drag handle */}
      <div
        className="drag-handle"
        onMouseDown={handleMouseDown}
        style={{
          padding: '12px 16px',
          backgroundColor: '#007bff',
          color: '#ffffff',
          borderRadius: '6px 6px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>💬</span>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
            Comments
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '20px',
              padding: '0 4px',
              lineHeight: 1
            }}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        padding: '16px',
        overflowY: 'auto',
        backgroundColor: '#f8f9fa'
      }}>
        <textarea
          value={commentText}
          onChange={(e) => {
            setCommentText(e.target.value);
            onCommentTextChange(e.target.value);
          }}
          placeholder="No comments yet. Click on a line's glyph margin to add a comment."
          style={{
            width: '100%',
            height: '100%',
            border: '1px solid #ced4da',
            borderRadius: '4px',
            padding: '12px',
            fontSize: '13px',
            fontFamily: 'monospace',
            lineHeight: '1.5',
            resize: 'none',
            backgroundColor: '#ffffff',
            color: '#495057'
          }}
        />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '20px',
          height: '20px',
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, #007bff 50%)',
          borderRadius: '0 0 6px 0'
        }}
      />
    </div>
  );
};

export default FloatingCommentPanel;
