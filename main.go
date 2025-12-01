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
		api.GET("/diffs", getDiffs)
		api.GET("/diffs/:id/files", getDiffFiles)
		api.GET("/file-diff/:id/*filepath", getFileDiff)
		api.POST("/file-save/:id/*filepath", saveFile)
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
	newContent := ""
	if fileData, err := os.ReadFile(filePath); err == nil {
		newContent = string(fileData)
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
