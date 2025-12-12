package main

import (
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

// Global git repository root and secured root for file access
var (
	gitRoot    string
	secureRoot *os.Root
)

type DiffInfo struct {
	ID         string    `json:"id"`
	Message    string    `json:"message"`
	Author     string    `json:"author"`
	Timestamp  time.Time `json:"timestamp"`
	FilesCount int       `json:"filesCount"`
	Additions  int       `json:"additions"`
	Deletions  int       `json:"deletions"`
}

type FileInfo struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // added, modified, deleted
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

type FileDiff struct {
	Path       string `json:"path"`
	OldContent string `json:"oldContent"`
	NewContent string `json:"newContent"`
}

// CommitInfo represents a commit in the range from base commit to HEAD
type CommitInfo struct {
	ID        string    `json:"id"`
	Message   string    `json:"message"`
	Author    string    `json:"author"`
	Timestamp time.Time `json:"timestamp"`
	IsHead    bool      `json:"isHead"` // True if this is the HEAD commit (can be amended)
}

func main() {
	// Parse command-line flags
	var (
		addr = flag.String("addr", "localhost", "listen address")
		port = flag.String("port", "3844", "listen port")
		open = flag.Bool("open", false, "automatically open web browser")
	)
	flag.Parse()

	// Check if we're in a git repository and get the root
	var err error
	gitRoot, err = getGitRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Create a secure root to enforce filesystem boundaries
	secureRoot, err = os.OpenRoot(gitRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to create secure root: %v\n", err)
		os.Exit(1)
	}

	// Set GIN to release mode for production
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// API routes
	api := r.Group("/api")
	{
		api.GET("/repo-info", getRepoInfo)
		api.GET("/diffs", getDiffs)
		api.GET("/diffs/:id/files", getDiffFiles)
		api.GET("/diffs/:id/commits", getDiffCommits)
		api.GET("/file-diff/:id/*filepath", getFileDiff)
		api.POST("/file-save/:id/*filepath", saveFile)
		api.POST("/commit/:id/amend-message", amendCommitMessage)
	}

	// Serve embedded frontend files
	frontendSubFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to create frontend sub filesystem:", err)
	}

	// Custom handler for serving embedded files
	serveFile := func(c *gin.Context, filename string) {
		data, err := frontendSubFS.Open(filename)
		if err != nil {
			c.String(http.StatusNotFound, "File not found: %s", filename)
			return
		}
		defer data.Close()
		content, _ := io.ReadAll(data)

		contentType := "text/plain"
		if strings.HasSuffix(filename, ".js") {
			contentType = "application/javascript"
		} else if strings.HasSuffix(filename, ".css") {
			contentType = "text/css"
		} else if strings.HasSuffix(filename, ".html") {
			contentType = "text/html; charset=utf-8"
		}

		c.Data(http.StatusOK, contentType, content)
	}

	// Serve index.html at root
	r.GET("/", func(c *gin.Context) {
		serveFile(c, "index.html")
	})

	// Handle all other routes - serve static files or SPA fallback
	r.NoRoute(func(c *gin.Context) {
		// Don't serve SPA fallback for API routes
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
			return
		}

		path := strings.TrimPrefix(c.Request.URL.Path, "/")

		// Try to serve the file from embedded frontend
		if _, err := frontendSubFS.Open(path); err == nil {
			serveFile(c, path)
		} else {
			// If not found, serve index.html for client-side routing
			serveFile(c, "index.html")
		}
	})

	listen := fmt.Sprintf("%s:%s", *addr, *port)
	url := fmt.Sprintf("http://%s:%s", *addr, *port)

	fmt.Printf("differing starting on %s\n", listen)
	fmt.Printf("Open %s in your browser\n", url)

	// Open browser if requested
	if *open {
		go openBrowser(url)
	}

	log.Fatal(r.Run(listen))
}

// openBrowser opens the default browser to the given URL
func openBrowser(url string) {
	time.Sleep(500 * time.Millisecond) // Give server time to start
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		fmt.Println("Unable to open browser on this platform")
		return
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Failed to open browser: %v", err)
	}
}

func getRepoInfo(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"path": gitRoot})
}

