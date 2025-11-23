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
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

type DiffInfo struct {
	ID         string    `json:"id"`
	Message    string    `json:"message"`
	Author     string    `json:"author"`
	Timestamp  time.Time `json:"timestamp"`
	FilesCount int       `json:"filesCount"`
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

	// Check if we're in a git repository
	cmd := exec.Command("git", "rev-parse", "--git-dir")
	if err := cmd.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "Error: not a git repository")
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
	// Get git commits/diffs
	cmd := exec.Command("git", "log", "--oneline", "-20", "--pretty=format:%H%x00%s%x00%an%x00%at")
	output, err := cmd.Output()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get git log"})
		return
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var diffs []DiffInfo

	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) < 4 {
			continue
		}

		timestamp, _ := strconv.ParseInt(parts[3], 10, 64)

		// Get file count for this commit
		countCmd := exec.Command("git", "diff-tree", "--no-commit-id", "--name-only", "-r", parts[0])
		countOutput, _ := countCmd.Output()
		filesCount := len(strings.Split(strings.TrimSpace(string(countOutput)), "\n"))
		if string(countOutput) == "" {
			filesCount = 0
		}

		diffs = append(diffs, DiffInfo{
			ID:         parts[0],
			Message:    parts[1],
			Author:     parts[2],
			Timestamp:  time.Unix(timestamp, 0),
			FilesCount: filesCount,
		})
	}

	c.JSON(http.StatusOK, diffs)
}

func getDiffFiles(c *gin.Context) {
	diffID := c.Param("id")

	// Get files changed from parent of commit to working tree
	// This shows all changes including the selected commit
	cmd := exec.Command("git", "diff", "--name-status", diffID+"^")
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
		statCmd := exec.Command("git", "diff", diffID+"^", "--numstat", "--", parts[1])
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

	// Get old version of file (from parent of selected commit)
	oldCmd := exec.Command("git", "show", diffID+"^:"+filePath)
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

func saveFile(c *gin.Context) {
	filePath := strings.TrimPrefix(c.Param("filepath"), "/")

	var req struct {
		Content string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Save directly to working tree
	err := os.WriteFile(filePath, []byte(req.Content), 0644)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "File saved successfully", "path": filePath})
}
