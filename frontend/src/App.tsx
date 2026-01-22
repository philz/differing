import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DiffInfo, FileInfo, FileDiff, Comment } from './types';
import { DiffAPI } from './api';
import DiffChooser from './components/DiffChooser';
import FileChooser from './components/FileChooser';
import DiffEditor, { ViewMode } from './components/DiffEditor';
import FloatingCommentPanel from './components/FloatingCommentPanel';

export interface DiffEditorHandle {
  goToNextChange: () => void;
  goToPreviousChange: () => void;
  resetChangeIndex: () => void;
}

interface CommentHistoryEntry {
  timestamp: string;
  comments: Comment[];
  commentText: string;
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
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [commentHistory, setCommentHistory] = useState<CommentHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [mode, setMode] = useState<ViewMode>('comment');
  const [showKeyboardHint, setShowKeyboardHint] = useState(false);
  const hasShownKeyboardHint = useRef(false);
  const diffEditorRef = useRef<DiffEditorHandle>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<ViewMode>(mode);

  // Keep modeRef in sync
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Show keyboard hint toast on first file load
  useEffect(() => {
    if (fileDiff && !hasShownKeyboardHint.current) {
      hasShownKeyboardHint.current = true;
      setShowKeyboardHint(true);
    }
  }, [fileDiff]);