func getDiffs(c *gin.Context) {
	var diffs []DiffInfo

	// Always include working changes entry
	// Get diffstat for working changes (unstaged + staged combined)
	workingStatCmd := exec.Command("git", "diff", "HEAD", "--numstat")
	workingStatOutput, _ := workingStatCmd.Output()
	workingAdditions, workingDeletions, workingFilesCount := parseDiffStat(string(workingStatOutput))

	diffs = append(diffs, DiffInfo{
		ID:         "working",
		Message:    "Working Changes",
		Author:     "",
		Timestamp:  time.Now(),
		FilesCount: workingFilesCount,
		Additions:  workingAdditions,
		Deletions:  workingDeletions,
	})

	// Get git commits/diffs
	cmd := exec.Command("git", "log", "--oneline", "-20", "--pretty=format:%H%x00%s%x00%an%x00%at")
	output, err := cmd.Output()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get git log"})
		return
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")

	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) < 4 {
			continue
		}

		timestamp, _ := strconv.ParseInt(parts[3], 10, 64)

		// Get diffstat for this commit
		statCmd := exec.Command("git", "diff", parts[0]+"^", parts[0], "--numstat")
		statOutput, _ := statCmd.Output()
		additions, deletions, filesCount := parseDiffStat(string(statOutput))

		diffs = append(diffs, DiffInfo{
			ID:         parts[0],
			Message:    parts[1],
			Author:     parts[2],
			Timestamp:  time.Unix(timestamp, 0),
			FilesCount: filesCount,
			Additions:  additions,
			Deletions:  deletions,
		})
	}

	c.JSON(http.StatusOK, diffs)
}

// parseDiffStat parses git diff --numstat output and returns additions, deletions, and file count
func parseDiffStat(output string) (additions, deletions, filesCount int) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			// Handle binary files (shown as "-" in numstat)
			if parts[0] != "-" {
				add, _ := strconv.Atoi(parts[0])
				additions += add
			}
			if parts[1] != "-" {
				del, _ := strconv.Atoi(parts[1])
				deletions += del
			}
			filesCount++
		}
	}
	return
}

func getDiffFiles(c *gin.Context) {
	diffID := c.Param("id")

	var cmd *exec.Cmd
	var statBaseArg string

	if diffID == "working" {
		// For working changes, diff HEAD against working tree
		cmd = exec.Command("git", "diff", "--name-status", "HEAD")
		statBaseArg = "HEAD"
	} else {
		// Get files changed from parent of commit to working tree
		// This shows all changes including the selected commit
		cmd = exec.Command("git", "diff", "--name-status", diffID+"^")
		statBaseArg = diffID + "^"
	}

	output, err := cmd.Output()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get diff files"})
		return
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var files []FileInfo

	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		status := "modified"
		switch parts[0] {
		case "A":
			status = "added"
		case "D":
			status = "deleted"
		case "M":
			status = "modified"
		}

		// Get additions/deletions for this file
		statCmd := exec.Command("git", "diff", statBaseArg, "--numstat", "--", parts[1])
		statOutput, _ := statCmd.Output()
		additions, deletions := 0, 0
		if statOutput != nil {
			statParts := strings.Fields(string(statOutput))
			if len(statParts) >= 2 {
				additions, _ = strconv.Atoi(statParts[0])
				deletions, _ = strconv.Atoi(statParts[1])
			}
		}

		files = append(files, FileInfo{
			Path:      parts[1],
			Status:    status,
			Additions: additions,
			Deletions: deletions,
		})
	}

	// Sort files alphabetically
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})

	c.JSON(http.StatusOK, files)
}

func getFileDiff(c *gin.Context) {
	diffID := c.Param("id")
	filePath := strings.TrimPrefix(c.Param("filepath"), "/")

	var oldCmd *exec.Cmd
	if diffID == "working" {
		// For working changes, compare HEAD to working tree
		oldCmd = exec.Command("git", "show", "HEAD:"+filePath)
	} else {
		// Get old version of file (from parent of selected commit)
		oldCmd = exec.Command("git", "show", diffID+"^:"+filePath)
	}

	oldOutput, _ := oldCmd.Output()
	oldContent := string(oldOutput)

	// Get new version of file (from working tree)
	// Use secureRoot which is rooted at gitRoot, ensuring correct path resolution
	// regardless of the current working directory
	newContent := ""
	if file, err := secureRoot.Open(filePath); err == nil {
		if fileData, err := io.ReadAll(file); err == nil {
			newContent = string(fileData)
		}
		file.Close()
	}

	fileDiff := FileDiff{
		Path:       filePath,
		OldContent: oldContent,
		NewContent: newContent,
	}

	c.JSON(http.StatusOK, fileDiff)
}

// getGitRoot returns the root directory of the git repository
// This works for both regular repositories and git worktrees
func getGitRoot() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("not a git repository")
	}
	return strings.TrimSpace(string(output)), nil
}

// validateRepoPath verifies that a file is tracked by git and within the repository boundaries
// Returns an error if the file is not tracked or path traversal is attempted
func validateRepoPath(filePath string) error {
	// Prevent empty or absolute paths
	if filePath == "" || filepath.IsAbs(filePath) {
		return fmt.Errorf("invalid file path: %s", filePath)
	}

	// Check if the file is tracked by git
	cmd := exec.Command("git", "-C", gitRoot, "ls-files", "--error-unmatch", filePath)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("file not tracked by git: %s", filePath)
	}

	// Additional check: ensure the path doesn't escape the repository
	// This is redundant with os.Root but provides defense in depth
	fullPath := filepath.Join(gitRoot, filePath)
	absRepoDir, err := filepath.Abs(gitRoot)
	if err != nil {
		return fmt.Errorf("unable to resolve repository path: %w", err)
	}

	absFilePath, err := filepath.Abs(fullPath)
	if err != nil {
		return fmt.Errorf("unable to resolve file path: %w", err)
	}

	// Ensure the file is within the repository
	if !strings.HasPrefix(absFilePath, absRepoDir+string(filepath.Separator)) &&
		absFilePath != absRepoDir {
		return fmt.Errorf("file path outside repository: %s", filePath)
	}

	return nil
}

