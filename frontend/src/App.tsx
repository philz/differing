import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DiffInfo, FileInfo, FileDiff, Comment } from './types';
import { DiffAPI } from './api';
import DiffChooser from './components/DiffChooser';
import FileChooser from './components/FileChooser';
import DiffEditor from './components/DiffEditor';
import FloatingCommentPanel from './components/FloatingCommentPanel';

export interface DiffEditorHandle {
  goToNextChange: () => void;
  goToPreviousChange: () => void;
}

const App: React.FC = () => {
  const [diffs, setDiffs] = useState<DiffInfo[]>([]);
  const [selectedDiff, setSelectedDiff] = useState<string | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [allComments, setAllComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showCommentPanel, setShowCommentPanel] = useState(false);
  const [commentText, setCommentText] = useState('');
  const diffEditorRef = useRef<DiffEditorHandle>(null);

  // Load available diffs on mount
  useEffect(() => {
    loadDiffs();
  }, []);

  // Load files when diff is selected
  useEffect(() => {
    if (selectedDiff) {
      loadFiles(selectedDiff);
      setSelectedFile(null);
      setFileDiff(null);
    }
  }, [selectedDiff]);

  // Load file diff when file is selected
  useEffect(() => {
    if (selectedDiff && selectedFile) {
      loadFileDiff(selectedDiff, selectedFile);
    }
  }, [selectedDiff, selectedFile]);

  // Get comments for current file
  const currentFileComments = allComments.filter(
    comment => comment.diffId === selectedDiff && comment.filePath === selectedFile
  );

  const loadDiffs = async () => {
    try {
      setLoading(true);
      setError(null);
      const diffsData = await DiffAPI.getDiffs();
      setDiffs(diffsData);
      // Auto-select: working changes if non-empty, otherwise first commit
      if (diffsData.length > 0) {
        const workingChanges = diffsData.find(d => d.id === 'working');
        if (workingChanges && workingChanges.filesCount > 0) {
          setSelectedDiff('working');
        } else if (diffsData.length > 1) {
          // Select first commit (skip working changes entry)
          setSelectedDiff(diffsData[1].id);
        }
      }
    } catch (err) {
      setError(`Failed to load diffs: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadFiles = async (diffId: string) => {
    try {
      setLoading(true);
      setError(null);
      const filesData = await DiffAPI.getDiffFiles(diffId);
      const files = filesData || []; // Handle null response
      setFiles(files);
      // Auto-select first file
      if (files.length > 0) {
        setSelectedFile(files[0].path);
      }
    } catch (err) {
      setError(`Failed to load files: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadFileDiff = async (diffId: string, filePath: string) => {
    try {
      setLoading(true);
      setError(null);
      const diffData = await DiffAPI.getFileDiff(diffId, filePath);
      setFileDiff(diffData);
    } catch (err) {
      setError(`Failed to load file diff: ${err}`);
    } finally {
      setLoading(false);
    }
  };



  const handleContentChange = async (content: string) => {
    if (!selectedDiff || !selectedFile) return;
    
    try {
      setSaveStatus('saving');
      await DiffAPI.saveFile(selectedDiff, selectedFile, content);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save file:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleAddComment = (line: number, side: 'left' | 'right', text: string, selectedText?: string, startLine?: number, endLine?: number) => {
    if (!selectedDiff || !selectedFile) return;

    const comment: Comment = {
      id: `${Date.now()}-${Math.random()}`,
      line,
      side,
      text,
      author: 'User',
      timestamp: new Date(),
      selectedText,
      startLine: startLine || line,
      endLine: endLine || line,
      filePath: selectedFile,
      diffId: selectedDiff
    };
    
    setAllComments(prev => [...prev, comment]);
  };

  // Uncomment if needed for future comment deletion feature
  // const handleDeleteComment = (commentId: string) => {
  //   setComments(prev => prev.filter(c => c.id !== commentId));
  // };
  
  const handleCopyComments = async () => {
    try {
      await navigator.clipboard.writeText(commentText);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // File navigation functions
  const goToNextFile = useCallback(() => {
    if (files.length === 0 || !selectedFile) return;
    const currentIndex = files.findIndex(f => f.path === selectedFile);
    if (currentIndex < files.length - 1) {
      setSelectedFile(files[currentIndex + 1].path);
    }
  }, [files, selectedFile]);

  const goToPreviousFile = useCallback(() => {
    if (files.length === 0 || !selectedFile) return;
    const currentIndex = files.findIndex(f => f.path === selectedFile);
    if (currentIndex > 0) {
      setSelectedFile(files[currentIndex - 1].path);
    }
  }, [files, selectedFile]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Ctrl+key combinations
      if (!e.ctrlKey) return;

      switch (e.key) {
        case 'k':
          e.preventDefault();
          goToPreviousFile();
          break;
        case 'j':
          e.preventDefault();
          goToNextFile();
          break;
        case 'p':
          e.preventDefault();
          diffEditorRef.current?.goToPreviousChange();
          break;
        case 'n':
          e.preventDefault();
          diffEditorRef.current?.goToNextChange();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNextFile, goToPreviousFile]);

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#ffffff'
    }}>
      {/* Header - Single compact row */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #e5e5e5',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap'
      }}>
        {/* App name and keyboard shortcuts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <h1 style={{
            margin: 0,
            color: '#2c3e50',
            fontSize: '20px',
            fontWeight: '600',
            letterSpacing: '-0.5px'
          }}>
            differing
          </h1>
          <div style={{
            fontSize: '10px',
            color: '#6c757d',
            fontFamily: 'monospace'
          }}>
            ^j/k file &nbsp; ^n/p change
          </div>
        </div>

        {/* Base commit selector */}
        <div style={{ minWidth: '200px', flex: '1' }}>
          <DiffChooser
            diffs={diffs}
            selectedDiff={selectedDiff}
            onSelectDiff={setSelectedDiff}
          />
        </div>

        {/* File selector */}
        <div style={{ minWidth: '200px', flex: '1' }}>
          <FileChooser
            files={files}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
        
        {/* Comment panel toggle button */}
        <button
          onClick={() => setShowCommentPanel(!showCommentPanel)}
          style={{
            padding: '8px 16px',
            backgroundColor: showCommentPanel ? '#007bff' : '#ffffff',
            color: showCommentPanel ? '#ffffff' : '#495057',
            border: '1px solid #007bff',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '500',
            transition: 'all 0.2s'
          }}
          title="Toggle comment panel"
        >
          💬 Comments
        </button>
        
        {/* Copy comments button */}
        <button
          onClick={handleCopyComments}
          disabled={!commentText.trim()}
          style={{
            padding: '8px 16px',
            backgroundColor: !commentText.trim() ? '#e9ecef' : '#28a745',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: !commentText.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '500',
            opacity: !commentText.trim() ? 0.5 : 1
          }}
          title="Copy comments to clipboard"
        >
          📋 Copy
        </button>
        
        {/* Save status indicator */}
        {saveStatus !== 'idle' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '14px',
            whiteSpace: 'nowrap',
            backgroundColor: saveStatus === 'saving' ? '#e3f2fd' : 
                           saveStatus === 'saved' ? '#e8f5e8' : '#ffeaa7',
            color: saveStatus === 'saving' ? '#1976d2' : 
                   saveStatus === 'saved' ? '#2e7d32' : '#d68910',
            border: `1px solid ${
              saveStatus === 'saving' ? '#bbdefb' : 
              saveStatus === 'saved' ? '#c8e6c9' : '#f9ca24'
            }`
          }}>
            {saveStatus === 'saving' && '💾 Saving...'}
            {saveStatus === 'saved' && '✅ Saved'}
            {saveStatus === 'error' && '❌ Error saving'}
          </div>
        )}

      </div>

      {/* Error banner - separate row if needed */}
      {error && (
        <div style={{
          padding: '8px 16px',
          backgroundColor: '#fff3cd',
          color: '#856404',
          border: '1px solid #ffeaa7',
          borderBottom: '1px solid #e5e5e5',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {/* Main content area */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {loading && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6c757d'
          }}>
            Loading...
          </div>
        )}
        
        {!loading && !fileDiff && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6c757d',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h2 style={{ margin: 0, color: '#495057' }}>Welcome to Diff Viewer</h2>
            <p style={{ margin: 0, textAlign: 'center' }}>
              Select a diff and file from the dropdowns above to start viewing changes.
            </p>
          </div>
        )}

        {!loading && fileDiff && selectedDiff && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <DiffEditor
              ref={diffEditorRef}
              fileDiff={fileDiff}
              comments={currentFileComments}
              onContentChange={handleContentChange}
              onAddComment={handleAddComment}
            />
          </div>
        )}

        {/* Floating comment panel */}
        <FloatingCommentPanel
          comments={allComments}
          isVisible={showCommentPanel}
          onClose={() => setShowCommentPanel(false)}
          currentFile={selectedFile || 'Unknown file'}
          onCommentTextChange={setCommentText}
        />
      </div>
    </div>
  );
};

export default App;
