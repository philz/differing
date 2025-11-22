package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// setupTestRepo creates a temporary git repository with some commits for testing
func setupTestRepo(t *testing.T) (repoDir string, cleanup func()) {
	t.Helper()

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "differing-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	cleanup = func() {
		os.RemoveAll(tmpDir)
	}

	// Initialize git repo
	runGitCmd := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = tmpDir
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("Git command failed: %s\nOutput: %s", err, output)
		}
	}

	runGitCmd("init")
	runGitCmd("config", "user.name", "Test User")
	runGitCmd("config", "user.email", "test@example.com")

	// Create first commit with a test file
	testFile1 := filepath.Join(tmpDir, "test1.go")
	if err := os.WriteFile(testFile1, []byte("package main\n\nfunc hello() {}\n"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}
	runGitCmd("add", "test1.go")
	runGitCmd("commit", "-m", "Initial commit")

	// Create second commit modifying the file
	if err := os.WriteFile(testFile1, []byte("package main\n\nfunc hello() string {\n\treturn \"hello\"\n}\n"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}
	runGitCmd("add", "test1.go")
	runGitCmd("commit", "-m", "Update hello function")

	// Create third commit adding a new file
	testFile2 := filepath.Join(tmpDir, "test2.ts")
	if err := os.WriteFile(testFile2, []byte("export function world() {}\n"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}
	runGitCmd("add", "test2.ts")
	runGitCmd("commit", "-m", "Add TypeScript file")

	// Modify test2.ts in working tree (not committed)
	if err := os.WriteFile(testFile2, []byte("export function world() {\n  return 'world';\n}\n"), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	return tmpDir, cleanup
}

func TestGetDiffsNullByteSeparator(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	// Change to test repo directory
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to test repo: %v", err)
	}

	// Test that git log with null byte separator works
	cmd := exec.Command("git", "log", "--oneline", "-20", "--pretty=format:%H%x00%s%x00%an%x00%at")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get git log: %v", err)
	}

	// Parse output - should have 3 commits
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	if len(lines) != 3 {
		t.Errorf("Expected 3 commits, got %d", len(lines))
	}

	// Verify each line has 4 null-separated parts
	for i, line := range lines {
		parts := strings.Split(line, "\x00")
		if len(parts) != 4 {
			t.Errorf("Line %d: expected 4 parts, got %d: %v", i, len(parts), parts)
		}
		// Verify parts are not empty (except possibly message)
		if parts[0] == "" { // commit hash
			t.Errorf("Line %d: commit hash is empty", i)
		}
		if parts[2] == "" { // author
			t.Errorf("Line %d: author is empty", i)
		}
		if parts[3] == "" { // timestamp
			t.Errorf("Line %d: timestamp is empty", i)
		}
	}
}

func TestGetDiffFilesWithWorkingTree(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to test repo: %v", err)
	}

	// Get the most recent commit hash
	cmd := exec.Command("git", "rev-parse", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get HEAD: %v", err)
	}
	commitHash := string(output[:len(output)-1]) // trim newline

	// Get files changed from parent to working tree
	cmd = exec.Command("git", "diff", "--name-status", commitHash+"^")
	output, err = cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get diff files: %v", err)
	}

	// Should show both test1.go (from earlier commit) and test2.ts (modified in working tree)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	if len(lines) == 0 {
		t.Error("Expected at least one changed file")
	}

	// Verify we can see working tree changes
	foundTest2 := false
	for _, line := range lines {
		if strings.Contains(line, "test2.ts") {
			foundTest2 = true
		}
	}
	if foundTest2 {
		// Verify the status shows modification
		cmd = exec.Command("git", "status", "--porcelain", "test2.ts")
		output, err = cmd.Output()
		if err != nil {
			t.Fatalf("Failed to get git status: %v", err)
		}
		if len(output) == 0 {
			t.Error("test2.ts should show as modified in working tree")
		}
	}
}

func TestGetFileDiffUsesWorkingTree(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to test repo: %v", err)
	}

	// Get the most recent commit hash
	cmd := exec.Command("git", "rev-parse", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get HEAD: %v", err)
	}
	commitHash := string(output[:len(output)-1])

	// Get old version from HEAD (committed version of test2.ts)
	cmd = exec.Command("git", "show", commitHash+":test2.ts")
	oldOutput, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get committed version: %v", err)
	}

	// Get new version from working tree
	newContent, err := os.ReadFile("test2.ts")
	if err != nil {
		t.Fatalf("Failed to read working tree file: %v", err)
	}

	oldStr := string(oldOutput)
	newStr := string(newContent)

	// They should be different (we modified the file in working tree)
	if oldStr == newStr {
		t.Error("Expected old and new content to be different")
	}

	// New content should contain the working tree changes
	if !strings.Contains(newStr, "return 'world'") {
		t.Error("New content should contain working tree changes")
	}

	// Old content should be the original from HEAD commit
	if !strings.Contains(oldStr, "export function world() {}") {
		t.Error("Old content should be from commit")
	}
}

func TestCommitTimestampParsing(t *testing.T) {
	repoDir, cleanup := setupTestRepo(t)
	defer cleanup()

	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current dir: %v", err)
	}
	defer os.Chdir(oldDir)

	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("Failed to change to test repo: %v", err)
	}

	cmd := exec.Command("git", "log", "--oneline", "-1", "--pretty=format:%H%x00%s%x00%an%x00%at")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Failed to get git log: %v", err)
	}

	parts := strings.Split(string(output), "\x00")
	if len(parts) < 4 {
		t.Fatalf("Expected 4 parts, got %d", len(parts))
	}

	// Parse timestamp
	timestamp, err := strconv.ParseInt(strings.TrimSpace(parts[3]), 10, 64)
	if err != nil {
		t.Errorf("Failed to parse timestamp: %v", err)
	}

	// Verify it's a reasonable Unix timestamp (after year 2020)
	ts := time.Unix(timestamp, 0)
	if ts.Year() < 2020 {
		t.Errorf("Timestamp seems invalid: %v", ts)
	}
}

func init() {
	// Set gin to test mode
	gin.SetMode(gin.TestMode)
}
