import { DiffInfo, FileInfo, FileDiff } from './types';

// Use relative API calls when served from same origin, or full URL for dev mode
const API_BASE = window.location.port === '3000' ? 'http://localhost:8080/api' : '/api';

export class DiffAPI {
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
}
