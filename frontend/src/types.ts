export interface DiffInfo {
  id: string;
  message: string;
  author: string;
  timestamp: string;
  filesCount: number;
  additions: number;
  deletions: number;
}

export interface FileInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  oldContent: string;
  newContent: string;
}

export interface Comment {
  id: string;
  line: number;
  side: 'left' | 'right';
  text: string;
  author: string;
  timestamp: string | Date;
  selectedText?: string; // For selection-based comments
  startLine?: number;    // For multi-line selections
  endLine?: number;      // For multi-line selections
  filePath: string;      // File this comment belongs to
  diffId: string;        // Diff this comment belongs to
}