  // Auto-hide keyboard hint after 6 seconds
  useEffect(() => {
    if (showKeyboardHint) {
      const timer = setTimeout(() => setShowKeyboardHint(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showKeyboardHint]);

  // Close history dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };

    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showHistory]);

  // LocalStorage key based on repo path
  const getStorageKey = (suffix: string) => repoPath ? `diffy:${repoPath}:${suffix}` : null;

  // Load repo info and diffs on mount
  useEffect(() => {
    loadRepoInfo();
    loadDiffs();
  }, []);

  // Load comments from localStorage when repoPath is available
  useEffect(() => {
    if (!repoPath) return;

    const commentsKey = getStorageKey('comments');
    const historyKey = getStorageKey('history');

    if (commentsKey) {
      const stored = localStorage.getItem(commentsKey);
      if (stored) {
        try {
          setAllComments(JSON.parse(stored));
        } catch (e) {
          console.error('Failed to parse stored comments:', e);
        }
      }
    }

    if (historyKey) {
      const stored = localStorage.getItem(historyKey);
      if (stored) {
        try {
          setCommentHistory(JSON.parse(stored));
        } catch (e) {
          console.error('Failed to parse stored history:', e);
        }
      }
    }
  }, [repoPath]);

  // Save comments to localStorage when they change
  useEffect(() => {
    const commentsKey = getStorageKey('comments');
    if (commentsKey && repoPath) {
      localStorage.setItem(commentsKey, JSON.stringify(allComments));
    }
  }, [allComments, repoPath]);

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

  const loadRepoInfo = async () => {
    try {
      const info = await DiffAPI.getRepoInfo();
      setRepoPath(info.path);
    } catch (err) {
      console.error('Failed to load repo info:', err);
    }
  };

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
    if (!commentText.trim()) return;
    try {
      await navigator.clipboard.writeText(commentText);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  };

  const handleClearComments = () => {
    if (allComments.length === 0) return;

    // Save current state to history before clearing
    const historyEntry: CommentHistoryEntry = {
      timestamp: new Date().toISOString(),
      comments: allComments,
      commentText: commentText
    };

    const newHistory = [historyEntry, ...commentHistory].slice(0, 20); // Keep last 20
    setCommentHistory(newHistory);

    // Save history to localStorage
    const historyKey = getStorageKey('history');
    if (historyKey) {
      localStorage.setItem(historyKey, JSON.stringify(newHistory));
    }

    // Clear comments
    setAllComments([]);
    setCommentText('');
  };

  const handleRestoreHistory = (entry: CommentHistoryEntry) => {
    setAllComments(entry.comments);
    setShowHistory(false);
  };

  const handleDeleteHistoryEntry = (timestamp: string) => {
    const newHistory = commentHistory.filter(h => h.timestamp !== timestamp);
    setCommentHistory(newHistory);

    const historyKey = getStorageKey('history');
    if (historyKey) {
      localStorage.setItem(historyKey, JSON.stringify(newHistory));
    }
  };

  // File navigation functions
  const goToNextFile = useCallback(() => {
    if (files.length === 0 || !selectedFile) return false;
    const currentIndex = files.findIndex(f => f.path === selectedFile);
    if (currentIndex < files.length - 1) {
      setSelectedFile(files[currentIndex + 1].path);
      diffEditorRef.current?.resetChangeIndex();
      return true;
    }
    return false;
  }, [files, selectedFile]);

  const goToPreviousFile = useCallback(() => {
    if (files.length === 0 || !selectedFile) return false;
    const currentIndex = files.findIndex(f => f.path === selectedFile);
    if (currentIndex > 0) {
      setSelectedFile(files[currentIndex - 1].path);
      diffEditorRef.current?.resetChangeIndex();
      return true;
    }
    return false;
  }, [files, selectedFile]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Comment mode navigation shortcuts (only when not in an input)
      const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                            document.activeElement?.tagName === 'TEXTAREA';

      if (modeRef.current === 'comment' && !isInputFocused) {
        if (e.key === '.') {
          e.preventDefault();
          diffEditorRef.current?.goToNextChange();
          return;
        } else if (e.key === ',') {
          e.preventDefault();
          diffEditorRef.current?.goToPreviousChange();
          return;
        } else if (e.key === '>') {
          e.preventDefault();
          goToNextFile();
          return;
        } else if (e.key === '<') {
          e.preventDefault();
          goToPreviousFile();
          return;
        }
      }

      // Ctrl+key combinations work in both modes
      if (!e.ctrlKey && !e.metaKey) return;

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

    // Use capture phase to intercept events before Monaco editor handles them
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
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
            {mode === 'comment' ? '. , change  &lt; &gt; file' : '^j/k file  ^n/p change'}
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

        {/* Mode toggle */}
        <div style={{
          display: 'flex',
          border: '1px solid #ced4da',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <button
            onClick={() => setMode('comment')}
            style={{
              padding: '8px 12px',
              backgroundColor: mode === 'comment' ? '#007bff' : '#ffffff',
              color: mode === 'comment' ? '#ffffff' : '#495057',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s'
            }}
            title="Comment mode - click to add comments"
          >
            💬
          </button>
          <button
            onClick={() => setMode('edit')}
            style={{
              padding: '8px 12px',
              backgroundColor: mode === 'edit' ? '#007bff' : '#ffffff',
              color: mode === 'edit' ? '#ffffff' : '#495057',
              border: 'none',
              borderLeft: '1px solid #ced4da',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s'
            }}
            title="Edit mode - make changes to the file"
          >
            ✏️
          </button>
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
            backgroundColor: copyStatus === 'copied' ? '#218838' :
                           copyStatus === 'error' ? '#dc3545' :
                           !commentText.trim() ? '#e9ecef' : '#28a745',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: !commentText.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '500',
            opacity: !commentText.trim() ? 0.5 : 1,
            transition: 'background-color 0.2s'
          }}
          title="Copy comments to clipboard"
        >
          {copyStatus === 'copied' ? '✓ Copied!' :
           copyStatus === 'error' ? '✗ Error' :
           '📋 Copy'}
        </button>

        {/* Clear comments button */}
        <button
          onClick={handleClearComments}
          disabled={allComments.length === 0}
          style={{
            padding: '8px 16px',
            backgroundColor: allComments.length === 0 ? '#e9ecef' : '#dc3545',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: allComments.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '500',
            opacity: allComments.length === 0 ? 0.5 : 1
          }}
          title="Clear all comments (saves to history)"
        >
          🗑 Clear
        </button>

        {/* History button */}
        <div ref={historyDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            disabled={commentHistory.length === 0}
            style={{
              padding: '8px 16px',
              backgroundColor: showHistory ? '#6c757d' : '#ffffff',
              color: showHistory ? '#ffffff' : '#495057',
              border: '1px solid #6c757d',
              borderRadius: '4px',
              cursor: commentHistory.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: '500',
              opacity: commentHistory.length === 0 ? 0.5 : 1
            }}
            title="View comment history"
          >
            📜 History ({commentHistory.length})
          </button>

          {/* History dropdown */}
          {showHistory && commentHistory.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              width: '350px',
              maxHeight: '400px',
              overflowY: 'auto',
              backgroundColor: '#ffffff',
              border: '1px solid #dee2e6',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              zIndex: 3000
            }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #dee2e6',
                backgroundColor: '#f8f9fa',
                borderRadius: '8px 8px 0 0',
                fontWeight: '600',
                fontSize: '14px'
              }}>
                Comment History
              </div>
              {commentHistory.map((entry) => (
                <div
                  key={entry.timestamp}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #f0f0f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '13px', color: '#495057' }}>
                      {entry.comments.length} comment{entry.comments.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: '#868e96',
                      marginTop: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {entry.commentText.slice(0, 60)}{entry.commentText.length > 60 ? '...' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button
                      onClick={() => handleRestoreHistory(entry)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#007bff',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                      title="Restore these comments"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => handleDeleteHistoryEntry(entry.timestamp)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#dc3545',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                      title="Delete this history entry"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
              mode={mode}
              onContentChange={handleContentChange}
              onAddComment={handleAddComment}
              onNextFile={goToNextFile}
              onPreviousFile={goToPreviousFile}
              onNextChange={() => diffEditorRef.current?.goToNextChange()}
              onPreviousChange={() => diffEditorRef.current?.goToPreviousChange()}
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

      {/* Save status toast */}
      {saveStatus !== 'idle' && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          whiteSpace: 'nowrap',
          backgroundColor: saveStatus === 'saving' ? '#1976d2' :
                         saveStatus === 'saved' ? '#2e7d32' : '#d32f2f',
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 9999,
          transition: 'opacity 0.2s ease-in-out'
        }}>
          {saveStatus === 'saving' && '💾 Saving...'}
          {saveStatus === 'saved' && '✅ Saved'}
          {saveStatus === 'error' && '❌ Error saving'}
        </div>
      )}

      {/* Keyboard hint toast */}
      {showKeyboardHint && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          whiteSpace: 'nowrap',
          backgroundColor: '#495057',
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 9999
        }}>
          ⌨️ Use . , for next/prev change, &lt; &gt; for files
        </div>
      )}
    </div>
  );
};

export default App;
