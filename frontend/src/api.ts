import { DiffInfo, FileInfo, FileDiff, CommitInfo } from './types';

// Use relative API calls when served from same origin, or full URL for dev mode
const API_BASE = window.location.port === '3000' ? 'http://localhost:8080/api' : '/api';

export interface RepoInfo {
  path: string;
}

export class DiffAPI {
  static async getRepoInfo(): Promise<RepoInfo> {
    const response = await fetch(`${API_BASE}/repo-info`);
    if (!response.ok) {
      throw new Error('Failed to fetch repo info');
    }
    return response.json();
  }

  static async getDiffs(): Promise<DiffInfo[]> {
    const response = await fetch(`${API_BASE}/diffs`);
    if (!response.ok) {
      throw new Error('Failed to fetch diffs');
    }
    return response.json();
  }

  static async getDiffFiles(diffId: string): Promise<FileInfo[]> {
    const response = await fetch(`${API_BASE}/diffs/${diffId}/files`);
    if (!response.ok) {
      throw new Error('Failed to fetch diff files');
    }
    return response.json();
  }

  static async getFileDiff(diffId: string, filePath: string): Promise<FileDiff> {
    const response = await fetch(`${API_BASE}/file-diff/${diffId}/${filePath}`);
    if (!response.ok) {
      throw new Error('Failed to fetch file diff');
    }
    return response.json();
  }

  static async saveFile(diffId: string, filePath: string, content: string): Promise<void> {
    const response = await fetch(`${API_BASE}/file-save/${diffId}/${filePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error('Failed to save file');
    }
  }

  static async getDiffCommits(diffId: string): Promise<CommitInfo[]> {
    const response = await fetch(`${API_BASE}/diffs/${diffId}/commits`);
    if (!response.ok) {
      throw new Error('Failed to fetch diff commits');
    }
    return response.json();
  }

  static async amendCommitMessage(commitId: string, message: string): Promise<{ message: string; newCommit: string; warning?: string }> {
    const response = await fetch(`${API_BASE}/commit/${commitId}/amend-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to amend commit message');
    }
    return response.json();
  }
}
