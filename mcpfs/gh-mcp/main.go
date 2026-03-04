// gh-mcp: Minimal GitHub MCP resource server for mcpfs experiments.
// Speaks MCP JSON-RPC over stdio. Resources only, no tools.
//
// Resources:
//   github://repos                        - list user's repos
//   github://repos/{owner}/{repo}         - repo details
//   github://repos/{owner}/{repo}/issues  - open issues
//   github://repos/{owner}/{repo}/pulls   - open pull requests
//   github://repos/{owner}/{repo}/readme  - README content
//
// Auth: GITHUB_TOKEN env var, or `gh auth token` fallback.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

var token string

func init() {
	token = os.Getenv("GITHUB_TOKEN")
	if token == "" {
		// Fallback: gh auth token
		out, err := exec.Command("gh", "auth", "token").Output()
		if err == nil {
			token = strings.TrimSpace(string(out))
		}
	}
	if token == "" {
		fmt.Fprintln(os.Stderr, "gh-mcp: no GITHUB_TOKEN and `gh auth token` failed")
		os.Exit(1)
	}
}

func ghAPI(path string) (json.RawMessage, error) {
	url := "https://api.github.com" + path
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("GitHub API %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}
	return json.RawMessage(body), nil
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

func reply(w *bufio.Writer, id interface{}, result interface{}, rpcErr interface{}) {
	resp := rpcResponse{JSONRPC: "2.0", ID: id, Result: result, Error: rpcErr}
	data, _ := json.Marshal(resp)
	w.Write(data)
	w.WriteByte('\n')
	w.Flush()
}

func rpcError(code int, msg string) interface{} {
	return map[string]interface{}{"code": code, "message": msg}
}

var staticResources = []map[string]string{
	{"uri": "github://repos", "name": "repos", "description": "User's repositories", "mimeType": "application/json"},
}

var resourceTemplates = []map[string]string{
	{"uriTemplate": "github://repos/{owner}/{repo}", "name": "repo", "description": "Repository details", "mimeType": "application/json"},
	{"uriTemplate": "github://repos/{owner}/{repo}/issues", "name": "issues", "description": "Open issues", "mimeType": "application/json"},
	{"uriTemplate": "github://repos/{owner}/{repo}/pulls", "name": "pulls", "description": "Open pull requests", "mimeType": "application/json"},
	{"uriTemplate": "github://repos/{owner}/{repo}/readme", "name": "readme", "description": "README content", "mimeType": "text/plain"},
}

func readResource(uri string) (string, string, error) {
	switch {
	case uri == "github://repos":
		data, err := ghAPI("/user/repos?sort=updated&per_page=30")
		if err != nil {
			return "", "", err
		}
		// Slim down to essential fields
		var repos []json.RawMessage
		json.Unmarshal(data, &repos)
		var slim []map[string]interface{}
		for _, r := range repos {
			var full map[string]interface{}
			json.Unmarshal(r, &full)
			slim = append(slim, map[string]interface{}{
				"full_name":   full["full_name"],
				"description": full["description"],
				"language":    full["language"],
				"stars":       full["stargazers_count"],
				"updated_at":  full["updated_at"],
				"private":     full["private"],
				"fork":        full["fork"],
			})
		}
		out, _ := json.MarshalIndent(slim, "", "  ")
		return string(out), "application/json", nil

	case strings.HasSuffix(uri, "/readme"):
		parts := parseRepoParts(uri)
		if parts == nil {
			return "", "", fmt.Errorf("invalid URI: %s", uri)
		}
		// Get README content decoded
		data, err := ghAPI(fmt.Sprintf("/repos/%s/%s/readme", parts[0], parts[1]))
		if err != nil {
			return "", "", err
		}
		var readme struct {
			Content  string `json:"content"`
			Encoding string `json:"encoding"`
		}
		json.Unmarshal(data, &readme)
		if readme.Encoding == "base64" {
			// GitHub returns base64-encoded content
			import_decode, _ := io.ReadAll(
				io.NopCloser(strings.NewReader(readme.Content)),
			)
			// Actually, let's use the raw API
			data2, err := ghAPI(fmt.Sprintf("/repos/%s/%s/contents/README.md", parts[0], parts[1]))
			if err != nil {
				return string(import_decode), "text/plain", nil
			}
			var file struct {
				DownloadURL string `json:"download_url"`
			}
			json.Unmarshal(data2, &file)
			if file.DownloadURL != "" {
				resp, err := http.Get(file.DownloadURL)
				if err == nil {
					defer resp.Body.Close()
					body, _ := io.ReadAll(resp.Body)
					return string(body), "text/plain", nil
				}
			}
		}
		return "(no readme)", "text/plain", nil

	case strings.HasSuffix(uri, "/issues"):
		parts := parseRepoParts(uri)
		if parts == nil {
			return "", "", fmt.Errorf("invalid URI: %s", uri)
		}
		data, err := ghAPI(fmt.Sprintf("/repos/%s/%s/issues?state=open&per_page=30", parts[0], parts[1]))
		if err != nil {
			return "", "", err
		}
		out, _ := json.MarshalIndent(json.RawMessage(data), "", "  ")
		return string(out), "application/json", nil

	case strings.HasSuffix(uri, "/pulls"):
		parts := parseRepoParts(uri)
		if parts == nil {
			return "", "", fmt.Errorf("invalid URI: %s", uri)
		}
		data, err := ghAPI(fmt.Sprintf("/repos/%s/%s/pulls?state=open&per_page=30", parts[0], parts[1]))
		if err != nil {
			return "", "", err
		}
		out, _ := json.MarshalIndent(json.RawMessage(data), "", "  ")
		return string(out), "application/json", nil

	default:
		// Must be github://repos/{owner}/{repo}
		parts := parseRepoParts(uri)
		if parts == nil {
			return "", "", fmt.Errorf("invalid URI: %s", uri)
		}
		data, err := ghAPI(fmt.Sprintf("/repos/%s/%s", parts[0], parts[1]))
		if err != nil {
			return "", "", err
		}
		out, _ := json.MarshalIndent(json.RawMessage(data), "", "  ")
		return string(out), "application/json", nil
	}
}

// parseRepoParts extracts owner and repo from "github://repos/{owner}/{repo}[/...]"
func parseRepoParts(uri string) []string {
	path := strings.TrimPrefix(uri, "github://repos/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) < 2 {
		return nil
	}
	return parts[:2]
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)

	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}

		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}

		// Parse ID
		var id interface{}
		if req.ID != nil {
			json.Unmarshal(req.ID, &id)
		}

		switch req.Method {
		case "initialize":
			reply(writer, id, map[string]interface{}{
				"protocolVersion": "2025-03-26",
				"capabilities":    map[string]interface{}{"resources": map[string]interface{}{}},
				"serverInfo":      map[string]string{"name": "gh-mcp", "version": "0.1.0"},
			}, nil)

		case "notifications/initialized":
			// No reply needed for notifications

		case "resources/list":
			reply(writer, id, map[string]interface{}{"resources": staticResources}, nil)

		case "resources/templates/list":
			reply(writer, id, map[string]interface{}{"resourceTemplates": resourceTemplates}, nil)

		case "resources/read":
			var params struct {
				URI string `json:"uri"`
			}
			json.Unmarshal(req.Params, &params)
			text, mime, err := readResource(params.URI)
			if err != nil {
				reply(writer, id, nil, rpcError(-32603, err.Error()))
			} else {
				reply(writer, id, map[string]interface{}{
					"contents": []map[string]string{{"uri": params.URI, "mimeType": mime, "text": text}},
				}, nil)
			}

		default:
			reply(writer, id, nil, rpcError(-32601, "method not found: "+req.Method))
		}
	}
}