func saveFile(c *gin.Context) {
	filePath := strings.TrimPrefix(c.Param("filepath"), "/")

	var req struct {
		Content string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Validate that the file is tracked by git and within repository boundaries
	if err := validateRepoPath(filePath); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	// Use the secure root to write the file, which provides additional protection
	// against directory traversal attacks
	file, err := secureRoot.OpenFile(filePath, os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer file.Close()

	_, err = file.Write([]byte(req.Content))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to write file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "File saved successfully", "path": filePath})
}

// getDiffCommits returns all commits from the selected base commit (exclusive) to HEAD (inclusive)
// For "working" diff, returns commits from HEAD~20 to HEAD
func getDiffCommits(c *gin.Context) {
	diffID := c.Param("id")

	var commits []CommitInfo

	// Get HEAD commit hash
	headCmd := exec.Command("git", "rev-parse", "HEAD")
	headCmd.Dir = gitRoot
	headOutput, err := headCmd.Output()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get HEAD"})
		return
	}
	headHash := strings.TrimSpace(string(headOutput))

	var logCmd *exec.Cmd
	if diffID == "working" {
		// For working changes, show recent commits (similar to getDiffs)
		logCmd = exec.Command("git", "log", "--oneline", "-20", "--pretty=format:%H%x00%s%x00%an%x00%at")
	} else {
		// Get commits from base commit (exclusive) to HEAD (inclusive)
		// Use diffID^..HEAD to exclude the base commit itself
		logCmd = exec.Command("git", "log", "--pretty=format:%H%x00%s%x00%an%x00%at", diffID+"^..HEAD")
	}
	logCmd.Dir = gitRoot

	output, err := logCmd.Output()
	if err != nil {
		// If the range fails (e.g., initial commit), just return HEAD
		logCmd = exec.Command("git", "log", "--oneline", "-1", "--pretty=format:%H%x00%s%x00%an%x00%at")
		logCmd.Dir = gitRoot
		output, err = logCmd.Output()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get commits"})
			return
		}
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) < 4 {
			continue
		}

		timestamp, _ := strconv.ParseInt(parts[3], 10, 64)

		commits = append(commits, CommitInfo{
			ID:        parts[0],
			Message:   parts[1],
			Author:    parts[2],
			Timestamp: time.Unix(timestamp, 0),
			IsHead:    parts[0] == headHash,
		})
	}

	c.JSON(http.StatusOK, commits)
}

// amendCommitMessage amends the commit message of HEAD
// Only allowed if the specified commit ID matches HEAD
func amendCommitMessage(c *gin.Context) {
	commitID := c.Param("id")

	var req struct {
		Message string `json:"message"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if strings.TrimSpace(req.Message) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Commit message cannot be empty"})
		return
	}

	// Get HEAD commit hash
	headCmd := exec.Command("git", "rev-parse", "HEAD")
	headCmd.Dir = gitRoot
	headOutput, err := headCmd.Output()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get HEAD"})
		return
	}
	headHash := strings.TrimSpace(string(headOutput))

	// Only allow amending HEAD
	if commitID != headHash {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only amend the HEAD commit"})
		return
	}

	// Check if HEAD has been pushed (warn but don't block)
	// This is informational - the actual amend will proceed
	isPushed := false
	checkCmd := exec.Command("git", "branch", "-r", "--contains", headHash)
	checkCmd.Dir = gitRoot
	if checkOutput, err := checkCmd.Output(); err == nil && len(checkOutput) > 0 {
		isPushed = true
	}

	// Perform the amend
	amendCmd := exec.Command("git", "commit", "--amend", "-m", req.Message)
	amendCmd.Dir = gitRoot
	if output, err := amendCmd.CombinedOutput(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "Failed to amend commit",
			"detail": string(output),
		})
		return
	}

	// Get new HEAD hash after amend
	newHeadCmd := exec.Command("git", "rev-parse", "HEAD")
	newHeadCmd.Dir = gitRoot
	newHeadOutput, _ := newHeadCmd.Output()
	newHeadHash := strings.TrimSpace(string(newHeadOutput))

	response := gin.H{
		"message":   "Commit message amended successfully",
		"newCommit": newHeadHash,
	}
	if isPushed {
		response["warning"] = "This commit may have been pushed to a remote. You may need to force push."
	}

	c.JSON(http.StatusOK, response)
}
